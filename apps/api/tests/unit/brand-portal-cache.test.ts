import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileBundleCache, configuredPortalClient } from '../../src/integrations/brand-portal/configured-client.js';

describe('Brand Portal persistent cache', () => {
  it('survives restarts, isolates namespaces, and stores private files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'brand-portal-'));
    try {
      const cache = new FileBundleCache(dir);
      const value = { bundle: { slug: 'example', displayName: 'Example', version: '1.0.0' },
        etag: '"one"', fetchedAt: 100, validatedAt: 100 };
      await cache.set('organization-one/../../bundle', value);
      const reopened = new FileBundleCache(dir);
      expect(await reopened.get('organization-one/../../bundle')).toEqual(value);
      expect(await reopened.get('organization-two/../../bundle')).toBeUndefined();
      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/u);
      expect((await stat(path.join(dir, files[0]!))).mode & 0o777).toBe(0o600);
      expect(await readFile(path.join(dir, files[0]!), 'utf8')).not.toContain('organization-one');
      await writeFile(path.join(dir, files[0]!), '{broken');
      expect(await reopened.get('organization-one/../../bundle')).toBeUndefined();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('reports missing settings without including supplied secrets', () => {
    expect(() => configuredPortalClient({ BRAND_PORTAL_API_KEY: 'test-secret' }, 'org'))
      .toThrow('Brand Portal: configuration');
    expect(() => configuredPortalClient({ BRAND_PORTAL_API_KEY: 'test-secret',
      BRAND_PORTAL_BASE_URL: 'https://portal.example' }, '')).toThrow('Brand Portal: configuration');
  });
});
