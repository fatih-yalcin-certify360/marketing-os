import { createRequire } from 'node:module';

/**
 * How to log, given the environment.
 *
 * Readable output where it can be had, JSON everywhere else.
 *
 * `pino-pretty` is a development dependency, so it is absent from the
 * production images — and the Compose stack runs those images with
 * `NODE_ENV=development`, because the local identity and the mock model are
 * both refused in production. Asking pino for a transport it cannot load is
 * fatal, so the API and the worker both crash-looped the first time anybody
 * actually started the containers (2026-09-17).
 *
 * Pretty printing is a convenience. Not having it is not a reason to refuse to
 * run, so the decision asks whether the module is there rather than assuming it
 * from the environment name.
 *
 * Shared rather than written twice: the API and the worker are separate
 * bundles, and the same reasoning applied in two places drifts apart.
 */
export function prettyTransport(nodeEnv: string): {
  transport?: { target: string; options: Record<string, unknown> };
} {
  if (nodeEnv !== 'development' || !canLoad('pino-pretty')) return {};
  return {
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  };
}

/** Whether a module is actually installed, so an optional nicety cannot be fatal. */
function canLoad(specifier: string): boolean {
  try {
    createRequire(import.meta.url).resolve(specifier);
    return true;
  } catch {
    return false;
  }
}
