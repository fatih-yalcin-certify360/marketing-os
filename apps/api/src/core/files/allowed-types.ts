/**
 * The upload allow-list.
 *
 * Deny-by-default: a file is accepted only if its *content* matches one of
 * these signatures. The declared `Content-Type` and the file extension are
 * treated as hints from an untrusted source and never as evidence — a client
 * that labels an HTML file `image/png` must be refused on the bytes.
 *
 * The list is deliberately short. Every entry here is a format the product
 * actually needs for a brand profile or a course card, and each one carries a
 * reason it can be served safely (or, for SVG, a reason it cannot and what is
 * done instead).
 */

/** How a stored file may be handed back to a browser. */
export type ServingMode =
  /** Safe to render in an `<img>`: raster only, no active content. */
  | 'inline_image'
  /** Never rendered by this origin. Downloaded as an opaque attachment. */
  | 'attachment_only';

export interface AllowedType {
  /** Canonical MIME type. The declared one is discarded in favour of this. */
  readonly mime: string;
  /** Extension written into the stored filename. Never taken from the upload. */
  readonly extension: string;
  readonly servingMode: ServingMode;
  /** Per-type ceiling, which may be lower than the global one. */
  readonly maxBytes: number;
  /** Dutch label, for messages and for the UI. */
  readonly labelNl: string;
  /**
   * Extra content inspection beyond the signature.
   *
   *  - `svg`  — refuse anything with active content or an external reference.
   *  - `zip`  — inspect the archive directory without extracting it.
   */
  readonly deepCheck?: 'svg' | 'zip';
}

const MB = 1_048_576;

/**
 * Signature matchers.
 *
 * A prefix match on the magic bytes, plus an optional offset check, is enough
 * for this set. Nothing here relies on a heuristic: each format has a fixed,
 * documented header.
 */
interface Signature {
  readonly bytes: readonly number[];
  readonly offset: number;
  /** Additional bytes that must match at a second offset (RIFF/WEBP, …). */
  readonly also?: { readonly bytes: readonly number[]; readonly offset: number };
  readonly type: AllowedType;
}

export const PNG: AllowedType = {
  mime: 'image/png',
  extension: 'png',
  servingMode: 'inline_image',
  maxBytes: 10 * MB,
  labelNl: 'PNG-afbeelding',
};

export const JPEG: AllowedType = {
  mime: 'image/jpeg',
  extension: 'jpg',
  servingMode: 'inline_image',
  maxBytes: 10 * MB,
  labelNl: 'JPEG-afbeelding',
};

export const WEBP: AllowedType = {
  mime: 'image/webp',
  extension: 'webp',
  servingMode: 'inline_image',
  maxBytes: 10 * MB,
  labelNl: 'WebP-afbeelding',
};

/**
 * SVG.
 *
 * Accepted because brands ship vector logos, but never trusted: an SVG is a
 * document that can carry script, event handlers and external references. Two
 * consequences, both enforced:
 *
 *  1. It is **validated by rejection**, not by sanitisation (`svg-guard.ts`).
 *     Cleaning is where sanitisers get bypassed; refusing an SVG that contains
 *     anything active is a decision we can state and test.
 *  2. It is **never served inline**, so even a file that slipped past the guard
 *     cannot execute against this origin.
 */
export const SVG: AllowedType = {
  mime: 'image/svg+xml',
  extension: 'svg',
  servingMode: 'attachment_only',
  maxBytes: 2 * MB,
  labelNl: 'SVG-logo',
  deepCheck: 'svg',
};

export const PDF: AllowedType = {
  mime: 'application/pdf',
  extension: 'pdf',
  servingMode: 'attachment_only',
  maxBytes: 25 * MB,
  labelNl: 'PDF-document',
};

export const DOCX: AllowedType = {
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  extension: 'docx',
  servingMode: 'attachment_only',
  maxBytes: 25 * MB,
  labelNl: 'Word-document',
  deepCheck: 'zip',
};

export const PLAIN_TEXT: AllowedType = {
  mime: 'text/plain',
  extension: 'txt',
  servingMode: 'attachment_only',
  maxBytes: 2 * MB,
  labelNl: 'Tekstbestand',
};

export const MARKDOWN: AllowedType = {
  mime: 'text/markdown',
  extension: 'md',
  servingMode: 'attachment_only',
  maxBytes: 2 * MB,
  labelNl: 'Markdown-bestand',
};

/** Every type the product will accept, in match order. */
export const ALLOWED_TYPES: readonly AllowedType[] = Object.freeze([
  PNG,
  JPEG,
  WEBP,
  SVG,
  PDF,
  DOCX,
  PLAIN_TEXT,
  MARKDOWN,
]);

export const SIGNATURES: readonly Signature[] = Object.freeze([
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0, type: PNG },
  { bytes: [0xff, 0xd8, 0xff], offset: 0, type: JPEG },
  // RIFF....WEBP
  {
    bytes: [0x52, 0x49, 0x46, 0x46],
    offset: 0,
    also: { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
    type: WEBP,
  },
  { bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], offset: 0, type: PDF },
  // A docx is a zip. Which member of the zip family it is can only be settled
  // by looking inside, which `zip-guard.ts` does without extracting.
  { bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0, type: DOCX },
]);

/**
 * Archive and executable signatures that are refused with a specific reason.
 *
 * Without this they would fall through to "unrecognised", which is correct but
 * unhelpful; a user who uploaded a .zip deserves to be told that specifically.
 * Note that the `PK` prefix is shared with DOCX, so a plain zip is separated
 * from a docx inside the zip guard rather than here.
 */
export const REFUSED_SIGNATURES: readonly {
  bytes: readonly number[];
  offset: number;
  reasonNl: string;
}[] = Object.freeze([
  { bytes: [0x1f, 0x8b], offset: 0, reasonNl: 'Gecomprimeerde archieven (.gz) worden niet geaccepteerd.' },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], offset: 0, reasonNl: 'Archieven (.7z) worden niet geaccepteerd.' },
  { bytes: [0x52, 0x61, 0x72, 0x21], offset: 0, reasonNl: 'Archieven (.rar) worden niet geaccepteerd.' },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], offset: 0, reasonNl: 'Programmabestanden worden niet geaccepteerd.' },
  { bytes: [0x4d, 0x5a], offset: 0, reasonNl: 'Programmabestanden worden niet geaccepteerd.' },
  // #! — a script.
  { bytes: [0x23, 0x21], offset: 0, reasonNl: 'Scriptbestanden worden niet geaccepteerd.' },
]);
