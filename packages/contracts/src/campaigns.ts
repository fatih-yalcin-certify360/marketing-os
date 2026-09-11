import { z } from 'zod';
import { cents, contentLanguage, dataOrigin, isoTimestamp, uuid, versionNumber, webUrl } from './primitives.js';
import { marketingChannel, plannableChannel } from './channels.js';
import { campaignEntryMode, reviewState, workflowStage } from './workflow.js';
import { campaignObjective, channelAdvice, funnelStage, proposedChannelAdvice } from './funnel.js';
import { grounding } from './personas.js';

/**
 * Opportunities, campaigns, briefs and concepts.
 *
 * The chain is: opportunity → campaign → brief (approved) → concept → content.
 * Each step binds to the *version* of what came before, which is what lets the
 * system detect later that something underneath changed.
 */

// ------------------------------------------------------------- Opportunity ---

/**
 * A reasoned campaign opportunity.
 *
 * Note what is absent: no score, no predicted conversion, no revenue estimate.
 * The requirement is explicit — no unfounded success scores and no definite
 * sales forecasts. Ranking is expressed as an order plus a *stated reason*,
 * which is honest about being a judgement rather than a measurement.
 */
export const opportunity = z.object({
  id: uuid,
  labelId: uuid,
  courseVersionId: uuid,
  personaVersionIds: z.array(uuid).min(1).max(3),
  title: z.string().min(3).max(200),
  goalAndNeed: z.string().min(10).max(1_500),
  coreIdea: z.string().min(10).max(1_500),
  sourceAndTiming: z.string().min(3).max(1_000),
  fitNotes: z.string().min(3).max(1_000),
  uncertainties: z.array(z.string().min(3).max(300)).max(10),
  /** A cheap first test, so a big spend is never the only option. */
  smallTestProposal: z.string().min(10).max(1_000),
  measurementApproach: z.string().min(10).max(1_000),
  /** 1 = presented first. */
  rank: z.number().int().min(1).max(10),
  rankRationaleNl: z.string().min(10).max(1_000),
  grounding: z.array(grounding).max(20),
  selected: z.boolean(),
  origin: dataOrigin,
  promptVersion: z.string().max(40).nullable(),
  createdAt: isoTimestamp,
});
export type Opportunity = z.infer<typeof opportunity>;

export const opportunityProposal = opportunity.pick({
  title: true,
  goalAndNeed: true,
  coreIdea: true,
  sourceAndTiming: true,
  fitNotes: true,
  uncertainties: true,
  smallTestProposal: true,
  measurementApproach: true,
  rank: true,
  rankRationaleNl: true,
  grounding: true,
});
export type OpportunityProposal = z.infer<typeof opportunityProposal>;

export const opportunityProposalSet = z.object({
  opportunities: z.array(opportunityProposal).min(1).max(3),
  shortfallReasonNl: z.string().max(600).nullable(),
});
export type OpportunityProposalSet = z.infer<typeof opportunityProposalSet>;

// ---------------------------------------------------------------- Campaign ---

export const campaign = z.object({
  radarRunId: uuid.nullable().optional(),
  visualReferenceAssetIds: z.array(uuid).max(3).default([]),
  id: uuid,
  labelId: uuid,
  name: z.string().min(1).max(200),
  entryMode: campaignEntryMode,
  /**
   * What the campaign must achieve; decides which funnel stages it plans for.
   *
   * Null for campaigns created before objectives existed. They read as "geen
   * doel vastgelegd" rather than being back-filled with a guess, and plan as a
   * full funnel until someone sets one.
   */
  objective: campaignObjective.nullable(),
  stage: workflowStage,
  contentLanguage,
  courseVersionId: uuid,
  brandProfileVersionId: uuid,
  opportunityId: uuid.nullable(),
  /** The user's own starting point, for the "develop my idea" entry mode. */
  userIdea: z.string().nullable(),
  /** A supplied briefing, for the "start from a briefing" entry mode. */
  suppliedBrief: z.string().nullable(),
  ownerUserId: uuid.nullable(),
  /** Optional: a relative plan is produced when absent. */
  startDate: z.iso.date().nullable(),
  budgetCents: cents.nullable(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type Campaign = z.infer<typeof campaign>;

export const createCampaignInput = z.object({
  name: z.string().min(1).max(200),
  entryMode: campaignEntryMode,
  /** The interface requires a choice; the API accepts none so older clients keep working. */
  objective: campaignObjective.nullable().default(null),
  courseVersionId: uuid,
  contentLanguage: contentLanguage.default('nl'),
  /** For "werk mijn idee uit": the user's own starting idea. */
  userIdea: z.string().max(4_000).optional(),
  /** For "start met een briefing": the supplied brief text. */
  suppliedBrief: z.string().max(20_000).optional(),
  startDate: z.iso.date().nullable().default(null),
  budgetCents: cents.nullable().default(null),
});
export type CreateCampaignInput = z.infer<typeof createCampaignInput>;
/**
 * What a caller may *send*: defaulted fields (`objective`, `contentLanguage`,
 * `startDate`, `budgetCents`) are optional here and filled in by the parse.
 * Services that parse their input take this type, so a caller is not made to
 * spell out defaults the schema already owns.
 */
export type CreateCampaignInputData = z.input<typeof createCampaignInput>;

// ------------------------------------------------------------------- Brief ---

/** A claim the campaign may make, with what backs it. */
export const usableClaim = z.object({
  claim: z.string().min(3).max(400),
  /** Which confirmed course fact or source supports it. */
  backedBy: z.string().min(1).max(500),
});
export type UsableClaim = z.infer<typeof usableClaim>;

export const briefVersion = z.object({
  reviewNotes: z.array(z.string().min(3).max(800)).max(20).default([]),
  id: uuid,
  campaignId: uuid,
  version: versionNumber,
  goal: z.string().min(10).max(1_500),
  /** Bound to specific persona versions, not to personas. */
  personaVersionIds: z.array(uuid).min(1).max(3),
  coreMessage: z.string().min(10).max(1_000),
  evidence: z.array(grounding).max(20),
  usableClaims: z.array(usableClaim).max(20),
  /** What the campaign must not claim, derived from brand rules and unconfirmed facts. */
  offLimits: z.array(z.string().min(3).max(300)).max(20),
  cta: z.string().min(3).max(200),
  ctaUrl: webUrl.nullable().default(null),
  /**
   * Channels the brief proposes.
   *
   * Wide here on purpose: a brief stored before a channel was retired must
   * still be readable. What the model may *propose* is narrower — see
   * `briefProposal` below.
   */
  channelSuggestions: z.array(marketingChannel).min(1).max(8),
  contentScope: z.string().min(3).max(1_500),
  measurement: z.string().min(10).max(1_000),
  /** When to stop or re-evaluate. Keeps a test from running on indefinitely. */
  stopConditions: z.string().min(10).max(1_000),
  ownerUserId: uuid.nullable(),
  budgetCents: cents.nullable(),
  startDate: z.iso.date().nullable(),
  reviewState,
  origin: dataOrigin,
  promptVersion: z.string().max(40).nullable(),
  createdAt: isoTimestamp,
});
export type BriefVersion = z.infer<typeof briefVersion>;

export const briefProposal = briefVersion.pick({
  reviewNotes: true,
  ctaUrl: true,
  goal: true,
  coreMessage: true,
  evidence: true,
  usableClaims: true,
  offLimits: true,
  cta: true,
  channelSuggestions: true,
  contentScope: true,
  measurement: true,
  stopConditions: true,
}).extend({
  /**
   * Only channels this build can deliver.
   *
   * This is the upstream of everything: the content plan is handed the brief's
   * suggestions, so a brief that proposes an e-mail makes the plan propose one
   * too — and the model is then following our own instruction correctly. The
   * first real run drifted into Phase 3 channels exactly this way. Because this
   * schema is what the provider receives, the model *cannot* pick an
   * undeliverable channel rather than being asked not to.
   */
  channelSuggestions: z.array(plannableChannel).min(1).max(8),
});
export type BriefProposal = z.infer<typeof briefProposal>;

/** User edits to a brief. Producing a new version, never mutating one. */
export const briefEditInput = briefProposal.partial().extend({
  ctaUrl: webUrl.nullable().optional(),
  personaVersionIds: z.array(uuid).min(1).max(3).optional(),
});
export type BriefEditInput = z.infer<typeof briefEditInput>;

// ----------------------------------------------------------------- Concept ---

export const artDirection = z.object({
  medium: z.enum(['documentary', 'conceptual', 'illustration']),
  scene: z.string().min(10).max(1200),
  composition: z.string().min(10).max(700),
  lighting: z.string().min(3).max(400),
  treatment: z.string().min(10).max(700),
  avoid: z.array(z.string().min(3).max(200)).max(8),
});
export type ArtDirection = z.infer<typeof artDirection>;

export const conceptVersion = z.object({
  artDirection: artDirection.nullable().default(null),
  id: uuid,
  campaignId: uuid,
  briefVersionId: uuid,
  version: versionNumber,
  name: z.string().min(1).max(160),
  coreIdea: z.string().min(10).max(1_500),
  exampleHeadline: z.string().min(3).max(200),
  /** Described in words; the render layer turns this into a layout choice. */
  visualApproach: z.string().min(10).max(1_000),
  /** Which render layout this concept maps to. */
  visualLayout: z.enum(['bold_statement', 'split_panel', 'quiet_editorial']),
  personaFitRationaleNl: z.string().min(10).max(1_000),
  selected: z.boolean(),
  reviewState,
  origin: dataOrigin,
  promptVersion: z.string().max(40).nullable(),
  createdAt: isoTimestamp,
});
export type ConceptVersion = z.infer<typeof conceptVersion>;

export const conceptProposal = conceptVersion.pick({
  name: true,
  coreIdea: true,
  exampleHeadline: true,
  visualApproach: true,
  visualLayout: true,
  personaFitRationaleNl: true,
});
export type ConceptProposal = z.infer<typeof conceptProposal>;

export const conceptProposalSet = z.object({
  concepts: z.array(conceptProposal.extend({ artDirection })).length(3),
  shortfallReasonNl: z.string().max(600).nullable(),
});
export type ConceptProposalSet = z.infer<typeof conceptProposalSet>;

// ------------------------------------------------------------ Content plan ---

/**
 * The small test package the system proposes before production.
 *
 * The user changes and approves it first, so nothing is generated — and no
 * budget is spent — on a plan they have not seen.
 */
export const contentPlanItem = z.object({
  /**
   * Which funnel stage this piece serves.
   *
   * Null only for plans stored before stages existed; those read back as
   * stage-less and their content is generated the old way. Everything planned
   * now carries a stage — see `plannableContentPlanItem`.
   */
  stage: funnelStage.nullable().default(null),
  channel: marketingChannel,
  /** How many pieces for this channel. Kept small for a first test. */
  count: z.number().int().min(1).max(10),
  withImage: z.boolean(),
});
export type ContentPlanItem = z.infer<typeof contentPlanItem>;

/** Three stages × eight channels is the most a plan can hold. */
export const MAX_PLAN_ITEMS = 24;

export const contentPlan = z.object({
  items: z.array(contentPlanItem).min(1).max(MAX_PLAN_ITEMS),
  /** Publishing rhythm in words, e.g. "twee posts per week, drie weken". */
  cadenceNl: z.string().min(3).max(400),
  rationaleNl: z.string().min(10).max(1_000),
  /**
   * The argument per stage × channel cell — rule and tailored advice side by
   * side. Empty for plans stored before advice existed. `.default([])` also
   * makes the strict provider schema list it as required, so a model has to
   * return the array rather than leave us to guess.
   */
  channelAdvice: z.array(channelAdvice).max(MAX_PLAN_ITEMS).default([]),
});
export type ContentPlan = z.infer<typeof contentPlan>;

/**
 * The plan shape used for *proposing* and *approving*.
 *
 * Identical to `contentPlan` except that the channel is restricted to what this
 * build can deliver (`plannableChannel`), the stage is required, and the advice
 * is checked against the rule table. Reading a stored plan uses the wide form
 * above, so history stays readable while nothing new can be planned for a
 * channel the product cannot produce or without saying which stage it serves.
 */
export const plannableContentPlanItem = contentPlanItem.extend({
  stage: funnelStage,
  channel: plannableChannel,
});
export type PlannableContentPlanItem = z.infer<typeof plannableContentPlanItem>;

export const plannableContentPlan = contentPlan.extend({
  items: z.array(plannableContentPlanItem).min(1).max(MAX_PLAN_ITEMS),
  channelAdvice: z.array(proposedChannelAdvice).max(MAX_PLAN_ITEMS).default([]),
});
export type PlannableContentPlan = z.infer<typeof plannableContentPlan>;
