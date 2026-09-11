import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { extractDocumentText, isReadableDocumentType } from '../../src/core/files/document-text.js';
import { extractDocxText } from '../../src/core/files/docx-text.js';

/**
 * Reading an uploaded document (backlog P1-3, P1-5).
 *
 * The documents here are **built**, not fixtures: a real zip with real deflate
 * streams and a real PDF with a real text operator. A mocked extractor would
 * pass whatever the extractor happens to do, which is the opposite of what
 * these tests are for — the formats are the thing being read, and their
 * quirks are where extraction breaks.
 *
 * Every path is bounded on purpose. A document is untrusted input that arrived
 * from outside, and the point of extracting text from it is to hand a *proposal*
 * to a person, so a mangled extract is a worse proposal rather than a
 * vulnerability. What must never happen is unbounded work or unbounded output.
 */

// ------------------------------------------------------------ zip building ---

interface Member {
  readonly name: string;
  readonly content: Buffer;
  /** Store uncompressed instead of deflating, to exercise method 0. */
  readonly stored?: boolean;
}

/**
 * Builds a real, valid zip.
 *
 * Local headers, deflate streams and a central directory, so the extractor
 * walks exactly what Word produces rather than something shaped like it.
 */
function buildZip(members: readonly Member[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const member of members) {
    const name = Buffer.from(member.name, 'utf8');
    const stored = member.stored === true;
    const data = stored ? member.content : deflateRawSync(member.content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(member.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(stored ? 0 : 8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(member.content.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += local.length + name.length + data.length;
  }

  const localBlock = Buffer.concat(locals);
  const centralBlock = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);

  return Buffer.concat([localBlock, centralBlock, eocd]);
}

const CONTENT_TYPES = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  'utf8',
);

function wordDocument(paragraphs: readonly string[]): Buffer {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
    .join('');
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    'utf8',
  );
}

function docx(paragraphs: readonly string[], extra: readonly Member[] = []): Buffer {
  return buildZip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES },
    { name: 'word/document.xml', content: wordDocument(paragraphs) },
    ...extra,
  ]);
}

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ------------------------------------------------------------------- tests ---

describe('Word documents', () => {
  it('reads the paragraphs, one per line', () => {
    const result = extractDocxText(
      docx([
        'Wft Basis is een basisopleiding.',
        'De opleiding richt zich op praktijkwerkers.',
      ]),
    );

    expect(result.ok).toBe(true);
    expect(result.text.split('\n')).toEqual([
      'Wft Basis is een basisopleiding.',
      'De opleiding richt zich op praktijkwerkers.',
    ]);
  });

  it('reads an uncompressed member too', () => {
    // Word deflates, but the format allows storing, and a file that stores is
    // still a valid file.
    const archive = buildZip([
      { name: '[Content_Types].xml', content: CONTENT_TYPES },
      { name: 'word/document.xml', content: wordDocument(['Opgeslagen zonder compressie.']), stored: true },
    ]);
    const result = extractDocxText(archive);
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Opgeslagen zonder compressie');
  });

  it('turns breaks and tabs into whitespace rather than dropping words', () => {
    const body = Buffer.from(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        '<w:p><w:r><w:t>Regel een</w:t><w:br/><w:t>Regel twee</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Kolom</w:t><w:tab/><w:t>waarde</w:t></w:r></w:p>' +
        '</w:body></w:document>',
      'utf8',
    );
    const result = extractDocxText(
      buildZip([
        { name: '[Content_Types].xml', content: CONTENT_TYPES },
        { name: 'word/document.xml', content: body },
      ]),
    );

    expect(result.text).toContain('Regel een');
    expect(result.text).toContain('Regel twee');
    // A tab must not glue two cells into one word.
    expect(result.text).toMatch(/Kolom\s+waarde/u);
  });

  it('leaves out text marked as deleted', () => {
    // A tracked deletion is not part of the document, and reading it back
    // would put removed wording into a course card.
    const body = Buffer.from(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        '<w:p><w:r><w:t>Blijft staan.</w:t></w:r>' +
        '<w:del><w:r><w:delText>Verwijderde prijs 999 euro.</w:delText></w:r></w:del></w:p>' +
        '</w:body></w:document>',
      'utf8',
    );
    const result = extractDocxText(
      buildZip([
        { name: '[Content_Types].xml', content: CONTENT_TYPES },
        { name: 'word/document.xml', content: body },
      ]),
    );

    expect(result.text).toContain('Blijft staan');
    expect(result.text).not.toContain('999');
  });

  it('decodes entities without double-decoding', () => {
    const body = Buffer.from(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        '<w:p><w:r><w:t>Kosten &amp;amp; baten</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>5 &lt; 10</w:t></w:r></w:p>' +
        '</w:body></w:document>',
      'utf8',
    );
    const result = extractDocxText(
      buildZip([
        { name: '[Content_Types].xml', content: CONTENT_TYPES },
        { name: 'word/document.xml', content: body },
      ]),
    );

    // `&amp;amp;` is the escaped form of `&amp;`, so it must decode once.
    expect(result.text).toContain('Kosten &amp; baten');
    expect(result.text).toContain('5 < 10');
  });

  it('reads only the body member, whatever else the archive holds', () => {
    // An embedded image or a macro is not prose and must not be touched.
    const result = extractDocxText(
      docx(['Alleen dit is tekst.'], [
        { name: 'word/media/image1.png', content: Buffer.alloc(4096, 0x7f) },
        { name: 'word/vbaProject.bin', content: Buffer.alloc(2048, 0x41) },
      ]),
    );

    expect(result.ok).toBe(true);
    expect(result.text).toBe('Alleen dit is tekst.');
    // 'A' repeated is what the macro member holds; none of it leaked through.
    expect(result.text).not.toMatch(/AAAA/u);
  });

  it('refuses a plain zip renamed .docx', () => {
    const result = extractDocxText(
      buildZip([{ name: 'holiday/photo.jpg', content: Buffer.alloc(64, 1) }]),
    );
    expect(result.ok).toBe(false);
    expect(result.reasonNl).toMatch(/Word-document/u);
  });

  it('refuses an archive whose directory claims an absurd expansion', () => {
    // The zip guard runs first, so the lie is caught before anything inflates.
    const archive = docx(['x']);
    // Rewrite the central directory's uncompressed size for the body member.
    const marker = archive.indexOf(Buffer.from('word/document.xml', 'utf8'), archive.length / 2);
    archive.writeUInt32LE(4_000_000_000, marker - 46 + 24);

    const result = extractDocxText(archive);
    expect(result.ok).toBe(false);
    expect(result.finding).toMatch(/uncompressed total|ratio/u);
  });

  it('refuses an empty document rather than returning nothing silently', () => {
    const result = extractDocxText(docx([]));
    expect(result.ok).toBe(false);
    expect(result.reasonNl).toMatch(/geen tekst/u);
  });

  it('truncates rather than returning an unbounded extract, and says it did', () => {
    const long = Array.from({ length: 400 }, (_unused, index) =>
      `Alinea ${String(index)} met genoeg tekst om de limiet te halen.`,
    );
    const result = extractDocxText(docx(long), 500);

    expect(result.ok, `${result.reasonNl ?? ''} | ${result.finding ?? ''}`).toBe(true);
    expect(result.text.length).toBe(500);
    // The flag is the point: a silently cut extract reads as complete, and
    // someone confirming a course fact from it would confirm half a sentence.
    expect(result.truncated).toBe(true);
  });

  it('does not claim truncation when the text fits', () => {
    const result = extractDocxText(docx(['Kort genoeg.']), 500);
    expect(result.truncated).toBe(false);
  });

  it('clamps a caller-supplied cap so it cannot be widened', () => {
    // Varying paragraphs, because 4,000 identical ones compress like a bomb
    // and are refused by the archive guard — correctly, and not what this test
    // is about.
    const long = Array.from(
      { length: 4_000 },
      (_unused, index) => `Alinea ${String(index)} beschrijft onderdeel ${String(index * 7)} van de opleiding.`,
    );
    // A mistaken or hostile ceiling must not raise the real one.
    const result = extractDocxText(docx(long), Number.MAX_SAFE_INTEGER);
    expect(result.ok).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(40_000);
  });
});

describe('the dispatcher', () => {
  it('names the types it can read', () => {
    expect(isReadableDocumentType('application/pdf')).toBe(true);
    expect(isReadableDocumentType(DOCX_MIME)).toBe(true);
    expect(isReadableDocumentType('text/plain')).toBe(true);
    expect(isReadableDocumentType('text/markdown')).toBe(true);
    // Images are uploadable but not readable, and saying so is the point.
    expect(isReadableDocumentType('image/png')).toBe(false);
    expect(isReadableDocumentType('image/svg+xml')).toBe(false);
  });

  it('reads plain text and markdown', async () => {
    const text = await extractDocumentText(
      Buffer.from('# Wft Basis\n\nEen basisopleiding voor praktijkwerkers.\n'),
      'text/markdown',
    );
    expect(text.ok).toBe(true);
    expect(text.text).toContain('Wft Basis');
  });

  it('re-checks a text file rather than trusting the upload-time verdict', async () => {
    // The file was validated at upload, but a restore or a manual change could
    // have replaced it since, so the check is repeated at read time.
    const result = await extractDocumentText(
      Buffer.from('<script>alert(1)</script>'),
      'text/plain',
    );
    expect(result.ok).toBe(false);
    expect(result.finding).toMatch(/active HTML|text re-check/u);
  });

  it('reads a Word document through the same entry point', async () => {
    const result = await extractDocumentText(docx(['Via de dispatcher gelezen.']), DOCX_MIME);
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Via de dispatcher gelezen');
  });

  it('says plainly that it has no reader for a type', async () => {
    const result = await extractDocumentText(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png');
    expect(result.ok).toBe(false);
    expect(result.reasonNl).toMatch(/PDF, Word-document of tekstbestand/u);
    expect(result.finding).toContain('image/png');
  });

  it('never returns text on a failure', async () => {
    for (const [bytes, mime] of [
      [Buffer.alloc(0), 'text/plain'],
      [Buffer.from('not a zip'), DOCX_MIME],
      [Buffer.from('nope'), 'image/gif'],
    ] as const) {
      const result = await extractDocumentText(bytes, mime);
      expect(result.ok, mime).toBe(false);
      // A partial or guessed extract is worse than an honest refusal.
      expect(result.text, mime).toBe('');
      expect(result.reasonNl, mime).toBeTruthy();
    }
  });
});
