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
    // What it does have: copy, and why.
    expect(present.sort()).toEqual(['descriptions', 'headlines', 'keywords', 'rationaleNl']);
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
      'headlines',
      'keywords',
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
  it('states no character limit it has not verified', () => {
    /*
     * Unlike a social post, where a guessed length is cosmetic, an advert that
     * exceeds a platform limit is truncated or rejected. A number recalled from
     * memory would look checked and would not be — so every one of them is
     * null, deliberately.
     */
    for (const channel of AD_CHANNELS) {
      const spec = CHANNEL_CONFIG.formats.find(
        (item) => item.channel === channel && item.format === 'text_only',
      );
      expect(spec, channel).toBeDefined();
      expect(spec?.guidance.headlineMaxChars, channel).toBeNull();
      expect(spec?.guidance.bodyMaxChars, channel).toBeNull();
      expect(spec?.hard.sourceUrl, channel).toBeNull();
      expect(spec?.hard.verification, channel).toBe('unverified');
    }
  });

  it('produces advertising copy but refuses to call it publish-ready', () => {
    for (const channel of AD_CHANNELS) {
      expect(isPublishable(CHANNEL_CONFIG, channel, 'text_only'), channel).toBe(false);
    }
  });

  it('says in Dutch what has to be checked elsewhere, and that no figures exist', () => {
    for (const channel of AD_CHANNELS) {
      const spec = CHANNEL_CONFIG.formats.find(
        (item) => item.channel === channel && item.format === 'text_only',
      );
      // A refusal has to be actionable: it names the platform to go and check.
      expect(spec?.noteNl, channel).toMatch(/niet tegen een primaire bron gecontroleerd/u);
      expect(spec?.noteNl, channel).toMatch(/geen zoekvolumes, klikprijzen of conversie/u);
    }
  });
});
