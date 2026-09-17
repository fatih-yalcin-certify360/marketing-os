import type { RenderSpec } from '@c360/contracts';
import { escapeMarkup as esc } from './markup.js';

export type TextMeasurer = (text: string, family: string, fontSize: number, weight: number) => number;
export interface CreativeTextZone { x: number; y: number; width: number; height: number }
type TextPosition = NonNullable<RenderSpec['creativeBrief']>['textPosition'];

/** Also used by the image prompt: both variants keep this exact reserved zone. */
export function creativeTextZone(width: number, height: number, position: TextPosition): CreativeTextZone {
  const margin = Math.min(width, height) * 0.05;
  const landscape = width > height * 1.3;
  const zoneWidth = width * (landscape ? 0.48 : 0.72);
  const zoneHeight = height * (landscape ? 0.55 : 0.38);
  return {
    x: position === 'top_right' ? width - margin - zoneWidth : margin,
    y: position === 'bottom_left' ? height * 0.85 - margin - zoneHeight : margin,
    width: zoneWidth,
    height: zoneHeight,
  };
}

/** Maps reserved output zones into the source image before xMidYMid slice crops it. */
export function creativeSourceZones(targetWidth: number, targetHeight: number, sourceWidth: number, sourceHeight: number, position: TextPosition): { crop: CreativeTextZone; text: CreativeTextZone; footer: CreativeTextZone } {
  if ([targetWidth,targetHeight,sourceWidth,sourceHeight].some(value => !Number.isFinite(value) || value <= 0)) throw new Error('Invalid creative image dimensions.');
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const crop = { x: (sourceWidth - targetWidth / scale) / 2, y: (sourceHeight - targetHeight / scale) / 2, width: targetWidth / scale, height: targetHeight / scale };
  const map = (rect: CreativeTextZone): CreativeTextZone => ({ x: crop.x + rect.x / scale, y: crop.y + rect.y / scale, width: rect.width / scale, height: rect.height / scale });
  return {
    crop,
    text: map(creativeTextZone(targetWidth,targetHeight,position)),
    footer: map({ x: 0, y: targetHeight * .85, width: targetWidth, height: targetHeight * .15 }),
  };
}

function n(value: number): string { return String(Math.round(value * 100) / 100); }
function color(value: string): string {
  // Brand releases provide hex colors. Never interpolate SVG paint servers or markup from a string.
  if (!/^#[\da-f]{3}(?:[\da-f]{3})?$/iu.test(value)) throw new Error('Creative render requires a valid hex brand color.');
  return value;
}
function luminance(hex: string): number {
  const raw = hex.slice(1);
  const full = raw.length === 3 ? [...raw].map(character => character + character).join('') : raw;
  const rgb = [0, 2, 4].map(offset => {
    const channel = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (rgb[0] ?? 0) * 0.2126 + (rgb[1] ?? 0) * 0.7152 + (rgb[2] ?? 0) * 0.0722;
}
function contrast(a: string, b: string): number {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
export class CreativeContrastError extends Error {
  constructor() { super('Het merkpalet bevat geen leesbare tekstkleur voor deze compositie (minimaal contrast 4,5:1).'); this.name = 'CreativeContrastError'; }
}
export interface CreativeColorPair {
  background: string;
  foreground: string;
  contrastRatio: number;
  mode: 'preferred' | 'brand_alternative';
}
export interface CreativePaletteResolution {
  panel: CreativeColorPair;
  footer: CreativeColorPair;
  logo?: CreativeLogoPlate;
}
export interface CreativeLogoPlate {
  background: string;
  mode: 'footer' | 'brand_plate';
  /** Alpha-weighted logo score, not a WCAG text-conformance measurement. */
  contrastScore: number;
}

/**
 * Resolve pairs, not just ink on one fixed fill. Mid-tone brand colors can be
 * unsuitable for text even when the same palette has excellent neutral pairs.
 * Every candidate is an unchanged approved color; text surfaces stay opaque.
 */
export function resolveCreativePalette(spec: RenderSpec): CreativePaletteResolution {
  if (!spec.creativeBrief) throw new Error('Creative brief required.');
  const primary = color(spec.colors.background), onPrimary = color(spec.colors.foreground), accent = color(spec.colors.accent);
  const surface = color(spec.colors.surface ?? onPrimary), onSurface = color(spec.colors.onSurface ?? primary);
  const palette = [...new Set([surface,primary,onSurface,onPrimary,accent])];
  const pair = (preferredSurface: string, preferredInk: string): CreativeColorPair => {
    const preferredRatio = contrast(preferredSurface,preferredInk);
    if (preferredRatio >= 4.5) return {background:preferredSurface,foreground:preferredInk,contrastRatio:preferredRatio,mode:'preferred'};
    const surfaces = [...new Set([preferredSurface,...palette])];
    for (const candidateSurface of surfaces) {
      const intendedInk = candidateSurface === surface ? onSurface : candidateSurface === primary ? onPrimary : preferredInk;
      const inks = [...new Set([intendedInk,onSurface,onPrimary,primary,surface,accent])];
      for (const candidateInk of inks) {
        const ratio = contrast(candidateSurface,candidateInk);
        if (ratio >= 4.5) return {
          background: candidateSurface,
          foreground: candidateInk,
          contrastRatio: ratio,
          mode: candidateSurface === preferredSurface && candidateInk === preferredInk ? 'preferred' : 'brand_alternative',
        };
      }
    }
    throw new CreativeContrastError();
  };
  const editorial = spec.creativeBrief.textTreatment === 'editorial';
  const primaryPanel = spec.variant === 'A' ? editorial : !editorial;
  return {
    panel: pair(primaryPanel ? primary : surface,primaryPanel ? onPrimary : onSurface),
    footer: pair(surface,onSurface),
  };
}

// Direct SVG callers can use conservative bounds. ImageRenderer supplies actual brand-font measurements.
const conservativeMeasure: TextMeasurer = (text, _family, size) => [...text].reduce((sum, character) =>
  sum + (/\s/u.test(character) ? 0.34 : /[ilI.,:;'!|]/u.test(character) ? 0.36 : /[MW@%]/u.test(character) ? 1 : 0.69), 0) * size;

function wrapMeasured(text: string, width: number, measure: (value: string) => number): string[] | null {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= width) { current = candidate; continue; }
    if (current) { lines.push(current); current = ''; }
    if (measure(word) <= width) { current = word; continue; }
    // Break only between Unicode codepoints, without ellipses or invented hyphens.
    for (const character of word) {
      if (measure(character) > width) return null;
      if (current && measure(current + character) > width) { lines.push(current); current = ''; }
      current += character;
    }
  }
  if (current) lines.push(current);
  return lines;
}
interface CopyBlock { lines: string[]; fontSize: number; leading: number; height: number }
function block(text: string, width: number, size: number, family: string, weight: number, leading: number, measure: TextMeasurer): CopyBlock | null {
  const lines = wrapMeasured(text, width, value => measure(value, family, size, weight));
  return lines ? { lines, fontSize: size, leading: size * leading, height: lines.length * size * leading } : null;
}
export class CreativeTextOverflowError extends Error {
  constructor() { super('De volledige tekst past niet leesbaar in deze compositie. Verkort de tekst of kies een ander formaat.'); this.name = 'CreativeTextOverflowError'; }
}
function fitCopy(spec: RenderSpec, width: number, height: number, measure: TextMeasurer): { headline: CopyBlock; subline: CopyBlock | null; gap: number } {
  const base = Math.min(spec.widthPx, spec.heightPx);
  const scale = spec.creativeBrief?.textTreatment === 'image_led' ? .064 : .087;
  const initial = Math.round(Math.min(base * scale, width * 0.12));
  const minimum = Math.max(12, Math.round(base * 0.027));
  for (let size = initial; size >= minimum; size -= 1) {
    const headline = block(spec.headline, width, size, spec.headingFamily, 800, 1.1, measure);
    const subSize = Math.max(Math.round(base * 0.020), Math.round(size * 0.40));
    const subline = spec.subline?.trim() ? block(spec.subline, width, subSize, spec.bodyFamily, 400, 1.28, measure) : null;
    const gap = subline ? Math.max(base * 0.016, size * 0.3) : 0;
    if (headline && (!spec.subline?.trim() || subline) && headline.height + (subline?.height ?? 0) + gap <= height) return { headline, subline, gap };
  }
  throw new CreativeTextOverflowError();
}
function fitSingle(text: string, width: number, height: number, initial: number, minimum: number, family: string, weight: number, measure: TextMeasurer): CopyBlock {
  for (let size = Math.round(initial); size >= Math.round(minimum); size -= 1) {
    const copy = block(text, width, size, family, weight, 1.22, measure);
    if (copy && copy.height <= height) return copy;
  }
  throw new CreativeTextOverflowError();
}
function textBlock(copy: CopyBlock, x: number, y: number, family: string, fill: string, weight: number, role: string, original: string): string {
  return `<g data-copy="${role}" aria-label="${esc(original)}" fill="${fill}" font-family="${esc(family)}" font-size="${n(copy.fontSize)}" font-weight="${String(weight)}">${copy.lines.map((line, index) => `<text x="${n(x)}" y="${n(y + copy.fontSize + index * copy.leading)}">${esc(line)}</text>`).join('')}</g>`;
}
function arrow(x: number, y: number, size: number, fill: string): string {
  return `<g data-decoration="cta-arrow" fill="none" stroke="${fill}" stroke-width="${n(Math.max(1.5, size * 0.085))}" stroke-linecap="round" stroke-linejoin="round"><path d="M${n(x)} ${n(y)} h${n(size)} m${n(-size * 0.35)} ${n(-size * 0.35)} l${n(size * 0.35)} ${n(size * 0.35)} l${n(-size * 0.35)} ${n(size * 0.35)}"/></g>`;
}
function bubblePath(x: number, y: number, width: number, height: number, radius: number, tail: number, position: TextPosition): string {
  const right = x + width, bottom = y + height;
  if (position === 'bottom_left') {
    return `M${n(x + radius)} ${n(y)} H${n(x + width * .7)} L${n(x + width * .86)} ${n(y - tail)} L${n(x + width * .8)} ${n(y)} H${n(right - radius)} Q${n(right)} ${n(y)} ${n(right)} ${n(y + radius)} V${n(bottom - radius)} Q${n(right)} ${n(bottom)} ${n(right - radius)} ${n(bottom)} H${n(x + radius)} Q${n(x)} ${n(bottom)} ${n(x)} ${n(bottom - radius)} V${n(y + radius)} Q${n(x)} ${n(y)} ${n(x + radius)} ${n(y)} Z`;
  }
  const at = position === 'top_right' ? x + width * .22 : x + width * .76;
  const tip = position === 'top_right' ? at - tail * .7 : at + tail * .7;
  return `M${n(x + radius)} ${n(y)} H${n(right - radius)} Q${n(right)} ${n(y)} ${n(right)} ${n(y + radius)} V${n(bottom - radius)} Q${n(right)} ${n(bottom)} ${n(right - radius)} ${n(bottom)} H${n(at + tail * .6)} L${n(tip)} ${n(bottom + tail)} L${n(at - tail * .6)} ${n(bottom)} H${n(x + radius)} Q${n(x)} ${n(bottom)} ${n(x)} ${n(bottom - radius)} V${n(y + radius)} Q${n(x)} ${n(y)} ${n(x + radius)} ${n(y)} Z`;
}
function graphicBackground(spec: RenderSpec, background: string, accent: string, surface: string): string {
  const w = spec.widthPx, h = spec.heightPx;
  const right = spec.creativeBrief?.textPosition !== 'top_right';
  const x = right ? w * .82 : w * .18;
  return `<rect width="${n(w)}" height="${n(h)}" fill="${background}"/>
    <circle cx="${n(x)}" cy="${n(h * .50)}" r="${n(Math.min(w,h) * .32)}" fill="${accent}" opacity=".85"/>
    <circle cx="${n(x - w * .04)}" cy="${n(h * .53)}" r="${n(Math.min(w,h) * .20)}" fill="${background}"/>
    <path d="M${n(right ? w * .63 : 0)} ${n(h * .73)} L${n(right ? w : w * .38)} ${n(h * .52)}" stroke="${surface}" stroke-width="${n(Math.min(w,h) * .018)}" fill="none"/>`;
}

/** Creative artwork + fixed typography. No AI is involved in this compositor. */
export function buildCreativeSvg(spec: RenderSpec, backgroundDataUri?: string, logoDataUri?: string, measure: TextMeasurer = conservativeMeasure, logoPlate?: CreativeLogoPlate): string {
  const brief = spec.creativeBrief;
  if (!brief) throw new Error('Creative brief required.');
  for (const uri of [backgroundDataUri, logoDataUri]) if (uri && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(uri)) throw new Error('Invalid embedded image');
  const w = spec.widthPx, h = spec.heightPx, base = Math.min(w,h), margin = base * .05;
  const background = color(spec.colors.background), foreground = color(spec.colors.foreground), accent = color(spec.colors.accent);
  const surface = color(spec.colors.surface ?? foreground);
  const colorResolution = resolveCreativePalette(spec);
  if (logoPlate && logoDataUri) {
    if (!Object.values(spec.colors).includes(logoPlate.background)) throw new Error('Logo backdrop must use an approved brand color.');
    colorResolution.logo = logoPlate;
  }
  const zone = creativeTextZone(w,h,brief.textPosition);
  const bubble = brief.textTreatment === 'speech_bubble';
  const tail = bubble ? base * .028 : 0;
  const padding = base * (brief.textTreatment === 'image_led' ? .022 : .032);
  const treatment = brief.textTreatment;
  const panelFill = colorResolution.panel.background;
  const ink = colorResolution.panel.foreground;
  const copy = fitCopy(spec, zone.width - padding * 2, zone.height - padding * 2 - tail, measure);
  const panelHeight = copy.headline.height + (copy.subline?.height ?? 0) + copy.gap + padding * 2;
  const panelY = brief.textPosition === 'bottom_left' ? zone.y + zone.height - panelHeight : zone.y;
  const panel = bubble
    ? `<path data-panel="speech_bubble" d="${bubblePath(zone.x,panelY,zone.width,panelHeight,base * .023,tail,brief.textPosition)}" fill="${panelFill}" stroke="${accent}" stroke-width="${n(base * .002)}"/>`
    : `<rect data-panel="${treatment}" x="${n(zone.x)}" y="${n(panelY)}" width="${n(zone.width)}" height="${n(panelHeight)}" rx="${n(treatment === 'image_led' ? base * .008 : 0)}" fill="${panelFill}"/>`;
  const accentDecoration = treatment === 'editorial'
    ? `<rect x="${n(zone.x)}" y="${n(panelY)}" width="${n(base * (spec.variant === 'A' ? .008 : .014))}" height="${n(panelHeight)}" fill="${accent}"/>`
    : `<path d="M${n(zone.x + padding)} ${n(panelY + padding * .50)} h${n(base * (spec.variant === 'A' ? .065 : .095))}" stroke="${accent}" stroke-width="${n(base * .004)}"/>`;
  const heading = textBlock(copy.headline,zone.x + padding,panelY + padding,spec.headingFamily,ink,800,'headline',spec.headline);
  const subline = copy.subline ? textBlock(copy.subline,zone.x + padding,panelY + padding + copy.headline.height + copy.gap,spec.bodyFamily,ink,400,'subline',spec.subline ?? '') : '';

  const footerY = h * .85, footerPadding = margin * .45;
  const footerInk = colorResolution.footer.foreground;
  const hasLogo = Boolean(logoDataUri) || Boolean(spec.logoText?.trim());
  const logoWidth = hasLogo ? w * .26 : 0;
  const logoHeight = Math.min(base * .078,h * .15 - footerPadding * 2);
  const ctaWidth = w - margin * 2 - logoWidth - (hasLogo ? margin * .6 : 0) - base * .05;
  /* The footer carries the wordmark either way; the call to action only when
     the image is a click target. An arrow drawn on an organic post points at
     nothing the viewer can tap (see `CLICKABLE_IMAGE_CHANNELS`). */
  const ctaCopy = spec.ctaText;
  const cta = ctaCopy === null ? null : fitSingle(ctaCopy,ctaWidth,h * .15 - footerPadding * 2,base * .028,Math.max(10,base * .016),spec.bodyFamily,700,measure);
  const ctaY = cta === null ? 0 : footerY + (h * .15 - cta.height) / 2;
  const finalLine = cta?.lines[cta.lines.length - 1] ?? '';
  const arrowX = cta === null ? 0 : margin + measure(finalLine,spec.bodyFamily,cta.fontSize,700) + cta.fontSize * .4;
  const arrowY = cta === null ? 0 : ctaY + cta.fontSize * .68 + (cta.lines.length - 1) * cta.leading;
  const logoX = w - margin - logoWidth, logoY = footerY + (h * .15 - logoHeight) / 2;
  let logo = '';
  if (logoDataUri && logoPlate?.mode === 'brand_plate') {
    const clearSpace = base * .012;
    const plateHeight = Math.min(h * .15 - footerPadding * 2,logoHeight + clearSpace * 2);
    const plateY = footerY + (h * .15 - plateHeight) / 2;
    logo = `<rect data-logo-plate="brand" x="${n(logoX)}" y="${n(plateY)}" width="${n(logoWidth)}" height="${n(plateHeight)}" fill="${logoPlate.background}"/>
      <image data-brand="logo" href="${logoDataUri}" x="${n(logoX + clearSpace)}" y="${n(plateY + clearSpace)}" width="${n(logoWidth - clearSpace * 2)}" height="${n(plateHeight - clearSpace * 2)}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  else if (logoDataUri) logo = `<image data-brand="logo" href="${logoDataUri}" x="${n(logoX)}" y="${n(logoY)}" width="${n(logoWidth)}" height="${n(logoHeight)}" preserveAspectRatio="xMaxYMid meet"/>`;
  else if (spec.logoText?.trim()) {
    const fitted = fitSingle(spec.logoText,logoWidth,logoHeight,base * .025,Math.max(10,base * .016),spec.headingFamily,800,measure);
    logo = textBlock(fitted,logoX,footerY + (h * .15 - fitted.height) / 2,spec.headingFamily,footerInk,800,'logo',spec.logoText);
  }
  const artwork = backgroundDataUri
    ? `<image data-artwork="background" href="${backgroundDataUri}" x="0" y="0" width="${n(w)}" height="${n(h)}" preserveAspectRatio="xMidYMid slice"/>`
    : graphicBackground(spec,background,accent,surface);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}" data-composition="${treatment}" data-artwork-source="${backgroundDataUri ? 'supplied_image' : 'deterministic_graphic'}" data-text-zone="${[zone.x,zone.y,zone.width,zone.height].map(n).join(' ')}">
    <title>${esc(spec.headline)}</title><desc>${backgroundDataUri ? 'Aangeleverd beeld met gecontroleerde merktekst en logo.' : 'Grafische merkcompositie zonder gegenereerde foto.'}</desc>
    <metadata id="creative-color-resolution">${esc(JSON.stringify(colorResolution))}</metadata>
    ${artwork}${panel}${accentDecoration}${heading}${subline}
    <rect data-footer="brand" x="0" y="${n(footerY)}" width="${n(w)}" height="${n(h * .15)}" fill="${colorResolution.footer.background}"/>
    ${cta === null || ctaCopy === null ? '' : `${textBlock(cta,margin,ctaY,spec.bodyFamily,footerInk,700,'cta',ctaCopy)}${arrow(arrowX,arrowY,cta.fontSize * .8,footerInk)}`}${logo}
  </svg>`;
}
