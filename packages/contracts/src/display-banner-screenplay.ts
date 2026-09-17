import { z } from 'zod';

/**
 * What a banner shows, in the order it shows it.
 *
 * The first version of this feature put one headline, one support line and a
 * button on screen at once and moved them a little. That is a poster, not a
 * banner. A banner that reads as agency work is a short sequence: a loader
 * while the assets arrive, two or three screens that each say one thing, and a
 * still endframe with the call to action that stays for the rest of the
 * impression.
 *
 * The shape here is taken from a shipped 300x600 kept in `reference-banners/`:
 * loader, hook line, headline, a rotating list of proof points, then the CTA
 * with a disclaimer. This type is that structure made explicit, so the builder
 * can lay it out per size instead of every banner being the same picture.
 *
 * The model fills these strings. It does not write the timeline, the markup or
 * the script — those come from templates we wrote and can read.
 */

/**
 * What a screen is for.
 *
 * `hook` opens: the reason to keep looking, usually a question or a situation.
 * `proof` is the claim with something behind it.
 * `usp` is a short list shown one item at a time — the pattern the reference
 * banner uses to fit four selling points into a space that holds one.
 * `cta` is the endframe, which is a screen like any other except that it never
 * leaves.
 */
export const bannerFrameKind = z.enum(['hook', 'proof', 'usp', 'cta']);
export type BannerFrameKind = z.infer<typeof bannerFrameKind>;

export const FRAME_LABEL_NL: Readonly<Record<BannerFrameKind, string>> = Object.freeze({
  hook: 'Opening',
  proof: 'Bewijs',
  usp: 'Pluspunten',
  cta: 'Eindbeeld',
});

export const bannerFrame = z.object({
  kind: bannerFrameKind,
  /**
   * What the screen says.
   *
   * One line for a hook, at most two for a proof screen, and one per item for a
   * usp list. Kept as separate strings rather than one blob with newlines
   * because the animation staggers them and the fitter measures them one by one.
   */
  lines: z.array(z.string().min(1).max(90)).min(1).max(4),
});
export type BannerFrame = z.infer<typeof bannerFrame>;

/**
 * The whole sequence.
 *
 * Deliberately short. Everything has to finish inside the budget that keeps
 * WCAG 2.2.2 from demanding a pause control, and an impression that gets more
 * than a couple of seconds of attention is the exception.
 */
export const bannerScreenplay = z.object({
  /**
   * The screens before the endframe, in order.
   *
   * At least one, at most three. A fourth screen does not fit in four and a
   * half seconds without each one becoming too quick to read.
   */
  frames: z.array(bannerFrame).min(1).max(3),
  /** The button. A verb, in sentence case. */
  ctaText: z.string().min(1).max(24),
  /** A short line for the corner, like the reference banner's "Bereken je premie". */
  stickerNl: z.string().max(28).nullable().default(null),
  /** Conditions, accreditation, a price footnote. Only where one is required. */
  legalNl: z.string().max(120).nullable().default(null),
  /**
   * A one-line brief for the background image, in English, or null for a flat
   * brand field.
   *
   * English because that is what the image models are trained on, and one line
   * because a background is the thing behind the type: a busy scene makes the
   * copy unreadable at 160 pixels wide.
   */
  backgroundBriefEn: z.string().max(300).nullable().default(null),
});
export type BannerScreenplay = z.infer<typeof bannerScreenplay>;

/**
 * Where a proposed screenplay came from.
 *
 * A banner made from a campaign rests on material that was already approved:
 * the brief, the chosen audience and the chosen direction. Recording which
 * versions those were is what lets somebody check the banner against them
 * later, and what makes a stale banner visible when the brief moves on.
 */
export const bannerProvenance = z.object({
  briefVersionId: z.uuid().nullable(),
  personaVersionIds: z.array(z.uuid()),
  conceptVersionId: z.uuid().nullable(),
  courseVersionId: z.uuid(),
});
export type BannerProvenance = z.infer<typeof bannerProvenance>;

export const bannerProposal = z.object({
  screenplay: bannerScreenplay,
  /** Why this sequence, in Dutch, in one or two sentences. */
  rationaleNl: z.string().max(600),
});
export type BannerProposal = z.infer<typeof bannerProposal>;
