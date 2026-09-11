import { z } from 'zod';
import { contentLanguage, dataOrigin, isoTimestamp, uuid, versionNumber, webUrl } from './primitives.js';
import { assetFormat, channelWarning, marketingChannel } from './channels.js';
import { funnelStage } from './funnel.js';
import { reviewState } from './workflow.js';

/**
 * Content assets.
 *
 * Every asset version records the *versions of everything it was made from*
 * (brief, concept, brand, course, personas). That provenance is what makes
 * staleness detectable: when a course fact or a brand rule changes, the system
 * can find exactly which assets rest on the old version and flag them for
 * re-review instead of asking the user to remember.
 *
 * Two design variants per visual asset carry the **same message and CTA** and
 * differ only in layout — enforced by generating both from one copy record.
 */

export const designVariant = z.enum(['A', 'B']);
export type DesignVariant = z.infer<typeof designVariant>;

export const renderLayout = z.enum(['bold_statement', 'split_panel', 'quiet_editorial']);
export type RenderLayout = z.infer<typeof renderLayout>;

/**
 * Instructions for our own render layer.
 *
 * The logo and every piece of readable text live here, so they are composited
 * by code from the approved brand profile. A model is never asked to draw a
 * logo or legible text — requirement 8 states this outright.
 */
export const renderSpec = z.object({
  visualStyle: z.enum(['documentary', 'conceptual', 'illustration']).optional(),
  backgroundAssetId: uuid.nullable().optional(),
  layout: renderLayout,
  variant: designVariant,
  widthPx: z.number().int().min(1),
  heightPx: z.number().int().min(1),
  headline: z.string().min(1).max(200),
  /** Optional supporting line. */
  subline: z.string().max(300).nullable(),
  ctaText: z.string().min(1).max(80),
  logoText: z.string().max(60).nullable(),
  colors: z.object({
    background: z.string(),
    foreground: z.string(),
    accent: z.string(),
  }),
  headingFamily: z.string(),
  bodyFamily: z.string(),
});
export type RenderSpec = z.infer<typeof renderSpec>;

/**
 * One titled block of a longer page.
 *
 * A landing page is delivered as structured sections rather than as a blob of
 * markup: the sections are what a person edits and re-orders, and nothing this
 * system produces should be HTML a user cannot read before it goes anywhere.
 */
export const contentSection = z.object({
  heading: z.string().min(3).max(120),
  text: z.string().min(20).max(1_800),
});
export type ContentSection = z.infer<typeof contentSection>;

/**
 * An advertising proposal: the copy, and nothing that looks like a forecast.
 *
 * ## What is deliberately not here
 *
 * There is **no field for search volume, cost per click, impressions,
 * click-through rate or conversions**, and that absence is the control. Those
 * numbers come from an advertising account and a measurement period; this
 * system has neither, so any figure it produced would be a guess wearing the
 * clothes of data — and a media budget is exactly the decision people make on
 * such a number without re-checking it.
 *
 * Instructing a model not to invent figures is not enough on its own: a schema
 * with nowhere to put one cannot carry one, whatever the prompt says or a
 * future edit to it forgets. `content.test.ts` asserts the shape stays that
 * way.
 *
 * ## The lengths here are not platform limits
 *
 * Each platform has real, documented character limits, and none of them has
 * been read against a primary source — so none is stated. The bounds below
 * exist only to keep output finite, and are deliberately looser than any real
 * limit so they cannot be mistaken for one. The channel specification says the
 * same thing and refuses a publish-ready export because of it: the lengths must
 * be checked in the advertising platform itself before anything runs.
 */
export const adProposal = z.object({
  /** Interchangeable short lines; a platform rotates between them. */
  headlines: z.array(z.string().min(3).max(200)).min(1).max(5),
  descriptions: z.array(z.string().min(10).max(400)).min(1).max(3),
  /**
   * Search only: phrases a person might actually type. Empty for the others.
   *
   * Suggestions, not a keyword plan — there is no volume or competition figure
   * attached to any of them, because we have none.
   */
  keywords: z.array(z.string().min(2).max(80)).max(20),
  /** Why these lines, traceable to the briefing or the course card. */
  rationaleNl: z.string().min(10).max(600),
});
export type AdProposal = z.infer<typeof adProposal>;

/** The copy for one piece of content, shared by both design variants. */
export const contentCopy = z.object({
  /** Channel-appropriate opening line. Instagram truncates early, so it leads. */
  hook: z.string().min(1).max(300),
  body: z.string().min(1).max(6_000),
  /**
   * Structured sections, for channels that are a *page* rather than a post.
   *
   * Empty for social channels, and that is the normal case: a post has a body,
   * not sections. `.default([])` matters twice over — content stored before
   * this field existed reads back as `[]` rather than failing, and the strict
   * provider schema still lists it as required, so a model must return an
   * array (empty if the channel does not want sections) rather than omitting
   * it and leaving us to guess.
   */
  sections: z.array(contentSection).max(8).default([]),
  /**
   * Advertising copy, for the three ad channels. Null everywhere else.
   *
   * Kept out of `body`/`sections` because an advert is not prose: it is a set
   * of interchangeable lines the platform recombines, and flattening it into a
   * paragraph would lose which line is which.
   */
  ads: adProposal.nullable().default(null),
  ctaText: z.string().min(1).max(200),
  ctaUrl: webUrl.nullable(),
  /** Accessibility text for the image. */
  imageAltText: z.string().max(4_000).nullable(),
  /** Channel-appropriate; empty for channels where they do not belong. */
  hashtags: z.array(z.string().min(2).max(60)).max(12),
});
export type ContentCopy = z.infer<typeof contentCopy>;

export const contentAssetVersion = z.object({
  id: uuid,
  campaignId: uuid,
  /** Stable across versions: the identity of "this piece of content". */
  assetKey: z.string().min(1).max(120),
  version: versionNumber,
  channel: marketingChannel,
  /**
   * The funnel stage this piece was written for. Null for content made before
   * stages existed, or from a stage-less plan; every version of one asset key
   * shares the same stage.
   */
  funnelStage: funnelStage.nullable().default(null),
  format: assetFormat,
  language: contentLanguage,
  copy: contentCopy,
  /** Two variants share one copy record; each has its own render spec. */
  variants: z.array(
    z.object({
      variant: designVariant,
      spec: renderSpec,
      /** Path in our storage; served only through an authorised endpoint. */
      imageAssetId: uuid.nullable(),
    }),
  ).max(2),

  // ---- provenance: the versions this asset was produced from -------------
  briefVersionId: uuid,
  conceptVersionId: uuid,
  brandProfileVersionId: uuid,
  courseVersionId: uuid,
  personaVersionIds: z.array(uuid),

  /** Warnings from the channel check. Advisory unless they block publishing. */
  warnings: z.array(channelWarning),
  reviewState,
  origin: dataOrigin,
  promptVersion: z.string().max(40).nullable(),
  /** Set when a person edited the text by hand, so regeneration can warn. */
  editedByUserId: uuid.nullable(),
  createdAt: isoTimestamp,
  /**
   * The channel-specification version this asset was judged against.
   *
   * `warnings` above are recomputed from the *current* config on every read, so
   * they always match what the export gate will do. This field records what was
   * true when the asset was made, which is the half of "the config is versioned
   * and content records which version it met" that the version number alone
   * does not give.
   */
  channelConfigVersion: versionNumber,
});
export type ContentAssetVersion = z.infer<typeof contentAssetVersion>;

/** What the AI adapter returns for one channel. Ids are assigned server-side. */
export const contentProposal = z.object({
  /**
   * Echoed by the model, checked by the service: every item of one generation
   * call must carry the stage the call was for. Null when the plan item had no
   * stage (plans from before stages existed).
   */
  stage: funnelStage.nullable(),
  channel: marketingChannel,
  copy: contentCopy,
  /** Headline for the image; may differ from the post's hook. */
  imageHeadline: z.string().min(1).max(200),
  imageSubline: z.string().max(300).nullable(),
});
export type ContentProposal = z.infer<typeof contentProposal>;

export const contentProposalSet = z.object({
  items: z.array(contentProposal).min(1).max(12),
});
export type ContentProposalSet = z.infer<typeof contentProposalSet>;

/** Direct text editing. Produces a new version; the previous one is kept. */
export const contentEditInput = z.object({
  copy: contentCopy.partial(),
  /** Echoed optimistic-concurrency token from the version being edited. */
  expectedVersion: versionNumber,
});
export type ContentEditInput = z.infer<typeof contentEditInput>;

/**
 * An AI revision instruction, written by the user in their own words.
 *
 * Regeneration targets **one asset**, never the whole package, so an
 * unrelated piece the user already approved is not silently rewritten.
 */
export const contentReviseInput = z.object({
  instructionNl: z.string().min(3).max(2_000),
  expectedVersion: versionNumber,
  /** Regenerate only the copy, only the images, or both. */
  scope: z.enum(['copy', 'images', 'both']).default('copy'),
});
export type ContentReviseInput = z.infer<typeof contentReviseInput>;

// ------------------------------------------------------------------ Export ---

export const exportKind = z.enum(['draft', 'publish_ready']);
export type ExportKind = z.infer<typeof exportKind>;

export const exportRecord = z.object({
  id: uuid,
  campaignId: uuid,
  kind: exportKind,
  /** Files in the package, for display before download. */
  manifest: z.array(
    z.object({
      path: z.string(),
      channel: marketingChannel.nullable(),
      variant: designVariant.nullable(),
      assetVersion: versionNumber.nullable(),
      bytes: z.number().int().min(0),
    }),
  ),
  /** Reasons a publish-ready package was refused, when it was. */
  blockedReasonsNl: z.array(z.string()),
  createdByUserId: uuid.nullable(),
  createdAt: isoTimestamp,
  sizeBytes: z.number().int().min(0),
});
export type ExportRecord = z.infer<typeof exportRecord>;

// ---------------------------------------------------------------- Approval ---

export const approvableArtefact = z.enum([
  'brand_profile',
  'course',
  'persona',
  'brief',
  'concept',
  'content_asset',
  'content_plan',
]);
export type ApprovableArtefact = z.infer<typeof approvableArtefact>;

export const approval = z.object({
  id: uuid,
  labelId: uuid,
  artefactType: approvableArtefact,
  artefactId: uuid,
  /** The approval is bound to this exact version and no other. */
  artefactVersion: versionNumber,
  approvedByUserId: uuid,
  approvedAt: isoTimestamp,
  noteNl: z.string().max(1_000).nullable(),
});
export type Approval = z.infer<typeof approval>;

export const APPROVABLE_LABEL_NL: Readonly<Record<ApprovableArtefact, string>> = Object.freeze({
  brand_profile: 'Merkprofiel',
  course: 'Opleidingskaart',
  persona: 'Doelgroep',
  brief: 'Briefing',
  concept: 'Concept',
  content_asset: 'Content',
  content_plan: 'Contentpakket',
});
