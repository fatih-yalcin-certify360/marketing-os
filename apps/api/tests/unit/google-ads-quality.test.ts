import { describe, expect, it } from 'vitest';
import { adProposal, contentCopy, type AdProposal, type ContentCopy } from '@c360/contracts';
import { checkCopyShape, checkGoogleAdsContext, checkGoogleAdsShape, repairableProblems } from '../../src/modules/content-assets/quality.js';

/**
 * A Google Search ad against Google's documented limits and policy
 * (google-ads-practice.md, read 2026-09-15). Each rule that sends a piece
 * back to the model has a case here.
 */
const good = (over: Partial<AdProposal> = {}): AdProposal =>
  adProposal.parse({
    headlines: [
      'Opleiding casemanager verzuim',
      'CROV: inhoud en opzet',
      'Opleiding CROV',
      'Wat leer je bij CROV?',
      'Voor wie het werk al doet',
      'Bekijk inhoud en voorwaarden',
      'Leer het kader onder je werk',
      'Vergelijk en kies bewust',
    ],
    descriptions: [
      'Zie wat de opleiding inhoudt en wat er van je gevraagd wordt, op de opleidingspagina.',
      'Bekijk de inhoud, de voorwaarden en de studielast voordat je kiest.',
      'Voor wie het werk al doet en het kader onder de praktijk wil leggen.',
    ],
    keywords: ['opleiding casemanager verzuim', 'crov'],
    paths: ['opleiding', 'crov'],
    negativeKeywords: ['vacature', 'salaris'],
    matchTypeAdviceNl: 'Woordgroep per thema; exact op de naam.',
    finalUrl: 'https://example.org/crov',
    rationaleNl: 'Koppen volgen de kernboodschap en het kader voor Overwegen.',
    ...over,
  });

describe('checkGoogleAdsShape', () => {
  it('accepts a responsive search ad within the limits', () => {
    expect(checkGoogleAdsShape(good())).toEqual([]);
  });

  it('refuses a missing or thin ad', () => {
    expect(checkGoogleAdsShape(null).map((w) => w.kind)).toEqual(['ad_assets_missing']);
    const thin = checkGoogleAdsShape(good({ headlines: good().headlines.slice(0, 3), descriptions: good().descriptions.slice(0, 2) }));
    expect(thin.map((w) => w.kind)).toEqual(['ad_assets_missing', 'ad_assets_missing']);
    expect(thin[0]?.messageNl).toMatch(/minimaal 8/u);
  });

  it('measures every line against Google’s limits and names the line', () => {
    const long = checkGoogleAdsShape(
      good({
        headlines: [...good().headlines.slice(0, 7), 'Een kop die veel te lang is voor Google Ads'],
        descriptions: [...good().descriptions.slice(0, 2), 'Deze beschrijving is te lang: '.repeat(4)],
        paths: ['een-veel-te-lang-pad'],
      }),
    );
    expect(long.map((w) => w.kind)).toEqual(['ad_headline_too_long', 'ad_description_too_long', 'ad_policy_risk']);
    expect(long[0]?.messageNl).toContain('Een kop die veel te lang is voor Google Ads');
    expect(long[0]?.messageNl).toMatch(/maximaal 30/u);
  });

  it('flags what Google’s editorial policy refuses: exclamation marks, repeated punctuation, shouting, superlatives', () => {
    const risky = checkGoogleAdsShape(
      good({
        headlines: [...good().headlines.slice(0, 7), 'Schrijf je nu in!'],
        descriptions: [...good().descriptions.slice(0, 2), 'Dé opleiding voor VERZUIMEXPERTS die het beste willen?? Ja.'],
      }),
    );
    const kinds = risky.map((w) => w.kind);
    expect(kinds.filter((kind) => kind === 'ad_policy_risk').length).toBeGreaterThanOrEqual(3);
    expect(kinds).toContain('marketese');
    expect(risky.map((w) => w.messageNl).join(' ')).toMatch(/uitroepteken/u);
    expect(risky.map((w) => w.messageNl).join(' ')).toMatch(/VERZUIMEXPERTS/u);
  });

  it('wants a search phrase inside a headline', () => {
    expect(checkGoogleAdsShape(good({ keywords: [] })).map((w) => w.kind)).toEqual(['ad_keyword_missing']);
    expect(checkGoogleAdsShape(good({ keywords: ['iets heel anders'] })).map((w) => w.kind)).toEqual(['ad_keyword_missing']);
  });
});

describe('checkGoogleAdsContext', () => {
  it('lets a number through only when the course card carries it', () => {
    const ads = good({ descriptions: [...good().descriptions.slice(0, 2), 'Start op 12 januari; 8 lesdagen.'] });
    const facts = ['De opleiding start op 12 januari.'];
    const warnings = checkGoogleAdsContext(ads, { courseFacts: facts });
    expect(warnings.map((w) => w.kind)).toEqual(['unverified_number']);
    expect(warnings[0]?.messageNl).toContain('8');
    expect(checkGoogleAdsContext(ads, { courseFacts: [...facts, '8 lesdagen'] })).toEqual([]);
  });
});

describe('the ad checks in the shape check and the repair round', () => {
  const copy = (ads: AdProposal | null): ContentCopy =>
    contentCopy.parse({ hook: 'Kop', body: 'Body', ctaText: 'Bekijk', ctaUrl: null, imageAltText: null, hashtags: [], sections: [], ads });

  it('runs on every advertising channel, each against its own platform limits', () => {
    const warnings = checkCopyShape({ copy: copy(null), channel: 'google_search_ads', withImage: false });
    expect(warnings.map((w) => w.kind)).toEqual(['ad_assets_missing']);
    expect(repairableProblems('google_search_ads', warnings)).toHaveLength(1);

    /*
     * Paid social joined on 2026-09-15. Both channels were `unverified` and so
     * carried no limit at all, which meant a 200-character headline exported
     * clean and was refused in Ads Manager. Meta's own page states 27.
     */
    expect(
      checkCopyShape({ copy: copy(null), channel: 'meta_ads', withImage: false }).map((w) => w.kind),
    ).toEqual(['ad_assets_missing']);
    const tooLong = checkCopyShape({
      copy: copy({ ...good(), headlines: ['Een kop die veel te lang is voor Meta Ads'] }),
      channel: 'meta_ads',
      withImage: false,
    });
    expect(tooLong.map((w) => w.kind)).toContain('ad_headline_too_long');

    expect(checkCopyShape({ copy: copy(good()), channel: 'google_search_ads', withImage: false })).toEqual([]);
  });
});
