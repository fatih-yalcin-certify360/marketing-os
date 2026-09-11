import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

/**
 * Development-only PostgreSQL over TCP, with no Docker required.
 *
 * PGlite is a real PostgreSQL build compiled to WebAssembly; this wraps it in
 * the PostgreSQL wire protocol so `pg`, `psql` and the API connect to it
 * exactly as they would to a server. It exists so a developer can run the whole
 * stack on a machine without Docker — requirement: a missing dependency must
 * not block independent local development.
 *
 * Several clients may connect (the API and the worker both need one), because
 * the socket server multiplexes them: each connection gets its own session, and
 * `QueryQueueManager` serialises the actual queries onto the single underlying
 * PGlite instance.
 *
 * It is NOT a substitute for the Docker Compose PostgreSQL:
 *   - queries execute one at a time, so genuine lock contention cannot occur.
 *     Guards are observable; races are not (see docs/product/testing-strategy.md);
 *   - extensions and server settings differ from a stock PostgreSQL 18.
 *
 * Use `docker compose up` for anything touching concurrency or performance.
 * This script refuses to run outside development.
 */

/**
 * 5433, not 5432, on purpose.
 *
 * A developer machine very often already has PostgreSQL on 5432 - a system
 * install, or the Docker Compose service from this same repository. Defaulting
 * to the standard port means `npm run dev:db` either fails to bind or, worse,
 * the application silently connects to the *other* database. Picking a
 * neighbouring port makes the Docker-free path unambiguous.
 */
const DEFAULT_PORT = 5433;
const DEFAULT_DATA_DIR = './var/dev-db';
/** Enough for the API pool, the worker pool and a `psql` session. */
const DEFAULT_MAX_CONNECTIONS = 12;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    process.stderr.write('[dev-db] refusing to run when NODE_ENV=production.\n');
    process.exit(1);
  }

  const port = Number.parseInt(process.env.DEV_DB_PORT ?? String(DEFAULT_PORT), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`[dev-db] invalid DEV_DB_PORT: ${String(process.env.DEV_DB_PORT)}\n`);
    process.exit(1);
  }

  // Persisted so that migrations and seed data survive a restart, the same way
  // the Docker volume does.
  const dataDir = path.resolve(process.env.DEV_DB_DATA_DIR ?? DEFAULT_DATA_DIR);
  await mkdir(dataDir, { recursive: true });

  const maxConnections = Number.parseInt(
    process.env.DEV_DB_MAX_CONNECTIONS ?? String(DEFAULT_MAX_CONNECTIONS),
    10,
  );
  if (!Number.isInteger(maxConnections) || maxConnections < 1) {
    process.stderr.write(
      `[dev-db] invalid DEV_DB_MAX_CONNECTIONS: ${String(process.env.DEV_DB_MAX_CONNECTIONS)}\n`,
    );
    process.exit(1);
  }

  const db = await PGlite.create({ dataDir });
  const server = new PGLiteSocketServer({
    db,
    port,
    // Loopback only. Binding this to a routable address would expose an
    // unauthenticated database to the network.
    host: '127.0.0.1',
    // Without this the default is 1, and the worker cannot connect while the
    // API holds a connection.
    maxConnections,
  });

  await server.start();
  process.stdout.write(
    `[dev-db] PostgreSQL (PGlite) listening on 127.0.0.1:${String(port)}\n` +
      `[dev-db] data directory: ${dataDir}\n` +
      `[dev-db] max connections: ${String(maxConnections)} (queries are serialised)\n` +
      '[dev-db] Development only. Use Docker Compose for concurrency or performance work.\n',
  );

  const shutdown = async (): Promise<void> => {
    process.stdout.write('\n[dev-db] stopping\n');
    await server.stop();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `[dev-db] fatal: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
