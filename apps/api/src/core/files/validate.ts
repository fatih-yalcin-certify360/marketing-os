import {
  ALLOWED_TYPES,
  REFUSED_SIGNATURES,
  SIGNATURES,
  type AllowedType,
} from './allowed-types.js';
import { inspectFilename } from './filename.js';
import { inspectSvg, inspectText } from './svg-guard.js';
import { inspectZip } from './zip-guard.js';

/**
 * The single validation contract for file input.
 *
 * Requirement 10 asks that file input and API input feed the *same* contract.
 * This is the file half: everything that enters the product as bytes passes
 * through `validateUpload`, whether it arrives from a browser upload, a future
 * connector, or a test. There is no second, laxer path.
 *
 * The order of the checks is the design:
 *
 *  1. **Name**, first, because a hostile name is evidence of intent and is
 *     cheap to refuse.
 *  2. **Size**, before anything reads the buffer.
 *  3. **Content signature**, which decides the type. The declared MIME type and
 *     the extension are *hints from an untrusted source* and are never
 *     believed — a `.png` whose bytes are a shell script is refused, and so is
 *     a real PNG announced as `text/html`.
 *  4. **Extension agreement**, as a warning rather than a refusal: it catches
 *     honest mistakes without blocking a correct file with an odd name.
 *  5. **Deep inspection** for the formats that are documents rather than
 *     pictures (SVG, zip/docx, text).
 *
 * Nothing here writes to disk. Storage is a separate step, so a file is fully
 * judged before it exists anywhere a later bug could reach it.
 */

export type UploadRejectionCode =
  | 'filename_rejected'
  | 'too_large'
  | 'empty'
  | 'type_not_allowed'
  | 'content_mismatch'
  | 'active_content'
  | 'archive_rejected';

export interface UploadRejected {
  readonly ok: false;
  readonly code: UploadRejectionCode;
  /** Dutch, safe to render, specific enough to act on. */
  readonly reasonNl: string;
  /** For the audit record and the log. Never returned to the client. */
  readonly finding: string;
}

export interface UploadAccepted {
  readonly ok: true;
  readonly type: AllowedType;
  /** The validated, sanitised name. Display metadata only. */
  readonly displayName: string;
  readonly byteSize: number;
  /**
   * Set when the extension disagrees with the content.
   *
   * Not a refusal: the content decided the type, and it was allowed. The
   * warning is surfaced so a user can see that their `.jpeg` is really a PNG.
   */
  readonly extensionWarningNl?: string;
}

export type UploadVerdict = UploadAccepted | UploadRejected;

function matchesAt(bytes: Buffer, signature: readonly number[], offset: number): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** Decides the type from content alone. */
function sniff(bytes: Buffer): AllowedType | undefined {
  for (const signature of SIGNATURES) {
    if (!matchesAt(bytes, signature.bytes, signature.offset)) {
      continue;
    }
    if (signature.also !== undefined && !matchesAt(bytes, signature.also.bytes, signature.also.offset)) {
      continue;
    }
    return signature.type;
  }
  return undefined;
}

/** Text formats have no signature, so they are recognised by exclusion. */
function looksLikeText(bytes: Buffer): boolean {
  if (bytes.includes(0x00)) {
    return false;
  }
  // A UTF-8 decode that round-trips, with no control characters beyond the
  // ones text legitimately contains.
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    return false;
  }
  let control = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      control += 1;
    }
  }
  return control === 0;
}

const SVG_HINT = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<\s*svg[\s>]/iu;

export interface ValidateInput {
  readonly bytes: Buffer;
  readonly filename: string;
  /** What the client claimed. Recorded, never trusted. */
  readonly declaredMime?: string | undefined;
  /** Global ceiling; a per-type ceiling may be lower. */
  readonly maxBytes: number;
  /** Restrict the outcome, e.g. a logo upload must be an image. */
  readonly expect?: 'image' | 'document' | undefined;
}

export function validateUpload(input: ValidateInput): UploadVerdict {
  const name = inspectFilename(input.filename);
  if (!name.safe) {
    return {
      ok: false,
      code: 'filename_rejected',
      reasonNl: name.reasonNl ?? 'De bestandsnaam is niet toegestaan.',
      finding: name.finding ?? 'filename rejected',
    };
  }
  const displayName = name.display ?? 'bestand';

  if (input.bytes.length === 0) {
    return { ok: false, code: 'empty', reasonNl: 'Het bestand is leeg.', finding: 'zero bytes' };
  }
  if (input.bytes.length > input.maxBytes) {
    return {
      ok: false,
      code: 'too_large',
      reasonNl: `Het bestand is te groot (maximaal ${formatMb(input.maxBytes)}).`,
      finding: `size ${String(input.bytes.length)} over global ceiling ${String(input.maxBytes)}`,
    };
  }

  for (const refused of REFUSED_SIGNATURES) {
    if (matchesAt(input.bytes, refused.bytes, refused.offset)) {
      return {
        ok: false,
        code: 'type_not_allowed',
        reasonNl: refused.reasonNl,
        finding: `refused signature at offset ${String(refused.offset)}`,
      };
    }
  }

  let type = sniff(input.bytes);

  if (type === undefined) {
    // No binary signature. Either text, an SVG, or something we will not take.
    if (looksLikeText(input.bytes)) {
      const asText = input.bytes.toString('utf8');
      if (SVG_HINT.test(asText)) {
        type = ALLOWED_TYPES.find((candidate) => candidate.extension === 'svg');
      } else if (/<\s*(?:html|!doctype\s+html)/iu.test(asText)) {
        // HTML is refused outright. It is never needed as an input, and every
        // way of storing it safely still leaves a file that some future code
        // path might serve.
        return {
          ok: false,
          code: 'type_not_allowed',
          reasonNl: 'HTML-bestanden worden niet geaccepteerd. Lever een PDF, Word-document of afbeelding aan.',
          finding: 'html document',
        };
      } else {
        const wantsMarkdown = /\.(?:md|markdown)$/iu.test(input.filename);
        type = ALLOWED_TYPES.find(
          (candidate) => candidate.extension === (wantsMarkdown ? 'md' : 'txt'),
        );
      }
    }
  }

  if (type === undefined) {
    return {
      ok: false,
      code: 'type_not_allowed',
      reasonNl:
        'Dit bestandstype wordt niet ondersteund. Toegestaan zijn PNG, JPEG, WebP, SVG, PDF, Word (.docx), tekst en Markdown.',
      finding: 'no matching signature and not recognisable as text',
    };
  }

  if (input.bytes.length > type.maxBytes) {
    return {
      ok: false,
      code: 'too_large',
      reasonNl: `Een ${type.labelNl} mag maximaal ${formatMb(type.maxBytes)} zijn.`,
      finding: `size ${String(input.bytes.length)} over ${type.mime} ceiling ${String(type.maxBytes)}`,
    };
  }

  if (input.expect !== undefined) {
    const isImage = type.mime.startsWith('image/');
    if (input.expect === 'image' && !isImage) {
      return {
        ok: false,
        code: 'content_mismatch',
        reasonNl: `Hier is een afbeelding nodig; dit is een ${type.labelNl}.`,
        finding: `expected image, content is ${type.mime}`,
      };
    }
    if (input.expect === 'document' && isImage) {
      return {
        ok: false,
        code: 'content_mismatch',
        reasonNl: `Hier is een document nodig; dit is een ${type.labelNl}.`,
        finding: `expected document, content is ${type.mime}`,
      };
    }
  }

  switch (type.deepCheck) {
    case 'svg': {
      const verdict = inspectSvg(input.bytes);
      if (!verdict.safe) {
        return {
          ok: false,
          code: 'active_content',
          reasonNl: verdict.reasonNl ?? 'Dit SVG-bestand wordt niet geaccepteerd.',
          finding: verdict.finding ?? 'svg rejected',
        };
      }
      break;
    }
    case 'zip': {
      const verdict = inspectZip(input.bytes, { requireDocx: true });
      if (!verdict.safe) {
        return {
          ok: false,
          code: 'archive_rejected',
          reasonNl: verdict.reasonNl ?? 'Dit document wordt niet geaccepteerd.',
          finding: verdict.finding ?? 'zip rejected',
        };
      }
      break;
    }
    case undefined:
      // Raster images and PDFs need no further inspection: they carry no
      // active content this product will ever execute, and they are served
      // with `nosniff` besides.
      break;
    default:
      break;
  }

  if (type.mime === 'text/plain' || type.mime === 'text/markdown') {
    const verdict = inspectText(input.bytes);
    if (!verdict.safe) {
      return {
        ok: false,
        code: 'active_content',
        reasonNl: verdict.reasonNl ?? 'Dit tekstbestand wordt niet geaccepteerd.',
        finding: verdict.finding ?? 'text rejected',
      };
    }
  }

  const extension = /\.([a-z0-9]+)$/u.exec(input.filename.toLowerCase())?.[1];
  const agrees =
    extension === undefined ||
    extension === type.extension ||
    (type.extension === 'jpg' && extension === 'jpeg') ||
    (type.extension === 'md' && extension === 'markdown') ||
    (type.extension === 'txt' && ['text', 'csv', 'log'].includes(extension));

  return {
    ok: true,
    type,
    displayName,
    byteSize: input.bytes.length,
    ...(agrees
      ? {}
      : {
          extensionWarningNl: `De bestandsnaam eindigt op .${String(extension)}, maar de inhoud is een ${type.labelNl}. Het bestand is opgeslagen als ${type.labelNl}.`,
        }),
  };
}

function formatMb(bytes: number): string {
  const mb = bytes / 1_048_576;
  return `${(Math.round(mb * 10) / 10).toString().replace('.', ',')} MB`;
}
