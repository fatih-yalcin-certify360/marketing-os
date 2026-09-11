import { PGlite } from '@electric-sql/pglite';

/**
 * In-process PostgreSQL for integration tests (ADR-0010).
 *
 * PGlite is an actual PostgreSQL build compiled to WebAssembly, so constraints,
 * partial indexes, `ON CONFLICT`, `FOR UPDATE SKIP LOCKED` and transaction
 * semantics behave as they do in the deployed database. That is what makes it
 * usable for the tests that matter here: cross-label denial, idempotency and
 * budget behaviour under concurrency.
 *
 * Known limits, which is why it complements rather than replaces the real
 * database:
 *  - it is single-connection, so genuinely parallel client sessions are
 *    simulated rather than real;
 *  - extensions and some server settings differ.
 *
 * Set `TEST_DATABASE_URL` to run the same suites against a real PostgreSQL
 * before a release; see docs/product/testing-strategy.md.
 */

/** Structurally compatible with the API's `SqlExecutor`. */
export interface TestSqlExecutor {
  exec(script: string): Promise<void>;
  query<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface PgliteHandle {
  client: PGlite;
  executor: TestSqlExecutor;
  close(): Promise<void>;
}

export async function createPgliteDatabase(): Promise<PgliteHandle> {
  const client = await PGlite.create();

  const executor: TestSqlExecutor = {
    async exec(script) {
      await client.exec(script);
    },
    async query<T extends Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<T[]> {
      const result = await client.query<T>(sql, [...params]);
      return result.rows;
    },
  };

  return {
    client,
    executor,
    close: async () => {
      await client.close();
    },
  };
}
