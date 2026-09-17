import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The animation engine that travels inside a banner.
 *
 * Read from the pinned `gsap` dependency rather than fetched at build time or
 * referenced from a CDN. Three reasons, in order of weight. A banner has to be
 * self-contained: the file runs inside someone else's page, and a network
 * reference is one more thing that can be blocked, be slow, or change under us.
 * Google's own allowlist contradicts itself about which GreenSock files may be
 * referenced externally — its specification page names GSAP 1.18/1.19-era files
 * and its error page says only Google Fonts and jQuery are allowed — and a file
 * inside the package sidesteps that argument entirely. And the licence lets us
 * keep using the version we shipped even if the terms change later, which is
 * only worth anything if we know exactly which version that was.
 *
 * The licence is the standard "no charge" GSAP License of 30 April 2025. It
 * grants the right to "use, reproduce, display, and implement" the product,
 * which is what embedding it here does, and it asks for no attribution. Its one
 * restriction that touches us is that proprietary notices may not be removed —
 * so the banner comment at the top of the file is checked on read and the build
 * fails without it, rather than being quietly dropped by a minifier one day.
 */

const require_ = createRequire(import.meta.url);

/** The notice the licence requires us to keep. */
const NOTICE = /\/\*!\s*\n?\s*\*\s*(?:GSAP|SplitText)\s+(\d+\.\d+\.\d+)/u;

interface Runtime {
  source: string;
  version: string;
  bytes: number;
}
let cached: Runtime | null = null;
let cachedSplit: Runtime | null = null;

export class GsapNoticeMissingError extends Error {
  constructor(path: string) {
    super(
      `The GSAP build at ${path} carries no /*! notice. The standard licence forbids ` +
        'removing proprietary notices, so a banner may not be built from it.',
    );
    this.name = 'GsapNoticeMissingError';
  }
}

/**
 * The minified engine, with its notice intact.
 *
 * Cached for the life of the process: it is a file on disk that cannot change
 * without a deploy, and every banner in a set embeds the same bytes.
 */
export function gsapRuntime(): Runtime {
  cached ??= read('gsap.min.js');
  return cached;
}

/**
 * The per-word splitter, which is what separates a banner that was made from a
 * banner that was filled in.
 *
 * Used to be a paid plugin; free for commercial use since the licence changed
 * on 30 April 2025, under the same terms and the same one obligation. Costs
 * 3,658 bytes gzipped, against a budget measured in tens of kilobytes.
 */
export function splitTextRuntime(): Runtime {
  cachedSplit ??= read('SplitText.min.js');
  return cachedSplit;
}

/**
 * Where the engine can be found, in the order worth trying.
 *
 * Beside the bundle first, because that is production: the image ships `dist/`
 * and no `node_modules` at all, and `scripts/vendor-gsap.mjs` puts the files
 * there at build time. Then the dependency itself, which is what development,
 * the tests and anything running from source use.
 *
 * Reading only from `node_modules` worked everywhere it was tried and would
 * have thrown on the first banner in a container — the kind of fault that only
 * shows up where it costs the most (2026-09-17).
 */
function locate(file: string): string {
  const beside = fileURLToPath(new URL(`./vendor/${file}`, import.meta.url));
  if (existsSync(beside)) return beside;
  try {
    return require_.resolve(`gsap/dist/${file}`);
  } catch {
    throw new GsapMissingError(file, beside);
  }
}

export class GsapMissingError extends Error {
  constructor(file: string, beside: string) {
    super(
      `Cannot find ${file}. It is neither beside the bundle (${beside}) nor resolvable ` +
        'from the gsap dependency. A production build runs `scripts/vendor-gsap.mjs`; ' +
        'if that step was skipped, banners cannot be generated.',
    );
    this.name = 'GsapMissingError';
  }
}

function read(file: string): Runtime {
  const path = locate(file);
  const source = readFileSync(path, 'utf8');
  const match = NOTICE.exec(source);
  if (match?.[1] === undefined) throw new GsapNoticeMissingError(path);
  return { source, version: match[1], bytes: Buffer.byteLength(source, 'utf8') };
}
