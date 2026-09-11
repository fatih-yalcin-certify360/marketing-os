import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import type { RenderSpec } from '@c360/contracts';
import { buildSvg, buildPhotoSvg } from './layouts.js';

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
  png: Buffer;
  sha256: string;
  /** Path relative to STORAGE_ROOT. Never contains user input. */
  storagePath: string;
  widthPx: number;
  heightPx: number;
  byteSize: number;
  /** The SVG source, kept for debugging and for an SVG export variant. */
  svg: string;
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
  async render(labelId: string, spec: RenderSpec, resources: { fontFiles?: string[]; backgroundPng?: Buffer; logoDataUri?: string; headingFamily?: string; bodyFamily?: string } = {}): Promise<RenderedImage> {
    const resolvedSpec = { ...spec, headingFamily: resources.headingFamily ?? spec.headingFamily, bodyFamily: resources.bodyFamily ?? spec.bodyFamily };
    const svg = resources.backgroundPng
      ? buildPhotoSvg(resolvedSpec, `data:image/png;base64,${resources.backgroundPng.toString('base64')}`, resources.logoDataUri)
      : buildSvg(resolvedSpec, resources.logoDataUri);

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: spec.widthPx },
      font: {
        loadSystemFonts: !resources.fontFiles?.length,
        fontFiles: resources.fontFiles ?? [],
        defaultFontFamily: resources.bodyFamily ?? spec.bodyFamily,
      },
      // Transparent areas are flattened onto the brand background, so a JPEG
      // conversion later cannot turn transparency into black.
      background: spec.colors.background,
    });

    const rendered = resvg.render();
    const png = Buffer.from(rendered.asPng());
    const sha256 = createHash('sha256').update(png).digest('hex');

    // Sharded by the first two hex characters to keep directories small, and
    // scoped by label so one label's files never sit inside another's.
    const storagePath = path.posix.join(
      'labels',
      sanitiseSegment(labelId),
      'rendered',
      sha256.slice(0, 2),
      `${sha256}.png`,
    );

    const absolute = path.join(this.storageRoot, storagePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, png);

    return {
      png,
      sha256,
      storagePath,
      widthPx: rendered.width,
      heightPx: rendered.height,
      byteSize: png.byteLength,
      svg,
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

/** Only hex and dashes survive, so a segment can never contain a path. */
function sanitiseSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9-]/gu, '');
  if (cleaned.length === 0) {
    throw new Error('Storage path segment is empty after sanitisation.');
  }
  return cleaned;
}
