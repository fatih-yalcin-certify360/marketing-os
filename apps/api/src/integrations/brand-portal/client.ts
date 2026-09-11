import { z } from 'zod';

// Only the envelope is known from the integration brief. Keep vendor fields
// intact until a real response establishes the mapping to our brand contract.
export const portalBundle = z.object({
  slug: z.string().min(1),
  displayName: z.string().min(1),
  version: z.string().min(1),
  urlTtlSeconds: z.number().positive().nullable().optional(),
}).passthrough();
export type PortalBundle = z.infer<typeof portalBundle>;

export interface BundleSnapshot {
  bundle: PortalBundle;
  etag: string | null;
  fetchedAt: number;
  validatedAt: number;
}

/** Implement with durable, server-only storage when wiring the application. */
export interface BundleCache {
  get(key: string): Promise<BundleSnapshot | undefined>;
  set(key: string, snapshot: BundleSnapshot): Promise<void>;
}

export type PortalFailure = 'configuration' | 'unavailable' | 'unauthorized' |
  'forbidden' | 'not_found' | 'invalid_response' | 'too_large';

export class BrandPortalError extends Error {
  constructor(public readonly kind: PortalFailure) {
    // Never include response bodies, URLs with signatures, or credentials.
    super(`Brand Portal: ${kind}`);
    this.name = 'BrandPortalError';
  }
}

export interface PortalClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Trusted configuration identifying the organization and credential scope.
   * Change this namespace whenever the configured API key/scope changes. */
  cacheNamespace: string;
  cache: BundleCache;
  timeoutMs?: number;
  maxJsonBytes?: number;
  maxAssetBytes?: number;
  maxStaleMs?: number;
  transport?: typeof fetch;
  now?: () => number;
}

export interface BundleRequest {
  slug: string;
  channel?: 'production' | 'draft';
  include?: readonly string[];
  /** Re-fetch before downloading assets whose signed URLs may have expired. */
  freshAssetUrls?: boolean;
}

export class BrandPortalClient {
  private readonly base: URL;
  private readonly transport: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: PortalClientOptions) {
    try {
      this.base = new URL(options.baseUrl);
    } catch {
      throw new BrandPortalError('configuration');
    }
    if (!['http:', 'https:'].includes(this.base.protocol) ||
      this.base.username || this.base.password || this.base.search || this.base.hash ||
      this.base.pathname !== '/' || !options.apiKey.trim() ||
      /[\r\n]/u.test(options.apiKey) || !options.cacheNamespace.trim()) {
      throw new BrandPortalError('configuration');
    }
    for (const value of [options.timeoutMs, options.maxJsonBytes, options.maxAssetBytes, options.maxStaleMs]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
        throw new BrandPortalError('configuration');
      }
    }
    this.transport = options.transport ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async bundle(input: BundleRequest): Promise<BundleSnapshot & { stale: boolean }> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.slug)) {
      throw new BrandPortalError('configuration');
    }
    const channel = input.channel ?? 'production';
    const url = new URL(`/v1/brands/${input.slug}/bundle`, this.base);
    url.searchParams.set('channel', channel);
    if (input.include?.length) {
      url.searchParams.set('include', [...new Set(input.include)].sort().join(','));
    }
    const key = JSON.stringify([this.options.cacheNamespace, url.href]);
    const saved = await this.options.cache.get(key);
    const headers: Record<string, string> = {};
    if (saved?.etag && !input.freshAssetUrls) headers['if-none-match'] = saved.etag;

    try {
      const result = await this.read(url, headers, this.options.maxJsonBytes ?? 2_000_000);
      if (result.status === 304) {
        if (!saved || input.freshAssetUrls) throw new BrandPortalError('invalid_response');
        const snapshot = { ...saved, validatedAt: this.now() };
        await this.options.cache.set(key, snapshot);
        return { ...snapshot, stale: false };
      }
      let parsed: unknown;
      try { parsed = JSON.parse(result.bytes.toString('utf8')); }
      catch { throw new BrandPortalError('invalid_response'); }
      const checked = portalBundle.safeParse(parsed);
      if (!checked.success || checked.data.slug !== input.slug) {
        throw new BrandPortalError('invalid_response');
      }
      const timestamp = this.now();
      const snapshot: BundleSnapshot = {
        bundle: checked.data, etag: result.etag, fetchedAt: timestamp, validatedAt: timestamp,
      };
      await this.options.cache.set(key, snapshot);
      return { ...snapshot, stale: false };
    } catch (error) {
      // Authorization failures must never turn into successful cached reads.
      // Draft previews and requests for fresh signatures cannot use stale data.
      const age = saved ? this.now() - saved.validatedAt : Infinity;
      if (error instanceof BrandPortalError && error.kind === 'unavailable' && saved &&
        channel === 'production' && !input.freshAssetUrls && age >= 0 &&
        age <= (this.options.maxStaleMs ?? 86_400_000)) {
        return { ...saved, stale: true };
      }
      throw error;
    }
  }

  /** The application must check local label access before serving these bytes.
   * Asset URLs are data, never arbitrary authenticated fetch destinations. */
  async asset(assetUrl: string): Promise<Buffer> {
    let url: URL;
    try { url = new URL(assetUrl, this.base); }
    catch { throw new BrandPortalError('configuration'); }
    if (url.origin !== this.base.origin || url.username || url.password || url.hash ||
      !/^\/v1\/assets\/[a-zA-Z0-9_-]+\/raw$/u.test(url.pathname)) {
      throw new BrandPortalError('configuration');
    }
    const result = await this.read(url, {}, this.options.maxAssetBytes ?? 20_000_000);
    if (result.status !== 200) throw new BrandPortalError('invalid_response');
    return result.bytes;
  }

  private async read(url: URL, extraHeaders: Record<string, string>, limit: number): Promise<{
    status: number; bytes: Buffer; etag: string | null;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, this.options.timeoutMs ?? 10_000);
    try {
      const response = await this.transport(url, {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { authorization: `Bearer ${this.options.apiKey}`, ...extraHeaders },
      });
      const status = response.status;
      if (status === 304) return { status, bytes: Buffer.alloc(0), etag: null };
      if (status !== 200) {
        await response.body?.cancel();
        if (status === 401) throw new BrandPortalError('unauthorized');
        if (status === 403) throw new BrandPortalError('forbidden');
        if (status === 404) throw new BrandPortalError('not_found');
        if (status === 429 || status >= 500) throw new BrandPortalError('unavailable');
        throw new BrandPortalError('invalid_response');
      }
      if (Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel();
        throw new BrandPortalError('too_large');
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            const bytes: unknown = chunk.value;
            if (!(bytes instanceof Uint8Array)) throw new BrandPortalError('invalid_response');
            size += bytes.byteLength;
            if (size > limit) {
              await reader.cancel();
              throw new BrandPortalError('too_large');
            }
            chunks.push(bytes);
          }
        } finally { reader.releaseLock(); }
      }
      return { status, bytes: Buffer.concat(chunks), etag: response.headers.get('etag') };
    } catch (error) {
      if (error instanceof BrandPortalError) throw error;
      throw new BrandPortalError('unavailable');
    } finally { clearTimeout(timer); }
  }
}
