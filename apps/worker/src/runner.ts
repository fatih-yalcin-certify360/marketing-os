import { z } from 'zod';
import {
  jobType,
  type ErrorCode,
  type JobFailureKind,
  type JobProgress,
  type JobType,
} from '@c360/contracts';
import type { Db } from '@c360/api/db';
import type { BudgetService} from '@c360/api/jobs';
import { JobQueue, UsageRecorder, type JobRow } from '@c360/api/jobs';
import type { AuditService } from '@c360/api/audit';
import { isAppError } from '@c360/api/errors';
import {
  JobCancelled,
  JobFailure,
  type HandlerRegistry,
  type JobContext,
} from './handlers/index.js';

/**
 * The worker's execution loop.
 *
 * Invariants this code exists to hold:
 *
 *  - **No double work.** Claiming is atomic (`SKIP LOCKED`) and every
 *    write-back is guarded by `claimed_by`, so a worker declared dead by the
 *    reaper cannot overwrite the run that replaced it.
 *  - **No lost work.** Progress is committed as it happens, so a cancellation
 *    or a crash leaves the completed portion in the database.
 *  - **No phantom success.** A provider failure becomes a recorded failure with
 *    a Dutch message; it is never converted into a successful result
 *    (requirement 11: "Provider arızası sahte başarıya dönüşmesin").
 *  - **Budget settles exactly once.** Reservations are released on every
 *    terminal path, and requeues keep the hold because the job will run again.
 */

export interface RunnerDeps {
  db: Db;
  handlers: HandlerRegistry;
  audit: AuditService;
  budget: BudgetService;
  queue?: JobQueue;
  workerId: string;
  heartbeatIntervalMs?: number;
  /** Hard ceiling on concurrent jobs for one label; fairness backstop. */
  maxJobsPerLabel?: number;
  log?: RunnerLogger;
}

export interface RunnerLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

const noopLogger: RunnerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export type ProcessOutcome =
  | 'idle'
  | 'succeeded'
  | 'requeued'
  | 'failed'
  | 'dead'
  | 'cancelled'
  | 'lost';

/**
 * How a domain refusal inside a job becomes a job failure.
 *
 * Explicit rather than derived from the HTTP status, because the two questions
 * are different: a status says how to answer a request, a failure kind says
 * whether spending another attempt could change the outcome. `capability_
 * unavailable` is a 501 but will never succeed on retry, and `rate_limited` is
 * a 4xx that will.
 *
 * Only `provider_unavailable`, `provider_invalid_output` and `timeout` are
 * retryable (see `RETRYABLE_FAILURE_KINDS`), so everything that cannot be
 * helped by waiting maps to a terminal kind and the user keeps a manual retry.
 */
const APP_ERROR_FAILURE_KIND: Readonly<Record<ErrorCode, JobFailureKind>> = Object.freeze({
  // Nothing about waiting makes these true.
  bad_request: 'validation_failed',
  validation_failed: 'validation_failed',
  not_found: 'validation_failed',
  forbidden: 'validation_failed',
  unauthenticated: 'validation_failed',
  conflict: 'validation_failed',
  stale_version: 'validation_failed',
  dependency_changed: 'validation_failed',
  gate_not_passed: 'validation_failed',
  payload_too_large: 'validation_failed',
  unsupported_media_type: 'validation_failed',
  capability_unavailable: 'validation_failed',
  // Needs a person to raise the ceiling, so retrying on our own is pointless.
  budget_exceeded: 'budget_exceeded',
  // Genuinely transient: back off and try again.
  rate_limited: 'provider_unavailable',
  provider_unavailable: 'provider_unavailable',
  provider_invalid_output: 'provider_invalid_output',
  internal_error: 'internal_error',
});

export class JobRunner {
  private readonly usage = new UsageRecorder();
  private readonly queue: JobQueue;
  private readonly log: RunnerLogger;
  private readonly heartbeatIntervalMs: number;
  /** Job ids this worker holds a lease on right now. */
  private readonly inFlight = new Set<string>();

  constructor(private readonly deps: RunnerDeps) {
    this.queue = deps.queue ?? new JobQueue();
    this.log = deps.log ?? noopLogger;
    this.heartbeatIntervalMs = deps.heartbeatIntervalMs ?? 10_000;
  }

  /**
   * Claims and runs at most one job.
   *
   * @returns `'idle'` when the queue had nothing runnable.
   */
  async processOne(now = new Date()): Promise<ProcessOutcome> {
    const job = await this.queue.claim(
      this.deps.db,
      this.deps.workerId,
      now,
      this.deps.maxJobsPerLabel ?? 4,
      // Only what this build can run. A stale replica then leaves a new job
      // type alone instead of marking it dead — see `JobQueue.claim`.
      [...this.deps.handlers.keys()],
    );
    if (job === undefined) {
      return 'idle';
    }

    this.inFlight.add(job.id);
    try {
      return await this.run(job);
    } finally {
      this.inFlight.delete(job.id);
    }
  }

  /** Jobs this worker currently holds a lease on. */
  inFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Returns every job still held back to the queue.
   *
   * Called when a shutdown grace period expires: the process is about to be
   * killed, so leaving the rows `running` would strand them until the reaper.
   * Attempts are not consumed — see `JobQueue.release`.
   */
  async releaseInFlight(): Promise<number> {
    let released = 0;
    for (const jobId of [...this.inFlight]) {
      try {
        if (await this.queue.release(this.deps.db, jobId, this.deps.workerId)) {
          released += 1;
          this.log.warn({ jobId }, 'job released back to the queue for shutdown');
        }
      } catch (error: unknown) {
        // Best effort: the reaper is the backstop if this cannot be written.
        this.log.error({ jobId, err: error }, 'releasing job failed');
      }
    }
    return released;
  }

  private async run(job: JobRow): Promise<ProcessOutcome> {
    this.log.info({ jobId: job.id, type: job.type, attempt: job.attempt }, 'job claimed');

    const parsedType = jobType.safeParse(job.type);
    const handler = parsedType.success ? this.deps.handlers.get(parsedType.data) : undefined;

    if (handler === undefined) {
      // Unknown type: terminal and non-retryable. Leaving it queued would make
      // it invisible work that never completes.
      return this.settleFailure(job, {
        kind: 'validation_failed',
        publicMessage:
          'Dit type taak wordt door deze versie van de applicatie niet ondersteund. Neem contact op met beheer.',
      });
    }

    // Keeps the lease alive while a long step runs, so the reaper does not
    // consider a healthy worker abandoned.
    const heartbeat = this.startHeartbeat(job.id);

    try {
      // Payload validation happens inside `execute`, so a schema mismatch is
      // caught below and classified as a job failure rather than a crash.
      const outcome = await handler.execute(job.payload, this.createContext(job));
      return await this.settleSuccess(job, outcome.result, outcome.actualCostCents);
    } catch (error: unknown) {
      if (error instanceof JobCancelled) {
        return await this.settleCancelled(job);
      }
      if (error instanceof JobFailure) {
        this.log.warn(
          { jobId: job.id, kind: error.kind, detail: error.message },
          'job failed (classified)',
        );
        return await this.settleFailure(job, {
          kind: error.kind,
          publicMessage: error.publicMessage,
        });
      }
      if (error instanceof z.ZodError) {
        return await this.settleFailure(job, {
          kind: 'validation_failed',
          publicMessage:
            'De gegevens van deze taak zijn niet meer geldig. Start de stap opnieuw vanuit de campagne.',
        });
      }
      if (isAppError(error)) {
        // A domain refusal, not a crash. The services throw `AppError` for
        // every ordinary "no", and each one already carries a specific Dutch
        // message and a code that says whether retrying could ever help.
        // Falling through to the generic handler below would replace
        // "deze opleiding bestaat niet meer" with "er is een onverwachte fout
        // opgetreden", log a stack trace for a non-event, and — for a genuinely
        // transient refusal — refuse to retry.
        const kind = APP_ERROR_FAILURE_KIND[error.code];
        this.log.warn(
          { jobId: job.id, code: error.code, kind, detail: error.internalDetail ?? '' },
          'job failed (refused by a business rule)',
        );
        return await this.settleFailure(job, {
          kind,
          publicMessage: error.publicMessage,
        });
      }
      // Unexpected: log the real cause, tell the user nothing internal.
      this.log.error({ jobId: job.id, err: error }, 'job failed (unexpected)');
      return await this.settleFailure(job, {
        kind: 'internal_error',
        publicMessage: 'Er is een onverwachte fout opgetreden. Je kunt het opnieuw proberen.',
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  private startHeartbeat(jobId: string): NodeJS.Timeout {
    const timer = setInterval(() => {
      void this.queue
        .heartbeat(this.deps.db, jobId, this.deps.workerId)
        .catch((error: unknown) => {
          this.log.warn({ jobId, err: error }, 'heartbeat failed');
        });
    }, this.heartbeatIntervalMs);
    // Do not hold the event loop open on shutdown.
    timer.unref?.();
    return timer;
  }

  private createContext(job: JobRow): JobContext {
    return {
      db: this.deps.db,
      jobId: job.id,
      organizationId: job.organizationId,
      labelId: job.labelId,
      attempt: job.attempt,
      reportProgress: async (progress: JobProgress) =>
        this.queue.reportProgress(this.deps.db, job.id, this.deps.workerId, progress),
      // Read back from the usage rows rather than tracked in memory, so a
      // handler cannot forget to add a call and the figure survives a retry.
      spentCents: async () =>
        this.usage.budgetCostForAttempt(this.deps.db, job.id, job.attempt),
      isCancellationRequested: async () => {
        const state = await this.queue.heartbeat(this.deps.db, job.id, this.deps.workerId);
        // Losing the lease is also a reason to stop.
        return !state.alive || state.cancelRequested;
      },
      log: (message, fields) => {
        this.log.info({ jobId: job.id, ...fields }, message);
      },
    };
  }

  private async settleSuccess(
    job: JobRow,
    result: Record<string, unknown>,
    actualCostCents: number,
  ): Promise<ProcessOutcome> {
    return this.deps.db.transaction(async (tx) => {
      const written = await this.queue.complete(tx, job.id, this.deps.workerId, {
        result,
        actualCostCents,
      });
      if (!written) {
        // Another worker owns it now; write nothing, charge nothing.
        this.log.warn({ jobId: job.id }, 'completion skipped: job no longer owned');
        return 'lost';
      }
      if (job.labelId !== null) {
        await this.deps.budget.settle(tx, job.labelId, job.reservedCostCents, actualCostCents);
      }
      await this.deps.audit.record(tx, {
        organizationId: job.organizationId,
        labelId: job.labelId,
        actorKind: 'worker',
        action: 'job.succeeded',
        resourceType: 'job',
        resourceId: job.id,
        outcome: 'allowed',
        metadata: { jobType: job.type, attempt: job.attempt, costCents: actualCostCents },
      });
      return 'succeeded';
    });
  }

  private async settleCancelled(job: JobRow): Promise<ProcessOutcome> {
    return this.deps.db.transaction(async (tx) => {
      const written = await this.queue.markCancelled(tx, job.id, this.deps.workerId);
      if (!written) {
        return 'lost';
      }
      if (job.labelId !== null) {
        // Nothing was charged, so the whole hold is released.
        await this.deps.budget.settle(tx, job.labelId, job.reservedCostCents, 0);
      }
      await this.deps.audit.record(tx, {
        organizationId: job.organizationId,
        labelId: job.labelId,
        actorKind: 'worker',
        action: 'job.cancelled',
        resourceType: 'job',
        resourceId: job.id,
        outcome: 'allowed',
        metadata: { jobType: job.type, attempt: job.attempt },
      });
      return 'cancelled';
    });
  }

  private async settleFailure(
    job: JobRow,
    failure: { kind: Parameters<JobQueue['fail']>[3]['kind']; publicMessage: string },
  ): Promise<ProcessOutcome> {
    return this.deps.db.transaction(async (tx) => {
      const settled = await this.queue.fail(tx, job.id, this.deps.workerId, failure);
      if (settled === undefined) {
        return 'lost';
      }

      // A requeued job will run again, so its reservation stays held.
      if (settled.outcome !== 'requeued' && job.labelId !== null) {
        await this.deps.budget.settle(tx, job.labelId, job.reservedCostCents, 0);
      }

      await this.deps.audit.record(tx, {
        organizationId: job.organizationId,
        labelId: job.labelId,
        actorKind: 'worker',
        action: `job.${settled.outcome}`,
        resourceType: 'job',
        resourceId: job.id,
        outcome: 'error',
        reason: failure.kind,
        metadata: { jobType: job.type, attempt: job.attempt },
      });

      return settled.outcome === 'requeued'
        ? 'requeued'
        : settled.outcome === 'dead'
          ? 'dead'
          : 'failed';
    });
  }

  /** Requeues jobs whose worker died mid-run. Called on a timer by the loop. */
  async reap(heartbeatTimeoutMs: number, now = new Date()): Promise<void> {
    const result = await this.queue.reapAbandoned(this.deps.db, heartbeatTimeoutMs, now);
    if (result.requeued > 0 || result.failed > 0) {
      this.log.warn(result, 'reaped abandoned jobs');
    }
  }
}

export type { JobType };
