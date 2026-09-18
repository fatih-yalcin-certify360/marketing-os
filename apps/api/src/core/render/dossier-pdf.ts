import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Dossier, DossierBlock } from '../../modules/content-assets/dossier.js';

/**
 * The dossier as a PDF.
 *
 * ## Why this exists next to the Word file
 *
 * The same document, for the other half of what people do with it: forwarding
 * it, attaching it, printing it. A PDF looks the same for everybody, which is
 * exactly what you want when you are not the one opening it.
 *
 * ## Why it is laid out here and not by a browser
 *
 * The obvious way to make a PDF is to render HTML in Chromium. Chromium is not
 * in the production image and will not be: it is hundreds of megabytes for one
 * feature, and the market-radar browser already carries a "install Chromium
 * first" message for the one place we accept that cost. So the layout is done
 * here — wrapping, page breaks, a footer — against real measured text widths.
 * It is a few hundred lines and it runs anywhere the API runs.
 *
 * ## The one thing this format cannot do
 *
 * The standard PDF fonts are encoded in WinAnsi, which is Western European and
 * nothing else. Dutch is entirely inside it; an arrow, a checkmark or an emoji
 * in a social post is not. Rather than embedding a Unicode font — a megabyte
 * in the bundle and a licence question — the few characters that fall outside
 * are folded to their plain equivalent or dropped, and the document says on
 * its own first page how many and where to get the unchanged text. A silent
 * substitution in a document people quote from is the thing to avoid here.
 */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const BOTTOM = 64;

const ACCENT = rgb(0x4c / 255, 0x3a / 255, 0x9e / 255);
const INK = rgb(0x18 / 255, 0x30 / 255, 0x37 / 255);
const MUTED = rgb(0x5a / 255, 0x6b / 255, 0x72 / 255);
const RULE = rgb(0xd9 / 255, 0xde / 255, 0xe1 / 255);

/** What WinAnsi has beyond ASCII and Latin-1, as code points. */
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

/** Characters we actually produce that have an honest plain equivalent. */
const FOLD = new Map<string, string>([
  ['→', '->'],
  ['←', '<-'],
  ['⇒', '=>'],
  ['≥', '>='],
  ['≤', '<='],
  ['✓', 'v'],
  [' ', ' '],
  ['‑', '-'],
]);

function encodable(codePoint: number): boolean {
  return (
    (codePoint >= 0x20 && codePoint <= 0x7e) ||
    (codePoint >= 0xa0 && codePoint <= 0xff) ||
    WIN_ANSI_EXTRA.has(codePoint)
  );
}

/** Folds one string to what the standard fonts can draw, and counts the losses. */
function fold(text: string): { text: string; replaced: number } {
  let out = '';
  let replaced = 0;
  for (const character of text) {
    const mapped = FOLD.get(character);
    if (mapped !== undefined) {
      out += mapped;
      // A mapped character is not a loss: "->" says what the arrow said.
      continue;
    }
    const codePoint = character.codePointAt(0) ?? 0;
    if (encodable(codePoint)) {
      out += character;
      continue;
    }
    replaced += 1;
  }
  return { text: out, replaced };
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** Where the cursor is, and on which page. */
interface Cursor {
  page: PDFPage;
  y: number;
}

export async function renderDossierPdf(dossier: Dossier): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  /*
   * Fold first, lay out second.
   *
   * The notice about folded characters has to sit on the first page, and the
   * count is only known once the whole document has been read — so the text is
   * prepared in one pass before a single line is drawn.
   */
  let losses = 0;
  const blocks: DossierBlock[] = [];
  for (const block of dossier.blocks) {
    const [prepared, lost] = foldBlock(block);
    losses += lost;
    blocks.push(prepared);
  }
  if (losses > 0) {
    // After the title and the subtitle, which are the first two blocks.
    blocks.splice(2, 0, {
      kind: 'note',
      text: `Let op: ${String(losses)} teken(s) uit de tekst kan het lettertype van deze PDF niet weergeven — meestal emoji — en zijn weggelaten. De Word-versie van dit dossier bevat de tekst ongewijzigd.`,
    });
  }

  pdf.setTitle(fold(dossier.title).text);
  pdf.setSubject(fold(dossier.subtitle).text);

  const cursor: Cursor = { page: pdf.addPage([A4.width, A4.height]), y: A4.height - MARGIN };
  for (const block of blocks) {
    drawBlock(pdf, cursor, fonts, block);
  }

  drawFooters(pdf, fonts, fold(dossier.subtitle).text);
  return pdf.save();
}

function foldBlock(block: DossierBlock): [DossierBlock, number] {
  switch (block.kind) {
    case 'pageBreak':
      return [block, 0];
    case 'bullets': {
      let lost = 0;
      const items = block.items.map((item) => {
        const folded = fold(item);
        lost += folded.replaced;
        return folded.text;
      });
      return [{ kind: 'bullets', items }, lost];
    }
    case 'fields': {
      let lost = 0;
      const rows = block.rows.map((row) => {
        const term = fold(row.term);
        const value = fold(row.value);
        lost += term.replaced + value.replaced;
        return { term: term.text, value: value.text };
      });
      return [{ kind: 'fields', rows }, lost];
    }
    // Listed rather than defaulted, so a new kind of block has to say here
    // whether its text needs folding instead of silently skipping it.
    case 'title':
    case 'subtitle':
    case 'heading':
    case 'subheading':
    case 'paragraph':
    case 'quote':
    case 'note': {
      const folded = fold(block.text);
      return [{ kind: block.kind, text: folded.text }, folded.replaced];
    }
  }
}

/** Moves to a new page when the next `height` would cross the bottom margin. */
function ensure(pdf: PDFDocument, cursor: Cursor, height: number): void {
  if (cursor.y - height >= BOTTOM) return;
  cursor.page = pdf.addPage([A4.width, A4.height]);
  cursor.y = A4.height - MARGIN;
}

/** Greedy wrap against measured widths; a word longer than the line is cut. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u).filter((part) => part.length > 0)) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line.length > 0) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    // A URL or an id with no space in it. Cut it rather than let it run off
    // the page, where it would be neither readable nor recoverable.
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

interface TextStyle {
  size: number;
  font: PDFFont;
  color: ReturnType<typeof rgb>;
  before: number;
  after: number;
  indent: number;
  /** Line height as a multiple of the size. */
  leading: number;
}

function drawText(pdf: PDFDocument, cursor: Cursor, text: string, style: TextStyle, rail?: boolean): void {
  const width = A4.width - MARGIN * 2 - style.indent;
  const lines = wrap(text, style.font, style.size, width);
  const lineHeight = style.size * style.leading;
  cursor.y -= style.before;

  for (const line of lines) {
    ensure(pdf, cursor, lineHeight);
    cursor.y -= lineHeight;
    if (rail === true) {
      // One small bar per line: together they read as one continuous rule, and
      // it survives a page break without any bookkeeping.
      cursor.page.drawRectangle({
        x: MARGIN + style.indent - 10,
        y: cursor.y - style.size * 0.25,
        width: 2,
        height: lineHeight,
        color: ACCENT,
      });
    }
    cursor.page.drawText(line, {
      x: MARGIN + style.indent,
      y: cursor.y,
      size: style.size,
      font: style.font,
      color: style.color,
    });
  }
  cursor.y -= style.after;
}

function drawBlock(pdf: PDFDocument, cursor: Cursor, fonts: Fonts, block: DossierBlock): void {
  switch (block.kind) {
    case 'title':
      drawText(pdf, cursor, block.text, {
        size: 22, font: fonts.bold, color: INK, before: 0, after: 4, indent: 0, leading: 1.25,
      });
      return;

    case 'subtitle': {
      drawText(pdf, cursor, block.text, {
        size: 10, font: fonts.regular, color: MUTED, before: 0, after: 10, indent: 0, leading: 1.3,
      });
      ensure(pdf, cursor, 12);
      cursor.page.drawLine({
        start: { x: MARGIN, y: cursor.y },
        end: { x: A4.width - MARGIN, y: cursor.y },
        thickness: 0.75,
        color: RULE,
      });
      cursor.y -= 16;
      return;
    }

    case 'heading':
      drawText(pdf, cursor, block.text, {
        size: 15, font: fonts.bold, color: ACCENT, before: 12, after: 8, indent: 0, leading: 1.3,
      });
      return;

    case 'subheading':
      drawText(pdf, cursor, block.text, {
        size: 12, font: fonts.bold, color: INK, before: 12, after: 5, indent: 0, leading: 1.3,
      });
      return;

    case 'paragraph':
      drawText(pdf, cursor, block.text, {
        size: 10.5, font: fonts.regular, color: INK, before: 0, after: 7, indent: 0, leading: 1.42,
      });
      return;

    case 'quote':
      drawText(
        pdf, cursor, block.text,
        { size: 10.5, font: fonts.regular, color: INK, before: 3, after: 9, indent: 16, leading: 1.42 },
        true,
      );
      return;

    case 'note':
      drawText(pdf, cursor, block.text, {
        size: 9, font: fonts.regular, color: MUTED, before: 3, after: 8, indent: 0, leading: 1.4,
      });
      return;

    case 'bullets':
      for (const item of block.items) {
        const lineHeight = 10.5 * 1.42;
        ensure(pdf, cursor, lineHeight);
        // The marker is drawn against the first line's baseline, which is only
        // known after the wrap has placed it — so the text goes first.
        const markerPage = cursor.page;
        const top = cursor.y;
        drawText(pdf, cursor, item, {
          size: 10.5, font: fonts.regular, color: INK, before: 0, after: 3, indent: 14, leading: 1.42,
        });
        markerPage.drawText('•', {
          x: MARGIN, y: top - lineHeight, size: 10.5, font: fonts.regular, color: ACCENT,
        });
      }
      cursor.y -= 5;
      return;

    case 'fields': {
      const termWidth = 150;
      const valueWidth = A4.width - MARGIN * 2 - termWidth - 12;
      for (const row of block.rows) {
        const termLines = wrap(row.term, fonts.bold, 9.5, termWidth);
        const valueLines = wrap(row.value, fonts.regular, 10.5, valueWidth);
        const height = Math.max(termLines.length * 13.5, valueLines.length * 14.5) + 9;
        ensure(pdf, cursor, height + 6);

        const top = cursor.y;
        for (const [index, line] of termLines.entries()) {
          cursor.page.drawText(line, {
            x: MARGIN, y: top - 11 - index * 13.5, size: 9.5, font: fonts.bold, color: MUTED,
          });
        }
        for (const [index, line] of valueLines.entries()) {
          cursor.page.drawText(line, {
            x: MARGIN + termWidth + 12, y: top - 11 - index * 14.5, size: 10.5, font: fonts.regular, color: INK,
          });
        }
        cursor.y = top - height;
        cursor.page.drawLine({
          start: { x: MARGIN, y: cursor.y + 3 },
          end: { x: A4.width - MARGIN, y: cursor.y + 3 },
          thickness: 0.5,
          color: RULE,
        });
      }
      cursor.y -= 10;
      return;
    }

    case 'pageBreak':
      cursor.page = pdf.addPage([A4.width, A4.height]);
      cursor.y = A4.height - MARGIN;
      return;
  }
}

/** Drawn last, because "page 3 of 9" needs the nine. */
function drawFooters(pdf: PDFDocument, fonts: Fonts, subtitle: string): void {
  const pages = pdf.getPages();
  for (const [index, page] of pages.entries()) {
    const text = `${subtitle} · ${String(index + 1)} / ${String(pages.length)}`;
    const width = fonts.regular.widthOfTextAtSize(text, 8);
    page.drawText(text, {
      x: A4.width - MARGIN - width,
      y: 34,
      size: 8,
      font: fonts.regular,
      color: MUTED,
    });
  }
}
