import { Pool } from 'pg';
import { EnvValidationError, loadServerEnv } from '@c360/config';
import { pgExecutor } from '../executor.js';
import { runMigrations } from '../migrate.js';

async function main(): Promise<void> {
  const env = loadServerEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    const result = await runMigrations(pgExecutor(pool), {
      onApplied: (version) => process.stdout.write(`  applied ${version}\n`),
    });
    if (result.applied.length === 0) {
      process.stdout.write(
        `[db] up to date (${String(result.alreadyApplied.length)} migrations already applied)\n`,
      );
    } else {
      process.stdout.write(`[db] applied ${String(result.applied.length)} migration(s)\n`);
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    process.stderr.write(`[db] ${error.message}\n`);
  } else {
    process.stderr.write(`[db] migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exit(1);
});
