import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { ServerEnv } from '@c360/config';
import { schema } from './schema.js';
import type { Db } from './types.js';

export interface DatabaseHandle {
  db: Db;
  pool: Pool;
  close(): Promise<void>;
}

/**
 * Creates the connection pool.
 *
 * A statement timeout is set on every connection so a pathological query
 * cannot pin a pool slot indefinitely — the cheapest available protection
 * against accidental self-inflicted denial of service.
 */
export function createDatabase(env: ServerEnv): DatabaseHandle {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
    query_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
    // Fail fast rather than queueing forever when the database is unreachable.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: 'c360-marketing-os',
  });

  // A pool-level error handler is mandatory: without one, a backend
  // termination raises an unhandled 'error' event and takes the process down.
  pool.on('error', (error: Error) => {
    process.stderr.write(`[db] idle client error: ${error.message}\n`);
  });

  const db = drizzle(pool, { schema, casing: 'snake_case' });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}
