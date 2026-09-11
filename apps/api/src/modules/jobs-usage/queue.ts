import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  RETRYABLE_FAILURE_KINDS,
  type JobFailureKind,
  type JobProgress,
  type JobStatus,
  type JobType,
} from '@c360/contracts';
import type { Db, DbOrTx } from '../../core/db/types.js';
import { jobs } from '../../core/db/schema.js';

/**
 * PostgreSQL-backed job queue (ADR-0006).
 *
 * Design points that the requirements demand explicitly:
 *
 *  - **Idempotency.** `(organization_id, type, idempotency_key)` is unique and
 *    enqueue uses ON CONFLICT DO NOTHING, so a double-submitted or retried
 *    enqueue returns the *existing* job. This is what prevents duplicate
 *    assets and duplicate charges on retry (requirement 15).
 *  - **Claiming.** `FOR UPDATE SKIP LOCKED` lets N workers share the queue with
 *    no broker and no chance of two workers running the same job.
 *  - **Ownership on write-back.** Every completion/failure/progress statement
 *    is guarded by `claimed_by = :workerId`. A worker that was declared dead
 *    by the reaper and then wakes up cannot overwrite the run that replaced
 *    it — the guard turns a would-be double-write into a no-op.
 *  - **Partial progress survives.** Progress is committed as it happens, so a
 *    cancelled or failed job keeps the work it had already done.
 */

export interface JobRow {
  id: string;
  organizationId: string;
  labelId: string | null;
  type: string;
  status: string;
  payload: unknown;
  result: unknown;
  progress: unknown;
  attempt: number;
  maxAttempts: number;
  cancelRequested: boolean;
  failureKind: string | null;
  failureMessage: string | null;
  reservedCostCents: number;
  actualCostCents: number | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

const jobColumns = {
  id: jobs.id,
  organizationId: jobs.organizationId,
  labelId: jobs.labelId,
  type: jobs.type,
  status: jobs.status,
  payload: jobs.payload,
  result: jobs.result,
  progress: jobs.progress,
  attempt: jobs.attempt,
  maxAttempts: jobs.maxAttempts,
  cancelRequested: jobs.cancelRequested,
  failureKind: jobs.failureKind,
  failureMessage: jobs.failureMessage,
  reservedCostCents: jobs.reservedCostCents,
  actualCostCents: jobs.actualCostCents,
  createdAt: jobs.createdAt,
  startedAt: jobs.startedAt,
  finishedAt: jobs.finishedAt,
} as const;

export interface EnqueueInput {
  organizationId: string;
  labelId: string | null;
  type: JobType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  maxAttempts?: number;
  priority?: number;
  reservedCostCents?: number;
  createdByUserId?: string | null;
}

export interface EnqueueResult {
  job: JobRow;
  /** False when an existing job with the same idempotency key was returned. */
  created: boolean;
}

/** Exponential backoff with a ceiling, so a flapping provider is not hammered. */
export function backoffMs(attempt: number): number {
  const base = 2_000;
  const capped = Math.min(base * 2 ** Math.max(0, attempt - 1), 60_000);
  return capped;
}

export class JobQueue {
  async enqueue(db: DbOrTx, input: EnqueueInput): Promise<EnqueueResult> {
    const inserted = await db
      .insert(jobs)
      .values({
        organizationId: input.organizationId,
        labelId: input.labelId,
        type: input.type,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        maxAttempts: input.maxAttempts ?? 3,
        priority: input.priority ?? 100,
        reservedCostCents: input.reservedCostCents ?? 0,
        createdByUserId: input.createdByUserId ?? null,
      })
      .onConflictDoNothing({
        target: [jobs.organizationId, jobs.type, jobs.idempotencyKey],
      })
      .returning(jobColumns);

    const created = inserted[0];
    if (created !== undefined) {
      return { job: created, created: true };
    }

    // Same idempotency key already present: return it unchanged.
    const existing = await db
      .select(jobColumns)
      .from(jobs)
      .where(
        and(
          eq(jobs.organizationId, input.organizationId),
          eq(jobs.type, input.type),
          eq(jobs.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    const row = existing[0];
    if (row === undefined) {
      throw new Error('Job enqueue conflicted but no existing row was found');
    }
    return { job: row, created: false };
  }

  /**
   * Atomically claims the next runnable job for `workerId`, fairly across labels.
   *
   * `FOR UPDATE SKIP LOCKED` picks exactly one row and locks it, so other
   * workers step past it rather than blocking — that is what lets N workers
   * share one queue with no broker.
   *
   * **Fairness is the part that matters at scale.** Ordering purely by arrival
   * time means a label that enqueues fifty jobs occupies every worker while
   * every other label waits behind it. So candidates are ordered by *how many
   * jobs that label already has running*, then by priority and arrival: a label
   * with nothing running is always preferred over one that is already busy.
   * That keeps one tenant's burst from becoming everyone's outage.
   *
   * `maxPerLabel` is the hard backstop on top of that — a single label can
   * never hold more than this many jobs at once, however deep its queue.
   *
   * ## Only types this worker can actually run
   *
   * `supportedTypes` is not an optimisation; it prevents a specific and
   * destructive failure. A worker that claims a type it has no handler for
   * fails the job as non-retryable and marks it **dead** — the job is gone, and
   * no other worker gets a chance at it.
   *
   * That is exactly what happens during a rolling deploy: the old replica is
   * still polling, a request creates a job of a type only the new code knows,
   * and the old replica destroys it. It was found the hard way — a worker left
   * running from an earlier session claimed a `brief.draft` job and killed it
   * while the current worker sat idle.
   *
   * Filtering here means an unrecognised type is simply left in the queue for a
   * replica that understands it. The runner's unknown-handler path stays as the
   * backstop for a type no deployed worker knows at all.
   */
  async claim(
    db: Db,
    workerId: string,
    now = new Date(),
    maxPerLabel = 4,
    supportedTypes?: readonly string[],
  ): Promise<JobRow | undefined> {
    if (supportedTypes?.length === 0) {
      // A worker with no handlers must not claim anything at all.
      return undefined;
    }
    const typeFilter =
      supportedTypes === undefined
        ? sql``
        : sql` AND candidate.type IN (${sql.join(
            supportedTypes.map((type) => sql`${type}`),
            sql`, `,
          )})`;

    const claimed = await db
      .update(jobs)
      .set({
        status: 'running',
        attempt: sql`${jobs.attempt} + 1`,
        claimedAt: now,
        claimedBy: workerId,
        heartbeatAt: now,
        startedAt: sql`COALESCE(${jobs.startedAt}, ${now})`,
        updatedAt: now,
      })
      .where(
        sql`${jobs.id} = (
          WITH running AS (
            SELECT label_id, count(*)::int AS active
            FROM ${jobs}
            WHERE status IN ('running', 'cancelling')
            GROUP BY label_id
          )
          SELECT candidate.id
          FROM ${jobs} AS candidate
          LEFT JOIN running ON running.label_id = candidate.label_id
          WHERE candidate.status = 'queued'
            AND candidate.run_at <= ${now}
            AND candidate.cancel_requested = false
            AND candidate.attempt < candidate.max_attempts
            AND COALESCE(running.active, 0) < ${maxPerLabel}${typeFilter}
          ORDER BY
            COALESCE(running.active, 0) ASC,
            candidate.priority ASC,
            candidate.run_at ASC,
            candidate.id ASC
          FOR UPDATE OF candidate SKIP LOCKED
          LIMIT 1
        )`,
      )
      .returning(jobColumns);

    // Drizzle types `.returning()` rows exactly, and an empty array yields
    // undefined under `noUncheckedIndexedAccess` — which is the "nothing to
    // claim" signal.
    return claimed[0];
  }

  /**
   * Queue depth, for readiness reporting and capacity checks.
   *
   * `queued` and `running` are counted separately because they mean different
   * things: a deep queue with workers busy is a healthy backlog, while a deep
   * queue with nothing running means the workers are gone.
   */
  async depth(db: Db): Promise<{ queued: number; running: number; oldestQueuedAgeMs: number }> {
    const rows = await db
      .select({ status: jobs.status, runAt: jobs.runAt })
      .from(jobs)
      .where(inArray(jobs.status, ['queued', 'running', 'cancelling']))
      // Bounded: the exact number past a few thousand does not change any
      // decision, and an unbounded count would scan the whole table.
      .limit(5_000);

    let queued = 0;
    let running = 0;
    let oldestQueuedAt = Date.now();
    for (const row of rows) {
      if (row.status === 'queued') {
        queued += 1;
        oldestQueuedAt = Math.min(oldestQueuedAt, row.runAt.getTime());
      } else {
        running += 1;
      }
    }

    return {
      queued,
      running,
      oldestQueuedAgeMs: queued === 0 ? 0 : Math.max(0, Date.now() - oldestQueuedAt),
    };
  }

  /**
   * Refreshes the lease and reports whether cancellation was requested, so the
   * worker learns about a cancel without a second query.
   */
  async heartbeat(
    db: DbOrTx,
    jobId: string,
    workerId: string,
    now = new Date(),
  ): Promise<{ alive: boolean; cancelRequested: boolean }> {
    const rows = await db
      .update(jobs)
      .set({ heartbeatAt: now })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.claimedBy, workerId),
          inArray(jobs.status, ['running', 'cancelling']),
        ),
      )
      .returning({ cancelRequested: jobs.cancelRequested });

    const row = rows[0];
    return row === undefined
      ? { alive: false, cancelRequested: false }
      : { alive: true, cancelRequested: row.cancelRequested };
  }

  /** Commits partial progress. Guarded by worker ownership like every write-back. */
  async reportProgress(
    db: DbOrTx,
    jobId: string,
    workerId: string,
    progress: JobProgress,
    now = new Date(),
  ): Promise<boolean> {
    const rows = await db
      .update(jobs)
      .set({ progress, heartbeatAt: now, updatedAt: now })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.claimedBy, workerId),
          inArray(jobs.status, ['running', 'cancelling']),
        ),
      )
      .returning({ id: jobs.id });
    return rows.length > 0;
  }

  async complete(
    db: DbOrTx,
    jobId: string,
    workerId: string,
    outcome: { result: unknown; actualCostCents: number },
    now = new Date(),
  ): Promise<boolean> {
    const rows = await db
      .update(jobs)
      .set({
        status: 'succeeded',
        result: outcome.result,
        actualCostCents: outcome.actualCostCents,
        finishedAt: now,
        updatedAt: now,
        failureKind: null,
        failureMessage: null,
      })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.claimedBy, workerId),
          inArray(jobs.status, ['running', 'cancelling']),
        ),
      )
      .returning({ id: jobs.id });
    return rows.length > 0;
  }

  /**
   * Records a failure and decides between requeue and a terminal state.
   *
   * A retryable failure with attempts left goes back to `queued` with backoff
   * and keeps its budget reservation, because it will run again. A terminal
   * failure keeps `failed` (user may retry) or `dead` (not retryable), and the
   * caller releases the reservation.
   */
  async fail(
    db: DbOrTx,
    jobId: string,
    workerId: string,
    failure: { kind: JobFailureKind; publicMessage: string },
    now = new Date(),
  ): Promise<{ outcome: 'requeued' | 'failed' | 'dead'; job: JobRow } | undefined> {
    const current = await db
      .select({ attempt: jobs.attempt, maxAttempts: jobs.maxAttempts })
      .from(jobs)
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.claimedBy, workerId),
          inArray(jobs.status, ['running', 'cancelling']),
        ),
      )
      .limit(1);

    const state = current[0];
    if (state === undefined) {
      return undefined;
    }

    const retryable = RETRYABLE_FAILURE_KINDS.includes(failure.kind);
    const attemptsLeft = state.attempt < state.maxAttempts;
    const outcome: 'requeued' | 'failed' | 'dead' = retryable
      ? attemptsLeft
        ? 'requeued'
        : 'failed'
      : 'dead';

    const nextStatus: JobStatus =
      outcome === 'requeued' ? 'queued' : outcome === 'failed' ? 'failed' : 'dead';

    const rows = await db
      .update(jobs)
      .set({
        status: nextStatus,
        failureKind: failure.kind,
        failureMessage: failure.publicMessage,
        claimedBy: outcome === 'requeued' ? null : workerId,
        claimedAt: outcome === 'requeued' ? null : sql`${jobs.claimedAt}`,
        runAt:
          outcome === 'requeued'
            ? new Date(now.getTime() + backoffMs(state.attempt))
            : sql`${jobs.runAt}`,
        finishedAt: outcome === 'requeued' ? null : now,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.claimedBy, workerId)))
      .returning(jobColumns);

    const row = rows[0];
    return row === undefined ? undefined : { outcome, job: row };
  }

  /** Terminal cancellation, written by the worker once it has stopped cleanly. */
  async markCancelled(
    db: DbOrTx,
    jobId: string,
    workerId: string,
    now = new Date(),
  ): Promise<boolean> {
    const rows = await db
      .update(jobs)
      .set({
        status: 'cancelled',
        finishedAt: now,
        updatedAt: now,
        failureMessage: 'Door de gebruiker gestopt. Al afgerond werk is bewaard.',
      })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.claimedBy, workerId),
          inArray(jobs.status, ['running', 'cancelling']),
        ),
      )
      .returning({ id: jobs.id });
    return rows.length > 0;
  }

  /**
   * Requeues jobs whose worker stopped heartbeating.
   *
   * Without this a crashed worker would leave jobs stuck in `running` forever.
   * `claimed_by` is cleared so the previous worker's guarded write-backs become
   * no-ops if it ever returns.
   */
  async reapAbandoned(
    db: Db,
    heartbeatTimeoutMs: number,
    now = new Date(),
  ): Promise<{ requeued: number; failed: number }> {
    const cutoff = new Date(now.getTime() - heartbeatTimeoutMs);

    const requeued = await db
      .update(jobs)
      .set({
        status: 'queued',
        claimedBy: null,
        claimedAt: null,
        heartbeatAt: null,
        runAt: now,
        failureKind: 'timeout',
        failureMessage: 'De verwerking is onderbroken en wordt opnieuw geprobeerd.',
        updatedAt: now,
      })
      .where(
        and(
          inArray(jobs.status, ['running', 'cancelling']),
          lt(jobs.heartbeatAt, cutoff),
          sql`${jobs.attempt} < ${jobs.maxAttempts}`,
        ),
      )
      .returning({ id: jobs.id });

    const failed = await db
      .update(jobs)
      .set({
        status: 'failed',
        claimedBy: null,
        heartbeatAt: null,
        finishedAt: now,
        failureKind: 'timeout',
        failureMessage:
          'De verwerking is onderbroken en het maximale aantal pogingen is bereikt. Je kunt het opnieuw proberen.',
        updatedAt: now,
      })
      .where(
        and(
          inArray(jobs.status, ['running', 'cancelling']),
          lt(jobs.heartbeatAt, cutoff),
          sql`${jobs.attempt} >= ${jobs.maxAttempts}`,
        ),
      )
      .returning({ id: jobs.id });

    return { requeued: requeued.length, failed: failed.length };
  }

  /**
   * Hands a claimed job back to the queue without consuming an attempt.
   *
   * For a planned shutdown only. The distinction from `reapAbandoned` matters:
   * a released job was interrupted by *us* rolling out a new version, not by
   * failing, so charging it an attempt would let three deploys exhaust a job's
   * retries and fail work that was never actually broken.
   *
   * Without this, a job still running when the container is stopped stays
   * `running` until the heartbeat reaper notices — up to
   * `WORKER_HEARTBEAT_TIMEOUT_MS` later. Releasing makes another replica pick
   * it up on its next poll instead, which is the difference between a deploy
   * costing a user seconds and costing them three minutes.
   *
   * Ownership-guarded like every other write-back: a worker that already lost
   * its lease releases nothing.
   */
  async release(
    db: DbOrTx,
    jobId: string,
    workerId: string,
    now = new Date(),
  ): Promise<boolean> {
    const released = await db
      .update(jobs)
      .set({
        status: 'queued',
        claimedBy: null,
        claimedAt: null,
        heartbeatAt: null,
        runAt: now,
        // Not a failure: no `failureKind`, and the attempt counter is untouched.
        failureMessage: 'De verwerking is opnieuw in de wachtrij geplaatst door onderhoud.',
        updatedAt: now,
      })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.claimedBy, workerId),
          inArray(jobs.status, ['running', 'cancelling']),
        ),
      )
      .returning({ id: jobs.id });

    return released.length > 0;
  }

  async findById(db: DbOrTx, jobId: string): Promise<JobRow | undefined> {
    const rows = await db.select(jobColumns).from(jobs).where(eq(jobs.id, jobId)).limit(1);
    return rows[0];
  }

  /** Bounded, label-scoped listing. Never returns rows from another label. */
  async listForLabel(db: DbOrTx, labelId: string, limit: number): Promise<JobRow[]> {
    const rows = await db
      .select(jobColumns)
      .from(jobs)
      .where(eq(jobs.labelId, labelId))
      .orderBy(desc(jobs.createdAt))
      .limit(limit);
    return rows;
  }

  /**
   * Requests cancellation.
   *
   * A queued job is cancelled immediately; a running job is flagged and stops
   * at its next checkpoint. Returns the resulting status so the caller knows
   * whether to release the budget reservation now or leave it to the worker.
   */
  async requestCancel(
    db: DbOrTx,
    jobId: string,
    now = new Date(),
  ): Promise<'cancelled' | 'cancelling' | 'not_cancellable'> {
    const immediate = await db
      .update(jobs)
      .set({
        status: 'cancelled',
        cancelRequested: true,
        finishedAt: now,
        updatedAt: now,
        failureMessage: 'Door de gebruiker gestopt voordat de verwerking begon.',
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued')))
      .returning({ id: jobs.id });

    if (immediate.length > 0) {
      return 'cancelled';
    }

    const flagged = await db
      .update(jobs)
      .set({ status: 'cancelling', cancelRequested: true, updatedAt: now })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')))
      .returning({ id: jobs.id });

    return flagged.length > 0 ? 'cancelling' : 'not_cancellable';
  }

  /**
   * User-initiated retry of a terminal job.
   *
   * `max_attempts` is raised rather than resetting `attempt`, so the attempt
   * history stays monotonic and visible instead of being rewritten.
   */
  async retry(db: DbOrTx, jobId: string, now = new Date()): Promise<boolean> {
    const rows = await db
      .update(jobs)
      .set({
        status: 'queued',
        maxAttempts: sql`${jobs.attempt} + 1`,
        runAt: now,
        claimedBy: null,
        claimedAt: null,
        heartbeatAt: null,
        finishedAt: null,
        cancelRequested: false,
        failureKind: null,
        failureMessage: null,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, ['failed', 'dead', 'cancelled'])))
      .returning({ id: jobs.id });
    return rows.length > 0;
  }
}
