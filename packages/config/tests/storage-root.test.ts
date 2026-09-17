import { describe, expect, it } from 'vitest';
import { isAbsolute, join, resolve } from 'node:path';
import { loadServerEnv, repositoryRoot, resolveStorageRoot } from '../src/index.js';

/**
 * The storage root is shared state between two processes.
 *
 * The api stores a file, the worker reads it. Each is started with its own
 * workspace folder as working directory, so a root resolved against the
 * working directory is a different folder per process — which is how the
 * first real content run with a brand logo died on `ENOENT` in the worker
 * while the api had stored the file happily. The root therefore resolves
 * against the repository, whichever process asks and wherever it was started.
 */
describe('STORAGE_ROOT', () => {
  it('finds the repository root from this package, not from the working directory', () => {
    const root = repositoryRoot();
    expect(isAbsolute(root)).toBe(true);
    expect(root).toBe(resolve(import.meta.dirname, '..', '..', '..'));
  });

  it('resolves a relative root under the repository root, the same for every process', () => {
    expect(resolveStorageRoot('./var/storage')).toBe(join(repositoryRoot(), 'var', 'storage'));
    expect(resolveStorageRoot('var/storage')).toBe(join(repositoryRoot(), 'var', 'storage'));
    // Whatever the working directory is — the worker's, the api's — the answer is one folder.
    expect(resolveStorageRoot('./var/storage')).not.toContain(join('apps', 'worker'));
  });

  it('leaves an absolute root exactly as configured', () => {
    expect(resolveStorageRoot('/srv/c360/storage')).toBe('/srv/c360/storage');
  });

  it('applies the resolution when the environment is loaded', () => {
    const env = loadServerEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://user:pw@127.0.0.1:5432/db',
      AUTH_MODE: 'local',
      AI_PROVIDER: 'mock',
      STORAGE_ROOT: './var/storage',
    });
    expect(isAbsolute(env.STORAGE_ROOT)).toBe(true);
    expect(env.STORAGE_ROOT).toBe(join(repositoryRoot(), 'var', 'storage'));
  });
});
