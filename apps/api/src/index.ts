import { EnvValidationError, loadServerEnv, type ServerEnv } from '@c360/config';
import { createDatabase } from './core/db/pool.js';
import { buildServer } from './server.js';

/**
 * Process entrypoint.
 *
 * Boot order is deliberate: environment is validated *before* anything is
 * constructed, so a configuration that would allow a development identity in
 * production fails immediately and visibly rather than serving traffic.
 */

/** Hard ceiling on how long draining may take before the process exits. */
const SHUTDOWN_GRACE_MS = 20_000;

/**
 * A quarantined file older than this was abandoned.
 *
 * The normal path removes a file the moment it is promoted or refused, so
 * anything still here has survived a crash between receiving and judging it.
 * An hour is far longer than any single upload takes.
 */
const QUARANTINE_MAX_AGE_MS = 60 * 60_000;
const QUARANTINE_SWEEP_INTERVAL_MS = 15 * 60_000;

async function main(): Promise<void> {
  let env;
  try {
    env = loadServerEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      process.stderr.write(`\n[api] refusing to start.\n${error.message}\n\n`);
      process.exit(1);
    }
    throw error;
  }

  const database = createDatabase(env);
  const app = await buildServer({ env, db: database.db });

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    // Fails readiness first, so the load balancer stops sending new requests
    // while the in-flight ones are still being finished.
    app.appContext.draining = true;
    app.log.info({ signal }, 'shutting down');

    // A single hung request must not stop the process from exiting; the
    // orchestrator would SIGKILL it anyway, and doing it ourselves keeps the
    // log honest about what happened.
    const deadline = setTimeout(() => {
      app.log.warn({ graceMs: SHUTDOWN_GRACE_MS }, 'shutdown grace expired; exiting anyway');
      process.exit(0);
    }, SHUTDOWN_GRACE_MS);
    deadline.unref();

    try {
      await app.close();
      await database.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  /*
   * Temporary-file cleanup (requirement 13).
   *
   * Once at startup, because that is exactly when leftovers from a crash are
   * present, and then on a timer. `unref` so it never holds the process open
   * during shutdown, and failures are logged rather than fatal: an
   * unsweepable directory is an operational problem, not a reason to refuse
   * traffic.
   */
  const sweep = (): void => {
    void app.appContext.services.uploads
      .sweepQuarantine(QUARANTINE_MAX_AGE_MS)
      .then((removed) => {
        if (removed > 0) {
          app.log.warn({ removed }, 'removed abandoned quarantined files');
        }
      })
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'quarantine sweep failed');
      });
  };
  sweep();
  const sweepTimer = setInterval(sweep, QUARANTINE_SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  app.log.info(
    {
      authMode: env.AUTH_MODE,
      aiProvider: env.AI_PROVIDER,
      /*
       * Where model calls actually go.
       *
       * `aiProvider` names a setting; this names the host that will receive the
       * text, the images and the web-search tool calls. Worth one line at boot,
       * because "everything runs through our own gateway" is a claim somebody
       * will make in a review and should be able to check without reading the
       * adapter (2026-09-16). No key, only the host.
       */
      aiEndpoint: aiEndpointHost(env),
      aiTextModel: env.AI_TEXT_MODEL,
      aiImages: env.AI_IMAGE_ENABLED ? env.AI_IMAGE_MODEL : 'disabled',
      aiMaxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
      nodeEnv: env.NODE_ENV,
      // Named at boot so a worker that logs a different root is visible
      // before the first job dies on a file the other process stored.
      storageRoot: env.STORAGE_ROOT,
    },
    'api listening',
  );

  if (env.AUTH_MODE === 'local') {
    app.log.warn(
      'AUTH_MODE=local — using the local development test identity. Never use this outside development.',
    );
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`[api] fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});

/**
 * The host every model call is sent to, without the key.
 *
 * One function rather than an inline expression, so the answer to "does
 * anything still leave for a model vendor directly?" is a single readable
 * place. A gateway URL that is not https in production is already refused by
 * the environment guard, so this only has to report.
 */
function aiEndpointHost(env: ServerEnv): string {
  if (env.AI_PROVIDER === 'mock') return 'mock (no network)';
  if (env.AI_PROVIDER === 'litellm') {
    return env.LITELLM_BASE_URL === undefined
      ? 'litellm (unconfigured)'
      : new URL(env.LITELLM_BASE_URL).host;
  }
  return env.AI_PROVIDER === 'openai' ? 'api.openai.com' : 'api.anthropic.com';
}
