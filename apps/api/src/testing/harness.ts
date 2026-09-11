import { drizzle } from 'drizzle-orm/pglite';
import type { FastifyInstance } from 'fastify';
import { createPgliteDatabase, testServerEnv, type PgliteHandle } from '@c360/testing';
import type { ServerEnv } from '@c360/config';
import type { CurrentUser } from '@c360/contracts';
import type { AppContext } from '../core/http/context.js';
import { schema } from '../core/db/schema.js';
import { runMigrations } from '../core/db/migrate.js';
import { seedDevelopmentData, type SeedResult } from '../core/db/seed.js';
import type { Db } from '../core/db/types.js';
import { buildServer } from '../server.js';

/**
 * Integration-test harness: real migrations, real SQL, real Fastify.
 *
 * The `as unknown as Db` cast is the one deliberate type escape in the project.
 * `Db` is pinned to the node-postgres flavour because that is what production
 * runs; PGlite's Drizzle database is behaviourally identical for every
 * query-builder path used here, differing only in the raw `.execute()` result
 * shape. Confining the cast to this single line keeps production types honest
 * while letting the suites exercise the same repositories.
 */
export interface TestHarness {
  app: FastifyInstance;
  /** The constructed service graph, for tests that exercise a service directly. */
  appContext: AppContext;
  /** The seeded development identity, as the services see it. */
  currentUser: CurrentUser;
  db: Db;
  env: ServerEnv;
  seed: SeedResult;
  pglite: PgliteHandle;
  close(): Promise<void>;
}

export interface HarnessOptions {
  envOverrides?: Record<string, string>;
  /** Skip demo seeding for tests that need an empty database. */
  seed?: boolean;
}

export async function createTestHarness(options: HarnessOptions = {}): Promise<TestHarness> {
  const env = testServerEnv(options.envOverrides ?? {});
  const pglite = await createPgliteDatabase();

  // PGlite is single-connection, so the advisory lock adds nothing here.
  await runMigrations(pglite.executor, { useAdvisoryLock: false });

  const db = drizzle(pglite.client, { schema, casing: 'snake_case' }) as unknown as Db;

  const seed =
    options.seed === false
      ? {
          organizationId: '',
          labels: [],
          devUserId: '',
          secondUserId: '',
          pilot: { brandProfileVersionId: null, courseVersionId: null },
        }
      : await seedDevelopmentData(db, {
          devSubject: env.LOCAL_DEV_SUBJECT,
          devEmail: env.LOCAL_DEV_EMAIL,
          devName: env.LOCAL_DEV_NAME,
        });

  const app = await buildServer({ env, db });
  await app.ready();

  const appContext = app.appContext;

  /*
   * Resolved only when the harness was seeded.
   *
   * `createTestHarness({ seed: false })` gives an empty database on purpose —
   * the schema-parity suite needs one — and resolving an identity there throws,
   * because there is no organisation row to belong to. Resolving eagerly broke
   * that suite; a lazy accessor that fails with a useful message keeps
   * `currentUser` non-nullable for the tests that do have a seed.
   */
  const resolvedUser =
    options.seed === false
      ? undefined
      : await appContext.services.identity.resolveCurrentUser(
          db,
          appContext.authAdapter.authenticate({ headers: {}, remoteAddress: '127.0.0.1' }),
        );

  return {
    app,
    appContext,
    get currentUser(): CurrentUser {
      if (resolvedUser === undefined) {
        throw new Error(
          'This harness was created with { seed: false }, so it has no identity. Seed it to use currentUser.',
        );
      }
      return resolvedUser;
    },
    db,
    env,
    seed,
    pglite,
    close: async () => {
      await app.close();
      await pglite.close();
    },
  };
}

/** Resolves a seeded label id by slug, failing loudly if the seed changed. */
export function labelIdBySlug(seed: SeedResult, slug: string): string {
  const label = seed.labels.find((entry) => entry.slug === slug);
  if (label === undefined) {
    throw new Error(`Seed does not contain label "${slug}"`);
  }
  return label.id;
}
