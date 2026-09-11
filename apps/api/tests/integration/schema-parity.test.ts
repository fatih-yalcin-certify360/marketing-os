import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { schema } from '../../src/core/db/schema.js';
import { loadMigrations, runMigrations } from '../../src/core/db/migrate.js';
import { createTestHarness, type TestHarness } from '../../src/testing/harness.js';

/**
 * Schema parity.
 *
 * The SQL migrations are authoritative and the Drizzle definitions are a typed
 * mirror (ADR-0005). Nothing stops the two drifting except this test: it
 * applies the real migrations to a real PostgreSQL and then asserts that every
 * table and column the TypeScript layer believes in actually exists.
 *
 * Without it, a column renamed in SQL but not in TypeScript would typecheck
 * cleanly and fail only at runtime, in production.
 */
describe('schema parity between SQL migrations and Drizzle definitions', () => {
  let harness: TestHarness;
  let actual: Map<string, Set<string>>;

  beforeAll(async () => {
    harness = await createTestHarness({ seed: false });
    const rows = await harness.pglite.executor.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'`,
    );
    actual = new Map();
    for (const row of rows) {
      const columns = actual.get(row.table_name) ?? new Set<string>();
      columns.add(row.column_name);
      actual.set(row.table_name, columns);
    }
  });

  afterAll(async () => {
    await harness.close();
  });

  it('creates every table declared in TypeScript', () => {
    for (const table of Object.values(schema)) {
      expect(actual.has(getTableName(table))).toBe(true);
    }
  });

  it('creates every column declared in TypeScript', () => {
    const missing: string[] = [];
    for (const table of Object.values(schema)) {
      const tableName = getTableName(table);
      const columns = actual.get(tableName);
      for (const column of Object.values(getTableColumns(table))) {
        const columnName: string = column.name;
        if (columns?.has(columnName) !== true) {
          missing.push(`${tableName}.${columnName}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('records the migration ledger', async () => {
    const files = await loadMigrations();
    const applied = await harness.pglite.executor.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(applied.map((row) => row.version)).toEqual(files.map((file) => file.version));
  });

  it('is idempotent when run twice', async () => {
    const second = await runMigrations(harness.pglite.executor, { useAdvisoryLock: false });
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied.length).toBeGreaterThan(0);
  });

  it('refuses a migration whose recorded checksum no longer matches', async () => {
    // Editing a released migration is a change-control failure, so it must
    // abort loudly rather than leave environments on divergent schema.
    await harness.pglite.executor.query(
      "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = (SELECT MIN(version) FROM schema_migrations)",
    );
    await expect(
      runMigrations(harness.pglite.executor, { useAdvisoryLock: false }),
    ).rejects.toThrow(/contents changed/u);
  });
});
