import { inflateRawSync } from 'node:zlib';
import { inspectZip } from './zip-guard.js';

/**
 * Reads the prose out of a `.docx`.
 *
 * A docx is a zip containing `word/document.xml`. Two things make doing this by
 * hand the right choice rather than a shortcut:
 *
 *  1. **The archive is already inspected.** `zip-guard.ts` reads the central
 *     directory and refuses absurd entry counts, declared sizes, compression
 *     ratios and escaping entry names *without extracting anything*. So by the
 *     time this runs, the numbers have already been judged.
 *  2. **Only one member is inflated, under a hard cap.** Nothing else in the
 *     archive is touched — not the embedded images, not the custom XML, not the
 *     macros. A general-purpose unzip would happily hand all of it back.
 *
 * The output is text, never markup, so nothing downstream can render it. And it
 * is task data for a model, never an instruction (threat T-05).
 */

const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 22 + 65_535;

/** The member holding the document body. */
const BODY_MEMBER = 'word/document.xml';

/** Hard ceiling on inflated bytes, whatever the archive claims. */
const MAX_INFLATED_BYTES = 8 * 1_048_576;

export interface DocxText {
  readonly ok: boolean;
  readonly text: string;
  /** Dutch, safe to show. Set when the document could not be read. */
  readonly reasonNl?: string;
  /** For the log. Never returned to a client. */
  readonly finding?: string;
  /**
   * True when the text was cut at the ceiling.
   *
   * A silently truncated extract reads as complete, and someone confirming a
   * course fact from it would be confirming half a sentence. The flag is what
   * lets a caller say so.
   */
  readonly truncated?: boolean;
}

interface DirectoryEntry {
  readonly name: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function findEndOfCentralDirectory(buffer: Buffer): number | undefined {
  const start = Math.max(0, buffer.length - MAX_EOCD_SEARCH);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return undefined;
}

/** Locates one named member without reading any others. */
function findMember(bytes: Buffer, wanted: string): DirectoryEntry | undefined {
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd === undefined) {
    return undefined;
  }
  const entryCount = bytes.readUInt16LE(eocd + 10);
  let cursor = bytes.readUInt32LE(eocd + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== CENTRAL_FILE_SIGNATURE) {
      return undefined;
    }
    const compressionMethod = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    if (name === wanted) {
      return { name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset };
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}

/** Inflates one member, refusing to produce more than the cap. */
function readMember(bytes: Buffer, entry: DirectoryEntry): Buffer | undefined {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) {
    return undefined;
  }
  // The local header repeats the name and extra length; the data follows it.
  const nameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) {
    return undefined;
  }
  const data = bytes.subarray(dataStart, dataEnd);

  // 0 = stored, 8 = deflate. Anything else is not something Word writes.
  if (entry.compressionMethod === 0) {
    return data.length > MAX_INFLATED_BYTES ? undefined : data;
  }
  if (entry.compressionMethod !== 8) {
    return undefined;
  }
  try {
    // `maxOutputLength` is the real protection: it makes a lying directory
    // harmless, because the inflate itself stops rather than the check that
    // preceded it.
    return inflateRawSync(data, { maxOutputLength: MAX_INFLATED_BYTES });
  } catch {
    return undefined;
  }
}

/**
 * Turns WordprocessingML into plain text.
 *
 * `w:p` is a paragraph and `w:br`/`w:tab` are breaks; everything else is
 * dropped. A regex reducer rather than an XML parser, for the same reason as
 * the HTML one: the output is handed to a person to review, so a slightly
 * mangled extract is a worse proposal rather than a vulnerability — and a
 * parser would be a dependency and a new attack surface.
 */
function wordXmlToText(xml: string): string {
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/?>/gu, '\t')
    .replace(/<w:br\b[^>]*\/?>/gu, '\n')
    .replace(/<\/w:p>/gu, '\n')
    // Deleted revisions are not part of the document.
    .replace(/<w:del\b[\s\S]*?<\/w:del>/gu, ' ');

  const stripped = withBreaks.replace(/<[^>]*>/gu, '');

  return stripped
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    // Ampersand last, so an escaped entity is not double-decoded.
    .replace(/&amp;/gu, '&')
    .split('\n')
    .map((line) => line.replace(/[\s\u200b]+/gu, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

export function extractDocxText(bytes: Buffer, maxChars = 40_000): DocxText {
  // The archive's own numbers are judged before a byte is inflated.
  const archive = inspectZip(bytes, { requireDocx: true });
  if (!archive.safe) {
    return {
      ok: false,
      text: '',
      reasonNl: archive.reasonNl ?? 'Dit document kon niet worden gelezen.',
      finding: archive.finding ?? 'zip inspection refused the archive',
    };
  }

  const entry = findMember(bytes, BODY_MEMBER);
  if (entry === undefined) {
    return {
      ok: false,
      text: '',
      reasonNl: 'Dit Word-document heeft geen leesbare inhoud.',
      finding: `${BODY_MEMBER} not present in the archive`,
    };
  }

  const raw = readMember(bytes, entry);
  if (raw === undefined) {
    return {
      ok: false,
      text: '',
      reasonNl: 'De inhoud van dit Word-document kon niet worden uitgepakt.',
      finding: `inflating ${BODY_MEMBER} failed or exceeded ${String(MAX_INFLATED_BYTES)} bytes`,
    };
  }

  const text = wordXmlToText(raw.toString('utf8'));
  if (text.length === 0) {
    return {
      ok: false,
      text: '',
      reasonNl: 'Dit Word-document bevat geen tekst.',
      finding: 'document.xml produced no text',
    };
  }

  // The cap is clamped, so a hostile or mistaken `maxChars` cannot widen it.
  const cap = Math.max(1, Math.min(40_000, maxChars));
  return {
    ok: true,
    text: text.slice(0, cap),
    truncated: text.length > cap,
  };
}
