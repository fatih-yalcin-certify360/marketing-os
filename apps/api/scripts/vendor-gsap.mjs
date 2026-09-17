import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Puts the animation engine next to the bundle.
 *
 * The production image ships `dist/` and nothing else — no `node_modules`, by
 * design. So code that reads a dependency's file at run time works in
 * development and throws in production, which is exactly what happened: banner
 * generation resolved `gsap/dist/gsap.min.js` through `createRequire` and would
 * have failed on the first request in a container (2026-09-17).
 *
 * Copying at build time keeps one source of truth — the pinned `gsap`
 * dependency — while making the bundle self-sufficient. The alternative,
 * committing the library into the repository, would mean the version in the
 * lockfile and the version we ship could drift apart without anybody noticing.
 *
 * The files keep their `/*!` licence notices, which the GSAP licence requires
 * and `gsap-runtime.ts` verifies on read.
 */

const FILES = ['gsap.min.js', 'SplitText.min.js'];

const require_ = createRequire(import.meta.url);
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'vendor');

await mkdir(outDir, { recursive: true });
for (const file of FILES) {
  await copyFile(require_.resolve(`gsap/dist/${file}`), join(outDir, file));
}

process.stdout.write(`vendored ${String(FILES.length)} GSAP file(s) into dist/vendor\n`);
