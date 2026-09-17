import { z } from 'zod';
import { cents, dataOrigin, isoTimestamp, slug, uuid } from './primitives.js';
import { hexColor } from './brand.js';
import { labelRole } from './access.js';

/**
 * The three colours the interface takes from a label.
 *
 * Read from that label's *approved* brand profile, never from a draft and never
 * invented: `null` means the label has no approved profile, and the interface
 * says so and falls back to the Certify360 house palette rather than showing a
 * colour the brand has not agreed to.
 */
export const labelPalette = z.object({
  primary: hexColor,
  accent: hexColor,
  ink: hexColor,
});
export type LabelPaletteColors = z.infer<typeof labelPalette>;

export const labelSummary = z.object({
  id: uuid,
  slug,
  name: z.string(),
  /** `demo` for seeded development labels — the UI must show this as "Demo". */
  origin: dataOrigin,
  /** Your own role in this label. Absent means: no access, so not listed. */
  role: labelRole,
  isActive: z.boolean(),
  createdAt: isoTimestamp,
  /**
   * Interface colours for this label, or `null` when it has no approved brand
   * profile. The platform colours follow the selected label, so the switcher
   * can show what picking a label will do to the screen.
   */
  palette: labelPalette.nullable(),
});
export type LabelSummary = z.infer<typeof labelSummary>;

/**
 * Readiness of a label's foundational data. Drives the Werkruimte cards and the
 * gate checks; every value is derived server-side from actual rows, so the UI
 * cannot show a step as done when it is not.
 */
export const labelReadiness = z.object({
  labelId: uuid,
  hasApprovedBrandProfile: z.boolean(),
  confirmedCourseCount: z.number().int().min(0),
  unconfirmedCourseCount: z.number().int().min(0),
  approvedPersonaCount: z.number().int().min(0),
  activeCampaignCount: z.number().int().min(0),
  assetsAwaitingReviewCount: z.number().int().min(0),
  assetsNeedingRereviewCount: z.number().int().min(0),
});
export type LabelReadiness = z.infer<typeof labelReadiness>;

export const labelBudget = z.object({
  labelId: uuid,
  periodStart: isoTimestamp,
  periodEnd: isoTimestamp,
  budgetCents: cents,
  /** Committed to completed work. */
  spentCents: cents,
  /** Held for queued or running jobs. Released when they finish or fail. */
  reservedCents: cents,
  /** budgetCents - spentCents - reservedCents, floored at 0. */
  availableCents: cents,
});
export type LabelBudget = z.infer<typeof labelBudget>;
