/**
 * Archive inspection, without extracting anything.
 *
 * A `.docx` is a zip, so accepting Word documents means accepting a zip. The
 * classic attack is a small archive that expands to gigabytes, and the classic
 * mistake is to discover this while extracting it.
 *
 * So nothing is extracted here. The zip **central directory** already states,
 * for every member, its compressed and uncompressed size and its name. That is
 * enough to refuse an archive on its own declared numbers before a single byte
 * is inflated:
 *
 *  - too many entries,
 *  - total declared uncompressed size over the ceiling,
 *  - a compression ratio no legitimate document reaches,
 *  - an entry name that escapes its directory (`../`, absolute, backslash),
 *  - the Office members a docx must have, so a plain zip renamed `.docx` is
 *    refused as what it is.
 *
 * A hostile archive can of course lie in its directory — but then extraction
 * would fail against the local header, and we never extract. The numbers here
 * are used only to say no.
 *
 * Requirement 13 (zip bomb protection); threat T-07.
 */

export interface ZipVerdict {
  readonly safe: boolean;
  readonly reasonNl?: string;
  /** For the audit record; never returned to the client. */
  readonly finding?: string;
  /** What the directory declared, for the log line. */
  readonly declared?: {
    readonly entries: number;
    readonly compressedBytes: number;
    readonly uncompressedBytes: number;
  };
}

/** Ceilings. A real Word document is nowhere near any of these. */
const MAX_ENTRIES = 512;
const MAX_TOTAL_UNCOMPRESSED = 64 * 1_048_576;
const MAX_RATIO = 200;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
/** The End of Central Directory record is 22 bytes plus up to 64 KiB of comment. */
const MAX_EOCD_SEARCH = 22 + 65_535;

/** Members every docx produced by Word or LibreOffice contains. */
const DOCX_REQUIRED = ['[Content_Types].xml', 'word/document.xml'];

function findEndOfCentralDirectory(buffer: Buffer): number | undefined {
  const start = Math.max(0, buffer.length - MAX_EOCD_SEARCH);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return undefined;
}

export function inspectZip(bytes: Buffer, options: { requireDocx: boolean }): ZipVerdict {
  if (bytes.length < 22) {
    return { safe: false, finding: 'too short to be a zip', reasonNl: 'Dit bestand is beschadigd.' };
  }

  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd === undefined) {
    return {
      safe: false,
      finding: 'no end-of-central-directory record',
      reasonNl: 'Dit bestand is beschadigd of geen geldig document.',
    };
  }

  const entryCount = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);

  if (entryCount === 0xffff || directoryOffset === 0xffffffff) {
    // Zip64. A legitimate Word document does not need it, and supporting it
    // would mean parsing a second directory format for no product benefit.
    return {
      safe: false,
      finding: 'zip64 archive',
      reasonNl: 'Dit document heeft een indeling die niet wordt ondersteund. Bewaar het opnieuw als .docx.',
    };
  }

  if (entryCount > MAX_ENTRIES) {
    return {
      safe: false,
      finding: `entry count ${String(entryCount)} over ceiling ${String(MAX_ENTRIES)}`,
      reasonNl: 'Dit document bestaat uit te veel onderdelen.',
    };
  }

  if (directoryOffset + directorySize > bytes.length) {
    return {
      safe: false,
      finding: 'central directory extends past end of file',
      reasonNl: 'Dit bestand is beschadigd.',
    };
  }

  let cursor = directoryOffset;
  let compressedTotal = 0;
  let uncompressedTotal = 0;
  const names: string[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    // 46 bytes is the fixed part of a central directory file header.
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== CENTRAL_FILE_SIGNATURE) {
      return {
        safe: false,
        finding: `malformed central directory entry ${String(index)}`,
        reasonNl: 'Dit bestand is beschadigd.',
      };
    }

    const compressed = bytes.readUInt32LE(cursor + 20);
    const uncompressed = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);

    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    names.push(name);

    // Path traversal inside the archive. We never extract, but an entry named
    // `../../etc/passwd` says what the file is for, and refusing it is free.
    if (name.startsWith('/') || name.includes('..') || name.includes('\\') || /^[a-zA-Z]:/u.test(name)) {
      return {
        safe: false,
        finding: `entry name escapes its directory: ${name.slice(0, 80)}`,
        reasonNl: 'Dit document bevat een onderdeel met een ongeldige naam en wordt niet geaccepteerd.',
      };
    }

    compressedTotal += compressed;
    uncompressedTotal += uncompressed;

    if (uncompressedTotal > MAX_TOTAL_UNCOMPRESSED) {
      return {
        safe: false,
        finding: `declared uncompressed total ${String(uncompressedTotal)} over ceiling`,
        reasonNl: 'Dit document is uitgepakt te groot om te verwerken.',
        declared: { entries: entryCount, compressedBytes: compressedTotal, uncompressedBytes: uncompressedTotal },
      };
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  // Ratio last, so a genuinely large document is refused on size (a message a
  // user can act on) rather than on ratio (one they cannot).
  if (compressedTotal > 0) {
    const ratio = uncompressedTotal / compressedTotal;
    if (ratio > MAX_RATIO) {
      return {
        safe: false,
        finding: `compression ratio ${ratio.toFixed(1)} over ceiling ${String(MAX_RATIO)}`,
        reasonNl: 'Dit document heeft een verdachte compressieverhouding en wordt niet geaccepteerd.',
        declared: { entries: entryCount, compressedBytes: compressedTotal, uncompressedBytes: uncompressedTotal },
      };
    }
  }

  if (options.requireDocx) {
    const missing = DOCX_REQUIRED.filter((required) => !names.includes(required));
    if (missing.length > 0) {
      return {
        safe: false,
        finding: `not a docx; missing ${missing.join(', ')}`,
        reasonNl:
          'Dit is geen Word-document. Archiefbestanden (.zip) worden niet geaccepteerd — lever een .docx, .pdf of afbeelding aan.',
      };
    }
  }

  return {
    safe: true,
    declared: {
      entries: entryCount,
      compressedBytes: compressedTotal,
      uncompressedBytes: uncompressedTotal,
    },
  };
}
