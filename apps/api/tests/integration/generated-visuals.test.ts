import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { eq } from 'drizzle-orm';
import { createCampaignInput } from '@c360/contracts';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';
import { VisualGenerationService } from '../../src/core/ai/visuals.js';
import type { AiProvider } from '../../src/core/ai/types.js';
import { ImageRenderer } from '../../src/core/render/renderer.js';
import { ContentAssetService } from '../../src/modules/content-assets/service.js';
import { jobs, usageRecords } from '../../src/core/db/schema.js';

describe('generated visuals in the content flow', () => {
  let h: TestHarness;
  let root: string;
  let labelId: string;
  let visuals: VisualGenerationService;
  const png = Buffer.from(new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="orange"/></svg>').render().asPng());
  const generateImage = vi.fn(() => Promise.resolve({ png, usage: { inputTokens: 10, outputTokens: 20, latencyMs: 1, actualCostCents: 2 } }));
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'c360-visual-'));
    h = await createTestHarness({ envOverrides: { STORAGE_ROOT: root } });
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const provider: AiProvider = { name: 'test', isMock: true, text: () => undefined, research: () => undefined, image: () => ({ provider: 'test-image', model: 'test', isMock: true, generateImage }) };
    visuals = new VisualGenerationService(provider, { ...h.env, AI_IMAGE_ENABLED: true, STORAGE_ROOT: root });
  });
  afterAll(async () => { await h.close(); await rm(root, { recursive: true, force: true }); });

  it('generates one original per image channel, renders A/B and reuses it for a copy edit', async () => {
    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    const courseVersionId = h.seed.pilot.courseVersionId!;
    const proposed = await s.personas.propose(db, user, { labelId, courseVersionId });
    const personaVersionIds = proposed.personas.map(p => p.id);
    for (const id of personaVersionIds) await s.personas.approve(db, user, labelId, id);
    const campaign = await s.campaigns.create(db, user, labelId, createCampaignInput.parse({ name: 'Visual test', entryMode: 'discover_opportunities', courseVersionId }));
    const campaignId = campaign.id;
    const reference = await s.uploads.accept(db, user, { labelId, purpose: 'visual_reference', filename: 'reference.png', bytes: png });
    const referenceResponse = await h.app.inject({ method: 'PATCH', url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/visual-references`, payload: { assetIds: [reference.id] } });
    expect(referenceResponse.statusCode).toBe(200);

    const brief = await s.campaigns.draftBrief(db, user, { labelId, campaignId, personaVersionIds });
    await s.campaigns.approveBrief(db, user, labelId, campaignId, brief.id, null);
    const proposedConcepts = await s.concepts.propose(db, user, { labelId, campaignId });
    await s.concepts.select(db, user, labelId, campaignId, proposedConcepts.concepts[0]!.id);
    await s.concepts.proposePlan(db, user, { labelId, campaignId });
    await s.concepts.approvePlan(db, user, labelId, campaignId, null);
    const content = new ContentAssetService(s.generation, new ImageRenderer(root), s.brand, s.courses, s.personas, s.campaigns, s.concepts, s.approvals, visuals);
    const result = await content.generate(db, user, { labelId, campaignId });
    const withImages = result.assets.filter(a => a.variants.length > 0);
    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ references: [{ bytes: png, mimeType: 'image/png' }] }));
    expect(proposedConcepts.concepts.map(c => c.artDirection?.medium).sort()).toEqual(['conceptual', 'documentary', 'illustration']);
    expect(withImages.length).toBeGreaterThan(0);
    expect(generateImage).toHaveBeenCalledTimes(withImages.length);
    for (const asset of withImages) {
      expect(asset.variants).toHaveLength(2);
      expect(asset.variants[0]!.spec.backgroundAssetId).toBeTruthy();
      expect(asset.variants[0]!.spec.backgroundAssetId).toBe(asset.variants[1]!.spec.backgroundAssetId);
    }
    const first = withImages[0]!;
    const edited = await content.editCopy(db, user, labelId, first.id, { expectedVersion: first.version, copy: { hook: 'Een aangepaste opening' } });
    expect(edited.variants[0]!.spec.backgroundAssetId).toBe(first.variants[0]!.spec.backgroundAssetId);
    expect(generateImage).toHaveBeenCalledTimes(withImages.length);
    const usage = await db.select().from(usageRecords).where(eq(usageRecords.kind, 'ai_image'));
    expect(usage).toHaveLength(withImages.length);
    await expect(visuals.load(db, user, labelIdBySlug(h.seed, 'demolabel-3'), first.variants[0]!.spec.backgroundAssetId!)).rejects.toMatchObject({ code: 'not_found' });
    const textSpy = vi.spyOn(s.generation, 'generate');
    try {
      await content.assertRevisable(db, user, labelId, edited.id, { expectedVersion: edited.version, scope: 'images' });
      const revised = await content.revise(db, user, labelId, edited.id, { expectedVersion: edited.version, scope: 'images', instructionNl: 'Gebruik een verrassende fysieke metafoor met papier.' });
      expect(revised.copy).toEqual(edited.copy);
      expect(revised.editedByUserId).toBe(edited.editedByUserId);
      expect(revised.variants[0]!.spec.backgroundAssetId).not.toBe(edited.variants[0]!.spec.backgroundAssetId);
      expect(textSpy).not.toHaveBeenCalled();
    } finally { textSpy.mockRestore(); }
    const anotherLabel = labelIdBySlug(h.seed, 'demolabel-3');
    const wrong = await s.uploads.accept(db, user, { labelId: anotherLabel, purpose: 'visual_reference', filename: 'other.png', bytes: png });
    const denied = await h.app.inject({ method: 'PATCH', url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/visual-references`, payload: { assetIds: [wrong.id] } });
    expect(denied.statusCode).toBe(400);

  });

  it('reuses a saved original on a job retry and accounts separately for different prompts', async () => {
    const [job] = await h.db.insert(jobs).values({ organizationId: h.currentUser.organizationId, labelId, type: 'content.generate', idempotencyKey: 'visual-retry-test', createdByUserId: h.currentUser.userId }).returning();
    const input = { labelId, jobId: job!.id, prompt: 'First scene', widthPx: 64, heightPx: 64 };
    const calls = generateImage.mock.calls.length;
    const first = await visuals.generate(h.db, h.currentUser, { ...input, attempt: 1 });
    const replay = await visuals.generate(h.db, h.currentUser, { ...input, attempt: 2 });
    expect(replay.assetId).toBe(first.assetId);
    expect(generateImage.mock.calls.length).toBe(calls + 1);
    const second = await visuals.generate(h.db, h.currentUser, { ...input, attempt: 1, prompt: 'Another scene' });
    expect(second.assetId).not.toBe(first.assetId);
    const rows = await h.db.select().from(usageRecords).where(eq(usageRecords.jobId, job!.id));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(row => row.unitKey)).size).toBe(2);
  });

  it('records paid invalid output and refuses to save it', async () => {
    generateImage.mockResolvedValueOnce({ png: Buffer.from('invalid'), usage: { inputTokens: 1, outputTokens: 1, latencyMs: 1, actualCostCents: 2 } });
    const before = await h.db.select().from(usageRecords).where(eq(usageRecords.kind, 'ai_image'));
    await expect(visuals.generate(h.db, h.currentUser, { labelId, prompt: 'Invalid response test', widthPx: 64, heightPx: 64 })).rejects.toMatchObject({ code: 'provider_invalid_output' });
    const after = await h.db.select().from(usageRecords).where(eq(usageRecords.kind, 'ai_image'));
    expect(after.length).toBe(before.length + 1);
  });
});
