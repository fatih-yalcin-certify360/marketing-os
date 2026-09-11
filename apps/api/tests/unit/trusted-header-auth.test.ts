import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '@c360/config';
import { TrustedHeaderAuthAdapter } from '../../src/core/auth/trusted-header-adapter.js';
import { TrustedProxyMatcher, normaliseAddress, parseTrustRules } from '../../src/core/auth/net.js';

const SECRET = 's'.repeat(48);

function adapter(overrides: Record<string, string> = {}): TrustedHeaderAuthAdapter {
  return new TrustedHeaderAuthAdapter(
    loadServerEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://c360:c360@db:5432/c360',
      AUTH_MODE: 'trusted-header',
      TRUSTED_PROXY_IPS: '10.0.0.5,192.168.10.0/24',
      AUTH_PROXY_SHARED_SECRET: SECRET,
      ...overrides,
    }),
  );
}

const validHeaders = {
  'x-c360-subject': 'a1b2c3d4-0000-4000-8000-000000000001',
  'x-c360-email': 'Iemand@certify360.com',
  'x-c360-name': 'Iemand Achternaam',
  'x-c360-proxy-secret': SECRET,
};

describe('trusted header authentication', () => {
  it('authenticates a well-formed request from the trusted proxy', () => {
    const subject = adapter().authenticate({
      headers: validHeaders,
      remoteAddress: '10.0.0.5',
    });
    expect(subject.externalSubject).toBe(validHeaders['x-c360-subject']);
    // Normalised so that directory casing cannot create duplicate users.
    expect(subject.email).toBe('iemand@certify360.com');
    expect(subject.authMode).toBe('trusted-header');
  });

  it('rejects identity headers from an untrusted peer', () => {
    // The core bypass scenario: a caller reaching the app directly, past the
    // proxy, while presenting perfectly-formed identity headers.
    expect(() =>
      adapter().authenticate({ headers: validHeaders, remoteAddress: '203.0.113.9' }),
    ).toThrow(/niet aangemeld/u);
  });

  it('rejects a request with no peer address at all', () => {
    expect(() =>
      adapter().authenticate({ headers: validHeaders, remoteAddress: undefined }),
    ).toThrow(/niet aangemeld/u);
  });

  it('rejects a missing subject header', () => {
    const headers: Record<string, string> = { ...validHeaders };
    delete headers['x-c360-subject'];
    expect(() => adapter().authenticate({ headers, remoteAddress: '10.0.0.5' })).toThrow();
  });

  it('rejects a duplicated subject header rather than picking a value', () => {
    // Header smuggling: the proxy set one value, the client appended another.
    // Node delivers both as an array; guessing which to trust would be wrong.
    expect(() =>
      adapter().authenticate({
        headers: {
          ...validHeaders,
          'x-c360-subject': ['proxy-written-subject', 'client-injected-subject'],
        },
        remoteAddress: '10.0.0.5',
      }),
    ).toThrow();
  });

  it('rejects a malformed subject containing whitespace or control characters', () => {
    for (const bad of ['sub ject', 'subject\nX-Admin: 1', '<script>']) {
      expect(() =>
        adapter().authenticate({
          headers: { ...validHeaders, 'x-c360-subject': bad },
          remoteAddress: '10.0.0.5',
        }),
      ).toThrow();
    }
  });

  it('rejects a malformed e-mail header', () => {
    expect(() =>
      adapter().authenticate({
        headers: { ...validHeaders, 'x-c360-email': 'not-an-email' },
        remoteAddress: '10.0.0.5',
      }),
    ).toThrow();
  });

  it('rejects a wrong or missing proxy shared secret', () => {
    expect(() =>
      adapter().authenticate({
        headers: { ...validHeaders, 'x-c360-proxy-secret': 'w'.repeat(48) },
        remoteAddress: '10.0.0.5',
      }),
    ).toThrow(/niet aangemeld/u);

    const headers: Record<string, string> = { ...validHeaders };
    delete headers['x-c360-proxy-secret'];
    expect(() => adapter().authenticate({ headers, remoteAddress: '10.0.0.5' })).toThrow();
  });

  it('never derives authority from client-supplied role or label headers', () => {
    const subject = adapter().authenticate({
      headers: {
        ...validHeaders,
        'x-c360-role': 'org_owner',
        'x-roles': 'admin',
        'x-c360-labels': 'demolabel-5,demolabel-6',
      },
      remoteAddress: '10.0.0.5',
    });
    // The adapter's result type has no role or label field at all, so a forged
    // claim has nowhere to land. Access is resolved from membership rows only.
    expect(Object.keys(subject).sort()).toEqual([
      'authMode',
      'displayName',
      'email',
      'externalSubject',
    ]);
  });

  it('honours configurable header names', () => {
    const custom = adapter({
      AUTH_HEADER_SUBJECT: 'X-Ms-Client-Principal-Id',
      AUTH_HEADER_EMAIL: 'X-Ms-Client-Principal-Name',
      AUTH_HEADER_NAME: 'X-Ms-Display-Name',
    });
    const subject = custom.authenticate({
      headers: {
        'x-ms-client-principal-id': 'principal-1',
        'x-ms-client-principal-name': 'iemand@certify360.com',
        'x-ms-display-name': 'Iemand',
        'x-c360-proxy-secret': SECRET,
      },
      remoteAddress: '10.0.0.5',
    });
    expect(subject.externalSubject).toBe('principal-1');
  });

  it('strips control characters from the display name', () => {
    const subject = adapter().authenticate({
      headers: { ...validHeaders, 'x-c360-name': 'Iemand\u0000\u001bAchternaam' },
      remoteAddress: '10.0.0.5',
    });
    // eslint-disable-next-line no-control-regex -- asserting controls are gone
    expect(subject.displayName).not.toMatch(/[\u0000-\u001f]/u);
    expect(subject.displayName).toContain('Iemand');
  });
});

describe('trusted proxy matching', () => {
  it('matches an exact address and a CIDR range', () => {
    const matcher = new TrustedProxyMatcher(['10.0.0.5', '192.168.10.0/24']);
    expect(matcher.isTrusted('10.0.0.5')).toBe(true);
    expect(matcher.isTrusted('192.168.10.77')).toBe(true);
    expect(matcher.isTrusted('192.168.11.1')).toBe(false);
  });

  it('denies everything when no rules are configured', () => {
    expect(new TrustedProxyMatcher([]).isTrusted('10.0.0.5')).toBe(false);
  });

  it('normalises IPv4-mapped IPv6 peers', () => {
    // A dual-stack listener reports IPv4 peers as ::ffff:10.0.0.5; without
    // normalisation an IPv4 allow-list entry would never match.
    expect(normaliseAddress('::ffff:10.0.0.5')).toBe('10.0.0.5');
    expect(new TrustedProxyMatcher(['10.0.0.5']).isTrusted('::ffff:10.0.0.5')).toBe(true);
  });

  it('strips an IPv6 zone index before matching', () => {
    expect(normaliseAddress('fe80::1%eth0')).toBe('fe80::1');
  });

  it('rejects an invalid allow-list entry at construction time', () => {
    expect(() => parseTrustRules(['not-an-ip'])).toThrow(/not an IP address/u);
    expect(() => parseTrustRules(['10.0.0.0/64'])).toThrow(/out of range/u);
  });
});
