import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { labelRole } from '@c360/contracts';
import { authenticate, currentUser } from '../../core/http/authenticate.js';

/**
 * Label membership administration.
 *
 * The split between what needs a label membership and what needs an
 * organisation role is the whole design, so it is visible in the routes:
 *
 *  - reading a label's members needs `member:read` **within that label**, so a
 *    manager sees their own team;
 *  - listing who *could* be added, and changing anything, needs
 *    `member:manage`, which only an organisation role grants.
 *
 * A label manager can therefore see who works on their label and cannot widen
 * it. Without that split, a manager could grant themselves a second label and
 * the label boundary would be self-serve.
 */

const labelParams = z.object({ labelId: z.uuid() });
const memberParams = labelParams.extend({ userId: z.uuid() });

export const memberRoutes: FastifyPluginAsync = async (app) => {
  const { db, services } = app.appContext;

  app.get('/labels/:labelId/members', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    const items = await services.members.listForLabel(db, user, labelId);
    return { items, nextCursor: null };
  });

  /** People in the organisation who are not yet on this label. */
  app.get(
    '/labels/:labelId/members/candidates',
    { preHandler: authenticate },
    async (request) => {
      const user = currentUser(request);
      const { labelId } = labelParams.parse(request.params);
      const items = await services.members.listCandidates(db, user, labelId);
      return { items, nextCursor: null };
    },
  );

  /**
   * Grants or changes a role.
   *
   * One route for both, and idempotent: the outcome depends on the target
   * state, not on whether a row already existed, so a repeated click is
   * harmless. `PATCH` rather than `PUT` because the CORS allow-list already
   * permits it — widening a security control for a verb preference is the
   * wrong trade, and changing the role of a membership is a partial update
   * either way.
   */
  app.patch('/labels/:labelId/members/:userId', { preHandler: authenticate }, async (request) => {
    const actor = currentUser(request);
    const { labelId, userId } = memberParams.parse(request.params);
    const body = z.object({ role: labelRole }).parse(request.body);

    return services.members.setRole(db, actor, {
      labelId,
      userId,
      role: body.role,
      requestId: request.id,
      clientAddress: request.socket.remoteAddress,
    });
  });

  app.delete('/labels/:labelId/members/:userId', { preHandler: authenticate }, async (request) => {
    const actor = currentUser(request);
    const { labelId, userId } = memberParams.parse(request.params);

    return services.members.revoke(db, actor, {
      labelId,
      userId,
      requestId: request.id,
      clientAddress: request.socket.remoteAddress,
    });
  });
};
