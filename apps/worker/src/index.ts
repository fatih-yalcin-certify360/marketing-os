import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { EnvValidationError, loadServerEnv } from '@c360/config';
import { createDatabase } from '@c360/api/db';
import { AuditService } from '@c360/api/audit';
import { BudgetService, JobQueue } from '@c360/api/jobs';
import { createAppContext } from '@c360/api/server';
import { createHandlerRegistry } from './handlers/index.js';
import { startWorkerHealthServer } from './health.js';
import { JobRunner } from './runner.js';

/**
 * Worker process.
 *
 * Polls rather than listens: at this scale a 1-second poll on a partial index
 * costs almost nothing, and it avoids a second connection mode (LISTEN/NOTIFY)
 * that would need its own reconnection handling. If queue latency ever matters,
 * adding NOTIFY is a local change to the claim path.
 */
async function main(): Promise<void> {
  let env;
  try {
    env = loadServerEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      process.stderr.write(`\n[worker] refusing to start.\n${error.message}\n\n`);
      process.exit(1);
    }
    throw error;
  }

  const log = pino({
    level: env.LOG_LEVEL,
    base: { component: 'worker' },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : {}),
  });

  const workerId = `${hostname()}-${randomUUID().slice(0, 8)}`;
  const database = createDatabase(env);

  /**
   * The worker builds the same service graph as the API and uses the same
   * modules, so a stage behaves identically wherever it runs. It does not build
   * an HTTP server, and it holds no request context — a job re-resolves its
   * actor and the services re-check authorisation (ADR-0016).
   */
  const context = createAppContext({ env, db: database.db });

  const runner = new JobRunner({
    db: database.db,
    handlers: createHandlerRegistry({
      generation: {
        identity: context.services.identity,
        courses: context.services.courses,
        research: context.services.research,
        radar: context.services.radar,
        geo: context.services.geo,
        campaignPackages: context.services.campaignPackages,
        personas: context.services.personas,
        opportunities: context.services.opportunities,
        campaigns: context.services.campaigns,
        concepts: context.services.concepts,
        content: context.services.content,
      },
    }),
    audit: new AuditService(env.AUTH_PROXY_SHARED_SECRET),
    budget: new BudgetService(env.AI_DEFAULT_LABEL_BUDGET_CENTS),
    workerId,
    heartbeatIntervalMs: Math.max(1_000, Math.floor(env.WORKER_HEARTBEAT_TIMEOUT_MS / 3)),
    maxJobsPerLabel: env.WORKER_MAX_JOBS_PER_LABEL,
    log,
  });

  let running = true;

  /**
   * Two-stage shutdown.
   *
   * Stage one stops claiming and lets the in-flight jobs finish, which is the
   * normal case and loses nothing. Stage two exists because an orchestrator
   * will not wait forever: when the grace period runs out we hand the jobs we
   * still hold back to the queue so another replica resumes them on its next
   * poll, instead of leaving them `running` until the heartbeat reaper notices
   * minutes later.
   *
   * The grace period is deliberately shorter than the container's own
   * termination timeout — releasing is only useful if we are still alive to do
   * it. See docs/architecture/load-assumptions.md.
   */
  const shutdown = (signal: string): void => {
    if (!running) {
      return;
    }
    running = false;
    log.info(
      { signal, inFlight: runner.inFlightCount(), graceMs: env.WORKER_SHUTDOWN_GRACE_MS },
      'draining before shutdown',
    );

    const deadline = setTimeout(() => {
      void (async () => {
        const released = await runner.releaseInFlight();
        log.warn({ released }, 'shutdown grace expired; jobs returned to the queue');
        await database.close();
        process.exit(0);
      })();
    }, env.WORKER_SHUTDOWN_GRACE_MS);
    deadline.unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  log.info(
    {
      workerId,
      concurrency: env.WORKER_CONCURRENCY,
      maxJobsPerLabel: env.WORKER_MAX_JOBS_PER_LABEL,
      aiProvider: env.AI_PROVIDER,
      textModel: env.AI_TEXT_MODEL,
      imageGeneration: env.AI_IMAGE_ENABLED,
    },
    'worker started',
  );

  // One independent loop per concurrency slot. Each claims its own job, so
  // slots never contend for the same row.
  const loops = Array.from({ length: env.WORKER_CONCURRENCY }, async () => {
    while (running) {
      try {
        const outcome = await runner.processOne();
        if (outcome === 'idle') {
          await delay(env.WORKER_POLL_INTERVAL_MS);
        }
      } catch (error: unknown) {
        // A loop must never die: an unexpected error here (a dropped
        // connection, for example) would otherwise silently reduce capacity.
        log.error({ err: error }, 'worker loop error');
        await delay(Math.max(1_000, env.WORKER_POLL_INTERVAL_MS));
      }
    }
  });

  const queue = new JobQueue();
  const health = await startWorkerHealthServer({
    port: env.WORKER_HEALTH_PORT,
    workerId,
    concurrency: env.WORKER_CONCURRENCY,
    ping: async () => {
      await database.db.execute('SELECT 1');
    },
    depth: () => queue.depth(database.db),
    inFlight: () => runner.inFlightCount(),
    accepting: () => running,
    log,
  });
  if (env.WORKER_HEALTH_PORT > 0) {
    log.info({ port: env.WORKER_HEALTH_PORT }, 'worker probes listening');
  }

  const reaperInterval = setInterval(() => {
    void runner.reap(env.WORKER_HEARTBEAT_TIMEOUT_MS).catch((error: unknown) => {
      log.error({ err: error }, 'reaper failed');
    });
  }, env.WORKER_HEARTBEAT_TIMEOUT_MS);
  reaperInterval.unref();

  await Promise.all(loops);
  clearInterval(reaperInterval);
  await health.close();
  log.info({ inFlight: runner.inFlightCount() }, 'worker stopped cleanly');
  await database.close();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`[worker] fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
