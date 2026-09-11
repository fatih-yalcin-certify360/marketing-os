import { z } from 'zod';
import { isoTimestamp, uuid } from './primitives.js';
import { labelReadiness } from './labels.js';
import { reviewState, workflowStage } from './workflow.js';

/**
 * Werkruimte read model.
 *
 * Every number here is counted from real rows. Areas that are not implemented
 * yet are reported through `moduleAvailability` as unavailable, so the UI can
 * disable them honestly instead of rendering an empty widget that looks broken.
 */

export const attentionKind = z.enum([
  'ready_for_review',
  'needs_source_check',
  'needs_rereview',
  'job_failed',
  'budget_low',
]);
export type AttentionKind = z.infer<typeof attentionKind>;

export const attentionItem = z.object({
  kind: attentionKind,
  /** Dutch title, already resolved server-side. */
  title: z.string(),
  subtitle: z.string(),
  /** Badge text, e.g. "Review nodig". */
  badge: z.string(),
  badgeTone: z.enum(['purple', 'amber', 'green', 'neutral']),
  campaignId: uuid.nullable(),
  stage: workflowStage.nullable(),
  state: reviewState.nullable(),
  updatedAt: isoTimestamp,
});
export type AttentionItem = z.infer<typeof attentionItem>;

export const workspaceCounters = z.object({
  readyForReview: z.number().int().min(0),
  actionRequired: z.number().int().min(0),
  plannedThisWeek: z.number().int().min(0),
});
export type WorkspaceCounters = z.infer<typeof workspaceCounters>;

/** Which product areas actually work today. Phase 0 ships very few as `available`. */
export const productArea = z.enum([
  'werkruimte',
  'kansen',
  'campagnes',
  'content',
  'kalender',
  'resultaten',
  'kennis_beheer',
]);
export type ProductArea = z.infer<typeof productArea>;

export const availability = z.enum(['available', 'in_development', 'planned']);
export type Availability = z.infer<typeof availability>;

export const moduleAvailability = z.object({
  area: productArea,
  status: availability,
  /** Dutch explanation shown when a user opens an unavailable area. */
  note: z.string(),
  /** Which delivery phase makes this area available. */
  plannedPhase: z.number().int().min(0).max(5),
});
export type ModuleAvailability = z.infer<typeof moduleAvailability>;

export const workspaceOverview = z.object({
  labelId: uuid,
  labelName: z.string(),
  greetingName: z.string(),
  counters: workspaceCounters,
  attention: z.array(attentionItem),
  readiness: labelReadiness,
  moduleAvailability: z.array(moduleAvailability),
  /** True while any seeded demo data is present in this label. */
  containsDemoData: z.boolean(),
  generatedAt: isoTimestamp,
});
export type WorkspaceOverview = z.infer<typeof workspaceOverview>;
