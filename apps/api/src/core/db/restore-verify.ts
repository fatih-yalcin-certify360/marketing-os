/**
 * The checks that decide whether a restore worked (P4-5, closes R-10).
 *
 * `docs/security/backup-restore.md` describes a procedure and, until now, said
 * plainly that it had never been executed. An untested backup is not a backup —
 * and the part that goes wrong is almost never the dump. It is the verification
 * afterwards.
 *
 * So this lives in the application rather than in a test or a development
 * script, and takes a query function rather than opening its own connection.
 * Two callers need it and neither is optional:
 *
 *  - `restore-drill.test.ts` rehearses the whole cycle on a throwaway database
 *    on every commit, which is what turns "documented" into "rehearsed".
 *  - `cli/verify-restore.ts` points the same checks at a **real** restored
 *    PostgreSQL. Without that the rehearsal would prove something about PGlite
 *    and nothing about production.
 *
 * ## The check that matters most
 *
 * `filesForAssetsExist`. The backup document's own strongest claim is that "the
 * database and file storage must be restored to a consistent pair — a content
 * asset row whose rendered image is missing is a broken record". Nothing
 * verified that. Restoring the database and forgetting `STORAGE_ROOT` is the
 * most likely real-world mistake, because the database is the part that feels
 * like the system, and it fails silently: every page loads, every row is there,
 * and the images are gone.
 */

/** Just enough of a database connection to ask questions. */
export interface Queryable {
  query<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface VerificationResult {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Tables whose row counts must survive a restore unchanged.
 *
 * The list is explicit rather than "every table in the schema": a new table
 * appearing should be a deliberate addition here, so that a restore drill
 * cannot quietly stop covering something. `memberships` is the one to notice —
 * authorisation must survive intact, or a restore silently removes people's
 * access.
 */
export const COUNTED_TABLES = [
  'organizations',
  'labels',
  'users',
  'memberships',
  'audit_events',
  'brand_profile_versions',
  'course_versions',
  'persona_versions',
  'campaigns',
  'brief_versions',
  'concept_versions',
  'content_plans',
  'content_asset_versions',
  'approvals',
  'exports',
  'publication_records',
  'outcome_reports',
  'learnings',
  'sources',
  'research_runs',
  'research_findings',
  'assets',
  'jobs',
  'usage_records',
] as const;

export interface Fingerprint {
  /** The migration ledger, in order. Schema level is checked before contents. */
  migrations: string[];
  counts: Record<string, number>;
  jobsByStatus: Record<string, number>;
  /** Every asset's stored path, so the file half can be checked against it. */
  assetPaths: string[];
}

export async function fingerprint(db: Queryable): Promise<Fingerprint> {
  const migrations = await db.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version',
  );

  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    // The table name comes from the constant above, never from input.
    const rows = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
    counts[table] = Number.parseInt(rows[0]?.n ?? '0', 10);
  }

  const jobs = await db.query<{ status: string; n: string }>(
    'SELECT status, count(*)::text AS n FROM jobs GROUP BY status',
  );
  const jobsByStatus: Record<string, number> = {};
  for (const row of jobs) {
    jobsByStatus[row.status] = Number.parseInt(row.n, 10);
  }

  const assets = await db.query<{ storage_path: string }>('SELECT storage_path FROM assets');

  return {
    migrations: migrations.map((row) => row.version),
    counts,
    jobsByStatus,
    assetPaths: assets.map((row) => row.storage_path),
  };
}

/**
 * Every asset row must have its bytes.
 *
 * Takes an existence predicate rather than touching the filesystem itself, so
 * the same check works against a local directory, a mounted snapshot or an
 * object store.
 */
export async function filesForAssetsExist(
  after: Fingerprint,
  exists: (storagePath: string) => Promise<boolean> | boolean,
): Promise<VerificationResult> {
  const missing: string[] = [];
  for (const storagePath of after.assetPaths) {
    if (!(await exists(storagePath))) {
      missing.push(storagePath);
    }
  }

  return {
    name: 'every asset row has its file',
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `${String(after.assetPaths.length)} asset(s), all present`
        : `${String(missing.length)} of ${String(after.assetPaths.length)} missing, e.g. ${missing.slice(0, 3).join(', ')}. The database was restored without its file storage: rows exist, images do not, and every page will load.`,
  };
}

/**
 * Rows whose `(label_id, organization_id)` pair does not exist in `labels`.
 *
 * A restore is exactly when a mismatched pair would surface — a partial
 * restore, or two dumps from different points in time. The composite foreign
 * keys make it unrepresentable while they are enforced; this asks whether they
 * still are.
 */
export async function tenancyIsIntact(db: Queryable): Promise<VerificationResult> {
  const tables = ['campaigns', 'content_asset_versions', 'assets', 'outcome_reports', 'learnings'];
  const offenders: string[] = [];

  for (const table of tables) {
    const rows = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table} t
        WHERE NOT EXISTS (
          SELECT 1 FROM labels l WHERE l.id = t.label_id AND l.organization_id = t.organization_id
        )`,
    );
    const n = Number.parseInt(rows[0]?.n ?? '0', 10);
    if (n > 0) {
      offenders.push(`${table}: ${String(n)}`);
    }
  }

  return {
    name: 'no row belongs to a label/organisation pair that does not exist',
    ok: offenders.length === 0,
    detail: offenders.length === 0 ? `checked ${String(tables.length)} tenant tables` : offenders.join('; '),
  };
}

/** Approvals must still point at an artefact version that exists. */
export async function approvalsStillBind(db: Queryable): Promise<VerificationResult> {
  const rows = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM approvals a
      WHERE a.artefact_type = 'content_asset'
        AND NOT EXISTS (SELECT 1 FROM content_asset_versions c WHERE c.id = a.artefact_id)`,
  );
  const dangling = Number.parseInt(rows[0]?.n ?? '0', 10);
  return {
    name: 'every content approval still points at a version that exists',
    ok: dangling === 0,
    detail: dangling === 0 ? 'no dangling approvals' : `${String(dangling)} approval(s) point at nothing`,
  };
}

/** Compares two fingerprints and produces one result per claim. */
export function compareFingerprints(before: Fingerprint, after: Fingerprint): VerificationResult[] {
  const results: VerificationResult[] = [];

  results.push({
    name: 'the migration ledger is identical',
    ok: JSON.stringify(before.migrations) === JSON.stringify(after.migrations),
    detail: `${String(after.migrations.length)} migration(s); last: ${after.migrations.at(-1) ?? '(none)'}`,
  });

  const drifted = COUNTED_TABLES.filter((table) => before.counts[table] !== after.counts[table]).map(
    (table) => `${table}: ${String(before.counts[table])} → ${String(after.counts[table])}`,
  );
  results.push({
    name: 'every counted table has the same number of rows',
    ok: drifted.length === 0,
    detail: drifted.length === 0 ? `${String(COUNTED_TABLES.length)} tables match` : drifted.join('; '),
  });

  results.push({
    name: 'authorisation survived: memberships are unchanged',
    ok: before.counts.memberships === after.counts.memberships,
    detail: `${String(after.counts.memberships ?? 0)} membership(s)`,
  });

  results.push({
    name: 'the job status distribution is unchanged',
    ok: JSON.stringify(before.jobsByStatus) === JSON.stringify(after.jobsByStatus),
    detail: JSON.stringify(after.jobsByStatus),
  });

  /*
   * Reported rather than asserted.
   *
   * A restored `running` job has no live worker. The reaper requeues it once
   * the heartbeat times out, so this is not a failure — but step 6 of the
   * procedure says to check it rather than assume it, and a drill that stayed
   * silent about it would be skipping the step it exists to rehearse.
   */
  const running = after.jobsByStatus.running ?? 0;
  results.push({
    name: 'no job was restored mid-flight',
    ok: running === 0,
    detail:
      running === 0
        ? 'nothing was running'
        : `${String(running)} job(s) restored as running. Not corruption: the reaper requeues them once the heartbeat times out. Confirm budget reservations match job states before restarting writers.`,
  });

  return results;
}
