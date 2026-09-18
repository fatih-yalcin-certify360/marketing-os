import { z } from 'zod';
import { contentLanguage, dataOrigin, isoTimestamp, uuid, versionNumber, webUrl } from './primitives.js';
import { assetFormat, channelWarning, marketingChannel, plannableChannel } from './channels.js';
import { funnelStage } from './funnel.js';
import { reviewState } from './workflow.js';
import { creativeResearchSnapshot } from './creative-research.js';

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

/** Per-piece art direction; brand files and readable type remain renderer-owned. */
export const socialCreativeBrief = z.object({
  mechanism: z.enum(['visual_question', 'metaphor', 'unexpected_detail', 'contrast', 'human_moment']),
  audienceInsight: z.string().min(10).max(500),
  conceptRationale: z.string().min(10).max(600),
  scene: z.string().min(20).max(1200),
  composition: z.string().min(10).max(800),
  textTreatment: z.enum(['speech_bubble', 'editorial', 'image_led']),
  textPosition: z.enum(['top_left', 'top_right', 'bottom_left']),
  brandIntegration: z.string().min(10).max(600),
  avoid: z.array(z.string().min(3).max(200)).max(8),
  campaignAlignment: z.string().max(600).default(''),
  channelRationale: z.string().max(600).default(''),
  personaVersionIds: z.array(uuid).max(3).default([]),
  evidenceIds: z.array(z.string().max(160)).max(8).default([]),
  testHypothesis: z.string().max(600).default(''),
});
export type SocialCreativeBrief = z.infer<typeof socialCreativeBrief>;

/**
 * Instructions for our own render layer.
 *
 * The logo and every piece of readable text live here, so they are composited
 * by code from the approved brand profile. A model is never asked to draw a
 * logo or legible text — requirement 8 states this outright.
 */
export const renderSpec = z.object({
  creativeBrief: socialCreativeBrief.nullable().optional(),
  creativeResearch: creativeResearchSnapshot.optional(),
  colorResolution: z.object({
    panel: z.object({ background: z.string(), foreground: z.string(), contrastRatio: z.number(), mode: z.enum(['preferred', 'brand_alternative']) }),
    footer: z.object({ background: z.string(), foreground: z.string(), contrastRatio: z.number(), mode: z.enum(['preferred', 'brand_alternative']) }),
    logo: z.object({ background: z.string(), mode: z.enum(['footer', 'brand_plate']), contrastScore: z.number() }).optional(),
  }).optional(),
  fontSource: z.enum(['brand_files', 'system_fallback']).optional(),
  visualStyle: z.enum(['documentary', 'conceptual', 'illustration']).optional(),
  backgroundAssetId: uuid.nullable().optional(),
  layout: renderLayout,
  variant: designVariant,
  widthPx: z.number().int().min(1),
  heightPx: z.number().int().min(1),
  headline: z.string().min(1).max(200),
  /** Optional supporting line. */
  subline: z.string().max(300).nullable(),
  /**
   * The call to action drawn into the image, or null where the image is not a
   * link. See `CLICKABLE_IMAGE_CHANNELS`: on an organic post the picture is not
   * a click target, so an instruction drawn into it cannot be followed.
   */
  ctaText: z.string().min(1).max(80).nullable(),
  logoText: z.string().max(60).nullable(),
  colors: z.object({
    background: z.string(),
    foreground: z.string(),
    accent: z.string(),
    surface: z.string().optional(),
    onSurface: z.string().optional(),
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
  /** Interchangeable short lines; a platform rotates between them. Google allows fifteen headlines and four descriptions. */
  headlines: z.array(z.string().min(3).max(200)).min(1).max(15),
  descriptions: z.array(z.string().min(10).max(400)).min(1).max(4),
  /** Google Search only: the two display paths after the domain, at most 15 characters each. */
  paths: z.array(z.string().min(1).max(30)).max(2).default([]),
  /** Google Search only: searches the ad must not show for. */
  negativeKeywords: z.array(z.string().min(2).max(80)).max(20).default([]),
  /** Google Search only: which match type the keywords are meant for, and why, in one or two sentences. */
  matchTypeAdviceNl: z.string().max(400).default(''),
  /** The page the ad lands on; the course page unless the briefing names another. */
  finalUrl: z.url().nullable().default(null),
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

/**
 * The website piece, in one of two forms.
 *
 * A "landing page" of two lines was the complaint that led here. The reader
 * of a course already has a course page; what a campaign can add is either a
 * *change* to that page — where it lacks what this stage's message needs — or
 * an *article* that answers the question the stage raises and links to the
 * page. Both are long enough to be worth publishing, and the choice between
 * them is made from the live page text the service fetches, not from taste.
 *
 * `currentExcerpt` must occur literally in the fetched page: a proposal to
 * change text that is not there is refused, not stored.
 */
export const websitePageChange = z.object({
  /** Where on the page: a heading, a section name, "boven de eerste kop". */
  placement: z.string().min(3).max(300),
  /** Why the page needs this for the stage's reader, in one or two sentences. */
  reason: z.string().min(20).max(1_000),
  /** A passage that is on the page now, quoted literally. */
  currentExcerpt: z.string().min(20).max(800),
  /** The text that replaces or follows it. */
  proposedText: z.string().min(80).max(4_000),
});
export type WebsitePageChange = z.infer<typeof websitePageChange>;

export const websiteCoursePageUpdate = z.object({
  form: z.literal('course_page_update'),
  pageUrl: webUrl,
  changes: z.array(websitePageChange).min(1).max(6),
});

export const websiteFaqItem = z.object({
  question: z.string().min(5).max(200),
  answer: z.string().min(20).max(1_200),
});

/** A fact from outside the course card, with the source the service handed the model. */
export const articleExternalFact = z.object({
  statementNl: z.string().min(10).max(400),
  /** A source reference that was in the material: a finding's URL or the course page. */
  sourceRef: z.string().min(3).max(2_000),
});
export type ArticleExternalFact = z.infer<typeof articleExternalFact>;

/**
 * A blog article that answers one question of the audience and leads to the
 * course page — the shape of a piece that ranks, gets cited by AI answer
 * engines and still converts (docs/product/blog-article-practice.md).
 *
 * The order is the reading order: title as the reader's question; a direct,
 * quotable answer; an intro in the reader's words; sections with question
 * headings that each open with a self-contained passage; one concrete
 * workplace scenario; one in-text bridge to the course after the first
 * insights; the path section that names what the course covers without
 * teaching it; a FAQ of real follow-up questions; a benefit-led closing CTA.
 * The fields added on 2026-09-14 are defaulted so articles written before
 * read back and are shown with what they have.
 */
export const websiteBlogArticle = z.object({
  form: z.literal('blog_article'),
  /** The reader's question as they would search it; no course name. */
  title: z.string().min(10).max(120),
  /** What a search result shows; the length is the one a snippet keeps. */
  metaDescription: z.string().min(50).max(170),
  /** The one-paragraph answer to the title, quotable on its own. */
  directAnswerNl: z.string().max(800).default(''),
  /** The problem in the reader's words and the article's thesis; no course. */
  intro: z.string().min(80).max(1_500),
  /** Question headings; each text opens with a passage that stands alone. */
  sections: z.array(contentSection).min(3).max(7),
  /** One concrete, fictional workplace scenario: role, situation, decision. */
  scenarioNl: z.string().max(1_500).default(''),
  /** Facts from outside the course card, each with its handed source. */
  externalFacts: z.array(articleExternalFact).max(3).default([]),
  /** One sentence in running text bridging the insight to the course; the first course link. */
  midCtaNl: z.string().max(500).default(''),
  /** After which section (0-based) the bridge sentence is placed. */
  midCtaAfterSection: z.number().int().min(0).max(6).default(1),
  /** What a professional needs to do this well, then the course strictly from the card. */
  coursePathNl: z.string().max(2_000).default(''),
  faq: z.array(websiteFaqItem).min(2).max(5),
  /** The benefit-led closing sentence with the second course link. */
  closingCtaNl: z.string().max(400).default(''),
  /** The anchor text of the link to the course page, inside the article. */
  internalLinkText: z.string().min(5).max(200),
});

export const websiteCopy = z.discriminatedUnion('form', [websiteCoursePageUpdate, websiteBlogArticle]);
export type WebsiteCopy = z.infer<typeof websiteCopy>;

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
  /**
   * The briefing's search phrases this piece actually uses, literally. The
   * service checks each one occurs in the text; a phrase that does not is a
   * warning, never a claim. Empty for content made before keywords travelled.
   */
  keywordsUsed: z.array(z.string().min(2).max(80)).max(10).default([]),
  /**
   * The website piece's form, for the `landing_page` channel only; null on
   * every other channel and on pages made before the two forms existed.
   * `body` and `sections` stay filled for a page — the introduction and the
   * article's or the change list's sections — so older renderers and the
   * export keep working; this field is the structured truth.
   */
  website: websiteCopy.nullable().default(null),
});
export type ContentCopy = z.infer<typeof contentCopy>;

/** Who a piece of content belongs to. */
export const contentOwnerScope = z.enum(['campaign', 'standalone']);
export type ContentOwnerScope = z.infer<typeof contentOwnerScope>;

/**
 * Where a standalone piece came from.
 *
 * Kept as a field rather than a note because it is the one thing the market
 * drops at the hand-off: every tool we read passes a keyword string from a
 * finding to a draft and forgets where it came from (2026-09-15). With this a
 * blog article can show the AI-visibility passage that prompted it, and be
 * re-checked against that finding when the research is run again.
 */
export const contentOriginKind = z.enum(['manual', 'geo_report', 'radar_card', 'radar_insight']);
export type ContentOriginKind = z.infer<typeof contentOriginKind>;

export const contentAssetVersion = z.object({
  id: uuid,
  /** Null for a standalone piece; `ownerScope` says which it is. */
  campaignId: uuid.nullable(),
  ownerScope: contentOwnerScope.default('campaign'),
  originKind: contentOriginKind.nullable().default(null),
  originRefId: uuid.nullable().default(null),
  /**
   * The instruction this piece was written from, in the requester's own words.
   *
   * Only a standalone piece has one — a campaign piece is written from an
   * approved briefing and a chosen concept, which are versioned rows of their
   * own. Null for a campaign piece, and null for a loose piece made before the
   * sentence was kept (migration 0030 recovers it where the job row survives).
   *
   * Every later version of the same piece carries the original instruction
   * forward: a hand edit and an AI revision both write a new row, and neither
   * changes what the piece was asked to be.
   */
  instructionNl: z.string().max(4_000).nullable().default(null),
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
  // The briefing and the concept are null for a standalone piece: it has
  // neither. The brand and the course are never null — that grounding is what
  // makes a piece without a briefing safe to write (2026-09-15).
  briefVersionId: uuid.nullable(),
  conceptVersionId: uuid.nullable(),
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
  /**
   * Who asked for this version. Null on rows written before it was recorded.
   *
   * An id, never a name: the interface resolves it when it has a reason to
   * show a person, and everything else works without knowing who anybody is.
   */
  createdByUserId: uuid.nullable().default(null),
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
  /** Required in new social-image proposals; null for text-only/legacy content. */
  creativeBrief: socialCreativeBrief.nullable().default(null),
});
export type ContentProposal = z.infer<typeof contentProposal>;

export const contentProposalSet = z.object({
  items: z.array(contentProposal).min(1).max(12),
});
export type ContentProposalSet = z.infer<typeof contentProposalSet>;

/** Direct text editing. Produces a new version; the previous one is kept. */
/**
 * Asking for one piece of content outside any campaign.
 *
 * `angleNl` is the whole instruction: what the piece should be about, in the
 * requester's own words. There is no briefing to lean on, so this is what the
 * model is given besides the course card, the brand and the channel.
 */
export const standaloneContentInput = z.object({
  courseVersionId: uuid,
  channel: plannableChannel,
  /** Null when the piece serves no particular stage. */
  stage: funnelStage.nullable().default(null),
  angleNl: z.string().min(10).max(2_000),
  /** Where this came from, so the draft can point back at it. */
  originKind: contentOriginKind.default('manual'),
  originRefId: uuid.nullable().default(null),
  /** The link the piece should point at; the course URL when left out. */
  ctaUrl: z.url().max(2_000).nullable().default(null),
  /**
   * Who the piece is for.
   *
   * A campaign writes for the audiences its briefing chose; a loose piece had
   * nobody, so the model was told to write for the course in general and the
   * result read that way. One persona is enough here — the point of a single
   * piece is usually one reader — and null keeps the old behaviour for anyone
   * who has no persona yet (2026-09-17).
   */
  personaVersionId: uuid.nullable().default(null),
});
export type StandaloneContentInput = z.infer<typeof standaloneContentInput>;

export const attachToCampaignInput = z.object({ campaignId: uuid });
export type AttachToCampaignInput = z.infer<typeof attachToCampaignInput>;

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
  content_plan: 'Kanaalplan',
});
