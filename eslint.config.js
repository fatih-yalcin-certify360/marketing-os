import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Lint configuration.
 *
 * Beyond ordinary hygiene, three rule groups are load-bearing:
 *
 *  - `no-restricted-imports` enforces the architectural boundaries that
 *    requirement 3 asks for: the browser bundle cannot import server code, and
 *    the API cannot import the worker (the dependency runs the other way).
 *  - the type-aware `no-floating-promises` / `no-misused-promises` rules catch
 *    unawaited database and queue calls, which in this codebase would mean a
 *    transaction that silently does not commit.
 *  - `no-console` keeps output going through the structured logger, so a stray
 *    debug line cannot print a prompt or a token.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      // Generated at runtime: uploads, rendered images, exports, dev database.
      'var/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Root-level tooling files belong to no app or package tsconfig.
          // `tsconfig.tools.json` gives them strict type information so the
          // type-aware rules work there too instead of erroring out.
          allowDefaultProject: ['*.js', '*.ts'],
          defaultProject: 'tsconfig.tools.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Unused args are fine when prefixed with _, which keeps interface
      // implementations readable.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: false, allowBoolean: false },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
      'prefer-const': 'error',
      'no-param-reassign': 'error',
    },
  },

  // ---- Server-side processes -------------------------------------------
  {
    files: ['apps/api/**/*.ts', 'apps/worker/**/*.ts', 'packages/config/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@c360/ui', '@c360/ui/*'],
              message: 'Server code must not import browser UI components.',
            },
          ],
        },
      ],
    },
  },

  // The API must not depend on the worker: the worker imports the monolith's
  // modules, never the reverse (ADR-0001).
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@c360/worker', '@c360/worker/*'],
              message:
                'The API must not import the worker. Dependency direction is worker -> api.',
            },
            {
              group: ['@c360/ui', '@c360/ui/*'],
              message: 'Server code must not import browser UI components.',
            },
          ],
        },
      ],
    },
  },

  // ---- Browser bundle --------------------------------------------------
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx', 'packages/ui/**/*.ts', 'packages/ui/**/*.tsx'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The hard boundary from requirement 3: no secret, no database handle and
      // no server-only module may ever reach the browser bundle.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@c360/api',
                '@c360/api/*',
                '@c360/worker',
                '@c360/worker/*',
                '@c360/config',
                '@c360/config/*',
                'pg',
                'drizzle-orm',
                'drizzle-orm/*',
                'fastify',
                'node:*',
              ],
              message:
                'Browser code must not import server modules, database drivers or Node built-ins.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'Use import.meta.env in browser code.' },
      ],
    },
  },

  // ---- Tests -----------------------------------------------------------
  {
    files: ['**/tests/**/*.ts', '**/*.test.ts', '**/testing/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Tests deliberately assert on values the harness guarantees are present.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      'no-restricted-imports': 'off',
    },
  },

  // ---- Build tooling ---------------------------------------------------
  {
    files: ['**/*.config.ts', '**/*.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'no-restricted-imports': 'off',
      // Build tooling runs in Node, not in the browser.
      'no-restricted-globals': 'off',
    },
  },

  // The CLI scripts are the one place that writes directly to stdout/stderr:
  // they run before (or instead of) the logger existing.
  {
    files: ['apps/api/src/core/db/cli/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // Fastify's `FastifyPluginAsync` contract requires a promise-returning
  // function. A route plugin that only registers handlers has nothing to
  // await, so `require-await` is a false positive here specifically.
  //
  // The glob matches any `*routes.ts`, not only `routes.ts`: the exemption
  // follows from the Fastify type, not from a filename, and a module large
  // enough to split its routes across two files was silently outside it.
  {
    files: ['apps/api/src/modules/**/*routes.ts'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
);
