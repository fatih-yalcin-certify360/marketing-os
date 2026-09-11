import { Pool } from 'pg';
import { loadServerEnv } from '@c360/config';
import { pgExecutor } from '../executor.js';
import { runMigrations } from '../migrate.js';
import { createDatabase } from '../pool.js';
import { seedDevelopmentData } from '../seed.js';

/**
 * Destructive: drops the public schema, re-migrates and re-seeds.
 *
 * Guarded three ways because it destroys data: it refuses when
 * `NODE_ENV=production`, it refuses unless `--yes` is passed, and it refuses a
 * DATABASE_URL whose database name does not look like a development or test
 * database. See docs/security/backup-restore.md for the recovery procedure
 * this is *not* a substitute for.
 */
async function main(): Promise<void> {
  const env = loadServerEnv();

  if (env.NODE_ENV === 'production') {
    process.stderr.write('[db] refusing to reset when NODE_ENV=production.\n');
    process.exit(1);
  }
  if (!process.argv.includes('--yes')) {
    process.stderr.write(
      '[db] db:reset destroys all local data. Re-run with --yes to confirm.\n',
    );
    process.exit(1);
  }

  const databaseName = databaseNameFrom(env.DATABASE_URL);
  if (databaseName !== undefined && !/(dev|test|local)/u.test(databaseName)) {
    process.stderr.write(
      `[db] refusing to reset database "${databaseName}": the name does not contain dev, test or local.\n`,
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    process.stdout.write('[db] dropping schema public\n');
    await pgExecutor(pool).exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(pgExecutor(pool), {
      onApplied: (version) => process.stdout.write(`  applied ${version}\n`),
    });
  } finally {
    await pool.end();
  }

  const database = createDatabase(env);
  try {
    await seedDevelopmentData(database.db, {
      devSubject: env.LOCAL_DEV_SUBJECT,
      devEmail: env.LOCAL_DEV_EMAIL,
      devName: env.LOCAL_DEV_NAME,
    });
    process.stdout.write('[db] reset complete\n');
  } finally {
    await database.close();
  }
}

function databaseNameFrom(connectionString: string): string | undefined {
  try {
    const url = new URL(connectionString);
    const name = url.pathname.replace(/^\//u, '');
    return name.length === 0 ? undefined : name;
  } catch {
    return undefined;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`[db] reset failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
