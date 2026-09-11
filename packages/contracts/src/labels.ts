import { z } from 'zod';
import { cents, dataOrigin, isoTimestamp, slug, uuid } from './primitives.js';
import { labelRole } from './access.js';

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
