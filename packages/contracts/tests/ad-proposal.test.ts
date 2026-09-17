import { describe, expect, it } from 'vitest';
import {
  CHANNEL_CONFIG,
  adProposal,
  contentCopy,
  isPublishable,
  type MarketingChannel,
} from '../src/index.js';

/**
 * An advertising proposal must not be able to carry a forecast.
 *
 * The rule is that this product produces no search volume, cost per click,
 * budget, reach or conversion figure. Those come from an advertising account
 * and a measurement period, and there is neither — so any number would be a
 * guess wearing the clothes of data, on precisely the kind of decision (a media
 * budget) that people make from a number without re-checking it.
 *
 * Instructing a model not to invent one is not the control. The control is that
 * **there is nowhere to put one**: a schema with no such field cannot carry it,
 * whatever a future edit to the prompt forgets. These tests hold that shape.
 */

const AD_CHANNELS: MarketingChannel[] = ['linkedin_ads', 'meta_ads', 'google_search_ads'];

/** Every field name anywhere in the proposal shape. */
function fieldNames(): string[] {
  return Object.keys(adProposal.shape);
}

describe('the advertising proposal shape', () => {
  it('has no field for any performance figure', () => {
    /*
     * Named rather than pattern-matched, so adding one is a deliberate act
     * that fails here and has to be argued for in a diff.
     */
    const forbidden = [
      'monthlyVolume', 'searchVolume', 'volume',
      'cpc', 'costPerClick', 'price', 'budget',
      'impressions', 'reach', 'clicks', 'ctr', 'clickThroughRate',
      'conversions', 'conversionRate', 'roas', 'roi', 'competition', 'difficulty',
    ];
    const present = fieldNames();
    for (const field of forbidden) {
      expect(present, field).not.toContain(field);
    }
    // What it does have: copy, the Search set-up fields (2026-09-15), and why.
    expect(present.sort()).toEqual([
      'descriptions',
      'finalUrl',
      'headlines',
      'keywords',
      'matchTypeAdviceNl',
      'negativeKeywords',
      'paths',
      'rationaleNl',
    ]);
  });

  it('refuses an extra field smuggled alongside the copy', () => {
    /*
     * Zod strips unknown keys by default, which would silently *accept* a
     * figure and drop it. Asserted so the behaviour is known: the value cannot
     * survive into stored content either way.
     */
    const parsed = adProposal.parse({
      headlines: ['Een kop'],
      descriptions: ['Een beschrijving die lang genoeg is.'],
      keywords: [],
      rationaleNl: 'Gebaseerd op de kernboodschap uit de briefing.',
      cpc: 1.25,
      monthlyVolume: 4000,
    });
    expect(Object.keys(parsed).sort()).toEqual([
      'descriptions',
      'finalUrl',
      'headlines',
      'keywords',
      'matchTypeAdviceNl',
      'negativeKeywords',
      'paths',
      'rationaleNl',
    ]);
    expect('cpc' in parsed).toBe(false);
  });

  it('keeps advertising copy out of the copy record for other channels', () => {
    // `ads` defaults to null, so a post cannot accidentally carry ad lines and
    // content stored before this field existed reads back unchanged.
    const copy = contentCopy.parse({
      hook: 'Kop',
      body: 'Tekst die lang genoeg is.',
      ctaText: 'Bekijk',
      ctaUrl: null,
      imageAltText: null,
      hashtags: [],
    });
    expect(copy.ads).toBeNull();
    expect(copy.sections).toEqual([]);
  });
});

describe('the advertising channels', () => {
  /**
   * All three were read against their platform's own page on 2026-09-15.
   *
   * LinkedIn Ads and Meta Ads were `unverified` until then, and worse, they
   * shipped copy with no creative at all — which is not an advertisement. The
   * point of this block is that a stated limit is always a *read* limit: every
   * number here has a `sourceUrl` and a `verifiedAt` beside it.
   */
  it('states the limits it read, each with the page it read them on', () => {
    const linkedIn = CHANNEL_CONFIG.formats.find(
      (item) => item.channel === 'linkedin_ads' && item.format === 'single_image',
    );
    expect(linkedIn?.guidance.headlineMaxChars).toBe(200);
    expect(linkedIn?.guidance.bodyTruncatesAtChars).toBe(150);
    expect(linkedIn?.hard.maxImageBytes).toBe(5 * 1_048_576);
    expect(linkedIn?.hard.sourceUrl).toMatch(/^https:\/\/www\.linkedin\.com\/help\/lms\/answer\/a426534/u);
    expect(linkedIn?.hard.verifiedAt).toBe('2026-09-15T00:00:00.000Z');

    const meta = CHANNEL_CONFIG.formats.find(
      (item) => item.channel === 'meta_ads' && item.format === 'single_image',
    );
    // The tighter of the two placements, because one creative runs on both.
    expect(meta?.guidance.headlineMaxChars).toBe(27);
    expect(meta?.guidance.bodyTruncatesAtChars).toBe(125);
    expect(meta?.hard.sourceUrl).toMatch(/^https:\/\/www\.facebook\.com\/business\/ads-guide/u);
    expect(meta?.hard.verifiedAt).toBe('2026-09-15T00:00:00.000Z');
  });

  it('states Google’s limits only because they were read on Google’s page, and says which page', () => {
    // google-ads-practice.md, read 2026-09-15.
    const spec = CHANNEL_CONFIG.formats.find(
      (item) => item.channel === 'google_search_ads' && item.format === 'text_only',
    );
    expect(spec?.guidance.headlineMaxChars).toBe(30);
    expect(spec?.guidance.bodyMaxChars).toBe(90);
    expect(spec?.hard.verification).toBe('verified_against_official_docs');
    expect(spec?.hard.sourceUrl).toMatch(/^https:\/\/support\.google\.com\/google-ads\/answer\/7684791/u);
    expect(spec?.hard.verifiedAt).toBe('2026-09-15T00:00:00.000Z');
  });

  it('gives the paid social channels a creative, and leaves the search ad as text', () => {
    /*
     * A Meta advertisement cannot run without an image or a video, and
     * LinkedIn lists the image as required. Both shipped headlines and
     * descriptions and nothing else until 2026-09-15. A search advertisement
     * really is text, so it keeps no image.
     */
    const meta = CHANNEL_CONFIG.formats.find(
      (item) => item.channel === 'meta_ads' && item.format === 'single_image',
    );
    expect(meta?.guidance.images).toEqual([
      { widthPx: 1440, heightPx: 1800, aspectRatioLabel: '4:5', isDefault: true },
    ]);

    const linkedIn = CHANNEL_CONFIG.formats.find(
      (item) => item.channel === 'linkedin_ads' && item.format === 'single_image',
    );
    expect(linkedIn?.guidance.images.map((image) => image.aspectRatioLabel)).toEqual([
      '1.91:1',
      '1:1',
      '4:5',
    ]);

    const google = CHANNEL_CONFIG.formats.find(
      (item) => item.channel === 'google_search_ads' && item.format === 'text_only',
    );
    expect(google?.guidance.images).toEqual([]);
  });

  it('now lets all three advertising channels reach a publish-ready package', () => {
    expect(isPublishable(CHANNEL_CONFIG, 'linkedin_ads', 'single_image')).toBe(true);
    expect(isPublishable(CHANNEL_CONFIG, 'meta_ads', 'single_image')).toBe(true);
    expect(isPublishable(CHANNEL_CONFIG, 'google_search_ads', 'text_only')).toBe(true);
  });

  it('says in Dutch what the platform enforces, and that no figures exist', () => {
    for (const channel of AD_CHANNELS) {
      const spec = CHANNEL_CONFIG.formats.find(
        (item) => item.channel === channel && item.format === (channel === 'google_search_ads' ? 'text_only' : 'single_image'),
      );
      expect(spec?.noteNl, channel).toMatch(/zoekvolumes, klikprijzen/u);
    }
  });
});
