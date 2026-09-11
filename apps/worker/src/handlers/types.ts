import type { JobFailureKind, JobProgress, JobType } from '@c360/contracts';
import type { Db } from '@c360/api/db';

/**
 * A job handler's contract with the runner.
 *
 * Handlers are deliberately narrow: they receive validated input and a small
 * set of capabilities, and they cannot touch HTTP, authorisation or the queue
 * directly. In particular a handler never decides whether the caller was
 * allowed to start it — that decision was made and recorded before the job was
 * enqueued (requirement 13: "Model yetki, onay veya veri erişimi kararı
 * vermesin").
 */
export interface JobContext {
  db: Db;
  jobId: string;
  organizationId: string;
  labelId: string | null;
  attempt: number;

  /**
   * Commits partial progress. Returns false when this worker no longer owns
   * the job — the handler must then stop, because another worker has taken it.
   */
  reportProgress(progress: JobProgress): Promise<boolean>;

  /**
   * What this attempt has actually cost so far, in eurocents.
   *
   * Summed from the usage rows the generation service already writes, so a
   * handler does not have to carry a running total and cannot forget one.
   */
  spentCents(): Promise<number>;

  /**
   * True once the user has requested cancellation. Handlers must check this at
   * every checkpoint and return cleanly, keeping the work already committed.
   */
  isCancellationRequested(): Promise<boolean>;

  /** Structured, content-free logging. */
  log(message: string, fields?: Record<string, string | number | boolean>): void;
}

export interface JobOutcome {
  result: Record<string, unknown>;
  /** Real cost incurred, in eurocents. Zero when no provider was called. */
  actualCostCents: number;
}

/** Thrown by a handler to select the failure classification explicitly. */
export class JobFailure extends Error {
  constructor(
    public readonly kind: JobFailureKind,
    /** Dutch, user-facing, safe to display. */
    public readonly publicMessage: string,
    internalDetail?: string,
  ) {
    super(internalDetail ?? publicMessage);
    this.name = 'JobFailure';
  }
}

/** Signals a clean stop after cancellation, preserving committed work. */
export class JobCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'JobCancelled';
  }
}

export interface JobHandler<TPayload> {
  readonly type: JobType;
  /**
   * Validates the stored payload. A payload that no longer matches its schema
   * (for example after a deploy that changed it) fails as `validation_failed`
   * rather than being coerced.
   */
  parsePayload(payload: unknown): TPayload;
  run(payload: TPayload, context: JobContext): Promise<JobOutcome>;
}

/**
 * A handler as the registry holds it.
 *
 * `JobHandler<T>` is invariant in `T` — it both produces a `T` (`parsePayload`)
 * and consumes one (`run`) — so no single instantiation can hold every handler.
 * `defineHandler` closes over the payload type and exposes one
 * `execute(payload: unknown, …)`, which makes the registry type-safe with no
 * casts and keeps the runner ignorant of payload shapes.
 */
export interface RegisteredHandler {
  readonly type: JobType;
  /**
   * Validates the stored payload and runs the job. Validation happens inside
   * this call so the runner can classify a schema mismatch as a failure of the
   * job rather than a crash of the worker.
   */
  execute(payload: unknown, context: JobContext): Promise<JobOutcome>;
}

export function defineHandler<TPayload>(handler: JobHandler<TPayload>): RegisteredHandler {
  return {
    type: handler.type,
    execute: (payload, context) => handler.run(handler.parsePayload(payload), context),
  };
}
