import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { classifyAddress, isLoopbackAddress } from './ip-guard.js';
import { inspectUrl, type UrlGuardOptions, type UrlRejectionCode } from './url-guard.js';

/**
 * The only way this product fetches a URL a user supplied.
 *
 * Four properties, and the order they are established in matters:
 *
 *  1. **Every hop is validated, not just the first.** A redirect is a fresh
 *     request to a fresh URL, so it goes through exactly the same guard. A
 *     fetcher that validates only the entry URL and then follows redirects is
 *     not protected at all: `https://ok.example/r` returning
 *     `Location: http://169.254.169.254/` defeats it in one hop.
 *  2. **DNS rebinding is closed by connecting to the address we checked.** The
 *     hostname is resolved once, the resolved addresses are classified, and the
 *     connection is made *to a validated address* via the `lookup` hook — not
 *     by handing the hostname back to the stack and hoping it resolves the same
 *     way. Check-then-connect with two resolutions is the whole bug.
 *  3. **The budget is for the whole chain.** Timeout and byte cap are shared
 *     across every hop, so five redirects cannot cost five timeouts.
 *  4. **The body is data.** The return type says so, and nothing downstream may
 *     treat it as an instruction (requirement 6, threat T-05). The prompt layer
 *     puts it in `input`, never in `instructions`.
 *
 * TLS certificate validation is left at Node's default — on. The `lookup` hook
 * changes which address is dialled, not which name is verified, so the
 * certificate is still checked against the hostname.
 */

export interface SafeFetchOptions extends UrlGuardOptions {
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRedirects: number;
  /** Response types worth reading. Anything else is refused unread. */
  readonly allowedContentTypes?: readonly string[];
}

export type FetchFailureCode =
  | UrlRejectionCode
  | 'dns_failed'
  | 'no_allowed_address'
  | 'too_many_redirects'
  | 'redirect_without_location'
  | 'response_too_large'
  | 'timeout'
  | 'connection_failed'
  | 'status_not_ok'
  | 'content_type_not_allowed';

export interface FetchFailure {
  readonly ok: false;
  readonly code: FetchFailureCode;
  /** Dutch, safe to render. */
  readonly reasonNl: string;
  /** For the audit record and the log. Never returned to a client. */
  readonly finding: string;
}

export interface FetchSuccess {
  readonly ok: true;
  /**
   * The body, as text.
   *
   * **Untrusted.** It came from a URL a user chose. It is a source to quote and
   * attribute, never an instruction to follow.
   */
  readonly body: string;
  readonly bodyBytes?: Buffer;
  readonly contentType: string;
  readonly status: number;
  /** After redirects, so a citation records where the content actually came from. */
  readonly finalUrl: string;
  /** Every URL in the chain, for the evidence trail. */
  readonly chain: readonly string[];
  /** The address actually connected to, for the audit record. */
  readonly connectedAddress: string;
  readonly byteSize: number;
  readonly retrievedAt: Date;
  /** True when the body was cut off at the byte cap. */
  readonly truncated: boolean;
}

export type FetchResult = FetchSuccess | FetchFailure;

const DEFAULT_CONTENT_TYPES: readonly string[] = Object.freeze([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'application/json',
  'text/markdown',
]);

const GENERIC_FAILURE = 'Deze pagina kon niet worden opgehaald.';

/**
 * Resolves a hostname and returns only addresses we may connect to.
 *
 * Returns the validated list; the caller hands it to `net.connect` through the
 * `lookup` option, which is what makes the checked address the dialled one.
 */
async function resolveAllowed(
  hostname: string,
  allowLoopback: boolean,
): Promise<{ addresses: { address: string; family: 4 | 6 }[]; refused: string[] }> {
  const resolved = await dnsLookup(hostname, { all: true, verbatim: true });
  const addresses: { address: string; family: 4 | 6 }[] = [];
  const refused: string[] = [];

  for (const entry of resolved) {
    const verdict = classifyAddress(entry.address);
    if (verdict.allowed || (allowLoopback && isLoopbackAddress(entry.address))) {
      addresses.push({ address: verdict.normalised, family: entry.family === 6 ? 6 : 4 });
    } else {
      refused.push(`${entry.address} (${verdict.why ?? 'blocked'})`);
    }
  }

  return { addresses, refused };
}

/**
 * A `lookup` implementation pinned to one already-validated address.
 *
 * Node calls this instead of resolving, so there is no second DNS query and
 * therefore no window in which the answer could change.
 */
function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  const lookup: LookupFunction = (_hostname, options, callback) => {
    // The hostname is deliberately ignored: this exists to hand back the
    // address that was already validated, not to resolve anything.
    //
    // Node uses two callback shapes — one address, or a list when `all` is set
    // for happy-eyeballs. Both are answered with the single pinned address, so
    // there is no path on which an unvalidated one is dialled.
    if (typeof options === 'object' && options !== null && options.all === true) {
      (callback as (error: null, addresses: { address: string; family: number }[]) => void)(null, [
        { address, family },
      ]);
      return;
    }
    (callback as (error: null, address: string, family: number) => void)(null, address, family);
  };
  return lookup;
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<FetchResult> {
  /*
   * The test escape hatch cannot exist in production.
   *
   * Throwing rather than refusing the fetch is deliberate: a deployment that
   * reached this line has a configuration bug, and failing loudly at the first
   * attempt is better than quietly allowing internal addresses. Same shape as
   * the `UNSAFE_ALLOW_DEV_AUTH_IN_PRODUCTION` guard.
   */
  if (
    options.unsafeAllowLoopbackForTests === true &&
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error(
      'safeFetch: unsafeAllowLoopbackForTests must never be set in production.',
    );
  }

  const deadline = Date.now() + options.timeoutMs;
  const allowedTypes = options.allowedContentTypes ?? DEFAULT_CONTENT_TYPES;
  const chain: string[] = [];
  let current = rawUrl;

  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return {
        ok: false,
        code: 'timeout',
        reasonNl: 'Het ophalen van deze pagina duurde te lang.',
        finding: `chain budget of ${String(options.timeoutMs)}ms exhausted after ${String(hop)} hop(s)`,
      };
    }

    // Every hop, including redirect targets. This is the point of the loop.
    const guard = inspectUrl(current, options);
    if (!guard.ok) {
      return {
        ok: false,
        code: guard.code,
        reasonNl: guard.reasonNl,
        finding: hop === 0 ? guard.finding : `redirect hop ${String(hop)}: ${guard.finding}`,
      };
    }

    chain.push(guard.url.toString());

    let pinned: { address: string; family: 4 | 6 };
    if (guard.literalAddress !== undefined) {
      pinned = {
        address: guard.literalAddress,
        family: guard.literalAddress.includes(':') ? 6 : 4,
      };
    } else {
      let resolution;
      try {
        resolution = await resolveAllowed(
          guard.url.hostname,
          options.unsafeAllowLoopbackForTests === true,
        );
      } catch (error: unknown) {
        return {
          ok: false,
          code: 'dns_failed',
          reasonNl: 'Dit adres kon niet worden gevonden.',
          finding: `DNS lookup failed for ${guard.url.hostname}: ${describe(error)}`,
        };
      }

      const first = resolution.addresses[0];
      if (first === undefined) {
        return {
          ok: false,
          code: 'no_allowed_address',
          reasonNl: 'Deze URL kan niet worden opgehaald. Gebruik een openbaar bereikbare pagina.',
          finding:
            resolution.refused.length > 0
              ? `every resolved address refused: ${resolution.refused.join(', ')}`
              : `${guard.url.hostname} resolved to nothing`,
        };
      }
      pinned = first;
    }

    let response;
    try {
      response = await performRequest(guard.url, pinned, Math.min(remainingMs, deadline - Date.now()));
    } catch (error: unknown) {
      const timedOut = error instanceof Error && error.message === 'timeout';
      return {
        ok: false,
        code: timedOut ? 'timeout' : 'connection_failed',
        reasonNl: timedOut
          ? 'Het ophalen van deze pagina duurde te lang.'
          : GENERIC_FAILURE,
        finding: `request to ${guard.url.hostname} via ${pinned.address} failed: ${describe(error)}`,
      };
    }

    const status = response.statusCode ?? 0;

    if (status >= 300 && status < 400) {
      const location = response.headers.location;
      response.resume();
      response.destroy();

      if (typeof location !== 'string' || location.length === 0) {
        return {
          ok: false,
          code: 'redirect_without_location',
          reasonNl: GENERIC_FAILURE,
          finding: `status ${String(status)} without a usable Location header`,
        };
      }
      if (hop === options.maxRedirects) {
        return {
          ok: false,
          code: 'too_many_redirects',
          reasonNl: 'Deze pagina verwijst te vaak door.',
          finding: `exceeded ${String(options.maxRedirects)} redirects`,
        };
      }
      // Resolved against the current URL, so a relative Location works — and
      // then re-validated from scratch at the top of the loop.
      current = new URL(location, guard.url).toString();
      continue;
    }

    if (status < 200 || status >= 300) {
      response.resume();
      response.destroy();
      return {
        ok: false,
        code: 'status_not_ok',
        reasonNl: `De pagina gaf een foutmelding (${String(status)}).`,
        finding: `HTTP ${String(status)} from ${guard.url.hostname}`,
      };
    }

    const contentType = String(response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!allowedTypes.includes(contentType)) {
      response.resume();
      response.destroy();
      return {
        ok: false,
        code: 'content_type_not_allowed',
        reasonNl: 'Dit type pagina kan niet worden gelezen. Gebruik een gewone webpagina.',
        finding: `content-type "${contentType}" not readable`,
      };
    }

    // A declared length over the cap is refused without reading a byte.
    const declared = Number(response.headers['content-length'] ?? Number.NaN);
    if (Number.isFinite(declared) && declared > options.maxResponseBytes) {
      response.resume();
      response.destroy();
      return {
        ok: false,
        code: 'response_too_large',
        reasonNl: 'Deze pagina is te groot om te verwerken.',
        finding: `declared content-length ${String(declared)} over cap ${String(options.maxResponseBytes)}`,
      };
    }

    const body = await readCapped(response, options.maxResponseBytes);

    return {
      ok: true,
      body: body.text,
      bodyBytes: body.bytes,
      contentType,
      status,
      finalUrl: guard.url.toString(),
      chain,
      connectedAddress: pinned.address,
      byteSize: body.byteSize,
      retrievedAt: new Date(),
      truncated: body.truncated,
    };
  }

  return {
    ok: false,
    code: 'too_many_redirects',
    reasonNl: 'Deze pagina verwijst te vaak door.',
    finding: `exceeded ${String(options.maxRedirects)} redirects`,
  };
}

function performRequest(
  url: URL,
  pinned: { address: string; family: 4 | 6 },
  timeoutMs: number,
): Promise<IncomingMessage> {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const request = send(
      url,
      {
        method: 'GET',
        // The validated address is dialled; the hostname still drives SNI and
        // certificate verification.
        lookup: pinnedLookup(pinned.address, pinned.family),
        family: pinned.family,
        timeout: Math.max(1, timeoutMs),
        headers: {
          // Identifies us honestly. No cookies, no authorization: nothing that
          // could be replayed against an internal host.
          'user-agent': 'Certify360-MarketingOS/0.1 (+research fetcher)',
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
          'accept-encoding': 'identity',
        },
      },
      resolve,
    );

    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });
    request.on('error', reject);
    request.end();
  });
}

/** Reads at most `cap` bytes, then stops the transfer. */
async function readCapped(
  response: IncomingMessage,
  cap: number,
): Promise<{ text: string; bytes: Buffer; byteSize: number; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;

  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    if (total + buffer.length > cap) {
      chunks.push(buffer.subarray(0, cap - total));
      total = cap;
      truncated = true;
      // Stop pulling: a hostile server would otherwise stream forever.
      response.destroy();
      break;
    }
    chunks.push(buffer);
    total += buffer.length;
  }

  const bytes = Buffer.concat(chunks);
  return { text: bytes.toString('utf8'), bytes, byteSize: total, truncated };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
