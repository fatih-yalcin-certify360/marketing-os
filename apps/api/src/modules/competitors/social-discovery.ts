import type { ServerEnv } from '@c360/config';
import { safeFetch } from '../../core/net/safe-fetch.js';

/** The research fetch settings, shared with the course-page reader. */
type FetchEnv = Pick<
  ServerEnv,
  | 'RESEARCH_ALLOWED_HOST_SUFFIXES'
  | 'RESEARCH_ALLOW_HTTP'
  | 'RESEARCH_FETCH_TIMEOUT_MS'
  | 'RESEARCH_MAX_RESPONSE_BYTES'
  | 'RESEARCH_MAX_REDIRECTS'
>;

/**
 * Finding an organisation's social pages by reading its own website.
 *
 * **Read, never guessed.** The obvious alternative is to ask the model for the
 * LinkedIn page of a company, and it will happily produce a plausible URL that
 * belongs to someone else. Every link here was published by the organisation on
 * a page we fetched, and the page it came from travels with it — the same rule
 * the rest of the radar works by.
 *
 * Bounded on purpose: at most two pages per organisation, the URL that was
 * given and its site root. A crawler is a different product with different
 * obligations.
 */

export type SocialPlatform = 'linkedin' | 'facebook' | 'instagram';

export interface SocialFinding {
  platform: SocialPlatform;
  url: string;
  /** The page this link was published on, for the evidence trail. */
  foundOnUrl: string;
}

export interface SocialDiscovery {
  findings: SocialFinding[];
  /** Pages actually read, in order. */
  checkedUrls: string[];
  /** Why a page could not be read, in Dutch, safe to show. */
  failuresNl: string[];
}

/** Host of an https URL, lower-case and without a trailing dot. */
function hostOf(url: string): string {
  return (url.replace(/^https:\/\//iu, '').split(/[/?#]/u)[0] ?? '')
    .toLowerCase()
    .replace(/:\d+$/u, '')
    .replace(/\.$/u, '');
}

/**
 * Whether a link is an organisation page rather than a share button or a post.
 *
 * Share widgets are the reason this is not a simple host match: nearly every
 * page carries `facebook.com/sharer.php?u=…`, which is a link to *our* content
 * on Facebook, not to the organisation.
 */
function classify(url: string): SocialPlatform | null {
  const host = hostOf(url);
  const path = url.replace(/^https:\/\/[^/]*/iu, '').split(/[?#]/u)[0] ?? '';

  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    // The contract accepts only an organisation page, so nothing else qualifies.
    return /^\/(?:company|school)\/[^/]+\/?$/u.test(path) ? 'linkedin' : null;
  }
  if (host === 'facebook.com' || host.endsWith('.facebook.com')) {
    if (/^\/(?:sharer|share|dialog|plugins|tr|login|help|policies)\b/u.test(path)) return null;
    return /^\/[^/]+\/?$/u.test(path) ? 'facebook' : null;
  }
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    // A post, a reel or the explore page is not the account.
    if (/^\/(?:p|reel|reels|explore|accounts|stories)\b/u.test(path)) return null;
    return /^\/[^/]+\/?$/u.test(path) ? 'instagram' : null;
  }
  return null;
}

/** Normalised to the form the competitor contract stores: https, no query, no trailing slash. */
function canonical(url: string): string {
  const withoutFragment = url.split('#')[0] ?? url;
  const withoutQuery = withoutFragment.split('?')[0] ?? withoutFragment;
  const https = withoutQuery.replace(/^http:\/\//iu, 'https://');
  return https.replace(/\/+$/u, '');
}

/**
 * Every organisation social link in one HTML document.
 *
 * Deliberately a regular expression over `href` values rather than a parser: we
 * need the links and nothing else, the input is untrusted, and a parser would
 * be a new dependency and a new attack surface for one job.
 */
export function socialLinksInHtml(html: string, foundOnUrl: string): SocialFinding[] {
  const seen = new Set<string>();
  const findings: SocialFinding[] = [];
  for (const match of html.matchAll(/href\s*=\s*["']([^"']{6,2048})["']/giu)) {
    const raw = (match[1] ?? '').trim();
    if (!/^https?:\/\//iu.test(raw)) continue;
    const url = canonical(raw);
    const platform = classify(url);
    if (platform === null || seen.has(url)) continue;
    seen.add(url);
    findings.push({ platform, url, foundOnUrl });
  }
  return findings;
}

/** The site root of a URL, when the URL itself is a deeper page. */
function rootOf(url: string): string | null {
  const host = hostOf(url);
  if (host.length === 0) return null;
  const root = `https://${host}`;
  return canonical(url) === root ? null : root;
}

/**
 * Reads an organisation's website and returns the social pages it publishes.
 *
 * One fetch for the given URL and, if that URL is a deeper page, one for the
 * site root — footers carry the social links and a deep page may not have one.
 * A page that cannot be read is reported rather than swallowed: "nothing found"
 * and "could not look" are different answers.
 */
export async function discoverSocialLinks(
  websiteUrl: string,
  env: FetchEnv,
): Promise<SocialDiscovery> {
  const targets = [canonical(websiteUrl), rootOf(websiteUrl)].filter(
    (value): value is string => value !== null,
  );

  const findings: SocialFinding[] = [];
  const checkedUrls: string[] = [];
  const failuresNl: string[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    const result = await safeFetch(target, {
      allowedHostSuffixes: env.RESEARCH_ALLOWED_HOST_SUFFIXES,
      allowInsecureHttp: env.RESEARCH_ALLOW_HTTP,
      timeoutMs: env.RESEARCH_FETCH_TIMEOUT_MS,
      maxResponseBytes: env.RESEARCH_MAX_RESPONSE_BYTES,
      maxRedirects: env.RESEARCH_MAX_REDIRECTS,
      allowedContentTypes: ['text/html', 'application/xhtml+xml'],
    });
    if (!result.ok) {
      failuresNl.push(`${target}: ${result.reasonNl}`);
      continue;
    }
    checkedUrls.push(result.finalUrl);
    for (const finding of socialLinksInHtml(result.body, result.finalUrl)) {
      if (seen.has(finding.url)) continue;
      seen.add(finding.url);
      findings.push(finding);
    }
    // The first page that yields all three needs no second fetch.
    if (new Set(findings.map((item) => item.platform)).size === 3) break;
  }

  return { findings, checkedUrls, failuresNl };
}
