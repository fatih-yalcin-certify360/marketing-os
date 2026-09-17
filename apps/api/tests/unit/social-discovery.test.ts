import { describe, expect, it } from 'vitest';
import { socialLinksInHtml } from '../../src/modules/competitors/social-discovery.js';

/**
 * Finding an organisation's social pages in its own HTML.
 *
 * The rules here are all about *not* taking the obvious match. Almost every
 * page on the web carries `facebook.com/sharer.php`, which links to our content
 * on Facebook rather than to the organisation; a page that links to one
 * Instagram post is not a page that names an Instagram account; and LinkedIn
 * has a personal profile under `/in/` that must never end up in a field the
 * contract reserves for an organisation page.
 */
describe('socialLinksInHtml', () => {
  const found = (html: string): { platform: string; url: string }[] =>
    socialLinksInHtml(html, 'https://voorbeeld.nl').map(({ platform, url }) => ({ platform, url }));

  it('takes the organisation pages a site publishes', () => {
    const html = `
      <footer>
        <a href="https://www.linkedin.com/company/cs-opleidingen/">LinkedIn</a>
        <a href="https://www.facebook.com/csopleidingen">Facebook</a>
        <a href="https://www.instagram.com/csopleidingen/">Instagram</a>
      </footer>`;
    expect(found(html)).toEqual([
      { platform: 'linkedin', url: 'https://www.linkedin.com/company/cs-opleidingen' },
      { platform: 'facebook', url: 'https://www.facebook.com/csopleidingen' },
      { platform: 'instagram', url: 'https://www.instagram.com/csopleidingen' },
    ]);
  });

  it('ignores share widgets, which link to our own content and not to the organisation', () => {
    const html = `
      <a href="https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fvoorbeeld.nl">Deel</a>
      <a href="https://www.facebook.com/dialog/share?app_id=1">Deel</a>
      <a href="https://www.linkedin.com/shareArticle?url=https%3A%2F%2Fvoorbeeld.nl">Deel</a>`;
    expect(found(html)).toEqual([]);
  });

  it('ignores a personal profile and a single post', () => {
    const html = `
      <a href="https://www.linkedin.com/in/jan-jansen-1234">Onze directeur</a>
      <a href="https://www.instagram.com/p/Cabcdef/">Bekijk deze post</a>
      <a href="https://www.instagram.com/reel/Cxyz/">Reel</a>`;
    expect(found(html)).toEqual([]);
  });

  it('accepts a LinkedIn school page, which is what an education provider often has', () => {
    const html = '<a href="https://nl.linkedin.com/school/hogeschool-voorbeeld/">LinkedIn</a>';
    expect(found(html)).toEqual([
      { platform: 'linkedin', url: 'https://nl.linkedin.com/school/hogeschool-voorbeeld' },
    ]);
  });

  it('strips tracking parameters and the fragment, and keeps one entry per link', () => {
    const html = `
      <a href="https://www.instagram.com/csopleidingen/?utm_source=footer#volg">Volg ons</a>
      <a href="https://www.instagram.com/csopleidingen">Ook volgen</a>`;
    expect(found(html)).toEqual([
      { platform: 'instagram', url: 'https://www.instagram.com/csopleidingen' },
    ]);
  });

  it('records the page a link was found on, because that is the evidence', () => {
    const findings = socialLinksInHtml(
      '<a href="https://www.facebook.com/csopleidingen">Facebook</a>',
      'https://voorbeeld.nl/contact',
    );
    expect(findings[0]?.foundOnUrl).toBe('https://voorbeeld.nl/contact');
  });

  it('ignores anything that is not a social link at all', () => {
    const html = `
      <a href="/over-ons">Over ons</a>
      <a href="mailto:info@voorbeeld.nl">Mail</a>
      <a href="https://voorbeeld.nl/opleidingen">Opleidingen</a>`;
    expect(found(html)).toEqual([]);
  });
});
