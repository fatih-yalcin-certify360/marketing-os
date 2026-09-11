import { BlockList, isIPv4, isIPv6 } from 'node:net';
import { normaliseAddress } from '../auth/net.js';

/**
 * Which IP addresses we refuse to connect to.
 *
 * This is the core of SSRF defence (threat T-06). The attack is simple: a user
 * supplies a URL, we fetch it from inside the deployment network, and the
 * response — or merely the fact that the connection succeeded — tells them
 * about hosts they could never reach themselves. The cloud metadata service is
 * the classic prize, because on an unhardened instance it hands out
 * credentials.
 *
 * So the rule is **deny by default on the resolved address**, not on the
 * hostname. A hostname tells us nothing: `evil.example` can have an A record
 * pointing at `169.254.169.254`, and a name that resolved publicly a second ago
 * can resolve internally now.
 *
 * ## What is blocked, and why each entry is here
 *
 * Beyond the obvious loopback and RFC 1918 ranges:
 *
 *  - **169.254.0.0/16** covers `169.254.169.254` (AWS, GCP, Azure IMDS) and
 *    `169.254.170.2` (ECS task credentials).
 *  - **100.64.0.0/10** is carrier-grade NAT, and also contains Alibaba's
 *    `100.100.100.200` metadata endpoint.
 *  - **192.0.0.0/24** contains Oracle Cloud's `192.0.0.192`.
 *  - **fc00::/7** contains AWS's IPv6 IMDS at `fd00:ec2::254`.
 *  - **NAT64, Teredo and 6to4 prefixes** embed an IPv4 address inside an IPv6
 *    one. Rather than decode and re-check the embedded address, the whole
 *    prefix is refused: nothing this product does needs to reach a host through
 *    a translation prefix, and decoding is a place to make a mistake.
 *  - **::ffff:0:0/96** is a backstop. `normaliseAddress` rewrites the dotted
 *    form (`::ffff:127.0.0.1`) to IPv4 so the IPv4 rules catch it, but the same
 *    address can be written in hex (`::ffff:7f00:1`). Blocking the range means
 *    the textual form cannot matter.
 *
 * The ranges are not a policy choice to be tuned per deployment; they are
 * addresses that are either unroutable on the public internet or belong to
 * infrastructure. A deployment that genuinely needs to fetch from an internal
 * host should use the hostname allow-list, deliberately, rather than widen
 * this.
 */

export type AddressFamily = 'ipv4' | 'ipv6';

interface Range {
  readonly cidr: string;
  readonly prefix: number;
  readonly family: AddressFamily;
  /** Dutch is not needed here: this never reaches a user verbatim. */
  readonly why: string;
}

const IPV4_RANGES: readonly Range[] = Object.freeze([
  { cidr: '0.0.0.0', prefix: 8, family: 'ipv4', why: 'this-network' },
  { cidr: '10.0.0.0', prefix: 8, family: 'ipv4', why: 'private (RFC 1918)' },
  { cidr: '100.64.0.0', prefix: 10, family: 'ipv4', why: 'carrier-grade NAT / Alibaba metadata' },
  { cidr: '127.0.0.0', prefix: 8, family: 'ipv4', why: 'loopback' },
  { cidr: '169.254.0.0', prefix: 16, family: 'ipv4', why: 'link-local / cloud metadata' },
  { cidr: '172.16.0.0', prefix: 12, family: 'ipv4', why: 'private (RFC 1918)' },
  { cidr: '192.0.0.0', prefix: 24, family: 'ipv4', why: 'IETF protocol assignments / Oracle metadata' },
  { cidr: '192.0.2.0', prefix: 24, family: 'ipv4', why: 'documentation (TEST-NET-1)' },
  { cidr: '192.88.99.0', prefix: 24, family: 'ipv4', why: '6to4 relay anycast' },
  { cidr: '192.168.0.0', prefix: 16, family: 'ipv4', why: 'private (RFC 1918)' },
  { cidr: '198.18.0.0', prefix: 15, family: 'ipv4', why: 'benchmarking' },
  { cidr: '198.51.100.0', prefix: 24, family: 'ipv4', why: 'documentation (TEST-NET-2)' },
  { cidr: '203.0.113.0', prefix: 24, family: 'ipv4', why: 'documentation (TEST-NET-3)' },
  { cidr: '224.0.0.0', prefix: 4, family: 'ipv4', why: 'multicast' },
  { cidr: '240.0.0.0', prefix: 4, family: 'ipv4', why: 'reserved' },
]);

const IPV6_RANGES: readonly Range[] = Object.freeze([
  { cidr: '::', prefix: 128, family: 'ipv6', why: 'unspecified' },
  { cidr: '::1', prefix: 128, family: 'ipv6', why: 'loopback' },
  { cidr: '::', prefix: 96, family: 'ipv6', why: 'IPv4-compatible (deprecated)' },
  { cidr: '::ffff:0:0', prefix: 96, family: 'ipv6', why: 'IPv4-mapped' },
  { cidr: '64:ff9b::', prefix: 96, family: 'ipv6', why: 'NAT64 translation prefix' },
  { cidr: '100::', prefix: 64, family: 'ipv6', why: 'discard-only' },
  { cidr: '2001::', prefix: 32, family: 'ipv6', why: 'Teredo tunnelling' },
  { cidr: '2001:10::', prefix: 28, family: 'ipv6', why: 'ORCHID' },
  { cidr: '2001:20::', prefix: 28, family: 'ipv6', why: 'ORCHIDv2' },
  { cidr: '2001:db8::', prefix: 32, family: 'ipv6', why: 'documentation' },
  { cidr: '2002::', prefix: 16, family: 'ipv6', why: '6to4 tunnelling' },
  { cidr: 'fc00::', prefix: 7, family: 'ipv6', why: 'unique local / AWS IPv6 metadata' },
  { cidr: 'fe80::', prefix: 10, family: 'ipv6', why: 'link-local' },
  { cidr: 'ff00::', prefix: 8, family: 'ipv6', why: 'multicast' },
]);

/** Exact addresses worth naming, even though a range above already covers them. */
const NAMED_METADATA: Readonly<Record<string, string>> = Object.freeze({
  '169.254.169.254': 'cloud metadata service (AWS/GCP/Azure)',
  '169.254.170.2': 'ECS task credential endpoint',
  '100.100.100.200': 'Alibaba Cloud metadata',
  '192.0.0.192': 'Oracle Cloud metadata',
  'fd00:ec2::254': 'AWS IPv6 metadata',
});

/**
 * One list per family, and they must stay separate.
 *
 * `BlockList` treats an IPv6 subnet as covering the IPv4 addresses it can
 * represent, so a single list containing `::/96` (the IPv4-compatible range)
 * matches **every** IPv4 address — which silently refuses the entire public
 * internet. Found by a test asserting that `93.184.216.34` is allowed.
 *
 * Keeping them apart also makes the check exact: an IPv4 address is compared
 * only against IPv4 rules, an IPv6 address only against IPv6 rules, and an
 * IPv4-mapped address is handled by whichever list its normalised form belongs
 * to.
 */
function buildBlockList(ranges: readonly Range[], extraAddresses: readonly string[] = []): BlockList {
  const list = new BlockList();
  for (const range of ranges) {
    if (range.prefix === 128 || (range.family === 'ipv4' && range.prefix === 32)) {
      list.addAddress(range.cidr, range.family);
    } else {
      list.addSubnet(range.cidr, range.prefix, range.family);
    }
  }
  for (const address of extraAddresses) {
    list.addAddress(address, ranges[0]?.family ?? 'ipv4');
  }
  return list;
}

// The limited broadcast address is not covered by any range above.
const BLOCKED_IPV4 = buildBlockList(IPV4_RANGES, ['255.255.255.255']);
const BLOCKED_IPV6 = buildBlockList(IPV6_RANGES);

export interface AddressVerdict {
  readonly allowed: boolean;
  /** Set when refused. Internal detail — never returned to a client verbatim. */
  readonly why?: string;
  /** The form actually compared, after normalisation. */
  readonly normalised: string;
  readonly family?: AddressFamily;
}

/**
 * Decides whether we may connect to an address.
 *
 * Refuses anything that is not a well-formed IP: this is called on the output
 * of DNS resolution, so an unparseable value means something is wrong rather
 * than that we should try our luck.
 */
export function classifyAddress(address: string): AddressVerdict {
  const normalised = normaliseAddress(address);

  const named = NAMED_METADATA[normalised.toLowerCase()];
  if (named !== undefined) {
    return { allowed: false, why: named, normalised };
  }

  if (isIPv4(normalised)) {
    return BLOCKED_IPV4.check(normalised, 'ipv4')
      ? { allowed: false, why: reasonFor(normalised, 'ipv4'), normalised, family: 'ipv4' }
      : { allowed: true, normalised, family: 'ipv4' };
  }

  if (isIPv6(normalised)) {
    return BLOCKED_IPV6.check(normalised, 'ipv6')
      ? { allowed: false, why: reasonFor(normalised, 'ipv6'), normalised, family: 'ipv6' }
      : { allowed: true, normalised, family: 'ipv6' };
  }

  return { allowed: false, why: 'not a valid IP address', normalised };
}

/** The most specific matching range, for the log line. */
function reasonFor(address: string, family: AddressFamily): string {
  const ranges = family === 'ipv4' ? IPV4_RANGES : IPV6_RANGES;
  let best: Range | undefined;
  for (const range of ranges) {
    const single = new BlockList();
    if (range.prefix === 128 || (range.family === 'ipv4' && range.prefix === 32)) {
      single.addAddress(range.cidr, range.family);
    } else {
      single.addSubnet(range.cidr, range.prefix, range.family);
    }
    if (single.check(address, family) && (best === undefined || range.prefix > best.prefix)) {
      best = range;
    }
  }
  return best === undefined ? 'blocked address' : `${best.why} (${best.cidr}/${String(best.prefix)})`;
}

/**
 * Whether an address is loopback, and nothing wider.
 *
 * Used only by the test escape hatch. Kept separate from `classifyAddress` so
 * the hatch can open loopback *without* opening private ranges or link-local —
 * which matters because the metadata service is link-local, and "does a
 * redirect to the metadata service get refused?" is precisely what the tests
 * need to be able to ask.
 */
export function isLoopbackAddress(address: string): boolean {
  const normalised = normaliseAddress(address);
  if (isIPv4(normalised)) {
    const loopback = new BlockList();
    loopback.addSubnet('127.0.0.0', 8, 'ipv4');
    return loopback.check(normalised, 'ipv4');
  }
  if (isIPv6(normalised)) {
    const loopback = new BlockList();
    loopback.addAddress('::1', 'ipv6');
    return loopback.check(normalised, 'ipv6');
  }
  return false;
}

/** Exposed so a test can assert the table rather than restate it. */
export const BLOCKED_RANGES: readonly Range[] = Object.freeze([...IPV4_RANGES, ...IPV6_RANGES]);
export const NAMED_METADATA_ADDRESSES: readonly string[] = Object.freeze(
  Object.keys(NAMED_METADATA),
);
