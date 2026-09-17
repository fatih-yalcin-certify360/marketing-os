import { describe, expect, it } from 'vitest';
import {
  CHANNEL_CONFIG,
  GOOGLE_RSA,
  findChannelSpec,
  googleAdsFrame,
  googleAdsFrameText,
  isPublishable,
  promisesInteractiveForm,
} from '../src/index.js';

/**
 * Google Ads as the contract states it (google-ads-practice.md, read
 * 2026-09-15): the frame per stage, the verified channel specification and
 * the interactive-promise helper the campaign screen uses.
 */
describe('googleAdsFrame', () => {
  it('says Search is not the channel for Ontdekken and Search-first for the two later stages', () => {
    expect(googleAdsFrame('discover').fit).toBe('not_search');
    expect(googleAdsFrame('discover').campaignTypeNl).toMatch(/Demand Gen/u);
    expect(googleAdsFrame('consider').fit).toBe('search_first');
    expect(googleAdsFrame('consider').campaignGoalNl).toMatch(/Leads/u);
    expect(googleAdsFrame('decide').campaignGoalNl).toBe('Leads');
    expect(googleAdsFrame('decide').conversionActionsNl.join(' ')).toMatch(/Verbeterde conversies/u);
  });

  it('names a source for every frame and carries no figure it cannot know', () => {
    for (const stage of ['discover', 'consider', 'decide'] as const) {
      const frame = googleAdsFrame(stage);
      expect(frame.sources.length).toBeGreaterThan(2);
      for (const source of frame.sources) expect(source.url).toMatch(/^https:\/\/(support\.google\.com|www\.google\.com)\//u);
      expect(frame.complianceNl.join(' ')).toMatch(/Toestemmingsmodus v2/u);
      // No click price, volume or conversion rate anywhere.
      expect(JSON.stringify(frame)).not.toMatch(/€|CPC van|zoekvolume van \d/u);
    }
    const text = googleAdsFrameText('consider');
    expect(text).toMatch(/^Google Ads-kader · fase consider/u);
    expect(text).toMatch(/Bronnen \(gelezen 2026-09-15\)/u);
  });
});

describe('the Google Search Ads channel specification', () => {
  it('is verified against Google’s page, carries the documented limits and is therefore publishable', () => {
    const spec = findChannelSpec(CHANNEL_CONFIG, 'google_search_ads', 'text_only');
    expect(spec?.hard.verification).toBe('verified_against_official_docs');
    expect(spec?.hard.sourceUrl).toBe(GOOGLE_RSA.source.url);
    expect(spec?.guidance.headlineMaxChars).toBe(30);
    expect(spec?.guidance.bodyMaxChars).toBe(90);
    expect(isPublishable(CHANNEL_CONFIG, 'google_search_ads', 'text_only')).toBe(true);
    // 10: paid social verified and given a creative, then the website split
    //     into a course-page change and a blog article (2026-09-15).
    expect(CHANNEL_CONFIG.version).toBe(10);
    // The other two advertising channels were read against their own platform
    // pages on the same day and are publishable too; `ad-proposal.test.ts`
    // holds their limits and their creative.
    expect(isPublishable(CHANNEL_CONFIG, 'meta_ads', 'text_only')).toBe(true);
  });
});

describe('promisesInteractiveForm', () => {
  it('recognises a call to action that promises a keuzehulp or quiz', () => {
    expect(promisesInteractiveForm(['Bekijk de keuzehulp: past CROV bij mijn overstap?'])).toBe(true);
    expect(promisesInteractiveForm(['Doe de quiz', null])).toBe(true);
    expect(promisesInteractiveForm(['Bekijk de opleiding'])).toBe(false);
    expect(promisesInteractiveForm(['Lees de testimonial'])).toBe(false);
  });
});
