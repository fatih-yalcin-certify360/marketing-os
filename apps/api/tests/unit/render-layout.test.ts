import { describe, expect, it } from 'vitest';
import type { RenderSpec } from '@c360/contracts';
import { Resvg } from '@resvg/resvg-js';
import { buildSvg, buildPhotoSvg, buildCreativeSvg, creativeTextZone, creativeSourceZones, resolveCreativePalette, CreativeTextOverflowError, CreativeContrastError } from '../../src/core/render/layouts.js';
import { resolveCreativeLogoPlate } from '../../src/core/render/renderer.js';

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

const creativeBrief: NonNullable<RenderSpec['creativeBrief']> = {
  campaignAlignment: '',
  channelRationale: '',
  personaVersionIds: [],
  evidenceIds: [],
  testHypothesis: '',
  mechanism: 'visual_question',
  audienceInsight: 'Een adviseur wil met vertrouwen een volgende stap kunnen kiezen.',
  conceptRationale: 'Een herkenbare vraag maakt de behoefte zichtbaar.',
  scene: 'Een onverwachte splitsing in een alledaagse route.',
  composition: 'De betekenisvolle details staan rechts; links blijft ruimte voor echte tekst.',
  textTreatment: 'speech_bubble',
  textPosition: 'top_left',
  brandIntegration: 'De vormtaal en het accent komen uit de merkidentiteit.',
  avoid: ['Generiek kantoorbeeld'],
};
// A small PNG; no external image request or AI call is needed for layout checks.
const backgroundPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDngAAAAASUVORK5CYII=';
function creative(overrides: Partial<RenderSpec> = {}): RenderSpec {
  return spec({ headline: 'Wie bepaalt jouw volgende stap?', subline: 'Maak ruimte voor een onderbouwde keuze.', creativeBrief, ...overrides });
}
function copyGroup(svg: string, role: string): string {
  const content = new RegExp(`<g data-copy="${role}"[^>]*>(.*?)<\\/g>`, 'u').exec(svg)?.[1] ?? '';
  return textElements(content).join(' ');
}

describe('creative layouts — complete copy on the reserved composition', () => {
  const dimensions = [[1200, 628], [1080, 1080], [1080, 1350]] as const;
  const treatments = ['speech_bubble', 'editorial', 'image_led'] as const;

  it('keeps full artwork and complete readable copy in all supported aspect ratios and treatments', () => {
    for (const [widthPx, heightPx] of dimensions) for (const textTreatment of treatments) {
      const input = creative({ widthPx, heightPx, creativeBrief: { ...creativeBrief, textTreatment }, ctaText: LONGEST_ALLOWED_CTA });
      const svg = buildPhotoSvg(input, backgroundPng);
      expect(svg).toContain(`data-composition="${textTreatment}"`);
      expect(svg).toContain(`x="0" y="0" width="${String(widthPx)}" height="${String(heightPx)}" preserveAspectRatio="xMidYMid slice"`);
      expect(copyGroup(svg, 'headline')).toBe(input.headline);
      expect(copyGroup(svg, 'subline')).toBe(input.subline);
      expect(copyGroup(svg, 'cta')).toBe(LONGEST_ALLOWED_CTA);
      expect(textElements(svg).join(' ')).not.toContain('…');
      for (const position of textPositions(svg)) {
        expect(position.x).toBeGreaterThan(0);
        expect(position.x).toBeLessThan(widthPx);
        expect(position.y).toBeGreaterThan(0);
        expect(position.y).toBeLessThan(heightPx);
      }
    }
  });

  it('never moves the artwork crop or text blocks between variants', () => {
    for (const textPosition of ['top_left', 'top_right', 'bottom_left'] as const) {
      const input = creative({ creativeBrief: { ...creativeBrief, textPosition } });
      const first = buildPhotoSvg(input, backgroundPng);
      const second = buildPhotoSvg({ ...input, variant: 'B', layout: 'split_panel' }, backgroundPng);
      expect(first).not.toBe(second);
      expect(textPositions(first)).toEqual(textPositions(second));
      expect(textElements(first)).toEqual(textElements(second));
      expect(/<image data-artwork="background"[^>]+>/u.exec(first)?.[0]).toBe(/<image data-artwork="background"[^>]+>/u.exec(second)?.[0]);
      expect(/data-text-zone="[^"]+"/u.exec(first)?.[0]).toBe(/data-text-zone="[^"]+"/u.exec(second)?.[0]);
    }
  });

  it('keeps every reserved text zone above the dedicated footer and within canvas margins', () => {
    for (const [width, height] of dimensions) for (const position of ['top_left', 'top_right', 'bottom_left'] as const) {
      const zone = creativeTextZone(width, height, position);
      expect(zone.x).toBeGreaterThan(0);
      expect(zone.y).toBeGreaterThan(0);
      expect(zone.x + zone.width).toBeLessThan(width);
      expect(zone.y + zone.height).toBeLessThan(height * .85);
      expect(zone.height).toBeCloseTo(height * (width > height * 1.3 ? .55 : .38));
    }
  });

  it('maps a landscape provider frame into the exact center crop and protected source zones', () => {
    const zones = creativeSourceZones(1200,628,1536,1024,'top_left');
    expect(zones.crop.x).toBe(0);
    expect(zones.crop.y).toBeCloseTo(110.08);
    expect(zones.crop.width).toBe(1536);
    expect(zones.crop.height).toBeCloseTo(803.84);
    expect(zones.text.x).toBeCloseTo(40.192);
    expect(zones.text.y).toBeCloseTo(150.272);
    expect(zones.text.width).toBeCloseTo(737.28);
    expect(zones.text.height).toBeCloseTo(442.112);
    expect(zones.footer.y).toBeCloseTo(793.344);
    expect(zones.footer.y + zones.footer.height).toBeCloseTo(zones.crop.y + zones.crop.height);
  });

  it('maps a portrait provider frame and keeps the footer below bottom-left copy', () => {
    const zones = creativeSourceZones(1080,1350,1024,1536,'bottom_left');
    expect(zones.crop).toEqual({x:0,y:128,width:1024,height:1280});
    expect(zones.text.x).toBeCloseTo(51.2);
    expect(zones.text.y).toBeCloseTo(678.4);
    expect(zones.text.y + zones.text.height).toBeLessThan(zones.footer.y);
    expect(zones.footer.y).toBeCloseTo(1216);
    expect(zones.footer.height).toBeCloseTo(192);
    const uncropped = creativeSourceZones(1080,1080,1080,1080,'top_right');
    expect(uncropped.text).toEqual(creativeTextZone(1080,1080,'top_right'));
    expect(() => creativeSourceZones(1080,1080,0,1024,'top_left')).toThrow('dimensions');
  });

  it('uses the headline only once as the speech-bubble text and supplies a deliberate tail', () => {
    const input = creative();
    const svg = buildCreativeSvg(input, backgroundPng);
    expect([...svg.matchAll(/data-copy="headline"/gu)]).toHaveLength(1);
    expect(copyGroup(svg, 'headline')).toBe(input.headline);
    expect(svg).toMatch(/<path data-panel="speech_bubble" d="[^"\n]+L/u);
  });

  it('rejects impossible text instead of dropping words or silently adding ellipses', () => {
    expect(() => buildCreativeSvg(creative({ headline: 'Veel te veel volledige woorden '.repeat(200) }), backgroundPng)).toThrow(CreativeTextOverflowError);
  });

  it('retains all characters in a long token even when it needs a hard line break', () => {
    const input = creative({ headline: 'Verantwoordelijkheidsverdelingbijopleidingskeuze', subline: null });
    const svg = buildCreativeSvg(input);
    expect(copyGroup(svg, 'headline').replace(/\s/gu, '')).toBe(input.headline);
    expect(svg).not.toContain('…');
  });

  it('chooses a readable approved color and refuses a palette without an accessible text pair', () => {
    const svg = buildCreativeSvg(creative({ colors: { background: '#ffffff', foreground: '#eeeeee', accent: '#000000', surface: '#ffffff', onSurface: '#eeeeee' } }));
    expect(svg).toMatch(/data-copy="headline"[^>]*fill="#000000"/u);
    const normal = buildCreativeSvg(creative({ colors: { background: '#14383a', foreground: '#ffffff', accent: '#a78bfa', surface: '#f4f7f6', onSurface: '#14383a' } }));
    expect(normal).toMatch(/data-copy="headline"[^>]*fill="#14383a"/u);
    expect(() => buildCreativeSvg(creative({ colors: { background: '#ffffff', foreground: '#eeeeee', accent: '#cccccc', surface: '#ffffff', onSurface: '#eeeeee' } }))).toThrow('merkpalet');
  });

  it('renders the real CS palette using an approved alternative to its inaccessible mid-tone primary', () => {
    // CS Portal snapshot: primary/white = 2.99:1 and primary/ink = 3.72:1;
    // surface/ink = 9.58:1. Previously every primary-panel variant failed.
    const colors = { background:'#00A894',foreground:'#ffffff',accent:'#C5003E',surface:'#f3edeb',onSurface:'#203E58' };
    for (const treatment of treatments) for (const variant of ['A','B'] as const) {
      const input = creative({colors,variant,creativeBrief:{...creativeBrief,textTreatment:treatment}});
      const resolution = resolveCreativePalette(input);
      expect(resolution.panel.background).toBe(colors.surface);
      expect(resolution.panel.foreground).toBe(colors.onSurface);
      expect(resolution.panel.contrastRatio).toBeCloseTo(9.58,2);
      expect(resolution.panel.mode).toBe((variant==='A' ? treatment==='editorial' : treatment!=='editorial') ? 'brand_alternative' : 'preferred');
      expect(resolution.footer.mode).toBe('preferred');
      for (const pair of [resolution.panel,resolution.footer]) {
        expect(Object.values(colors)).toContain(pair.background);
        expect(Object.values(colors)).toContain(pair.foreground);
        expect(pair.contrastRatio).toBeGreaterThanOrEqual(4.5);
      }
      const svg = buildPhotoSvg(input,backgroundPng);
      expect(svg).toContain('id="creative-color-resolution"');
      const panel = /<(?:path|rect) data-panel="[^"]+"[^>]+>/u.exec(svg)?.[0] ?? '';
      const footer = /<rect data-footer="brand"[^>]+>/u.exec(svg)?.[0] ?? '';
      expect(panel).toContain('fill="#f3edeb"');
      expect(footer).toContain('fill="#f3edeb"');
      expect(panel + footer).not.toMatch(/(?:opacity|fill-opacity)=/u);
      expect(svg).toMatch(/data-copy="headline"[^>]*fill="#203E58"/u);
      expect(svg).toMatch(/data-copy="cta"[^>]*fill="#203E58"/u);
    }
    const first = buildCreativeSvg(creative({colors,creativeBrief:{...creativeBrief,textTreatment:'editorial'}}));
    const second = buildCreativeSvg(creative({colors,variant:'B',creativeBrief:{...creativeBrief,textTreatment:'editorial'}}));
    expect(first).not.toBe(second);
    expect(textPositions(first)).toEqual(textPositions(second));
    expect(textElements(first)).toEqual(textElements(second));
  });

  it('can change an unsuitable footer surface when another approved pair works', () => {
    const colors = {background:'#ffffff',foreground:'#C5003E',accent:'#00A894',surface:'#00A894',onSurface:'#00A894'};
    const input = creative({colors});
    const resolution = resolveCreativePalette(input);
    expect(resolution.footer.mode).toBe('brand_alternative');
    expect(resolution.footer.background).toBe(colors.background);
    expect(resolution.footer.foreground).toBe(colors.foreground);
    expect(resolution.footer.contrastRatio).toBeGreaterThanOrEqual(4.5);
    const svg = buildCreativeSvg(input);
    expect(svg).toMatch(/data-footer="brand"[^>]*fill="#ffffff"/u);
  });

  it('keeps an already accessible intended pair even when color roles share a surface', () => {
    const input = creative({colors:{background:'#767676',surface:'#767676',foreground:'#ffffff',onSurface:'#000000',accent:'#767676'},creativeBrief:{...creativeBrief,textTreatment:'editorial'}});
    const resolution = resolveCreativePalette(input);
    expect(resolution.panel.foreground).toBe('#ffffff');
    expect(resolution.panel.mode).toBe('preferred');
    expect(resolution.footer.foreground).toBe('#000000');
    expect(resolution.footer.mode).toBe('preferred');
  });

  it('still rejects a genuinely unreadable approved palette instead of inventing neutral colors', () => {
    const input = creative({colors:{background:'#dddddd',foreground:'#eeeeee',accent:'#cccccc',surface:'#ffffff',onSurface:'#f3edeb'}});
    expect(() => resolveCreativePalette(input)).toThrow(CreativeContrastError);
    expect(() => buildCreativeSvg(input)).toThrow(CreativeContrastError);
  });

  it('gives a real white reverse logo an approved contrasting plate without recoloring the PNG', () => {
    const colors = {background:'#00A894',foreground:'#ffffff',accent:'#C5003E',surface:'#f3edeb',onSurface:'#203E58'};
    const input = creative({colors});
    const png = Buffer.from(new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="30"><path d="M0 0H120V30H0Z" fill="#ffffff"/></svg>').render().asPng());
    const logo = `data:image/png;base64,${png.toString('base64')}`;
    const plate = resolveCreativeLogoPlate(input,logo,colors.surface);
    expect(plate.mode).toBe('brand_plate');
    expect(plate.background).toBe(colors.onSurface);
    expect(plate.contrastScore).toBeGreaterThan(10);
    const svg = buildCreativeSvg(input,undefined,logo,undefined,plate);
    expect(svg).toContain(`href="${logo}"`);
    expect(svg).toMatch(/data-logo-plate="brand"[^>]*fill="#203E58"/u);
    const imageX = Number(/<image data-brand="logo"[^>]*x="([\d.]+)"/u.exec(svg)?.[1]);
    const plateX = Number(/<rect data-logo-plate="brand"[^>]*x="([\d.]+)"/u.exec(svg)?.[1]);
    expect(imageX).toBeGreaterThan(plateX);
    expect(plateX).toBeGreaterThan(input.widthPx * .6);
  });

  it('keeps a dark logo on its clear footer and correctly composites semitransparent logo pixels', () => {
    const input = creative({colors:{background:'#ffffff',foreground:'#000000',accent:'#777777',surface:'#ffffff',onSurface:'#000000'}});
    const png = (fill:string,opacity:number) => `data:image/png;base64,${Buffer.from(new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${fill}" opacity="${String(opacity)}"/></svg>`).render().asPng()).toString('base64')}`;
    expect(resolveCreativeLogoPlate(input,png('#000000',1),'#ffffff').mode).toBe('footer');
    const translucent = resolveCreativeLogoPlate(input,png('#ffffff',.5),'#ffffff');
    expect(translucent.background).toBe('#000000');
    // White alpha128 on black composites to #808080, not #404040 (double alpha).
    expect(translucent.contrastScore).toBeCloseTo(5.317,2);
    expect(() => resolveCreativeLogoPlate(input,png('#ffffff',1),'#123456')).toThrow('approved');
  });

  it('escapes exact copy and font names, rejects injected colors and image addresses', () => {
    const svg = buildCreativeSvg(creative({ headline: 'Jouw "keuze" & <volgende stap>', headingFamily: 'A" onload="unsafe' }));
    expect(svg).toContain('&lt;volgende');
    expect(svg).not.toContain('<volgende');
    expect(svg).not.toContain(' onload="unsafe');
    expect(() => buildCreativeSvg(creative({ colors: { background: 'url(https://example.com)', foreground: '#fff', accent: '#123' } }))).toThrow();
    expect(() => buildCreativeSvg(creative(), 'https://example.com/photo.png')).toThrow('Invalid embedded image');
  });

  it('uses one real logo without adding a second wordmark and identifies the graphic fallback honestly', () => {
    const svg = buildSvg(creative(), backgroundPng);
    expect(svg).toContain('data-artwork-source="deterministic_graphic"');
    expect(svg).toContain('Grafische merkcompositie zonder gegenereerde foto.');
    expect([...svg.matchAll(/data-brand="logo"/gu)]).toHaveLength(1);
    expect(svg).not.toContain('data-copy="logo"');
    expect(svg).not.toContain('data-artwork="background"');
  });

  it('leaves legacy photo layouts unchanged when there is no creative brief', () => {
    const svg = buildPhotoSvg(spec(), backgroundPng);
    expect(svg).not.toContain('data-composition=');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
  });
});

/**
 * No call to action in a picture nobody can tap.
 *
 * On an organic post the image is not a click target: tapping it opens the
 * post, and the destination lives in the caption. A "Bekijk de opleiding →"
 * drawn into it is an instruction the viewer cannot follow, with an arrow
 * pointing at nothing. A paid single image *is* the click target and keeps it.
 *
 * The rule lives in the channel registry (`CLICKABLE_IMAGE_CHANNELS`); these
 * check that the render layer honours a null and does not leave a hole where
 * the block used to be.
 */
describe('a call to action is drawn only when the image is a link', () => {
  it('omits the text and the arrow on every layout when there is none', () => {
    for (const layout of ['bold_statement', 'split_panel', 'quiet_editorial'] as const) {
      const withCta = buildSvg(spec({ layout, ctaText: 'Bekijk de opleiding' }));
      const without = buildSvg(spec({ layout, ctaText: null }));

      expect(textElements(withCta)).toContain('Bekijk de opleiding');
      expect(textElements(without)).not.toContain('Bekijk de opleiding');
      // The drawn arrow goes with it: it is the part that promises a tap.
      expect(without).not.toContain('<polyline');
      // And the wordmark stays, because brand presence is not a promise of a link.
      expect(textElements(without)).toContain('Lindenhaeghe (Demo)');
    }
  });

  it('still renders to a real bitmap without the call to action', () => {
    const png = new Resvg(buildSvg(spec({ ctaText: null })), {
      fitTo: { mode: 'width', value: 1080 },
    })
      .render()
      .asPng();
    expect(png.byteLength).toBeGreaterThan(1_000);
  });

  it('keeps the headline where it was: the block is removed, not left empty', () => {
    const without = textPositions(buildSvg(spec({ ctaText: null })));
    const withCta = textPositions(buildSvg(spec({ ctaText: 'Bekijk de opleiding' })));
    // One text element fewer, and the first line sits at the same place.
    expect(without.length).toBe(withCta.length - 1);
    expect(without[0]).toEqual(withCta[0]);
  });
});
