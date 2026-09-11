import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { SqlExecutor } from './executor.js';

/**
 * Forward-only migration runner.
 *
 * Properties that matter for change control (ISO 9001/27001 traceability, see
 * docs/security/change-management.md):
 *
 *  - migrations are plain reviewable `.sql` files, applied in filename order;
 *  - each file's SHA-256 is recorded, and a mismatch on an already-applied
 *    migration aborts instead of silently running divergent schema;
 *  - each migration runs inside its own transaction, so a failure leaves the
 *    database at the previous version rather than half-migrated;
 *  - a session-level advisory lock serialises concurrent runners, which is what
 *    stops two API containers migrating at the same time on deploy.
 */

const MIGRATIONS_DIRNAME = 'db/migrations';
/** Arbitrary but fixed key, so every deployment of this app takes the same lock. */
const ADVISORY_LOCK_KEY = 4_360_360;

export interface MigrationFile {
  version: string;
  filename: string;
  sql: string;
  checksum: string;
}

export interface MigrateOptions {
  /**
   * PGlite runs single-connection, where an advisory lock adds nothing; the
   * test harness disables it. Always true for real deployments.
   */
  useAdvisoryLock?: boolean;
  onApplied?: (version: string) => void;
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: string[];
}

/** Resolves the migrations directory relative to this source file. */
export function migrationsDirectory(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/core/db -> apps/api
  const appRoot = path.resolve(here, '../../..');
  return path.join(appRoot, MIGRATIONS_DIRNAME);
}

export async function loadMigrations(directory = migrationsDirectory()): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en'));

  const migrations: MigrationFile[] = [];
  for (const filename of files) {
    const sql = await readFile(path.join(directory, filename), 'utf8');
    const version = filename.replace(/\.sql$/u, '');
    migrations.push({
      version,
      filename,
      sql,
      checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
    });
  }
  return migrations;
}

const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text        PRIMARY KEY,
  checksum    text        NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
`;

export class MigrationChecksumError extends Error {
  constructor(version: string) {
    super(
      `Migration ${version} has already been applied but its file contents changed. ` +
        'Forward-only migrations must not be edited after release — add a new migration instead.',
    );
    this.name = 'MigrationChecksumError';
  }
}

export async function runMigrations(
  executor: SqlExecutor,
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const { useAdvisoryLock = true, onApplied } = options;

  await executor.exec(LEDGER_DDL);

  if (useAdvisoryLock) {
    await executor.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  }

  try {
    const recorded = await executor.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const recordedByVersion = new Map(recorded.map((row) => [row.version, row.checksum]));

    const migrations = await loadMigrations();
    const applied: string[] = [];
    const alreadyApplied: string[] = [];

    for (const migration of migrations) {
      const existing = recordedByVersion.get(migration.version);
      if (existing !== undefined) {
        if (existing !== migration.checksum) {
          throw new MigrationChecksumError(migration.version);
        }
        alreadyApplied.push(migration.version);
        continue;
      }

      // Each migration is its own transaction: a failure rolls back cleanly.
      await executor.exec('BEGIN');
      try {
        await executor.exec(migration.sql);
        await executor.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [migration.version, migration.checksum],
        );
        await executor.exec('COMMIT');
      } catch (error) {
        await executor.exec('ROLLBACK').catch(() => undefined);
        throw error;
      }

      applied.push(migration.version);
      onApplied?.(migration.version);
    }

    return { applied, alreadyApplied };
  } finally {
    if (useAdvisoryLock) {
      await executor.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => []);
    }
  }
}
