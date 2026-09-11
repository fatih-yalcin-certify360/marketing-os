import { describe, expect, it, vi } from 'vitest';
import { BrandPortalClient, type BundleSnapshot } from '../../src/integrations/brand-portal/client.js';

function setup() {
  const snapshots = new Map<string, BundleSnapshot>();
  const transport = vi.fn<typeof fetch>();
  let now = 1_000;
  const client = new BrandPortalClient({
    baseUrl: 'http://brand-portal-api:3100', apiKey: 'test-only-key',
    cacheNamespace: 'org-one/read-key-one', transport,
    now: () => now, maxStaleMs: 5_000, maxJsonBytes: 1_000,
    cache: {
      get: (key) => Promise.resolve(snapshots.get(key)),
      set: (key, value) => { snapshots.set(key, value); return Promise.resolve(); },
    },
  });
  return { client, snapshots, transport, advance: (ms: number) => { now += ms; } };
}
const request = { slug: 'lindenhaeghe', include: ['tokens', 'logos'] };
function requestUrl(value: Parameters<typeof fetch>[0]): string {
  return typeof value === 'string' ? value : value instanceof URL ? value.href : value.url;
}
function bundle(slug = 'lindenhaeghe'): Response {
  return Response.json({ slug, displayName: 'Lindenhaeghe', version: '1.2.0',
    tokens: { palette: { primary: '#123456' } }, urlTtlSeconds: 300 },
  { headers: { etag: '"release-one"' } });
}

describe('Brand Portal client', () => {
  it('authenticates, defaults to production, and revalidates a saved bundle', async () => {
    const { client, transport, advance } = setup();
    transport.mockResolvedValueOnce(bundle()).mockResolvedValueOnce(new Response(null, { status: 304 }));
    const first = await client.bundle(request);
    advance(1_000);
    const second = await client.bundle(request);
    expect(second.bundle).toEqual(first.bundle);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.validatedAt).toBe(2_000);
    expect(second.stale).toBe(false);
    const [url, init] = transport.mock.calls[1]!;
    expect(requestUrl(url)).toContain('channel=production');
    expect(init?.headers).toEqual({ authorization: 'Bearer test-only-key', 'if-none-match': '"release-one"' });
    expect(init?.redirect).toBe('manual');
  });

  it('isolates labels, channels and include sets in the cache', async () => {
    const { client, transport, snapshots } = setup();
    transport.mockImplementation((url) => Promise.resolve(bundle(requestUrl(url).includes('/other/') ? 'other' : undefined)));
    await client.bundle(request);
    await client.bundle({ ...request, channel: 'draft' });
    await client.bundle({ ...request, slug: 'other' });
    await client.bundle({ ...request, include: ['fonts'] });
    expect(snapshots.size).toBe(4);
    for (const [, init] of transport.mock.calls) expect(init?.headers).not.toHaveProperty('if-none-match');
  });

  it('uses a bounded stale snapshot during an outage', async () => {
    const { client, transport, advance } = setup();
    transport.mockResolvedValueOnce(bundle());
    await client.bundle(request);
    transport.mockRejectedValue(new Error('network failure with private details'));
    expect((await client.bundle(request)).stale).toBe(true);
    advance(5_001);
    await expect(client.bundle(request)).rejects.toMatchObject({ kind: 'unavailable', message: 'Brand Portal: unavailable' });
  });

  it.each([401, 403, 404, 302])('does not mask HTTP %i with cached data', async (status) => {
    const { client, transport } = setup();
    transport.mockResolvedValueOnce(bundle()).mockResolvedValueOnce(new Response(null, { status }));
    await client.bundle(request);
    await expect(client.bundle(request)).rejects.toThrow('Brand Portal:');
  });

  it('does not use stale drafts or stale signed URLs', async () => {
    const { client, transport } = setup();
    transport.mockResolvedValueOnce(bundle()).mockResolvedValueOnce(bundle());
    await client.bundle(request);
    await client.bundle({ ...request, channel: 'draft' });
    transport.mockRejectedValue(new Error('offline'));
    await expect(client.bundle({ ...request, channel: 'draft' })).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(client.bundle({ ...request, freshAssetUrls: true })).rejects.toMatchObject({ kind: 'unavailable' });
    expect(transport.mock.calls.at(-1)?.[1]?.headers).not.toHaveProperty('if-none-match');
  });

  it('rejects another label and malformed JSON without replacing the snapshot', async () => {
    const { client, transport, snapshots } = setup();
    transport.mockResolvedValueOnce(bundle()).mockResolvedValueOnce(bundle('other'))
      .mockResolvedValueOnce(new Response('not json'));
    await client.bundle(request);
    await expect(client.bundle(request)).rejects.toMatchObject({ kind: 'invalid_response' });
    await expect(client.bundle(request)).rejects.toMatchObject({ kind: 'invalid_response' });
    expect([...snapshots.values()][0]?.bundle.slug).toBe('lindenhaeghe');
  });

  it('rejects a 304 without a local body', async () => {
    const { client, transport } = setup();
    transport.mockResolvedValue(new Response(null, { status: 304 }));
    await expect(client.bundle(request)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('bounds streamed bodies even without Content-Length', async () => {
    const { client, transport } = setup();
    transport.mockResolvedValue(new Response('x'.repeat(1_001)));
    await expect(client.bundle(request)).rejects.toMatchObject({ kind: 'too_large' });
  });

  it('never sends credentials to foreign asset hosts or arbitrary paths', async () => {
    const { client, transport } = setup();
    for (const url of ['https://evil.example/v1/assets/a/raw', '//evil.example/v1/assets/a/raw',
      '/healthz', '/v1/assets/a/../../brands', 'http://user:pass@brand-portal-api:3100/v1/assets/a/raw']) {
      await expect(client.asset(url)).rejects.toMatchObject({ kind: 'configuration' });
    }
    expect(transport).not.toHaveBeenCalled();
    transport.mockResolvedValue(new Response('asset bytes'));
    expect((await client.asset('/v1/assets/asset-123/raw?signature=example')).toString()).toBe('asset bytes');
  });

  it('aborts a slow request and hides transport error details', async () => {
    vi.useFakeTimers();
    try {
      const { client, transport } = setup();
      transport.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new Error('private upstream details')); });
      }));
      const assertion = expect(client.bundle(request)).rejects.toMatchObject({ kind: 'unavailable' });
      await vi.advanceTimersByTimeAsync(10_001);
      await assertion;
    } finally { vi.useRealTimers(); }
  });
});
