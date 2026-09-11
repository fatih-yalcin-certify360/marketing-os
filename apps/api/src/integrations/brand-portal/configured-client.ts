import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { BrandPortalClient, BrandPortalError, portalBundle, type BundleCache,
  type BundleSnapshot } from './client.js';

const snapshotSchema = z.object({
  bundle: portalBundle,
  etag: z.string().nullable(),
  fetchedAt: z.number().finite().nonnegative(),
  validatedAt: z.number().finite().nonnegative(),
});

/** Atomic, private snapshots survive API/worker restarts. No credentials are
 * written; signed asset URLs in bundle data stay in server-only storage. */
export class FileBundleCache implements BundleCache {
  constructor(private readonly directory: string) {}

  private filename(key: string): string {
    return path.join(this.directory, `${createHash('sha256').update(key).digest('hex')}.json`);
  }

  async get(key: string): Promise<BundleSnapshot | undefined> {
    let raw: string;
    try { raw = await readFile(this.filename(key), 'utf8'); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
    try {
      const result = snapshotSchema.safeParse(JSON.parse(raw));
      return result.success ? result.data : undefined;
    } catch { return undefined; }
  }

  async set(key: string, snapshot: BundleSnapshot): Promise<void> {
    const value = snapshotSchema.parse(snapshot);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const filename = this.filename(key);
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      await rename(temporary, filename);
    } finally { await rm(temporary, { force: true }); }
  }
}

/** Read configuration explicitly, without importing or editing shared config
 * during the concurrent P1-5 work. The caller supplies its organization id. */
export function configuredPortalClient(
  env: Readonly<Record<string, string | undefined>>,
  organizationId: string,
): BrandPortalClient {
  const baseUrl = env.BRAND_PORTAL_BASE_URL;
  const apiKey = env.BRAND_PORTAL_API_KEY;
  if (!baseUrl || !apiKey || !organizationId.trim()) throw new BrandPortalError('configuration');
  // Key rotation automatically leaves the previous credential's cache behind.
  const scope = createHash('sha256').update(apiKey).digest('hex');
  return new BrandPortalClient({
    baseUrl, apiKey, cacheNamespace: JSON.stringify([organizationId, scope]),
    cache: new FileBundleCache(path.resolve(env.STORAGE_ROOT ?? './var/storage', 'brand-portal')),
  });
}
