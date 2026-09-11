/**
 * Reduces fetched HTML to readable text.
 *
 * Two things this is *not*: a parser, and a sanitiser. It never produces HTML,
 * so nothing downstream can render its output; and the text it returns is
 * handed to a model as **task data**, never as instructions (threat T-05). The
 * prompt layer puts it in `input`; that boundary is what makes an instruction
 * hidden in a fetched page inert.
 *
 * Script, style and template contents are dropped rather than stripped of
 * tags, because their text is code — a `<script>` body full of JSON would
 * otherwise dominate the extract and crowd out the page's actual content.
 *
 * A regex-based reducer is the right tool here despite the usual warning about
 * regexes and HTML. The warning is about *trusting* the result, and nothing
 * here does: a mangled extract yields a worse proposal, which a person then
 * reviews. Adding a DOM parser would add a dependency, a new class of
 * vulnerability, and a lot of memory for a page we only want the prose from.
 */

/** Elements whose *content* is not prose. */
const NON_PROSE = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object'];

/** Elements that imply a line break when they close. */
const BLOCK_ELEMENTS =
  'address|article|aside|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul';

const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  eacute: 'é',
  egrave: 'è',
  euml: 'ë',
  iuml: 'ï',
  ouml: 'ö',
  uuml: 'ü',
  ccedil: 'ç',
});

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]{1,6});/giu, (_match, hex: string) =>
      safeFromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d{1,7});/gu, (_match, dec: string) =>
      safeFromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&([a-z]+);/giu, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function safeFromCodePoint(code: number): string {
  // Refuse control characters and anything outside Unicode: a decoded NUL or
  // an escape sequence has no business in extracted prose.
  if (!Number.isInteger(code) || code < 0x20 || code > 0x10ffff) {
    return ' ';
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return ' ';
  }
}

export interface ExtractedText {
  /** The page title, when it has one. */
  readonly title: string | null;
  /** The readable text, block structure preserved as blank lines. */
  readonly text: string;
  /** True when the text was cut at `maxChars`. */
  readonly truncated: boolean;
}

/**
 * @param maxChars Ceiling on the returned text. A page is only worth so many
 *   tokens, and an unbounded extract would set the cost of one course card by
 *   how verbose the source site happens to be.
 */
export function extractReadableText(html: string, maxChars = 20_000): ExtractedText {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
  const title =
    titleMatch?.[1] === undefined ? null : collapse(decodeEntities(stripTags(titleMatch[1]))) || null;

  let working = html;

  // Comments first: a comment can contain what looks like a closing tag.
  working = working.replace(/<!--[\s\S]*?-->/gu, ' ');

  for (const element of NON_PROSE) {
    working = working.replace(
      new RegExp(`<${element}\\b[^>]*>[\\s\\S]*?</${element}\\s*>`, 'giu'),
      ' ',
    );
    // An unclosed one would otherwise leave its attributes in the text.
    working = working.replace(new RegExp(`<${element}\\b[^>]*/?>`, 'giu'), ' ');
  }

  // Block boundaries become newlines before tags are removed, so paragraphs
  // do not run together into one line.
  working = working.replace(new RegExp(`</?(?:${BLOCK_ELEMENTS})\\b[^>]*>`, 'giu'), '\n');

  working = stripTags(working);
  working = decodeEntities(working);

  const lines = working
    .split('\n')
    .map((line) => collapse(line))
    .filter((line) => line.length > 0);

  const text = lines.join('\n');
  const truncated = text.length > maxChars;

  return { title, text: truncated ? `${text.slice(0, maxChars)}…` : text, truncated };
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/gu, ' ');
}

function collapse(value: string): string {
  // In Unicode mode `\s` already covers NBSP, the en/em space family, the
  // ideographic space and the BOM. Only the zero-width space is outside it, and
  // a page padded with those would otherwise come out as a wall of nothing.
  return value.replace(/[\s\u200b]+/gu, ' ').trim();
}
