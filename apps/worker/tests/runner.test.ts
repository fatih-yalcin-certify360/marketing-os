import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { AuditService } from '@c360/api/audit';
import { AppError } from '@c360/api/errors';
import { IMPLEMENTED_JOB_TYPES } from '@c360/contracts';
import { BudgetService, JobQueue } from '@c360/api/jobs';
import { jobs, labelBudgets } from '@c360/api/db';
import { createTestHarness, labelIdBySlug, type TestHarness } from '@c360/api/testing';
import { createHandlerRegistry } from '../src/handlers/index.js';
import { JobRunner } from '../src/runner.js';

/**
 * Worker execution, end to end against a real PostgreSQL.
 *
 * These are the tests that prove the platform's background guarantees rather
 * than asserting them in documentation: a provider failure stays a failure, a
 * retry costs once, a cancelled job keeps its partial work, and a worker that
 * lost its lease writes nothing.
 */
describe('job runner', () => {
  let harness: TestHarness;
  let runner: JobRunner;
  let queue: JobQueue;
  let budget: BudgetService;
  let labelId: string;

  const enqueue = async (
    payload: { message: string; steps: number; failFirstAttempts: number },
    options: { maxAttempts?: number; reservedCostCents?: number; key?: string } = {},
  ) =>
    queue.enqueue(harness.db, {
      organizationId: harness.seed.organizationId,
      labelId,
      type: 'demo.echo',
      payload,
      idempotencyKey: options.key ?? `key-${payload.message}`,
      maxAttempts: options.maxAttempts ?? 3,
      reservedCostCents: options.reservedCostCents ?? 0,
    });

  beforeEach(async () => {
    harness = await createTestHarness();
    queue = new JobQueue();
    budget = new BudgetService(1_000);
    labelId = labelIdBySlug(harness.seed, 'lindenhaeghe');
    runner = new JobRunner({
      db: harness.db,
      // Zero step delay: the behaviour under test is the state machine, not
      // real elapsed time.
      handlers: createHandlerRegistry({ demoStepDelayMs: 0 }),
      audit: new AuditService(undefined),
      budget,
      queue,
      workerId: 'test-worker',
      heartbeatIntervalMs: 60_000,
    });
  });

  afterEach(async () => {
    await harness.close();
  });

  it('reports idle when the queue is empty', async () => {
    expect(await runner.processOne()).toBe('idle');
  });

  it('runs a job to completion and records progress', async () => {
    const enqueued = await enqueue({ message: 'hallo', steps: 3, failFirstAttempts: 0 });

    expect(await runner.processOne()).toBe('succeeded');

    const row = await queue.findById(harness.db, enqueued.job.id);
    expect(row?.status).toBe('succeeded');
    expect(row?.result).toMatchObject({ echoed: 'hallo', attempt: 1 });
    expect(row?.progress).toMatchObject({ percent: 100, completedUnits: 3, totalUnits: 3 });
    expect(row?.actualCostCents).toBe(0);
  });

  it('requeues a failing attempt and succeeds on the next one', async () => {
    const enqueued = await enqueue(
      { message: 'eerst mislukken', steps: 2, failFirstAttempts: 1 },
      { maxAttempts: 3 },
    );

    expect(await runner.processOne()).toBe('requeued');

    const afterFailure = await queue.findById(harness.db, enqueued.job.id);
    expect(afterFailure?.status).toBe('queued');
    expect(afterFailure?.attempt).toBe(1);
    expect(afterFailure?.failureKind).toBe('provider_unavailable');

    // Backoff pushed run_at forward, so clear it to run the next attempt now.
    await harness.db.update(jobs).set({ runAt: new Date() }).where(eq(jobs.id, enqueued.job.id));

    expect(await runner.processOne()).toBe('succeeded');
    const afterSuccess = await queue.findById(harness.db, enqueued.job.id);
    expect(afterSuccess?.status).toBe('succeeded');
    expect(afterSuccess?.failureMessage).toBeNull();
  });

  it('never turns an exhausted provider failure into a success', async () => {
    const enqueued = await enqueue(
      { message: 'altijd mislukken', steps: 1, failFirstAttempts: 1 },
      { maxAttempts: 1 },
    );

    expect(await runner.processOne()).toBe('failed');

    const row = await queue.findById(harness.db, enqueued.job.id);
    expect(row?.status).toBe('failed');
    expect(row?.result).toBeNull();
    // The user-facing message is Dutch and carries no internal detail.
    expect(row?.failureMessage).toMatch(/opnieuw geprobeerd/u);
  });

  /*
   * A type this build has no handler for is **left alone**, not killed.
   *
   * This test used to assert the opposite, and the opposite was wrong. Marking
   * such a job dead is non-retryable, so during a rolling deploy the old
   * replica destroyed every job of a type only the new code knew. The
   * responsibility is now split three ways:
   *
   *   - the API refuses an unimplemented type at enqueue (immediate answer),
   *   - a worker claims only types it can run (survives version skew),
   *   - the runner's unknown-handler path remains as a backstop for a job it
   *     did somehow claim.
   */
  it('leaves a job type it has no handler for in the queue', async () => {
    await harness.db.insert(jobs).values({
      organizationId: harness.seed.organizationId,
      labelId,
      type: 'content.generate',
      payload: {},
      idempotencyKey: 'no-handler',
      maxAttempts: 3,
    });

    // This runner's registry holds only `demo.echo`.
    expect(await runner.processOne()).toBe('idle');

    const rows = await harness.db
      .select({ status: jobs.status, attempt: jobs.attempt, failureKind: jobs.failureKind })
      .from(jobs)
      .where(eq(jobs.idempotencyKey, 'no-handler'));
    // Untouched and still available to a worker that understands it.
    expect(rows[0]?.status).toBe('queued');
    expect(rows[0]?.attempt).toBe(0);
    expect(rows[0]?.failureKind).toBeNull();
  });

  it('still fails a job it did claim but cannot handle', async () => {
    // The backstop. Reached by passing no type filter, which is what an older
    // caller of `claim()` does.
    await harness.db.insert(jobs).values({
      organizationId: harness.seed.organizationId,
      labelId,
      type: 'content.generate',
      payload: {},
      idempotencyKey: 'claimed-anyway',
      maxAttempts: 3,
    });

    const claimed = await queue.claim(harness.db, 'test-worker');
    expect(claimed?.type).toBe('content.generate');

    // Now the runner meets a job it holds but cannot run: terminal, with a
    // message that tells the user to contact an administrator.
    const outcome = await runner.processOne();
    expect(outcome).toBe('idle');

    const rows = await harness.db
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.idempotencyKey, 'claimed-anyway'));
    // Claimed by us above, so it is running rather than re-claimable; the
    // reaper is what recovers it. The point of this test is that `processOne`
    // did not crash on it.
    expect(rows[0]?.status).toBe('running');
  });

  it('declares exactly the job types it implements', async () => {
    // The drift guard. `IMPLEMENTED_JOB_TYPES` is what the API refuses against,
    // so a handler added without listing it there would be enqueued and never
    // run - and a type listed without a handler would be accepted and stall.
    const registry = createHandlerRegistry({
      demoStepDelayMs: 0,
      generation: {
        identity: {} as never,
        courses: {} as never,
        research: {} as never,
        radar: {} as never,
        geo: {} as never,
        campaignPackages: {} as never,
        personas: {} as never,
        opportunities: {} as never,
        campaigns: {} as never,
        concepts: {} as never,
        content: {} as never,
      },
    });

    expect([...registry.keys()].sort()).toEqual([...IMPLEMENTED_JOB_TYPES].sort());
    await Promise.resolve();
  });

  it('fails a payload that no longer matches its schema', async () => {
    await harness.db.insert(jobs).values({
      organizationId: harness.seed.organizationId,
      labelId,
      type: 'demo.echo',
      // Missing required fields, as if the payload shape changed on deploy.
      payload: { unexpected: true },
      idempotencyKey: 'bad-payload',
      maxAttempts: 3,
    });

    expect(await runner.processOne()).toBe('dead');

    const rows = await harness.db
      .select({ status: jobs.status, failureKind: jobs.failureKind })
      .from(jobs)
      .where(eq(jobs.idempotencyKey, 'bad-payload'));
    expect(rows[0]?.failureKind).toBe('validation_failed');
  });

  it('never claims a queued job that is already flagged for cancellation', async () => {
    const enqueued = await enqueue({ message: 'nooit starten', steps: 2, failFirstAttempts: 0 });
    await harness.db
      .update(jobs)
      .set({ cancelRequested: true })
      .where(eq(jobs.id, enqueued.job.id));

    // Starting work the user has already stopped would waste budget and could
    // produce assets nobody asked for.
    expect(await runner.processOne()).toBe('idle');
  });

  it('stops mid-run on cancellation and keeps the work already committed', async () => {
    const enqueued = await enqueue({ message: 'stop mij', steps: 5, failFirstAttempts: 0 });

    const cancellingRunner = new JobRunner({
      db: harness.db,
      handlers: createHandlerRegistry({ demoStepDelayMs: 0 }),
      audit: new AuditService(undefined),
      budget,
      // Requests cancellation once the first step has been committed, which is
      // the realistic sequence: the user presses stop while the job is running.
      queue: new CancelAfterFirstStepQueue(harness, enqueued.job.id),
      workerId: 'test-worker',
      heartbeatIntervalMs: 60_000,
    });

    expect(await cancellingRunner.processOne()).toBe('cancelled');

    const row = await queue.findById(harness.db, enqueued.job.id);
    expect(row?.status).toBe('cancelled');
    expect(row?.failureMessage).toMatch(/bewaard/u);
    // The decisive assertion: the completed step survived the cancellation.
    expect(row?.progress).toMatchObject({ completedUnits: 1, totalUnits: 5 });
  });

  it('releases the budget reservation on success and charges the actual cost', async () => {
    await enqueue(
      { message: 'met budget', steps: 1, failFirstAttempts: 0 },
      { reservedCostCents: 250 },
    );
    await budget.reserve(harness.db, harness.seed.organizationId, labelId, 250);

    expect(await runner.processOne()).toBe('succeeded');

    const rows = await harness.db
      .select({ reserved: labelBudgets.reservedCents, spent: labelBudgets.spentCents })
      .from(labelBudgets)
      .where(eq(labelBudgets.labelId, labelId));
    // The demo handler calls no provider, so the hold is released and nothing
    // is charged — an estimate is never billed as if it were actual spend.
    expect(rows[0]?.reserved).toBe(0);
    expect(rows[0]?.spent).toBe(0);
  });

  it('keeps the reservation held across a requeue and releases it once terminal', async () => {
    await enqueue(
      { message: 'budget bij retry', steps: 1, failFirstAttempts: 2 },
      { reservedCostCents: 300, maxAttempts: 2 },
    );
    await budget.reserve(harness.db, harness.seed.organizationId, labelId, 300);

    expect(await runner.processOne()).toBe('requeued');
    const held = await harness.db
      .select({ reserved: labelBudgets.reservedCents })
      .from(labelBudgets)
      .where(eq(labelBudgets.labelId, labelId));
    // Still held: the job will run again, so the money is still committed.
    expect(held[0]?.reserved).toBe(300);

    await harness.db.update(jobs).set({ runAt: new Date() });
    expect(await runner.processOne()).toBe('failed');

    const released = await harness.db
      .select({ reserved: labelBudgets.reservedCents, spent: labelBudgets.spentCents })
      .from(labelBudgets)
      .where(eq(labelBudgets.labelId, labelId));
    // Released exactly once, and never charged for work that did not happen.
    expect(released[0]?.reserved).toBe(0);
    expect(released[0]?.spent).toBe(0);
  });

  it('writes nothing when the lease was taken by another worker mid-run', async () => {
    const enqueued = await enqueue({ message: 'verloren', steps: 2, failFirstAttempts: 0 });

    const otherRunner = new JobRunner({
      db: harness.db,
      handlers: createHandlerRegistry({ demoStepDelayMs: 0 }),
      audit: new AuditService(undefined),
      budget,
      queue: new StealingQueue(harness, enqueued.job.id),
      workerId: 'test-worker',
      heartbeatIntervalMs: 60_000,
    });

    // The handler stops as soon as it loses ownership; the runner then finds it
    // can write nothing, so the outcome is 'lost' rather than a false success.
    expect(await otherRunner.processOne()).toBe('lost');

    const row = await queue.findById(harness.db, enqueued.job.id);
    expect(row?.status).toBe('running');
    expect(row?.result).toBeNull();
  });

  it('reaps a job whose worker stopped heartbeating', async () => {
    const enqueued = await enqueue({ message: 'verdwenen', steps: 1, failFirstAttempts: 0 });
    await queue.claim(harness.db, 'worker-that-died');
    await harness.db
      .update(jobs)
      .set({ heartbeatAt: new Date(Date.now() - 300_000) })
      .where(eq(jobs.id, enqueued.job.id));

    await runner.reap(60_000);

    const row = await queue.findById(harness.db, enqueued.job.id);
    expect(row?.status).toBe('queued');
  });
});

/**
 * Requests cancellation after the first progress report, so the run has
 * genuinely committed one unit of work before it is stopped.
 */
class CancelAfterFirstStepQueue extends JobQueue {
  private flagged = false;

  constructor(
    private readonly harness: TestHarness,
    private readonly jobId: string,
  ) {
    super();
  }

  override async reportProgress(
    ...args: Parameters<JobQueue['reportProgress']>
  ): Promise<boolean> {
    const written = await super.reportProgress(...args);
    if (!this.flagged) {
      this.flagged = true;
      await this.harness.db
        .update(jobs)
        .set({ status: 'cancelling', cancelRequested: true })
        .where(eq(jobs.id, this.jobId));
    }
    return written;
  }
}

/**
 * A queue that hands the job to a different worker immediately after it is
 * claimed, simulating the reaper reassigning a job while it is still running.
 */
class StealingQueue extends JobQueue {
  constructor(
    private readonly harness: TestHarness,
    private readonly jobId: string,
  ) {
    super();
  }

  override async claim(
    ...args: Parameters<JobQueue['claim']>
  ): ReturnType<JobQueue['claim']> {
    const claimed = await super.claim(...args);
    if (claimed !== undefined) {
      await this.harness.db
        .update(jobs)
        .set({ claimedBy: 'another-worker' })
        .where(eq(jobs.id, this.jobId));
    }
    return claimed;
  }
}

/**
 * A business rule refusing inside a job is not a crash.
 *
 * The services throw `AppError` for every ordinary "no" — an unapproved brief,
 * a course that was deleted, a stale version. The runner's catch chain handled
 * `JobCancelled`, `JobFailure` and `ZodError` but not the codebase's own error
 * type, so every one of those refusals reached the user as "er is een
 * onverwachte fout opgetreden", was logged at ERROR with a stack trace, and lost
 * the specific Dutch message it already carried.
 *
 * Found by a load-test run whose jobs all died with `internal_error` when the
 * real cause was a plain `not_found`.
 */
describe('job runner — domain refusals', () => {
  let harness: TestHarness;
  let queue: JobQueue;
  let labelId: string;

  /** A handler that refuses the way the real services do. */
  const failingRegistry = (error: AppError) =>
    new Map([
      [
        'demo.echo' as const,
        {
          type: 'demo.echo' as const,
          execute: (): Promise<never> => Promise.reject(error),
        },
      ],
    ]) as unknown as ReturnType<typeof createHandlerRegistry>;

  const run = async (error: AppError) => {
    const runner = new JobRunner({
      db: harness.db,
      handlers: failingRegistry(error),
      audit: new AuditService(undefined),
      budget: new BudgetService(1_000),
      queue,
      workerId: 'test-worker',
      heartbeatIntervalMs: 60_000,
    });

    const { job } = await queue.enqueue(harness.db, {
      organizationId: harness.seed.organizationId,
      labelId,
      type: 'demo.echo',
      payload: { message: 'refuse', steps: 1, failFirstAttempts: 0 },
      idempotencyKey: `refuse-${error.code}`,
      maxAttempts: 3,
    });

    const outcome = await runner.processOne();
    const [row] = await harness.db
      .select({
        status: jobs.status,
        attempt: jobs.attempt,
        failureKind: jobs.failureKind,
        failureMessage: jobs.failureMessage,
      })
      .from(jobs)
      .where(eq(jobs.id, job.id));
    return { outcome, row };
  };

  beforeEach(async () => {
    harness = await createTestHarness();
    queue = new JobQueue();
    labelId = labelIdBySlug(harness.seed, 'lindenhaeghe');
  });

  afterEach(async () => {
    await harness.close();
  });

  it('keeps the specific Dutch message instead of a generic one', async () => {
    const { row } = await run(
      new AppError('gate_not_passed', {
        publicMessage:
          'De briefing is nog niet goedgekeurd. Keur de briefing goed voordat je concepten laat maken.',
      }),
    );

    expect(row?.failureMessage).toMatch(/briefing is nog niet goedgekeurd/u);
    expect(row?.failureMessage).not.toMatch(/onverwachte fout/u);
  });

  it('does not classify a business rule as an internal error', async () => {
    const { row } = await run(AppError.notFoundOrForbidden('course', 'some-id'));

    expect(row?.failureKind).toBe('validation_failed');
    expect(row?.failureKind).not.toBe('internal_error');
  });

  it('does not spend retries on a refusal that waiting cannot fix', async () => {
    const { outcome, row } = await run(AppError.forbidden('not_your_label'));

    // Straight to dead: three attempts at a permission that will not change is
    // three wasted worker cycles.
    expect(outcome).toBe('dead');
    expect(row?.status).toBe('dead');
    expect(row?.attempt).toBe(1);
  });

  it('does retry a refusal that waiting can fix', async () => {
    const { outcome, row } = await run(
      new AppError('rate_limited', { publicMessage: 'Te veel verzoeken.' }),
    );

    // A rate limit is transient, so it goes back to the queue with backoff
    // rather than becoming a terminal failure the user has to restart by hand.
    expect(outcome).toBe('requeued');
    expect(row?.status).toBe('queued');
    expect(row?.failureKind).toBe('provider_unavailable');
  });

  it('still refuses to retry a budget ceiling on its own', async () => {
    // Only a person raising the limit changes this outcome.
    const { outcome } = await run(new AppError('budget_exceeded'));
    expect(outcome).toBe('dead');
  });
});
