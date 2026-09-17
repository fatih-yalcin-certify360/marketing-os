import {
  BANNER_PLATFORM_RULES,
  isGoogleFontFamily,
  type BannerFontStrategy,
  type BannerPlatform,
} from '@c360/contracts';

/**
 * How the brand's type reaches a banner, per destination.
 *
 * This is the decision the whole feature turns on, and it is not a preference.
 * A Google Ads display upload accepts `.css .js .html .gif .png .jpeg .svg` and
 * nothing else — a font file is not on the list — and "using non-Google fonts"
 * is a named reason for disapproval. So on that destination a commercial
 * typeface cannot travel as a font at all.
 *
 * There is a second reason to be careful even where the platform permits it.
 * Putting a font file in a package that is uploaded to an ad network is
 * redistribution, and a desktop licence generally does not cover it: Monotype,
 * for one, states that converting desktop fonts to web fonts with third-party
 * tools is not allowed under a standard desktop licence, and that advertising
 * use needs a separate metered licence. We do not know what licence a customer
 * holds for the font they uploaded, and we do not pretend to.
 *
 * Google Fonts are the exception at both ends: OFL, Apache and UFL all permit
 * redistribution and self-hosting, and Google Fonts is the one external
 * reference every destination in the matrix allows.
 *
 * The remaining route, and the one the commercial platforms take, is to convert
 * the headline to vector outlines — then it is artwork, not a font, and both
 * problems disappear at once. That step is not built yet, so a brand face that
 * is not a Google font currently falls back to a system stack **and says so**,
 * loudly, rather than shipping a banner that quietly is not the brand.
 */

/** A common-denominator stack. Present on every platform, owned by nobody. */
export const SYSTEM_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export interface BannerFontDecision {
  strategy: BannerFontStrategy;
  /** The CSS `font-family` value for the document. */
  stack: string;
  /** A family to pull from Google Fonts, or null. */
  googleFamily: string | null;
  /** Why it is what it is, in Dutch, when that is worth saying. */
  noteNl: string | null;
}

export function resolveBannerFont(
  headingFamily: string,
  platform: BannerPlatform,
  /** The approved brand font files, where the caller has them. */
  fonts: readonly { families: readonly string[] }[] = [],
): BannerFontDecision {
  const family = headingFamily.trim();
  const quoted = `"${family.replace(/"/gu, '')}"`;
  const rules = BANNER_PLATFORM_RULES[platform];

  /*
   * The brand's own file, where it may travel.
   *
   * Preferred over Google Fonts when both are possible: it is the letter the
   * brand approved, it needs no external request, and a packaged file cannot
   * change under the banner later. The licence question is the customer's and
   * the report says so — we do not know what they hold.
   */
  if (
    rules.allowsFontFiles &&
    fonts.some((file) =>
      file.families.some((name) => name.trim().toLowerCase() === family.toLowerCase()),
    )
  ) {
    return {
      strategy: 'embedded_webfont',
      stack: `${quoted}, ${SYSTEM_STACK}`,
      googleFamily: null,
      noteNl: null,
    };
  }

  if (isGoogleFontFamily(family)) {
    return {
      strategy: 'google_font',
      stack: `${quoted}, ${SYSTEM_STACK}`,
      googleFamily: family,
      noteNl: null,
    };
  }

  return {
    strategy: 'system_stack',
    stack: SYSTEM_STACK,
    googleFamily: null,
    noteNl: rules.allowsFontFiles
      ? `${family} staat niet op Google Fonts. De banners gebruiken daarom een systeemletter en niet de merkletter. ` +
        'Omzetten van de kop naar vectorcontouren — de route die dit oplost én de vraag over de fontlicentie vermijdt — is nog niet gebouwd.'
      : `${family} staat niet op Google Fonts, en ${rules.labelNl} accepteert geen fontbestanden in het pakket. ` +
        'De banners gebruiken daarom een systeemletter en niet de merkletter. Omzetten van de kop naar vectorcontouren is nog niet gebouwd.',
  };
}
