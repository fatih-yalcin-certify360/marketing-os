import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { eq } from 'drizzle-orm';
import { createCampaignInput, type PackagePreview, type PackageReadiness } from '@c360/contracts';
import { brandProfileVersions, briefVersions, courseVersions } from '../../src/core/db/schema.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * The Website & interactief branch as a showcase can rely on (2026-09-15):
 * the readiness checklist names the closed gates, the keuzehulp is a quiz
 * with outcomes, and the produced pages come back as inline HTML for the
 * in-app preview.
 */
describe('the package branch: readiness, quiz and preview', () => {
  let h: TestHarness;
  let labelId: string;
  let campaignId: string;
  let courseVersionId: string;
  let base: string;

  beforeAll(async () => {
    h = await createTestHarness();
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    courseVersionId = h.seed.pilot.courseVersionId!;
    const s = h.appContext.services;
    const brand = await s.brand.requireApproved(h.db, labelId);
    await h.db.update(brandProfileVersions).set({ typography: { headingFamily: 'Arial', bodyFamily: 'Arial', licenceNote: null } }).where(eq(brandProfileVersions.id, brand.id));
    const campaign = await s.campaigns.create(h.db, h.currentUser, labelId, createCampaignInput.parse({
      name: 'Quiz-pakket (Demo)',
      entryMode: 'start_from_briefing',
      // Full funnel: the mock proposes the blog for Overwegen and the keuzehulp for Beslissen.
      objective: 'full_funnel',
      courseVersionId,
      suppliedBrief: 'Help oriënterende professionals met een keuzehulp bepalen of regie op verzuim bij hun overstap past.',
    }));
    campaignId = campaign.id;
    base = `/api/v1/labels/${labelId}/campaigns/${campaignId}/packages`;
  });

  afterAll(async () => {
    await h.close();
  });

  const readiness = async (): Promise<PackageReadiness> => {
    const response = await h.app.inject({ method: 'GET', url: base });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ readiness: PackageReadiness }>().readiness;
  };

  it('names every closed gate before anything is approved, and opens them one by one', async () => {
    const s = h.appContext.services;
    const before = await readiness();
    expect(before.ok).toBe(false);
    expect(before.checks.find((check) => check.id === 'brief')).toMatchObject({ ok: false });
    expect(before.checks.find((check) => check.id === 'course')).toMatchObject({ ok: false });
    expect(before.checks.find((check) => check.id === 'brief')?.hintNl).toMatch(/stap 3/u);

    await h.db.update(courseVersions).set({ reviewState: 'approved' }).where(eq(courseVersions.id, courseVersionId));
    const personas = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId });
    for (const persona of personas.personas) await s.personas.approve(h.db, h.currentUser, labelId, persona.id);
    const brief = await s.campaigns.draftBrief(h.db, h.currentUser, { labelId, campaignId, personaVersionIds: personas.personas.map((persona) => persona.id) });
    // The briefing promises a keuzehulp; the checklist says so until one exists.
    await h.db.update(briefVersions).set({ cta: 'Bekijk de keuzehulp: past regie op verzuim bij jou?', ctaUrl: 'https://example.org/course' }).where(eq(briefVersions.id, brief.id));
    await s.campaigns.approveBrief(h.db, h.currentUser, labelId, campaignId, brief.id, null);

    const after = await readiness();
    expect(after.ok).toBe(true);
    expect(after.checks.every((check) => check.ok)).toBe(true);
    expect(after.destination).toBe('https://example.org/course');
    expect(after.interactivePromised).toBe(true);
  });

  it('builds the keuzehulp as a quiz with outcomes and serves it as an inline preview', async () => {
    const s = h.appContext.services;
    const recommend = await h.app.inject({ method: 'POST', url: base, payload: { mode: 'recommend', selected: [] } });
    expect(recommend.statusCode, recommend.body).toBe(202);
    await s.campaignPackages.generate(h.db, h.currentUser, { labelId, campaignId, jobId: recommend.json<{ id: string }>().id, attempt: 1, mode: 'recommend', selected: [] });

    const queued = await h.app.inject({ method: 'POST', url: base, payload: { mode: 'generate', interactionStyle: 'scenario', selected: ['fit_check', 'blog_faq'] } });
    expect(queued.statusCode, queued.body).toBe(202);
    const saved = await s.campaignPackages.generate(h.db, h.currentUser, { labelId, campaignId, jobId: queued.json<{ id: string }>().id, attempt: 1, mode: 'generate', interactionStyle: 'scenario', selected: ['fit_check', 'blog_faq'] });

    const file = await h.app.inject({ method: 'GET', url: `${base}/${saved.id}/file` });
    expect(file.statusCode).toBe(200);
    const zip = await JSZip.loadAsync(file.rawPayload);
    const page = await zip.file('keuzehulp/index.html')!.async('string');
    const script = await zip.file('keuzehulp/widget.js')!.async('string');
    expect(page).toContain('<div id="quiz"');
    expect(script).toContain('"outcomes":{"fit"');
    expect(script).toContain('utm_source=keuzehulp');
    expect(zip.file('keuzehulp/embed.html')).not.toBeNull();
    // The brand's colours are appended to the quiz stylesheet as before.
    const brand = await s.brand.requireApproved(h.db, labelId);
    expect(await zip.file('keuzehulp/style.css')!.async('string')).toContain(brand.colors.primary);

    const preview = await h.app.inject({ method: 'GET', url: `${base}/${saved.id}/preview` });
    expect(preview.statusCode, preview.body).toBe(200);
    const body = preview.json<PackagePreview>();
    expect(body.parts.map((part) => part.id)).toEqual(['keuzehulp', 'blog']);
    const quiz = body.parts[0]!.html;
    expect(quiz).toContain('<style>');
    expect(quiz).toContain('<script>');
    expect(quiz).not.toContain('href="style.css"');
    expect(quiz).not.toContain('src="widget.js"');
    expect(quiz).not.toMatch(/@font-face/u);
    expect(body.embedHtml).toContain('<iframe');
    expect(body.stale).toBe(false);

    // With a quiz in place the promise is kept; the checklist still reports it.
    const state = await readiness();
    expect(state.interactivePromised).toBe(true);

    // Another label sees nothing.
    const other = labelIdBySlug(h.seed, 'demolabel-3');
    expect((await h.app.inject({ method: 'GET', url: `${base.replace(labelId, other)}/${saved.id}/preview` })).statusCode).toBe(404);
  });

  it('gives a briefing without a link the course page as destination', async () => {
    const s = h.appContext.services;
    // The seeded course has no page; give it one, so a briefing whose model
    // answer carries no link falls back to it.
    await h.db.update(courseVersions).set({ courseUrl: 'https://example.org/opleiding' }).where(eq(courseVersions.id, courseVersionId));
    const course = await s.courses.requireVersion(h.db, labelId, courseVersionId);
    expect(course.courseUrl).toBe('https://example.org/opleiding');
    const fresh = await s.campaigns.create(h.db, h.currentUser, labelId, createCampaignInput.parse({
      name: 'CTA-bestemming (Demo)',
      entryMode: 'start_from_briefing',
      objective: 'consideration',
      courseVersionId,
      suppliedBrief: 'Laat professionals de opleiding vergelijken en bekijken.',
    }));
    const personas = await s.personas.listForCourse(h.db, h.currentUser, labelId, courseVersionId, undefined, 'library');
    const drafted = await s.campaigns.draftBrief(h.db, h.currentUser, { labelId, campaignId: fresh.id, personaVersionIds: personas.slice(0, 1).map((persona) => persona.id) });
    expect(drafted.ctaUrl).toBe(course.courseUrl);
  });
});
