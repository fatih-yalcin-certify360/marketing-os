import { defineConfig } from 'tsup';

/**
 * Packages the bundler cannot inline.
 *
 * `@resvg/resvg-js` and `sharp` load compiled `.node` binaries; `pg-native` is
 * an optional native driver; PGlite and Playwright are test-and-tooling only.
 * Everything else is bundled, so the runtime image needs a `node_modules` for
 * these and nothing more.
 */
const NATIVE = [
  '@resvg/resvg-js',
  'sharp',
  'pg-native',
  '@electric-sql/pglite',
  'playwright',
  'playwright-core',
];

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
  /*
   * Everything is bundled except what cannot be.
   *
   * tsup leaves every `dependencies` entry external by default, which made the
   * runtime image — which ships `dist/` and no `node_modules` — unable to start
   * at all: `Cannot find package '@c360/config'`. Nobody saw it because CI
   * builds the image and checks its user, but never runs it (2026-09-17).
   *
   * The exceptions are genuinely unbundlable: `@resvg/resvg-js` and `sharp`
   * load compiled `.node` binaries, `pg-native` is an optional native driver,
   * and PGlite and Playwright are test-and-tooling only. Those are the packages
   * the image has to carry.
   */
  external: NATIVE,
  /*
   * Bundle everything that is not on that list.
   *
   * Written as one negative-lookahead pattern rather than a catch-all regex
   * plus `external`, because tsup applies `noExternal` first: a catch-all there
   * pulls the native packages back in and the build dies trying to read a
   * `.node` binary for another platform.
   */
  noExternal: [new RegExp(`^(?!(?:${NATIVE.join('|').replaceAll('/', '\\/')})(?:\\/|$))`)],
  banner: {
    js: "import { createRequire as __c360_cr } from 'node:module'; const require = __c360_cr(import.meta.url);",
  },
});
