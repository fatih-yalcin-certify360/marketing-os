import { z } from 'zod';
import { isoTimestamp, uuid } from './primitives.js';
import { reviewState } from './workflow.js';

/**
 * What a campaign taught, as a person wrote it down (P4-2).
 *
 * ## Three fields, not one conclusion
 *
 * A single "what we learned" box invites a sentence that reads as a proven
 * cause — "video works better for this audience" — from two campaigns and a
 * fortnight of data. So a learning is split:
 *
 *  - `observationNl` — what was actually measured.
 *  - `hypothesisNl` — what the author thinks it means. Explicitly a hypothesis.
 *  - `nextTestNl` — what would confirm or refute it. A hypothesis nobody could
 *    test is an opinion, and this field is what makes the difference visible.
 *
 * ## Written by a person, never computed
 *
 * The system does not derive learnings. It has four data points, not a data
 * set, and a correlation it computed would arrive with the authority of
 * arithmetic and none of the caution. What it *does* do is state how much
 * evidence a learning rests on, so a reader can judge thinness for themselves
 * — see `learningWithEvidence`.
 *
 * ## It cannot change a persona or a brand
 *
 * There is no field here that points at either, and the module has no write
 * access to them. An approved learning is **context handed to a later
 * proposal**, which a person reviews like any other proposal. Nothing about
 * approving a learning edits stored work.
 */

export const learningInput = z.object({
  /** The campaign it came from, when it came from one. */
  originCampaignId: uuid.nullable().default(null),
  observationNl: z.string().trim().min(20).max(1_000),
  hypothesisNl: z.string().trim().min(20).max(1_000),
  nextTestNl: z.string().trim().min(10).max(600),
  /**
   * The measured outcomes this rests on.
   *
   * Not required — a learning may be qualitative, and forcing a citation would
   * only teach people to attach an unrelated row. But an empty list is
   * reported as thin evidence rather than passing quietly.
   */
  outcomeReportIds: z.array(uuid).max(50).default([]),
});
export type LearningInput = z.infer<typeof learningInput>;
/** What a form may *send*: defaulted fields are optional and filled in by the parse. */
export type LearningInputData = z.input<typeof learningInput>;

export const learning = z.object({
  id: uuid,
  labelId: uuid,
  originCampaignId: uuid.nullable(),
  observationNl: z.string(),
  hypothesisNl: z.string(),
  nextTestNl: z.string(),
  reviewState,
  approvedAt: isoTimestamp.nullable(),
  approvedByUserId: uuid.nullable(),
  createdByUserId: uuid.nullable(),
  createdAt: isoTimestamp,
});
export type Learning = z.infer<typeof learning>;

/**
 * How much is behind a learning, stated rather than implied.
 *
 * The system cannot stop someone writing an overconfident hypothesis, and
 * pretending otherwise would be the dishonest move. What it can do is put the
 * size of the evidence next to the claim, every time the claim is shown or
 * handed to a model: *one* outcome over *four days* is a very different thing
 * from twelve over three months, and a reader who sees both numbers will not
 * mistake the first for a trend.
 */
export const evidenceSummary = z.object({
  outcomeCount: z.number().int().min(0),
  /** Distinct campaigns behind it. One campaign is one campaign. */
  campaignCount: z.number().int().min(0),
  /** Days from the earliest period start to the latest period end. */
  periodDays: z.number().int().min(0),
  /**
   * True when the evidence is too little to generalise from.
   *
   * A threshold is a judgement, so it is named and explained rather than
   * hidden: fewer than three outcome rows, or a single campaign, or under
   * fourteen days. Being thin is not a refusal — a thin learning is often the
   * only one available and is still worth writing down. It travels with the
   * warning attached.
   */
  isThin: z.boolean(),
  reasonsNl: z.array(z.string()),
});
export type EvidenceSummary = z.infer<typeof evidenceSummary>;

export const learningWithEvidence = z.object({
  learning,
  evidence: evidenceSummary,
});
export type LearningWithEvidence = z.infer<typeof learningWithEvidence>;

/** The thresholds, in one place, so the warning text and the flag agree. */
export const THIN_EVIDENCE = Object.freeze({
  minOutcomes: 3,
  minCampaigns: 2,
  minPeriodDays: 14,
});

export function summariseEvidence(input: {
  outcomes: readonly { campaignId: string; periodStart: string; periodEnd: string }[];
}): EvidenceSummary {
  const reasonsNl: string[] = [];
  const outcomeCount = input.outcomes.length;
  const campaignCount = new Set(input.outcomes.map((outcome) => outcome.campaignId)).size;

  const starts = input.outcomes.map((outcome) => outcome.periodStart).sort();
  const ends = input.outcomes.map((outcome) => outcome.periodEnd).sort();
  const first = starts.at(0);
  const last = ends.at(-1);
  const periodDays =
    first === undefined || last === undefined
      ? 0
      : Math.max(
          0,
          Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000),
        );

  if (outcomeCount === 0) {
    reasonsNl.push('Er zijn geen gemeten resultaten aan deze les gekoppeld.');
  } else if (outcomeCount < THIN_EVIDENCE.minOutcomes) {
    reasonsNl.push(
      `Deze les rust op ${String(outcomeCount)} meting(en). Dat is te weinig om een patroon te noemen.`,
    );
  }
  if (outcomeCount > 0 && campaignCount < THIN_EVIDENCE.minCampaigns) {
    reasonsNl.push('Alle metingen komen uit één campagne, dus wat hier speelde kan eenmalig zijn.');
  }
  if (outcomeCount > 0 && periodDays < THIN_EVIDENCE.minPeriodDays) {
    reasonsNl.push(
      `De metingen beslaan ${String(periodDays)} dag(en). Een korte periode kan door één gebeurtenis worden bepaald.`,
    );
  }

  return { outcomeCount, campaignCount, periodDays, isThin: reasonsNl.length > 0, reasonsNl };
}
