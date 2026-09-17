import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { courseInput, type RadarCard, type RadarReport } from '@c360/contracts';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';
import { courseVersions, radarRuns, researchFindings, researchRuns, sources, usageRecords } from '../../src/core/db/schema.js';
import { prepareCreativeResearch, type PrepareCreativeResearchInput } from '../../src/modules/content-assets/creative-research.js';

const now = new Date('2026-09-14T12:00:00.000Z');
const quote = 'Adviseurs bespreken praktijkvragen over hun volgende professionele stap.';
const card = (url: string): RadarCard => ({
  id: randomUUID(), sourceUrl: url, organization: 'Vakorganisatie', relationship: 'authority',
  relationshipReason: 'De bron bespreekt de professionele doelgroep.', title: 'Praktijkvragen van adviseurs',
  observation: 'De doelgroep bespreekt concrete praktijkvragen.', excerpt: quote,
  relevance: 'Een herkenbare werksituatie kan een creatieve aanleiding zijn.', publishedDate: null, dateExcerpt: null,
  period: null, uncertainty: 'Geen bewijs van voorkeuren van alle deelnemers.',
  approaches: [0, 1, 2].map(index => ({ title: `Richting ${String(index)}`, format: 'Social post', idea: 'Maak een herkenbare werksituatie bespreekbaar.', audience: 'Professionals' })),
  retrievedAt: '2026-09-12T09:00:00.000Z', contentHash: 'a'.repeat(64), imageUrl: null,
  materialType: 'web_page', change: 'first_seen',
});
const report = (cards: RadarCard[], isMock = false): RadarReport => ({
  cards, isMock, keywords: null, package: null, audience: null, advertising: null,
  notes: [], failures: [], insights: [], digest: null, claims: [],
});

describe('creative research provenance and reuse', () => {
  let h: TestHarness;
  let input: PrepareCreativeResearchInput;
  beforeEach(async () => {
    h = await createTestHarness();
    const labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const course = await h.appContext.services.courses.requireVersion(h.db, labelId, h.seed.pilot.courseVersionId!);
    const brandProfile = await h.appContext.services.brand.requireCurrent(h.db, labelId);
    const campaignId = randomUUID();
    input = {
      labelId, campaign: { id: campaignId, labelId, courseVersionId: course.id, radarRunId: null },
      brief: { id: randomUUID(), campaignId, evidence: [], channelRoles: [] },
      concept: { id: randomUUID(), campaignId, coreIdea: 'Dezelfde onverwachte praktijkvraag verbindt de hele campagne.',
        visualApproach: 'Een fysieke papieren splitsing staat centraal, met dezelfde hoofdpersoon en merkstijl.',
        artDirection: { medium: 'conceptual', scene: 'Een papieren splitsing op een echte werktafel.', composition: 'Een duidelijk hoofdonderwerp met ruimte voor tekst.', lighting: 'Zacht zijlicht', treatment: 'Tastbaar papier en natuurlijke details', avoid: ['Geposeerde stockfotografie'] } },
      brandProfile, course,
      personas: [{ id: randomUUID(), labelId, name: 'Praktijkgerichte adviseur', need: 'Met vertrouwen een volgende professionele stap kiezen.', assumptions: ['Het kanaalgebruik is nog niet gemeten.'], grounding: [], orientationSources: [] }],
      channels: ['linkedin_organic', 'instagram_organic'], coursePage: null, previousSnapshots: [], now,
    };
  });
  afterEach(async () => { vi.restoreAllMocks(); await h.close(); });

  async function saveRadar(value: RadarReport, labelId = input.labelId, courseVersionId = input.course.id): Promise<string> {
    const [row] = await h.db.insert(radarRuns).values({ organizationId: h.currentUser.organizationId, labelId, courseVersionId, report: value }).returning();
    return row!.id;
  }

  it('keeps one approved creative anchor, differentiates channel hypotheses, and spends no AI credits', async () => {
    const ai = vi.spyOn(h.appContext.services.generation, 'generate');
    const result = await prepareCreativeResearch(h.db, input);
    expect(result.mode).toBe('brief_only');
    expect(result.visualAnchor).toBe(input.concept.visualApproach);
    expect(result.campaignIdea).toBe(input.concept.coreIdea);
    expect(result.sharedStyle).toContain('Tastbaar papier');
    expect(result.channels.map(channel => channel.adaptation)[0]).not.toBe(result.channels.map(channel => channel.adaptation)[1]);
    expect(result.channels.every(channel => channel.role.includes('hypothese'))).toBe(true);
    expect(result.sources.filter(source => source.kind === 'channel_guidance').every(source => source.status === 'editorial_guidance' && source.retrievedAt === null && source.excerpt === '')).toBe(true);
    expect(result.gaps.join(' ')).toMatch(/geen.*mediagebruik/iu);
    expect(result.gaps.join(' ')).toContain('geen creatieve beeldanalyse');
    expect(result.gaps.join(' ')).toContain('zeven dagen');
    expect(ai).not.toHaveBeenCalled();
    expect(await h.db.select().from(usageRecords)).toHaveLength(0);
  });

  it('refreshes at most two unique public pinned-radar URLs and keeps old and new provenance separate', async () => {
    const cards = [card('https://www.linkedin.com/pulse/praktijk?utm_source=old'), card('https://www.linkedin.com/pulse/praktijk#copy'),
      card('https://about.fb.com/news/context/'), card('https://127.0.0.1/private'), card('https://www.linkedin.com/pulse/extra')];
    input.campaign.radarRunId = await saveRadar(report(cards));
    const fetchPage = vi.fn((url: string | null) => Promise.resolve({ url: url!, text: `${quote} ${'Zichtbare actuele broninhoud. '.repeat(12)}`, retrievedAt: now.toISOString() }));
    const result = await prepareCreativeResearch(h.db, { ...input, fetchPage });
    expect(fetchPage.mock.calls.map(([url]) => url)).toEqual(['https://www.linkedin.com/pulse/praktijk', 'https://about.fb.com/news/context/']);
    expect(result.mode).toBe('refreshed_pages');
    expect(result.sources.filter(source => source.kind === 'reference_page')).toHaveLength(2);
    expect(result.sources.filter(source => source.kind === 'reference_page').every(source => source.status === 'retrieved' && source.excerpt === quote && source.retrievedAt === now.toISOString())).toBe(true);
    expect(result.sources.filter(source => source.kind === 'radar').every(source => source.status === 'recorded' && source.retrievedAt === cards[0]!.retrievedAt)).toBe(true);
    expect(result.sources.every(source => source.excerpt.length <= 2200 && source.interpretation.length <= 1200)).toBe(true);
  });

  it('reuses a valid seven-day snapshot and invalidates it when an upstream version, channel or page changes', async () => {
    input.campaign.radarRunId = await saveRadar(report([card('https://www.linkedin.com/pulse/praktijk')]));
    const fetchPage = vi.fn((url: string | null) => Promise.resolve({ url: url!, text: quote.repeat(4), retrievedAt: now.toISOString() }));
    const first = await prepareCreativeResearch(h.db, { ...input, fetchPage });
    const cached = await prepareCreativeResearch(h.db, { ...input, fetchPage, previousSnapshots: [{ malformed: true }, first] });
    expect(cached).toEqual(first);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    for (const changed of [
      { ...input, brief: { ...input.brief, id: randomUUID() } },
      { ...input, channels: ['linkedin_organic'] as const },
      { ...input, coursePage: { url: 'https://www.linkedin.com/course', text: 'Andere eigen paginatekst', retrievedAt: now.toISOString() } },
      { ...input, now: new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000) },
    ]) {
      const next = await prepareCreativeResearch(h.db, { ...changed, fetchPage, previousSnapshots: [first] });
      expect(next.id).not.toBe(first.id);
    }
    expect(fetchPage).toHaveBeenCalledTimes(5);
  });

  it('uses current completed research and drops it when source content changes, even if a cache exists', async () => {
    const [source] = await h.db.insert(sources).values({ organizationId: h.currentUser.organizationId, labelId: input.labelId,
      kind: 'reference_page', url: 'https://www.linkedin.com/pulse/onderzoek', title: 'Werkveldonderzoek', timeSensitivity: 'high',
      contentSha256: 'a'.repeat(64), lastRetrievedAt: now }).returning();
    const [run] = await h.db.insert(researchRuns).values({ organizationId: h.currentUser.organizationId, labelId: input.labelId,
      courseVersionId: input.course.id, version: 1, status: 'completed', finishedAt: now,
      sourcesSnapshot: [{ sourceId: source!.id, contentSha256: 'a'.repeat(64), retrievedAt: now.toISOString(), failureNl: null }], findingCount: 1 }).returning();
    await h.db.insert(researchFindings).values({ organizationId: h.currentUser.organizationId, labelId: input.labelId, runId: run!.id,
      sourceId: source!.id, kind: 'external_source', sourceRef: source!.url!, claim: 'Professionals bespreken praktijkvragen.', excerpt: quote, retrievedAt: now });
    const first = await prepareCreativeResearch(h.db, input);
    expect(first.mode).toBe('recorded_sources');
    expect(first.sources.find(item => item.kind === 'research')?.excerpt).toBe(quote);
    await h.db.update(sources).set({ contentSha256: 'b'.repeat(64) }).where(eq(sources.id, source!.id));
    const changed = await prepareCreativeResearch(h.db, { ...input, previousSnapshots: [first] });
    expect(changed.id).not.toBe(first.id);
    expect(changed.sources.some(item => item.kind === 'research')).toBe(false);
    expect(changed.gaps.join(' ')).toContain('niet meer actueel');
    const stale = await prepareCreativeResearch(h.db, { ...input, now: new Date(now.getTime() + 25 * 60 * 60 * 1000) });
    expect(stale.mode).toBe('brief_only');
  });

  it('never reads a radar run of another course or label and rejects mismatched campaign inputs', async () => {
    const otherLabel = labelIdBySlug(h.seed, 'demolabel-3');
    const [originalCourse] = await h.db.select().from(courseVersions).where(eq(courseVersions.id, input.course.id));
    const [otherCourse] = await h.db.insert(courseVersions).values({ ...originalCourse!, id: randomUUID(), labelId: otherLabel }).returning();
    input.campaign.radarRunId = await saveRadar(report([card('https://www.linkedin.com/pulse/secret-other-label')]), otherLabel, otherCourse!.id);
    const fetchPage = vi.fn();
    const isolated = await prepareCreativeResearch(h.db, { ...input, fetchPage });
    expect(isolated.sources.some(source => source.sourceRef.includes('secret-other-label'))).toBe(false);
    expect(isolated.gaps.join(' ')).toContain('niet beschikbaar binnen dit label');
    expect(fetchPage).not.toHaveBeenCalled();
    const unrelated = await h.appContext.services.courses.saveDraft(h.db, h.currentUser, input.labelId, courseInput.parse({ name: 'Een andere kwalificatie' }));
    input.campaign.radarRunId = await saveRadar(report([card('https://www.linkedin.com/pulse/unrelated-course')]), input.labelId, unrelated.id);
    const courseIsolated = await prepareCreativeResearch(h.db, { ...input, fetchPage });
    expect(courseIsolated.sources.some(source => source.sourceRef.includes('unrelated-course'))).toBe(false);
    expect(fetchPage).not.toHaveBeenCalled();
    await expect(prepareCreativeResearch(h.db, { ...input, labelId: otherLabel })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('marks unverified media habits as assumptions, limits the source bundle, and keeps every channel reference valid', async () => {
    const base = input.personas[0]!;
    input.personas = [0, 1, 2].map(index => ({ ...base, id: randomUUID(), name: `Doelgroep ${String(index)}`,
      orientationSources: Array.from({ length: 8 }, (_, item) => ({ channel: item % 2 ? 'instagram_organic' as const : 'linkedin_organic' as const,
        statementNl: `Oriëntatie via vakinhoud ${String(item)} voor doelgroep ${String(index)}.`,
        grounding: { claim: `Er is een vastgelegde waarneming ${String(item)} voor doelgroep ${String(index)}.`, kind: 'external_source' as const,
          sourceRef: `https://www.linkedin.com/pulse/source-${String(index)}-${String(item)}`, retrievedAt: now.toISOString() } })) }));
    const dense = await prepareCreativeResearch(h.db, input);
    expect(dense.sources).toHaveLength(20);
    expect(dense.gaps.join(' ')).toContain('maximaal twintig');
    const ids = new Set(dense.sources.map(source => source.id));
    expect(dense.channels.every(channel => channel.sourceIds.every(id => ids.has(id)))).toBe(true);
    const unknown = await prepareCreativeResearch(h.db, { ...input, personas: [{ ...base,
      orientationSources: [{ channel: 'instagram_organic', statementNl: 'Bekijkt waarschijnlijk Instagram tijdens een pauze.', grounding: null }] }] });
    expect(unknown.gaps.join(' ')).toContain('mediagebruik blijft een aanname');
    expect(unknown.sources.some(source => source.excerpt.includes('waarschijnlijk Instagram'))).toBe(false);
  });

  it('keeps failed refreshes, demo radar and internal course-page text from masquerading as new market research', async () => {
    input.campaign.radarRunId = await saveRadar(report([card('https://www.linkedin.com/pulse/praktijk')], true));
    const fetchPage = vi.fn(() => Promise.resolve(null));
    const demo = await prepareCreativeResearch(h.db, { ...input, fetchPage,
      coursePage: { url: 'https://www.linkedin.com/course', text: 'Eigen cursusinformatie. '.repeat(20), retrievedAt: now.toISOString() } });
    expect(demo.mode).toBe('brief_only');
    expect(demo.gaps.join(' ')).toContain('demomateriaal');
    expect(fetchPage).not.toHaveBeenCalled();
    input.campaign.radarRunId = await saveRadar(report([card('https://www.linkedin.com/pulse/praktijk')]));
    const failed = await prepareCreativeResearch(h.db, { ...input, fetchPage });
    expect(failed.mode).toBe('recorded_sources');
    expect(failed.gaps.join(' ')).toContain('niet opnieuw leesbaar');
    const privateRedirect = await prepareCreativeResearch(h.db, { ...input, fetchPage: () => Promise.resolve({ url: 'https://127.0.0.1/private', text: quote.repeat(5), retrievedAt: now.toISOString() }) });
    expect(privateRedirect.sources.some(source => source.kind === 'reference_page')).toBe(false);
  });

  it('propagates cancellation instead of turning a cancelled fetch into an ordinary research gap', async () => {
    input.campaign.radarRunId = await saveRadar(report([card('https://www.linkedin.com/pulse/praktijk')]));
    const abort = new AbortController();
    await expect(prepareCreativeResearch(h.db, { ...input, signal: abort.signal, fetchPage: () => { abort.abort(); return Promise.resolve(null); } })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
