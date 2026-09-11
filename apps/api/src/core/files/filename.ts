/**
 * Upload filename handling.
 *
 * The original name is **display metadata only**. It never reaches the
 * filesystem: stored files are named from their content hash, so a hostile name
 * has nothing to attack. This module therefore has two jobs, and they are
 * separate on purpose:
 *
 *  1. **Refuse** a name that shows intent - a traversal sequence, a NUL, a
 *     control character, a right-to-left override used to disguise an
 *     extension. These are rejected rather than cleaned, because a legitimate
 *     upload never contains them, and cleaning would hide the attempt from the
 *     audit trail.
 *  2. **Sanitise** what remains, for display and for the `Content-Disposition`
 *     header of a later download.
 *
 * Threat T-07.
 */

export interface FilenameVerdict {
  readonly safe: boolean;
  readonly reasonNl?: string;
  readonly finding?: string;
  /** Safe to store and display. Present only when `safe`. */
  readonly display?: string;
}

/** Names that mean something to a filesystem rather than to a person. */
const RESERVED = new Set([
  '.',
  '..',
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
]);

const MAX_LENGTH = 200;

/**
 * Whether a name contains a control character.
 *
 * A code-point test rather than a regular expression: the pattern would need a
 * lint suppression to contain the very characters it exists to find, and the
 * suppression is easy to get subtly wrong. This is also exact about the C1
 * range, which is invisible in most editors.
 *
 * A NUL is the classic case — it truncates a name inside a C library while
 * leaving a harmless-looking extension visible to whatever validated it.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const isC0 = code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    const isDeleteOrC1 = code >= 0x7f && code <= 0x9f;
    if (isC0 || isDeleteOrC1) {
      return true;
    }
  }
  return false;
}

/**
 * Bidirectional overrides and invisible marks.
 *
 * A right-to-left override makes "logo<RLO>gnp.exe" render as "logo exe.png",
 * which is how a person is persuaded to accept an executable.
 */
const BIDI_OVERRIDE = /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u200b\ufeff]/u;

export function inspectFilename(raw: string): FilenameVerdict {
  if (raw.length === 0) {
    return { safe: false, finding: 'empty filename', reasonNl: 'Het bestand heeft geen naam.' };
  }
  if (raw.length > MAX_LENGTH) {
    return {
      safe: false,
      finding: `filename length ${String(raw.length)}`,
      reasonNl: `De bestandsnaam is te lang (maximaal ${String(MAX_LENGTH)} tekens).`,
    };
  }

  if (hasControlCharacter(raw)) {
    return {
      safe: false,
      finding: 'control character in filename',
      reasonNl: 'De bestandsnaam bevat ongeldige tekens.',
    };
  }

  if (BIDI_OVERRIDE.test(raw)) {
    return {
      safe: false,
      finding: 'bidirectional override in filename',
      reasonNl: 'De bestandsnaam bevat ongeldige tekens.',
    };
  }

  // Traversal and absolute paths, in both separator conventions.
  if (raw.includes('/') || raw.includes('\\')) {
    return {
      safe: false,
      finding: 'path separator in filename',
      reasonNl: 'De bestandsnaam mag geen mapnamen bevatten.',
    };
  }
  if (raw.includes('..')) {
    return {
      safe: false,
      finding: 'parent-directory sequence in filename',
      reasonNl: 'De bestandsnaam bevat een ongeldige reeks.',
    };
  }
  if (/^[a-zA-Z]:/u.test(raw)) {
    return {
      safe: false,
      finding: 'drive letter in filename',
      reasonNl: 'De bestandsnaam mag geen schijfaanduiding bevatten.',
    };
  }

  const base = raw.replace(/\.[^.]*$/u, '').toLowerCase();
  if (RESERVED.has(base) || RESERVED.has(raw.toLowerCase())) {
    return {
      safe: false,
      finding: `reserved filename "${raw}"`,
      reasonNl: 'Deze bestandsnaam is niet toegestaan.',
    };
  }

  return { safe: true, display: sanitiseForDisplay(raw) };
}

/**
 * Reduces a validated name to a conservative character set.
 *
 * Applied after the checks above, so this is cosmetic rather than a control:
 * anything dangerous has already been refused. It exists so a name can be put
 * in a header and rendered in the UI without escaping concerns.
 */
export function sanitiseForDisplay(raw: string): string {
  const collapsed = raw
    .normalize('NFC')
    .replace(/["'`;]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return collapsed.length === 0 ? 'bestand' : collapsed;
}

/**
 * A `Content-Disposition` value that cannot break out of the header.
 *
 * Both forms are emitted: a plain ASCII `filename` for old clients and RFC 5987
 * `filename*` for everything else. The ASCII fallback is reduced to
 * `[A-Za-z0-9._-]`, so it cannot contain a quote, a semicolon or a newline.
 */
export function contentDisposition(mode: 'attachment' | 'inline', displayName: string): string {
  const ascii = displayName.replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 100) || 'bestand';
  const encoded = encodeURIComponent(displayName);
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
