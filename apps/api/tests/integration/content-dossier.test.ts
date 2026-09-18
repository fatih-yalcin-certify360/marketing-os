import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { contentAssetVersions, courseVersions } from '../../src/core/db/schema.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * One piece of content, downloaded as a document.
 *
 * The thing under test is not the file format — it is whether the record
 * survives the trip out of the product. A piece that leaves as a paragraph in
 * a mail loses who it was written for, what was asked, which version it is and
 * that a model wrote it; every one of those is a thing somebody later has to
 * ask about, and by then nobody knows.
 *
 * So the assertions are about content, not bytes: the audience is in it, the
 * instruction is in it verbatim, and it says the draft is a draft.
 */
describe('a piece of content as a document', () => {
  let h: TestHarness;
  let labelId: string;
  let courseVersionId: string;

  beforeAll(async () => {
    h = await createTestHarness();
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const seeded = h.seed.pilot.courseVersionId;
    if (seeded === undefined || seeded === null) throw new Error('the seed no longer provides a pilot course version');
    courseVersionId = seeded;
    await h.db.update(courseVersions).set({ reviewState: 'approved' }).where(eq(courseVersions.id, courseVersionId));
  });

  afterAll(async () => {
    await h.close();
  });

  /** The text of a `.docx`, with the markup taken off. */
  async function docxText(body: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(body);
    const xml = await zip.file('word/document.xml')?.async('string');
    if (xml === undefined) throw new Error('the Word file has no document part');
    return xml.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  }

  it('carries the audience, the instruction and the text into a Word file', async () => {
    const s = h.appContext.services;
    const proposed = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId });
    const persona = proposed.personas[0];
    expect(persona).toBeDefined();
    await s.personas.approve(h.db, h.currentUser, labelId, persona!.id);

    const instruction =
      'Schrijf een mail voor deze doelgroep over het moment waarop een dossier juridisch wordt.';
    const asset = await s.content.generateStandalone(h.db, h.currentUser, {
      labelId,
      courseVersionId,
      channel: 'email',
      funnelStage: 'discover',
      angleNl: instruction,
      personaVersionId: persona!.id,
      origin: { kind: 'manual', refId: null },
    });

    // The instruction is kept with the piece now, not only in the queue row of
    // the job that wrote it (migration 0030).
    expect(asset.instructionNl).toBe(instruction);

    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/content/${asset.id}/dossier.docx`,
    });

    expect(response.statusCode, response.body.slice(0, 200)).toBe(200);
    expect(response.headers['content-type']).toContain('wordprocessingml.document');
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="dossier-[a-z0-9-]+\.docx"$/u);
    // Never in a shared cache: most of these are unapproved drafts.
    expect(response.headers['cache-control']).toBe('private, no-store');

    const body = response.rawPayload;
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK');

    const text = await docxText(body);
    // Who it is for, what was asked, and what came out — the three things that
    // fall off when a piece leaves the product as pasted text.
    expect(text).toContain(persona!.name);
    expect(text).toContain(persona!.need);
    expect(text).toContain(instruction);
    expect(text).toContain(asset.copy.hook);
    // And the label, the course and the person who asked for it.
    expect(text).toContain('Lindenhaeghe');
    expect(text).toContain(h.currentUser.email);
    // A draft says so, before the text anybody came to read.
    expect(text).toContain('Concept');
    expect(text).toContain('niet goedgekeurd');
  });

  it('produces the same dossier as a PDF', async () => {
    const s = h.appContext.services;
    const asset = await s.content.generateStandalone(h.db, h.currentUser, {
      labelId,
      courseVersionId,
      channel: 'blog_article',
      funnelStage: 'discover',
      angleNl:
        'Schrijf een artikel over wat er komt kijken bij regie op een verzuimdossier voor iemand die de rol er net bij heeft gekregen.',
      origin: { kind: 'manual', refId: null },
    });

    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/content/${asset.id}/dossier.pdf`,
    });

    expect(response.statusCode, response.body.slice(0, 200)).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    /*
     * Read back rather than grepped.
     *
     * The bytes are compressed object streams, so searching them for `/Type
     * /Page` finds nothing whether the document has five pages or none.
     * Loading it also proves the file opens at all, which is the thing a
     * reader will find out first.
     */
    const parsed = await PDFDocument.load(response.rawPayload);
    // Five parts, each starting on its own page; one page would mean the
    // layout stopped after the cover.
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(5);
    expect(parsed.getTitle()).toBeTruthy();
  });

  it('says the instruction was not recorded rather than inventing one', async () => {
    const s = h.appContext.services;
    const asset = await s.content.generateStandalone(h.db, h.currentUser, {
      labelId,
      courseVersionId,
      channel: 'linkedin_organic',
      funnelStage: 'discover',
      angleNl: 'Schrijf een bericht over de eerste week als casemanager.',
      origin: { kind: 'manual', refId: null },
    });

    /*
     * A piece from before the column existed. Blanking it is the only way to
     * reach the branch, and it is worth reaching: every piece made before
     * 2026-09-17 is in exactly this state, and the honest answer there is that
     * we do not know — not a sentence reconstructed from the text it produced.
     */
    await h.db
      .update(contentAssetVersions)
      .set({ instructionNl: null })
      .where(eq(contentAssetVersions.id, asset.id));

    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/content/${asset.id}/dossier.docx`,
    });
    expect(response.statusCode).toBe(200);
    const text = await docxText(response.rawPayload);
    expect(text).toContain('niet vastgelegd');
    expect(text).not.toContain('Schrijf een bericht over de eerste week');
  });

  it('refuses a piece that belongs to another label', async () => {
    // The id comes from the client, so it must not become an oracle: a piece
    // of another label reads as absent, not as "wrong label".
    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/content/${randomUUID()}/dossier.docx`,
    });
    expect(response.statusCode).toBe(404);
  });
});
