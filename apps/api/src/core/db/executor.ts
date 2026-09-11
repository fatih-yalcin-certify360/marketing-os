/**
 * Minimal SQL surface shared by node-postgres and PGlite.
 *
 * The migration runner and the queue's `SKIP LOCKED` claim statement are
 * written against this interface instead of a driver type, so the exact same
 * SQL executes in development, production and integration tests.
 */
export interface SqlExecutor {
  /** Runs a multi-statement script. No parameters — never build one from input. */
  exec(script: string): Promise<void>;
  /** Runs a single parameterised statement. The only path that accepts input. */
  query<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

interface PgLikePool {
  query(config: { text: string; values?: readonly unknown[] }): Promise<{ rows: unknown[] }>;
}

/** Adapts a node-postgres `Pool` or `Client`. */
export function pgExecutor(pool: PgLikePool): SqlExecutor {
  return {
    async exec(script) {
      await pool.query({ text: script });
    },
    async query<T extends Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<T[]> {
      const result = await pool.query({ text: sql, values: params });
      return result.rows as T[];
    },
  };
}
