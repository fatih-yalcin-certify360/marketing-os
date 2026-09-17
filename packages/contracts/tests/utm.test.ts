import { describe, expect, it } from 'vitest';
import { utmSlug, utmTaggedUrl } from '../src/utm.js';

/**
 * Campaign tagging on an outgoing link.
 *
 * No platform requires it, so the rules here are ours, and two of them matter
 * more than the tagging itself: a link the marketer already tagged is never
 * touched, and anything that is not a plain http(s) link is left exactly as it
 * was rather than guessed at.
 */
describe('utmTaggedUrl', () => {
  const base = {
    channel: 'linkedin_organic' as const,
    campaignName: 'Bekendheid — september 2026',
    stage: 'discover' as const,
    assetKey: 'discover-linkedin_organic-1',
  };

  it('tags a plain link with source, medium, campaign and the piece', () => {
    const tagged = utmTaggedUrl({ ...base, url: 'https://cs-opleidingen.nl/crov' });
    expect(tagged).toBe(
      'https://cs-opleidingen.nl/crov?utm_source=linkedin&utm_medium=social&utm_campaign=bekendheid-september-2026&utm_content=discover-linkedin_organic-1',
    );
  });

  it('keeps existing query parameters and the fragment', () => {
    const tagged = utmTaggedUrl({ ...base, url: 'https://example.nl/a?x=1#blok' });
    expect(tagged).toContain('x=1');
    expect(tagged?.endsWith('#blok')).toBe(true);
  });

  it('leaves a link the marketer already tagged completely alone', () => {
    const own = 'https://example.nl/a?utm_source=nieuwsbrief&utm_medium=eigen';
    expect(utmTaggedUrl({ ...base, url: own })).toBe(own);
  });

  it('does not tag the website piece, which is the destination itself', () => {
    const url = 'https://cs-opleidingen.nl/crov';
    expect(utmTaggedUrl({ ...base, channel: 'landing_page', url })).toBe(url);
  });

  it('separates paid from organic, and search from social', () => {
    const paid = utmTaggedUrl({ ...base, channel: 'meta_ads', url: 'https://example.nl/a' });
    expect(paid).toContain('utm_source=meta');
    expect(paid).toContain('utm_medium=paid_social');

    const search = utmTaggedUrl({ ...base, channel: 'google_search_ads', url: 'https://example.nl/a' });
    expect(search).toContain('utm_medium=cpc');
  });

  it('returns anything it cannot safely parse unchanged', () => {
    expect(utmTaggedUrl({ ...base, url: null })).toBeNull();
    expect(utmTaggedUrl({ ...base, url: '' })).toBe('');
    expect(utmTaggedUrl({ ...base, url: '/relatief/pad' })).toBe('/relatief/pad');
    expect(utmTaggedUrl({ ...base, url: 'javascript:alert(1)' })).toBe('javascript:alert(1)');
  });
});

describe('utmSlug', () => {
  it('folds diacritics instead of dropping them, so one campaign stays one row', () => {
    expect(utmSlug('Bekendheid — september 2026')).toBe('bekendheid-september-2026');
    expect(utmSlug('Één protocol, drie werkvloeren')).toBe('een-protocol-drie-werkvloeren');
  });

  it('never ends on a separator, however it was truncated', () => {
    expect(utmSlug('a'.repeat(60) + ' staart', 62).endsWith('-')).toBe(false);
  });
});
