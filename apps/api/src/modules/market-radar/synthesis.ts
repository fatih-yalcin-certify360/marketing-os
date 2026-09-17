import { randomUUID } from 'node:crypto';
import {
  gradeEvidence,
  radarSynthesis,
  type CompetitorClaim,
  type RadarCard,
  type RadarDigest,
  type RadarDigestItem,
  type RadarEvidenceRef,
  type RadarInsight,
  type RadarReport,
} from '@c360/contracts';

/**
 * The market picture, verified (docs/product/market-radar-senior-design.md, slice 1).
 *
 * Three things a senior reading of a scan needs that the per-page cards do
 * not give, each built here from the run's *verified* items and nothing else:
 *
 *  - **Insights** across sources, proposed by the model and checked in code:
 *    every cited evidence id must exist in this run, every number in the
 *    observation must be quoted from a cited passage, and the words the
 *    product refuses (percentages, "significant", "trend", "gemiddeld in de
 *    markt") may not appear. Confidence is computed from the cited evidence —
 *    how many independent domains — not stated by the model.
 *  - **A digest** of what changed since the previous scan of the same course,
 *    as change notes, computed by comparing the two reports.
 *  - **Competitor claims** as quoted, so a positioning view can put a
 *    competitor's own words next to our confirmed facts without paraphrase.
 *
 * Also here: the redaction of e-mail addresses and phone numbers from text
 * that is stored, exported and copied into briefs. It runs *after* the
 * excerpt-in-page verification, because a redacted excerpt would no longer be
 * found in the page. Names cannot be redacted reliably and are refused at the
 * prompt; that residual risk is documented, not hidden.
 */

/** Everything an insight may cite, flattened to (kind, id, domain, excerpt). */
export interface EvidenceItem {
  ref: RadarEvidenceRef;
  domain: string;
  excerpt: string;
  organization: string;
  sourceUrl: string;
  retrievedAt: string;
  kindNl: string;
}

const domainOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return url;
  }
};

export function evidenceItems(report: Pick<RadarReport, 'cards' | 'audience' | 'keywords' | 'advertising'>): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const card of report.cards) {
    items.push({
      ref: { kind: 'card', id: card.id },
      domain: domainOf(card.sourceUrl),
      excerpt: card.excerpt,
      organization: card.organization,
      sourceUrl: card.sourceUrl,
      retrievedAt: card.retrievedAt,
      kindNl: 'kans',
    });
  }
  for (const finding of report.audience?.findings ?? []) {
    items.push({
      ref: { kind: 'audience', id: finding.id },
      domain: domainOf(finding.sourceUrl),
      excerpt: finding.excerpt,
      organization: finding.organization,
      sourceUrl: finding.sourceUrl,
      retrievedAt: finding.retrievedAt,
      kindNl: 'doelgroepbevinding',
    });
  }
  for (const competitor of report.audience?.competitors ?? []) {
    items.push({
      ref: { kind: 'competitor', id: competitor.sourceUrl },
      domain: domainOf(competitor.sourceUrl),
      excerpt: competitor.excerpt,
      organization: competitor.organization,
      sourceUrl: competitor.sourceUrl,
      retrievedAt: '',
      kindNl: 'concurrent',
    });
  }
  for (const keyword of report.keywords?.items ?? []) {
    items.push({
      ref: { kind: 'keyword', id: keyword.id },
      domain: domainOf(keyword.sourceUrl),
      excerpt: keyword.excerpt,
      organization: domainOf(keyword.sourceUrl),
      sourceUrl: keyword.sourceUrl,
      retrievedAt: keyword.retrievedAt,
      kindNl: 'zoekvraag',
    });
  }
  for (const ad of report.advertising?.ads ?? []) {
    items.push({
      ref: { kind: 'advertisement', id: ad.id },
      domain: domainOf(ad.sourceUrl),
      excerpt: ad.text.slice(0, 1000),
      organization: ad.advertiser,
      sourceUrl: ad.sourceUrl,
      retrievedAt: ad.observedAt,
      kindNl: 'advertentie',
    });
  }
  return items;
}

/** The evidence bundle the model reads: ids, domains and passages, nothing else. */
export function evidenceForPrompt(items: readonly EvidenceItem[]): unknown {
  return items.map((item) => ({
    kind: item.ref.kind,
    id: item.ref.id,
    organization: item.organization,
    domain: item.domain,
    sourceUrl: item.sourceUrl,
    retrievedAt: item.retrievedAt,
    excerpt: item.excerpt,
  }));
}

const REFUSED_WORDS = /\d+\s*%|\bprocent\b|\bsignificant\w*\b|\btrend\w*\b|gemiddeld in de markt/iu;
const normalize = (text: string): string => text.replace(/[\s\u200b]+/gu, ' ').trim().toLowerCase();

/**
 * Keeps only insights that rest on this run's evidence and say nothing the
 * evidence does not carry. Returns the kept insights and a Dutch note per
 * dropped one, so the shortfall is visible rather than silent.
 */
export function verifyInsights(
  value: unknown,
  items: readonly EvidenceItem[],
): { insights: RadarInsight[]; notes: string[] } {
  const notes: string[] = [];
  const parsed = radarSynthesis.safeParse(value);
  if (!parsed.success) {
    notes.push('Geen bruikbaar marktbeeld ontvangen; er zijn geen inzichten ingevuld.');
    return { insights: [], notes };
  }
  if (parsed.data.note.trim().length > 0) notes.push(parsed.data.note.trim());
  const byKey = new Map(items.map((item) => [`${item.ref.kind}:${item.ref.id}`, item]));
  const insights: RadarInsight[] = [];
  for (const proposal of parsed.data.insights) {
    const cited = proposal.evidence
      .map((ref) => byKey.get(`${ref.kind}:${ref.id}`))
      .filter((item): item is EvidenceItem => item !== undefined);
    if (cited.length === 0) {
      notes.push(`Inzicht weggelaten: geen bewijs uit deze scan gevonden voor "${proposal.headlineNl}".`);
      continue;
    }
    const text = `${proposal.headlineNl} ${proposal.observationNl} ${proposal.meaningNl} ${proposal.nowNl} ${proposal.alternativeNl}`;
    if (REFUSED_WORDS.test(text)) {
      notes.push(`Inzicht weggelaten: bevat een percentage, trend- of significantieclaim ("${proposal.headlineNl}").`);
      continue;
    }
    // A figure may only be quoted, never produced: every number in the
    // observation must occur in a cited passage; none may occur in the
    // meaning, the action or the headline.
    if (/\d/u.test(`${proposal.headlineNl} ${proposal.meaningNl} ${proposal.nowNl}`)) {
      notes.push(`Inzicht weggelaten: cijfer buiten de waarneming ("${proposal.headlineNl}").`);
      continue;
    }
    const passages = normalize(cited.map((item) => item.excerpt).join(' '));
    const unquoted = (proposal.observationNl.match(/\d+(?:[.,]\d+)?/gu) ?? []).filter(
      (number) => !passages.includes(number.toLowerCase()),
    );
    if (unquoted.length > 0) {
      notes.push(
        `Inzicht weggelaten: getal ${unquoted.join(', ')} staat niet in een geciteerde passage ("${proposal.headlineNl}").`,
      );
      continue;
    }
    const domains = new Set(cited.map((item) => item.domain));
    insights.push({
      ...proposal,
      evidence: cited.map((item) => item.ref),
      id: randomUUID(),
      confidence: {
        evidence: gradeEvidence(domains.size),
        agreement: cited.length < 2 && proposal.agreement === 'eens' ? 'niet_te_beoordelen' : proposal.agreement,
        independentDomains: domains.size,
        kinds: [...new Set(cited.map((item) => item.ref.kind))],
      },
    });
  }
  if (parsed.data.insights.length === 0) {
    notes.push('Geen inzichten: de scan leverde te weinig geverifieerd bewijs om een patroon te benoemen.');
  }
  return { insights, notes };
}

/** Competitors' own words, from the run's verified items: reported, never paraphrased. */
export function competitorClaims(report: Pick<RadarReport, 'cards' | 'audience'>): CompetitorClaim[] {
  const claims: CompetitorClaim[] = [];
  const seen = new Set<string>();
  for (const competitor of report.audience?.competitors ?? []) {
    const key = `${competitor.sourceUrl}|${normalize(competitor.excerpt)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({
      organization: competitor.organization,
      sourceUrl: competitor.sourceUrl,
      excerpt: competitor.excerpt,
      retrievedAt: '',
      ref: { kind: 'competitor', id: competitor.sourceUrl },
    });
  }
  for (const card of report.cards) {
    if (card.relationship !== 'competitor') continue;
    const key = `${card.sourceUrl}|${normalize(card.excerpt)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({
      organization: card.organization,
      sourceUrl: card.sourceUrl,
      excerpt: card.excerpt,
      retrievedAt: card.retrievedAt,
      ref: { kind: 'card', id: card.id },
    });
  }
  return claims;
}

const canonical = (value: string): string => {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/$/u, '');
  } catch {
    return value;
  }
};

/**
 * What changed since the previous scan, as change notes. Purely arithmetic
 * over two reports — no model — so the digest is exactly as true as the two
 * reports it compares. A hash change is reported as a text change, never as
 * a market movement.
 */
export function buildDigest(
  current: Pick<RadarReport, 'cards' | 'audience' | 'keywords' | 'advertising'>,
  previous: { id: string; createdAt: string; report: Pick<RadarReport, 'cards' | 'audience' | 'keywords' | 'advertising'> } | undefined,
): RadarDigest {
  if (previous === undefined) {
    return { previousRunId: null, previousAt: null, items: [] };
  }
  const items: RadarDigestItem[] = [];
  const when = new Date(previous.createdAt).toLocaleDateString('nl-NL');
  const prevCards = new Map(previous.report.cards.map((card) => [canonical(card.sourceUrl), card]));
  const currentCards = new Map(current.cards.map((card) => [canonical(card.sourceUrl), card]));
  for (const card of current.cards) {
    const prior = prevCards.get(canonical(card.sourceUrl));
    if (prior === undefined) {
      items.push({ kind: 'card_new', noteNl: `Nieuwe bron gelezen: ${card.organization} — ${card.title}.`, ref: { kind: 'card', id: card.id } });
    } else if (prior.contentHash !== card.contentHash) {
      items.push({
        kind: 'card_changed',
        noteNl: `De tekst van de bronpagina van ${card.organization} is gewijzigd sinds de scan van ${when}. Een gewijzigde tekst is geen marktbeweging; lees de passage opnieuw.`,
        ref: { kind: 'card', id: card.id },
      });
    }
  }
  for (const [url, card] of prevCards) {
    if (!currentCards.has(url)) {
      items.push({ kind: 'card_gone', noteNl: `Niet meer in deze scan: ${card.organization} — ${card.title}. Dat zegt niets over de bron zelf; de scan koos andere pagina's of kon deze niet lezen.`, ref: null });
    }
  }
  const prevCompetitors = new Set((previous.report.audience?.competitors ?? []).map((item) => domainOf(item.sourceUrl)));
  for (const competitor of current.audience?.competitors ?? []) {
    if (!prevCompetitors.has(domainOf(competitor.sourceUrl))) {
      items.push({ kind: 'competitor_new', noteNl: `Nieuwe aanbieder in beeld: ${competitor.organization}. Controleer de vergelijkbaarheid en een eventuele merkrelatie.`, ref: { kind: 'competitor', id: competitor.sourceUrl } });
    }
  }
  const prevPhrases = new Set((previous.report.keywords?.items ?? []).map((item) => normalize(item.phrase)));
  for (const keyword of current.keywords?.items ?? []) {
    if (!prevPhrases.has(normalize(keyword.phrase))) {
      items.push({ kind: 'keyword_new', noteNl: `Nieuwe ${keyword.kind === 'page_question' ? 'vraag op een bronpagina' : 'zoekvraag-hypothese'}: "${keyword.phrase}".`, ref: { kind: 'keyword', id: keyword.id } });
    }
  }
  const prevAds = new Set((previous.report.advertising?.ads ?? []).map((ad) => `${ad.platform}:${ad.libraryId}`));
  for (const ad of current.advertising?.ads ?? []) {
    if (!prevAds.has(`${ad.platform}:${ad.libraryId}`)) {
      items.push({ kind: 'ad_new', noteNl: `Nieuwe advertentie waargenomen van ${ad.advertiser} (${ad.platform}); status bij controle: ${ad.status}.`, ref: { kind: 'advertisement', id: ad.id } });
    }
  }
  const prevCoverage = new Map((previous.report.advertising?.coverage ?? []).map((item) => [`${item.platform}:${item.query}`, item.status]));
  for (const coverage of current.advertising?.coverage ?? []) {
    const before = prevCoverage.get(`${coverage.platform}:${coverage.query}`);
    if (before !== undefined && before !== coverage.status) {
      items.push({ kind: 'ad_coverage_changed', noteNl: `Advertentiecontrole ${coverage.platform}: eerder ${before}, nu ${coverage.status}. Een geblokkeerde of beperkte controle is geen bewijs dat er geen advertenties zijn.`, ref: null });
    }
  }
  return { previousRunId: previous.id, previousAt: previous.createdAt, items: items.slice(0, 60) };
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
// Dutch and international phone numbers: +31 6 12345678, 06-12345678, 020 123 4567.
const PHONE = /(?:\+31|0031|\b0)[\s-]?\d(?:[\s-]?\d){7,9}\b/gu;

/** Replaces e-mail addresses and phone numbers; returns whether anything was replaced. */
export function redactContactDetails(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  const result = text
    .replace(EMAIL, () => {
      redacted = true;
      return '[e-mailadres weggelaten]';
    })
    .replace(PHONE, () => {
      redacted = true;
      return '[telefoonnummer weggelaten]';
    });
  return { text: result, redacted };
}

/**
 * Redacts contact details from every stored passage of a report, after
 * verification. Returns the count of redactions so the report can say so.
 */
export function redactReport(report: {
  cards: RadarCard[];
  audience: RadarReport['audience'];
  keywords: RadarReport['keywords'];
  advertising: RadarReport['advertising'];
}): number {
  let count = 0;
  const apply = (value: string): string => {
    const { text, redacted } = redactContactDetails(value);
    if (redacted) count += 1;
    return text;
  };
  for (const card of report.cards) {
    card.excerpt = apply(card.excerpt);
    card.observation = apply(card.observation);
  }
  if (report.audience) {
    for (const finding of report.audience.findings) {
      finding.excerpt = apply(finding.excerpt);
      if (finding.sectorExcerpt) finding.sectorExcerpt = apply(finding.sectorExcerpt);
      if (finding.educationExcerpt) finding.educationExcerpt = apply(finding.educationExcerpt);
    }
    for (const competitor of report.audience.competitors) {
      competitor.excerpt = apply(competitor.excerpt);
    }
  }
  if (report.keywords) {
    for (const item of report.keywords.items) {
      item.excerpt = apply(item.excerpt);
    }
  }
  if (report.advertising) {
    for (const ad of report.advertising.ads) {
      ad.text = apply(ad.text);
      if (ad.deliveryInfo) ad.deliveryInfo = apply(ad.deliveryInfo);
    }
  }
  return count;
}
