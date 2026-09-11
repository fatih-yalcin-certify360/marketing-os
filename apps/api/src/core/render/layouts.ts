import type { RenderSpec } from '@c360/contracts';
import { escapeMarkup } from './markup.js';

/**
 * SVG layout templates.
 *
 * This is the "controlled render layer" the requirements ask for: the logo and
 * every piece of readable text are placed by code, from the approved brand
 * profile, at exact coordinates. No model is asked to draw a wordmark or
 * legible type — that is the one thing image models reliably get wrong, and
 * getting a brand name wrong in a published post is not a recoverable error.
 *
 * Consequences of doing it this way:
 *  - output is deterministic, so the same content always renders identically;
 *  - brand colours and fonts are hard constraints rather than a suggestion;
 *  - two variants can carry provably identical text and differ only in layout.
 */

/**
 * Naive but adequate line breaking for a fixed-width text block.
 *
 * Breaks on whitespace, which handles ordinary prose. A single token longer
 * than the line budget is **hard-broken** rather than left to overflow: a URL
 * in a call to action, or a long Dutch compound, has no space to break on, and
 * an exportable image with text running off the edge is a defect a reviewer
 * cannot fix.
 *
 * Anything that still does not fit is ellipsised on the last line. A shortened
 * line is not a bug; a clipped one is.
 */
function wrap(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .flatMap((word) => hardBreak(word, maxCharsPerLine));
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      lines.push(current);
    }
    current = word;
    if (lines.length === maxLines) {
      break;
    }
  }
  if (current.length > 0 && lines.length < maxLines) {
    lines.push(current);
  }

  // If it did not fit, ellipsise the last line rather than overflowing the
  // canvas — a clipped headline is a visible bug, a shortened one is not.
  if (lines.length === maxLines) {
    const consumed = lines.join(' ').split(/\s+/u).length;
    if (consumed < words.length) {
      const last = lines[maxLines - 1] ?? '';
      lines[maxLines - 1] = `${last.slice(0, Math.max(0, maxCharsPerLine - 1)).trimEnd()}…`;
    }
  }
  return lines;
}

/**
 * Splits a single unbreakable token into chunks that fit the line budget.
 *
 * Returned as separate "words" so the wrapper below places them on their own
 * lines without special handling.
 */
function hardBreak(word: string, maxCharsPerLine: number): string[] {
  if (word.length <= maxCharsPerLine || maxCharsPerLine < 1) {
    return [word];
  }
  const chunks: string[] = [];
  for (let index = 0; index < word.length; index += maxCharsPerLine) {
    chunks.push(word.slice(index, index + maxCharsPerLine));
  }
  return chunks;
}

/**
 * XML-escapes text before it is placed in SVG.
 *
 * Shared with the e-mail builder — see `markup.ts` for why there is one
 * implementation rather than one per renderer.
 */
const esc = escapeMarkup;

interface Metrics {
  headlineSize: number;
  headlineLeading: number;
  headlineCharsPerLine: number;
  headlineMaxLines: number;
  sublineSize: number;
  ctaSize: number;
  ctaCharsPerLine: number;
  ctaMaxLines: number;
  ctaLeading: number;
  logoSize: number;
  margin: number;
}

/** Scales type to the canvas, so a 1:1 and a 4:5 both look deliberate. */
function metricsFor(width: number, height: number): Metrics {
  const base = Math.min(width, height);
  return {
    headlineSize: Math.round(base * 0.085),
    headlineLeading: Math.round(base * 0.105),
    headlineCharsPerLine: 22,
    headlineMaxLines: 4,
    sublineSize: Math.round(base * 0.036),
    ctaSize: Math.round(base * 0.038),
    /*
     * The CTA wraps like the headline does.
     *
     * It did not, and the first real generation showed why: a model-written CTA
     * ("Bekijk of Wft Basis past bij jouw wens om de basis formeel vast te
     * leggen") ran straight off the right edge of a finished, exportable PNG.
     * The mock's short CTA had always fitted, so nothing caught it.
     *
     * The character count is a heuristic against the glyph width of the brand
     * font at `ctaSize`; it errs narrow, because a CTA that wraps early is
     * tidy and one that overflows is broken.
     */
    ctaCharsPerLine: Math.max(20, Math.floor((width - 2 * Math.round(base * 0.075)) / (base * 0.0205))),
    /*
     * Three, not two.
     *
     * `renderSpec.ctaText` permits 80 characters, and two lines of ~41 give a
     * budget of 82 — enough on paper, but wrapping breaks on word boundaries,
     * so a real 80-character CTA ellipsised. The render layer must be able to
     * show everything the contract allows; the canvas has the vertical room.
     */
    ctaMaxLines: 3,
    ctaLeading: Math.round(base * 0.05),
    logoSize: Math.round(base * 0.032),
    margin: Math.round(base * 0.075),
  };
}

function textLines(
  lines: readonly string[],
  x: number,
  startY: number,
  leading: number,
  attrs: string,
): string {
  return lines
    .map(
      (line, index) =>
        `<text x="${String(x)}" y="${String(startY + index * leading)}" ${attrs}>${esc(line)}</text>`,
    )
    .join('\n    ');
}

/**
 * How many lines the call to action needs.
 *
 * Exposed so a layout can place other bottom-anchored elements above the CTA
 * block instead of on the same baseline. `bold_statement` put the logo on the
 * CTA's baseline, which was invisible while the CTA was one line and collided
 * the moment it wrapped.
 */
function ctaLineCount(spec: RenderSpec, m: Metrics): number {
  return wrap(spec.ctaText, m.ctaCharsPerLine, m.ctaMaxLines).length;
}

/** Total height of the CTA block, from the top of its first line. */
function ctaBlockHeight(spec: RenderSpec, m: Metrics): number {
  return (ctaLineCount(spec, m) - 1) * m.ctaLeading + m.ctaSize;
}

/**
 * `bold_statement` — headline on a full brand-colour field.
 * Highest contrast; used when the message must carry alone.
 */
function boldStatement(spec: RenderSpec, m: Metrics): string {
  const lines = wrap(spec.headline, m.headlineCharsPerLine, m.headlineMaxLines);
  const blockHeight = lines.length * m.headlineLeading;
  const startY = Math.round((spec.heightPx - blockHeight) / 2) + m.headlineSize;

  return `
    <rect width="${String(spec.widthPx)}" height="${String(spec.heightPx)}" fill="${spec.colors.background}"/>
    <rect x="0" y="0" width="${String(Math.round(spec.widthPx * 0.18))}" height="${String(Math.round(m.margin * 0.35))}" fill="${spec.colors.accent}"/>
    ${textLines(lines, m.margin, startY, m.headlineLeading, `fill="${spec.colors.foreground}" font-family="${esc(spec.headingFamily)}" font-size="${String(m.headlineSize)}" font-weight="800" letter-spacing="-0.5"`)}
    ${
      spec.subline === null
        ? ''
        : sublineBlock(spec, m, startY + blockHeight + m.sublineSize, 0.75)
    }
    ${ctaBlock(spec, m, m.margin, spec.heightPx - m.margin)}
    ${logoBlock(
      spec,
      m,
      spec.widthPx - m.margin,
      // Above the CTA block, not on its baseline. The CTA is left-aligned and
      // may use the full width, so sharing the bottom line is a collision
      // waiting for a longer call to action.
      spec.heightPx - m.margin - ctaBlockHeight(spec, m) - Math.round(m.margin * 0.5),
      'end',
    )}
  `;
}

/**
 * `split_panel` — a diagonal split between brand field and light surface.
 * Suits a question/answer or objection/response message.
 */
function splitPanel(spec: RenderSpec, m: Metrics): string {
  const splitY = Math.round(spec.heightPx * 0.58);
  const lines = wrap(spec.headline, m.headlineCharsPerLine, m.headlineMaxLines);
  const startY = m.margin + m.headlineSize + Math.round(m.margin * 0.4);

  return `
    <rect width="${String(spec.widthPx)}" height="${String(spec.heightPx)}" fill="${spec.colors.background}"/>
    <path d="M0 ${String(splitY)} L${String(spec.widthPx)} ${String(splitY - Math.round(spec.heightPx * 0.08))} L${String(spec.widthPx)} ${String(spec.heightPx)} L0 ${String(spec.heightPx)} Z" fill="${spec.colors.foreground}" opacity="0.06"/>
    <rect x="${String(m.margin)}" y="${String(m.margin)}" width="${String(Math.round(m.margin * 0.12))}" height="${String(lines.length * m.headlineLeading)}" fill="${spec.colors.accent}"/>
    ${textLines(lines, m.margin + Math.round(m.margin * 0.45), startY, m.headlineLeading, `fill="${spec.colors.foreground}" font-family="${esc(spec.headingFamily)}" font-size="${String(m.headlineSize)}" font-weight="700"`)}
    ${
      spec.subline === null
        ? ''
        : sublineBlock(spec, m, splitY + m.sublineSize + Math.round(m.margin * 0.5), 0.8)
    }
    ${ctaBlock(spec, m, m.margin, spec.heightPx - m.margin)}
    ${logoBlock(spec, m, spec.widthPx - m.margin, m.margin + m.logoSize, 'end')}
  `;
}

/**
 * `quiet_editorial` — light surface, small type, generous space.
 * Used when the message should not shout.
 */
function sublineBlock(spec: RenderSpec, m: Metrics, y: number, opacity: number): string {
  const lines = wrap(spec.subline ?? '', Math.max(12, Math.floor((spec.widthPx - m.margin * 2) / (m.sublineSize * 0.7))), 2);
  return textLines(lines, m.margin, y, Math.round(m.sublineSize * 1.3), `fill="${spec.colors.foreground}" font-family="${esc(spec.bodyFamily)}" font-size="${String(m.sublineSize)}" opacity="${String(opacity)}"`);
}

function quietEditorial(spec: RenderSpec, m: Metrics): string {
  const headlineSize = Math.round(m.headlineSize * 0.72);
  const leading = Math.round(m.headlineLeading * 0.78);
  const lines = wrap(spec.headline, Math.round(m.headlineCharsPerLine * 1.3), m.headlineMaxLines);
  const startY = Math.round(spec.heightPx * 0.4);

  return `
    <rect width="${String(spec.widthPx)}" height="${String(spec.heightPx)}" fill="${spec.colors.background}"/>
    <line x1="${String(m.margin)}" y1="${String(startY - leading)}" x2="${String(m.margin + Math.round(spec.widthPx * 0.12))}" y2="${String(startY - leading)}" stroke="${spec.colors.accent}" stroke-width="3"/>
    ${textLines(lines, m.margin, startY, leading, `fill="${spec.colors.foreground}" font-family="${esc(spec.headingFamily)}" font-size="${String(headlineSize)}" font-weight="600"`)}
    ${
      spec.subline === null
        ? ''
        : sublineBlock(spec, m, startY + lines.length * leading + m.sublineSize, 0.65)
    }
    ${ctaBlock(spec, m, m.margin, spec.heightPx - m.margin)}
    ${logoBlock(spec, m, m.margin, m.margin + m.logoSize, 'start')}
  `;
}

/**
 * The call to action, wrapped and bottom-aligned.
 *
 * `baselineY` is the baseline of the *last* line, so the block grows upward and
 * the bottom margin stays constant however many lines the CTA needs.
 *
 * The arrow is appended to the final line only, and is included in the wrap
 * budget so it cannot be the thing that overflows.
 */
function ctaBlock(spec: RenderSpec, m: Metrics, x: number, baselineY: number): string {
  // The arrow is drawn, not typed. As a glyph it forced resvg to fall back to
  // a font that had U+2192, and the fallback was not bold — so a two-line CTA
  // came out with mismatched weights. A drawn arrow also removes a font
  // dependency from an exported brand asset, which matters more than the
  // handful of bytes it costs.
  const lines = wrap(spec.ctaText, m.ctaCharsPerLine, m.ctaMaxLines);
  const startY = baselineY - (lines.length - 1) * m.ctaLeading;
  const text = textLines(
    lines,
    x,
    startY,
    m.ctaLeading,
    `fill="${spec.colors.accent}" font-family="${esc(spec.bodyFamily)}" font-size="${String(m.ctaSize)}" font-weight="700"`,
  );

  const lastLine = lines[lines.length - 1] ?? '';
  // Positioned from the last line's estimated end, so it trails the text.
  const arrowX = x + Math.round(lastLine.length * m.ctaSize * 0.54) + Math.round(m.ctaSize * 0.35);
  const arrowY = baselineY - Math.round(m.ctaSize * 0.3);
  const arrowLength = Math.round(m.ctaSize * 0.9);
  const head = Math.round(m.ctaSize * 0.26);
  const stroke = Math.max(2, Math.round(m.ctaSize * 0.09));

  return `${text}
    <g stroke="${spec.colors.accent}" stroke-width="${String(stroke)}" stroke-linecap="round" fill="none">
      <line x1="${String(arrowX)}" y1="${String(arrowY)}" x2="${String(arrowX + arrowLength)}" y2="${String(arrowY)}" />
      <polyline points="${String(arrowX + arrowLength - head)},${String(arrowY - head)} ${String(arrowX + arrowLength)},${String(arrowY)} ${String(arrowX + arrowLength - head)},${String(arrowY + head)}" stroke-linejoin="round" />
    </g>`;
}

/**
 * The wordmark, drawn as real text from the approved brand profile.
 *
 * When no wordmark is set, nothing is drawn. An invented or approximated logo
 * would be worse than none.
 */
function logoBlock(
  spec: RenderSpec,
  m: Metrics,
  x: number,
  baselineY: number,
  anchor: 'start' | 'end',
): string {
  if (spec.logoText === null || spec.logoText.trim().length === 0) {
    return '';
  }
  return `<text x="${String(x)}" y="${String(baselineY)}" text-anchor="${anchor}" fill="${spec.colors.foreground}" font-family="${esc(spec.headingFamily)}" font-size="${String(m.logoSize)}" font-weight="800" letter-spacing="0.5" opacity="0.9">${esc(spec.logoText)}</text>`;
}

/** Builds the complete SVG document for a render spec. */
export function buildSvg(spec: RenderSpec, logoDataUri?: string): string {
  if (logoDataUri && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(logoDataUri)) throw new Error('Invalid logo data');
  const m = metricsFor(spec.widthPx, spec.heightPx);
  const body =
    spec.layout === 'bold_statement'
      ? boldStatement(spec, m)
      : spec.layout === 'split_panel'
        ? splitPanel(spec, m)
        : quietEditorial(spec, m);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(spec.widthPx)}" height="${String(spec.heightPx)}" viewBox="0 0 ${String(spec.widthPx)} ${String(spec.heightPx)}">
  <title>${esc(spec.headline)}</title>
  ${body}
  ${logoDataUri ? `<image href="${logoDataUri}" x="${String(spec.widthPx - m.margin - spec.widthPx * 0.24)}" y="${String(m.margin * 0.5)}" width="${String(spec.widthPx * 0.24)}" height="${String(spec.heightPx * 0.085)}" preserveAspectRatio="xMidYMid meet"/>` : ''}
</svg>`;
}

/**
 * Chooses the layout for each of the two variants.
 *
 * Variant A follows the concept's own visual approach; variant B is a
 * deliberately different layout, so the pair is a genuine comparison rather
 * than two near-identical images. The *text* is identical by construction —
 * both variants are built from the same copy record.
 */
export function layoutsForVariants(
  conceptLayout: RenderSpec['layout'],
): { variant: 'A' | 'B'; layout: RenderSpec['layout'] }[] {
  const alternatives: Record<RenderSpec['layout'], RenderSpec['layout']> = {
    bold_statement: 'split_panel',
    split_panel: 'quiet_editorial',
    quiet_editorial: 'bold_statement',
  };
  return [
    { variant: 'A', layout: conceptLayout },
    { variant: 'B', layout: alternatives[conceptLayout] },
  ];
}

/**
 * Image-led compositions. The photograph/illustration keeps its full frame;
 * text and logo remain deterministic and readable on a solid brand surface.
 */
export function buildPhotoSvg(spec: RenderSpec, backgroundDataUri: string, logoDataUri?: string): string {
  for (const uri of [backgroundDataUri, logoDataUri].filter((x): x is string => !!x)) {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(uri)) throw new Error('Invalid embedded image');
  }
  const w = spec.widthPx, h = spec.heightPx;
  const m = Math.round(Math.min(w, h) * 0.055);
  const landscape = w > h * 1.3;
  const framed = spec.variant === 'B';
  const style = spec.visualStyle ?? 'documentary';
  const photo = landscape
    ? { x: w * 0.42, y: m, width: w * 0.58 - m, height: h - 2 * m }
    : { x: framed ? m : 0, y: framed ? h * 0.13 : 0, width: framed ? w - 2 * m : w, height: framed ? h * 0.53 : h * 0.64 };
  const textX = m;
  const textWidth = landscape ? w * 0.35 : w - 2 * m;
  const textY = landscape ? h * 0.37 : h * 0.735;
  const fontSize = Math.round(Math.min(w * (landscape ? 0.044 : 0.063), h * (landscape ? 0.085 : 0.052)));
  const maxLines = landscape ? 3 : 2;
  const lines = wrap(spec.headline, Math.floor(textWidth / (fontSize * 0.62)), maxLines);
  const foreground = esc(spec.colors.foreground), accent = esc(spec.colors.accent);
  const heading = textLines(lines, textX, textY, fontSize * 1.1,
    `fill="${foreground}" font-family="${esc(spec.headingFamily)}" font-size="${String(fontSize)}" font-weight="700"`);
  const subSize = Math.round(fontSize * 0.43);
  const subY = textY + lines.length * fontSize * 1.1 + subSize * 0.5;
  const sub = textLines(wrap(spec.subline ?? '', Math.floor(textWidth / (subSize * 0.6)), 2), textX, subY, subSize * 1.25,
    `fill="${foreground}" font-family="${esc(spec.bodyFamily)}" font-size="${String(subSize)}"`);
  const ctaSize = Math.round(Math.min(w * 0.024, h * 0.035));
  const cta = textLines(wrap(spec.ctaText, Math.floor(textWidth / (ctaSize * 0.62)), 2), textX, h - m - ctaSize, ctaSize * 1.15,
    `fill="${foreground}" font-family="${esc(spec.bodyFamily)}" font-size="${String(ctaSize)}" font-weight="700"`);
  const logoWidth = landscape ? w * 0.26 : w * 0.31;
  const logoHeight = Math.min(h * 0.068, w * 0.085);
  const logoY = m * 0.65;
  const logo = logoDataUri
    ? `<image href="${logoDataUri}" x="${String(m)}" y="${String(logoY)}" width="${String(logoWidth)}" height="${String(logoHeight)}" preserveAspectRatio="xMinYMid meet"/>`
    : `<text x="${String(m)}" y="${String(logoY + logoHeight * 0.7)}" fill="${foreground}" font-family="${esc(spec.bodyFamily)}" font-size="${String(Math.round(logoHeight * 0.4))}">${esc(spec.logoText ?? '')}</text>`;
  const logoSurface = !landscape && !framed
    ? `<rect x="${String(m * 0.65)}" y="${String(m * 0.35)}" width="${String(logoWidth + m * 0.7)}" height="${String(logoHeight + m * 0.6)}" fill="${esc(spec.colors.background)}"/>` : '';
  const accentMark = style === 'conceptual'
    ? `<circle cx="${String(landscape ? w * 0.36 : w - m - 8)}" cy="${String(landscape ? h * 0.24 : h * 0.705)}" r="${String(m * 0.2)}" fill="${accent}"/>`
    : `<rect x="${String(m)}" y="${String(textY - fontSize * 1.1)}" width="${String(style === 'illustration' ? m * 2 : m * 0.8)}" height="${String(Math.max(3, m * 0.07))}" fill="${accent}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(w)}" height="${String(h)}" viewBox="0 0 ${String(w)} ${String(h)}">
    <title>${esc(spec.headline)}</title>
    <rect width="100%" height="100%" fill="${esc(spec.colors.background)}"/>
    ${framed && style === 'illustration' ? `<rect x="${String(photo.x + m * 0.17)}" y="${String(photo.y + m * 0.17)}" width="${String(photo.width)}" height="${String(photo.height)}" fill="${accent}"/>` : ''}
    <image href="${backgroundDataUri}" x="${String(photo.x)}" y="${String(photo.y)}" width="${String(photo.width)}" height="${String(photo.height)}" preserveAspectRatio="xMidYMid meet"/>
    ${logoSurface}${logo}${accentMark}${heading}${sub}${cta}
  </svg>`;
}
