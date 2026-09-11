import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ServerEnv } from '@c360/config';
import { AppError } from '../errors/app-error.js';

/**
 * Transport-level protections.
 *
 * The API is a JSON service consumed by our own SPA; it deliberately does not
 * use cookies for authentication (identity arrives as proxy headers), which
 * removes the classic CSRF surface. An origin check is still applied to
 * state-changing requests as defence in depth, so that a future cookie or a
 * browser that attaches credentials automatically cannot be abused.
 */

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function registerSecurity(app: FastifyInstance, env: ServerEnv): Promise<void> {
  await app.register(helmet, {
    // The API serves JSON only; a restrictive CSP here costs nothing and stops
    // a stray HTML error page from executing anything.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    // HSTS is set by the TLS-terminating proxy in production; setting it from
    // the app over plain HTTP inside the network would be misleading.
    hsts: false,
  });

  const allowedOrigins = new Set(env.CORS_ALLOWED_ORIGINS);
  await app.register(cors, {
    // Deny-by-default: with no configured origins, cross-origin browser calls
    // are refused and only same-origin requests (which send no Origin) work.
    origin: (origin, callback) => {
      if (origin === undefined || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    maxAge: 600,
  });

  /*
   * Multipart, with the ceilings applied by the parser rather than after the
   * fact. An oversized body is cut off while it is still arriving, so a hostile
   * upload cannot make us buffer gigabytes in order to refuse them.
   *
   * `attachFieldsToBody` is deliberately off: the handler pulls the single file
   * part explicitly, so nothing is silently materialised.
   */
  await app.register(multipart, {
    limits: {
      fileSize: env.UPLOAD_MAX_BYTES,
      files: 1,
      fields: 0,
      // Long enough for a real filename, short enough that a header cannot be
      // used as a payload.
      fieldNameSize: 100,
      fieldSize: 1_000,
      parts: 4,
      headerPairs: 200,
    },
    // Refuse rather than truncate: a silently truncated file would be stored as
    // a valid-looking but corrupt document.
    throwFileSizeLimit: true,
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX_PER_MINUTE,
    timeWindow: '1 minute',
    /*
     * Keyed on the socket peer address, and only on that.
     *
     * This hook runs before authentication, so the authenticated subject is not
     * available here — an earlier version read it and silently fell back to the
     * address on every single request. Behind the Entra ID proxy that address is
     * the proxy's, which makes this a whole-deployment circuit breaker rather
     * than a fair-use control, and it is sized accordingly.
     *
     * Fair use per user and per label is enforced after authentication in
     * `fair-use.ts`, which is the only place the actor is known.
     */
    keyGenerator: (request: FastifyRequest) => request.socket.remoteAddress ?? 'unknown',
  });

  // Synchronous by design: it only inspects headers, so there is nothing to
  // await. Fastify accepts a sync hook that throws.
  app.addHook('onRequest', (request, _reply, done) => {
    if (!STATE_CHANGING_METHODS.has(request.method)) {
      done();
      return;
    }
    const origin = request.headers.origin;
    if (origin === undefined) {
      // Non-browser client (server-to-server, curl): no ambient credentials to
      // abuse, so there is nothing for an origin check to protect against.
      done();
      return;
    }
    if (typeof origin !== 'string' || !allowedOrigins.has(origin)) {
      done(AppError.forbidden('origin_not_allowed', { origin: String(origin) }));
      return;
    }
    done();
  });
}
