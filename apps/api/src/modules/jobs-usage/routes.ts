import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { enqueueDemoJobRequest, pageQuery } from '@c360/contracts';
import { authenticate, currentUser } from '../../core/http/authenticate.js';
import { JobService } from './service.js';

const jobParams = z.object({ jobId: z.uuid() });
const labelParams = z.object({ labelId: z.uuid() });

/**
 * Cost estimate for the Phase 0 demo job.
 *
 * It is zero because the demo job calls no provider. Real per-type estimates
 * arrive with the provider adapters in Phase 2; inventing a number now would
 * make the budget display look meaningful when it is not.
 */
const DEMO_JOB_ESTIMATE_CENTS = 0;

export const jobRoutes: FastifyPluginAsync = async (app) => {
  const { db, services } = app.appContext;

  app.get('/labels/:labelId/jobs', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    const { limit } = pageQuery.parse(request.query);
    const items = await services.jobs.listForLabel(db, user, labelId, limit);
    return { items, nextCursor: null };
  });

  app.get('/jobs/:jobId', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { jobId } = jobParams.parse(request.params);
    return services.jobs.get(db, user, jobId);
  });

  app.post('/jobs/:jobId/cancel', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { jobId } = jobParams.parse(request.params);
    return services.jobs.cancel(db, user, jobId, request.id);
  });

  app.post('/jobs/:jobId/retry', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { jobId } = jobParams.parse(request.params);
    return services.jobs.retry(db, user, jobId, request.id);
  });

  /**
   * Phase 0 smoke endpoint. It exercises the whole background path — enqueue,
   * claim, heartbeat, partial progress, retry, cancellation — without touching
   * an AI provider, so the platform can be verified before any provider exists.
   */
  app.post('/labels/:labelId/jobs/demo', { preHandler: authenticate }, async (request, reply) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    const body = enqueueDemoJobRequest.parse({
      ...(request.body as Record<string, unknown>),
      labelId,
    });

    const { summary, created } = await services.jobs.enqueueForLabel(db, user, {
      labelId,
      type: 'demo.echo',
      payload: {
        message: body.message,
        steps: body.steps,
        failFirstAttempts: body.failFirstAttempts,
      },
      // The intent includes the message and a coarse time bucket, so a double
      // click collapses onto one job while a deliberate re-run later does not.
      intent: [body.message, String(body.steps), timeBucket()],
      estimatedCostCents: DEMO_JOB_ESTIMATE_CENTS,
      maxAttempts: body.failFirstAttempts + 1,
      requestId: request.id,
      clientAddress: request.socket.remoteAddress,
    });

    return reply.status(created ? 202 : 200).send(summary);
  });
};

/** 10-second buckets: idempotent against accidental repeats, not against intent. */
function timeBucket(): string {
  return String(Math.floor(Date.now() / 10_000));
}

export { JobService };
