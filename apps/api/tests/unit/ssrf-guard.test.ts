import { describe, expect, it } from 'vitest';
import { classifyAddress, NAMED_METADATA_ADDRESSES } from '../../src/core/net/ip-guard.js';
import { inspectUrl, RESERVED_SUFFIXES } from '../../src/core/net/url-guard.js';

/**
 * SSRF defence (backlog P1-4, threat T-06).
 *
 * The attack this exists to stop: a user supplies a URL, we fetch it from
 * inside the deployment network, and either the response or the mere fact that
 * the connection succeeded tells them about hosts they could never reach. The
 * metadata service is the prize, because on an unhardened instance it hands out
 * credentials.
 *
 * One test per acceptance criterion, because "we validate URLs" is the kind of
 * claim that holds for the obvious cases and fails for the ones that matter.
 */

const open: Parameters<typeof inspectUrl>[1] = {
  allowedHostSuffixes: [],
  allowInsecureHttp: false,
};

describe('address classification — what we refuse to connect to', () => {
  it('refuses loopback in every notation', () => {
    for (const address of [
      '127.0.0.1',
      '127.1.2.3',
      '127.0.0.53',
      '::1',
      '0:0:0:0:0:0:0:1',
      // IPv4-mapped, dotted and hex. `normaliseAddress` handles the first;
      // the ::ffff:0:0/96 range is what catches the second.
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
    ]) {
      expect(classifyAddress(address).allowed, address).toBe(false);
    }
  });

  it('refuses every private range', () => {
    for (const address of [
      '10.0.0.1',
      '10.255.255.254',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.0.1',
      '192.168.255.254',
      'fc00::1',
      'fd12:3456:789a::1',
    ]) {
      expect(classifyAddress(address).allowed, address).toBe(false);
    }
  });

  it('refuses link-local, including the cloud metadata address', () => {
    for (const address of ['169.254.0.1', '169.254.169.254', '169.254.170.2', 'fe80::1']) {
      expect(classifyAddress(address).allowed, address).toBe(false);
    }
    // The one that matters most, named explicitly in the verdict.
    expect(classifyAddress('169.254.169.254').why).toMatch(/metadata/iu);
  });

  it('refuses every metadata endpoint we know of by name', () => {
    for (const address of NAMED_METADATA_ADDRESSES) {
      const verdict = classifyAddress(address);
      expect(verdict.allowed, address).toBe(false);
      expect(verdict.why, address).toBeTruthy();
    }
  });

  it('refuses carrier-grade NAT, which also holds Alibaba metadata', () => {
    expect(classifyAddress('100.64.0.1').allowed).toBe(false);
    expect(classifyAddress('100.100.100.200').allowed).toBe(false);
  });

  it('refuses unspecified, broadcast, multicast and reserved space', () => {
    for (const address of [
      '0.0.0.0',
      '0.1.2.3',
      '255.255.255.255',
      '224.0.0.1',
      '239.255.255.255',
      '240.0.0.1',
      '::',
      'ff02::1',
    ]) {
      expect(classifyAddress(address).allowed, address).toBe(false);
    }
  });

  it('refuses translation prefixes that embed an IPv4 address', () => {
    // Decoding the embedded address and re-checking it is a place to make a
    // mistake; nothing here needs a translation prefix, so the prefix goes.
    for (const address of [
      '64:ff9b::7f00:1', // NAT64 wrapping 127.0.0.1
      '64:ff9b::a00:1', // NAT64 wrapping 10.0.0.1
      '2001:0:1234::1', // Teredo
      '2002:7f00:1::1', // 6to4 wrapping 127.0.0.1
    ]) {
      expect(classifyAddress(address).allowed, address).toBe(false);
    }
  });

  it('refuses documentation and benchmarking ranges', () => {
    for (const address of [
      '192.0.2.1',
      '198.51.100.1',
      '203.0.113.1',
      '198.18.0.1',
      '2001:db8::1',
    ]) {
      expect(classifyAddress(address).allowed, address).toBe(false);
    }
  });

  it('refuses anything that is not an IP at all', () => {
    for (const value of ['', 'not-an-ip', '999.1.1.1', '1.2.3', 'example.com']) {
      expect(classifyAddress(value).allowed, value).toBe(false);
    }
  });

  it('allows an ordinary public address', () => {
    for (const address of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '2606:2800:220:1::1']) {
      expect(classifyAddress(address).allowed, address).toBe(true);
    }
  });

  it('strips an IPv6 zone index before deciding', () => {
    // `fe80::1%eth0` must not slip through by failing to parse.
    expect(classifyAddress('fe80::1%eth0').allowed).toBe(false);
  });
});

describe('URL guard — scheme, credentials, port', () => {
  it('allows https and refuses http unless a deployment opts in', () => {
    expect(inspectUrl('https://example.com/page', open).ok).toBe(true);

    const refused = inspectUrl('http://example.com/page', open);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('scheme_not_allowed');
    }

    expect(inspectUrl('http://example.com/page', { ...open, allowInsecureHttp: true }).ok).toBe(true);
  });

  it('refuses every other scheme, not just the ones we thought of', () => {
    for (const url of [
      'file:///etc/passwd',
      'gopher://example.com:70/x',
      'dict://example.com:2628/x',
      'ftp://example.com/x',
      'data:text/html,<script>x</script>',
      'jar:https://example.com!/x',
      'ldap://example.com/x',
      'blob:https://example.com/x',
    ]) {
      const verdict = inspectUrl(url, open);
      expect(verdict.ok, url).toBe(false);
    }
  });

  it('refuses credentials in the URL', () => {
    // Some clients forward these to a redirect target, which turns a fetcher
    // into a credential-delivery mechanism.
    const verdict = inspectUrl('https://user:secret@example.com/x', open);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('credentials_in_url');
      // The secret must not appear in the internal finding either.
      expect(verdict.finding).not.toMatch(/secret/u);
    }
  });

  it('allows only 80 and 443', () => {
    expect(inspectUrl('https://example.com:443/x', open).ok).toBe(true);
    expect(inspectUrl('http://example.com:80/x', { ...open, allowInsecureHttp: true }).ok).toBe(true);

    // Most of what makes SSRF valuable is reaching something that is not a web
    // server. An address check alone does not stop a public host on 6379.
    for (const port of [22, 25, 3306, 5432, 6379, 9200, 11211, 27017, 8080, 4000]) {
      const verdict = inspectUrl(`https://example.com:${String(port)}/x`, open);
      expect(verdict.ok, `port ${String(port)}`).toBe(false);
      if (!verdict.ok) {
        expect(verdict.code).toBe('port_not_allowed');
      }
    }
  });
});

describe('URL guard — hostnames', () => {
  it('refuses an IP literal that points somewhere internal', () => {
    for (const url of [
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest/meta-data/',
      'https://10.0.0.1/x',
      'https://[::1]/x',
      'https://[fd00:ec2::254]/x',
      // Decimal and octal encodings of 127.0.0.1 are not valid hostnames to
      // `URL`, so they fail as names rather than resolving locally.
      'https://2130706433/x',
      'https://0177.0.0.1/x',
    ]) {
      expect(inspectUrl(url, open).ok, url).toBe(false);
    }
  });

  it('allows a public IP literal and skips DNS for it', () => {
    const verdict = inspectUrl('https://93.184.216.34/x', open);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.literalAddress).toBe('93.184.216.34');
    }
  });

  it('refuses a single-label hostname, which resolves through search domains', () => {
    for (const url of ['https://intranet/x', 'https://localhost/x', 'https://wiki/x']) {
      const verdict = inspectUrl(url, open);
      expect(verdict.ok, url).toBe(false);
    }
  });

  it('refuses every reserved suffix, including with a trailing dot', () => {
    for (const suffix of RESERVED_SUFFIXES) {
      const host = `something${suffix}`;
      expect(inspectUrl(`https://${host}/x`, open).ok, host).toBe(false);
      // A trailing dot is a valid FQDN and bypasses naive suffix matching.
      expect(inspectUrl(`https://${host}./x`, open).ok, `${host}.`).toBe(false);
    }
  });

  it('refuses the well-known metadata hostnames', () => {
    for (const host of ['metadata', 'metadata.google.internal']) {
      expect(inspectUrl(`https://${host}/x`, open).ok, host).toBe(false);
    }
  });

  it('honours an allow-list as a narrowing, never a widening', () => {
    const restricted = { ...open, allowedHostSuffixes: ['lindenhaeghe.nl', 'example.com'] };

    expect(inspectUrl('https://www.lindenhaeghe.nl/opleiding', restricted).ok).toBe(true);
    expect(inspectUrl('https://example.com/x', restricted).ok).toBe(true);
    expect(inspectUrl('https://other.test-site.org/x', restricted).ok).toBe(false);

    // A suffix match must not be a substring match: `notexample.com` is a
    // different domain.
    expect(inspectUrl('https://notexample.com/x', restricted).ok).toBe(false);

    // And the allow-list cannot permit what the address check refuses.
    const withLocal = { ...open, allowedHostSuffixes: ['0.1'] };
    expect(inspectUrl('https://127.0.0.1/x', withLocal).ok).toBe(false);
  });

  it('never puts internal detail in the user-facing message', () => {
    const verdict = inspectUrl('https://169.254.169.254/latest/meta-data/', open);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      // The user is told it cannot be fetched, not what was found there.
      expect(verdict.reasonNl).not.toMatch(/169\.254|metadata|link-local/iu);
      expect(verdict.finding).toMatch(/metadata/iu);
    }
  });
});


describe('the test escape hatch is not reachable from production code', () => {
  it('is never set anywhere outside a test file', async () => {
    // The hatch opens loopback and every port. It is safe only because it is
    // confined to tests and refused in production; this asserts the first half
    // mechanically, so a stray usage cannot creep into a route or a service.
    const { readdir, readFile, stat } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const offenders: string[] = [];

    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory)) {
        if (entry === 'node_modules' || entry === 'dist') {
          continue;
        }
        const full = join(directory, entry);
        if ((await stat(full)).isDirectory()) {
          await walk(full);
          continue;
        }
        if (!full.endsWith('.ts')) {
          continue;
        }
        const contents = await readFile(full, 'utf8');
        // The declaration and the production guard both name it legitimately.
        const isDeclaration = full.includes('core/net/');
        if (!isDeclaration && contents.includes('unsafeAllowLoopbackForTests')) {
          offenders.push(full);
        }
      }
    }

    await walk('apps/api/src');
    await walk('apps/worker/src');
    expect(offenders).toEqual([]);
  });
});
