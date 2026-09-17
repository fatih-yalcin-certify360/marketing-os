import type { FunnelStage } from './funnel.js';
import type { MarketingChannel } from './channels.js';

/**
 * Campaign tagging on an outgoing link.
 *
 * **No platform requires this.** LinkedIn documents tracking parameters as
 * something you may add, Google Ads enforces only that the display URL's domain
 * matches the final URL, and Meta's own parameters page could not be read at
 * all. So this is our choice, made for one reason: without it a click from an
 * exported post arrives in the website's analytics as "direct" and the campaign
 * that earned it cannot be told apart from any other (audit 2026-09-15).
 *
 * Two rules keep it honest. Parameters already on the link are never
 * overwritten — a marketer who tagged their own link meant it. And the stored
 * `copy.ctaUrl` is left exactly as approved; tagging happens on the way out, in
 * the export, where the package says so in writing.
 */

/** Where the click came from, in the vocabulary analytics tools expect. */
const SOURCE: Readonly<Record<MarketingChannel, string | null>> = Object.freeze({
  linkedin_organic: 'linkedin',
  instagram_organic: 'instagram',
  facebook_organic: 'facebook',
  linkedin_ads: 'linkedin',
  meta_ads: 'meta',
  google_search_ads: 'google',
  email: 'email',
  // The website pieces *are* the destination; tagging a link to itself measures
  // nothing and would pollute the page's own analytics.
  landing_page: null,
  course_page_update: null,
  blog_article: null,
});

/** How the click was earned or bought. */
const MEDIUM: Readonly<Record<MarketingChannel, string>> = Object.freeze({
  linkedin_organic: 'social',
  instagram_organic: 'social',
  facebook_organic: 'social',
  linkedin_ads: 'paid_social',
  meta_ads: 'paid_social',
  google_search_ads: 'cpc',
  email: 'email',
  landing_page: 'referral',
  course_page_update: 'referral',
  blog_article: 'referral',
});

/**
 * A lower-case, hyphenated form safe for a query value.
 *
 * Diacritics are folded rather than stripped, so "Bekendheid — september" and
 * "bekendheid-september" do not become two campaigns in a report.
 */
export function utmSlug(value: string, maxLength = 60): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, maxLength)
    .replace(/-+$/gu, '');
}

/**
 * Adds parameters to a url without disturbing what is already there.
 *
 * Written on strings rather than with `URL`, because this package compiles with
 * no DOM and no Node types on purpose — a contract should not depend on the
 * environment that happens to run it.
 */
function withParameters(url: string, parameters: readonly (readonly [string, string])[]): string {
  const hashAt = url.indexOf('#');
  const fragment = hashAt === -1 ? '' : url.slice(hashAt);
  const withoutFragment = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = withoutFragment.indexOf('?');
  const path = queryAt === -1 ? withoutFragment : withoutFragment.slice(0, queryAt);
  const query = queryAt === -1 ? '' : withoutFragment.slice(queryAt + 1);

  const present = new Set(
    query
      .split('&')
      .filter((pair) => pair.length > 0)
      .map((pair) => pair.split('=')[0] ?? ''),
  );
  const added = parameters
    .filter(([key]) => !present.has(key))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  const merged = [query, ...added].filter((part) => part.length > 0).join('&');
  return `${path}${merged.length > 0 ? `?${merged}` : ''}${fragment}`;
}

/** Whether a link already carries campaign tagging of its own. */
function alreadyTagged(url: string): boolean {
  const query = url.split('#')[0]?.split('?')[1] ?? '';
  return query
    .split('&')
    .some((pair) => (pair.split('=')[0] ?? '') === 'utm_source');
}

/**
 * The link as it should be published, with campaign tagging added.
 *
 * Returns the url unchanged when there is nothing to tag: an empty link, one
 * that is not http or https, a channel that is its own destination, or a link
 * that already carries `utm_source`.
 */
export function utmTaggedUrl(input: {
  url: string | null;
  channel: MarketingChannel;
  campaignName: string;
  stage: FunnelStage | null;
  /** The piece's stable key, so two posts of one cell can be told apart. */
  assetKey?: string | undefined;
}): string | null {
  const url = input.url;
  if (url === null || url.trim().length === 0) {
    return url;
  }
  const source = SOURCE[input.channel];
  if (source === null || !/^https?:\/\//iu.test(url) || alreadyTagged(url)) {
    return url;
  }

  const content = input.assetKey ?? input.stage;
  return withParameters(url, [
    ['utm_source', source],
    ['utm_medium', MEDIUM[input.channel]],
    ['utm_campaign', utmSlug(input.campaignName)],
    ...(content === null ? [] : [['utm_content', content] as const]),
  ]);
}
