import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticate, currentUser } from '../../core/http/authenticate.js';

const labelParams = z.object({ labelId: z.uuid() });

/**
 * "A source changed — what does that touch?" (P4-3)
 *
 * A read, and only a read. There is deliberately no action here: what to do
 * about a changed source depends on what changed, and a "fix it" button would
 * invite not reading. Campaigns with nothing stale behind them are left out
 * entirely, because a report listing everything as fine is a report nobody
 * opens twice.
 */
export const sourceImpactRoutes: FastifyPluginAsync = async (app) => {
  const { db, services } = app.appContext;

  app.get('/labels/:labelId/source-impact', { preHandler: authenticate }, async (request) => {
    const { labelId } = labelParams.parse(request.params);
    return services.sourceImpact.report(db, currentUser(request), labelId);
  });
};
