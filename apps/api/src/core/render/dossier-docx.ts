import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { Dossier, DossierBlock } from '../../modules/content-assets/dossier.js';

/**
 * The dossier as a Word file.
 *
 * ## Why Word and not only PDF
 *
 * The people this document is made for do things with it: they paste a
 * paragraph into the site, hand the persona to a colleague, mark up the copy
 * before it goes out. A PDF is a picture of a text; this is the text.
 *
 * ## Why a library
 *
 * A `.docx` is a zip of XML parts, and we already have a zip writer — so
 * writing the XML by hand was the tempting option. What that hides is that
 * Word is the judge of whether the result opens at all, and Word is not here
 * to ask. A library that thousands of people open files from every day has
 * already answered that question; hand-rolled OOXML would have us find out
 * from the user.
 *
 * ## Fonts
 *
 * Calibri, not the brand face. A Word file does not carry its fonts: it names
 * them and the reader's machine finds them or substitutes something. Naming a
 * font the reader almost certainly does not have means the document looks
 * different for everyone, and embedding a licensed brand face in a file that
 * gets forwarded is a licensing decision, not a styling one. The brand shows
 * in the colour and the structure instead.
 */

/** The product's own accent, dark enough to read on paper (4.9:1 on white). */
const ACCENT = '4C3A9E';
const INK = '183037';
const MUTED = '5A6B72';
const RULE = 'D9DEE1';

const BODY_FONT = 'Calibri';

export async function renderDossierDocx(dossier: Dossier): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  for (const block of dossier.blocks) {
    children.push(...blockToDocx(block));
  }

  const document = new Document({
    title: dossier.title,
    description: dossier.subtitle,
    styles: {
      default: {
        document: { run: { font: BODY_FONT, size: 21, color: INK } },
      },
    },
    sections: [
      {
        properties: {
          // 2 cm all round, in twentieths of a point.
          page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: `${dossier.subtitle} · `, size: 16, color: MUTED }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED }),
                  new TextRun({ text: ' / ', size: 16, color: MUTED }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}

function blockToDocx(block: DossierBlock): (Paragraph | Table)[] {
  switch (block.kind) {
    case 'title':
      return [
        new Paragraph({
          heading: HeadingLevel.TITLE,
          spacing: { after: 80 },
          children: [new TextRun({ text: block.text, bold: true, size: 44, color: INK })],
        }),
      ];

    case 'subtitle':
      return [
        new Paragraph({
          spacing: { after: 320 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 8 } },
          children: [new TextRun({ text: block.text, size: 20, color: MUTED })],
        }),
      ];

    case 'heading':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 160 },
          children: [new TextRun({ text: block.text, bold: true, size: 30, color: ACCENT })],
        }),
      ];

    case 'subheading':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 260, after: 100 },
          children: [new TextRun({ text: block.text, bold: true, size: 24, color: INK })],
        }),
      ];

    case 'paragraph':
      return [
        new Paragraph({
          spacing: { after: 140, line: 276 },
          children: [new TextRun({ text: block.text })],
        }),
      ];

    case 'quote':
      /*
       * Set apart with a rule, not italics.
       *
       * What lands in a quote block is somebody's literal words — the
       * instruction that was typed, a passage from the research material. It
       * has to be visibly not ours, and it also has to stay readable at
       * length, which italic running text does not.
       */
      return [
        new Paragraph({
          spacing: { before: 60, after: 160, line: 276 },
          indent: { left: 240 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 12 } },
          children: [new TextRun({ text: block.text })],
        }),
      ];

    case 'bullets':
      return block.items.map(
        (item) =>
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 60, line: 276 },
            children: [new TextRun({ text: item })],
          }),
      );

    case 'note':
      return [
        new Paragraph({
          spacing: { before: 60, after: 160, line: 260 },
          children: [new TextRun({ text: block.text, size: 18, color: MUTED })],
        }),
      ];

    case 'fields':
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
            bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
            left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
            right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
            insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: RULE },
          },
          rows: block.rows.map(
            (row) =>
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 34, type: WidthType.PERCENTAGE },
                    margins: { top: 80, bottom: 80, right: 160 },
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: row.term, bold: true, size: 19, color: MUTED })],
                      }),
                    ],
                  }),
                  new TableCell({
                    width: { size: 66, type: WidthType.PERCENTAGE },
                    margins: { top: 80, bottom: 80 },
                    children: [new Paragraph({ children: [new TextRun({ text: row.value, size: 21 })] })],
                  }),
                ],
              }),
          ),
        }),
        // A table butts straight against whatever follows it, so the space
        // after belongs to the table and cannot be left to the next block.
        new Paragraph({ spacing: { after: 160 }, children: [] }),
      ];

    case 'pageBreak':
      return [new Paragraph({ children: [new PageBreak()] })];
  }
}
