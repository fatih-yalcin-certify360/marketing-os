import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  external: ['playwright', 'playwright-core', 'pg-native', '@electric-sql/pglite'],
  banner: {
    js: "import { createRequire as __c360_cr } from 'node:module'; const require = __c360_cr(import.meta.url);",
  },
});
