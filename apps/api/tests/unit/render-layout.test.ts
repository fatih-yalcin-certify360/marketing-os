import { describe, expect, it } from 'vitest';
import type { RenderSpec } from '@c360/contracts';
import { buildSvg } from '../../src/core/render/layouts.js';

/**
 * The render layer's text fitting.
 *
 * This file exists because of a defect that only a real generation could
 * produce. The mock's call to action was short and always fitted; the first
 * OpenAI run wrote "Bekijk of Wft Basis (Demo) past bij jouw wens om de basis
 * formeel vast te leggen" — 80 characters, exactly at the contract's ceiling —
 * and the layout drew it as a single line that ran off the right edge of a
 * finished, exportable PNG.
 *
 * The headline had always been wrapped. The CTA had not.
 */

function spec(overrides: Partial<RenderSpec> = {}): RenderSpec {
  return {
    layout: 'bold_statement',
    variant: 'A',
    widthPx: 1080,
    heightPx: 1350,
    headline: 'Leg je basis formeel vast',
    subline: 'Voor wie al in de praktijk werkt',
    ctaText: 'Bekijk meer',
    logoText: 'Lindenhaeghe (Demo)',
    colors: { background: '#14383a', foreground: '#f4f7f6', accent: '#a78bfa' },
    headingFamily: 'Helvetica, Arial, sans-serif',
    bodyFamily: 'Helvetica, Arial, sans-serif',
    ...overrides,
  };
}

/** The text content of every `<text>` element, in document order. */
function textElements(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/gu)].map((match) => match[1] ?? '');
}

/** The `x` and `y` of every `<text>` element. */
function textPositions(svg: string): { x: number; y: number }[] {
  return [...svg.matchAll(/<text\b[^>]*\bx="([-\d.]+)"[^>]*\by="([-\d.]+)"/gu)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));
}

/** The longest CTA the contract permits: `renderSpec.ctaText` is max 80. */
const LONGEST_ALLOWED_CTA =
  'Bekijk of Wft Basis (Demo) past bij jouw wens om de basis formeel vast te leggen';

describe('render layout — call to action', () => {
  it('wraps a call to action instead of running off the canvas', () => {
    const svg = buildSvg(spec({ ctaText: LONGEST_ALLOWED_CTA }));
    const texts = textElements(svg);

    // No single element may carry the whole CTA; that is what overflowed.
    for (const text of texts) {
      expect(text.length).toBeLessThan(LONGEST_ALLOWED_CTA.length);
    }

    // It is present, across more than one line.
    const ctaLines = texts.filter((text) => text.includes('Bekijk') || text.includes('leggen'));
    expect(ctaLines.length).toBeGreaterThan(1);
  });

  it('keeps the CTA inside the horizontal margins', () => {
    const width = 1080;
    const svg = buildSvg(spec({ ctaText: LONGEST_ALLOWED_CTA, widthPx: width }));

    // A conservative width-per-character for the brand font at this size. The
    // assertion is that the *longest* line still ends inside the canvas.
    const margin = Math.round(Math.min(width, 1350) * 0.075);
    const charWidth = Math.min(width, 1350) * 0.0205;

    for (const text of textElements(svg)) {
      const estimatedRight = margin + text.length * charWidth;
      expect(estimatedRight, `"${text}"`).toBeLessThanOrEqual(width);
    }
  });

  it('grows the CTA block upward so the bottom margin stays constant', () => {
    const short = buildSvg(spec({ ctaText: 'Bekijk meer' }));
    const long = buildSvg(spec({ ctaText: LONGEST_ALLOWED_CTA }));

    const lowest = (svg: string) =>
      Math.max(...textPositions(svg).map((position) => position.y));

    // The last baseline is in the same place either way: a two-line CTA must
    // not push itself off the bottom edge.
    expect(lowest(long)).toBe(lowest(short));
  });

  it('never ellipsises a call to action the contract permits', () => {
    // `renderSpec.ctaText` allows 80 characters, so the render layer must be
    // able to display 80 characters. Two lines of ~41 looked sufficient on
    // paper and was not, because wrapping breaks on word boundaries.
    const svg = buildSvg(spec({ ctaText: LONGEST_ALLOWED_CTA }));
    const cta = textElements(svg).filter(
      (text) => text.includes('Bekijk') || text.includes('wens') || text.includes('leggen'),
    );
    expect(cta.join(' ')).not.toMatch(/…/u);
    // And the whole CTA survived, word for word.
    expect(cta.join(' ').replace(/\s+/gu, ' ')).toBe(LONGEST_ALLOWED_CTA);
  });

  it('truncates rather than overflowing when even the wrap budget is exceeded', () => {
    // Defence in depth: if the contract's ceiling is ever raised, the layout
    // must still not draw outside the canvas.
    const svg = buildSvg(spec({ ctaText: 'x'.repeat(400) }));
    const texts = textElements(svg);
    expect(texts.some((text) => text.includes('…'))).toBe(true);
  });

  it('draws the arrow rather than typing it', () => {
    // As a glyph, U+2192 forced a font fallback that was not bold, so a
    // two-line CTA came out with mismatched weights. A drawn arrow also keeps
    // an exported asset independent of which fonts the host happens to have.
    const svg = buildSvg(spec({ ctaText: LONGEST_ALLOWED_CTA }));

    expect(svg).not.toMatch(/\u2192/u);
    expect(svg).toMatch(/<polyline/u);
    // Exactly one arrow, trailing the last line.
    expect([...svg.matchAll(/<polyline/gu)]).toHaveLength(1);
  });

  it('keeps the drawn arrow inside the canvas', () => {
    const width = 1080;
    const svg = buildSvg(spec({ ctaText: LONGEST_ALLOWED_CTA, widthPx: width }));
    const xs = [...svg.matchAll(/x2="([\d.]+)"/gu)].map((match) => Number(match[1]));
    for (const x of xs) {
      expect(x).toBeLessThanOrEqual(width);
    }
  });
});

describe('render layout — nothing collides at the bottom', () => {
  it('keeps the logo clear of a wrapped CTA', () => {
    // `bold_statement` placed the logo on the CTA's own baseline. Invisible
    // while the CTA was one line; the moment it wrapped, "Lindenhaeghe" sat on
    // top of "...vast te leggen" in an exportable asset.
    const svg = buildSvg(spec({ layout: 'bold_statement', ctaText: LONGEST_ALLOWED_CTA }));

    const elements = [...svg.matchAll(/<text\b[^>]*\by="([-\d.]+)"[^>]*>([^<]*)<\/text>/gu)].map(
      (match) => ({ y: Number(match[1]), text: match[2] ?? '' }),
    );

    const logo = elements.find((element) => element.text.includes('Lindenhaeghe'));
    const ctaTop = Math.min(
      ...elements
        .filter((element) => element.text.includes('Bekijk') || element.text.includes('wens'))
        .map((element) => element.y),
    );

    expect(logo).toBeDefined();
    // Strictly above the first CTA line, with clearance.
    expect(logo?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(ctaTop);
  });

  it('does not put two text elements on the same baseline in any layout', () => {
    const layoutNames: RenderSpec['layout'][] = [
      'bold_statement',
      'split_panel',
      'quiet_editorial',
    ];
    for (const layout of layoutNames) {
      const svg = buildSvg(spec({ layout, ctaText: LONGEST_ALLOWED_CTA }));
      const baselines = [...svg.matchAll(/<text\b[^>]*\by="([-\d.]+)"/gu)].map((match) =>
        Number(match[1]),
      );
      // Distinct baselines: two elements sharing one is how the logo ended up
      // written over the call to action.
      expect(new Set(baselines).size, layout).toBe(baselines.length);
    }
  });
});

describe('render layout — every layout', () => {
  // Every layout the contract declares, so a fix in one cannot leave the
  // others overflowing.
  const layouts: RenderSpec['layout'][] = ['bold_statement', 'split_panel', 'quiet_editorial'];

  it('wraps the CTA in each layout, not just one', () => {
    for (const layout of layouts) {
      const svg = buildSvg(spec({ layout, ctaText: LONGEST_ALLOWED_CTA }));
      for (const text of textElements(svg)) {
        expect(text.length, `${layout}: "${text}"`).toBeLessThan(LONGEST_ALLOWED_CTA.length);
      }
    }
  });

  it('escapes brand text so a stray quote cannot break the SVG', () => {
    const svg = buildSvg(spec({ logoText: 'A "B" & <C>', headline: "O'Brien & Zn" }));
    expect(svg).not.toMatch(/<C>/u);
    expect(svg).toMatch(/&amp;/u);
  });
});
