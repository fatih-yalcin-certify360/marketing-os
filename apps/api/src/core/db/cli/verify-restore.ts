import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { EnvValidationError, loadServerEnv } from '@c360/config';
import {
  approvalsStillBind,
  compareFingerprints,
  filesForAssetsExist,
  fingerprint,
  tenancyIsIntact,
  type Fingerprint,
  type Queryable,
  type VerificationResult,
} from '../restore-verify.js';
import { readFile } from 'node:fs/promises';

/**
 * Verifies a restored database (step 3 of the restore procedure).
 *
 *   DATABASE_URL=<the restored scratch database> npm run db:verify-restore
 *   # optionally, to compare against a fingerprint taken before the incident:
 *   DATABASE_URL=… npm run db:verify-restore -- --baseline before.json
 *   # and to record one while the system is healthy:
 *   DATABASE_URL=… npm run db:verify-restore -- --write-baseline before.json
 *
 * This exists so the rehearsal transfers. `restore-drill.test.ts` runs the same
 * checks on a throwaway database on every commit, which proves the checks work;
 * pointing them at a real restored PostgreSQL is what proves the *restore*
 * worked. Without this file the drill would be a statement about PGlite.
 *
 * Point it at the **scratch** database, never at the live one — the procedure
 * restores to a scratch database first for exactly this reason, and this
 * command only reads, but the habit is what matters.
 */

function parseArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const env = loadServerEnv();
  const baselinePath = parseArg('baseline');
  const writeBaselinePath = parseArg('write-baseline');

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const db: Queryable = {
    query: async <T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]) =>
      (await pool.query<T>(sql, params === undefined ? [] : [...params])).rows,
  };

  try {
    const current = await fingerprint(db);

    if (writeBaselinePath !== undefined) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(writeBaselinePath, JSON.stringify(current, null, 2), 'utf8');
      process.stdout.write(`[restore] baseline written to ${writeBaselinePath}\n`);
      return;
    }

    const results: VerificationResult[] = [];

    if (baselinePath === undefined) {
      /*
       * Without a baseline the counts cannot be compared, and saying so is the
       * honest thing: "12 labels" is not a verification, it is a number. The
       * structural checks below still hold, and they are the ones that catch a
       * half-restored database.
       */
      process.stdout.write(
        '[restore] no --baseline given, so row counts are reported and not verified.\n' +
          '          Take one with --write-baseline while the system is healthy.\n\n',
      );
    } else {
      const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as Fingerprint;
      results.push(...compareFingerprints(baseline, current));
    }

    results.push(await tenancyIsIntact(db));
    results.push(await approvalsStillBind(db));

    /*
     * The file half. Resolved against `STORAGE_ROOT`, because a database
     * restored without its file storage is the failure this whole check exists
     * for and it is invisible from inside the database.
     */
    const root = path.resolve(env.STORAGE_ROOT);
    results.push(
      await filesForAssetsExist(current, async (storagePath) => {
        try {
          await stat(path.join(root, storagePath));
          return true;
        } catch {
          return false;
        }
      }),
    );

    process.stdout.write(`[restore] verifying against ${root}\n\n`);
    for (const [table, count] of Object.entries(current.counts)) {
      if (count > 0) {
        process.stdout.write(`    ${table.padEnd(28)} ${String(count)}\n`);
      }
    }
    process.stdout.write('\n');

    let failed = 0;
    for (const result of results) {
      process.stdout.write(`  ${result.ok ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}\n`);
      if (!result.ok) {
        failed += 1;
      }
    }

    process.stdout.write(
      `\n${String(results.length - failed)} of ${String(results.length)} checks passed\n`,
    );
    if (failed > 0) {
      process.stdout.write(
        '\nDo not restart writers. The procedure is in docs/security/backup-restore.md.\n',
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      '\nRecord what was restored, from when, and how much data was lost (step 8).\n',
    );
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    process.stderr.write(`\n[restore] refusing to run.\n${error.message}\n\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`\n[restore] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
