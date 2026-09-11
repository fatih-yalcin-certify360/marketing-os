import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { safeFetch, type SafeFetchOptions } from '../../src/core/net/safe-fetch.js';

/**
 * The research fetcher, against a real HTTP server (threat T-06).
 *
 * The server runs on loopback, which is itself a blocked address — and that is
 * the point of most of these tests: a URL naming `127.0.0.1` must be refused
 * *before* a socket is opened, so the server never sees the request. The few
 * tests that need a response to arrive opt in through the allow-list bypass
 * below, which exists only in the test.
 *
 * The properties under test, in order of how badly they fail if wrong:
 *
 *  1. a redirect target is validated again, not followed on trust;
 *  2. the address we validated is the address we connect to;
 *  3. timeout, size and redirect limits are shared across the chain.
 */

/** Requests the test server received, so a refusal can be proven to be silent. */
let received: string[] = [];
let server: Server;
let port = 0;

const base = (overrides: Partial<SafeFetchOptions> = {}): SafeFetchOptions => ({
  allowedHostSuffixes: [],
  allowInsecureHttp: true,
  timeoutMs: 4_000,
  maxResponseBytes: 64 * 1024,
  maxRedirects: 3,
  ...overrides,
});

beforeAll(async () => {
  server = createServer((request, response) => {
    received.push(request.url ?? '');
    const url = new URL(request.url ?? '/', 'http://localhost');

    switch (url.pathname) {
      case '/ok':
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<html><body><h1>Wft Basis</h1></body></html>');
        return;
      case '/redirect-to-ok':
        // Relative Location, so the resolution against the current URL is
        // exercised as well as the re-validation.
        response.writeHead(302, { location: '/ok' });
        response.end();
        return;
      case '/redirect-to-metadata':
        // The whole point: a valid first hop pointing somewhere it must not go.
        response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        response.end();
        return;
      case '/redirect-to-loopback':
        response.writeHead(302, { location: 'http://127.0.0.1:1/' });
        response.end();
        return;
      case '/redirect-to-file':
        response.writeHead(302, { location: 'file:///etc/passwd' });
        response.end();
        return;
      case '/redirect-loop':
        response.writeHead(302, { location: '/redirect-loop' });
        response.end();
        return;
      case '/redirect-no-location':
        response.writeHead(302);
        response.end();
        return;
      case '/huge':
        response.writeHead(200, { 'content-type': 'text/plain' });
        // Far past the cap, and it keeps going until the reader stops.
        for (let index = 0; index < 200; index += 1) {
          response.write('x'.repeat(4096));
        }
        response.end();
        return;
      case '/declares-huge':
        response.writeHead(200, {
          'content-type': 'text/plain',
          'content-length': String(50 * 1024 * 1024),
        });
        response.end('short body, lying header');
        return;
      case '/slow':
        setTimeout(() => {
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('too late');
        }, 3_000);
        return;
      case '/pdf':
        response.writeHead(200, { 'content-type': 'application/pdf' });
        response.end('%PDF-1.7');
        return;
      case '/teapot':
        response.writeHead(418, { 'content-type': 'text/plain' });
        response.end('no');
        return;
      default:
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('not found');
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

/** The test server, reachable because the hatch is set. See `base()`. */
const loopbackUrl = (path: string) => `http://127.0.0.1:${String(port)}${path}`;

/** Production policy: no hatch. Used to prove the defaults refuse. */
const production = (overrides: Partial<SafeFetchOptions> = {}): SafeFetchOptions => ({
  ...base(overrides),
  unsafeAllowLoopbackForTests: false,
  allowInsecureHttp: false,
});

/** Test policy: reaches loopback on an ephemeral port, and nothing wider. */
const permissive = (overrides: Partial<SafeFetchOptions> = {}): SafeFetchOptions => ({
  ...base(overrides),
  unsafeAllowLoopbackForTests: true,
});

describe('safe fetch — the defaults refuse before a socket opens', () => {
  it('never contacts a loopback address', async () => {
    received = [];
    const result = await safeFetch(loopbackUrl('/ok'), production());

    expect(result.ok).toBe(false);
    // The decisive assertion: the server was never asked.
    expect(received).toHaveLength(0);
  });

  it('never contacts the metadata service', async () => {
    received = [];
    const result = await safeFetch('http://169.254.169.254/latest/meta-data/', production());
    expect(result.ok).toBe(false);
    expect(received).toHaveLength(0);
  });

  it('refuses the escape hatch outright in production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      // Throws rather than refusing: a deployment that reaches this has a
      // configuration bug, and it must fail loudly on the first attempt.
      await expect(safeFetch(loopbackUrl('/ok'), permissive())).rejects.toThrow(
        /must never be set in production/u,
      );
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe('safe fetch — a successful read', () => {
  it('returns the body with the metadata an evidence trail needs', async () => {
    received = [];
    const result = await safeFetch(loopbackUrl('/ok'), permissive());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.body).toMatch(/Wft Basis/u);
    expect(result.status).toBe(200);
    expect(result.contentType).toBe('text/html');
    expect(result.truncated).toBe(false);
    // Source, retrieval date and the address actually dialled: the three things
    // a citation and an audit record need.
    expect(result.finalUrl).toBe(loopbackUrl('/ok'));
    expect(result.connectedAddress).toBe('127.0.0.1');
    expect(result.retrievedAt).toBeInstanceOf(Date);
    expect(received).toEqual(['/ok']);
  });

  it('sends no cookies and no authorization header', async () => {
    // Anything replayable would turn the fetcher into a credential courier.
    let headers: Record<string, unknown> = {};
    const probe = createServer((request, response) => {
      headers = { ...request.headers };
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
    });
    await new Promise<void>((resolve) => {
      probe.listen(0, '127.0.0.1', resolve);
    });
    const address = probe.address();
    const probePort = typeof address === 'object' && address !== null ? address.port : 0;

    await safeFetch(`http://127.0.0.1:${String(probePort)}/x`, permissive());
    await new Promise<void>((resolve) => {
      probe.close(() => {
        resolve();
      });
    });

    expect(headers.cookie).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    expect(String(headers['user-agent'])).toMatch(/Certify360/u);
  });
});

describe('safe fetch — every redirect hop is validated again', () => {
  it('refuses a redirect to the metadata service', async () => {
    received = [];
    const result = await safeFetch(loopbackUrl('/redirect-to-metadata'), permissive());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('address_not_allowed');
      // Names the hop, so the log says where it happened.
      expect(result.finding).toMatch(/redirect hop 1/u);
    }
    // The first hop was fetched; the second was never dialled.
    expect(received).toEqual(['/redirect-to-metadata']);
  });

  it('refuses a redirect to a non-http scheme', async () => {
    const result = await safeFetch(loopbackUrl('/redirect-to-file'), permissive());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('scheme_not_allowed');
    }
  });

  it('stops a redirect loop at the limit', async () => {
    received = [];
    const result = await safeFetch(loopbackUrl('/redirect-loop'), permissive({ maxRedirects: 2 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('too_many_redirects');
    }
    // Exactly the allowance, not one more.
    expect(received).toHaveLength(3);
  });

  it('refuses a redirect with no usable Location', async () => {
    const result = await safeFetch(loopbackUrl('/redirect-no-location'), permissive());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('redirect_without_location');
    }
  });

  it('records the whole chain when it succeeds', async () => {
    const result = await safeFetch(loopbackUrl('/redirect-to-ok'), permissive());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain).toHaveLength(2);
      expect(result.finalUrl).toBe(loopbackUrl('/ok'));
      // A relative Location resolved against the current URL.
      expect(result.chain[1]).toBe(loopbackUrl('/ok'));
    }
  });
});

describe('safe fetch — limits are shared across the chain', () => {
  it('refuses a declared length over the cap without reading a byte', async () => {
    const result = await safeFetch(
      loopbackUrl('/declares-huge'),
      permissive({ maxResponseBytes: 1024 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('response_too_large');
      expect(result.finding).toMatch(/declared content-length/u);
    }
  });

  it('stops reading a body that streams past the cap', async () => {
    // A lying or chunked server has no content-length, so the cap has to be
    // enforced while reading.
    const cap = 8 * 1024;
    const result = await safeFetch(loopbackUrl('/huge'), permissive({ maxResponseBytes: cap }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.byteSize).toBe(cap);
      expect(result.truncated).toBe(true);
    }
  });

  it('gives up on a slow response within the budget', async () => {
    const startedAt = Date.now();
    const result = await safeFetch(loopbackUrl('/slow'), permissive({ timeoutMs: 700 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('timeout');
    }
    // The budget is for the whole chain, so it cannot have waited for the 3s
    // server response.
    expect(Date.now() - startedAt).toBeLessThan(2_500);
  });
});

describe('safe fetch — response shape', () => {
  it('refuses a content type it cannot read, unread', async () => {
    const result = await safeFetch(loopbackUrl('/pdf'), permissive());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('content_type_not_allowed');
    }
  });

  it('reports a non-2xx status rather than returning its body', async () => {
    const result = await safeFetch(loopbackUrl('/teapot'), permissive());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('status_not_ok');
      // The user is told the page failed, not shown the error page's content.
      expect(result.reasonNl).toMatch(/418/u);
    }
  });

  it('reports a 404 as a failure, not as empty content', async () => {
    const result = await safeFetch(loopbackUrl('/missing'), permissive());
    expect(result.ok).toBe(false);
  });
});
