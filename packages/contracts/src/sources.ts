import { z } from 'zod';
import { isoTimestamp, uuid, versionNumber, webUrl } from './primitives.js';
import { groundingKind } from './personas.js';

/**
 * Sources and research runs.
 *
 * A **source** is something a label has decided is worth reading: a course page,
 * a brand page, an uploaded document. A **run** reads the active sources for one
 * course and produces **findings** — each a single claim with the source it came
 * from, when that source was retrieved, and the passage it rests on.
 *
 * Three rules shape the model, and each one is a requirement rather than a
 * preference:
 *
 *  - **A finding is worthless without its provenance.** `sourceRef`,
 *    `retrievedAt` and `excerpt` are all non-nullable. A claim with no passage
 *    behind it cannot be checked by a reviewer, so it is not a finding.
 *  - **Retrieved content is data.** It is quoted and attributed, never followed.
 *    The prompt layer puts it in the user message; nothing from a source reaches
 *    the system rules (threat T-05).
 *  - **Staleness is computable, not guessed.** A run records the exact sources
 *    it read and the content hash of each. Whether it is still current is then a
 *    comparison, and the reason it went stale can be named.
 *
 * ## What is deliberately absent
 *
 * There is no automatic *discovery* of sources. Finding a page nobody named
 * needs a search engine, and there is none — so the capability reports itself
 * absent rather than being approximated. A label registers what it wants read.
 */

export const sourceKind = z.enum([
  /** The course's own page, usually carried over from the course card. */
  'course_page',
  /** A brand or organisation page. */
  'brand_page',
  /** A document someone uploaded. */
  'user_document',
  /** Any other page a label decided is worth reading. */
  'reference_page',
]);
export type SourceKind = z.infer<typeof sourceKind>;

/**
 * How quickly a source goes out of date.
 *
 * This is what makes "should we re-read it?" answerable without a person
 * deciding each time. Prices and dates move; a syllabus rarely does.
 */
export const timeSensitivity = z.enum([
  /** Prices, dates, availability. Re-read within days. */
  'high',
  /** Course content, conditions. Re-read within weeks. */
  'medium',
  /** Background and context. Re-read when something else changes. */
  'low',
]);
export type TimeSensitivity = z.infer<typeof timeSensitivity>;

/** How long a source of each sensitivity stays current, in hours. */
export const FRESHNESS_HOURS: Readonly<Record<TimeSensitivity, number>> = Object.freeze({
  high: 24,
  medium: 24 * 14,
  low: 24 * 90,
});

export const source = z.object({
  id: uuid,
  labelId: uuid,
  kind: sourceKind,
  /** Present for every page source; null for an uploaded document. */
  url: webUrl.nullable(),
  /** Present for a document source; null for a page. */
  assetId: uuid.nullable(),
  /** What a person calls it. */
  title: z.string().min(1).max(300),
  timeSensitivity,
  /**
   * SHA-256 of the text last read from this source.
   *
   * The mechanism behind "changed inputs": a run stores the hash it saw, so a
   * source whose content moved is detectable without re-reading everything.
   */
  contentSha256: z.string().length(64).nullable(),
  lastRetrievedAt: isoTimestamp.nullable(),
  /** Why the last read failed, in Dutch. Null when the last read worked. */
  lastFailureNl: z.string().max(500).nullable(),
  isActive: z.boolean(),
  createdAt: isoTimestamp,
});
export type Source = z.infer<typeof source>;

export const createSourceInput = z.object({
  kind: sourceKind,
  url: z.string().min(1).max(2_000).optional(),
  assetId: uuid.optional(),
  title: z.string().min(1).max(300),
  timeSensitivity: timeSensitivity.default('medium'),
});
export type CreateSourceInput = z.infer<typeof createSourceInput>;

// ------------------------------------------------------------------ findings ---

/**
 * One claim, with everything a reviewer needs to check it.
 *
 * Note what is **not** nullable: the source reference, the retrieval date and
 * the excerpt. A claim without a passage behind it is an assertion, and the
 * whole point of a research run is to produce the opposite.
 */
export const researchFinding = z.object({
  id: uuid,
  runId: uuid,
  sourceId: uuid.nullable(),
  claim: z.string().min(3).max(400),
  kind: groundingKind,
  /** URL or document name. Never empty. */
  sourceRef: z.string().min(1).max(2_000),
  retrievedAt: isoTimestamp,
  /** The passage the claim rests on, quoted from the source. */
  excerpt: z.string().min(1).max(2_000),
  /** What the extractor was unsure about, in Dutch. */
  uncertaintyNl: z.string().max(500).nullable(),
});
export type ResearchFinding = z.infer<typeof researchFinding>;

/** What the model may propose for one finding. Provenance is added by us. */
export const findingProposal = z.object({
  claim: z.string().min(3).max(400),
  excerpt: z.string().min(1).max(2_000),
  uncertaintyNl: z.string().max(500).nullable(),
});
export type FindingProposal = z.infer<typeof findingProposal>;

export const findingProposalSet = z.object({
  findings: z.array(findingProposal).max(12),
  /**
   * Why fewer findings than asked for, in Dutch.
   *
   * Same rule as personas: a thin source produces few findings and says so,
   * rather than being padded to a target.
   */
  shortfallReasonNl: z.string().max(600).nullable(),
});
export type FindingProposalSet = z.infer<typeof findingProposalSet>;

// ---------------------------------------------------------------------- runs ---

export const researchRunStatus = z.enum(['running', 'completed', 'failed']);
export type ResearchRunStatus = z.infer<typeof researchRunStatus>;

/** One source as it was at run time, so change is detectable afterwards. */
export const runSourceSnapshot = z.object({
  sourceId: uuid,
  contentSha256: z.string().length(64).nullable(),
  retrievedAt: isoTimestamp.nullable(),
  /** Set when this source could not be read during the run. */
  failureNl: z.string().max(500).nullable(),
});
export type RunSourceSnapshot = z.infer<typeof runSourceSnapshot>;

export const researchRun = z.object({
  id: uuid,
  labelId: uuid,
  courseVersionId: uuid,
  version: versionNumber,
  status: researchRunStatus,
  /** Exactly which sources were read, and what they contained. */
  sources: z.array(runSourceSnapshot),
  findingCount: z.number().int().min(0),
  shortfallReasonNl: z.string().max(600).nullable(),
  promptVersion: z.string().max(40).nullable(),
  startedAt: isoTimestamp,
  finishedAt: isoTimestamp.nullable(),
  failureNl: z.string().max(500).nullable(),
});
export type ResearchRun = z.infer<typeof researchRun>;

/** Why a run is no longer current. Empty means it still is. */
export const stalenessReason = z.enum([
  'source_content_changed',
  'source_added',
  'source_removed',
  'source_too_old',
  'course_version_changed',
]);
export type StalenessReason = z.infer<typeof stalenessReason>;

export const runFreshness = z.object({
  isCurrent: z.boolean(),
  reasons: z.array(
    z.object({
      reason: stalenessReason,
      /** Dutch, for the person deciding whether to re-run. */
      detailNl: z.string().max(300),
    }),
  ),
});
export type RunFreshness = z.infer<typeof runFreshness>;

/**
 * Turns a finding into the grounding shape the rest of the product speaks.
 *
 * Personas, opportunities and briefs all consume `Grounding`, so a finding has
 * to arrive in that shape rather than each consumer learning a second one.
 */
export function toGrounding(finding: Pick<ResearchFinding, 'claim' | 'kind' | 'sourceRef' | 'retrievedAt'>): {
  claim: string;
  kind: z.infer<typeof groundingKind>;
  sourceRef: string;
  retrievedAt: string;
} {
  return {
    claim: finding.claim,
    kind: finding.kind,
    sourceRef: finding.sourceRef,
    retrievedAt: finding.retrievedAt,
  };
}
