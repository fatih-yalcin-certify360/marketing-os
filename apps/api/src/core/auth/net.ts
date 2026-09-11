import { BlockList, isIPv4, isIPv6 } from 'node:net';

/**
 * IP allow-listing for the trusted-proxy check.
 *
 * Only the *socket peer address* is ever tested. Forwarded-for headers are
 * ignored on purpose: they are client-controlled, so trusting them would
 * reintroduce exactly the spoofing risk this check exists to remove.
 */

export interface ParsedRule {
  kind: 'exact' | 'cidr';
  value: string;
  prefix?: number;
  family: 'ipv4' | 'ipv6';
}

export function parseTrustRules(rules: readonly string[]): ParsedRule[] {
  const parsed: ParsedRule[] = [];
  for (const raw of rules) {
    const rule = raw.trim();
    if (rule.length === 0) {
      continue;
    }
    const slash = rule.indexOf('/');
    if (slash === -1) {
      const family = detectFamily(rule);
      if (family === undefined) {
        throw new Error(`TRUSTED_PROXY_IPS contains an entry that is not an IP address: ${rule}`);
      }
      parsed.push({ kind: 'exact', value: rule, family });
      continue;
    }
    const address = rule.slice(0, slash);
    const prefix = Number.parseInt(rule.slice(slash + 1), 10);
    const family = detectFamily(address);
    if (family === undefined || !Number.isInteger(prefix)) {
      throw new Error(`TRUSTED_PROXY_IPS contains an invalid CIDR: ${rule}`);
    }
    const maxPrefix = family === 'ipv4' ? 32 : 128;
    if (prefix < 0 || prefix > maxPrefix) {
      throw new Error(`TRUSTED_PROXY_IPS CIDR prefix out of range: ${rule}`);
    }
    parsed.push({ kind: 'cidr', value: address, prefix, family });
  }
  return parsed;
}

function detectFamily(address: string): 'ipv4' | 'ipv6' | undefined {
  if (isIPv4(address)) {
    return 'ipv4';
  }
  if (isIPv6(address)) {
    return 'ipv6';
  }
  return undefined;
}

/**
 * Normalises an address before comparison. Node reports IPv4 peers of a
 * dual-stack listener as `::ffff:10.0.0.1`; without this, an allow-list entry
 * of `10.0.0.1` would silently never match.
 */
export function normaliseAddress(address: string): string {
  const trimmed = address.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(trimmed);
  if (mapped?.[1] !== undefined && isIPv4(mapped[1])) {
    return mapped[1];
  }
  // Strip an IPv6 zone index, e.g. fe80::1%eth0.
  const percent = trimmed.indexOf('%');
  return percent === -1 ? trimmed : trimmed.slice(0, percent);
}

export class TrustedProxyMatcher {
  private readonly blockList = new BlockList();
  private readonly hasRules: boolean;

  constructor(rules: readonly string[]) {
    const parsed = parseTrustRules(rules);
    this.hasRules = parsed.length > 0;
    for (const rule of parsed) {
      if (rule.kind === 'exact') {
        this.blockList.addAddress(rule.value, rule.family === 'ipv4' ? 'ipv4' : 'ipv6');
      } else {
        this.blockList.addSubnet(
          rule.value,
          rule.prefix ?? 32,
          rule.family === 'ipv4' ? 'ipv4' : 'ipv6',
        );
      }
    }
  }

  /** Deny-by-default: an empty rule set trusts nobody. */
  isTrusted(remoteAddress: string | undefined): boolean {
    if (!this.hasRules || remoteAddress === undefined) {
      return false;
    }
    const address = normaliseAddress(remoteAddress);
    const family = detectFamily(address);
    if (family === undefined) {
      return false;
    }
    return this.blockList.check(address, family === 'ipv4' ? 'ipv4' : 'ipv6');
  }
}
