import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackedCompetitor, TrackedCompetitorInput } from '@c360/contracts';
import { courseVersions, memberships, radarRuns } from '../../src/core/db/schema.js';
import type { FetchResult } from '../../src/core/net/index.js';
import { MarketRadarService } from '../../src/modules/market-radar/service.js';
import {
  createTestHarness,
  labelIdBySlug,
  type TestHarness,
} from '../../src/testing/harness.js';

let h: TestHarness;
let labelId: string;
let otherLabelId: string;
let courseId: string;
let courseKey: string;
const sourceUrl = 'https://rival.example.nl/opleidingen/crov';
const sourceQuote = 'Rival Academy biedt een opleiding Casemanager Regie op Verzuim voor professionals die werkgevers begeleiden.';

const base = (label = labelId) => `/api/v1/labels/${label}/competitors`;
const profile = (overrides: Partial<TrackedCompetitorInput> = {}): TrackedCompetitorInput => ({
  name: 'Rival Academy',
  kind: 'competitor',
  aliases: ['Rival Opleidingen'],
  domains: ['rival.example.nl'],
  websiteUrl: 'https://rival.example.nl/',
  linkedinUrl: 'https://www.linkedin.com/company/rival-academy/',
  facebookUrl: 'https://www.facebook.com/rivalacademy',
  instagramUrl: 'https://www.instagram.com/rivalacademy/',
  courseUrls: [sourceUrl],
  courseKeys: [],
  active: true,
  notes: 'Volg deze aanbieder voor de opleiding en de openbare kanalen.',
  ...overrides,
});

async function create(body = profile(), label = labelId): Promise<TrackedCompetitor> {
  const response = await h.app.inject({ method: 'POST', url: base(label), payload: body });
  expect([200, 201], response.body).toContain(response.statusCode);
  return response.json<TrackedCompetitor>();
}

async function list(label = labelId): Promise<TrackedCompetitor[]> {
  const response = await h.app.inject({ method: 'GET', url: base(label) });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ items: TrackedCompetitor[] }>().items;
}

async function anotherCourse(label = labelId): Promise<{ id: string; key: string }> {
  const [course] = await h.db.select().from(courseVersions).where(eq(courseVersions.id, courseId));
  if (!course) throw new Error('The test course must exist.');
  const id = randomUUID();
  const key = `another-course-${randomUUID()}`;
  await h.db.insert(courseVersions).values({ ...course, id, labelId: label, courseKey: key, name: 'Andere opleiding' });
  return { id, key };
}

/** Real verification/persistence, with deterministic AI and a fetch stub: no browser or network. */
function radarFixture(withCandidate = true) {
  const fetchPage = vi.fn((url: string): Promise<FetchResult> => Promise.resolve({
    ok: true,
    body: `<html><body><p>${sourceQuote}</p><p>De opleiding bespreekt begeleiding bij verzuim en praktische samenwerking met werkgevers.</p></body></html>`,
    contentType: 'text/html',
    status: 200,
    finalUrl: url,
    chain: [url],
    connectedAddress: '93.184.216.34',
    byteSize: 300,
    retrievedAt: new Date('2026-09-15T09:00:00Z'),
    truncated: false,
  }));
  const generate = vi.spyOn(h.appContext.services.generation, 'generate').mockImplementation((_db, request) => Promise.resolve({
    value: request.template === 'radar.audience'
      ? {
          competitors: withCandidate ? [{
            sourceUrl,
            organization: 'Rival Academy',
            excerpt: sourceQuote,
            reason: 'Biedt een vergelijkbare opleiding voor dezelfde beroepsgroep.',
          }] : [],
          findings: [],
          note: '',
        }
      : request.template === 'radar.analyze'
        ? { cards: [], note: '' }
        : { insights: [], note: '' },
    promptVersion: 'v1',
    isMock: true,
    actualCostCents: 0,
    latencyMs: 0,
  }));
  const services = h.appContext.services;
  const radar = new MarketRadarService(services.generation, services.courses, services.campaigns, services.brand, h.env, fetchPage);
  const scan = (urls: string[] = [sourceUrl]) => radar.scan(h.db, h.currentUser, {
    labelId, courseVersionId: courseId, urls, discover: false, includeAds: false, includeKeywords: false,
  });
  return { radar, scan, fetchPage, generate };
}

beforeEach(async () => {
  h = await createTestHarness({ envOverrides: { AD_RESEARCH_ENABLED: 'false' } });
  labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
  otherLabelId = labelIdBySlug(h.seed, 'demolabel-3');
  const [course] = await h.db.select({ id: courseVersions.id, key: courseVersions.courseKey })
    .from(courseVersions).where(eq(courseVersions.labelId, labelId)).limit(1);
  if (!course) throw new Error('The seeded label must have a course.');
  courseId = course.id;
  courseKey = course.key;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

describe('shared competitor registry', () => {
  it('persists the full profile, edits the same record and retains inactive records for management', async () => {
    const created = await create(profile({ courseKeys: [courseKey] }));
    expect(created.id).toEqual(expect.any(String));
    expect(created.provenance).toBeNull();
    expect(await list()).toEqual([expect.objectContaining({ ...profile({ courseKeys: [courseKey] }), id: created.id })]);

    const changed = profile({ name: 'Rival Academy Nederland', active: false, notes: 'Niet meer volgen; bewaren voor herkomst.', courseKeys: [courseKey] });
    const edited = await h.app.inject({ method: 'POST', url: `${base()}/${created.id}`, payload: changed });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json<TrackedCompetitor>()).toMatchObject({ ...changed, id: created.id, provenance: null });
    expect(await list()).toHaveLength(1);
    expect((await list())[0]?.active).toBe(false);
  });

  it('rejects ambiguous names, aliases, domains and a second own brand without changing the original', async () => {
    const original = await create();
    for (const duplicate of [
      profile({ name: 'rival academy', aliases: [], domains: ['other.example.nl'], websiteUrl: 'https://other.example.nl' }),
      profile({ name: 'Andere Aanbieder', aliases: ['RIVAL OPLEIDINGEN'], domains: ['other.example.nl'], websiteUrl: 'https://other.example.nl' }),
      profile({ name: 'Andere Aanbieder', aliases: [], domains: ['rival.example.nl'], websiteUrl: 'https://other.example.nl' }),
    ]) {
      const response = await h.app.inject({ method: 'POST', url: base(), payload: duplicate });
      expect(response.statusCode, response.body).toBe(409);
    }
    const own = profile({ name: 'Eigen Academy', kind: 'own', aliases: [], domains: ['own.example.nl'], websiteUrl: 'https://own.example.nl', courseUrls: [] });
    await create(own);
    const duplicateOwn = await h.app.inject({ method: 'POST', url: base(), payload: { ...own, name: 'Tweede Eigen Merk', domains: ['second-own.example.nl'], websiteUrl: 'https://second-own.example.nl' } });
    expect(duplicateOwn.statusCode, duplicateOwn.body).toBe(409);
    expect((await list()).find(item => item.id === original.id)?.name).toBe(original.name);
    expect(await list()).toHaveLength(2);
  });

  it('isolates labels and applies viewer write restrictions on the next HTTP request', async () => {
    const existing = await create();
    expect(await list(otherLabelId)).toEqual([]);
    const crossLabel = await h.app.inject({ method: 'POST', url: `${base(otherLabelId)}/${existing.id}`, payload: profile() });
    expect(crossLabel.statusCode, crossLabel.body).toBe(404);

    await h.db.update(memberships).set({ role: 'label_viewer' })
      .where(and(eq(memberships.labelId, labelId), eq(memberships.userId, h.currentUser.userId)));
    expect(await list()).toHaveLength(1);
    for (const url of [base(), `${base()}/${existing.id}`]) {
      const response = await h.app.inject({ method: 'POST', url, payload: profile({ name: 'Niet toegestaan' }) });
      expect(response.statusCode, response.body).toBe(403);
    }
    await h.db.delete(memberships)
      .where(and(eq(memberships.labelId, otherLabelId), eq(memberships.userId, h.currentUser.userId)));
    expect((await h.app.inject({ method: 'GET', url: base(otherLabelId) })).statusCode).toBe(404);
    expect((await list())[0]?.name).toBe(existing.name);
  });

  it('validates course scope within the label and rejects unsafe or deceptive platform URLs', async () => {
    const foreignCourse = await anotherCourse(otherLabelId);
    const foreignContext = await h.app.inject({ method: 'GET', url: `${base()}?courseVersionId=${foreignCourse.id}` });
    expect(foreignContext.statusCode, foreignContext.body).toBe(404);
    const invalidScope = await h.app.inject({ method: 'POST', url: base(), payload: profile({ courseKeys: [foreignCourse.key] }) });
    expect(invalidScope.statusCode, invalidScope.body).toBe(422);

    for (const unsafe of [
      { websiteUrl: 'http://rival.example.nl' },
      { websiteUrl: 'https://user:password@rival.example.nl' },
      { websiteUrl: 'https://127.0.0.1/private' },
      { linkedinUrl: 'https://www.linkedin.com.evil.example/company/rival/' },
      { facebookUrl: 'https://www.linkedin.com/company/rival/' },
      { instagramUrl: 'javascript:alert(1)' },
      { courseUrls: ['https://localhost/private'] },
    ]) {
      const response = await h.app.inject({ method: 'POST', url: base(), payload: profile(unsafe) });
      expect(response.statusCode, response.body).toBe(422);
    }
    expect(await list()).toEqual([]);
    await create(profile({ courseKeys: [courseKey] }));
    const scoped = await h.app.inject({ method: 'GET', url: `${base()}?courseVersionId=${courseId}` });
    expect(scoped.statusCode, scoped.body).toBe(200);
    expect(scoped.json<{ courseKey: string }>().courseKey).toBe(courseKey);
  });

  it('shares entities with AI Visibility while legacy edits preserve the registry profile', async () => {
    const created = await create(profile({ courseKeys: [courseKey] }));
    const visibility = `/api/v1/labels/${labelId}/ai-visibility`;
    const overview = await h.app.inject({ method: 'GET', url: visibility });
    expect(overview.statusCode, overview.body).toBe(200);
    expect(overview.json<{ entities: { id: string }[] }>().entities.map(item => item.id)).toContain(created.id);
    const edit = await h.app.inject({
      method: 'POST', url: `${visibility}/entities/${created.id}`,
      payload: { name: 'Rival Academy Nieuw', kind: 'competitor', aliases: ['Nieuwe Rival'], domains: ['rival.example.nl'] },
    });
    expect(edit.statusCode, edit.body).toBe(200);
    const persisted = (await list()).find(item => item.id === created.id);
    expect(persisted).toMatchObject({
      id: created.id, name: 'Rival Academy Nieuw', websiteUrl: created.websiteUrl,
      linkedinUrl: created.linkedinUrl, facebookUrl: created.facebookUrl,
      instagramUrl: created.instagramUrl, courseUrls: created.courseUrls,
      courseKeys: created.courseKeys, notes: created.notes, active: created.active, provenance: created.provenance,
    });
    const oldCreate = await h.app.inject({
      method: 'POST', url: `${visibility}/entities`,
      payload: { name: 'Oude Invoer Academy', kind: 'competitor', aliases: [], domains: ['legacy.example.nl'] },
    });
    expect(oldCreate.statusCode, oldCreate.body).toBe(200);
    expect((await list()).find(item => item.name === 'Oude Invoer Academy')).toMatchObject({
      websiteUrl: 'https://legacy.example.nl/', courseUrls: [], courseKeys: [], active: true, provenance: null,
    });
  });

  it('imports a verified candidate only after explicit acceptance, retaining provenance and idempotency', async () => {
    const fixture = radarFixture();
    const run = await fixture.scan();
    expect(run.report.audience?.competitors).toHaveLength(1);
    expect(await list()).toEqual([]);
    // Emulate a saved non-demo report; no real provider is called by this test.
    await h.db.update(radarRuns).set({ report: { ...run.report, isMock: false } }).where(eq(radarRuns.id, run.id));
    const url = `/api/v1/labels/${labelId}/radar/${run.id}/competitors`;
    const accepted = await h.app.inject({ method: 'POST', url, payload: { sourceUrl } });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const saved = accepted.json<TrackedCompetitor>();
    expect(saved).toMatchObject({ name: 'Rival Academy', kind: 'competitor', courseUrls: [sourceUrl], courseKeys: [courseKey], active: true });
    expect(saved.provenance).not.toBeNull();
    expect(JSON.stringify(saved.provenance)).toContain(run.id);
    expect(JSON.stringify(saved.provenance)).toContain(sourceUrl);
    expect(JSON.stringify(saved.provenance)).toContain(sourceQuote);

    const edited = await h.app.inject({ method: 'POST', url: `${base()}/${saved.id}`, payload: profile({ notes: 'Handmatige notitie behouden.', courseKeys: [courseKey] }) });
    expect(edited.statusCode, edited.body).toBe(200);
    const legacyEdit = await h.app.inject({
      method: 'POST', url: `/api/v1/labels/${labelId}/ai-visibility/entities/${saved.id}`,
      payload: { name: 'Rival Academy Herzien', kind: 'competitor', aliases: [], domains: ['rival.example.nl'] },
    });
    expect(legacyEdit.statusCode, legacyEdit.body).toBe(200);
    const repeated = await h.app.inject({ method: 'POST', url, payload: { sourceUrl } });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json<TrackedCompetitor>().id).toBe(saved.id);
    expect(await list()).toHaveLength(1);
    expect((await list())[0]).toMatchObject({ name: 'Rival Academy Herzien', notes: 'Handmatige notitie behouden.', provenance: saved.provenance });
  });

  it('refuses unverified candidate URLs, forged provenance, other-label runs and unauthorized acceptance', async () => {
    const { scan } = radarFixture();
    const run = await scan();
    const path = `/api/v1/labels/${labelId}/radar/${run.id}/competitors`;
    expect((await h.app.inject({ method: 'POST', url: path, payload: { sourceUrl } })).statusCode).toBe(422);
    await h.db.update(radarRuns).set({ report: { ...run.report, isMock: false } }).where(eq(radarRuns.id, run.id));
    expect((await h.app.inject({ method: 'POST', url: path, payload: { sourceUrl: 'https://unvisited.example.nl/course' } })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'POST', url: path.replace(labelId, otherLabelId), payload: { sourceUrl } })).statusCode).toBe(404);

    // A manual payload must never manufacture a trusted research trail.
    const forged = await h.app.inject({ method: 'POST', url: base(), payload: { ...profile(), provenance: { runId: run.id, sourceUrl, excerpt: 'Invented evidence.' } } });
    if (forged.statusCode < 300) {
      expect(forged.json<TrackedCompetitor>().provenance).toBeNull();
    } else {
      expect([400, 422], forged.body).toContain(forged.statusCode);
    }
    await h.db.update(memberships).set({ role: 'label_viewer' })
      .where(and(eq(memberships.labelId, labelId), eq(memberships.userId, h.currentUser.userId)));
    expect((await h.app.inject({ method: 'POST', url: path, payload: { sourceUrl } })).statusCode).toBe(403);
  });

  it('uses saved active course-scoped sources in later scans without discovery or pasted URLs', async () => {
    const another = await anotherCourse();
    const included = await create(profile({ courseKeys: [courseKey] }));
    await create(profile({ name: 'Alle Opleidingen Academy', aliases: [], domains: ['global.example.nl'], websiteUrl: 'https://global.example.nl/', courseUrls: [], courseKeys: [] }));
    const excluded = [
      { name: 'Inactieve Academy', host: 'inactive.example.nl', active: false, kind: 'competitor' as const, courseKeys: [] },
      { name: 'Andere Cursus Academy', host: 'different.example.nl', active: true, kind: 'competitor' as const, courseKeys: [another.key] },
      { name: 'Eigen Academy', host: 'own.example.nl', active: true, kind: 'own' as const, courseKeys: [] },
    ];
    for (const item of excluded) {
      await create(profile({ ...item, aliases: [], domains: [item.host], websiteUrl: `https://${item.host}`, courseUrls: [`https://${item.host}/opleiding`] }));
    }
    await create(profile({ name: 'Ander Label Academy', aliases: [], domains: ['foreign.example.nl'], websiteUrl: 'https://foreign.example.nl', courseUrls: ['https://foreign.example.nl/opleiding'] }), otherLabelId);

    const fixture = radarFixture(false);
    const run = await fixture.scan([]);
    const fetched = fixture.fetchPage.mock.calls.map(([url]) => url);
    expect(fetched).toContain(sourceUrl);
    expect(fetched).toContain('https://global.example.nl');
    expect(fetched).not.toContain('https://rival.example.nl');
    expect(fetched.some(url => /inactive|different|own\.example|foreign/u.test(url))).toBe(false);
    expect(fixture.generate.mock.calls.some(([, input]) => input.template === 'radar.discover')).toBe(false);
    expect(run.report.trackedCompetitors).toContainEqual({ id: included.id, name: included.name, sourceUrl });

    const manualEdit = await h.app.inject({ method: 'POST', url: `${base()}/${included.id}`, payload: profile({ name: 'Nieuwe Naam', courseKeys: [courseKey] }) });
    expect(manualEdit.statusCode, manualEdit.body).toBe(200);
    const historic = await h.appContext.services.radar.requireRun(h.db, h.currentUser, labelId, run.id);
    expect(historic.report.trackedCompetitors).toContainEqual({ id: included.id, name: included.name, sourceUrl });
  });
});
