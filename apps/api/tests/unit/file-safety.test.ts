import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { inspectFilename, contentDisposition } from '../../src/core/files/filename.js';
import { inspectSvg, inspectText } from '../../src/core/files/svg-guard.js';
import { inspectZip } from '../../src/core/files/zip-guard.js';
import { validateUpload } from '../../src/core/files/validate.js';

/**
 * The untrusted-file surface (backlog P1-2, threat T-07).
 *
 * One test per acceptance criterion, because "we validate uploads" is exactly
 * the kind of claim that is true of the happy path and false of the one that
 * matters. The guiding rule throughout: **the bytes decide the type**, never
 * the declared MIME type and never the extension.
 */

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A minimal but structurally real PNG. */
function png(padding = 64): Buffer {
  return Buffer.concat([PNG_HEADER, Buffer.alloc(padding, 0x20)]);
}

function jpeg(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x11)]);
}

function pdf(): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.7' + String.fromCharCode(10)), Buffer.alloc(64, 0x20)]);
}

const MAX = 25 * 1_048_576;

function validate(bytes: Buffer, filename: string, extra: Record<string, unknown> = {}) {
  return validateUpload({ bytes, filename, maxBytes: MAX, ...extra });
}

// ------------------------------------------------------------- type checks ---

describe('upload validation - type is decided by content', () => {
  it('accepts a PNG announced correctly', () => {
    const verdict = validate(png(), 'logo.png', { declaredMime: 'image/png' });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.type.mime).toBe('image/png');
    }
  });

  it('refuses a script that claims to be a PNG', () => {
    // The whole point of sniffing: a client-declared type is not evidence.
    const shell = Buffer.from('#!/bin/sh' + String.fromCharCode(10) + 'rm -rf /');
    const verdict = validate(shell, 'logo.png', { declaredMime: 'image/png' });

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('type_not_allowed');
      expect(verdict.reasonNl).toMatch(/[Ss]cript/u);
    }
  });

  it('accepts a real PNG that is announced as HTML', () => {
    // The mirror case. The declared type is wrong, but the content is fine, so
    // refusing it would only frustrate a user with a misconfigured client.
    const verdict = validate(png(), 'logo.png', { declaredMime: 'text/html' });
    expect(verdict.ok).toBe(true);
  });

  it('warns, but does not refuse, when the extension disagrees with the content', () => {
    const verdict = validate(png(), 'logo.jpg');
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.type.mime).toBe('image/png');
      expect(verdict.extensionWarningNl).toMatch(/PNG/u);
    }
  });

  it('treats .jpeg and .jpg as the same thing', () => {
    const verdict = validate(jpeg(), 'photo.jpeg');
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.extensionWarningNl).toBeUndefined();
    }
  });

  it('refuses an unrecognised binary rather than storing it', () => {
    const verdict = validate(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]), 'thing.bin');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('type_not_allowed');
    }
  });

  it('refuses archives and executables with a specific reason', () => {
    const cases: [Buffer, RegExp][] = [
      [Buffer.from([0x1f, 0x8b, 0x08, 0x00]), /gz/u],
      [Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), /7z/u],
      [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]), /rar/u],
      [Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02]), /[Pp]rogramma/u],
      [Buffer.from([0x4d, 0x5a, 0x90, 0x00]), /[Pp]rogramma/u],
    ];
    for (const [bytes, expected] of cases) {
      const verdict = validate(bytes, 'file.dat');
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reasonNl).toMatch(expected);
      }
    }
  });

  it('refuses HTML outright', () => {
    // Never needed as input, and any way of storing it leaves a file some
    // future code path might serve.
    const verdict = validate(Buffer.from('<!DOCTYPE html><html><body>x</body></html>'), 'page.txt');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reasonNl).toMatch(/HTML/u);
    }
  });

  it('refuses an empty file', () => {
    const verdict = validate(Buffer.alloc(0), 'empty.png');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('empty');
    }
  });

  it('enforces the per-type ceiling as well as the global one', () => {
    // An SVG may be 2 MB even though the global ceiling is 25 MB.
    const bigSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">' + 'x'.repeat(3_000_000) + '</svg>');
    const verdict = validate(bigSvg, 'logo.svg');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('too_large');
    }
  });

  it('honours an expected shape, so a logo slot cannot take a PDF', () => {
    const verdict = validate(pdf(), 'brochure.pdf', { expect: 'image' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('content_mismatch');
      expect(verdict.reasonNl).toMatch(/afbeelding/u);
    }
  });
});

// ------------------------------------------------------------------- names ---

describe('upload validation - filenames', () => {
  it('refuses a traversal sequence', () => {
    // A backslash built from its code point, so the separator in the test is
    // unambiguous rather than a nest of escapes.
    const sep = String.fromCharCode(92);
    const names = [
      '../../etc/passwd',
      '..' + sep + '..' + sep + 'win.ini',
      '/etc/passwd',
      'C:' + sep + 'x.png',
    ];
    for (const name of names) {
      const verdict = inspectFilename(name);
      expect(verdict.safe, name).toBe(false);
    }
  });

  it('refuses a NUL-truncated name', () => {
    // "logo.pngNUL.sh" passes an extension check and then truncates.
    const verdict = inspectFilename('logo.png' + String.fromCharCode(0) + '.sh');
    expect(verdict.safe).toBe(false);
    expect(verdict.finding).toMatch(/control character/u);
  });

  it('refuses a right-to-left override used to disguise an extension', () => {
    // Renders as "logo exe.png" while actually ending in .exe.
    const verdict = inspectFilename('logo' + String.fromCharCode(0x202e) + 'gnp.exe');
    expect(verdict.safe).toBe(false);
    expect(verdict.finding).toMatch(/bidirectional/u);
  });

  it('refuses a reserved device name', () => {
    expect(inspectFilename('NUL').safe).toBe(false);
    expect(inspectFilename('con.txt').safe).toBe(false);
  });

  it('refuses an absurdly long name', () => {
    expect(inspectFilename('a'.repeat(300) + '.png').safe).toBe(false);
  });

  it('accepts an ordinary name and keeps it readable', () => {
    const verdict = inspectFilename('Lindenhaeghe logo (definitief).png');
    expect(verdict.safe).toBe(true);
    expect(verdict.display).toBe('Lindenhaeghe logo (definitief).png');
  });

  it('builds a Content-Disposition that cannot break out of the header', () => {
    const header = contentDisposition('attachment', 'rapport "2026"; drop.pdf');
    expect(header.startsWith('attachment; filename="')).toBe(true);
    // One quoted section only: no injected parameter, no stray quote.
    expect(header.split('"').length - 1).toBe(2);
    expect(header).toMatch(/filename\*=UTF-8''/u);
  });
});

// --------------------------------------------------------------------- SVG ---

describe('SVG is validated by rejection, never sanitised', () => {
  const wrap = (inner: string) => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>');

  it('accepts a plain vector logo', () => {
    expect(inspectSvg(wrap('<path d="M0 0 L10 10" fill="#123456"/>')).safe).toBe(true);
  });

  it('refuses a script element', () => {
    const verdict = inspectSvg(wrap('<script>fetch("/api/v1/me")</script>'));
    expect(verdict.safe).toBe(false);
    expect(verdict.finding).toMatch(/script/u);
  });

  it('refuses an event handler', () => {
    expect(inspectSvg(wrap('<circle r="5" onload="alert(1)"/>')).safe).toBe(false);
    expect(inspectSvg(wrap('<circle r="5" onmouseover="x()"/>')).safe).toBe(false);
  });

  it('refuses embedded HTML', () => {
    expect(inspectSvg(wrap('<foreignObject><body>x</body></foreignObject>')).safe).toBe(false);
  });

  it('refuses XML entities, which are the billion-laughs family', () => {
    const bomb = Buffer.from(
      '<!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>',
    );
    expect(inspectSvg(bomb).safe).toBe(false);
  });

  it('refuses an external reference that would fetch on render', () => {
    expect(inspectSvg(wrap('<image href="https://example.invalid/x.png"/>')).safe).toBe(false);
    expect(inspectSvg(wrap('<a xlink:href="javascript:alert(1)">x</a>')).safe).toBe(false);
  });

  it('strips comments in a way that cannot assemble a new keyword', () => {
    // A comment is replaced by a *space*, not by nothing. Substituting nothing
    // would turn `<scr<!--x-->ipt>` into `<script>` inside our own scanner -
    // a keyword created by the preprocessing rather than present in the file.
    // A browser does not parse the original as a script either, so the correct
    // outcome is that our handling invents no threat.
    const verdict = inspectSvg(wrap('<scr<!--x-->ipt>alert(1)</scr' + 'ipt>'));
    expect(verdict.safe).toBe(true);
  });

  it('still catches a script a comment was meant to hide behind', () => {
    // The direction that matters: a comment must not shield what follows it.
    expect(inspectSvg(wrap('<!-- harmless --><script>alert(1)</script>')).safe).toBe(false);
    expect(inspectSvg(wrap('<!-- a --><circle r="5" onload="x()"/>')).safe).toBe(false);
    // And a payload genuinely inside a comment is inert, so it is accepted.
    expect(inspectSvg(wrap('<!-- <script>alert(1)</script> --><path d="M0 0"/>')).safe).toBe(true);
  });

  it('refuses a NUL byte, which could hide a payload from a UTF-8 scan', () => {
    const utf16ish = Buffer.concat([Buffer.from('<svg'), Buffer.from([0x00]), Buffer.from(' >')]);
    expect(inspectSvg(utf16ish).safe).toBe(false);
  });

  it('refuses a file that is not an SVG at all', () => {
    expect(inspectSvg(Buffer.from('just text')).safe).toBe(false);
  });

  it('never serves an accepted SVG inline', () => {
    const verdict = validate(wrap('<path d="M0 0 L1 1"/>'), 'logo.svg');
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      // The decisive property: even a clean SVG is an attachment.
      expect(verdict.type.servingMode).toBe('attachment_only');
    }
  });
});

describe('text uploads', () => {
  it('accepts plain text', () => {
    expect(inspectText(Buffer.from('Merkregels: geen superlatieven.')).safe).toBe(true);
  });

  it('refuses HTML hidden in a text file', () => {
    expect(inspectText(Buffer.from('# Titel' + String.fromCharCode(10) + '<script>x</script>')).safe).toBe(false);
  });

  it('refuses binary content in a text file', () => {
    expect(inspectText(Buffer.from([0x41, 0x00, 0x42])).safe).toBe(false);
  });
});

// ------------------------------------------------------------------- zip ---

/** Builds a zip whose central directory declares the given entries. */
function buildZip(
  entries: { name: string; compressed: number; uncompressed: number }[],
  overrides: { entryCount?: number } = {},
): Buffer {
  const central: Buffer[] = [];
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt32LE(entry.compressed, 20);
    header.writeUInt32LE(entry.uncompressed, 24);
    header.writeUInt16LE(name.length, 28);
    central.push(header, name);
  }
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(overrides.entryCount ?? entries.length, 8);
  eocd.writeUInt16LE(overrides.entryCount ?? entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(4, 16);
  // Local header bytes are never read, so a short filler stands in for them.
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), directory, eocd]);
}

const DOCX_MEMBERS = [
  { name: '[Content_Types].xml', compressed: 300, uncompressed: 1_200 },
  { name: 'word/document.xml', compressed: 900, uncompressed: 4_000 },
];

describe('archives are inspected, never extracted', () => {
  it('accepts a well-formed docx', () => {
    const verdict = inspectZip(buildZip(DOCX_MEMBERS), { requireDocx: true });
    expect(verdict.safe).toBe(true);
    expect(verdict.declared?.entries).toBe(2);
  });

  it('refuses a zip bomb on its declared uncompressed size', () => {
    // Nothing is inflated: the directory already says it expands to 4 GB.
    const verdict = inspectZip(
      buildZip([{ name: 'word/document.xml', compressed: 1_000, uncompressed: 4_000_000_000 }]),
      { requireDocx: true },
    );
    expect(verdict.safe).toBe(false);
    expect(verdict.finding).toMatch(/uncompressed total/u);
  });

  it('refuses an implausible compression ratio', () => {
    const verdict = inspectZip(
      buildZip([
        { name: '[Content_Types].xml', compressed: 100, uncompressed: 200 },
        { name: 'word/document.xml', compressed: 100, uncompressed: 5_000_000 },
      ]),
      { requireDocx: true },
    );
    expect(verdict.safe).toBe(false);
    expect(verdict.finding).toMatch(/ratio/u);
  });

  it('refuses an entry name that escapes its directory', () => {
    const verdict = inspectZip(
      buildZip([{ name: '../../etc/passwd', compressed: 10, uncompressed: 20 }]),
      { requireDocx: true },
    );
    expect(verdict.safe).toBe(false);
    expect(verdict.finding).toMatch(/escapes its directory/u);
  });

  it('refuses too many entries', () => {
    const many = Array.from({ length: 600 }, (_unused, index) => ({
      name: 'word/media/' + String(index) + '.png',
      compressed: 10,
      uncompressed: 20,
    }));
    const verdict = inspectZip(buildZip(many), { requireDocx: true });
    expect(verdict.safe).toBe(false);
    expect(verdict.finding).toMatch(/entry count/u);
  });

  it('refuses a plain zip renamed .docx', () => {
    // Same magic bytes as a docx; only the members tell them apart.
    const verdict = inspectZip(
      buildZip([{ name: 'holiday-photos/1.jpg', compressed: 1_000, uncompressed: 1_100 }]),
      { requireDocx: true },
    );
    expect(verdict.safe).toBe(false);
    expect(verdict.reasonNl).toMatch(/Word-document/u);
  });

  it('refuses a truncated archive instead of reading past the end', () => {
    const good = buildZip(DOCX_MEMBERS);
    expect(inspectZip(good.subarray(0, good.length - 30), { requireDocx: true }).safe).toBe(false);
  });

  it('routes a zip through validateUpload as a rejected archive', () => {
    const verdict = validate(
      buildZip([{ name: 'a.txt', compressed: 10, uncompressed: 20 }]),
      'notes.docx',
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('archive_rejected');
    }
  });

  it('does not choke on a real deflate stream in the payload area', () => {
    // Guards against a regression where the guard tried to inflate something.
    const compressed = deflateRawSync(Buffer.from('x'.repeat(1_000)));
    const zip = Buffer.concat([buildZip(DOCX_MEMBERS), compressed]);
    // The EOCD is no longer last, so this is expected to be refused - but it
    // must be refused cleanly, not by throwing.
    expect(() => inspectZip(zip, { requireDocx: true })).not.toThrow();
  });
});
