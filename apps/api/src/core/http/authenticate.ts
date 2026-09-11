import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CurrentUser } from '@c360/contracts';
import { AppError } from '../errors/app-error.js';

/**
 * Resolves the caller's identity.
 *
 * Registered as an `onRequest` hook on the authenticated scope (`/api/v1`), so
 * a new route inside that scope is protected by construction rather than by
 * remembering a guard. `/health` and `/ready` sit outside the scope and are the
 * only unauthenticated routes.
 *
 * It runs in `onRequest` specifically so that the `preHandler` fair-use limiter
 * knows *who* is asking; keyed on the socket address it would count a hundred
 * users behind one reverse proxy as a single caller.
 *
 * Routes still declare `preHandler: authenticate` for local readability. That
 * is a no-op once the hook has resolved the user, so it costs no second query.
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (request.authenticatedUser !== undefined) {
    return;
  }

  const { authAdapter, db, services } = request.server.appContext;

  const subject = authAdapter.authenticate({
    headers: request.headers,
    // The socket peer address only. `request.ip` would honour X-Forwarded-For
    // when trustProxy is enabled, which must never feed the trust decision.
    remoteAddress: request.socket.remoteAddress,
  });

  request.authenticatedUser = await services.identity.resolveCurrentUser(db, subject);
}

/** Accessor that fails loudly if used on a route without the auth pre-handler. */
export function currentUser(request: FastifyRequest): CurrentUser {
  const user = request.authenticatedUser;
  if (user === undefined) {
    throw new AppError('internal_error', {
      internalDetail: 'currentUser() called on a route without the authenticate pre-handler',
    });
  }
  return user;
}
