import { defineConfig } from 'tsup';

/**
 * The API is bundled into a single ESM file. This keeps the production image
 * free of workspace symlinks and dev dependencies, and means the container can
 * run `node dist/index.js` with only the runtime deps that esbuild could not
 * inline (native/optional ones listed in `external`).
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // The migration runner ships as its own entrypoint so the Compose/deploy
    // migrate step runs the same reviewed code as the API, from the same image,
    // without needing tsx or the workspace present at runtime.
    migrate: 'src/core/db/cli/migrate.ts',
    seed: 'src/core/db/cli/seed.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  // pg loads optional native accelerators at runtime; keep it external so the
  // bundle does not try to resolve them.
  external: ['playwright', 'playwright-core', 'pg-native', '@electric-sql/pglite'],
  banner: {
    js: "import { createRequire as __c360_cr } from 'node:module'; const require = __c360_cr(import.meta.url);",
  },
});
