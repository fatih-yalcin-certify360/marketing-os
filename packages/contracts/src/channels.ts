import { z } from 'zod';
import { GOOGLE_RSA } from './google-ads.js';

/**
 * Channel capability registry.
 *
 * The model separates two kinds of fact, because they are verifiable to very
 * different degrees and must gate publishing differently:
 *
 *  - **Hard constraints** — accepted file formats, pixel caps, alt-text limits.
 *    These come from the platforms' developer documentation and are the ones
 *    that make a post *technically* invalid. Only these gate publishability.
 *  - **Guidance** — recommended body length and preferred dimensions. Useful,
 *    but platforms publish these in help centres that change often, so they are
 *    advisory: the UI warns, it does not block.
 *
 * Every entry records the source URL and the date it was checked. A spec whose
 * hard constraints are not `verified_against_official_docs` can never be
 * offered as publishable — see `isPublishable`.
 */

export const marketingChannel = z.enum([
  'linkedin_organic',
  'instagram_organic',
  'facebook_organic',
  /**
   * The website, as one channel, until 2026-09-15.
   *
   * It carried two different deliverables — a change proposal for the existing
   * course page, and a new blog article — with different schemas, different
   * quality rules, different reviewers and different publication routes. They
   * are now `course_page_update` and `blog_article`. The old value stays in the
   * vocabulary because half the stored website rows carry no form at all and
   * cannot be classified after the fact; it is no longer plannable.
   */
  'landing_page',
  'course_page_update',
  'blog_article',
  'email',
  'linkedin_ads',
  'meta_ads',
  'google_search_ads',
]);
export type MarketingChannel = z.infer<typeof marketingChannel>;

/** The three channels in scope for the social pilot. */
export const SOCIAL_PILOT_CHANNELS = [
  'linkedin_organic',
  'instagram_organic',
  'facebook_organic',
] as const satisfies readonly MarketingChannel[];

/**
 * Channels a content plan may actually propose.
 *
 * `marketingChannel` above is the *vocabulary* — every channel the product will
 * ever address, including ones only designed so far. This is the *capability*:
 * what this build can really produce and export.
 *
 * The distinction is not cosmetic. Left unconstrained, the model planned an
 * e-mail and a landing page, both Phase 3. The system correctly refused to make
 * them publish-ready, but it had already spent a generation call on them and
 * offered the user content for channels the interface says are unavailable —
 * which is the "do not show unfinished areas as if they work" rule failing one
 * step upstream of where it was being enforced.
 *
 * Because this is the schema sent to the provider, a restricted enum means the
 * model *cannot* pick an undeliverable channel rather than being asked not to.
 *
 * Widened for the landing page, e-mail and the three advertising channels on
 * 2026-09-10, each in the same change that added its production — the rule this
 * comment set for itself.
 *
 * With Phase 3 complete the two lists now hold the same members, and the
 * distinction still matters: `marketingChannel` is what a *stored* row may
 * contain, so a plan made before a channel was producible stays readable, and
 * the next channel the product designs before it can build lands here first.
 * Producible is not publishable — five of these eight refuse a publish-ready
 * export because their specifications are unverified. Reading a historical
 * plan is unaffected: stored plans keep the wide `marketingChannel`, so a plan
 * made before a channel was producible stays readable.
 */
/**
 * Everything this build can really produce and export.
 *
 * The social pilot plus the landing page (P3-1). E-mail and the three
 * advertising channels remain vocabulary only: designed, not built.
 */
export const PRODUCIBLE_CHANNELS = [
  ...SOCIAL_PILOT_CHANNELS,
  'course_page_update',
  'blog_article',
  'email',
  'linkedin_ads',
  'meta_ads',
  'google_search_ads',
] as const satisfies readonly MarketingChannel[];

export const plannableChannel = z.enum(PRODUCIBLE_CHANNELS);
export type PlannableChannel = z.infer<typeof plannableChannel>;

export const assetFormat = z.enum(['single_image', 'carousel', 'text_only', 'video']);
export type AssetFormat = z.infer<typeof assetFormat>;

export const channelVerification = z.enum([
  /** Placeholder or third-party sourced. Never publishable. */
  'unverified',
  'verified_against_official_docs',
  /**
   * There is no platform to verify against.
   *
   * A landing page is served from the label's own site: nobody publishes an
   * upload limit or a character cap for it, so "verified against official
   * documentation" cannot be true and claiming it would be a fabricated
   * source. The limits such a channel does have are our own house style, and
   * they are guidance rather than something a platform enforces.
   *
   * This is deliberately not a synonym for verified. It says the *question*
   * does not apply, which is why `isPublishable` accepts it: there is no
   * external limit left to violate. Marking such a channel `unverified`
   * instead would block a publish-ready export for ever on a check that can
   * never pass.
   */
  'not_platform_constrained',
  /** Was verified, but the recorded check is older than the review interval. */
  'stale',
]);
export type ChannelVerification = z.infer<typeof channelVerification>;

export const imageSpec = z.object({
  widthPx: z.number().int().min(1),
  heightPx: z.number().int().min(1),
  aspectRatioLabel: z.string(),
  /** The variant our render layer produces by default for this channel. */
  isDefault: z.boolean().default(false),
});
export type ImageSpec = z.infer<typeof imageSpec>;

/** Technically enforced by the platform. Gates publishability. */
export const hardConstraints = z.object({
  /** Accepted upload formats, lower-case, e.g. ['jpeg', 'png']. */
  imageFormats: z.array(z.string()).min(1),
  /** Total pixel cap (width × height), when the platform documents one. */
  maxImagePixels: z.number().int().min(1).nullable(),
  maxImageBytes: z.number().int().min(1).nullable(),
  /** Alt-text limit, when documented. */
  altTextMaxChars: z.number().int().min(1).nullable(),
  verification: channelVerification,
  sourceUrl: z.url().nullable(),
  verifiedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type HardConstraints = z.infer<typeof hardConstraints>;

/**
 * House-style minimums per channel: how long a piece has to be before it is
 * worth a reader's time, and how many hashtags belong on it.
 *
 * These are **our** editorial rules, not platform limits — a platform caps
 * length, it never demands any — so they sit apart from the maxima above and
 * carry no source URL. They exist because the schema alone allowed a
 * one-character body and zero sections, and a two-line landing page came out
 * of a real run looking valid. `content-assets/quality.ts` checks them; a
 * long-form piece that falls short is repaired rather than stored.
 *
 * Counted in words, not characters: a writer thinks in words, and the number
 * is stated to the model in the same unit it is checked in.
 */
export const lengthGuidance = z.object({
  /** Minimum words in `body` for a post; null when the body is an introduction to sections. */
  minBodyWords: z.number().int().min(0).nullable(),
  /** Minimum words across body and sections for a page or a mail. */
  minTotalWords: z.number().int().min(0).nullable(),
  minSections: z.number().int().min(0).nullable(),
  maxSections: z.number().int().min(0).nullable(),
  /** Minimum words per section, when the channel has sections. */
  minSectionWords: z.number().int().min(0).nullable(),
  /** Hashtag range; `0`/`0` means the channel carries none. */
  minHashtags: z.number().int().min(0),
  maxHashtags: z.number().int().min(0),
});
export type LengthGuidance = z.infer<typeof lengthGuidance>;

/** Recommended, not enforced. Produces warnings, never blocks. */
export const channelGuidance = z.object({
  /** Recommended maximum body/caption length. */
  bodyMaxChars: z.number().int().min(1).nullable(),
  /**
   * Some platforms reduce the text limit when media is attached; recorded
   * separately so a post with an image is measured against the right number.
   */
  bodyMaxCharsWithMedia: z.number().int().min(1).nullable(),
  /** Characters after which the platform visually truncates in-feed. */
  bodyTruncatesAtChars: z.number().int().min(1).nullable(),
  headlineMaxChars: z.number().int().min(1).nullable(),
  images: z.array(imageSpec),
  verification: channelVerification,
  sourceUrl: z.url().nullable(),
  verifiedAt: z.iso.datetime({ offset: true }).nullable(),
  /** House-style minimums and hashtag range; see `lengthGuidance`. */
  length: lengthGuidance,
});
export type ChannelGuidance = z.infer<typeof channelGuidance>;

/** A channel without house-style minimums: the three advertising channels. */
const NO_LENGTH_RULES: LengthGuidance = Object.freeze({
  minBodyWords: null,
  minTotalWords: null,
  minSections: null,
  maxSections: null,
  minSectionWords: null,
  minHashtags: 0,
  maxHashtags: 0,
});

/** A post: a body with a minimum, hashtags in a range, no sections. */
function postLength(minBodyWords: number, minHashtags: number, maxHashtags: number): LengthGuidance {
  return {
    minBodyWords,
    minTotalWords: null,
    minSections: null,
    maxSections: null,
    minSectionWords: null,
    minHashtags,
    maxHashtags,
  };
}

export const channelFormatSpec = z.object({
  channel: marketingChannel,
  format: assetFormat,
  hard: hardConstraints,
  guidance: channelGuidance,
  /** Dutch note shown to the user when something about this spec is uncertain. */
  noteNl: z.string().nullable(),
});
export type ChannelFormatSpec = z.infer<typeof channelFormatSpec>;

export const channelConfigVersion = z.object({
  version: z.number().int().min(1),
  formats: z.array(channelFormatSpec),
});
export type ChannelConfigVersion = z.infer<typeof channelConfigVersion>;

// ---------------------------------------------------------------------------
// Registry — checked 2026-09-09.
//
// Sources, per channel:
//   LinkedIn text      https://www.linkedin.com/help/linkedin/answer/a528176
//   LinkedIn images    https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
//   Instagram images   https://help.instagram.com/1631821640426723
//   Instagram caption  https://developers.facebook.com/docs/marketing-api/guides/instagramads/ad_creative
//
// Facebook organic is deliberately left `unverified`: Meta's business help
// centre renders its body client-side and could not be read directly, and no
// developer-documentation figure for organic feed text was found. Content is
// still generated for Facebook — it simply cannot reach a publish-ready export
// until the numbers are confirmed. That is the intended behaviour, not a gap
// to paper over with a third-party blog figure.
// ---------------------------------------------------------------------------

const CHECKED_AT = '2026-09-09T00:00:00.000Z';
/** Facebook's hard limits were sourced a day later than the other two. */
const FACEBOOK_CHECKED_AT = '2026-09-10T00:00:00.000Z';

const LINKEDIN_IMAGES_DOC =
  'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api';
const LINKEDIN_TEXT_DOC = 'https://www.linkedin.com/help/linkedin/answer/a528176';
const INSTAGRAM_IMAGE_DOC = 'https://help.instagram.com/1631821640426723';
/**
 * Meta's Graph API reference for creating a Page photo.
 *
 * The business help centre, which is what a marketer is usually pointed at,
 * renders client-side and cannot be read — which is why Facebook stayed
 * `unverified` for a while. The *developer* reference states the limits in
 * plain text, and it is the same platform behaviour, so it is the better
 * source anyway: it says what the API enforces rather than what a help article
 * summarises.
 */
const FACEBOOK_PHOTO_DOC = 'https://developers.facebook.com/docs/graph-api/reference/page/photos/';
const INSTAGRAM_CAPTION_DOC =
  'https://developers.facebook.com/docs/marketing-api/guides/instagramads/ad_creative';

const linkedInSingleImage: ChannelFormatSpec = {
  channel: 'linkedin_organic',
  format: 'single_image',
  hard: {
    imageFormats: ['jpeg', 'png', 'gif'],
    // "Images with less than 36,152,320 pixels" — LinkedIn Images API.
    maxImagePixels: 36_152_320,
    maxImageBytes: null,
    // "Maximum length is 4,086 characters, recommended length is less than 120".
    altTextMaxChars: 4_086,
    verification: 'verified_against_official_docs',
    sourceUrl: LINKEDIN_IMAGES_DOC,
    verifiedAt: CHECKED_AT,
  },
  guidance: {
    bodyMaxChars: 3_000,
    // LinkedIn Help states posts containing media are limited to 2,000.
    bodyMaxCharsWithMedia: 2_000,
    bodyTruncatesAtChars: null,
    headlineMaxChars: null,
    images: [
      { widthPx: 1080, heightPx: 1350, aspectRatioLabel: '4:5', isDefault: true },
      { widthPx: 1080, heightPx: 1080, aspectRatioLabel: '1:1', isDefault: false },
      { widthPx: 1200, heightPx: 627, aspectRatioLabel: '1.91:1', isDefault: false },
    ],
    verification: 'verified_against_official_docs',
    sourceUrl: LINKEDIN_TEXT_DOC,
    verifiedAt: CHECKED_AT,
    // A post worth reading: a few paragraphs, and three to five hashtags.
    length: postLength(80, 3, 5),
  },
  noteNl:
    'Bij een bericht met media geldt een kortere tekstlimiet (2.000 tekens) dan bij een bericht zonder media (3.000 tekens).',
};

const linkedInTextOnly: ChannelFormatSpec = {
  ...linkedInSingleImage,
  format: 'text_only',
  guidance: {
    ...linkedInSingleImage.guidance,
    images: [],
  },
  noteNl: null,
};

const instagramSingleImage: ChannelFormatSpec = {
  channel: 'instagram_organic',
  format: 'single_image',
  hard: {
    // "JPEG is the only image format supported" — Instagram content publishing.
    imageFormats: ['jpeg'],
    maxImagePixels: null,
    maxImageBytes: null,
    altTextMaxChars: null,
    verification: 'verified_against_official_docs',
    sourceUrl: INSTAGRAM_IMAGE_DOC,
    verifiedAt: CHECKED_AT,
  },
  guidance: {
    bodyMaxChars: 2_200,
    bodyMaxCharsWithMedia: null,
    // In-feed captions collapse after roughly two lines, so the hook must lead.
    bodyTruncatesAtChars: 125,
    headlineMaxChars: null,
    images: [
      { widthPx: 1080, heightPx: 1350, aspectRatioLabel: '4:5', isDefault: true },
      { widthPx: 1080, heightPx: 1080, aspectRatioLabel: '1:1', isDefault: false },
    ],
    verification: 'verified_against_official_docs',
    sourceUrl: INSTAGRAM_CAPTION_DOC,
    verifiedAt: CHECKED_AT,
    // Short by nature, but never a one-liner; hashtags carry reach here.
    length: postLength(40, 5, 10),
  },
  noteNl:
    'Instagram kort de tekst in de feed af na circa 125 tekens. Zet de kernboodschap vooraan.',
};

const facebookSingleImage: ChannelFormatSpec = {
  channel: 'facebook_organic',
  format: 'single_image',
  hard: {
    // "File type: .jpeg, .bmp, .png, .gif, .tiff" — Page Photos reference.
    // Listed as documented rather than as the subset we happen to produce, so
    // a check refuses what the platform refuses and nothing more.
    imageFormats: ['jpeg', 'bmp', 'png', 'gif', 'tiff'],
    // Not stated. The reference says Facebook "resizes images to different
    // dimensions" and gives no upload dimension limit, so there is nothing to
    // record — and inventing one would be the failure this field exists to
    // prevent.
    maxImagePixels: null,
    // "Files can not exceed 10MB."
    maxImageBytes: 10 * 1_048_576,
    // Not stated for a Page photo.
    altTextMaxChars: null,
    verification: 'verified_against_official_docs',
    sourceUrl: FACEBOOK_PHOTO_DOC,
    verifiedAt: FACEBOOK_CHECKED_AT,
  },
  guidance: {
    /*
     * Meta publishes no caption length for a Page post, so there is nothing to
     * record. `verification` stays `unverified` for this block rather than
     * being called verified-as-absent: what is unverified is *our* guidance,
     * and we have none from an official source.
     *
     * This does not gate publishability — `isPublishable` reads `hard` only,
     * because that is what the platform enforces. Guidance shapes what we
     * suggest to a writer.
     */
    bodyMaxChars: null,
    bodyMaxCharsWithMedia: null,
    bodyTruncatesAtChars: null,
    headlineMaxChars: null,
    images: [{ widthPx: 1080, heightPx: 1350, aspectRatioLabel: '4:5', isDefault: true }],
    verification: 'unverified',
    sourceUrl: null,
    verifiedAt: null,
    length: postLength(60, 1, 3),
  },
  noteNl:
    'De uploadlimieten van Facebook zijn gecontroleerd tegen de Graph API-documentatie van Meta: maximaal 10 MB per afbeelding. Meta publiceert geen maximale tekstlengte voor een paginabericht, dus daarvoor geldt geen richtlijn. Voor PNG raadt Meta aan onder 1 MB te blijven; onze afbeeldingen zitten daar ruim onder.',
};

/**
 * The landing page: our own page, so our own rules.
 *
 * Everything here is `guidance`, and `hard` is empty of limits, because there
 * is no platform to impose any: the page is served from the label's own site.
 * The numbers below are house style, chosen so a page reads well and stays
 * scannable, not transcribed from anyone's documentation — which is exactly
 * why `verification` says the question does not apply rather than claiming a
 * source that does not exist.
 *
 * There are no image specifications. A landing page's imagery is chosen when
 * the page is built, and our render layer produces social formats; inventing a
 * hero size here would put a number in front of a user that nothing enforces.
 */
/**
 * E-mail: produced, but never publishable from here.
 *
 * The distinction from a landing page matters. A landing page has no platform,
 * so `not_platform_constrained` is the truth. E-mail *does* have constraints —
 * Gmail clips a long message, Outlook renders through Word's engine, clients
 * disagree about almost everything — and we have not verified any of them
 * against a primary source. Marking this `not_platform_constrained` would
 * quietly claim there is nothing to check, which is false and would let a mail
 * reach a publish-ready package on the strength of an assumption.
 *
 * So it is `unverified`, and it behaves exactly like Facebook does for the same
 * reason: content is generated, previewed and exported as a **draft**, and
 * `isPublishable` refuses it. The note says what is unverified, so the refusal
 * is actionable rather than mysterious. Whoever needs a publish-ready e-mail
 * checks the limits of the client they actually send with, records the source
 * and the date here, and the gate opens.
 *
 * The guidance figures below are house style — a readable length for a mail —
 * and are labelled as such rather than dressed up as platform limits.
 */
const emailMessage: ChannelFormatSpec = {
  channel: 'email',
  format: 'text_only',
  hard: {
    imageFormats: [],
    maxImagePixels: null,
    maxImageBytes: null,
    altTextMaxChars: null,
    verification: 'unverified',
    sourceUrl: null,
    verifiedAt: null,
  },
  guidance: {
    bodyMaxChars: 1_500,
    bodyMaxCharsWithMedia: null,
    bodyTruncatesAtChars: null,
    headlineMaxChars: 78,
    images: [],
    verification: 'unverified',
    sourceUrl: null,
    verifiedAt: null,
    // A mail that answers a reader's question: an opening and two to four
    // titled parts, a few hundred words in all. No hashtags in a mail.
    length: {
      minBodyWords: null,
      minTotalWords: 180,
      minSections: 2,
      maxSections: 4,
      minSectionWords: 30,
      minHashtags: 0,
      maxHashtags: 0,
    },
  },
  noteNl:
    'De weergave en afkaplimieten van e-mailclients (Gmail, Outlook, Apple Mail) zijn niet tegen een primaire bron gecontroleerd. Daarom kan een e-mail wel als concept worden geëxporteerd, maar niet publicatieklaar. De HTML bevat geen scripts en laadt niets van internet; er wordt niets verzonden.',
};

/**
 * The website, as one channel, until 2026-09-15.
 *
 * Kept so stored rows still resolve to a specification and a label. It is out
 * of `PRODUCIBLE_CHANNELS`, so nothing new is planned on it.
 */
const legacyWebsite: ChannelFormatSpec = {
  channel: 'landing_page',
  format: 'text_only',
  hard: {
    imageFormats: [],
    maxImagePixels: null,
    maxImageBytes: null,
    altTextMaxChars: null,
    verification: 'not_platform_constrained',
    sourceUrl: null,
    verifiedAt: null,
  },
  guidance: {
    bodyMaxChars: 1_200,
    bodyMaxCharsWithMedia: null,
    bodyTruncatesAtChars: null,
    headlineMaxChars: 120,
    images: [],
    verification: 'not_platform_constrained',
    sourceUrl: null,
    verifiedAt: null,
    length: {
      minBodyWords: null,
      minTotalWords: 500,
      minSections: 4,
      maxSections: 6,
      minSectionWords: 120,
      minHashtags: 0,
      maxHashtags: 0,
    },
  },
  noteNl:
    'Oude vorm van het websitekanaal. Sinds 15 september 2026 zijn een wijziging van de opleidingspagina en een blogartikel aparte kanalen; bestaande stukken blijven hier leesbaar en exporteerbaar.',
};

/**
 * A change proposal for the existing course page.
 *
 * Its unit is the change, not the page: a place, a reason, the passage that is
 * there now and the text that should replace it. So the page-length rules do
 * not apply — they never did, the check exempted this form explicitly — but
 * each proposed passage has to be long enough to stand on the page.
 */
const coursePageUpdate: ChannelFormatSpec = {
  channel: 'course_page_update',
  format: 'text_only',
  hard: {
    imageFormats: [],
    maxImagePixels: null,
    maxImageBytes: null,
    altTextMaxChars: null,
    verification: 'not_platform_constrained',
    sourceUrl: null,
    verifiedAt: null,
  },
  guidance: {
    bodyMaxChars: 1_200,
    bodyMaxCharsWithMedia: null,
    bodyTruncatesAtChars: null,
    headlineMaxChars: 120,
    images: [],
    verification: 'not_platform_constrained',
    sourceUrl: null,
    verifiedAt: null,
    // The introduction explains the proposal; the changes carry the words, and
    // `quality.ts` checks those per change.
    length: {
      minBodyWords: null,
      minTotalWords: null,
      minSections: null,
      maxSections: null,
      minSectionWords: null,
      minHashtags: 0,
      maxHashtags: 0,
    },
  },
  noteNl:
    'Een wijzigingsvoorstel voor de bestaande opleidingspagina: per ingreep de plek, de reden, de huidige passage en de voorgestelde tekst. Je plaatst het zelf in je CMS; het pakket levert het ook als Markdown.',
};

/**
 * A blog article: a page in its own right.
 *
 * The lengths here are the ones the prompt actually asks for. They used to
 * come from the shared website specification, which capped sections at six and
 * demanded 120 words each, while the prompt commissioned four to seven sections
 * of sixty to 320 words — so the system ordered an article it then refused
 * (audit 2026-09-15).
 */
const blogArticle: ChannelFormatSpec = {
  channel: 'blog_article',
  format: 'text_only',
  hard: {
    imageFormats: [],
    maxImagePixels: null,
    maxImageBytes: null,
    altTextMaxChars: null,
    verification: 'not_platform_constrained',
    sourceUrl: null,
    verifiedAt: null,
  },
  guidance: {
    bodyMaxChars: 1_200,
    bodyMaxCharsWithMedia: null,
    bodyTruncatesAtChars: null,
    headlineMaxChars: 120,
    images: [],
    verification: 'not_platform_constrained',
    sourceUrl: null,
    verifiedAt: null,
    length: {
      minBodyWords: null,
      // `MIN_ARTICLE_WORDS` in `quality.ts` holds the same floor for the
      // article's own body; this is the whole piece.
      minTotalWords: 800,
      minSections: 4,
      maxSections: 7,
      minSectionWords: 60,
      minHashtags: 0,
      maxHashtags: 0,
    },
  },
  noteNl:
    'Een blogartikel staat op je eigen site: er is geen platform dat limieten oplegt. De richtlijnen hier zijn huisstijl. Het pakket levert het als tekst en als Markdown, met titel, metabeschrijving en veelgestelde vragen.',
};

/**
 * The three advertising channels.
 *
 * Built as one family because they share everything that matters here: the
 * copy is a set of interchangeable lines, the real character limits and policy
 * rules live in an advertising platform none of which has been read against a
 * primary source, and **no performance figure is produced for any of them**.
 *
 * Every number is `null`, and that is a decision rather than an omission.
 * Stating "30 characters" for a Google headline from memory would be a
 * fabricated citation dressed as a limit — and unlike a social post, where a
 * length guess is cosmetic, an advert that exceeds a limit is silently
 * truncated or rejected by the platform. So the specification says what it
 * knows: nothing, and go and check. `isPublishable` refuses accordingly, which
 * is the same treatment Facebook and e-mail get and for the same reason.
 */
/**
 * LinkedIn single-image advertisement, read against LinkedIn's own advertising
 * specification page (2026-09-15).
 *
 * The three ratios and their recommended sizes are LinkedIn's, as are the
 * truncation points: 150 characters of introductory text and 70 of headline
 * before the platform cuts, with hard maxima of 3.000 and 200. The destination
 * URL is listed as required, which is why `required_cta_links_present` matters
 * more here than on an organic post.
 */
const LINKEDIN_ADS_DOC =
  'https://www.linkedin.com/help/lms/answer/a426534/single-image-ads-advertising-specifications';
const META_ADS_DOC = 'https://www.facebook.com/business/ads-guide/image/facebook-feed/';
const ADS_CHECKED_AT = '2026-09-15T00:00:00.000Z';

const linkedInAdsSingleImage: ChannelFormatSpec = {
  channel: 'linkedin_ads',
  format: 'single_image',
  hard: {
    imageFormats: ['jpeg', 'png', 'gif'],
    maxImagePixels: null,
    // "Max file size: 5MB".
    maxImageBytes: 5 * 1_048_576,
    altTextMaxChars: null,
    verification: 'verified_against_official_docs',
    sourceUrl: LINKEDIN_ADS_DOC,
    verifiedAt: ADS_CHECKED_AT,
  },
  guidance: {
    bodyMaxChars: 3_000,
    bodyMaxCharsWithMedia: null,
    // "150 characters to avoid truncation".
    bodyTruncatesAtChars: 150,
    // "200 character maximum"; 70 before truncation.
    headlineMaxChars: 200,
    images: [
      { widthPx: 1200, heightPx: 628, aspectRatioLabel: '1.91:1', isDefault: true },
      { widthPx: 1200, heightPx: 1200, aspectRatioLabel: '1:1', isDefault: false },
      { widthPx: 720, heightPx: 900, aspectRatioLabel: '4:5', isDefault: false },
    ],
    verification: 'verified_against_official_docs',
    sourceUrl: LINKEDIN_ADS_DOC,
    verifiedAt: ADS_CHECKED_AT,
    // No house-style minimum: an advertisement is short by design, and the
    // platform's own truncation point is the rule that matters.
    length: NO_LENGTH_RULES,
  },
  noteNl:
    'LinkedIn kapt de inleidende tekst af na 150 tekens en de kop na 70; de harde maxima zijn 3.000 en 200. Een bestemmings-URL is verplicht. Dit systeem levert tekst en beeld, geen advertentieaccount: er worden geen zoekvolumes, klikprijzen of conversieverwachtingen geproduceerd.',
};

/**
 * Meta advertisement for the Facebook and Instagram feed, read against Meta's
 * own advertising guide (2026-09-15).
 *
 * The two feeds share the image specification — 4:5 at 1440 × 1800 — and differ
 * on text: Facebook states a headline of 27 characters and primary text of 50
 * to 150, Instagram 40 and 125. The tighter of each is used, because one
 * creative runs on both placements.
 */
const metaAdsSingleImage: ChannelFormatSpec = {
  channel: 'meta_ads',
  format: 'single_image',
  hard: {
    imageFormats: ['jpeg', 'png'],
    maxImagePixels: null,
    maxImageBytes: 30 * 1_048_576,
    altTextMaxChars: null,
    verification: 'verified_against_official_docs',
    sourceUrl: META_ADS_DOC,
    verifiedAt: ADS_CHECKED_AT,
  },
  guidance: {
    bodyMaxChars: null,
    bodyMaxCharsWithMedia: null,
    // Instagram's 125 is the tighter of the two placements.
    bodyTruncatesAtChars: 125,
    // Facebook's 27 is the tighter of the two placements.
    headlineMaxChars: 27,
    images: [{ widthPx: 1440, heightPx: 1800, aspectRatioLabel: '4:5', isDefault: true }],
    verification: 'verified_against_official_docs',
    sourceUrl: META_ADS_DOC,
    verifiedAt: ADS_CHECKED_AT,
    length: NO_LENGTH_RULES,
  },
  noteNl:
    'Eén creatie draait op de Facebook- én de Instagram-feed, dus geldt telkens de strengste van de twee: een kop van 27 tekens en een primaire tekst die na 125 tekens wordt afgekapt. Dit systeem levert tekst en beeld, geen advertentieaccount: er worden geen zoekvolumes, klikprijzen of conversieverwachtingen geproduceerd.',
};

/** The text-only form of each, for a plan cell without an image. */
const linkedInAdsTextOnly: ChannelFormatSpec = {
  ...linkedInAdsSingleImage,
  format: 'text_only',
  guidance: { ...linkedInAdsSingleImage.guidance, images: [] },
};

const metaAdsTextOnly: ChannelFormatSpec = {
  ...metaAdsSingleImage,
  format: 'text_only',
  guidance: { ...metaAdsSingleImage.guidance, images: [] },
};


/**
 * Google Search Ads, read against Google's own page on responsive search ads
 * (2026-09-15): headlines of at most 30 characters, descriptions of at most
 * 90, display paths of at most 15. Those are hard platform limits, so the
 * channel is *verified* and a piece that keeps within them — and passes the
 * copy checks — may go in a publish-ready package. Images are out of scope:
 * the piece is text. What stays unknown is unchanged: no search volume, no
 * click price, no conversion expectation is produced anywhere.
 */
function googleSearchAdsSpec(): ChannelFormatSpec {
  return {
    channel: 'google_search_ads',
    format: 'text_only',
    hard: {
      imageFormats: [],
      maxImagePixels: null,
      maxImageBytes: null,
      altTextMaxChars: null,
      verification: 'verified_against_official_docs',
      sourceUrl: GOOGLE_RSA.source.url,
      verifiedAt: GOOGLE_RSA.verifiedAt,
    },
    guidance: {
      bodyMaxChars: GOOGLE_RSA.descriptions.maxChars,
      bodyMaxCharsWithMedia: null,
      bodyTruncatesAtChars: null,
      headlineMaxChars: GOOGLE_RSA.headlines.maxChars,
      images: [],
      verification: 'verified_against_official_docs',
      sourceUrl: GOOGLE_RSA.source.url,
      verifiedAt: GOOGLE_RSA.verifiedAt,
      length: NO_LENGTH_RULES,
    },
    noteNl: `Responsieve zoekadvertentie volgens Google's documentatie (gelezen ${GOOGLE_RSA.verifiedAt.slice(0, 10)}): ${String(GOOGLE_RSA.headlines.min)} tot ${String(GOOGLE_RSA.headlines.max)} koppen van maximaal ${String(GOOGLE_RSA.headlines.maxChars)} tekens, ${String(GOOGLE_RSA.descriptions.min)} tot ${String(GOOGLE_RSA.descriptions.max)} beschrijvingen van maximaal ${String(GOOGLE_RSA.descriptions.maxChars)} tekens, twee weergavepaden van maximaal ${String(GOOGLE_RSA.paths.maxChars)} tekens. Dit systeem levert de tekst, de zoektermen als suggestie en het kader per fase; zoekvolumes, klikprijzen, biedingen en conversieverwachtingen komen uit het advertentieaccount en staan hier niet.`,
  };
}

const googleSearchAds = googleSearchAdsSpec();

/**
 * Channels whose piece carries a rendered image.
 *
 * The two paid social channels joined on 2026-09-15. They shipped headlines and
 * descriptions and no creative at all, which is not an advertisement: a Meta ad
 * cannot run without an image or a video, and LinkedIn lists the image as
 * required. Google Search Ads stays out — a search advertisement is text.
 *
 * It lives here rather than in the render module because the interface has to
 * answer the same question before anything is generated: the form that asks for
 * one loose piece says whether the channel it picked will come back with an
 * image. Two lists would eventually disagree, and the one the user read would
 * be the wrong one.
 */
/**
 * Channels where the image itself is the click target.
 *
 * This decides whether a call to action belongs *in* the picture. On an organic
 * post — LinkedIn, Instagram, Facebook — tapping the image opens the post; the
 * destination lives in the caption, the first comment or the profile. So a
 * "Bekijk de opleiding →" rendered into an organic image is an instruction the
 * viewer cannot follow, and the arrow points at nothing. A paid single image is
 * the click target and the platform puts its own button beside it, so there the
 * call to action is real.
 *
 * An editorial rule of this product, not a quoted platform specification: it is
 * about what we are willing to draw into a picture, and it is deliberately the
 * conservative side of the question.
 */
export const CLICKABLE_IMAGE_CHANNELS: readonly MarketingChannel[] = Object.freeze([
  'linkedin_ads',
  'meta_ads',
]);

/** Whether a call to action drawn into this channel's image can be followed. */
export function imageIsClickable(channel: MarketingChannel): boolean {
  return CLICKABLE_IMAGE_CHANNELS.includes(channel);
}

export const IMAGE_CHANNELS: readonly MarketingChannel[] = Object.freeze([
  'linkedin_organic',
  'instagram_organic',
  'facebook_organic',
  'linkedin_ads',
  'meta_ads',
]);

export function rendersImage(channel: MarketingChannel): boolean {
  return IMAGE_CHANNELS.includes(channel);
}

export const CHANNEL_CONFIG: ChannelConfigVersion = Object.freeze({
  // 4: the landing page joined the set (P3-1).
  // 5: e-mail joined, unverified and therefore draft-only (P3-2).
  // 6: the three advertising channels joined, likewise draft-only (P3-4).
  // 7: house-style minimums and hashtag ranges per channel (`length`), and the
  //    website piece as a page change or an article (2026-09-12).
  // 8: Google Search Ads verified against Google's documentation: 30 · 90 · 15
  //    (google-ads-practice.md, 2026-09-15).
  // 9: LinkedIn Ads and Meta Ads verified and given images — both shipped copy
  //    with no creative at all, which is not an advertisement (2026-09-15).
  // 10: the website split into a course-page change and a blog article, each
  //    with its own length rules; `landing_page` kept as history (2026-09-15).
  version: 10,
  formats: Object.freeze([
    linkedInSingleImage,
    linkedInTextOnly,
    instagramSingleImage,
    facebookSingleImage,
    legacyWebsite,
    coursePageUpdate,
    blogArticle,
    emailMessage,
    linkedInAdsSingleImage,
    linkedInAdsTextOnly,
    metaAdsSingleImage,
    metaAdsTextOnly,
    googleSearchAds,
  ]) as ChannelFormatSpec[],
});

export function findChannelSpec(
  config: { readonly formats: readonly ChannelFormatSpec[] },
  channel: MarketingChannel,
  format: AssetFormat,
): ChannelFormatSpec | undefined {
  return config.formats.find((item) => item.channel === channel && item.format === format);
}

/**
 * A format may only be offered as publishable when its **hard** constraints are
 * verified. Unverified guidance is fine — it only produces a warning.
 */
export function isPublishable(
  config: { readonly formats: readonly ChannelFormatSpec[] },
  channel: MarketingChannel,
  format: AssetFormat,
): boolean {
  const spec = findChannelSpec(config, channel, format);
  if (spec === undefined) {
    return false;
  }
  /*
   * Two ways a channel can be publishable, and only two.
   *
   * Either its platform limits were read from the platform's own
   * documentation, or there is no platform — see `not_platform_constrained`.
   * Anything else, including a check that has gone stale, is not publishable.
   */
  return (
    spec.hard.verification === 'verified_against_official_docs' ||
    spec.hard.verification === 'not_platform_constrained'
  );
}

/**
 * The house-style minimums of a channel, from whichever format spec carries
 * them; every format of one channel shares the same rules. The advertising
 * defaults apply to a channel without a spec, which cannot happen for a
 * channel in the vocabulary but keeps the return type honest.
 */
export function lengthGuidanceFor(
  channel: MarketingChannel,
  config: { readonly formats: readonly ChannelFormatSpec[] } = CHANNEL_CONFIG,
): LengthGuidance {
  return config.formats.find((item) => item.channel === channel)?.guidance.length ?? NO_LENGTH_RULES;
}

/**
 * The platform-enforced constraints of a channel, if it has a spec.
 *
 * These were declared and then read nowhere in the API for months: the export
 * gate checked only whether a spec had been *verified*, never whether the file
 * obeyed it (audit 2026-09-15). `assertImageWithinChannelLimits` is the caller
 * that closes that.
 */
export function hardConstraintsFor(
  config: { readonly formats: readonly ChannelFormatSpec[] },
  channel: MarketingChannel,
  format: AssetFormat = 'single_image',
): HardConstraints | undefined {
  return findChannelSpec(config, channel, format)?.hard;
}

/** What our renderer can encode. */
export type ImageEncoding = 'png' | 'jpeg';

export const IMAGE_MIME_TYPE: Readonly<Record<ImageEncoding, string>> = Object.freeze({
  png: 'image/png',
  jpeg: 'image/jpeg',
});

/**
 * The encoding to render for a channel.
 *
 * JPEG wherever the platform accepts it, which is everywhere we publish.
 * Instagram's publishing API accepts **only** JPEG, so a PNG could not be
 * uploaded at all; Meta advises keeping a PNG under 1 MB, which a 1080×1350
 * render is not; and LinkedIn's own help page prefers a high-resolution JPEG.
 * PNG remains the fallback for a channel with no spec and for the brand
 * preview, where the file never leaves the tool.
 */
export function imageEncodingFor(
  config: { readonly formats: readonly ChannelFormatSpec[] },
  channel: MarketingChannel,
  format: AssetFormat = 'single_image',
): ImageEncoding {
  const hard = hardConstraintsFor(config, channel, format);
  if (hard === undefined) {
    return 'png';
  }
  return hard.imageFormats.includes('jpeg') ? 'jpeg' : 'png';
}

/** The image size our render layer produces for a channel, if any. */
export function defaultImageSpec(
  config: { readonly formats: readonly ChannelFormatSpec[] },
  channel: MarketingChannel,
  format: AssetFormat = 'single_image',
): ImageSpec | undefined {
  const spec = findChannelSpec(config, channel, format);
  if (spec === undefined) {
    return undefined;
  }
  return spec.guidance.images.find((image) => image.isDefault) ?? spec.guidance.images[0];
}

export const channelWarning = z.object({
  kind: z.enum([
    'body_too_long',
    'body_truncated',
    'specs_unverified',
    'no_image_spec',
    // House-style quality checks (content-assets/quality.ts), 2026-09-12.
    'body_too_short',
    'sections_missing',
    'hashtags_missing',
    'hashtags_invalid',
    'alt_text_missing',
    'website_form_missing',
    'keywords_missing',
    'copied_fact_sentence',
    'repeated_across_pieces',
    'page_excerpt_not_found',
    'page_unavailable',
    // Blog-article practice (blog-article-practice.md), 2026-09-14.
    'article_structure',
    'marketese',
    'unverified_number',
    'unsourced_fact',
    'course_share',
    'readability',
    // Google Ads practice (google-ads-practice.md), 2026-09-15.
    'ad_headline_too_long',
    'ad_description_too_long',
    'ad_assets_missing',
    'ad_policy_risk',
    'ad_keyword_missing',
  ]),
  messageNl: z.string(),
  /** Warnings never block a draft; only `blocksPublishReady` gates the package. */
  blocksPublishReady: z.boolean(),
});
export type ChannelWarning = z.infer<typeof channelWarning>;

/**
 * Checks one piece of content against its channel.
 *
 * Returns warnings rather than throwing, because a draft must always be
 * possible — the user needs to see the copy in order to shorten it.
 */
export function checkAgainstChannel(input: {
  config: { readonly formats: readonly ChannelFormatSpec[] };
  channel: MarketingChannel;
  format: AssetFormat;
  body: string;
  hasImage: boolean;
}): ChannelWarning[] {
  const warnings: ChannelWarning[] = [];
  const spec = findChannelSpec(input.config, input.channel, input.format);

  if (spec === undefined) {
    warnings.push({
      kind: 'specs_unverified',
      messageNl:
        'Voor dit kanaal en formaat zijn nog geen specificaties vastgelegd. Publicatieklaar exporteren is niet mogelijk.',
      blocksPublishReady: true,
    });
    return warnings;
  }

  /*
   * `not_platform_constrained` is not a missing check.
   *
   * Warning that a landing page's specifications are "not verified against an
   * official source" would be telling the user to go and find documentation
   * that does not exist — and it would block a publish-ready export on a check
   * that can never pass. Every *other* state, including a stale one, warns.
   */
  if (
    spec.hard.verification !== 'verified_against_official_docs' &&
    spec.hard.verification !== 'not_platform_constrained'
  ) {
    warnings.push({
      kind: 'specs_unverified',
      messageNl:
        spec.noteNl ??
        'De specificaties van dit kanaal zijn niet tegen een officiële bron gecontroleerd. Publicatieklaar exporteren is niet mogelijk.',
      blocksPublishReady: true,
    });
  }

  const limit = input.hasImage
    ? spec.guidance.bodyMaxCharsWithMedia ?? spec.guidance.bodyMaxChars
    : spec.guidance.bodyMaxChars;

  if (limit !== null && input.body.length > limit) {
    warnings.push({
      kind: 'body_too_long',
      messageNl: `De tekst is ${String(input.body.length)} tekens; het aanbevolen maximum voor dit kanaal is ${String(limit)}.`,
      // Advisory: the platform may still accept it, and guidance can be stale.
      blocksPublishReady: false,
    });
  }

  const truncateAt = spec.guidance.bodyTruncatesAtChars;
  if (truncateAt !== null && input.body.length > truncateAt) {
    warnings.push({
      kind: 'body_truncated',
      messageNl: `Dit kanaal kort de tekst in de feed af na circa ${String(truncateAt)} tekens. Zet de kernboodschap vooraan.`,
      blocksPublishReady: false,
    });
  }

  return warnings;
}

export const CHANNEL_LABEL_NL: Readonly<Record<MarketingChannel, string>> = Object.freeze({
  linkedin_organic: 'LinkedIn',
  instagram_organic: 'Instagram',
  facebook_organic: 'Facebook',
  // Kept for stored rows made before the split; not plannable.
  landing_page: 'Website (oude vorm)',
  course_page_update: 'Wijziging opleidingspagina',
  blog_article: 'Blogartikel',
  email: 'E-mail',
  linkedin_ads: 'LinkedIn Ads',
  meta_ads: 'Meta Ads',
  google_search_ads: 'Google Ads (zoekadvertenties)',
});
