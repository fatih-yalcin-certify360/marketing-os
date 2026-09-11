import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { effectiveLabelPermissions } from '../../core/authz/policy.js';
import { authenticate, currentUser } from '../../core/http/authenticate.js';

const labelParams = z.object({ labelId: z.uuid() });

export const labelRoutes: FastifyPluginAsync = async (app) => {
  const { db, services } = app.appContext;

  app.get('/labels', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const items = await services.labels.listAccessible(db, user);
    return { items, nextCursor: null };
  });

  app.get('/labels/:labelId', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    const label = await services.labels.requireAccessible(db, user, labelId);
    // Permissions are sent so the UI can hide actions it may not perform.
    // They are advisory for rendering only — every route re-checks server-side.
    return { label, permissions: effectiveLabelPermissions(user, labelId) };
  });

  app.get('/labels/:labelId/workspace', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    return services.workspace.overview(db, user, labelId);
  });

  app.get('/labels/:labelId/budget', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    const { labelId } = labelParams.parse(request.params);
    return services.jobs.budgetForLabel(db, user, labelId);
  });
};
