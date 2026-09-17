/*
 * Label theming: one palette in, a set of CSS custom properties out.
 *
 * The platform colours follow the *selected label*. A label's palette comes
 * from its approved brand profile (`brandProfileVersions.colors`, which the
 * Brand Portal fills from `tokens.palette.primary|accent|ink`). Nothing here
 * invents a colour: when a label has no approved profile the Certify360
 * house palette is used and the caller can say so in the interface.
 *
 * Why derived rather than authored: a brand primary is chosen for print and
 * large surfaces, not for 12px interface text. #00A894 on white is 2.99:1 —
 * below the 4.5:1 this product needs — so every token that carries text is
 * computed until it clears the threshold instead of being trusted as given.
 */

export interface LabelPalette {
  /** Dominant brand colour. */
  primary: string;
  /** Support colour for highlights and calls to action. */
  accent: string;
  /** Text / dark surface colour. */
  ink: string;
}

/** The Certify360 house palette: used when a label has no approved profile. */
export const HOUSE_PALETTE: LabelPalette = Object.freeze({
  primary: '#7A69D3',
  accent: '#9784FA',
  ink: '#183037',
});

const MIN_TEXT_CONTRAST = 4.6;

function toRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '').trim();
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(rgb: readonly number[]): string {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function mix(a: string, b: string, amount: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex(x.map((v, i) => v + (y[i]! - v) * amount));
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Darken `hex` in small steps until small text on white is legible. */
export function readableOnWhite(hex: string): string {
  let c = hex;
  for (let i = 0; i < 24 && contrast(c, '#ffffff') < MIN_TEXT_CONTRAST; i += 1) {
    c = mix(c, '#000000', 0.08);
  }
  return c;
}

/**
 * The CSS custom properties for one label.
 *
 * Two primary tokens on purpose:
 *  - `--lp` is the brand colour as given. Bars, markers, 3px accent rules,
 *    progress fills — anything that carries no text.
 *  - `--lp-solid` is the same colour darkened until 12px type on it passes.
 *    Every filled button, badge, pill and avatar uses this one.
 * Keeping them apart is what stopped the buttons failing contrast while the
 * brand still reads as itself.
 */
export function buildLabelTheme(palette: LabelPalette): Record<string, string> {
  const solid = readableOnWhite(palette.primary);
  const onSolid = contrast(solid, '#ffffff') >= contrast(solid, '#12212b') ? '#ffffff' : '#12212b';

  // The rail's active mark sits on --lp-shell, which is derived from ink. A
  // brand that uses one dark colour for both primary and ink would make a mark
  // painted from the primary invisible, so it falls back to the accent when the
  // primary does not separate from the shell.
  const shell = mix(palette.ink, '#000000', 0.12);
  const active = contrast(palette.primary, shell) < 1.5 ? palette.accent : palette.primary;

  return {
    '--lp': palette.primary,
    '--lp-active': active,
    '--lp-solid': solid,
    '--lp-deep': readableOnWhite(palette.primary),
    '--lp-accent': palette.accent,
    '--lp-ink': palette.ink,
    '--lp-on': onSolid,
    '--lp-t1': mix(palette.primary, '#ffffff', 0.94),
    '--lp-t2': mix(palette.primary, '#ffffff', 0.87),
    '--lp-t3': mix(palette.primary, '#ffffff', 0.7),
    '--lp-shell': mix(palette.ink, '#000000', 0.12),
    '--lp-shell-2': mix(palette.ink, '#ffffff', 0.1),
    '--lp-shell-tx': mix(palette.ink, '#ffffff', 0.62),
  };
}

/** Read a label palette off an approved brand profile, or fall back. */
export function paletteFromBrandColors(
  colors: { primary?: string | null; accent?: string | null; onSurface?: string | null } | null | undefined,
): { palette: LabelPalette; grounded: boolean } {
  if (colors?.primary == null || colors.accent == null) {
    return { palette: HOUSE_PALETTE, grounded: false };
  }
  return {
    palette: { primary: colors.primary, accent: colors.accent, ink: colors.onSurface ?? HOUSE_PALETTE.ink },
    grounded: true,
  };
}
