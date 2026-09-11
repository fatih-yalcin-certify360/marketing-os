import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { learningInput } from '@c360/contracts';
import { authenticate, currentUser } from '../../core/http/authenticate.js';

const labelParams = z.object({ labelId: z.uuid() });
const learningParams = labelParams.extend({ learningId: z.uuid() });

/**
 * Learnings (P4-2).
 *
 * A learning is created as a **draft**: nothing a person has just typed should
 * influence the next proposal before someone else has read it. Approving one
 * changes exactly one row — its own review state — and there is deliberately no
 * route here that edits a persona or a brand rule, because an approved learning
 * is context for a later proposal rather than an instruction to rewrite stored
 * work.
 */
export const learningRoutes: FastifyPluginAsync = async (app) => {
  const { db, services } = app.appContext;

  app.get('/labels/:labelId/learnings', { preHandler: authenticate }, async (request) => {
    const { labelId } = labelParams.parse(request.params);
    const items = await services.learnings.list(db, currentUser(request), labelId);
    return { items, nextCursor: null };
  });

  app.post(
    '/labels/:labelId/learnings',
    { preHandler: authenticate },
    async (request, reply) => {
      const { labelId } = labelParams.parse(request.params);
      const body = learningInput.parse(request.body);
      const created = await services.learnings.create(db, currentUser(request), labelId, body);
      return reply.status(201).send(created);
    },
  );

  app.post(
    '/labels/:labelId/learnings/:learningId/approve',
    { preHandler: authenticate },
    async (request) => {
      const { labelId, learningId } = learningParams.parse(request.params);
      return services.learnings.approve(db, currentUser(request), labelId, learningId);
    },
  );
};
