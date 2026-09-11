import type { FastifyPluginAsync } from 'fastify';
import { authenticate, currentUser } from '../../core/http/authenticate.js';

/**
 * `GET /api/v1/me` — the only endpoint that reports identity and access.
 *
 * The response includes `authMode` so the interface can state unmistakably
 * when a local development identity is in use, rather than looking like a real
 * sign-in.
 */
export const identityRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me', { preHandler: authenticate }, async (request) => {
    const user = currentUser(request);
    return {
      userId: user.userId,
      organizationId: user.organizationId,
      organizationName: user.organizationName,
      displayName: user.displayName,
      email: user.email,
      orgRole: user.orgRole,
      memberships: user.memberships,
      authMode: user.authMode,
      orgPermissions: user.orgPermissions,
    };
  });
};
