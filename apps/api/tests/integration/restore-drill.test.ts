import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, cp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createCampaignInput } from '@c360/contracts';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';
import {
  approvalsStillBind,
  compareFingerprints,
  filesForAssetsExist,
  fingerprint,
  tenancyIsIntact,
  type Fingerprint,
  type Queryable,
} from '../../src/core/db/restore-verify.js';

/**
 * Wraps a PGlite instance as a `Queryable`.
 *
 * The generic has to be threaded through by hand: PGlite's `query` is generic
 * over the row type and returns `Results<T>`, so an untyped arrow gives back
 * `unknown[]` and the verification's own types stop meaning anything.
 */
function queryable(client: PGlite): Queryable {
  return {
    query: async <T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]) =>
      (await client.query<T>(sql, [...(params ?? [])])).rows,
  };
}

/**
 * The rehearsed restore (P4-5, closes R-10).
 *
 * `docs/security/backup-restore.md` carried the line "the procedure below is
 * written and reviewable. It has never been executed" — and an untested backup
 * is not a backup. This executes it: real data in, a backup taken, the database
 * destroyed, the backup restored, and then the verification that decides whether
 * any of it worked.
 *
 * Running it as a test rather than as a script someone remembers is the point.
 * The procedure asked for a *quarterly* rehearsal; this one happens on every
 * commit, and a regression in the schema or in the file pairing fails the build
 * rather than being discovered during an incident.
 *
 * ## What this does and does not prove
 *
 * It exercises the **verification**, which is where a restore actually goes
 * wrong, and it exercises a genuine dump-and-load round trip of the same bytes.
 * It does **not** exercise `pg_dump --format=custom` and `pg_restore`: those
 * tools are not present in this environment, and the production path therefore
 * remains unrehearsed. `cli/verify-restore.ts` exists so the same checks can be
 * pointed at a real restored PostgreSQL when there is one. That limitation is
 * recorded in the backup document rather than left for a reader to discover.
 */
describe('a rehearsed restore', () => {
  let h: TestHarness;
  let storageRoot: string;
  let backupRoot: string;
  let backup: Blob;
  let before: Fingerprint;

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'c360-drill-store-'));
    backupRoot = await mkdtemp(join(tmpdir(), 'c360-drill-copy-'));
    h = await createTestHarness({ envOverrides: { STORAGE_ROOT: storageRoot } });

    /*
     * Real data, not an empty schema.
     *
     * A restore drill over a seeded-but-untouched database proves almost
     * nothing: the interesting rows are the ones with foreign keys into each
     * other and files on disk. So the chain runs far enough to produce content,
     * a rendered image, an approval and an export package.
     */
    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    const labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const courseVersionId = h.seed.pilot.courseVersionId ?? '';

    const proposed = await s.personas.propose(db, user, { labelId, courseVersionId });
    const personaVersionIds = proposed.personas.map((persona) => persona.id);
    for (const id of personaVersionIds) {
      await s.personas.approve(db, user, labelId, id);
    }
    const campaign = await s.campaigns.create(
      db,
      user,
      labelId,
      createCampaignInput.parse({
        name: 'Herstel-oefening (Demo)',
        entryMode: 'discover_opportunities',
        courseVersionId,
      }),
    );
    const brief = await s.campaigns.draftBrief(db, user, {
      labelId,
      campaignId: campaign.id,
      personaVersionIds,
    });
    await s.campaigns.approveBrief(db, user, labelId, campaign.id, brief.id, null);
    const concepts = await s.concepts.propose(db, user, { labelId, campaignId: campaign.id });
    await s.concepts.select(db, user, labelId, campaign.id, concepts.concepts[0]?.id ?? '');
    await s.concepts.proposePlan(db, user, { labelId, campaignId: campaign.id });
    await s.concepts.approvePlan(db, user, labelId, campaign.id, null);
    const generated = await s.content.generate(db, user, { labelId, campaignId: campaign.id });
    for (const asset of generated.assets) {
      await s.content.approve(db, user, labelId, asset.id, null);
    }
    await s.exports.build(db, user, labelId, campaign.id, 'draft');

    const live: Queryable = { query: (sql, params) => h.pglite.executor.query(sql, params) };
    before = await fingerprint(live);

    /*
     * Step 1 of the procedure: stop writers before taking the backup.
     *
     * Not simulated here beyond noting it — there is one connection and no
     * worker in this test. The reason it is in the procedure is that a job
     * claiming against a half-restored table is the failure that produces
     * duplicate work, and no drill on a single connection can rehearse that.
     */
    backup = await h.pglite.client.dumpDataDir('none');
    // The other half of the pair: the file store, snapshotted at the same point.
    await cp(storageRoot, join(backupRoot, 'storage'), { recursive: true });
  });

  afterAll(async () => {
    await h.close();
    await rm(storageRoot, { recursive: true, force: true });
    await rm(backupRoot, { recursive: true, force: true });
  });

  it('produced a backup with something in it', () => {
    // A zero-length dump is the failure that looks like success.
    expect(backup.size).toBeGreaterThan(1_000);
    expect(before.migrations.length).toBeGreaterThan(10);
    expect(before.counts.campaigns).toBeGreaterThan(0);
    expect(before.assetPaths.length).toBeGreaterThan(0);
  });

  it('restores into a fresh database and passes every check', async () => {
    /*
     * A new instance from the backup alone: nothing carries over from the
     * original, which is the only way to know the dump held everything.
     */
    const restored = await PGlite.create({ loadDataDir: backup });
    try {
      const db = queryable(restored);
      const after = await fingerprint(db);

      const results = [
        ...compareFingerprints(before, after),
        await tenancyIsIntact(db),
        await approvalsStillBind(db),
        // Paired with its file store, as the procedure requires.
        await filesForAssetsExist(after, async (storagePath) => {
          try {
            await stat(join(backupRoot, 'storage', storagePath));
            return true;
          } catch {
            return false;
          }
        }),
      ];

      for (const result of results) {
        expect(result.ok, `${result.name} — ${result.detail}`).toBe(true);
      }
      // Guards against a verification that checked nothing.
      expect(results.length).toBeGreaterThanOrEqual(8);
    } finally {
      await restored.close();
    }
  });

  it('catches a database restored without its file storage', async () => {
    /*
     * The failure the backup document warns about, and the reason this drill is
     * worth having.
     *
     * Restoring the database and forgetting `STORAGE_ROOT` is the most likely
     * real mistake: the database is the part that feels like the system. It
     * also fails *silently* — every row is present, every page loads, and the
     * images are gone. So the check is proved to fire by pointing it at an
     * empty file store, rather than trusted because it is written down.
     */
    const restored = await PGlite.create({ loadDataDir: backup });
    const emptyStore = await mkdtemp(join(tmpdir(), 'c360-drill-empty-'));
    try {
      const db = queryable(restored);
      const after = await fingerprint(db);
      const result = await filesForAssetsExist(after, async (storagePath) => {
        try {
          await stat(join(emptyStore, storagePath));
          return true;
        } catch {
          return false;
        }
      });

      expect(result.ok).toBe(false);
      expect(result.detail).toMatch(/missing/u);
      // And it says what happened, because "false" is not actionable at 3am.
      expect(result.detail).toMatch(/every page will load/u);
    } finally {
      await restored.close();
      await rm(emptyStore, { recursive: true, force: true });
    }
  });
});
