import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireLabelPermission } from '../../core/authz/policy.js';
import { createSourceInput } from '@c360/contracts';
import { authenticate, currentUser } from '../../core/http/authenticate.js';

/**
 * Sources and research runs.
 *
 * The run itself is queued: it fetches every active source and then makes a
 * model call, which is well past what a request should hold open (ADR-0016).
 * Registering a source is synchronous — it only validates and writes a row.
 */

const labelParams = z.object({ labelId: z.uuid() });
const sourceParams = labelParams.extend({ sourceId: z.uuid() });

export const sourceRoutes: FastifyPluginAsync = async (app) => {
  const { db, services } = app.appContext;

  app.get('/labels/:labelId/sources', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    const items = await services.research.listSources(db, user, labelId);
    return { items, nextCursor: null };
  });

  app.post(
    '/labels/:labelId/sources',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const { labelId } = labelParams.parse(request.params);
      const body = createSourceInput.parse(request.body);
      const source = await services.research.addSource(db, user, labelId, body);
      return reply.status(201).send(source);
    },
  );

  app.patch(
    '/labels/:labelId/sources/:sourceId',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const { labelId, sourceId } = sourceParams.parse(request.params);
      const body = z.object({ isActive: z.boolean() }).parse(request.body);
      return services.research.setSourceActive(db, user, labelId, sourceId, body.isActive);
    },
  );

  /**
   * The current run for a course, with why it is or is not still current.
   *
   * Freshness comes back as named reasons rather than a flag, because "the
   * price page changed" and "nothing changed but it is three months old" are
   * different decisions for the person reading it.
   */
  app.get(
    '/labels/:labelId/courses/:courseVersionId/research',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const params = labelParams.extend({ courseVersionId: z.uuid() }).parse(request.params);
      requireLabelPermission(user, params.labelId, 'research:read');
      await services.courses.requireVersion(db, params.labelId, params.courseVersionId);

      const run = await services.research.latestRun(db, params.labelId, params.courseVersionId);
      const freshness = await services.research.freshness(
        db,
        params.labelId,
        params.courseVersionId,
      );
      const findings =
        run === undefined
          ? []
          : await services.research.findingsForRun(db, user, params.labelId, run.id);

      return { run: run ?? null, freshness, findings };
    },
  );

  /**
   * Starts a run.
   *
   * `force` is what makes "the user can force a re-research" real: without it a
   * current run is returned unchanged rather than paid for again.
   */
  app.post(
    '/labels/:labelId/courses/:courseVersionId/research/run',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = currentUser(request);
      const params = labelParams.extend({ courseVersionId: z.uuid() }).parse(request.params);
      requireLabelPermission(user, params.labelId, 'research:run');
      await services.courses.requireVersion(db, params.labelId, params.courseVersionId);
      const body = z.object({ force: z.boolean().default(false) }).parse(request.body ?? {});

      if (!body.force) {
        const freshness = await services.research.freshness(
          db,
          params.labelId,
          params.courseVersionId,
        );
        if (freshness.isCurrent) {
          // Reuse rather than re-run. Returning 200 with the existing run makes
          // the distinction visible to the client without an error.
          const run = await services.research.latestRun(
            db,
            params.labelId,
            params.courseVersionId,
          );
          return reply.status(200).send({ reused: true, run });
        }
      }

      const previous = await services.research.latestRun(db, params.labelId, params.courseVersionId);
      const { summary, created } = await services.generationJobs.enqueue(db, user, {
        labelId: params.labelId,
        type: 'research.run',
        // Collapse double clicks; a new completed/failed run permits a new attempt.
        intent: ['research', params.courseVersionId, previous?.id ?? 'initial', String(body.force)],
        payload: { courseVersionId: params.courseVersionId },
        requestId: request.id,
        clientAddress: request.socket.remoteAddress,
      });

      return reply.status(created ? 202 : 200).send(summary);
    },
  );
};
