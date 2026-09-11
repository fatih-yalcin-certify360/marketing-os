import { defineConfig } from 'vitest/config';

/**
 * One suite for the whole workspace.
 *
 * Integration tests boot a real PostgreSQL (PGlite) per file, which is why the
 * timeout is generous and files run in separate forks: each gets its own
 * database, so suites cannot leak state into one another.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: [
      'apps/*/tests/**/*.test.ts',
      'packages/*/tests/**/*.test.ts',
      // Development tooling is typechecked and linted like everything else, so
      // the parts of it that encode policy get tested like everything else too.
      'tools/*/tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/web/tests/e2e/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/testing/**', '**/cli/**'],
    },
  },
});
