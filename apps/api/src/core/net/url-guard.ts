import { isIPv4, isIPv6 } from 'node:net';
import { classifyAddress, isLoopbackAddress } from './ip-guard.js';

/**
 * What counts as a fetchable URL.
 *
 * The address check in `ip-guard.ts` is the control that closes SSRF. This
 * module refuses the requests that never need to reach it — and each rule here
 * removes a distinct trick rather than being defence-in-depth for its own sake:
 *
 *  - **Scheme.** Only `https` (and `http` when a deployment opts in). Everything
 *    else is a different attack surface entirely: `file:` reads the disk,
 *    `gopher:` and `dict:` can be used to speak other protocols through a
 *    fetcher, `data:` smuggles content past a "we only fetch URLs" assumption.
 *  - **Credentials.** `https://user:pass@host` is refused. Some clients forward
 *    the credentials to a redirect target, which turns our fetcher into a
 *    credential-delivery mechanism.
 *  - **Port.** 80 and 443 only. Most of what makes SSRF valuable is reaching
 *    something that is not a web server — Redis on 6379, PostgreSQL on 5432,
 *    Memcached on 11211, an SSH banner on 22. An address check alone does not
 *    stop a *public* host on port 6379.
 *  - **Hostname shape.** A single-label name (`intranet`, `localhost`) resolves
 *    through the host's own search domains and is refused outright, as are the
 *    reserved special-use suffixes.
 *  - **An IP literal** is classified immediately, so `http://169.254.169.254`
 *    never reaches DNS.
 *
 * A hostname allow-list, when configured, is applied *in addition*: it narrows,
 * it never widens. Nothing in here can permit an address the IP guard refuses.
 */

export interface UrlGuardOptions {
  /** Only these hostname suffixes may be fetched. Empty means "any public host". */
  readonly allowedHostSuffixes: readonly string[];
  /** Permit plain `http:`. Off by default; TLS is the sane baseline. */
  readonly allowInsecureHttp: boolean;
  /**
   * **Tests only.** Permits *loopback* addresses and any port. Nothing else.
   *
   * Without it the redirect chain, the byte cap and the timeout cannot be
   * tested at all: the only server a test can start is on loopback, on an
   * ephemeral port, and both are refused before a socket opens — so every test
   * would pass for the wrong reason.
   *
   * Deliberately narrower than "allow private addresses". A broader hatch also
   * opened link-local, and the metadata service is link-local — so a test for
   * "is a redirect to the metadata service refused?" followed the redirect and
   * timed out instead of being refused. The narrow hatch keeps that test
   * meaningful and shrinks the blast radius of the hatch itself.
   *
   * It is safe because `safeFetch` **throws** if this is set while
   * `NODE_ENV=production`, the same shape as
   * `UNSAFE_ALLOW_DEV_AUTH_IN_PRODUCTION`. Named to be unmissable in review.
   */
  readonly unsafeAllowLoopbackForTests?: boolean;
}

export type UrlRejectionCode =
  | 'not_a_url'
  | 'scheme_not_allowed'
  | 'credentials_in_url'
  | 'port_not_allowed'
  | 'hostname_not_allowed'
  | 'address_not_allowed';

export interface UrlRejected {
  readonly ok: false;
  readonly code: UrlRejectionCode;
  /** Dutch, safe to show. Deliberately vague about *why* internally. */
  readonly reasonNl: string;
  /** For the audit record and the log. Never returned to a client. */
  readonly finding: string;
}

export interface UrlAccepted {
  readonly ok: true;
  readonly url: URL;
  /** Set when the host was given as an IP literal, so DNS can be skipped. */
  readonly literalAddress?: string;
}

export type UrlVerdict = UrlAccepted | UrlRejected;

const ALLOWED_PORTS = new Set([80, 443]);

/**
 * Suffixes reserved for local resolution (RFC 6761 and friends).
 *
 * A name ending in one of these is answered by something on the local network
 * or by the host itself, so it can never be a legitimate research source.
 */
const SPECIAL_USE_SUFFIXES: readonly string[] = Object.freeze([
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.corp',
  '.home',
  '.lan',
  '.private',
  '.test',
  '.example',
  '.invalid',
  '.onion',
  '.alt',
]);

const REFUSED_EXACT_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata', 'metadata.google.internal']);

const GENERIC_REFUSAL =
  'Deze URL kan niet worden opgehaald. Gebruik een openbaar bereikbare https-pagina.';

export function inspectUrl(raw: string, options: UrlGuardOptions): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      code: 'not_a_url',
      reasonNl: 'Dit is geen geldige URL.',
      finding: 'URL could not be parsed',
    };
  }

  const scheme = url.protocol.replace(':', '').toLowerCase();
  const schemeAllowed = scheme === 'https' || (scheme === 'http' && options.allowInsecureHttp);
  if (!schemeAllowed) {
    return {
      ok: false,
      code: 'scheme_not_allowed',
      reasonNl:
        scheme === 'http'
          ? 'Alleen https-adressen worden opgehaald.'
          : 'Alleen https-adressen worden opgehaald.',
      finding: `scheme "${scheme}" not allowed`,
    };
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return {
      ok: false,
      code: 'credentials_in_url',
      reasonNl: 'Een URL met inloggegevens wordt niet opgehaald.',
      finding: 'credentials present in URL',
    };
  }

  const port = url.port.length === 0 ? (scheme === 'https' ? 443 : 80) : Number(url.port);
  if (!ALLOWED_PORTS.has(port) && options.unsafeAllowLoopbackForTests !== true) {
    return {
      ok: false,
      code: 'port_not_allowed',
      reasonNl: GENERIC_REFUSAL,
      finding: `port ${String(port)} not allowed`,
    };
  }

  // `URL` wraps an IPv6 literal in brackets; strip them before classifying.
  const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();

  if (host.length === 0) {
    return {
      ok: false,
      code: 'hostname_not_allowed',
      reasonNl: 'Dit is geen geldige URL.',
      finding: 'empty hostname',
    };
  }

  if (isIPv4(host) || isIPv6(host)) {
    const verdict = classifyAddress(host);
    const hatched = options.unsafeAllowLoopbackForTests === true && isLoopbackAddress(host);
    if (!verdict.allowed && !hatched) {
      return {
        ok: false,
        code: 'address_not_allowed',
        reasonNl: GENERIC_REFUSAL,
        finding: `IP literal refused: ${verdict.why ?? 'blocked'}`,
      };
    }
    // A public IP literal is allowed, and DNS is skipped for it.
    return { ok: true, url, literalAddress: verdict.normalised };
  }

  if (REFUSED_EXACT_HOSTS.has(host)) {
    return {
      ok: false,
      code: 'hostname_not_allowed',
      reasonNl: GENERIC_REFUSAL,
      finding: `reserved hostname "${host}"`,
    };
  }

  if (!host.includes('.')) {
    // Resolved through the host's search domains, so it addresses the local
    // network however it looks.
    return {
      ok: false,
      code: 'hostname_not_allowed',
      reasonNl: GENERIC_REFUSAL,
      finding: `single-label hostname "${host}"`,
    };
  }

  // A trailing dot is a valid FQDN but bypasses naive suffix matching.
  const canonical = host.endsWith('.') ? host.slice(0, -1) : host;

  for (const suffix of SPECIAL_USE_SUFFIXES) {
    if (canonical.endsWith(suffix)) {
      return {
        ok: false,
        code: 'hostname_not_allowed',
        reasonNl: GENERIC_REFUSAL,
        finding: `special-use suffix "${suffix}"`,
      };
    }
  }

  if (options.allowedHostSuffixes.length > 0) {
    const permitted = options.allowedHostSuffixes.some((suffix) => {
      const normalised = suffix.toLowerCase().replace(/^\./u, '');
      return canonical === normalised || canonical.endsWith(`.${normalised}`);
    });
    if (!permitted) {
      return {
        ok: false,
        code: 'hostname_not_allowed',
        reasonNl: 'Dit domein staat niet op de lijst van toegestane bronnen.',
        finding: `host "${canonical}" not in RESEARCH_ALLOWED_HOST_SUFFIXES`,
      };
    }
  }

  return { ok: true, url };
}

/** Exposed for the tests, so they assert the list rather than restate it. */
export const RESERVED_SUFFIXES = SPECIAL_USE_SUFFIXES;
export const FETCHABLE_PORTS: readonly number[] = Object.freeze([...ALLOWED_PORTS]);
