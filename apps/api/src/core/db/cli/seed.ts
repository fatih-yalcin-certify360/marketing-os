import { loadServerEnv } from '@c360/config';
import { createDatabase } from '../pool.js';
import { seedDevelopmentData } from '../seed.js';

/**
 * Seeds clearly-labelled demo data.
 *
 * Refuses to run against a production environment: seeding invents
 * organisations, labels and memberships, which would be a data-integrity and
 * access-control incident in production, not a convenience.
 */
async function main(): Promise<void> {
  const env = loadServerEnv();
  if (env.NODE_ENV === 'production') {
    process.stderr.write('[db] refusing to seed demo data when NODE_ENV=production.\n');
    process.exit(1);
  }

  const database = createDatabase(env);
  try {
    const result = await seedDevelopmentData(database.db, {
      devSubject: env.LOCAL_DEV_SUBJECT,
      devEmail: env.LOCAL_DEV_EMAIL,
      devName: env.LOCAL_DEV_NAME,
    });
    process.stdout.write(`[db] seeded organisation ${result.organizationId}\n`);
    for (const label of result.labels) {
      process.stdout.write(`  ${label.slug.padEnd(16)} ${label.role}\n`);
    }
    if (result.pilot.courseVersionId !== null) {
      process.stdout.write(
        `[db] pilot demo data: merkprofiel ${String(result.pilot.brandProfileVersionId)}\n` +
          `                     opleidingskaart ${String(result.pilot.courseVersionId)}\n`,
      );
    }
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`[db] seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
