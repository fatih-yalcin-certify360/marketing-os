import { describe, expect, it } from 'vitest';
import {
  allowedAdResource,
  courseAdTerms,
  matchAdTerms,
  metaStatus,
  adSearches,
  collectAdvertisements,
} from '../../src/modules/market-radar/advertising.js';
import { radarReport } from '@c360/contracts';
describe('advertising evidence boundaries', () => {
  it('adds at most two distinct external domains and keeps the browser on Google', () => {
    const searches = adSearches('CROV', 'cs-opleidingen.nl', [
      'https://www.cs-opleidingen.nl/course',
      'https://www.capabel.nl/course',
      'https://capabel.nl/other',
      'https://www.svland.nl/course',
      'https://third.example/course',
      'file:///private',
    ]);
    expect(
      searches.filter((s) => s.platform === 'google').map((s) => s.query),
    ).toEqual(['capabel.nl', 'svland.nl', 'cs-opleidingen.nl']);
    expect(
      searches
        .filter((s) => s.platform === 'google')
        .every((s) => new URL(s.url).hostname === 'adstransparency.google.com'),
    ).toBe(true);
  });

  it('matches the actual course and excludes fuzzy library matches such as Acrova tyres', () => {
    const terms = courseAdTerms(
      'Opleiding Casemanager Regie op Verzuim (CROV)',
    );
    expect(
      matchAdTerms('Draag de titel ROV/Crov na behalen diploma', terms),
    ).toEqual(['CROV']);
    expect(matchAdTerms('Post HBO CROV®-opleiding', terms)).toEqual(['CROV']);
    expect(matchAdTerms('Zestino acrova-07a competition tyres', terms)).toEqual(
      [],
    );
    expect(matchAdTerms('Casemanager Regie op Verzuim', terms)).toContain(
      'Casemanager Regie op Verzuim',
    );
  });
  it('works for another course without hard-coded CROV terms', () => {
    expect(
      matchAdTerms(
        'Behaal Wft Basis naast je werk',
        courseAdTerms('Opleiding Wft Basis'),
      ),
    ).toEqual(['Wft Basis']);
  });
  it('does not classify historical or unknown ads as active', () => {
    expect(metaStatus('Niet-actief\nBibliotheek-ID: 123')).toBe('inactive');
    expect(metaStatus('Actief\nBibliotheek-ID: 123')).toBe('active');
    expect(metaStatus('Voor het laatst weergegeven: vandaag')).toBe('unknown');
  });
  it('confines browser networking to public library infrastructure', () => {
    for (const url of [
      'http://www.google.com',
      'file:///etc/passwd',
      'https://localhost',
      'https://169.254.169.254/latest',
      'https://www.google.com.evil.org',
      'https://evil.org/ad',
      'https://u:p@www.facebook.com',
      'https://www.facebook.com:8080',
    ])
      expect(allowedAdResource(url), url).toBe(false);
    expect(
      allowedAdResource('https://adstransparency.google.com/adframe'),
    ).toBe(true);
    expect(
      allowedAdResource(
        'https://displayads-formats.googleusercontent.com/ads/preview/content.js',
      ),
    ).toBe(true);
    expect(
      allowedAdResource('https://scontent-ams4-1.xx.fbcdn.net/ad.jpg'),
    ).toBe(true);
  });
  it('builds separate platform searches, encoding course input as data', () => {
    const searches = adSearches('Opleiding CROV', 'cs-opleidingen.nl');
    expect(searches.map((s) => s.platform)).toEqual([
      'google',
      'meta',
      'linkedin',
    ]);
    expect(new URL(searches[0]!.url).searchParams.get('domain')).toBe(
      'cs-opleidingen.nl',
    );
    expect(new URL(searches[1]!.url).searchParams.get('q')).toBe('CROV');
  });
  it('reports unavailable coverage rather than claiming there are no ads', async () => {
    const report = await collectAdvertisements({
      courseName: 'CROV',
      courseUrl: null,
      storageRoot: '/unused',
      enabled: false,
    });
    expect(report.ads).toEqual([]);
    expect(report.coverage).toHaveLength(3);
    expect(
      report.coverage.every(
        (c) => c.status === 'unavailable' && c.scannedCount === 0,
      ),
    ).toBe(true);
  });
  it('keeps historical radar reports readable without fabricating ad checks', () => {
    expect(
      radarReport.parse({ cards: [], notes: [], failures: [], isMock: false })
        .advertising,
    ).toBeNull();
  });
});
