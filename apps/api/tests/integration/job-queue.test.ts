import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { jobs, usageRecords } from '../../src/core/db/schema.js';
import { JobQueue, backoffMs } from '../../src/modules/jobs-usage/queue.js';
import { UsageRecorder } from '../../src/modules/jobs-usage/usage.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

describe('job queue', () => {
  let harness: TestHarness;
  let queue: JobQueue;
  let labelId: string;
  let organizationId: string;

  beforeEach(async () => {
    harness = await createTestHarness();
    queue = new JobQueue();
    labelId = labelIdBySlug(harness.seed, 'lindenhaeghe');
    organizationId = harness.seed.organizationId;
  });

  afterEach(async () => {
    await harness.close();
  });

  const enqueue = async (idempotencyKey: string, overrides: Record<string, unknown> = {}) =>
    queue.enqueue(harness.db, {
      organizationId,
      labelId,
      type: 'demo.echo',
      payload: { message: 'test', steps: 2, failFirstAttempts: 0 },
      idempotencyKey,
      ...overrides,
    });

  it('returns the same job for a repeated idempotency key', async () => {
    const first = await enqueue('same-key');
    const second = await enqueue('same-key');

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);

    const all = await harness.db.select({ id: jobs.id }).from(jobs);
    expect(all).toHaveLength(1);
  });

  it('claims a job exactly once', async () => {
    await enqueue('claim-once');

    const first = await queue.claim(harness.db, 'worker-a');
    const second = await queue.claim(harness.db, 'worker-b');

    expect(first?.id).toBeDefined();
    // Nothing left to claim: the row is now `running`, not `queued`.
    expect(second).toBeUndefined();
    expect(first?.attempt).toBe(1);
  });

  /*
   * Release is what makes a deploy cheap. Without it, a job running when the
   * container stops sits `running` until the heartbeat reaper notices, which is
   * three minutes of a user watching a progress bar that will not move.
   */
  it('releases a job back to the queue without spending an attempt', async () => {
    await enqueue('release-me');
    const claimed = await queue.claim(harness.db, 'worker-a');
    expect(claimed?.attempt).toBe(1);

    expect(await queue.release(harness.db, String(claimed?.id), 'worker-a')).toBe(true);

    const [row] = await harness.db
      .select({
        status: jobs.status,
        attempt: jobs.attempt,
        claimedBy: jobs.claimedBy,
        failureKind: jobs.failureKind,
      })
      .from(jobs)
      .where(eq(jobs.id, String(claimed?.id)));

    expect(row?.status).toBe('queued');
    expect(row?.claimedBy).toBeNull();
    // The attempt is not consumed: three deploys must not exhaust the retries
    // of work that never actually failed.
    expect(row?.attempt).toBe(1);
    // And it is not recorded as a failure, so it never reads as broken.
    expect(row?.failureKind).toBeNull();

    // Immediately claimable by another worker; the attempt increments now,
    // because this is a real second run.
    const reclaimed = await queue.claim(harness.db, 'worker-b');
    expect(reclaimed?.id).toBe(claimed?.id);
    expect(reclaimed?.attempt).toBe(2);
  });

  it('refuses to release a job the worker no longer owns', async () => {
    await enqueue('not-mine');
    const claimed = await queue.claim(harness.db, 'worker-a');

    // Same ownership guard as every other write-back: a worker whose lease was
    // taken must not be able to yank the job away from its new owner.
    expect(await queue.release(harness.db, String(claimed?.id), 'worker-b')).toBe(false);

    const [row] = await harness.db
      .select({ status: jobs.status, claimedBy: jobs.claimedBy })
      .from(jobs)
      .where(eq(jobs.id, String(claimed?.id)));
    expect(row?.status).toBe('running');
    expect(row?.claimedBy).toBe('worker-a');
  });

  /*
   * A rolling deploy leaves an old replica polling while new code enqueues job
   * types it has never heard of. Claiming one and failing it is destructive:
   * the unknown-handler path is non-retryable, so the job goes straight to
   * `dead` and no newer replica ever sees it.
   *
   * Found in practice — a worker left over from an earlier session claimed a
   * `brief.draft` job and killed it while the current worker sat idle.
   */
  it('leaves a job type it cannot handle for another worker', async () => {
    await enqueue('unsupported-here', { type: 'persona.propose' });

    // A worker whose build knows only `demo.echo`.
    const claimed = await queue.claim(harness.db, 'old-replica', new Date(), 4, ['demo.echo']);
    expect(claimed).toBeUndefined();

    // The job is untouched: still queued, no attempt spent, not marked dead.
    const [row] = await harness.db
      .select({ status: jobs.status, attempt: jobs.attempt, claimedBy: jobs.claimedBy })
      .from(jobs);
    expect(row?.status).toBe('queued');
    expect(row?.attempt).toBe(0);
    expect(row?.claimedBy).toBeNull();

    // And a worker that does know the type picks it up normally.
    const newReplica = await queue.claim(harness.db, 'new-replica', new Date(), 4, [
      'demo.echo',
      'persona.propose',
    ]);
    expect(newReplica?.type).toBe('persona.propose');
  });

  it('claims nothing at all when the worker has no handlers', async () => {
    await enqueue('no-handlers');
    // An empty registry is a misconfiguration; claiming would destroy work.
    expect(await queue.claim(harness.db, 'empty', new Date(), 4, [])).toBeUndefined();
  });

  it('still claims every type when no filter is given', async () => {
    // Callers that do not pass a filter keep the previous behaviour, so the
    // parameter cannot silently starve an existing deployment.
    await enqueue('unfiltered');
    expect(await queue.claim(harness.db, 'any', new Date(), 4)).toBeDefined();
  });

  it('does not claim a job scheduled for the future', async () => {
    const result = await enqueue('future');
    await harness.db
      .update(jobs)
      .set({ runAt: new Date(Date.now() + 60_000) })
      .where(eq(jobs.id, result.job.id));

    expect(await queue.claim(harness.db, 'worker-a')).toBeUndefined();
  });

  it('refuses write-back from a worker that no longer owns the job', async () => {
    await enqueue('ownership');
    const claimed = await queue.claim(harness.db, 'worker-a');
    expect(claimed).toBeDefined();

    // The reaper hands the job to another worker.
    await harness.db
      .update(jobs)
      .set({ claimedBy: 'worker-b' })
      .where(eq(jobs.id, claimed!.id));

    // worker-a wakes up and tries to finish. Every path must be a no-op.
    expect(await queue.complete(harness.db, claimed!.id, 'worker-a', { result: {}, actualCostCents: 500 })).toBe(false);
    expect(await queue.reportProgress(harness.db, claimed!.id, 'worker-a', { percent: 50, message: 'x', completedUnits: 1, totalUnits: 2 })).toBe(false);
    expect(await queue.markCancelled(harness.db, claimed!.id, 'worker-a')).toBe(false);
    expect(await queue.fail(harness.db, claimed!.id, 'worker-a', { kind: 'timeout', publicMessage: 'x' })).toBeUndefined();

    const after = await queue.findById(harness.db, claimed!.id);
    expect(after?.status).toBe('running');
    expect(after?.actualCostCents).toBeNull();
  });

  it('requeues a retryable failure with backoff and keeps the attempt count', async () => {
    await enqueue('retryable', { maxAttempts: 3 });
    const claimed = await queue.claim(harness.db, 'worker-a');

    const settled = await queue.fail(harness.db, claimed!.id, 'worker-a', {
      kind: 'provider_unavailable',
      publicMessage: 'Tijdelijk niet beschikbaar.',
    });

    expect(settled?.outcome).toBe('requeued');
    expect(settled?.job.status).toBe('queued');
    expect(settled?.job.attempt).toBe(1);

    // Backoff must actually push run_at into the future, otherwise a flapping
    // provider would be hammered in a tight loop.
    const row = await harness.db
      .select({ runAt: jobs.runAt, claimedBy: jobs.claimedBy })
      .from(jobs)
      .where(eq(jobs.id, claimed!.id));
    expect(row[0]!.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(row[0]!.claimedBy).toBeNull();
  });

  it('stops retrying once attempts are exhausted', async () => {
    await enqueue('exhaust', { maxAttempts: 1 });
    const claimed = await queue.claim(harness.db, 'worker-a');

    const settled = await queue.fail(harness.db, claimed!.id, 'worker-a', {
      kind: 'provider_unavailable',
      publicMessage: 'Niet beschikbaar.',
    });

    expect(settled?.outcome).toBe('failed');
    expect(settled?.job.status).toBe('failed');
  });

  it('marks a non-retryable failure dead without retrying', async () => {
    await enqueue('nonretryable', { maxAttempts: 5 });
    const claimed = await queue.claim(harness.db, 'worker-a');

    const settled = await queue.fail(harness.db, claimed!.id, 'worker-a', {
      kind: 'validation_failed',
      publicMessage: 'Ongeldige gegevens.',
    });

    expect(settled?.outcome).toBe('dead');
    expect(settled?.job.status).toBe('dead');
  });

  it('never converts a provider failure into a success', async () => {
    // Requirement 11: "Provider arızası sahte başarıya dönüşmesin."
    await enqueue('no-fake-success', { maxAttempts: 1 });
    const claimed = await queue.claim(harness.db, 'worker-a');
    await queue.fail(harness.db, claimed!.id, 'worker-a', {
      kind: 'provider_invalid_output',
      publicMessage: 'Onbruikbaar antwoord.',
    });

    const after = await queue.findById(harness.db, claimed!.id);
    expect(after?.status).not.toBe('succeeded');
    expect(after?.result).toBeNull();
    expect(after?.failureMessage).toBe('Onbruikbaar antwoord.');
  });

  it('cancels a queued job immediately and a running job cooperatively', async () => {
    const queued = await enqueue('cancel-queued');
    expect(await queue.requestCancel(harness.db, queued.job.id)).toBe('cancelled');

    const running = await enqueue('cancel-running');
    await queue.claim(harness.db, 'worker-a');
    expect(await queue.requestCancel(harness.db, running.job.id)).toBe('cancelling');

    // The running job's own heartbeat is how the worker learns to stop.
    const state = await queue.heartbeat(harness.db, running.job.id, 'worker-a');
    expect(state.alive).toBe(true);
    expect(state.cancelRequested).toBe(true);
  });

  it('keeps committed progress when a job is cancelled', async () => {
    // Requirement 11: "Kısmi tamamlanan işler kaybolmasın."
    const result = await enqueue('partial');
    const claimed = await queue.claim(harness.db, 'worker-a');
    await queue.reportProgress(harness.db, claimed!.id, 'worker-a', {
      percent: 50,
      message: 'Stap 1 van 2 afgerond',
      completedUnits: 1,
      totalUnits: 2,
    });
    await queue.requestCancel(harness.db, result.job.id);
    await queue.markCancelled(harness.db, claimed!.id, 'worker-a');

    const after = await queue.findById(harness.db, claimed!.id);
    expect(after?.status).toBe('cancelled');
    expect(after?.progress).toMatchObject({ completedUnits: 1, percent: 50 });
  });

  it('refuses to cancel a job that already finished', async () => {
    await enqueue('already-done');
    const claimed = await queue.claim(harness.db, 'worker-a');
    await queue.complete(harness.db, claimed!.id, 'worker-a', { result: { ok: true }, actualCostCents: 0 });

    expect(await queue.requestCancel(harness.db, claimed!.id)).toBe('not_cancellable');
  });

  it('requeues an abandoned job and fails it once attempts run out', async () => {
    await enqueue('abandoned', { maxAttempts: 2 });
    const claimed = await queue.claim(harness.db, 'worker-gone');

    // Simulate a worker that died without heartbeating.
    await harness.db
      .update(jobs)
      .set({ heartbeatAt: new Date(Date.now() - 120_000) })
      .where(eq(jobs.id, claimed!.id));

    const first = await queue.reapAbandoned(harness.db, 60_000);
    expect(first).toEqual({ requeued: 1, failed: 0 });

    const reclaimed = await queue.claim(harness.db, 'worker-new');
    expect(reclaimed?.attempt).toBe(2);
    await harness.db
      .update(jobs)
      .set({ heartbeatAt: new Date(Date.now() - 120_000) })
      .where(eq(jobs.id, claimed!.id));

    const second = await queue.reapAbandoned(harness.db, 60_000);
    expect(second).toEqual({ requeued: 0, failed: 1 });
  });

  it('allows a user retry of a terminal job without rewriting its history', async () => {
    await enqueue('user-retry', { maxAttempts: 1 });
    const claimed = await queue.claim(harness.db, 'worker-a');
    await queue.fail(harness.db, claimed!.id, 'worker-a', {
      kind: 'provider_unavailable',
      publicMessage: 'Mislukt.',
    });

    expect(await queue.retry(harness.db, claimed!.id)).toBe(true);

    const after = await queue.findById(harness.db, claimed!.id);
    expect(after?.status).toBe('queued');
    // The attempt counter is preserved; the ceiling moved instead.
    expect(after?.attempt).toBe(1);
    expect(after?.maxAttempts).toBe(2);
    expect(after?.failureMessage).toBeNull();

    const reclaimed = await queue.claim(harness.db, 'worker-b');
    expect(reclaimed?.attempt).toBe(2);
  });

  it('lets a deliberate re-run follow a finished job, while an unfinished one still absorbs the click', async () => {
    /*
     * The service-level rule behind "Content maken" and "Kanaalplan
     * voorstellen": the same intent while a job is queued or running is the
     * same job; the same intent after that job finished — dead or succeeded —
     * is a new job. Before this, a content job that died left the button
     * returning the dead row for ever.
     */
    const jobsService = harness.appContext.services.jobs;
    const user = harness.currentUser;
    const request = {
      labelId,
      type: 'demo.echo' as const,
      payload: { message: 'rerun', steps: 1, failFirstAttempts: 0 },
      intent: ['rerun', 'fixed-intent'],
      estimatedCostCents: 0,
    };

    const first = await jobsService.enqueueForLabel(harness.db, user, request);
    const duplicate = await jobsService.enqueueForLabel(harness.db, user, request);
    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.summary.id).toBe(first.summary.id);

    const claimed = await queue.claim(harness.db, 'worker-a');
    await queue.fail(harness.db, claimed!.id, 'worker-a', {
      kind: 'internal_error',
      publicMessage: 'Mislukt.',
    });
    expect((await queue.findById(harness.db, first.summary.id))?.status).toBe('dead');

    const rerun = await jobsService.enqueueForLabel(harness.db, user, request);
    expect(rerun.created).toBe(true);
    expect(rerun.summary.id).not.toBe(first.summary.id);
    expect(rerun.summary.status).toBe('queued');

    // And the new run absorbs a second click exactly as the first did.
    const again = await jobsService.enqueueForLabel(harness.db, user, request);
    expect(again.created).toBe(false);
    expect(again.summary.id).toBe(rerun.summary.id);

    // The dead row is untouched: history is kept, not rewritten.
    expect((await queue.findById(harness.db, first.summary.id))?.status).toBe('dead');
  });

  it('refuses to retry a job that succeeded', async () => {
    await enqueue('no-retry-success');
    const claimed = await queue.claim(harness.db, 'worker-a');
    await queue.complete(harness.db, claimed!.id, 'worker-a', { result: {}, actualCostCents: 0 });

    expect(await queue.retry(harness.db, claimed!.id)).toBe(false);
  });

  it('grows backoff and caps it', () => {
    expect(backoffMs(1)).toBe(2_000);
    expect(backoffMs(2)).toBe(4_000);
    expect(backoffMs(3)).toBe(8_000);
    expect(backoffMs(20)).toBe(60_000);
  });
});

describe('usage accounting idempotency', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('records one usage row per job attempt and kind', async () => {
    // Requirement 15: "Retry sırasında çift asset/çift maliyet işlemi
    // oluşmaması." A replayed attempt must not charge twice.
    const labelId = labelIdBySlug(harness.seed, 'lindenhaeghe');
    const enqueued = await new JobQueue().enqueue(harness.db, {
      organizationId: harness.seed.organizationId,
      labelId,
      type: 'content.generate',
      payload: {},
      idempotencyKey: 'usage-key',
    });

    const recorder = new UsageRecorder();
    const input = {
      organizationId: harness.seed.organizationId,
      labelId,
      jobId: enqueued.job.id,
      attempt: 1,
      kind: 'ai_text' as const,
      provider: 'mock',
      estimatedCostCents: 120,
      actualCostCents: 130,
    };

    expect(await recorder.record(harness.db, input)).toBe(true);
    expect(await recorder.record(harness.db, input)).toBe(false);

    const rows = await harness.db
      .select({ id: usageRecords.id, actual: usageRecords.actualCostCents })
      .from(usageRecords)
      .where(eq(usageRecords.jobId, enqueued.job.id));
    expect(rows).toHaveLength(1);

    // A genuinely new attempt is a separate, legitimate charge.
    expect(await recorder.record(harness.db, { ...input, attempt: 2 })).toBe(true);
    const afterRetry = await harness.db
      .select({ id: usageRecords.id })
      .from(usageRecords)
      .where(eq(usageRecords.jobId, enqueued.job.id));
    expect(afterRetry).toHaveLength(2);
  });
});
