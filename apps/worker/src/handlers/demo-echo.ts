import { z } from 'zod';
import {
  JobCancelled,
  JobFailure,
  type JobContext,
  type JobHandler,
  type JobOutcome,
} from './types.js';

/**
 * Phase 0 verification job.
 *
 * It calls no provider and costs nothing. Its whole purpose is to make the
 * background machinery observable and testable before any AI provider exists:
 * it commits partial progress between steps, honours cancellation at each
 * checkpoint, and can be told to fail its first N attempts so retry and
 * backoff can be seen working.
 */

const payloadSchema = z.object({
  message: z.string().min(1).max(200),
  steps: z.number().int().min(1).max(20),
  failFirstAttempts: z.number().int().min(0).max(5),
});

type DemoEchoPayload = z.infer<typeof payloadSchema>;

export class DemoEchoHandler implements JobHandler<DemoEchoPayload> {
  public readonly type = 'demo.echo' as const;

  /** Injectable so tests do not have to wait in real time. */
  constructor(private readonly stepDelayMs = 400) {}

  parsePayload(payload: unknown): DemoEchoPayload {
    return payloadSchema.parse(payload);
  }

  async run(payload: DemoEchoPayload, context: JobContext): Promise<JobOutcome> {
    if (context.attempt <= payload.failFirstAttempts) {
      // Classified as retryable, so the runner requeues with backoff.
      throw new JobFailure(
        'provider_unavailable',
        'De verwerking is niet gelukt en wordt automatisch opnieuw geprobeerd.',
        `demo handler failing attempt ${String(context.attempt)} on purpose`,
      );
    }

    const completed: string[] = [];

    for (let step = 1; step <= payload.steps; step += 1) {
      if (await context.isCancellationRequested()) {
        // Committed steps stay committed; the runner records `cancelled`.
        throw new JobCancelled();
      }

      await delay(this.stepDelayMs);
      completed.push(`stap ${String(step)}`);

      const stillOwned = await context.reportProgress({
        percent: Math.round((step / payload.steps) * 100),
        message: `Stap ${String(step)} van ${String(payload.steps)} afgerond`,
        completedUnits: step,
        totalUnits: payload.steps,
      });

      // Losing ownership means the reaper handed this job to another worker.
      // Continuing would risk a double write, so stop immediately.
      if (!stillOwned) {
        context.log('lost job ownership; stopping', { step });
        throw new JobCancelled();
      }
    }

    return {
      result: {
        echoed: payload.message,
        completedSteps: completed,
        attempt: context.attempt,
      },
      actualCostCents: 0,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
