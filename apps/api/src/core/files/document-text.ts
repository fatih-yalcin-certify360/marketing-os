import { readFile } from 'node:fs/promises';
import { extractDocxText } from './docx-text.js';
import { extractPdfText } from './pdf-text.js';
import { inspectText } from './svg-guard.js';

/**
 * Reads the prose out of an uploaded document.
 *
 * The single entry point, so a caller does not learn which formats exist or
 * which library reads which one. Three properties hold whatever the format:
 *
 *  - **The stored MIME type decides**, not the filename. The type was settled
 *    at upload by looking at the bytes (`validate.ts`), so it is the one piece
 *    of metadata that was not supplied by the client.
 *  - **The output is text, never markup.** Nothing downstream can render it.
 *  - **It is task data, never an instruction.** The prompt layer puts it in the
 *    user message inside a delimited block (threat T-05).
 *
 * A format that cannot be read comes back with `ok: false` and a Dutch reason
 * the user can act on — "this is probably a scan, supply a text version" is
 * worth far more than an empty result. Nothing is ever guessed to fill a gap.
 */

export interface DocumentText {
  readonly ok: boolean;
  readonly text: string;
  /** Dutch, safe to render. Set when the document could not be read. */
  readonly reasonNl?: string;
  /** For the log and the audit record. Never returned to a client. */
  readonly finding?: string;
  /** True when the text was cut at a ceiling. */
  readonly truncated?: boolean;
}

/** MIME types this can read, and what reads them. */
export const READABLE_DOCUMENT_TYPES: readonly string[] = Object.freeze([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
]);

export function isReadableDocumentType(mimeType: string): boolean {
  return READABLE_DOCUMENT_TYPES.includes(mimeType);
}

export async function extractDocumentText(
  bytes: Buffer,
  mimeType: string,
  maxChars = 40_000,
): Promise<DocumentText> {
  switch (mimeType) {
    case 'application/pdf': {
      /*
       * The PDF reader runs pdfjs in a `worker_threads` worker, so the parent
       * can terminate it even if a page never yields. Its result carries a
       * Dutch reason but no internal `finding` — nothing crosses the thread
       * boundary except the validated result — so the finding is composed here
       * from what the parent knows.
       */
      const result = await extractPdfText(bytes);
      if (result.ok) {
        return { ok: true, text: result.text, truncated: result.truncated };
      }
      return {
        ok: false,
        text: '',
        ...(result.reasonNl === undefined ? {} : { reasonNl: result.reasonNl }),
        finding: `pdf reader returned no text after ${String(result.pagesRead)} of ${String(
          result.pageCount,
        )} page(s)`,
      };
    }

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const result = extractDocxText(bytes, maxChars);
      if (result.ok) {
        return { ok: true, text: result.text, truncated: result.truncated === true };
      }
      return {
        ok: false,
        text: '',
        ...(result.reasonNl === undefined ? {} : { reasonNl: result.reasonNl }),
        ...(result.finding === undefined ? {} : { finding: result.finding }),
      };
    }

    case 'text/plain':
    case 'text/markdown': {
      // Re-checked rather than trusted: the file was validated at upload, but a
      // restore or a manual change could have replaced it since.
      const verdict = inspectText(bytes);
      if (!verdict.safe) {
        return {
          ok: false,
          text: '',
          reasonNl: verdict.reasonNl ?? 'Dit tekstbestand kon niet worden gelezen.',
          finding: verdict.finding ?? 'text re-check failed',
        };
      }
      const raw = bytes.toString('utf8');
      const text = raw
        .split('\n')
        .map((line) => line.replace(/[\s\u200b]+/gu, ' ').trim())
        .filter((line) => line.length > 0)
        .join('\n');

      if (text.length === 0) {
        return {
          ok: false,
          text: '',
          reasonNl: 'Dit bestand bevat geen tekst.',
          finding: 'empty after normalisation',
        };
      }
      return text.length > maxChars
        ? { ok: true, text: `${text.slice(0, maxChars)}…`, truncated: true }
        : { ok: true, text };
    }

    default:
      return {
        ok: false,
        text: '',
        reasonNl:
          'Dit bestandstype kan nog niet worden gelezen. Lever een PDF, Word-document of tekstbestand aan.',
        finding: `no reader for ${mimeType}`,
      };
  }
}

/**
 * Reads a stored asset from disk and extracts its text.
 *
 * Kept next to the extractors so a caller does not have to know that a stored
 * path must be resolved through the file store's containment check first.
 */
export async function extractStoredDocumentText(
  absolutePath: string,
  mimeType: string,
  maxChars = 40_000,
): Promise<DocumentText> {
  let bytes: Buffer;
  try {
    bytes = await readFile(absolutePath);
  } catch (error: unknown) {
    return {
      ok: false,
      text: '',
      // The row can outlive the file after a restore; saying so is honest.
      reasonNl: 'Het bestand is niet meer beschikbaar.',
      finding: `reading ${absolutePath} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  return extractDocumentText(bytes, mimeType, maxChars);
}
