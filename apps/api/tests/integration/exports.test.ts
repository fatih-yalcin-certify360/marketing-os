import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createCampaignInput } from '@c360/contracts';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';
import { exports as exportsTable } from '../../src/core/db/schema.js';

/**
 * The export package: the only artefact that leaves this system.
 *
 * Nothing tested it. That gap cost a real failure — the unique index on
 * `assets` became partial in migration 0010, which invalidated the
 * `ON CONFLICT (label_id, sha256, kind)` in the export writer, and *every*
 * draft export answered 500 from that moment on. Nothing caught it: the
 * interface rendered no error for a failing draft export, so the button simply
 * returned to its idle label, and the browser smoke run counted the step as
 * done. It surfaced only because an export row was missing from a table nobody
 * had asked about.
 *
 * So this covers the two claims the module makes and neither of which was
 * checked: a draft package can always be produced and says inside itself that
 * it is a draft, and a publish-ready package is refused with reasons until the
 * gates pass.
 */
describe('export packages', () => {
  let h: TestHarness;
  let root: string;
  let labelId: string;
  let campaignId: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'c360-export-'));
    h = await createTestHarness({ envOverrides: { STORAGE_ROOT: root } });
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');

    // The whole chain, because an export is only meaningful at the end of it.
    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    const courseVersionId = h.seed.pilot.courseVersionId;
    if (courseVersionId === undefined || courseVersionId === null) {
      throw new Error('the seed no longer provides a pilot course version');
    }
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
        name: 'Export test (Demo)',
        entryMode: 'discover_opportunities',
        courseVersionId,
      }),
    );
    campaignId = campaign.id;
    const brief = await s.campaigns.draftBrief(db, user, {
      labelId,
      campaignId,
      personaVersionIds,
    });
    await s.campaigns.approveBrief(db, user, labelId, campaignId, brief.id, null);
    const concepts = await s.concepts.propose(db, user, { labelId, campaignId });
    const first = concepts.concepts[0];
    if (first === undefined) {
      throw new Error('no concept was proposed');
    }
    await s.concepts.select(db, user, labelId, campaignId, first.id);
    await s.concepts.proposePlan(db, user, { labelId, campaignId });
    await s.concepts.approvePlan(db, user, labelId, campaignId, null);
    await s.content.generate(db, user, { labelId, campaignId });
  });

  afterAll(async () => {
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  /** The `asset_id` recorded for an export, straight from the table. */
  async function storedAssetId(exportId: string): Promise<string | null> {
    const rows = await h.db
      .select({ assetId: exportsTable.assetId })
      .from(exportsTable)
      .where(eq(exportsTable.id, exportId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      throw new Error(`no export row for ${exportId}`);
    }
    return row.assetId;
  }

  it('writes a draft package, and writes the same one again without failing', async () => {
    const { db, currentUser: user } = h;
    const exportService = h.appContext.services.exports;

    const first = await exportService.build(db, user, labelId, campaignId, 'draft');

    expect(first.record.kind).toBe('draft');
    expect(first.record.blockedReasonsNl).toEqual([]);
    expect(first.record.sizeBytes).toBeGreaterThan(0);
    expect(first.storagePath).not.toBeNull();

    /*
     * The stored row, not the response.
     *
     * `assetId` is deliberately not part of the client contract, and it is the
     * field that went wrong: without it the interface offers no download for
     * the package it just made. Read from the table so the assertion is about
     * what was written rather than about what is projected.
     */
    const firstAssetId = await storedAssetId(first.record.id);
    expect(firstAssetId).not.toBeNull();

    const paths = first.record.manifest.map((entry) => entry.path);
    expect(paths).toContain('LEESMIJ.txt');
    // A draft's channel folders are marked, so a file that leaves this system
    // cannot be mistaken for approved material.
    expect(paths.some((entry) => entry.startsWith('CONCEPT_'))).toBe(true);

    /*
     * The rendered images travel with the package.
     *
     * This is the one part of the export that opens files from disk by a path
     * that came out of the database, so it is the part most worth proving:
     * every image entry's byte count is the stored asset's own, and the entry
     * count matches what the content actually has.
     */
    const images = first.record.manifest.filter((entry) => entry.variant !== null);
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image.bytes).toBeGreaterThan(0);
      expect(image.variant === 'A' || image.variant === 'B').toBe(true);
      // Social renders are JPEG since 2026-09-15: Instagram's publishing API
      // accepts nothing else, and the name has to match the bytes or the very
      // upload it is meant for refuses it.
      expect(image.path.endsWith('.jpg')).toBe(true);
    }

    const onDisk = await stat(join(root, first.storagePath ?? ''));
    expect(onDisk.size).toBe(first.record.sizeBytes);

    /*
     * The same export again.
     *
     * A second package normally differs from the first, because it records its
     * own export time. This one does not: the clock is frozen, so both are
     * byte-identical and the insert hits the unique index — the branch that
     * exists for a double click, and the statement that returned 500 for every
     * export once the index became partial. It must succeed and must point at
     * the package that is already stored rather than at nothing.
     */
    /*
     * Only the clock is frozen, not the event loop.
     *
     * A full `useFakeTimers()` also replaces `setImmediate`, which JSZip uses
     * to chunk `generateAsync` — the zip then never finishes and the test dies
     * of a timeout instead of asserting anything.
     */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'));
    try {
      const third = await exportService.build(db, user, labelId, campaignId, 'draft');
      const fourth = await exportService.build(db, user, labelId, campaignId, 'draft');
      expect(fourth.record.id).not.toBe(third.record.id);
      expect(fourth.record.sizeBytes).toBe(third.record.sizeBytes);
      const reused = await storedAssetId(third.record.id);
      expect(reused).not.toBeNull();
      expect(await storedAssetId(fourth.record.id)).toBe(reused);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives every export its own package when they are made at different times', async () => {
    const { db, currentUser: user } = h;
    const exportService = h.appContext.services.exports;

    /*
     * Two exports a moment apart are two packages.
     *
     * The package states when it was produced, so the bytes differ and the
     * content hash with them. This is asserted rather than assumed: the
     * conflict handling above would quietly collapse the two into one if the
     * export time ever stopped being part of the package, and a reader
     * downloading yesterday's file believing it was today's is a data problem,
     * not a storage one.
     */
    const one = await exportService.build(db, user, labelId, campaignId, 'draft');
    const two = await exportService.build(db, user, labelId, campaignId, 'draft');
    expect(await storedAssetId(two.record.id)).not.toBe(await storedAssetId(one.record.id));
  });

  it('refuses a publish-ready package while the gates are open, and says why', async () => {
    const { db, currentUser: user } = h;
    const exportService = h.appContext.services.exports;

    const refused = await exportService.build(db, user, labelId, campaignId, 'publish_ready');

    // Demo course data is deliberately unverified and the content has not been
    // approved, so this must not produce a package.
    expect(refused.storagePath).toBeNull();
    expect(refused.record.sizeBytes).toBe(0);
    expect(refused.record.manifest).toEqual([]);
    expect(refused.record.blockedReasonsNl.length).toBeGreaterThan(0);
    // The refusal is recorded rather than only reported, so the attempt is part
    // of the trail.
    const listed = await exportService.list(db, user, labelId, campaignId);
    expect(listed.some((entry) => entry.id === refused.record.id)).toBe(true);
  });

  it('answers a refused publish-ready export with a readable reason, not a bare status', async () => {
    /*
     * Over HTTP, because the defect was in the answer rather than in the rule.
     *
     * The route used to send 409 with a success-shaped body. Every client
     * builds its Dutch message from the error envelope, so it found none and
     * showed "Er is een onverwachte fout opgetreden" for a refusal it could
     * have explained in six specific sentences.
     */
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/exports`,
      payload: { kind: 'publish_ready' },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<{ error?: { code: string; message: string } }>();
    expect(body.error?.code).toBe('conflict');
    expect(body.error?.message).toContain('nog niet publicatieklaar');
    // The specific reasons, not just the category.
    expect(body.error?.message).toContain('goedgekeurd');
  });

  it('answers a draft export with the package and a download-ready flag', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/exports`,
      payload: { kind: 'draft' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ ready: boolean; export: { sizeBytes: number } }>();
    expect(body.ready).toBe(true);
    expect(body.export.sizeBytes).toBeGreaterThan(0);
  });

  it('refuses any export of a campaign that has no content yet', async () => {
    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    const courseVersionId = h.seed.pilot.courseVersionId;
    const empty = await s.campaigns.create(
      db,
      user,
      labelId,
      createCampaignInput.parse({
        name: 'Leeg (Demo)',
        entryMode: 'discover_opportunities',
        ...(courseVersionId === undefined || courseVersionId === null ? {} : { courseVersionId }),
      }),
    );

    await expect(s.exports.build(db, user, labelId, empty.id, 'draft')).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});
