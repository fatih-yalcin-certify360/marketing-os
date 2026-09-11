import { createServer, type Server } from 'node:http';

/**
 * Liveness, readiness and metrics for the worker process.
 *
 * The worker has no HTTP surface of its own, which until now meant nothing
 * could tell a healthy worker from one wedged on a lost database connection —
 * its loops catch every error and keep polling, so the process stays alive and
 * silent while doing no work. A probe endpoint is the difference between an
 * orchestrator restarting it and a queue that quietly stops draining.
 *
 * Deliberately plain `node:http`: this serves three unauthenticated,
 * plain-text endpoints on a port that is not published outside the deployment
 * network, so a framework would add dependencies without adding anything.
 *
 * ## What is exposed
 *
 *  - `/health` — the process is up. Never touches the database, so a database
 *    outage does not cause a restart loop that cannot help.
 *  - `/ready` — the worker can actually do work: the pool reaches PostgreSQL.
 *  - `/metrics` — queue depth, in-flight count and the oldest queued age, in
 *    Prometheus text format. Operational counters only; no user content, no
 *    label names, no identifiers (requirement 13: no personal data in logs or
 *    telemetry by default).
 */

export interface WorkerHealthDeps {
  port: number;
  workerId: string;
  concurrency: number;
  /** Resolves when the database is reachable; rejects otherwise. */
  ping: () => Promise<void>;
  /** Queue counters, or undefined if they could not be read. */
  depth: () => Promise<{ queued: number; running: number; oldestQueuedAgeMs: number } | undefined>;
  inFlight: () => number;
  /** False once shutdown has begun, so the probe stops advertising readiness. */
  accepting: () => boolean;
  log: { warn: (fields: Record<string, unknown>, message: string) => void };
}

export interface WorkerHealthServer {
  close: () => Promise<void>;
}

const NOT_FOUND = 'not found\n';

export async function startWorkerHealthServer(
  deps: WorkerHealthDeps,
): Promise<WorkerHealthServer> {
  if (deps.port === 0) {
    return { close: () => Promise.resolve() };
  }

  const server = createServer((request, response) => {
    void handle(request.url ?? '/', deps).then(
      ({ status, body, contentType }) => {
        response.writeHead(status, {
          'content-type': contentType,
          'cache-control': 'no-store',
        });
        response.end(body);
      },
      (error: unknown) => {
        // Never leak internal detail, even on an internal port.
        deps.log.warn({ err: error }, 'health endpoint failed');
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('error\n');
      },
    );
  });

  // A stuck probe request must not keep the process alive during shutdown.
  server.unref();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Bound to all interfaces because the port is inside the deployment
    // network only; it is not published by the compose or ingress config.
    server.listen(deps.port, '0.0.0.0', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  return { close: () => closeServer(server) };
}

async function handle(
  url: string,
  deps: WorkerHealthDeps,
): Promise<{ status: number; body: string; contentType: string }> {
  const path = url.split('?')[0] ?? '/';
  const text = 'text/plain; charset=utf-8';

  if (path === '/health') {
    return { status: 200, body: 'ok\n', contentType: text };
  }

  if (path === '/ready') {
    if (!deps.accepting()) {
      // Draining: alive, but should receive no new work.
      return { status: 503, body: 'draining\n', contentType: text };
    }
    try {
      await deps.ping();
    } catch {
      return { status: 503, body: 'database unreachable\n', contentType: text };
    }
    return { status: 200, body: 'ready\n', contentType: text };
  }

  if (path === '/metrics') {
    return { status: 200, body: await metrics(deps), contentType: text };
  }

  return { status: 404, body: NOT_FOUND, contentType: text };
}

async function metrics(deps: WorkerHealthDeps): Promise<string> {
  const lines: string[] = [
    '# HELP c360_worker_in_flight_jobs Jobs this worker currently holds a lease on.',
    '# TYPE c360_worker_in_flight_jobs gauge',
    `c360_worker_in_flight_jobs ${String(deps.inFlight())}`,
    '# HELP c360_worker_concurrency Configured job slots for this worker.',
    '# TYPE c360_worker_concurrency gauge',
    `c360_worker_concurrency ${String(deps.concurrency)}`,
    '# HELP c360_worker_accepting Whether this worker is still claiming jobs.',
    '# TYPE c360_worker_accepting gauge',
    `c360_worker_accepting ${deps.accepting() ? '1' : '0'}`,
  ];

  const depth = await deps.depth().catch(() => undefined);
  if (depth !== undefined) {
    lines.push(
      '# HELP c360_jobs_queued Jobs waiting to be claimed, across all labels.',
      '# TYPE c360_jobs_queued gauge',
      `c360_jobs_queued ${String(depth.queued)}`,
      '# HELP c360_jobs_running Jobs currently being processed, across all workers.',
      '# TYPE c360_jobs_running gauge',
      `c360_jobs_running ${String(depth.running)}`,
      // The one number that actually tells an operator whether capacity is
      // sufficient: a queue that is deep but fast is fine, a queue whose oldest
      // item keeps ageing is not.
      '# HELP c360_jobs_oldest_queued_age_ms Age of the oldest unclaimed job.',
      '# TYPE c360_jobs_oldest_queued_age_ms gauge',
      `c360_jobs_oldest_queued_age_ms ${String(depth.oldestQueuedAgeMs)}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}
