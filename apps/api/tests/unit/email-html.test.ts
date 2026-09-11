import { describe, expect, it } from 'vitest';
import { BRAND_STARTING_POINT, contentCopy } from '@c360/contracts';
import { buildEmailHtml } from '../../src/core/render/email-html.js';

/**
 * The generated e-mail must not be able to carry script.
 *
 * The design is that a model never produces markup: it returns a subject, a
 * paragraph, titled sections and a call to action, all plain text, and the
 * builder is the only thing that writes tags. These tests hold that line from
 * the other side — they feed the builder text that *tries* to be markup and
 * assert it comes out as characters.
 *
 * The requirement is literal: no scripts in the HTML. So the assertion is
 * literal too.
 */

const BRAND = {
  brandName: 'Certify360 (Demo)',
  colors: BRAND_STARTING_POINT.colors,
  typography: BRAND_STARTING_POINT.typography,
  logoText: null,
};

function build(overrides: Partial<Parameters<typeof contentCopy.parse>[0]> = {}): string {
  const copy = contentCopy.parse({
    hook: 'Een onderwerpregel',
    body: 'Een openingsalinea die lang genoeg is om te tellen.',
    ctaText: 'Bekijk de opleiding',
    ctaUrl: 'https://example.test/opleiding',
    imageAltText: null,
    hashtags: [],
    sections: [
      { heading: 'Voor wie', text: 'Voor mensen die de stap willen zetten en tijd hebben.' },
    ],
    ...overrides,
  });
  return buildEmailHtml({ asset: { copy }, brand: BRAND, draftNoticeNl: 'CONCEPT — niet verzenden.' });
}

describe('the generated e-mail', () => {
  it('contains no script element and no event handler, whatever the copy says', () => {
    const html = build({
      hook: '<script>alert(1)</script>',
      body: '<img src=x onerror="alert(1)">\n\nTweede alinea met </table> erin.',
      ctaText: '"><script>alert(2)</script>',
      sections: [
        {
          heading: '</td></tr></table><script>alert(3)</script>',
          text: 'Een sectie die probeert de tabel te sluiten en script te openen. Nog wat tekst.',
        },
      ],
    });

    // The literal requirement.
    expect(html).not.toMatch(/<script/iu);

    /*
     * Checked on the real tags, not on the whole document.
     *
     * An earlier version of this test searched the text for ` on…=` and failed
     * — on its own fixture. `&lt;img src=x onerror=&quot;…` contains the
     * characters "onerror=" as *visible content*, and that is the whole point:
     * the `<` was escaped, so there is no element for an attribute to attach
     * to. Scanning the document as a string cannot tell markup from text.
     *
     * Since every tag in the output is written by this builder, the tags are a
     * closed set — so both the names and the attributes can be asserted
     * exactly, which is a stronger claim than "no script anywhere".
     */
    const tags = [...html.matchAll(/<\/?([a-z0-9!]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/giu)];
    expect(tags.length).toBeGreaterThan(10);
    const allowed = new Set([
      '!doctype', 'html', 'head', 'meta', 'title', 'body',
      'table', 'tr', 'td', 'a', 'p', 'br', 'span', 'div',
    ]);
    for (const tag of tags) {
      expect(allowed.has((tag[1] ?? '').toLowerCase()), tag[0]).toBe(true);
      expect(tag[2] ?? '', tag[0]).not.toMatch(/\son[a-z]+\s*=/iu);
    }

    // The attempts survive as visible text rather than as structure.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;');
  });

  it('loads nothing from the network', () => {
    /*
     * No images, no web fonts, no tracking pixel. An e-mail that fetches
     * anything tells that server when it was opened, and this product does not
     * measure people. It also means the mail renders the same with images
     * blocked, which is how most clients open it.
     */
    const html = build();
    expect(html).not.toMatch(/<img/iu);
    expect(html).not.toMatch(/<link/iu);
    expect(html).not.toMatch(/@import/iu);
    expect(html).not.toMatch(/url\(/iu);
    // The only absolute URL in the document is the call to action.
    const urls = [...html.matchAll(/https?:\/\/[^"'\s>]+/giu)].map((match) => match[0]);
    expect(urls).toEqual(['https://example.test/opleiding']);
  });

  it('writes no link at all when the call to action has no URL', () => {
    const html = build({ ctaUrl: null });
    expect(html).not.toMatch(/<a\s/iu);
    expect(html).toContain('Nog geen bestemmingslink ingevuld.');
  });

  it('keeps the brand colours it was given and escapes them too', () => {
    const html = build();
    expect(html).toContain(BRAND.colors.primary);
    expect(html).toContain(BRAND.colors.accent);
  });

  it('renders a blank line as a paragraph break, and nothing else as markup', () => {
    const html = build({ body: 'Eerste alinea hier.\n\nTweede alinea met *sterretjes* en _liggende streepjes_.' });
    // Two paragraphs from the body, plus one for the section text.
    expect([...html.matchAll(/<p style=/gu)]).toHaveLength(3);
    // Not Markdown: a star is a star.
    expect(html).toContain('*sterretjes*');
    expect(html).not.toMatch(/<em>|<strong>/iu);
  });

  it('cannot be made to load a remote resource through a brand font name', () => {
    /*
     * The vector escaping does not close.
     *
     * A font family is a free string in the brand contract, and it lands
     * inside a CSS declaration — where it does not need to break out of the
     * attribute to do harm. `Inter; background:url(...)` is an ordinary string
     * that would add a remote background, making the mail report when it was
     * opened. No tag, no quote, nothing for `escapeMarkup` to catch.
     */
    const hostile = buildEmailHtml({
      asset: {
        copy: contentCopy.parse({
          hook: 'Onderwerp',
          body: 'Een alinea die lang genoeg is om te tellen.',
          ctaText: 'Bekijk',
          ctaUrl: null,
          imageAltText: null,
          hashtags: [],
          sections: [],
        }),
      },
      brand: {
        ...BRAND,
        typography: {
          headingFamily: 'Inter; background:url(https://evil.test/px.png)',
          bodyFamily: 'X"><script>alert(1)</script>',
          licenceNote: null,
        },
      },
      draftNoticeNl: null,
    });

    expect(hostile).not.toMatch(/url\(/iu);
    expect(hostile).not.toMatch(/evil\.test/iu);
    expect(hostile).not.toMatch(/<script/iu);
    // The brand font is dropped and the fallback stands alone: a mail in the
    // wrong typeface is cosmetic, a mail that phones home is not.
    expect(hostile).toContain('Helvetica, Arial, sans-serif');
    expect(hostile).not.toContain('Inter;');
  });

  it('refuses a colour that is not a plain hex value', () => {
    const hostile = buildEmailHtml({
      asset: {
        copy: contentCopy.parse({
          hook: 'Onderwerp',
          body: 'Een alinea die lang genoeg is om te tellen.',
          ctaText: 'Bekijk',
          ctaUrl: null,
          imageAltText: null,
          hashtags: [],
          sections: [],
        }),
      },
      brand: {
        ...BRAND,
        // The contract already refuses this shape; the builder checks again,
        // because this is the line where the value becomes CSS.
        colors: { ...BRAND.colors, primary: 'red;background:url(https://evil.test/x)' },
      },
      draftNoticeNl: null,
    });

    expect(hostile).not.toMatch(/url\(/iu);
    expect(hostile).not.toMatch(/evil\.test/iu);
    expect(hostile).toContain('#000000');
  });

  it('is a complete document a client can open', () => {
    const html = build();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
  });
});
