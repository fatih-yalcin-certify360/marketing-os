import { z } from 'zod';
import { dataOrigin, isoTimestamp, uuid, versionNumber } from './primitives.js';
import { reviewState } from './workflow.js';

/**
 * Brand profile.
 *
 * Brand rules are **hard constraints** for content and image generation, not
 * suggestions: the render layer reads colours and fonts from the approved
 * version, and generation is told what it may not say.
 *
 * Extracted values are always a *proposal*. Nothing extracted becomes part of
 * an approved profile until a person has looked at it, which is why the
 * extraction flow writes a draft version rather than updating in place.
 */

/** Hex colour, validated so it can be dropped straight into SVG. */
export const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/u, 'Gebruik een hexcode van zes tekens, bijvoorbeeld #183B3E.');

export const brandColors = z.object({
  primary: hexColor,
  /** Used for large surfaces behind headline text. */
  surface: hexColor,
  /** Call-to-action and accents. */
  accent: hexColor,
  /** Text colour used on the primary surface; must contrast with it. */
  onPrimary: hexColor,
  onSurface: hexColor,
});
export type BrandColors = z.infer<typeof brandColors>;

export const brandTypography = z.object({
  headingFamily: z.string().min(1).max(80),
  bodyFamily: z.string().min(1).max(80),
  /** Recorded so a licence question can be answered later, per requirement 5. */
  licenceNote: z.string().max(500).nullable(),
});
export type BrandTypography = z.infer<typeof brandTypography>;

export const toneOfVoice = z.object({
  /** Short adjectives, e.g. ["helder", "persoonlijk", "zonder overdrijving"]. */
  traits: z.array(z.string().min(2).max(40)).max(8),
  /** Free-text description in Dutch. */
  description: z.string().max(1_500),
});
export type ToneOfVoice = z.infer<typeof toneOfVoice>;

export const brandRule = z.object({
  kind: z.enum(['must', 'must_not']),
  text: z.string().min(3).max(300),
});
export type BrandRule = z.infer<typeof brandRule>;

export const portalProvenance = z.object({
  slug: z.string(), release: z.string(), channel: z.literal('production'),
  importedAt: isoTimestamp, fingerprint: z.string().length(64),
  fontAssetIds: z.array(uuid).max(12),
  styleGuide: z.string().max(40_000), contentInstructions: z.string().max(40_000),
  imageInstructions: z.string().max(40_000), approvedExamples: z.string().max(40_000),
  warnings: z.array(z.string().max(500)),
});

export const brandProfileVersion = z.object({
  portal: portalProvenance.nullable().optional(),
  id: uuid,
  labelId: uuid,
  version: versionNumber,
  brandName: z.string().min(1).max(160),
  colors: brandColors,
  typography: brandTypography,
  tone: toneOfVoice,
  rules: z.array(brandRule).max(40),
  /** Example copy that reads the way this brand should read. */
  exampleContent: z.string().max(4_000),
  /** Wordmark rendered into images by our own layer, never drawn by a model. */
  logoText: z.string().max(60).nullable(),
  logoAssetId: uuid.nullable(),
  imageUsageNote: z.string().max(500).nullable(),
  reviewState,
  origin: dataOrigin,
  createdAt: isoTimestamp,
  createdByUserId: uuid.nullable(),
});
export type BrandProfileVersion = z.infer<typeof brandProfileVersion>;

/** Payload for creating or revising a brand profile. */
export const brandProfileInput = z.object({
  brandName: z.string().min(1).max(160),
  colors: brandColors,
  typography: brandTypography,
  tone: toneOfVoice,
  rules: z.array(brandRule).max(40).default([]),
  exampleContent: z.string().max(4_000).default(''),
  logoText: z.string().max(60).nullable().default(null),
  /**
   * An uploaded logo image for this label.
   *
   * Only the id travels: the file itself was uploaded and validated
   * separately, and the server re-checks that the asset belongs to this label
   * and is a logo before storing the reference. A client-supplied id is a
   * request, never an authorisation — an id from another label reads as absent.
   *
   * `logoText` remains the fallback. A label with neither gets a wordmark drawn
   * from its brand name, which is honest about being a placeholder rather than
   * pretending to be a logo nobody supplied.
   */
  logoAssetId: uuid.nullable().default(null),
  imageUsageNote: z.string().max(500).nullable().default(null),
});
export type BrandProfileInput = z.infer<typeof brandProfileInput>;

/**
 * Neutral starting point for a new label.
 *
 * Deliberately **not** Lindenhaeghe's real palette or wordmark — those have not
 * been supplied, and inventing them would put fabricated brand identity into
 * the product. These are the Certify360 interface tokens, offered as an
 * obvious placeholder the user is expected to replace.
 */
export const BRAND_STARTING_POINT = Object.freeze({
  brandName: 'Nieuw merkprofiel (voorbeeld — vervang dit)',
  colors: {
    primary: '#183B3E',
    surface: '#F5F6F9',
    accent: '#7762CF',
    onPrimary: '#FFFFFF',
    onSurface: '#183B3E',
  },
  typography: {
    headingFamily: 'Inter',
    bodyFamily: 'Inter',
    licenceNote: null,
  },
  tone: {
    traits: ['helder', 'persoonlijk', 'met bewijs'],
    description:
      'Schrijf helder en persoonlijk. Onderbouw wat je stelt en vermijd overdrijving of stellige beloftes.',
  },
  rules: [
    { kind: 'must', text: 'Onderbouw een claim of laat hem weg.' },
    { kind: 'must_not', text: 'Geen garanties over slagingskans, resultaat of doorlooptijd.' },
    { kind: 'must_not', text: 'Geen prijzen of data noemen die niet zijn gecontroleerd.' },
  ],
  exampleContent: '',
  logoText: null,
  logoAssetId: null,
  imageUsageNote: null,
} satisfies BrandProfileInput);
