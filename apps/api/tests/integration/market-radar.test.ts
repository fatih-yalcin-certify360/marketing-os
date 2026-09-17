import { verifyKeywords } from '../../src/modules/market-radar/keywords.js';
import { AppError } from '../../src/core/errors/app-error.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { courseVersions, radarRuns } from '../../src/core/db/schema.js';
import {
  MarketRadarService,
  pageImage,
  canonicalUrl,
} from '../../src/modules/market-radar/service.js';
import {
  createTestHarness,
  type TestHarness,
  labelIdBySlug,
} from '../../src/testing/harness.js';
import type { FetchResult } from '../../src/core/net/index.js';

let h: TestHarness;
let labelId: string;
let courseId: string;
const url = 'https://example.org/course';
const excerpt =
  'Deze opleiding biedt een proefles voor mensen die het vak willen ontdekken.';
const proposal = {
  sourceUrl: url,
  organization: 'Voorbeeld',
  relationship: 'competitor',
  relationshipReason: 'Biedt een opleiding voor dezelfde doelgroep aan.',
  title: 'Eerst het vak ervaren',
  observation: 'De bron biedt een proefles.',
  excerpt,
  relevance:
    'Een concrete beroepssituatie kan onze doelgroep helpen oriënteren.',
  publishedDate: '2026-09-10',
  dateExcerpt: 'Niet aanwezig op de pagina',
  period: null,
  uncertainty: 'Geen bewijs van effectiviteit.',
  approaches: [0, 1, 2].map((i) => ({
    title: `Creatieve route ${String(i)}`,
    format: 'LinkedIn-bericht',
    idea: 'Open met een concrete praktijksituatie en verwijs naar de opleiding.',
    audience: 'HR-professionals',
  })),
};
beforeEach(async () => {
  h = await createTestHarness();
  labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
  const response = await h.app.inject({
    method: 'GET',
    url: `/api/v1/labels/${labelId}/courses`,
  });
  courseId = response.json<{ items: { course: { id: string } }[] }>().items[0]!
    .course.id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});
function service(text = excerpt) {
  const fetchPage = vi.fn((): Promise<FetchResult> =>
    Promise.resolve({
      ok: true,
      body: `<html><p>${text}</p><p>Extra informatie over dit opleidingsprogramma voor professionals.</p></html>`,
      contentType: 'text/html',
      status: 200,
      finalUrl: url,
      chain: [url],
      connectedAddress: '93.184.216.34',
      byteSize: 200,
      retrievedAt: new Date(),
      truncated: false,
    }),
  );
  const s = h.appContext.services;
  return {
    radar: new MarketRadarService(
      s.generation,
      s.courses,
      s.campaigns,
      s.brand,
      h.env,
      fetchPage,
    ),
    fetchPage,
  };
}
function analysis(cards: unknown[] = [proposal]) {
  return vi
    .spyOn(h.appContext.services.generation, 'generate')
    .mockResolvedValue({
      value: { cards, note: '' },
      promptVersion: 'v1',
      isMock: true,
      actualCostCents: 0,
      latencyMs: 0,
    });
}
const input = () => ({
  labelId,
  courseVersionId: courseId,
  urls: [url],
  discover: false,
});
describe('market radar', () => {
  it('persists a saved source once, isolates labels and removes only its bookmark', async()=>{
    analysis();
    const run=await service().radar.scan(h.db,h.currentUser,input());
    const card=run.report.cards[0]!;
    const target=`/api/v1/labels/${labelId}/radar/${run.id}/cards/${card.id}/save`;
    const list=`/api/v1/labels/${labelId}/courses/${courseId}/radar/saved`;
    expect((await h.app.inject({method:'POST',url:target})).statusCode).toBe(200);
    expect((await h.app.inject({method:'POST',url:target})).statusCode).toBe(200);
    const stored=(await h.app.inject({method:'GET',url:list})).json<{items:{runId:string;card:{id:string}}[]}>();
    expect(stored.items).toHaveLength(1);expect(stored.items[0]?.runId).toBe(run.id);expect(stored.items[0]?.card.id).toBe(card.id);
    const other=labelIdBySlug(h.seed,'demolabel-3');
    expect((await h.app.inject({method:'POST',url:target.replace(labelId,other)})).statusCode).toBe(404);
    expect((await h.app.inject({method:'DELETE',url:target.replace(labelId,other)})).statusCode).toBe(404);
    expect((await h.app.inject({method:'GET',url:list.replace(labelId,other)})).json<{items:unknown[]}>().items).toEqual([]);
    expect((await h.app.inject({method:'POST',url:target.replace(card.id,randomUUID())})).statusCode).toBe(404);
    expect((await h.app.inject({method:'DELETE',url:target})).statusCode).toBe(200);
    expect((await h.app.inject({method:'GET',url:list})).json<{items:unknown[]}>().items).toEqual([]);
    expect((await h.appContext.services.radar.requireRun(h.db,h.currentUser,labelId,run.id)).report.cards).toHaveLength(1);
  });
  it('authorizes question campaigns and selective draft downloads, preserving source provenance', async () => {
    analysis([]);
    const run = await service().radar.scan(h.db, h.currentUser, input());
    const text = 'Wat doet een casemanager? Lees hier over het beroep en de opleiding.';
    const keywords = verifyKeywords({ items: [{ phrase: 'Wat doet een casemanager?', kind: 'page_question', sourceUrl: url, excerpt: text, intent: 'informational', rationale: 'Een vraag over de beroepskeuze.' }], note: '' }, [{ url, text, retrievedAt: run.createdAt }]);
    await h.db.update(radarRuns).set({ report: { ...run.report, keywords } }).where(eq(radarRuns.id, run.id));
    const base = `/api/v1/labels/${labelId}/radar/${run.id}`;
    const downloaded = await h.app.inject({ method: 'GET', url: `${base}/package` });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers['content-type']).toContain('application/zip');
    expect(downloaded.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect((await h.app.inject({ method: 'GET', url: `${base}/package?parts=fit_check` })).statusCode).toBe(409);
    expect((await h.app.inject({ method: 'GET', url: `${base}/package?parts=../../secret` })).statusCode).toBe(422);
    const target = `${base}/keywords/${keywords.items[0]!.id}/campaign`;
    const created = await h.app.inject({ method: 'POST', url: target });
    expect(created.statusCode).toBe(201);
    expect(created.json<{ suppliedBrief: string }>().suppliedBrief).toContain(text);
    expect(created.json<{ suppliedBrief: string }>().suppliedBrief).toContain('Geen gemeten zoekvolume');
    const other = labelIdBySlug(h.seed, 'demolabel-3');
    expect((await h.app.inject({ method: 'GET', url: `${base.replace(labelId, other)}/package` })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'POST', url: target.replace(labelId, other) })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'POST', url: target.replace(keywords.items[0]!.id, randomUUID()) })).statusCode).toBe(404);
  });

  it('freezes verified audience evidence and passes it to campaign-specific persona generation', async () => {
    const text = 'Ons team bestaat uit casemanagers die werkgevers begeleiden bij verzuim.';
    const generate = analysis([]).mockResolvedValueOnce({value:{cards:[],note:''},promptVersion:'v1',isMock:true,actualCostCents:0,latencyMs:0}).mockResolvedValueOnce({
      value: { findings: [{ sourceUrl:url,sourceKind:'employer_team',organization:'Voorbeeld',role:'casemanagers',excerpt:text,
        sector:null,sectorExcerpt:null,educationProvider:null,educationExcerpt:null,
        hypothesis:'Toets de behoefte aan opleiding bij startende casemanagers.',uncertainty:'Een huidige functie bewijst geen koopintentie.' }], note:'' },
      promptVersion:'v1',isMock:true,actualCostCents:0,latencyMs:0,
    });
    const run = await service(text).radar.scan(h.db,h.currentUser,input());
    const finding = run.report.audience!.findings[0]!;
    expect(finding.role).toBe('casemanagers');
    const target = `/api/v1/labels/${labelId}/radar/${run.id}/audience/${finding.id}/campaign`;
    const created = await h.app.inject({method:'POST',url:target});
    expect(created.statusCode).toBe(201);
    const campaign = created.json<{id:string;suppliedBrief:string}>();
    expect(campaign.suppliedBrief).toContain(text);
    expect(campaign.suppliedBrief).toContain('Opleider: niet vastgesteld');
    const other=labelIdBySlug(h.seed,'demolabel-3');
    expect((await h.app.inject({method:'POST',url:target.replace(labelId,other)})).statusCode).toBe(404);
    expect((await h.app.inject({method:'POST',url:target.replace(finding.id,randomUUID())})).statusCode).toBe(404);
    const qualified = {...finding, sourceKind: 'alumni_story' as const};
    await h.db.update(radarRuns).set({report:{...run.report,audience:{...run.report.audience!, findings:[qualified]}}}).where(eq(radarRuns.id,run.id));
    const qualifiedCampaign = await h.app.inject({method:'POST',url:target});
    expect(qualifiedCampaign.json<{suppliedBrief:string}>().suppliedBrief).toContain('maar de aangeboden kwalificatie nog niet hebben');
    generate.mockRestore();
    const personaCall=vi.spyOn(h.appContext.services.generation,'generate');
    await h.appContext.services.personas.propose(h.db,h.currentUser,{labelId,courseVersionId:courseId,campaignId:campaign.id});
    expect(personaCall.mock.calls[0]?.[1].context.suppliedBrief).toBe(campaign.suppliedBrief);
    await h.db.update(radarRuns).set({report:{...run.report,audience:{competitors:[],findings:[],checkedSources:0,independentDomains:0,notes:[]}}}).where(eq(radarRuns.id,run.id));
    const stored=await h.appContext.services.campaigns.requireById(h.db,labelId,campaign.id);
    expect(stored.suppliedBrief).toContain(text);
  });

  it('retains an explicit partial report when creative analysis is truncated', async () => {
    analysis().mockRejectedValueOnce(new AppError('provider_invalid_output'));
    const result = await service().radar.scan(h.db, h.currentUser, input());
    expect(result.report.cards).toEqual([]);
    expect(result.report.notes.join(' ')).toContain(
      'Advertentieonderzoek gaat wel door',
    );
    expect(result.report.advertising?.coverage).toHaveLength(3);
    expect(
      result.report.advertising?.coverage.every(
        (item) => item.status === 'unavailable',
      ),
    ).toBe(true);
  });
  it('does not swallow authorization or other non-output errors during analysis', async () => {
    analysis().mockRejectedValueOnce(AppError.forbidden('test'));
    await expect(
      service().radar.scan(h.db, h.currentUser, input()),
    ).rejects.toThrow();
    expect(await h.db.select().from(radarRuns)).toHaveLength(0);
  });

  it('authorizes ad previews and preserves ad provenance with the own-course destination', async () => {
    analysis();
    await h.db
      .update(courseVersions)
      .set({ sourceRef: 'https://training.example.org/course' })
      .where(eq(courseVersions.id, courseId));
    const { radar } = service();
    const run = await radar.scan(h.db, h.currentUser, input());
    const ad = {
      id: randomUUID(),
      platform: 'meta' as const,
      libraryId: '123456',
      sourceUrl: 'https://www.facebook.com/ads/library/?id=123456',
      advertiser: 'Reference provider',
      text: 'Course reference copy',
      status: 'active' as const,
      deliveryInfo: null,
      observedAt: new Date().toISOString(),
      screenshot: true,
      matchedTerms: ['CROV'],
      advertiserScope: 'other_or_unconfirmed' as const,
    };
    await h.db
      .update(radarRuns)
      .set({
        report: { ...run.report, advertising: { ads: [ad], coverage: [] } },
      })
      .where(eq(radarRuns.id, run.id));
    const folder = path.join(h.env.STORAGE_ROOT, 'radar-advertisements');
    const file = path.join(folder, `${ad.id}.png`);
    await mkdir(folder, { recursive: true });
    await writeFile(file, Buffer.from([137, 80, 78, 71]));
    try {
      const prefix = `/api/v1/labels/${labelId}/radar/${run.id}/ads`;
      const image = await h.app.inject({
        method: 'GET',
        url: `${prefix}/${ad.id}/preview`,
      });
      expect(image.statusCode).toBe(200);
      expect(image.headers['content-type']).toContain('image/png');
      const other = labelIdBySlug(h.seed, 'demolabel-3');
      for (const [method, suffix] of [
        ['GET', 'preview'],
        ['POST', 'campaign'],
      ] as const) {
        expect(
          (
            await h.app.inject({
              method,
              url: `/api/v1/labels/${other}/radar/${run.id}/ads/${ad.id}/${suffix}`,
            })
          ).statusCode,
        ).toBe(404);
      }
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: `${prefix}/${randomUUID()}/preview`,
          })
        ).statusCode,
      ).toBe(404);
      const response = await h.app.inject({
        method: 'POST',
        url: `${prefix}/${ad.id}/campaign`,
      });
      expect(response.statusCode).toBe(201);
      const campaign = response.json<{
        suppliedBrief: string;
        stage: string;
      }>();
      expect(campaign.suppliedBrief).toContain(ad.sourceUrl);
      expect(campaign.suppliedBrief).toContain(ad.text);
      expect(campaign.suppliedBrief).toContain(ad.id);
      expect(campaign.suppliedBrief).toContain(
        'Doel-URL: https://training.example.org/course',
      );
      expect(campaign.suppliedBrief).toContain('Neem geen tekst');
      expect(campaign.stage).toBe('persona_selection');
    } finally {
      await rm(file, { force: true });
    }
  });

  it('retains the explicit course destination when the brief model omits it', async () => {
    await h.db
      .update(courseVersions)
      .set({ sourceRef: 'https://training.example.org/course' })
      .where(eq(courseVersions.id, courseId));
    const generate = analysis();
    const { radar } = service();
    const run = await radar.scan(h.db, h.currentUser, input());
    const card = run.report.cards[0]!;
    const campaign = await radar.createCampaign(
      h.db,
      h.currentUser,
      labelId,
      run.id,
      card.id,
      0,
    );
    generate.mockRestore();
    const services = h.appContext.services;
    const proposed = await services.personas.propose(h.db, h.currentUser, {
      labelId,
      courseVersionId: courseId,
      campaignId: campaign.id,
    });
    for (const persona of proposed.personas)
      await services.personas.approve(h.db, h.currentUser, labelId, persona.id);
    const brief = await services.campaigns.draftBrief(h.db, h.currentUser, {
      labelId,
      campaignId: campaign.id,
      personaVersionIds: proposed.personas.map((p) => p.id),
    });
    expect(brief.ctaUrl).toBe('https://training.example.org/course');
    expect(brief.ctaUrl).not.toBe(card.sourceUrl);
  });

  it('synthesises a market picture from verified items, grades it, digests the change and hands an insight off with its objective', async () => {
    /*
     * The market picture is one more model call over the run's *verified*
     * items. The mock here is template-aware: cards for the analysis, a
     * synthesis citing the stored card for the picture — and one invented id
     * the service must refuse.
     */
    const { radar } = service();
    const generate = vi
      .spyOn(h.appContext.services.generation, 'generate')
      // eslint-disable-next-line @typescript-eslint/require-await -- the real method is async; the stub answers synchronously
      .mockImplementation(async (_db, request) => {
        const base = { promptVersion: 'v1', isMock: true, actualCostCents: 0, latencyMs: 0 };
        if (request.template === 'radar.analyze') return { ...base, value: { cards: [proposal], note: '' } };
        if (request.template === 'radar.synthesize') {
          const evidence = JSON.parse(String(request.context.pageText)) as { kind: string; id: string }[];
          const card = evidence.find((item) => item.kind === 'card');
          return {
            ...base,
            value: {
              insights: [
                {
                  headlineNl: 'Aanbieders openen met een proefles om de opleidingskeuze te verlagen.',
                  observationNl: 'De bron biedt een proefles aan voor mensen die het vak willen ontdekken.',
                  meaningNl: 'Voor wie zich nog oriënteert is ervaren vóór het kiezen het moment om op aan te sluiten, in de fase Ontdekken.',
                  nowNl: 'Werk een Ontdekken-campagne uit rond een herkenbare eerste werksituatie.',
                  alternativeNl: 'Een proefles kan een verkoopinstrument van deze aanbieder zijn zonder dat de doelgroep erom vraagt.',
                  notShownNl: 'Geen zoekvolume, geen marktaandeel en geen resultaat van de proefles.',
                  stage: 'discover',
                  suggestedObjective: 'awareness',
                  agreement: 'eens',
                  evidence: [{ kind: 'card', id: card?.id ?? 'missing' }],
                },
                {
                  headlineNl: 'Een inzicht zonder bewijs uit deze scan.',
                  observationNl: 'Deze bewering rust op een id dat de scan niet kent, en moet verdwijnen.',
                  meaningNl: 'Het zou anders een claim zijn die niemand kan controleren.',
                  nowNl: 'Niets doen met dit inzicht.',
                  alternativeNl: 'Er is geen alternatieve lezing van niets.',
                  notShownNl: 'Alles wat een echte bron had kunnen laten zien.',
                  stage: 'consider',
                  suggestedObjective: 'consideration',
                  agreement: 'niet_te_beoordelen',
                  evidence: [{ kind: 'card', id: '00000000-0000-4000-8000-000000000000' }],
                },
              ],
              note: 'Testnotitie.',
            },
          };
        }
        return { ...base, value: { findings: [], competitors: [], note: '' } };
      });

    const first = await radar.scan(h.db, h.currentUser, input());
    expect(first.report.insights, first.report.notes.join(' | ')).toHaveLength(1);
    const insight = first.report.insights[0]!;
    expect(insight.evidence).toEqual([{ kind: 'card', id: first.report.cards[0]!.id }]);
    // One source, one domain: the grade says so, and a single source cannot claim agreement.
    expect(insight.confidence).toMatchObject({ evidence: 'beperkt', independentDomains: 1, agreement: 'niet_te_beoordelen' });
    expect(first.report.notes.join(' ')).toMatch(/geen bewijs uit deze scan/u);
    expect(first.report.digest).toEqual({ previousRunId: null, previousAt: null, items: [] });
    expect(first.report.claims.map((claim) => claim.sourceUrl)).toEqual([url]);

    // A second scan of the same course digests what changed: nothing here,
    // and the digest says which run it compared with.
    const second = await radar.scan(h.db, h.currentUser, input());
    expect(second.report.digest?.previousRunId).toBe(first.id);
    expect(second.report.digest?.items).toEqual([]);
    generate.mockRestore();

    // The hand-off: the insight's own words, its evidence and its confidence
    // travel in the brief; the objective is the person's, defaulting to the
    // insight's suggestion.
    const defaulted = await radar.campaignFromInsight(h.db, h.currentUser, labelId, first.id, insight.id);
    expect(defaulted.objective).toBe('awareness');
    expect(defaulted.radarRunId).toBe(first.id);
    expect(defaulted.suppliedBrief).toContain(insight.headlineNl);
    expect(defaulted.suppliedBrief).toContain(url);
    expect(defaulted.suppliedBrief).toContain('Beperkt bewijs');

    const chosen = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/radar/${first.id}/insights/${insight.id}/campaign`,
      payload: { objective: 'consideration' },
    });
    expect(chosen.statusCode).toBe(201);
    expect(chosen.json<{ objective: string }>().objective).toBe('consideration');

    const unknown = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/radar/${first.id}/insights/${randomUUID()}/campaign`,
      payload: {},
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('redacts e-mail addresses and phone numbers from stored passages after verifying them', async () => {
    const text = `${excerpt} Vragen? Mail naar info@voorbeeld.nl of bel 06-12345678.`;
    const { radar } = service(text);
    analysis([{ ...proposal, excerpt: text }]);
    const run = await radar.scan(h.db, h.currentUser, input());
    expect(run.report.cards).toHaveLength(1);
    expect(run.report.cards[0]!.excerpt).not.toMatch(/@|06-1234/u);
    expect(run.report.cards[0]!.excerpt).toMatch(/\[e-mailadres weggelaten\]/u);
    expect(run.report.notes.join(' ')).toMatch(/e-mailadres of telefoonnummer/u);
  });

  it('carries the chosen objective into the campaign it creates, and refuses one outside the vocabulary', async () => {
    /*
     * The hand-off is the whole point of the radar, and it used to arrive
     * without the one field that decides a campaign's funnel stages. The
     * objective is the person's choice at the hand-off; absent means null,
     * as it did for older clients.
     */
    const generate = analysis();
    const { radar } = service();
    const run = await radar.scan(h.db, h.currentUser, input());
    generate.mockRestore();
    const card = run.report.cards[0]!;

    const chosen = await radar.createCampaign(h.db, h.currentUser, labelId, run.id, card.id, 0, 'consideration');
    expect(chosen.objective).toBe('consideration');
    expect(chosen.radarRunId).toBe(run.id);

    const viaHttp = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/radar/${run.id}/cards/${card.id}/campaign`,
      payload: { approachIndex: 1, objective: 'awareness' },
    });
    expect(viaHttp.statusCode).toBe(201);
    expect(viaHttp.json<{ objective: string }>().objective).toBe('awareness');

    const legacy = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/radar/${run.id}/cards/${card.id}/campaign`,
      payload: { approachIndex: 2 },
    });
    expect(legacy.statusCode).toBe(201);
    expect(legacy.json<{ objective: string | null }>().objective).toBeNull();

    const refused = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/radar/${run.id}/cards/${card.id}/campaign`,
      payload: { approachIndex: 0, objective: 'growth' },
    });
    expect(refused.statusCode).toBe(422);
  });

  it('keeps verified evidence, strips unsupported dates, and preserves the signal in the new campaign', async () => {
    analysis();
    const { radar } = service();
    const run = await radar.scan(h.db, h.currentUser, input());
    expect(run.report.cards).toHaveLength(1);
    const card = run.report.cards[0]!;
    expect(card.publishedDate).toBeNull();
    expect(card.materialType).toBe('web_page');
    expect(card.change).toBe('first_seen');
    const campaign = await radar.createCampaign(
      h.db,
      h.currentUser,
      labelId,
      run.id,
      card.id,
      1,
    );
    expect(campaign.entryMode).toBe('start_from_briefing');
    expect(campaign.suppliedBrief).toContain(url);
    expect(campaign.suppliedBrief).toContain(excerpt);
    expect(campaign.suppliedBrief).toContain('Creatieve route 1');
    expect(campaign.suppliedBrief).toContain(run.id);
    expect(campaign.stage).toBe('persona_selection');
  });
  it('drops invented excerpts and explains the shortfall', async () => {
    analysis([
      { ...proposal, excerpt: 'Deze bron belooft een gegarandeerde baan.' },
    ]);
    const result = await service().radar.scan(h.db, h.currentUser, input());
    expect(result.report.cards).toEqual([]);
    expect(result.report.notes.join(' ')).toContain('weggelaten');
  });
  it('compares source snapshots and keeps prior runs', async () => {
    analysis();
    const first = await service().radar.scan(h.db, h.currentUser, input());
    const second = await service().radar.scan(h.db, h.currentUser, input());
    const third = await service(
      excerpt + ' Het programma is uitgebreid.',
    ).radar.scan(h.db, h.currentUser, input());
    expect(first.report.cards[0]?.change).toBe('first_seen');
    expect(second.report.cards[0]?.change).toBe('unchanged');
    expect(third.report.cards[0]?.change).toBe('changed');
    expect(await h.db.select().from(radarRuns)).toHaveLength(3);
  });
  it('does not fetch or expose sources across label boundaries', async () => {
    analysis();
    const { radar, fetchPage } = service();
    const run = await radar.scan(h.db, h.currentUser, input());
    const other = labelIdBySlug(h.seed, 'demolabel-3');
    await expect(
      radar.requireRun(h.db, h.currentUser, other, run.id),
    ).rejects.toThrow();
    await expect(
      radar.scan(h.db, h.currentUser, { ...input(), labelId: other }),
    ).rejects.toThrow();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
  it('requires a real search result before fetching a discovered URL', async () => {
    vi.spyOn(
      h.appContext.services.generation,
      'generate',
    ).mockResolvedValueOnce({
      value: { urls: [url] },
      sources: [],
      promptVersion: 'v1',
      isMock: false,
      actualCostCents: 0,
      latencyMs: 0,
    });
    const { radar, fetchPage } = service();
    const result = await radar.scan(h.db, h.currentUser, {
      ...input(),
      urls: [],
      discover: true,
    });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.report.cards).toEqual([]);
    expect(result.report.notes.join(' ')).toContain('zoekresultaat');
  });
  it('refuses private source links and unavailable discovery before enqueue', async () => {
    const target = `/api/v1/labels/${labelId}/courses/${courseId}/radar/scan`;
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: target,
          payload: { discover: false, urls: ['http://169.254.169.254/latest'] },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: target,
          payload: { discover: true },
        })
      ).statusCode,
    ).toBe(501);
  });
  it('records unreadable pages and never fills them with invented findings', async () => {
    const s = h.appContext.services;
    const radar = new MarketRadarService(
      s.generation,
      s.courses,
      s.campaigns,
      s.brand,
      h.env,
      () =>
        Promise.resolve({
          ok: false,
          code: 'status_not_ok',
          reasonNl: 'Pagina niet bereikbaar.',
          finding: 'HTTP 403',
        }),
    );
    const result = await radar.scan(h.db, h.currentUser, input());
    expect(result.report.failures).toHaveLength(1);
    expect(result.report.cards).toEqual([]);
  });
  /**
   * The Concurrenten tab has one button that asks one question: who else offers
   * this course. Answering it does not require a doelgroepanalyse, zoekvragen,
   * advertenties or a marktbeeld, and running them anyway costs four extra model
   * calls per sweep for output nobody on that tab asked for (2026-09-16).
   */
  it('keeps a provider sweep to the one question it asks, and says what it skipped', async () => {
    const generate = analysis();
    const run = await service().radar.scan(h.db, h.currentUser, {
      ...input(),
      focus: 'providers',
    });
    // The audience report travels on because later steps read its fields; what
    // must not happen is that it claims there were no readable sources.
    expect(run.report.audience?.findings).toEqual([]);
    expect(run.report.audience?.notes.join(' ')).toContain('Overgeslagen');
    expect(run.report.keywords).toBeNull();
    expect(run.report.advertising).toBeNull();
    expect(run.report.insights).toEqual([]);
    expect(run.report.notes.some((note) => note.includes('overgeslagen'))).toBe(true);
    // The pages are still read and judged; only the extra analyses are gone.
    expect(run.report.cards).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('extracts only safe image metadata and normalizes tracking without losing meaningful queries', () => {
    expect(
      pageImage('<meta content="/cover.jpg" property="og:image">', url),
    ).toBe('https://example.org/cover.jpg');
    expect(
      pageImage('<meta property="og:image" content="http://127.0.0.1/x">', url),
    ).toBeNull();
    expect(
      canonicalUrl('https://example.org/course?utm_source=x&language=nl#part'),
    ).toBe('https://example.org/course?language=nl');
  });
});
