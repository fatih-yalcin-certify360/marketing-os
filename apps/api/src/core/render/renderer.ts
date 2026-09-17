import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Resvg, type ResvgRenderOptions } from '@resvg/resvg-js';
import sharp from 'sharp';
import { IMAGE_MIME_TYPE, type ImageEncoding, type RenderSpec } from '@c360/contracts';
import { buildSvg, buildPhotoSvg } from './layouts.js';
import { resolveCreativePalette, type CreativeLogoPlate, type CreativePaletteResolution, type TextMeasurer } from './creative-layouts.js';
import { escapeMarkup } from './markup.js';

/**
 * Rasterises a brand-driven SVG to PNG.
 *
 * `@resvg/resvg-js` is used rather than a headless browser: it ships prebuilt
 * binaries (including musl, so the Alpine image works), renders deterministically,
 * and needs no browser process per image.
 *
 * Storage rules that matter:
 *  - files are written under `STORAGE_ROOT` with a **server-generated** name
 *    derived from the content hash, so no user-supplied string ever reaches a
 *    filesystem path (path traversal has no way in);
 *  - the same content renders to the same hash, so an unchanged image is
 *    reused instead of re-rendered and re-stored;
 *  - nothing is served from a guessable public URL — downloads go through an
 *    authorised endpoint that checks label access.
 */

export interface RenderedImage {
  /** The stored bytes, in `encoding`. The field keeps its name for callers. */
  png: Buffer;
  /** What was actually written; `image/jpeg` for everything we publish. */
  encoding: ImageEncoding;
  mimeType: string;
  sha256: string;
  /** Path relative to STORAGE_ROOT. Never contains user input. */
  storagePath: string;
  widthPx: number;
  heightPx: number;
  byteSize: number;
  /** The SVG source, kept for debugging and for an SVG export variant. */
  svg: string;
  /** Actual accessible pairs from the approved palette, including any surface substitution. */
  colorResolution?: CreativePaletteResolution;
}

export class ImageRenderer {
  constructor(private readonly storageRoot: string) {}

  get storageRootPath(): string { return this.storageRoot; }

  /**
   * Renders one spec.
   *
   * Portal profiles supply pinned local fonts and disable system fallback.
   * Manual/demo profiles retain system fonts until files are supplied.
   */
  async render(
    labelId: string,
    spec: RenderSpec,
    resources: {
      fontFiles?: string[];
      backgroundPng?: Buffer;
      logoDataUri?: string;
      headingFamily?: string;
      bodyFamily?: string;
      /**
       * What to store. Defaults to PNG for the brand preview and anything that
       * never leaves the tool; every publishable channel asks for JPEG, because
       * Instagram accepts nothing else and a 1080×1350 PNG runs to about 1.5 MB
       * (audit 2026-09-15).
       */
      encoding?: ImageEncoding;
    } = {},
  ): Promise<RenderedImage> {
    const resolvedSpec = { ...spec, headingFamily: resources.headingFamily ?? spec.headingFamily, bodyFamily: resources.bodyFamily ?? spec.bodyFamily };
    const colorResolution = spec.creativeBrief ? resolveCreativePalette(resolvedSpec) : undefined;
    const logoPlate = colorResolution && resources.logoDataUri ? resolveCreativeLogoPlate(resolvedSpec,resources.logoDataUri,colorResolution.footer.background) : undefined;
    if (colorResolution && logoPlate) colorResolution.logo = logoPlate;
    const font: NonNullable<ResvgRenderOptions['font']> = {
      loadSystemFonts: !resources.fontFiles?.length,
      fontFiles: resources.fontFiles ?? [],
      defaultFontFamily: resources.bodyFamily ?? spec.bodyFamily,
    };
    const measure = spec.creativeBrief ? createTextMeasurer(font) : undefined;
    const svg = resources.backgroundPng
      ? buildPhotoSvg(resolvedSpec, `data:image/png;base64,${resources.backgroundPng.toString('base64')}`, resources.logoDataUri, measure, logoPlate)
      : buildSvg(resolvedSpec, resources.logoDataUri, measure, logoPlate);

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: spec.widthPx },
      font,
      // Transparent areas are flattened onto the brand background, so a JPEG
      // conversion later cannot turn transparency into black.
      background: spec.colors.background,
    });

    const rendered = resvg.render();
    const encoding: ImageEncoding = resources.encoding ?? 'png';
    const raster = Buffer.from(rendered.asPng());
    // The SVG is flattened onto the brand background above, so there is no
    // transparency left to lose. Quality 82 with 4:2:0 keeps brand type crisp
    // at roughly a tenth of the PNG's bytes.
    const bytes =
      encoding === 'jpeg'
        ? await sharp(raster).jpeg({ quality: 82, chromaSubsampling: '4:2:0', mozjpeg: true }).toBuffer()
        : raster;
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    // Sharded by the first two hex characters to keep directories small, and
    // scoped by label so one label's files never sit inside another's.
    const storagePath = path.posix.join(
      'labels',
      sanitiseSegment(labelId),
      'rendered',
      sha256.slice(0, 2),
      `${sha256}.${encoding === 'jpeg' ? 'jpg' : 'png'}`,
    );

    const absolute = path.join(this.storageRoot, storagePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);

    return {
      png: bytes,
      encoding,
      mimeType: IMAGE_MIME_TYPE[encoding],
      sha256,
      storagePath,
      widthPx: rendered.width,
      heightPx: rendered.height,
      byteSize: bytes.byteLength,
      svg,
      ...(colorResolution ? { colorResolution } : {}),
    };
  }

  absolutePathFor(storagePath: string): string {
    const resolved = path.resolve(this.storageRoot, storagePath);
    const root = path.resolve(this.storageRoot);
    // Defence in depth: even though paths are server-generated, refuse anything
    // that would resolve outside the storage root.
    if (!resolved.startsWith(root + path.sep)) {
      throw new Error('Resolved storage path escapes STORAGE_ROOT.');
    }
    return resolved;
  }
}

/** Preserve the real logo's pixels; only its compact backdrop may change within the approved palette. */
export function resolveCreativeLogoPlate(spec: RenderSpec, logoDataUri: string, footerBackground: string): CreativeLogoPlate {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(logoDataUri)) throw new Error('Invalid embedded logo');
  resolveCreativePalette(spec);
  if (!Object.values(spec.colors).includes(footerBackground)) throw new Error('Logo backdrop must use an approved brand color.');
  const pixels = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><image href="${logoDataUri}" width="96" height="96" preserveAspectRatio="xMidYMid meet"/></svg>`,{font:{loadSystemFonts:false}}).render().pixels;
  const rgb = (hex: string): number[] => {
    const raw = hex.slice(1);
    const expanded = raw.length === 3 ? [...raw].map(value => value + value).join('') : raw;
    return [0,2,4].map(offset => parseInt(expanded.slice(offset,offset + 2),16) / 255);
  };
  const luminance = (channels: readonly number[]): number => channels.reduce((sum,channel,index) => sum + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * ([.2126,.7152,.0722][index] ?? 0),0);
  const score = (background: string): number => {
    const backdrop = rgb(background), backdropLight = luminance(backdrop);
    let weighted = 0, weights = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const alpha = (pixels[offset + 3] ?? 0) / 255;
      if (alpha < .05) continue;
      // resvg exposes premultiplied RGBA; multiplying the logo channels by alpha again darkens its edges.
      const composite = backdrop.map((channel,index) => (pixels[offset + index] ?? 0) / 255 + channel * (1 - alpha));
      const logoLight = luminance(composite);
      weighted += ((Math.max(backdropLight,logoLight) + .05) / (Math.min(backdropLight,logoLight) + .05)) * alpha;
      weights += alpha;
    }
    if (weights === 0) throw new Error('Het merklogo bevat geen zichtbare pixels. Controleer het logo in de Brand Portal.');
    return weighted / weights;
  };
  const current = score(footerBackground);
  // Logos are not ordinary text: this prevents an unnecessary plate when the mark already reads clearly.
  if (current >= 3) return {background:footerBackground,mode:'footer',contrastScore:current};
  const candidates = [...new Set(Object.values(spec.colors).filter((value): value is string => typeof value === 'string'))];
  let selected = {background:footerBackground,contrastScore:current};
  for (const background of candidates) {
    const contrastScore = score(background);
    if (contrastScore > selected.contrastScore) selected = {background,contrastScore};
  }
  return {...selected,mode:selected.background === footerBackground ? 'footer' : 'brand_plate'};
}

/** Uses the exact rasterizer/font resources used for final output; cache at a common em size. */
function createTextMeasurer(font: NonNullable<ResvgRenderOptions['font']>): TextMeasurer {
  const widths = new Map<string, number>();
  return (text, family, size, weight) => {
    if (!text) return 0;
    const key = `${family}:${String(weight)}:${text}`;
    let width = widths.get(key);
    if (width === undefined) {
      const probe = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="50000" height="512"><text x="32" y="256" font-family="${escapeMarkup(family)}" font-size="64" font-weight="${String(weight)}">${escapeMarkup(text)}</text></svg>`, { font });
      const bounds = probe.getBBox();
      if (!bounds || bounds.width <= 0) throw new Error('De merklettertypen konden niet worden gemeten. Controleer de aangeleverde fontbestanden.');
      // Leave room for glyph overhangs, including italics, and avoid a fit right on the border.
      width = bounds.width + 4;
      widths.set(key, width);
    }
    return width * size / 64;
  };
}

/** Only hex and dashes survive, so a segment can never contain a path. */
function sanitiseSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9-]/gu, '');
  if (cleaned.length === 0) {
    throw new Error('Storage path segment is empty after sanitisation.');
  }
  return cleaned;
}
