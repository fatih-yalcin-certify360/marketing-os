import { z } from 'zod';
import { hexColor } from './brand.js';
import { bannerScreenplay } from './display-banner-screenplay.js';

/**
 * Animated HTML5 display banners.
 *
 * A banner set is one message rendered at several fixed sizes, animated in the
 * browser, and packaged so it can be uploaded to an advertising platform or
 * hosted on our own site. This file holds the numbers the rest of the system
 * measures itself against, and every one of them carries the page it came from.
 *
 * Three decisions are written into these types rather than left to a prompt.
 *
 * **The model does not write the banner's code.** It contributes copy and, at
 * most, a choice between named motion patterns. The HTML, the CSS and the
 * animation timeline come from templates we wrote and can read. A banner is
 * executable code that runs on someone else's page, and generated code that
 * nobody reviewed is not something to upload to an ad network.
 *
 * **A banner is a set, not a variant.** Content assets carry two variants, A
 * and B, of the same size — a deliberate cap so an A/B test stays a test. Six
 * sizes of one message is a different shape, so it lives in its own type rather
 * than stretching that cap.
 *
 * **What does not fit is dropped, not shrunk.** Google Web Designer's default
 * is to reduce type to a 10 px floor and then truncate with an ellipsis. In
 * Dutch that produces "Herkansingsmogelijk…", which is worse than the line not
 * being there. Each size declares which lines it can carry; copy that still
 * does not fit is refused with the reason, not squeezed.
 */

/* ------------------------------------------------------------------ sizes */

/**
 * The sizes we produce.
 *
 * Picked from the two Dutch publisher lists we could check — Mediahuis
 * Nederland (300x250, 728x90, 120x600, 160x600, 300x600, 970x250) and Ster
 * (which adds 336x280, 468x60, 320x100, 320x50) — intersected with Google Ads'
 * supported set. Six outputs over three layout families: two rectangles, two
 * verticals, two horizontals.
 *
 * Ster's own display inventory is restricted to public-interest messages and
 * forbids any call to enrol, so it is a size reference here and not a channel.
 */
export const bannerSize = z.enum(['300x250', '336x280', '300x600', '160x600', '728x90', '320x50']);
export type BannerSize = z.infer<typeof bannerSize>;

/**
 * The layout families.
 *
 * Three, not six. A rectangle stacks headline over support over CTA; a vertical
 * has room for three short lines and a tall image field; a horizontal is one
 * line read left to right with the CTA at the end. Sizes inside a family share
 * a template and differ only in their numbers.
 */
export const bannerFamily = z.enum(['rectangle', 'vertical', 'horizontal']);
export type BannerFamily = z.infer<typeof bannerFamily>;

export interface BannerSizeSpec {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly family: BannerFamily;
  /**
   * The IAB initial-load budget for this size, in **gzipped** bytes.
   *
   * From the IAB New Ad Portfolio fixed-size specification: "File weights are
   * calculated after files have been compressed into gzip format." 300x250 and
   * 160x600 are 150 kB, 300x600 is 250 kB (portrait/large-rectangle group),
   * 728x90 is 150 kB, 320x50 is 50 kB. 336x280 is not in the fixed table; its
   * pixel area puts it in the same flexible group as 300x250.
   *
   * Google Studio's own guidance is lower and more recent — "keep first ad load
   * below 200 KB", up to 500 KB total — so a build inside the IAB number for
   * its size is inside Google's too, except at 320x50 where IAB is stricter.
   */
  readonly initialLoadGzipBytes: number;
  /** Which lines this size can carry at a legible type size. */
  readonly carries: { readonly support: boolean; readonly legal: boolean };
  /**
   * How much text fits, as lines and characters per line.
   *
   * A stand-in for measuring the rendered string, which is what we actually
   * want and what a later build step will do in a real browser. Character
   * counts lie in Dutch — `herkansingsmogelijkheid` is one unbreakable token
   * that no per-line average survives — so these are deliberately conservative,
   * and a string that passes here can still be refused by the fitter once it
   * exists.
   *
   * Line counts are the load-bearing half. A horizontal strip is a one-line
   * format: it is not a rectangle with less room, and the single most reliable
   * tell of generated work is a rectangle's copy wrapped into a leaderboard.
   *
   * Every number here is arithmetic against the rendered box, not taste:
   * usable width ÷ (type size × 0.52, the average glyph width of a bold face).
   * They used to be a separate table from the type scale, and the two drifted
   * apart — the budget said a line fitted while the browser pushed it 25px out
   * of the banner. `tools/banner-fit` measures the real thing and is what these
   * were re-derived from on 2026-09-16.
   *
   * The longest-word check is the one that bites. A Dutch compound cannot
   * break, so `perLine` is the width of a single line and not an average over
   * the sentence: at 160x600 "verzuimdossier?" is fifteen characters that must
   * live on one line of 136 pixels, which is what set that size's type.
   *
   * Still provisional in one way: the average glyph width is a constant, and a
   * real fitter would measure the actual string after the font has loaded. They
   * are therefore deliberately tight — too strict costs a refusal with a
   * readable reason, too loose ships a banner with text hanging out of it.
   */
  readonly fits: {
    readonly headline: { readonly lines: number; readonly perLine: number };
    readonly support: { readonly lines: number; readonly perLine: number };
    readonly cta: number;
  };
  /** Inner margin held on all four sides. */
  readonly paddingPx: number;
}

export const BANNER_SIZES: Readonly<Record<BannerSize, BannerSizeSpec>> = Object.freeze({
  '300x250': {
    widthPx: 300, heightPx: 250, family: 'rectangle', initialLoadGzipBytes: 150_000,
    carries: { support: true, legal: true },
    fits: { headline: { lines: 2, perLine: 21 }, support: { lines: 2, perLine: 34 }, cta: 18 }, paddingPx: 12,
  },
  '336x280': {
    widthPx: 336, heightPx: 280, family: 'rectangle', initialLoadGzipBytes: 150_000,
    carries: { support: true, legal: true },
    fits: { headline: { lines: 2, perLine: 22 }, support: { lines: 2, perLine: 36 }, cta: 18 }, paddingPx: 12,
  },
  '300x600': {
    widthPx: 300, heightPx: 600, family: 'vertical', initialLoadGzipBytes: 250_000,
    carries: { support: true, legal: true },
    fits: { headline: { lines: 3, perLine: 17 }, support: { lines: 3, perLine: 30 }, cta: 18 }, paddingPx: 16,
  },
  '160x600': {
    widthPx: 160, heightPx: 600, family: 'vertical', initialLoadGzipBytes: 150_000,
    carries: { support: true, legal: false },
    fits: { headline: { lines: 3, perLine: 16 }, support: { lines: 3, perLine: 22 }, cta: 14 }, paddingPx: 12,
  },
  '728x90': {
    widthPx: 728, heightPx: 90, family: 'horizontal', initialLoadGzipBytes: 150_000,
    carries: { support: true, legal: false },
    fits: { headline: { lines: 1, perLine: 38 }, support: { lines: 1, perLine: 38 }, cta: 16 }, paddingPx: 10,
  },
  // One line and a button. Shrinking the rectangle into this strip is the most
  // reliable tell of automated output, and the IAB budget here is 50 kB — a
  // third of what the animation engine alone would cost.
  '320x50': {
    widthPx: 320, heightPx: 50, family: 'horizontal', initialLoadGzipBytes: 50_000,
    carries: { support: false, legal: false },
    fits: { headline: { lines: 1, perLine: 20 }, support: { lines: 0, perLine: 0 }, cta: 16 }, paddingPx: 8,
  },
});

export const BANNER_SIZE_ORDER: readonly BannerSize[] = Object.freeze([
  '300x250', '336x280', '300x600', '160x600', '728x90', '320x50',
] as const);

/* --------------------------------------------------------------- platform */

/**
 * Where the banner is going.
 *
 * Not a cosmetic setting: the destination decides whether a font file may
 * travel in the package, whether a click URL belongs in the creative, and how
 * many bytes there are to spend. The same message therefore produces different
 * files per destination, and we say which one a package was built for.
 */
export const bannerPlatform = z.enum(['google_ads', 'self_hosted']);
export type BannerPlatform = z.infer<typeof bannerPlatform>;

export interface BannerPlatformRules {
  readonly labelNl: string;
  /** Maximum size of the uploaded ZIP, in bytes; null where the destination sets none. */
  readonly maxZipBytes: number | null;
  /** Maximum number of files in the ZIP; null where the destination sets none. */
  readonly maxFiles: number | null;
  /** File extensions the destination accepts inside the package. */
  readonly allowedExtensions: readonly string[];
  /** Whether a font file may travel inside the package at all. */
  readonly allowsFontFiles: boolean;
  /** Whether `<meta name="ad.size">` is required in the head. */
  readonly requiresAdSizeMeta: boolean;
  /**
   * How a click leaves the creative.
   *
   * `final_url` — the platform owns the destination and the whole creative is
   * the exit; a URL inside the file is at best ignored. `click_tag` — the
   * creative must declare `var clickTag` unminified in the head and exit
   * through it.
   */
  readonly clickThrough: 'final_url' | 'click_tag';
  /** The page these rules were read from, so a reader can check them. */
  readonly sourceUrl: string;
  /** When we last read that page. */
  readonly checkedOn: string;
}

export const BANNER_PLATFORM_RULES: Readonly<Record<BannerPlatform, BannerPlatformRules>> =
  Object.freeze({
    /*
     * Google Ads display upload ads.
     *
     * Two rules here shape the whole generator. Font files are not on the
     * accepted list and "using non-Google fonts" is a named disapproval reason,
     * so brand type has to become artwork. And the click-through is taken from
     * the campaign's Final URL — Google states that after removing the exit
     * script "your entire ad will be clickable" — so there is no click tag to
     * wire and multiple exits are refused.
     *
     * Not encoded here because it is not ours to check: this ad type requires
     * an account open more than 90 days with more than $9,000 USD lifetime
     * spend, plus an application. A package that passes every check below can
     * still be un-uploadable for that reason.
     */
    google_ads: {
      labelNl: 'Google Ads (geüpload display)',
      maxZipBytes: 600 * 1024,
      maxFiles: 40,
      allowedExtensions: ['.html', '.css', '.js', '.gif', '.png', '.jpg', '.jpeg', '.svg'],
      allowsFontFiles: false,
      requiresAdSizeMeta: true,
      clickThrough: 'final_url',
      sourceUrl: 'https://support.google.com/google-ads/answer/1722096?hl=en',
      checkedOn: '2026-09-16',
    },
    /*
     * Our own site. No reviewer, so the budget is the visitor's connection and
     * the rules are the ones we keep for our own sake.
     */
    self_hosted: {
      labelNl: 'Eigen website',
      maxZipBytes: null,
      maxFiles: null,
      allowedExtensions: [
        '.html', '.css', '.js', '.gif', '.png', '.jpg', '.jpeg', '.svg',
        '.woff', '.woff2', '.ttf', '.otf', '.txt', '.json',
      ],
      allowsFontFiles: true,
      requiresAdSizeMeta: false,
      clickThrough: 'click_tag',
      sourceUrl: 'https://www.iab.com/wp-content/uploads/2019/04/IABNewAdPortfolio_LW_FixedSizeSpec.pdf',
      checkedOn: '2026-09-16',
    },
  });

/* ------------------------------------------------------------------ fonts */

/**
 * How the brand's type reaches the banner.
 *
 * `google_font` — the family is published on Google Fonts, which is the one
 * external reference every destination allows and whose licences (OFL, Apache,
 * UFL) permit redistribution.
 * `embedded_webfont` — the font file travels in the package. Only where the
 * destination accepts font files, and only where the licence allows it.
 * `svg_outline` — the headline is converted to vector outlines and is no longer
 * a font at all. What the commercial platforms do, and the only route for a
 * commercial family on Google Ads.
 * `system_stack` — a common-denominator stack. Honest and free; not the brand.
 */
export const bannerFontStrategy = z.enum([
  'google_font', 'embedded_webfont', 'svg_outline', 'system_stack',
]);
export type BannerFontStrategy = z.infer<typeof bannerFontStrategy>;

/**
 * Families published on Google Fonts that the brand profiles here actually use.
 *
 * A short allow-list rather than a live lookup: it is checked by hand, it
 * cannot be wrong at run time, and being absent from it costs a fallback rather
 * than a broken banner. Lower-case; compared case-insensitively.
 */
export const GOOGLE_FONT_FAMILIES: readonly string[] = Object.freeze([
  'plus jakarta sans', 'jetbrains mono', 'inter', 'roboto', 'open sans', 'lato',
  'montserrat', 'source sans 3', 'work sans', 'dm sans', 'manrope', 'figtree',
  'noto sans', 'nunito', 'nunito sans', 'poppins', 'raleway', 'rubik',
  'ibm plex sans', 'ibm plex serif', 'merriweather', 'playfair display',
  'libre baskerville', 'lora', 'pt sans', 'pt serif', 'karla', 'mulish',
]);

export function isGoogleFontFamily(family: string): boolean {
  return GOOGLE_FONT_FAMILIES.includes(family.trim().toLowerCase());
}

/* ----------------------------------------------------------------- motion */

/**
 * The animation engine.
 *
 * GSAP is free for commercial use under the standard "no charge" licence of 30
 * April 2025, including the plugins that used to be members-only, with no
 * attribution requirement; the grant covers reproducing and distributing it,
 * which is what putting it in the package does. The one obligation is that the
 * `/*!` banner at the top of the file stays, because removing proprietary
 * notices is a listed restriction.
 *
 * It costs 28,314 bytes gzipped, which is fine against a 150 kB budget and more
 * than half of the 50 kB one at 320x50 — so that size uses CSS, where a single
 * crossfade is the right design anyway.
 */
export const bannerEngine = z.enum(['gsap', 'css']);
export type BannerEngine = z.infer<typeof bannerEngine>;

/**
 * The motion pattern, by name.
 *
 * Named patterns rather than a free timeline, so what runs on a stranger's page
 * is something we wrote. Every one of them is a single pass that ends in a
 * still endframe.
 *
 * `reveal` — lines arrive one at a time behind a mask, 60–90 ms apart.
 * `crossfade` — one line replaces the next in opacity only. The safest motion
 * there is: opacity and colour changes are the two kinds that do not trigger
 * vestibular symptoms.
 * `none` — the endframe, drawn once. Always producible, always compliant.
 */
export const bannerMotion = z.enum(['reveal', 'crossfade', 'none']);
export type BannerMotion = z.infer<typeof bannerMotion>;

export const MOTION_LABEL_NL: Readonly<Record<BannerMotion, string>> = Object.freeze({
  reveal: 'Regels komen één voor één binnen',
  crossfade: 'Regels wisselen elkaar af (alleen doorzichtigheid)',
  none: 'Geen beweging — alleen het eindbeeld',
});

/**
 * Above this, a banner must offer a way to stop it.
 *
 * WCAG 2.2.2 asks for a pause, stop or hide control for motion that starts by
 * itself, runs longer than five seconds and sits beside other content — and a
 * banner in a page is the textbook case of beside-other-content, so the
 * advertising exemption people cite does not reach it.
 *
 * The first version treated that as a reason to stay under five seconds. That
 * was the wrong trade: three screens in four and a half seconds gives each one
 * about a second, which is not long enough to read a Dutch sentence. Reading
 * time is what the banner is for. So the sequence takes the time it needs and
 * the control gets built — it costs about a kilobyte.
 */
export const BANNER_PAUSE_THRESHOLD_MS = 5_000;

/**
 * The ceiling, whatever the screens ask for.
 *
 * Google allows thirty seconds; IAB's HTML5 guidance says fifteen, and the
 * publishers who restate it enforce fifteen. Fifteen also keeps us far from
 * Chrome's heavy-ad intervention, which unloads an ad that spends more than
 * fifteen seconds of main thread in any thirty-second window. A sequence that
 * would run past this is scaled down rather than cut off, so the last screen
 * is never the one that disappears.
 */
export const BANNER_MAX_DURATION_MS = 15_000;

/* ------------------------------------------------------------------ build */

export const bannerCheck = z.object({
  id: z.string().min(1),
  titleNl: z.string().min(1),
  passed: z.boolean(),
  /** What was measured, in Dutch, safe to show. */
  detailNl: z.string(),
});
export type BannerCheck = z.infer<typeof bannerCheck>;

export const bannerBuild = z.object({
  size: bannerSize,
  engine: bannerEngine,
  motion: bannerMotion,
  fontStrategy: bannerFontStrategy,
  /** How many screens run before the endframe at this size. */
  frameCount: z.number().int().nonnegative(),
  /** Every file in this size's folder, so the package is inspectable from the report. */
  files: z.array(
    z.object({
      name: z.string().min(1),
      bytes: z.number().int().nonnegative(),
      gzipBytes: z.number().int().nonnegative(),
    }),
  ),
  /** All files together, uncompressed. */
  bytes: z.number().int().nonnegative(),
  /** All files together after gzip, which is what a file-weight budget counts. */
  gzipBytes: z.number().int().nonnegative(),
  budgetGzipBytes: z.number().int().positive(),
  /** Lines this size could not carry, named so nobody wonders where they went. */
  droppedNl: z.array(z.string()),
  checks: z.array(bannerCheck),
});
export type BannerBuild = z.infer<typeof bannerBuild>;

export const bannerSetReport = z.object({
  platform: bannerPlatform,
  screenplay: bannerScreenplay,
  builds: z.array(bannerBuild),
  /** What the build did and chose not to do, in Dutch. */
  notesNl: z.array(z.string()),
  /** Sizes that were asked for and could not be produced, with the reason. */
  refusedNl: z.array(z.object({ size: bannerSize, reasonNl: z.string() })),
});
export type BannerSetReport = z.infer<typeof bannerSetReport>;

export const bannerSetInput = z.object({
  platform: bannerPlatform.default('self_hosted'),
  sizes: z.array(bannerSize).min(1).max(BANNER_SIZE_ORDER.length),
  motion: bannerMotion.default('reveal'),
  screenplay: bannerScreenplay,
  /** Where a click goes. Ignored by destinations that own the destination URL. */
  clickUrl: z.url().nullable().default(null),
  colors: z.object({
    background: hexColor,
    foreground: hexColor,
    accent: hexColor,
    onAccent: hexColor,
  }),
});
export type BannerSetInput = z.infer<typeof bannerSetInput>;

/** Every size a person may pick, in the order the picker shows them. */
export function bannerSizesFor(platform: BannerPlatform): readonly BannerSize[] {
  // Every size we produce is on Google's supported list, so the platform does
  // not narrow the set today. The function exists because the next destination
  // will, and a caller that already asks is a caller that keeps working.
  void platform;
  return BANNER_SIZE_ORDER;
}
