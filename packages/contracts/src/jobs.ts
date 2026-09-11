import { z } from 'zod';
import { cents, isoTimestamp, uuid } from './primitives.js';

/**
 * Background work contract.
 *
 * Long-running AI, research, file-processing and export work runs on the
 * worker. The queue lives in our own PostgreSQL schema so that a job, its
 * idempotency key, its budget reservation and its partial results all commit
 * in a single transaction — see docs/decisions/ADR-0006-job-queue.md.
 */

export const jobType = z.enum([
  /** Phase 0 smoke job, proves claim/heartbeat/retry/cancel end to end. */
  'demo.echo',
  'brand.extract_from_documents',
  'course.extract_from_documents',
  'course.extract_from_documents',
  'course.extract_from_url',
  'research.run',
  'radar.scan',
  'geo.research',
  'campaign.package',
  'persona.propose',
  'opportunity.propose',
  'brief.draft',
  'concept.propose',
  'content.plan',
  'content.generate',
  'content.revise',
  'image.render_variants',
  'export.build_package',
  'outcome.import_report',
]);
export type JobType = z.infer<typeof jobType>;

export const jobStatus = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  /** Terminal: retries exhausted or a non-retryable failure. Resumable by the
   *  user via an explicit retry, which creates a new attempt on the same job. */
  'dead',
  'cancelling',
  'cancelled',
]);
export type JobStatus = z.infer<typeof jobStatus>;

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = Object.freeze([
  'succeeded',
  'failed',
  'dead',
  'cancelled',
]);

/** Retryable failures get a new attempt; non-retryable ones go straight to dead. */
export const jobFailureKind = z.enum([
  'provider_unavailable',
  'provider_invalid_output',
  'timeout',
  'budget_exceeded',
  'validation_failed',
  'internal_error',
]);
export type JobFailureKind = z.infer<typeof jobFailureKind>;

/**
 * Job types a deployed worker actually has a handler for.
 *
 * `jobType` above is the *vocabulary* — every type this product will ever
 * enqueue, including ones only designed so far. This list is the *capability*:
 * what the current build can really run.
 *
 * The distinction has teeth. Enqueuing a type no worker implements creates a
 * job that nothing will ever claim, so the user watches a progress bar for work
 * that cannot start. Refusing at enqueue turns that into an immediate
 * `capability_unavailable`, which is the same honesty rule the AI adapters
 * follow: state that a capability is missing rather than appearing to accept it.
 *
 * Kept here rather than in the worker because the *API* must answer the
 * request, and the API does not (and must not) import worker code. A drift test
 * compares this list against the worker's registry, so it cannot quietly become
 * a lie — add the type here in the same change that adds the handler.
 */
export const IMPLEMENTED_JOB_TYPES: readonly JobType[] = Object.freeze([
  'demo.echo',
  'course.extract_from_documents',
  'course.extract_from_url',
  'research.run',
  'radar.scan',
  'geo.research',
  'campaign.package',
  'persona.propose',
  'opportunity.propose',
  'brief.draft',
  'concept.propose',
  'content.plan',
  'content.generate',
  'content.revise',
]);

export function isImplementedJobType(type: JobType): boolean {
  return IMPLEMENTED_JOB_TYPES.includes(type);
}

export const RETRYABLE_FAILURE_KINDS: readonly JobFailureKind[] = Object.freeze([
  'provider_unavailable',
  'timeout',
  'provider_invalid_output',
]);

export const jobProgress = z.object({
  /** 0–100, monotonic within an attempt. */
  percent: z.number().int().min(0).max(100),
  /** Dutch, user-facing. No internal detail, no provider names. */
  message: z.string().max(200),
  /**
   * Partial results committed so far. A cancelled or failed job keeps whatever
   * it had already written, so work is never silently thrown away.
   */
  completedUnits: z.number().int().min(0).default(0),
  totalUnits: z.number().int().min(0).nullable().default(null),
});
export type JobProgress = z.infer<typeof jobProgress>;

export const jobSummary = z.object({
  id: uuid,
  labelId: uuid.nullable(),
  type: jobType,
  status: jobStatus,
  attempt: z.number().int().min(0),
  maxAttempts: z.number().int().min(1),
  progress: jobProgress.nullable(),
  /**
   * Structured result of a successful run.
   *
   * Shape depends on the job type; the caller that queued the job knows what
   * to expect and narrows it. Present so a client following a job can read
   * what it produced (a proposal-set id, a shortfall reason) without a second
   * round trip.
   */
  result: z.record(z.string(), z.unknown()).nullable(),
  /** Present only on failure. Dutch, safe to render. */
  failureMessage: z.string().nullable(),
  failureKind: jobFailureKind.nullable(),
  /** Estimated cost reserved up front; actual cost is recorded separately. */
  reservedCostCents: cents,
  actualCostCents: cents.nullable(),
  createdAt: isoTimestamp,
  startedAt: isoTimestamp.nullable(),
  finishedAt: isoTimestamp.nullable(),
  /** True when the user may press "opnieuw proberen". */
  retryable: z.boolean(),
});
export type JobSummary = z.infer<typeof jobSummary>;

export const enqueueDemoJobRequest = z.object({
  labelId: uuid,
  /** Echoed back by the demo job; bounded so it cannot be used as a payload sink. */
  message: z.string().min(1).max(200),
  /** Number of simulated units of work, to exercise partial progress. */
  steps: z.number().int().min(1).max(20).default(3),
  /** Forces a failure on the first attempts, to exercise retry behaviour. */
  failFirstAttempts: z.number().int().min(0).max(5).default(0),
});
export type EnqueueDemoJobRequest = z.infer<typeof enqueueDemoJobRequest>;
