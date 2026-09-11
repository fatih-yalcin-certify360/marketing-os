import { z } from 'zod';

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
  'landing_page',
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
  'landing_page',
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
});
export type ChannelGuidance = z.infer<typeof channelGuidance>;

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
  },
  noteNl:
    'De weergave en afkaplimieten van e-mailclients (Gmail, Outlook, Apple Mail) zijn niet tegen een primaire bron gecontroleerd. Daarom kan een e-mail wel als concept worden geëxporteerd, maar niet publicatieklaar. De HTML bevat geen scripts en laadt niets van internet; er wordt niets verzonden.',
};

const landingPage: ChannelFormatSpec = {
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
    // The introduction above the first section; long enough to say who the
    // page is for, short enough to read before scrolling.
    bodyMaxChars: 1_200,
    bodyMaxCharsWithMedia: null,
    bodyTruncatesAtChars: null,
    headlineMaxChars: 120,
    images: [],
    verification: 'not_platform_constrained',
    sourceUrl: null,
    verifiedAt: null,
  },
  noteNl:
    'Een landingspagina staat op je eigen site: er is geen platform dat limieten oplegt. De richtlijnen hier zijn huisstijl, geen platformregels. De pagina wordt als losse secties geleverd, niet als HTML — je plaatst ze zelf in je CMS.',
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
function adChannel(channel: 'linkedin_ads' | 'meta_ads' | 'google_search_ads'): ChannelFormatSpec {
  const platformNl = {
    linkedin_ads: 'LinkedIn Campaign Manager',
    meta_ads: 'Meta Ads Manager',
    google_search_ads: 'Google Ads',
  }[channel];

  return {
    channel,
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
      // Deliberately null: see the note above. A guessed limit is worse than
      // no limit, because it looks like it was checked.
      bodyMaxChars: null,
      bodyMaxCharsWithMedia: null,
      bodyTruncatesAtChars: null,
      headlineMaxChars: null,
      images: [],
      verification: 'unverified',
      sourceUrl: null,
      verifiedAt: null,
    },
    noteNl: `De tekstlimieten en advertentieregels van ${platformNl} zijn niet tegen een primaire bron gecontroleerd, dus staan hier geen maximale lengtes. Controleer koppen, beschrijvingen en beleid in ${platformNl} zelf voordat je een advertentie aanzet. Dit systeem levert alleen tekstvoorstellen: er worden geen zoekvolumes, klikprijzen of conversieverwachtingen geproduceerd, want daarvoor is een advertentieaccount en een meetperiode nodig.`,
  };
}

const linkedInAds = adChannel('linkedin_ads');
const metaAds = adChannel('meta_ads');
const googleSearchAds = adChannel('google_search_ads');

export const CHANNEL_CONFIG: ChannelConfigVersion = Object.freeze({
  // 4: the landing page joined the set (P3-1).
  // 5: e-mail joined, unverified and therefore draft-only (P3-2).
  // 6: the three advertising channels joined, likewise draft-only (P3-4).
  version: 6,
  formats: Object.freeze([
    linkedInSingleImage,
    linkedInTextOnly,
    instagramSingleImage,
    facebookSingleImage,
    landingPage,
    emailMessage,
    linkedInAds,
    metaAds,
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
  kind: z.enum(['body_too_long', 'body_truncated', 'specs_unverified', 'no_image_spec']),
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
  landing_page: 'Landingspagina',
  email: 'E-mail',
  linkedin_ads: 'LinkedIn Ads',
  meta_ads: 'Meta Ads',
  google_search_ads: 'Google Search Ads',
});
