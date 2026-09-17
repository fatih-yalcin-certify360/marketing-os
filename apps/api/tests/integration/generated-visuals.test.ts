import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { eq } from 'drizzle-orm';
import { createCampaignInput, type ContentProposalSet } from '@c360/contracts';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';
import { VisualGenerationService } from '../../src/core/ai/visuals.js';
import type { AiProvider, ImageGenerationAdapter } from '../../src/core/ai/types.js';
import { ImageRenderer } from '../../src/core/render/renderer.js';
import { ContentAssetService } from '../../src/modules/content-assets/service.js';
import { jobs, usageRecords } from '../../src/core/db/schema.js';

/*
 * These tests render real PNGs through the layout engine — several per case, at
 * 1536x1024 — and that is CPU-bound work. The first case takes ~10 s with the
 * machine to itself and 31-34 s while the other 87 test files compete for the
 * same cores, which is past both Vitest's 5 s default and the root config's
 * 30 s. The timeout then read as a logic error: the timed-out case left the
 * content at an older version, so the four revision cases behind it failed on
 * `conflict` instead of on what they assert, and repo-wide verify went red with
 * six failures in a file that passes 11/11 on its own.
 *
 * The budget is for the renderer under load, not for slow code — a real hang
 * still fails, two minutes later. Declared here rather than in the root config
 * so it also holds when the file is run from `apps/api` (2026-09-16).
 */
describe('generated visuals in the content flow', { timeout: 120_000 }, () => {
  let h: TestHarness;
  let root: string;
  let labelId: string;
  let campaignId: string;
  let visuals: VisualGenerationService;
  const png = Buffer.from(new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="orange"/></svg>').render().asPng());
  const generateImage = vi.fn<ImageGenerationAdapter['generateImage']>(() => Promise.resolve({ png, usage: { inputTokens: 10, outputTokens: 20, latencyMs: 1, actualCostCents: 2 } }));
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'c360-visual-'));
    h = await createTestHarness({ envOverrides: { STORAGE_ROOT: root } });
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const provider: AiProvider = { name: 'test', isMock: true, text: () => undefined, research: () => undefined, image: () => ({
      provider: 'test-image', model: 'test', isMock: true, generateImage,
      requestDimensions: () => ({ widthPx: 1536, heightPx: 1024 }),
    }) };
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
    campaignId = campaign.id;
    const reference = await s.uploads.accept(db, user, { labelId, purpose: 'visual_reference', filename: 'reference.png', bytes: png });
    const referenceResponse = await h.app.inject({ method: 'PATCH', url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/visual-references`, payload: { assetIds: [reference.id] } });
    expect(referenceResponse.statusCode).toBe(200);

    const brief = await s.campaigns.draftBrief(db, user, { labelId, campaignId, personaVersionIds });
    await s.campaigns.approveBrief(db, user, labelId, campaignId, brief.id, null);
    const proposedConcepts = await s.concepts.propose(db, user, { labelId, campaignId });
    await s.concepts.select(db, user, labelId, campaignId, proposedConcepts.concepts[0]!.id);
    await s.concepts.proposePlan(db, user, { labelId, campaignId });
    const latestPlan = (await s.concepts.latestPlan(db, campaignId))!.plan;
    const instagram = latestPlan.items.some(item => item.channel === 'instagram_organic') ? []
      : latestPlan.items.filter(item => item.channel === 'linkedin_organic').slice(0, 1).map(item => ({ ...item, channel: 'instagram_organic' as const, withImage: true }));
    await s.concepts.approvePlan(db, user, labelId, campaignId, { ...latestPlan, items: [...latestPlan.items, ...instagram] });
    const content = new ContentAssetService(s.generation, new ImageRenderer(root), s.brand, s.courses, s.personas, s.campaigns, s.concepts, s.approvals, visuals);
    const result = await content.generate(db, user, { labelId, campaignId });
    const brand = await s.brand.requireCurrent(db, labelId);
    const withImages = result.assets.filter(a => a.variants.length > 0);
    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ references: [{ bytes: png, mimeType: 'image/png' }] }));
    expect(proposedConcepts.concepts.map(c => c.artDirection?.medium).sort()).toEqual(['conceptual', 'documentary', 'illustration']);
    expect(withImages.length).toBeGreaterThan(0);
    expect(generateImage).toHaveBeenCalledTimes(withImages.length);
    for (const asset of withImages) {
      expect(asset.variants).toHaveLength(2);
      expect(asset.variants[0]!.spec.backgroundAssetId).toBeTruthy();
      expect(asset.variants[0]!.spec.backgroundAssetId).toBe(asset.variants[1]!.spec.backgroundAssetId);
      const spec = asset.variants[0]!.spec;
      expect(spec.creativeBrief).toBeTruthy();
      expect(spec.creativeResearch?.campaignId).toBe(campaignId);
      expect([...(spec.creativeResearch?.personaVersionIds ?? [])].sort()).toEqual([...personaVersionIds].sort());
      expect(spec.creativeBrief!.personaVersionIds.every(id => personaVersionIds.includes(id))).toBe(true);
      expect(spec.creativeBrief!.evidenceIds.length).toBeGreaterThan(0);
      expect(spec.creativeBrief!.evidenceIds.every(id => spec.creativeResearch!.sources.some(source => source.id === id))).toBe(true);
      expect(spec.colorResolution?.panel.contrastRatio).toBeGreaterThanOrEqual(4.5);
      expect(spec.colorResolution?.footer.contrastRatio).toBeGreaterThanOrEqual(4.5);
      expect(spec.creativeBrief).toEqual(asset.variants[1]!.spec.creativeBrief);
      expect(spec.headingFamily).toBe(brand.typography.headingFamily);
      expect(spec.bodyFamily).toBe(brand.typography.bodyFamily);
      expect(spec.colors).toEqual({
        background: brand.colors.primary, foreground: brand.colors.onPrimary,
        accent: brand.colors.accent, surface: brand.colors.surface, onSurface: brand.colors.onSurface,
      });
      const request = generateImage.mock.calls.find(([input]) => input.prompt.includes(asset.channel) && input.prompt.includes(spec.creativeBrief!.scene))?.[0];
      expect(request, `image request for ${asset.channel}`).toBeDefined();
      expect(request!.widthPx).toBe(spec.widthPx);
      expect(request!.heightPx).toBe(spec.heightPx);
      expect(request!.prompt).toContain(spec.creativeBrief!.composition);
      expect(request!.prompt).toContain(spec.creativeBrief!.audienceInsight);
      expect(request!.prompt).toContain(spec.creativeBrief!.brandIntegration);
      expect(request!.prompt).toContain(spec.creativeBrief!.channelRationale);
      expect(request!.prompt).toContain(spec.creativeResearch!.visualAnchor);
      expect(request!.prompt).toContain(brand.colors.primary);
      expect(request!.prompt).toContain(brand.colors.accent);
      expect(request!.prompt).toMatch(/no lettering/iu);
      expect(request!.prompt).toMatch(/reserv|negative space/iu);
      expect(request!.prompt).toContain('NATIVE GENERATION CANVAS: 1536 × 1024');
      const sourceMapJson = /SOURCE PIXEL MAP: (.+?)\. Keep/u.exec(request!.prompt)?.[1];
      expect(sourceMapJson).toBeDefined();
      const sourceMap = JSON.parse(sourceMapJson!) as Record<'crop' | 'text' | 'footer', { x: number; y: number; width: number; height: number }>;
      expect(sourceMap.crop.width / sourceMap.crop.height).toBeCloseTo(spec.widthPx / spec.heightPx, 6);
      expect(sourceMap.crop.x > 0 || sourceMap.crop.y > 0).toBe(true);
      for (const rectangle of [sourceMap.text, sourceMap.footer]) {
        expect(rectangle.x).toBeGreaterThanOrEqual(sourceMap.crop.x);
        expect(rectangle.y).toBeGreaterThanOrEqual(sourceMap.crop.y);
        expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(sourceMap.crop.x + sourceMap.crop.width + 0.001);
        expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(sourceMap.crop.y + sourceMap.crop.height + 0.001);
      }
      // The exact creative rationale is part of the stored asset, not just
      // an ephemeral image-provider instruction.
      const reread = await content.requireById(db, labelId, asset.id);
      expect(reread.variants[0]!.spec.creativeBrief).toEqual(spec.creativeBrief);
    }
    const first = withImages[0]!;
    expect(new Set(withImages.map(asset => asset.variants[0]!.spec.creativeResearch!.id)).size).toBe(1);
    expect(new Set(withImages.map(asset => asset.variants[0]!.spec.creativeBrief!.channelRationale)).size).toBeGreaterThan(1);
    const edited = await content.editCopy(db, user, labelId, first.id, { expectedVersion: first.version, copy: { hook: 'Een aangepaste opening' } });
    expect(edited.variants[0]!.spec.backgroundAssetId).toBe(first.variants[0]!.spec.backgroundAssetId);
    expect(edited.variants.map(variant => variant.spec)).toEqual(first.variants.map(variant => variant.spec));
    expect(generateImage).toHaveBeenCalledTimes(withImages.length);
    const usage = await db.select().from(usageRecords).where(eq(usageRecords.kind, 'ai_image'));
    expect(usage).toHaveLength(withImages.length);
    await expect(visuals.load(db, user, labelIdBySlug(h.seed, 'demolabel-3'), first.variants[0]!.spec.backgroundAssetId!)).rejects.toMatchObject({ code: 'not_found' });
    const realTextGeneration = s.generation.generate.bind(s.generation);
    const textSpy = vi.spyOn(s.generation, 'generate');
    try {
      await content.assertRevisable(db, user, labelId, edited.id, { expectedVersion: edited.version, scope: 'images' });
      const revised = await content.revise(db, user, labelId, edited.id, { expectedVersion: edited.version, scope: 'images', instructionNl: 'Gebruik een verrassende fysieke metafoor met papier.' });
      expect(revised.copy).toEqual(edited.copy);
      expect(revised.editedByUserId).toBe(edited.editedByUserId);
      expect(revised.variants[0]!.spec.backgroundAssetId).not.toBe(edited.variants[0]!.spec.backgroundAssetId);
      expect(revised.variants[0]!.spec.creativeBrief).toEqual(edited.variants[0]!.spec.creativeBrief);
      expect(revised.variants[0]!.spec.creativeResearch).toEqual(edited.variants[0]!.spec.creativeResearch);
      expect(revised.variants[0]!.spec.headline).toBe(edited.variants[0]!.spec.headline);
      expect(revised.variants[0]!.spec.subline).toBe(edited.variants[0]!.spec.subline);
      expect(revised.variants[0]!.spec.ctaText).toBe(edited.variants[0]!.spec.ctaText);
      const revisionPrompt = generateImage.mock.calls.at(-1)![0].prompt;
      expect(revisionPrompt).toContain('Gebruik een verrassende fysieke metafoor met papier.');
      expect(revisionPrompt).toContain(edited.variants[0]!.spec.creativeBrief!.scene);
      expect(revisionPrompt).toContain(brand.colors.primary);
      expect(revisionPrompt).toMatch(/no lettering/iu);
      expect(textSpy).not.toHaveBeenCalled();

      const imagesBeforeCopyRevision = generateImage.mock.calls.length;
      textSpy.mockImplementationOnce(async (db, request) => {
        const result = await realTextGeneration(db, request);
        const value = result.value as ContentProposalSet;
        return {
          ...result,
          value: {
            items: value.items.map(item => ({
              ...item,
              imageSubline: 'Een andere beeldtekst die een tekstherziening niet mag vervangen.',
              creativeBrief: {
                ...revised.variants[0]!.spec.creativeBrief!,
                scene: 'Een volledig andere, niet goedgekeurde scène voor een nieuwe campagne.',
              },
            })),
          },
        };
      });
      const copyOnly = await content.revise(db, user, labelId, revised.id, {
        expectedVersion: revised.version, scope: 'copy',
        instructionNl: 'Maak de begeleidende tekst persoonlijker.', acceptOverwritingUserEdit: true,
      });
      expect(generateImage).toHaveBeenCalledTimes(imagesBeforeCopyRevision);
      expect(copyOnly.copy.body).not.toBe(revised.copy.body);
      expect(copyOnly.variants[0]!.spec.creativeBrief).toEqual(revised.variants[0]!.spec.creativeBrief);
      expect(copyOnly.variants[0]!.spec.creativeResearch).toEqual(revised.variants[0]!.spec.creativeResearch);
      expect(copyOnly.variants[0]!.spec.backgroundAssetId).toBe(revised.variants[0]!.spec.backgroundAssetId);
      expect(copyOnly.variants[0]!.spec.headline).toBe(revised.variants[0]!.spec.headline);
      expect(copyOnly.variants[0]!.spec.subline).toBe(revised.variants[0]!.spec.subline);
    } finally { textSpy.mockRestore(); }
    const anotherLabel = labelIdBySlug(h.seed, 'demolabel-3');
    const wrong = await s.uploads.accept(db, user, { labelId: anotherLabel, purpose: 'visual_reference', filename: 'other.png', bytes: png });
    const denied = await h.app.inject({ method: 'PATCH', url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/visual-references`, payload: { assetIds: [wrong.id] } });
    expect(denied.statusCode).toBe(400);

  });

  it('repairs a missing social creative brief before rendering and saves the repaired direction', async () => {
    const s = h.appContext.services;
    const real = s.generation.generate.bind(s.generation);
    let removed = false;
    let repairNotes: readonly string[] = [];
    const spy = vi.spyOn(s.generation, 'generate').mockImplementation(async (db, request) => {
      const result = await real(db, request);
      if (request.template !== 'content.generate') return result;
      if (request.context.repairNotes?.length) repairNotes = request.context.repairNotes;
      const value = result.value as ContentProposalSet;
      const social = value.items.find(item => item.creativeBrief !== null);
      if (removed || !social) return result;
      removed = true;
      return { ...result, value: { items: value.items.map(item => item.channel === social.channel ? { ...item, creativeBrief: null } : item) } };
    });
    try {
      const generated = await s.content.generate(h.db, h.currentUser, { labelId, campaignId });
      expect(removed).toBe(true);
      expect(repairNotes.join(' ')).toMatch(/creati/iu);
      const social = generated.assets.filter(asset => asset.variants.length > 0);
      expect(social.length).toBeGreaterThan(0);
      expect(social.every(asset => asset.variants.every(variant => variant.spec.creativeBrief))).toBe(true);
    } finally { spy.mockRestore(); }
  });

  it('refuses a social image without a creative brief when the single repair also fails', async () => {
    const s = h.appContext.services;
    const before = await s.content.list(h.db, h.currentUser, labelId, campaignId);
    const real = s.generation.generate.bind(s.generation);
    let contentCalls = 0;
    const spy = vi.spyOn(s.generation, 'generate').mockImplementation(async (db, request) => {
      const result = await real(db, request);
      if (request.template !== 'content.generate') return result;
      const value = result.value as ContentProposalSet;
      if (value.items.some(item => ['linkedin_organic', 'instagram_organic', 'facebook_organic'].includes(item.channel))) contentCalls += 1;
      return { ...result, value: { items: value.items.map(item => ({ ...item, creativeBrief: null })) } };
    });
    try {
      await expect(s.content.generate(h.db, h.currentUser, { labelId, campaignId })).rejects.toMatchObject({ code: 'provider_invalid_output' });
      expect(contentCalls).toBe(2);
      const after = await s.content.list(h.db, h.currentUser, labelId, campaignId);
      // A preceding text-only batch may have succeeded; no incomplete image
      // batch is persisted when its direction still fails after repair.
      expect(after.filter(asset => asset.variants.length > 0).map(asset => asset.id).sort())
        .toEqual(before.filter(asset => asset.variants.length > 0).map(asset => asset.id).sort());
    } finally { spy.mockRestore(); }
  });

  it.each(['missing_direction', 'wrong_channel', 'wrong_stage', 'extra_item'] as const)('keeps the existing image when a full revision returns %s', async (failure) => {
    const s = h.appContext.services;
    const content = new ContentAssetService(s.generation, new ImageRenderer(root), s.brand, s.courses, s.personas, s.campaigns, s.concepts, s.approvals, visuals);
    const current = (await content.list(h.db, h.currentUser, labelId, campaignId)).find(asset => asset.variants.length > 0)!;
    const beforeCalls = generateImage.mock.calls.length;
    const real = s.generation.generate.bind(s.generation);
    const spy = vi.spyOn(s.generation, 'generate').mockImplementation(async (db, request) => {
      const result = await real(db, request);
      if (request.template !== 'content.revise') return result;
      const value = result.value as ContentProposalSet;
      const items = value.items.map(item => ({
        ...item, creativeBrief: failure === 'missing_direction' || failure === 'wrong_channel' ? null : item.creativeBrief,
        channel: failure === 'wrong_channel' ? 'google_ads' as const : item.channel,
        stage: failure === 'wrong_stage' ? (item.stage === 'discover' ? 'decide' as const : 'discover' as const) : item.stage,
      }));
      return { ...result, value: { items: failure === 'extra_item' ? [...items, items[0]!] : items } };
    });
    try {
      await expect(content.revise(h.db, h.currentUser, labelId, current.id, {
        expectedVersion: current.version, scope: 'both', instructionNl: 'Werk het beeld en de tekst verder uit.',
      })).rejects.toMatchObject({ code: 'provider_invalid_output' });
      expect(generateImage).toHaveBeenCalledTimes(beforeCalls);
      const latest = (await content.list(h.db, h.currentUser, labelId, campaignId)).find(asset => asset.assetKey === current.assetKey);
      expect(latest).toEqual(current);
    } finally { spy.mockRestore(); }
  });

  it('selects readable CS brand pairs and refuses an impossible palette before buying an image', async () => {
    const s = h.appContext.services;
    const content = new ContentAssetService(s.generation, new ImageRenderer(root), s.brand, s.courses, s.personas, s.campaigns, s.concepts, s.approvals, visuals);
    const current = (await content.list(h.db, h.currentUser, labelId, campaignId)).find(asset => asset.variants.length > 0)!;
    const originalBrand = await s.brand.requireCurrent(h.db, labelId);
    const spy = vi.spyOn(s.brand, 'requireCurrent').mockResolvedValue({ ...originalBrand, colors: {
      primary: '#00A894', onPrimary: '#ffffff', surface: '#f3edeb', onSurface: '#203E58', accent: '#A61955',
    } });
    try {
      const revised = await content.revise(h.db, h.currentUser, labelId, current.id, {
        expectedVersion: current.version, scope: 'images', instructionNl: 'Houd het campagnebeeld herkenbaar.',
      });
      for (const variant of revised.variants) {
        expect(variant.spec.colorResolution!.panel.contrastRatio).toBeGreaterThanOrEqual(4.5);
        expect(variant.spec.colorResolution!.footer.contrastRatio).toBeGreaterThanOrEqual(4.5);
      }
      spy.mockResolvedValue({ ...originalBrand, colors: {
        primary: '#888888', onPrimary: '#888888', surface: '#888888', onSurface: '#888888', accent: '#888888',
      } });
      const calls = generateImage.mock.calls.length;
      await expect(content.revise(h.db, h.currentUser, labelId, revised.id, {
        expectedVersion: revised.version, scope: 'images', instructionNl: 'Controleer de kleuren voordat er een beeld wordt gemaakt.',
      })).rejects.toMatchObject({ code: 'bad_request' });
      expect(generateImage).toHaveBeenCalledTimes(calls);
    } finally { spy.mockRestore(); }
  });

  it('repairs fabricated creative citations before any visual is stored', async () => {
    const s = h.appContext.services;
    const real = s.generation.generate.bind(s.generation);
    let changed = false;
    let repaired = false;
    const spy = vi.spyOn(s.generation, 'generate').mockImplementation(async (db, request) => {
      const result = await real(db, request);
      if (request.template !== 'content.generate' || !request.context.creativeResearch) return result;
      if (changed) { repaired ||= (request.context.repairNotes ?? []).some(note => note.includes('evidenceIds')); return result; }
      changed = true;
      const value = result.value as ContentProposalSet;
      return { ...result, value: { items: value.items.map(item => ({ ...item, creativeBrief: item.creativeBrief ? { ...item.creativeBrief, evidenceIds: ['invented-source'] } : null })) } };
    });
    try {
      const result = await s.content.generate(h.db, h.currentUser, { labelId, campaignId });
      expect(changed && repaired).toBe(true);
      for (const asset of result.assets) for (const variant of asset.variants) expect(variant.spec.creativeBrief?.evidenceIds).not.toContain('invented-source');
    } finally { spy.mockRestore(); }
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
