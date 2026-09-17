import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
  creativeResearchSnapshot, FRESHNESS_HOURS, radarReport, runSourceSnapshot, statableFacts,
  type BrandProfileVersion, type BriefVersion, type Campaign, type ConceptVersion,
  type CourseVersion, type CreativeResearchSnapshot, type CreativeResearchSource,
  type MarketingChannel, type PersonaVersion,
} from '@c360/contracts';
import { radarRuns, researchFindings, researchRuns, sources } from '../../core/db/schema.js';
import type { Db } from '../../core/db/types.js';
import { AppError } from '../../core/errors/app-error.js';
import { inspectUrl } from '../../core/net/index.js';
import type { CoursePageText } from './course-page.js';

const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SOURCES = 20;
const guides: Partial<Record<MarketingChannel, { url: string; title: string; role: string; adaptation: string; interpretation: string }>> = {
  linkedin_organic: {
    url: 'https://news.linkedin.com/2026/ImprovingTheFeed', title: 'LinkedIn — Improving the feed (12 maart 2026)',
    role: 'Redactionele hypothese: een relevant professioneel inzicht bespreekbaar maken.',
    adaptation: 'Behoud het campagnebeeld en de visuele kern; verbind de kop aan een herkenbare werksituatie en licht het inzicht toe zonder engagementbait.',
    interpretation: 'LinkedIn beschrijft meer relevante professionele inhoud en minder generieke, repetitieve inhoud. Dit bewijst geen bereik of voorkeur van deze persona.',
  },
  instagram_organic: {
    url: 'https://about.fb.com/news/2024/10/best-practices-education-hub-creators-instagram/', title: 'Instagram — Best Practices voor creators (1 oktober 2024)',
    role: 'Redactionele hypothese: de campagnegedachte via een direct begrijpelijk beeld introduceren.',
    adaptation: 'Behoud hetzelfde onderwerp, de beeldlogica en merkstijl; pas uitsnede, teksthiërarchie en caption aan de beschikbare beeldruimte aan. Speelsheid alleen als die bij merk en boodschap past.',
    interpretation: 'Instagram biedt algemene en accountspecifieke aanbevelingen in het professionele dashboard. De bron zegt niet dat iedere doelgroep een speelse aanpak wil.',
  },
  facebook_organic: {
    url: 'https://about.fb.com/news/2026/03/rewarding-original-creators-on-facebook/', title: 'Facebook — Original creators (maart 2026)',
    role: 'Redactionele hypothese: een herkenbare situatie en een inhoudelijk gesprek ondersteunen.',
    adaptation: 'Vertel dezelfde campagnegedachte in een herkenbare situatie, met oorspronkelijke inhoud en een oprechte vraag; vermijd nagebootste concurrentbeelden en engagementbait.',
    interpretation: 'Facebook beschrijft de voorkeur voor oorspronkelijke inhoud. Dit bewijst geen conversie-effect of mediagebruik van de gekozen persona.',
  },
};

export interface PrepareCreativeResearchInput {
  labelId: string;
  campaign: Pick<Campaign, 'id' | 'labelId' | 'courseVersionId' | 'radarRunId'>;
  brief: Pick<BriefVersion, 'id' | 'campaignId' | 'evidence' | 'channelRoles'>;
  concept: Pick<ConceptVersion, 'id' | 'campaignId' | 'coreIdea' | 'visualApproach' | 'artDirection'>;
  brandProfile: Pick<BrandProfileVersion, 'id' | 'labelId' | 'rules'>;
  course: Pick<CourseVersion, 'id' | 'labelId' | 'name' | 'facts'>;
  personas: readonly Pick<PersonaVersion, 'id' | 'labelId' | 'name' | 'need' | 'assumptions' | 'grounding' | 'orientationSources'>[];
  channels: readonly MarketingChannel[];
  coursePage: CoursePageText | null;
  previousSnapshots: readonly unknown[];
  /** The deployment supplies its bounded SSRF-protected page reader. */
  fetchPage?: ((url: string | null) => Promise<CoursePageText | null>) | undefined;
  signal?: AbortSignal | undefined;
  now?: Date | undefined;
}

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalise = (text: string): string => text.replace(/\s+/gu, ' ').trim();
function date(value: string | null | undefined): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
function publicUrl(value: string): string | null {
  const checked = inspectUrl(value, { allowedHostSuffixes: [], allowInsecureHttp: false });
  if (!checked.ok) return null;
  checked.url.hash = '';
  for (const key of [...checked.url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/u.test(key)) checked.url.searchParams.delete(key);
  return checked.url.toString();
}

/**
 * A source audit and a shared campaign anchor, not another model call.
 * Existing claims remain recorded evidence; refreshed text never retroactively
 * verifies a persona, advertisement image or reported performance.
 */
export async function prepareCreativeResearch(db: Db, input: PrepareCreativeResearchInput): Promise<CreativeResearchSnapshot> {
  input.signal?.throwIfAborted();
  if (input.campaign.labelId !== input.labelId || input.brandProfile.labelId !== input.labelId ||
      input.course.labelId !== input.labelId || input.campaign.courseVersionId !== input.course.id ||
      input.brief.campaignId !== input.campaign.id || input.concept.campaignId !== input.campaign.id ||
      input.personas.some(persona => persona.labelId !== input.labelId)) {
    throw AppError.notFoundOrForbidden('creative_research', input.campaign.id);
  }
  const now = input.now ?? new Date();
  const channels = [...new Set(input.channels)];
  const [radarRows, runRows, liveSources] = await Promise.all([
    input.campaign.radarRunId ? db.select().from(radarRuns).where(and(
      eq(radarRuns.id, input.campaign.radarRunId), eq(radarRuns.labelId, input.labelId), eq(radarRuns.courseVersionId, input.course.id),
    )).limit(1) : Promise.resolve([]),
    db.select().from(researchRuns).where(and(eq(researchRuns.labelId, input.labelId), eq(researchRuns.courseVersionId, input.course.id), eq(researchRuns.status, 'completed'))).orderBy(desc(researchRuns.version)).limit(1),
    db.select().from(sources).where(and(eq(sources.labelId, input.labelId), eq(sources.isActive, true))).limit(201),
  ]);
  const radar = radarRows[0];
  const parsedRadar = radarReport.safeParse(radar?.report);
  const report = parsedRadar.success ? parsedRadar.data : null;
  const run = runRows[0];
  const parsedSnapshot = runSourceSnapshot.array().safeParse(run?.sourcesSnapshot);
  const sourceSnapshot = parsedSnapshot.success ? parsedSnapshot.data : [];
  const currentResearch = run !== undefined && parsedSnapshot.success && liveSources.length > 0 && liveSources.length <= 200 &&
    sourceSnapshot.length === liveSources.length && liveSources.every(source => {
      const seen = sourceSnapshot.find(snapshot => snapshot.sourceId === source.id);
      const sensitivity = source.timeSensitivity === 'high' || source.timeSensitivity === 'low' ? source.timeSensitivity : 'medium';
      const retrieved = date(seen?.retrievedAt);
      return seen !== undefined && retrieved !== null && seen.failureNl === null && source.lastFailureNl === null &&
        seen.contentSha256 !== null && seen.contentSha256 === source.contentSha256 && Date.parse(retrieved) <= now.getTime() &&
        now.getTime() - Date.parse(retrieved) <= FRESHNESS_HOURS[sensitivity] * 3_600_000;
    });
  const inputKey = hash({
    version: 'creative-research-v1', label: input.labelId, campaign: input.campaign.id,
    brief: input.brief.id, concept: input.concept.id, brand: input.brandProfile.id, course: input.course.id,
    personas: input.personas.map(persona => persona.id).sort(), channels: [...channels].sort(),
    radar: input.campaign.radarRunId ?? null, radarReport: radar ? hash(radar.report) : null,
    research: run?.id ?? null, currentResearch,
    sourceState: liveSources.map(source => [source.id, source.contentSha256, source.lastFailureNl, source.timeSensitivity]).sort(),
    coursePage: input.coursePage ? [input.coursePage.url, hash(input.coursePage.text)] : null,
    refreshAvailable: input.fetchPage !== undefined,
  });
  const cached = input.previousSnapshots.flatMap(value => {
    const parsed = creativeResearchSnapshot.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  }).find(snapshot => snapshot.inputKey === inputKey && snapshot.campaignId === input.campaign.id &&
    Date.parse(snapshot.createdAt) <= now.getTime() && now.getTime() - Date.parse(snapshot.createdAt) <= CACHE_MS);
  if (cached) return cached;

  const gaps = [
    'Geen nieuwe AI-webzoekopdracht: bestaande campagnebronnen worden hergebruikt; maximaal twee gekoppelde radarpagina’s worden opnieuw gelezen.',
    'Advertentiebeelden zijn niet visueel onderzocht; een bronlink of screenshotregistratie is geen creatieve beeldanalyse.',
    'Geen waargenomen campagneprestaties: bereik, klikratio en conversie-effect van deze aanpak zijn onbekend.',
    'Bronmomenten blijven zichtbaar. De creatieve bronbundel wordt maximaal zeven dagen hergebruikt bij ongewijzigde invoer; dit is een redactionele cachetermijn, geen bewijs van actualiteit.',
  ];
  if (!currentResearch) gaps.push(run ? 'Het laatste afgeronde brononderzoek is niet meer actueel; de bevindingen zijn niet als actuele onderzoeksbron meegenomen.' : 'Er is geen afgerond brononderzoek voor deze opleiding.');
  if (input.campaign.radarRunId && !report) gaps.push('De gekoppelde radarrun is niet beschikbaar binnen dit label en deze opleiding, of heeft geen leesbaar bronrapport.');
  if (report?.isMock) gaps.push('De gekoppelde radarrun bevat demomateriaal; dit is geen werkelijk uitgevoerd marktonderzoek.');
  const candidates: { source: CreativeResearchSource; priority: number }[] = [];
  const orientationIds = new Map<MarketingChannel, string[]>();
  const add = (source: CreativeResearchSource, priority: number): string => {
    const bounded = { ...source, id: source.id.slice(0, 160), title: source.title.slice(0, 250), sourceRef: source.sourceRef.slice(0, 2000),
      retrievedAt: date(source.retrievedAt), excerpt: source.excerpt.slice(0, 2200), interpretation: source.interpretation.slice(0, 1200), limitation: source.limitation.slice(0, 600) };
    const existing = candidates.find(item => item.source.kind === bounded.kind && item.source.sourceRef === bounded.sourceRef && item.source.excerpt === bounded.excerpt && item.source.interpretation === bounded.interpretation);
    if (existing) return existing.source.id;
    candidates.push({ source: bounded, priority });
    return bounded.id;
  };
  for (const channel of channels) {
    const guide = guides[channel];
    if (guide) add({ id: `guide:${channel}`, kind: 'channel_guidance', title: guide.title, sourceRef: guide.url,
      retrievedAt: null, excerpt: '', interpretation: guide.interpretation, status: 'editorial_guidance',
      limitation: 'Handmatig nagekeken op 14 september 2026; niet opnieuw opgehaald in deze run. Kanaaladvies blijft een redactionele hypothese zonder eigen doelgroep- en accountdata.' }, 10);
  }
  for (const persona of input.personas) {
    for (const [index, orientation] of persona.orientationSources.entries()) {
      const relevant = orientation.channel === null ? channels : channels.filter(channel => channel === orientation.channel);
      if (relevant.length === 0) continue;
      if (!orientation.grounding) {
        gaps.push(`${persona.name}: mediagebruik blijft een aanname — ${orientation.statementNl}`);
        continue;
      }
      const id = add({ id: `orientation:${persona.id}:${String(index)}`, kind: 'persona', title: `${persona.name} — mediagebruik`, sourceRef: orientation.grounding.sourceRef,
        retrievedAt: orientation.grounding.retrievedAt, excerpt: orientation.grounding.claim,
        interpretation: orientation.statementNl, status: 'recorded',
        limitation: 'Vastgelegde persona-onderbouwing, geen opnieuw gecontroleerde bronpassage of bewijs dat het gehele publiek dit kanaal gebruikt.' }, 20);
      for (const channel of relevant) orientationIds.set(channel, [...(orientationIds.get(channel) ?? []), id]);
    }
    for (const [index, grounding] of persona.grounding.slice(0, 2).entries()) add({
      id: `persona:${persona.id}:${String(index)}`, kind: 'persona', title: `${persona.name} — vastgelegde onderbouwing`,
      sourceRef: grounding.sourceRef, retrievedAt: grounding.retrievedAt, excerpt: grounding.claim,
      interpretation: 'Meegegeven onderbouwing van de gekozen persona; de persona blijft een model van een doelgroep.', status: 'recorded',
      limitation: 'Dit is de opgeslagen claim, geen letterlijke bronpassage die in deze run is geverifieerd.' }, 55);
  }
  if (currentResearch && run) {
    const findings = await db.select().from(researchFindings).where(and(eq(researchFindings.labelId, input.labelId), eq(researchFindings.runId, run.id))).limit(6);
    for (const finding of findings) add({ id: `research:${finding.id}`, kind: 'research', title: finding.claim,
      sourceRef: finding.sourceRef, retrievedAt: finding.retrievedAt.toISOString(), excerpt: finding.excerpt,
      interpretation: finding.claim, status: 'recorded', limitation: `Eerder vastgelegd brononderzoek; de oorspronkelijke bronpassage wordt hergebruikt, niet opnieuw geverifieerd. ${finding.uncertaintyNl ?? ''}` }, 30);
  }
  if (report && !report.isMock) {
    for (const card of report.cards.slice(0, 6)) add({ id: `radar:${card.id}`, kind: 'radar', title: card.title,
      sourceRef: card.sourceUrl, retrievedAt: date(card.retrievedAt), excerpt: card.excerpt,
      interpretation: `${card.observation} Relevantie volgens de vastgelegde radar: ${card.relevance}`, status: 'recorded',
      limitation: `Opgeslagen pagina-observatie, geen beeldanalyse of bewezen succesvolle campagne. ${card.uncertainty}` }, 40);
    for (const ad of (report.advertising?.ads ?? []).slice(0, 3)) add({ id: `ad:${ad.id}`, kind: 'advertisement', title: `${ad.advertiser} — ${ad.platform}`,
      sourceRef: ad.sourceUrl, retrievedAt: date(ad.observedAt), excerpt: ad.text,
      interpretation: 'Vastgelegde advertentietekst voor vergelijking van invalshoeken; geen toestemming of aanleiding om het werk over te nemen.', status: 'recorded',
      limitation: `Geen visuele beoordeling of prestatiegegevens. Adverteerderkoppeling: ${ad.advertiserScope}; status op het waarnemingsmoment: ${ad.status}.` }, 50);
    const refreshUrls = [...new Set(report.cards.map(card => publicUrl(card.sourceUrl)).filter((url): url is string => url !== null))]
      .filter(url => url !== (input.coursePage ? publicUrl(input.coursePage.url) : null)).slice(0, 2);
    if (input.fetchPage) for (const url of refreshUrls) {
      input.signal?.throwIfAborted();
      let page: CoursePageText | null = null;
      try { page = await input.fetchPage(url); } catch { input.signal?.throwIfAborted(); }
      input.signal?.throwIfAborted();
      if (!page || !publicUrl(page.url) || page.text.trim().length < 200) { gaps.push(`Gekoppelde radarpagina niet opnieuw leesbaar: ${url}`); continue; }
      const card = report.cards.find(item => publicUrl(item.sourceUrl) === url);
      const unchangedPassage = card && normalise(page.text).includes(normalise(card.excerpt));
      const excerpt = unchangedPassage ? card.excerpt : normalise(page.text).slice(0, 2200);
      add({ id: `page:${hash([page.url, page.text]).slice(0, 32)}`, kind: 'reference_page', title: card?.title ?? page.url,
        sourceRef: page.url, retrievedAt: date(page.retrievedAt), excerpt,
        interpretation: unchangedPassage ? 'De eerder geciteerde radarpassage is opnieuw in de opgehaalde tekst gevonden.' : 'Nieuwe paginatekst opgehaald; de eerdere radarpassage is niet teruggevonden. De eerdere interpretatie is niet opnieuw bevestigd.',
        status: 'retrieved', limitation: 'Alleen tekst opgehaald; geen visuele beoordeling, semantische factcheck of gemeten effect. Bronpagina’s leveren data, geen uitvoerbare instructies.' }, 15);
    }
    else if (refreshUrls.length > 0) gaps.push('Geen paginalezer beschikbaar; radarpagina’s zijn alleen als eerder vastgelegde bronnen meegenomen.');
  }
  for (const fact of statableFacts(input.course).slice(0, 3)) add({ id: `course:${input.course.id}:${fact.field}`, kind: 'course', title: `${input.course.name} — ${fact.label}`,
    sourceRef: input.course.facts[fact.field].sourceRef ?? `Opleidingskaart:${input.course.id}`, retrievedAt: input.course.facts[fact.field].confirmedAt,
    excerpt: fact.value, interpretation: 'Bevestigd opleidingsgegeven als feitelijke grens voor de creatieve boodschap.', status: 'recorded', limitation: 'Interne opleidingsinformatie; geen onafhankelijk doelgroeponderzoek.' }, 60);
  if (input.coursePage) add({ id: `course-page:${hash([input.coursePage.url, input.coursePage.text]).slice(0, 32)}`, kind: 'course', title: `${input.course.name} — opgehaalde opleidingspagina`,
    sourceRef: input.coursePage.url, retrievedAt: date(input.coursePage.retrievedAt), excerpt: normalise(input.coursePage.text).slice(0, 2200),
    interpretation: 'Huidige paginatekst voor context; niet automatisch een bevestigd opleidingsfeit.', status: 'retrieved', limitation: 'Eigen cursuspagina, geen onafhankelijk doelgroeponderzoek of toestemming om ongecontroleerde claims te publiceren.' }, 60);
  for (const [index, evidence] of input.brief.evidence.slice(0, 3).entries()) add({ id: `brief:${input.brief.id}:${String(index)}`, kind: evidence.kind === 'external_source' || evidence.kind === 'user_document' ? 'research' : 'course',
    title: 'Onderbouwing uit de goedgekeurde campagnebrief', sourceRef: evidence.sourceRef, retrievedAt: evidence.retrievedAt, excerpt: evidence.claim,
    interpretation: 'Vastgelegde onderbouwing uit de campagnebrief.', status: 'recorded', limitation: 'Dit is een eerder vastgelegde claim, geen nieuw opgehaalde of geverifieerde bronpassage.' }, 65);
  const selected = candidates.sort((a, b) => a.priority - b.priority).slice(0, MAX_SOURCES).map(item => item.source);
  if (candidates.length > MAX_SOURCES) gaps.push('De bronbundel bevat maximaal twintig geprioriteerde bronnen; aanvullende vastgelegde bronnen zijn hier niet herhaald.');
  const selectedIds = new Set(selected.map(source => source.id));
  for (const channel of channels) if (!(orientationIds.get(channel) ?? []).some(id => selectedIds.has(id))) gaps.push(`Geen onderbouwd mediagebruik voor ${channel} bij de gekozen persona’s; de kanaalaanpassing is een redactionele hypothese.`);
  const hasRecorded = selected.some(source => ['research', 'radar', 'advertisement'].includes(source.kind) || source.kind === 'persona' && publicUrl(source.sourceRef) !== null);
  return creativeResearchSnapshot.parse({
    id: `creative-research:${randomUUID()}`, version: 'creative-research-v1', createdAt: now.toISOString(), inputKey,
    campaignId: input.campaign.id, briefVersionId: input.brief.id, conceptVersionId: input.concept.id, brandProfileVersionId: input.brandProfile.id,
    courseVersionId: input.course.id, personaVersionIds: input.personas.map(persona => persona.id),
    campaignIdea: input.concept.coreIdea, visualAnchor: input.concept.visualApproach,
    sharedStyle: input.concept.artDirection ? `${input.concept.artDirection.medium}; ${input.concept.artDirection.lighting}; ${input.concept.artDirection.treatment}` : 'De goedgekeurde visuele aanpak en merkregels blijven leidend.',
    brandRules: input.brandProfile.rules.map(rule => `${rule.kind}: ${rule.text}`),
    personas: input.personas.map(persona => ({ id: persona.id, name: persona.name, need: persona.need, assumptions: persona.assumptions })),
    channels: channels.map(channel => ({ channel,
      role: input.brief.channelRoles.find(role => role.channel === channel)?.roleNl ?? guides[channel]?.role ?? 'Redactionele kanaalhypothese: ondersteun dezelfde campagneboodschap.',
      adaptation: guides[channel]?.adaptation ?? 'Behoud de campagnegedachte, het hoofdonderwerp en de merkstijl; pas de uitvoering aan het kanaal aan.',
      sourceIds: [...(selectedIds.has(`guide:${channel}`) ? [`guide:${channel}`] : []), ...(orientationIds.get(channel) ?? []).filter(id => selectedIds.has(id))],
    })), sources: selected, gaps: [...new Set(gaps)].slice(0, 30),
    mode: selected.some(source => source.kind === 'reference_page') ? 'refreshed_pages' : hasRecorded ? 'recorded_sources' : 'brief_only',
  });
}
