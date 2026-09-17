import { keywordReport, marketPackage, packageSelection } from './market-package.js';
import { z } from 'zod';
import { webUrl } from './primitives.js';
import { audienceReport } from './audience.js';
import { advertisingReport } from './advertisements.js';
import { campaignObjective, funnelStage } from './funnel.js';

export const radarApproach = z.object({
  title: z.string().min(3).max(150),
  format: z.string().max(100),
  idea: z.string().min(10).max(1200),
  audience: z.string().max(300),
});
export const radarProposal = z.object({
  sourceUrl: webUrl.max(2000),
  organization: z.string().max(200),
  relationship: z.enum([
    'competitor',
    'adjacent',
    'own_brand',
    'authority',
    'uncertain',
  ]),
  relationshipReason: z.string().min(10).max(700),
  title: z.string().min(3).max(200),
  observation: z.string().min(10).max(1200),
  excerpt: z.string().min(20).max(1000),
  relevance: z.string().min(10).max(1000),
  publishedDate: z.string().max(100).nullable(),
  dateExcerpt: z.string().max(300).nullable(),
  period: z.string().max(200).nullable(),
  uncertainty: z.string().max(700),
  approaches: z.array(radarApproach).length(3),
});
export const radarAnalysis = z.object({
  cards: z.array(radarProposal).max(6),
  note: z.string().max(1000),
});
export const radarDiscovery = z.object({
  urls: z.array(z.url().max(2000)).max(10),
});
export const radarCard = radarProposal.extend({
  id: z.uuid(),
  retrievedAt: z.string(),
  contentHash: z.string(),
  imageUrl: z.url().nullable(),
  materialType: z.literal('web_page'),
  change: z.enum(['first_seen', 'changed', 'unchanged']),
});
export type RadarCard = z.infer<typeof radarCard>;
// ------------------------------------------------------------ Marktbeeld ---

/**
 * The market picture: insights synthesised across the run's verified evidence
 * (docs/product/market-radar-senior-design.md, slice 1).
 *
 * A card says what one page says. An insight says what several sources,
 * taken together, mean for this course — the unit a marketing lead decides
 * on. Every insight is written in the What → So what → Now what order and
 * points at the evidence items it rests on by id; the service drops any
 * insight whose evidence it cannot find in the same run, so an insight can
 * never rest on a source the reader cannot open.
 *
 * ## Confidence is computed, not claimed
 *
 * `confidence.evidence` is derived in code from the cited items — how many
 * independent domains, of which kinds — following the IPCC practice of
 * showing the two inputs (evidence, agreement) rather than one label. The
 * model states only `agreement`: whether the sources it cites agree, disagree
 * or cannot be compared. There is no field for a likelihood, a share or an
 * impact score, and no digit may appear in the meaning or action text unless
 * it is quoted from a cited excerpt.
 */
export const radarEvidenceKind = z.enum(['card', 'audience', 'competitor', 'keyword', 'advertisement']);
export type RadarEvidenceKind = z.infer<typeof radarEvidenceKind>;

export const radarEvidenceRef = z.object({
  kind: radarEvidenceKind,
  /** The id of a card, audience finding, keyword or advertisement in this run; for a competitor, its source URL. */
  id: z.string().min(1).max(2000),
});
export type RadarEvidenceRef = z.infer<typeof radarEvidenceRef>;

export const sourceAgreement = z.enum(['eens', 'tegenstrijdig', 'niet_te_beoordelen']);
export type SourceAgreement = z.infer<typeof sourceAgreement>;

/** What the model proposes; ids and confidence are added by the service. */
export const radarInsightProposal = z.object({
  /** The claim in one sentence — the headline a manager reads first. */
  headlineNl: z.string().min(10).max(200),
  /** Wat we zagen: facts only, each traceable to a cited item. */
  observationNl: z.string().min(20).max(900),
  /** En dus: what it means for this course, for a named audience, in one funnel stage. */
  meaningNl: z.string().min(20).max(700),
  /** Nu: the proposed action — the thing the hand-off turns into a campaign. */
  nowNl: z.string().min(10).max(500),
  /** At least one alternative reading of the same evidence (ICD 203 practice). */
  alternativeNl: z.string().min(10).max(500),
  /** Wat dit niet laat zien. */
  notShownNl: z.string().min(10).max(500),
  stage: funnelStage,
  suggestedObjective: campaignObjective,
  agreement: sourceAgreement,
  evidence: z.array(radarEvidenceRef).min(1).max(8),
});
export type RadarInsightProposal = z.infer<typeof radarInsightProposal>;

export const radarSynthesis = z.object({
  insights: z.array(radarInsightProposal).max(5),
  note: z.string().max(700),
});
export type RadarSynthesis = z.infer<typeof radarSynthesis>;

export const evidenceStrength = z.enum(['beperkt', 'gemiddeld', 'robuust']);
export type EvidenceStrength = z.infer<typeof evidenceStrength>;

export const insightConfidence = z.object({
  /** From the number of independent domains behind the cited evidence. */
  evidence: evidenceStrength,
  agreement: sourceAgreement,
  /** Distinct source domains behind the cited items. */
  independentDomains: z.number().int().nonnegative(),
  kinds: z.array(radarEvidenceKind),
});
export type InsightConfidence = z.infer<typeof insightConfidence>;

export const radarInsight = radarInsightProposal.extend({
  id: z.uuid(),
  confidence: insightConfidence,
});
export type RadarInsight = z.infer<typeof radarInsight>;

/** The grade from the count of independent domains: one is a single voice, three or more a pattern worth acting on. */
export function gradeEvidence(independentDomains: number): EvidenceStrength {
  return independentDomains >= 3 ? 'robuust' : independentDomains === 2 ? 'gemiddeld' : 'beperkt';
}

export const EVIDENCE_STRENGTH_NL: Readonly<Record<EvidenceStrength, string>> = Object.freeze({
  beperkt: 'Beperkt bewijs — één bron of één domein; een aanwijzing, geen patroon.',
  gemiddeld: 'Gemiddeld bewijs — twee onafhankelijke domeinen.',
  robuust: 'Robuust bewijs — drie of meer onafhankelijke domeinen.',
});

export const SOURCE_AGREEMENT_NL: Readonly<Record<SourceAgreement, string>> = Object.freeze({
  eens: 'bronnen zijn het eens',
  tegenstrijdig: 'bronnen spreken elkaar tegen',
  niet_te_beoordelen: 'overeenstemming niet te beoordelen',
});

/**
 * What changed since the previous scan of the same course, computed in code.
 *
 * Written as change notes (GOV.UK practice): one full sentence per change,
 * the most important first, so a returning reader sees what is new without
 * re-reading the whole picture. A changed page hash means the text changed,
 * not that the market moved — the note says exactly that.
 */
export const radarDigestItem = z.object({
  kind: z.enum(['card_new', 'card_changed', 'card_gone', 'competitor_new', 'keyword_new', 'ad_new', 'ad_coverage_changed']),
  noteNl: z.string().min(5).max(500),
  /** The item this note is about, when it exists in the current run. */
  ref: radarEvidenceRef.nullable(),
});
export type RadarDigestItem = z.infer<typeof radarDigestItem>;

export const radarDigest = z.object({
  previousRunId: z.uuid().nullable(),
  previousAt: z.string().nullable(),
  items: z.array(radarDigestItem).max(60),
});
export type RadarDigest = z.infer<typeof radarDigest>;

/**
 * What a competitor says, as quoted — never paraphrased and never ranked.
 *
 * Built in code from the run's verified competitor evidence so the
 * positioning view can put competitors' own words next to our confirmed
 * facts. A quote is reported, not endorsed.
 */
export const competitorClaim = z.object({
  organization: z.string().min(1).max(200),
  sourceUrl: webUrl.max(2000),
  excerpt: z.string().min(1).max(1000),
  retrievedAt: z.string(),
  /** Which run item the quote comes from. */
  ref: radarEvidenceRef,
});
export type CompetitorClaim = z.infer<typeof competitorClaim>;

export const radarReport = z.object({
  /** Saved competitors selected for this run, frozen so later registry edits cannot rewrite it. */
  trackedCompetitors: z.array(z.object({ id: z.uuid(), name: z.string(), sourceUrl: webUrl })).default([]).optional(),
  keywords: keywordReport.nullable().default(null),
  package: marketPackage.nullable().default(null),
  audience: audienceReport.nullable().default(null),
  advertising: advertisingReport.nullable().default(null),
  cards: z.array(radarCard),
  notes: z.array(z.string()),
  failures: z.array(z.object({ url: z.string(), reason: z.string() })),
  isMock: z.boolean(),
  /** The market picture; empty for reports from before synthesis existed. */
  insights: z.array(radarInsight).default([]),
  digest: radarDigest.nullable().default(null),
  claims: z.array(competitorClaim).default([]),
});
export type RadarReport = z.infer<typeof radarReport>;
export interface RadarRun {
  id: string;
  courseVersionId: string;
  createdAt: string;
  report: RadarReport;
}
/**
 * What a scan goes looking for.
 *
 * `market` is the broad sweep the radar has always done: competing courses,
 * organisations that address the same audience, primary professional sources.
 * It is deliberately mixed, because a market is not only its suppliers.
 *
 * `providers` narrows the search to organisations that offer this course or an
 * equivalent one — the question "who else teaches this?" asked on its own. It
 * is still a **bounded search over public pages**, never a register: what it
 * does not find is not proven absent, and the scan's own notes say so.
 *
 * `competitors` looks for nothing new at all. It re-reads the providers already
 * in the registry, which is what you want when the list is settled and you only
 * want to know what changed on their pages.
 */
export const radarScanFocus = z.enum(['market', 'providers', 'competitors']);
export type RadarScanFocus = z.infer<typeof radarScanFocus>;

export const RADAR_FOCUS_LABEL_NL: Readonly<Record<RadarScanFocus, string>> = Object.freeze({
  market: 'De hele markt',
  providers: 'Aanbieders van deze opleiding',
  competitors: 'Alleen de opgeslagen concurrenten',
});

export const radarScanInput = z.object({
  urls: z.array(z.url().max(2000)).max(10).default([]),
  discover: z.boolean().default(true),
  /** What to look for. `competitors` reads the registry and searches for nothing. */
  focus: radarScanFocus.default('market'),
  includeKeywords: z.boolean().default(true),
  deliverables: packageSelection.default([]),
  includeAds: z.boolean().default(true),
});
