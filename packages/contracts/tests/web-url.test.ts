import { describe, expect, it } from 'vitest';
import {
  briefProposal,
  contentCopy,
  radarProposal,
  source,
  webUrl,
} from '../src/index.js';

/**
 * A URL that will become an `href` must not be able to carry script.
 *
 * `z.url()` validates URL *syntax*, and `javascript:alert(1)` is syntactically
 * a valid URL — it accepts it, as do `data:` and `vbscript:`. Several fields
 * carrying untrusted URLs were declared that way while the interface rendered
 * them as links: a call to action comes from a brief, a source URL comes from a
 * model that read a fetched page. Clicking such a link executes script in our
 * own origin, and in a generated HTML e-mail it ships inside a file we
 * produced.
 *
 * The scheme is therefore checked at the contract boundary, so every consumer
 * is protected by construction rather than by each one remembering. These tests
 * exist per field, not only on the primitive, because the defect was never that
 * the primitive was wrong — it was that a field used the wrong one.
 */

const HOSTILE = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
];

const HARMLESS = ['https://cs-opleidingen.nl/opleidingen/crov', 'http://example.test/x'];

describe('webUrl', () => {
  it('refuses every scheme that can execute or read locally', () => {
    for (const candidate of HOSTILE) {
      expect(webUrl.safeParse(candidate).success, candidate).toBe(false);
    }
  });

  it('accepts ordinary web addresses', () => {
    for (const candidate of HARMLESS) {
      expect(webUrl.safeParse(candidate).success, candidate).toBe(true);
    }
  });

  it('is not fooled by case or by a scheme hidden after whitespace', () => {
    expect(webUrl.safeParse('HTTPS://EXAMPLE.TEST/x').success).toBe(true);
    expect(webUrl.safeParse(' javascript:alert(1)').success).toBe(false);
    expect(webUrl.safeParse('\njavascript:alert(1)').success).toBe(false);
  });
});

describe('the fields that reach an href', () => {
  it('refuses a script URL as a content call to action', () => {
    const copy = {
      hook: 'Kop',
      body: 'Tekst die lang genoeg is.',
      sections: [],
      ctaText: 'Bekijk de opleiding',
      imageAltText: null,
      hashtags: [],
    };
    for (const candidate of HOSTILE) {
      expect(contentCopy.safeParse({ ...copy, ctaUrl: candidate }).success, candidate).toBe(false);
    }
    expect(contentCopy.safeParse({ ...copy, ctaUrl: HARMLESS[0] }).success).toBe(true);
  });

  it('refuses a script URL as a brief call to action', () => {
    expect(briefProposal.shape.ctaUrl.safeParse('javascript:alert(1)').success).toBe(false);
    expect(briefProposal.shape.ctaUrl.safeParse(HARMLESS[0]).success).toBe(true);
  });

  it('refuses a script URL as a research source', () => {
    // Model output, read from a page nobody controls, rendered as a link.
    expect(source.shape.url.safeParse('javascript:alert(1)').success).toBe(false);
    expect(source.shape.url.safeParse(HARMLESS[0]).success).toBe(true);
  });

  it('refuses a script URL as a market-radar proposal source', () => {
    expect(radarProposal.shape.sourceUrl.safeParse('javascript:alert(1)').success).toBe(false);
    expect(radarProposal.shape.sourceUrl.safeParse(HARMLESS[0]).success).toBe(true);
  });
});
