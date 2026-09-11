import type { BrandProfileVersion, ContentAssetVersion } from '@c360/contracts';
import { escapeMarkup } from './markup.js';

/**
 * Builds the HTML for an e-mail from structured copy.
 *
 * ## Why this is safe by construction, not by sanitisation
 *
 * The model never produces markup. It returns a subject line, an opening
 * paragraph, titled sections and a call to action — all plain text — and this
 * function is the only thing that writes tags. So there is no untrusted HTML to
 * clean, and no sanitiser to get wrong: every interpolated value goes through
 * `escapeMarkup`, and anything that looks like a tag arrives as visible
 * characters rather than as structure.
 *
 * That ordering is the control. A design where the model returned HTML and we
 * sanitised it would be strictly worse — sanitisers are a moving target, and a
 * bypass would ship inside a file the product had signed its name to.
 *
 * ## What is deliberately absent
 *
 * - **No `<script>`, and no way to introduce one.** Requirement: no scripts in
 *   the HTML. The only tags emitted are the table, text and anchor tags listed
 *   below; there is no code path that writes any other.
 * - **No remote resources.** No images, no web fonts, no tracking pixel. An
 *   e-mail that loads anything from a server tells that server when it was
 *   opened, and this product does not measure people. It also means the mail
 *   renders identically with images blocked, which is how most clients open it.
 * - **No `<style>` block or class names.** Inline attributes only, because that
 *   is what e-mail clients actually honour — several strip a `<style>` element
 *   outright.
 * - **No sending.** This produces a file. Sending is out of scope and is not
 *   implemented anywhere.
 *
 * ## Why a table
 *
 * Not nostalgia: Outlook renders through Word's engine and does not implement
 * flexbox or grid. A single centred table with fixed padding is the layout that
 * survives the widest range of clients, which is the only reason to write HTML
 * this way in 2026.
 */
export function buildEmailHtml(input: {
  asset: Pick<ContentAssetVersion, 'copy'>;
  brand: Pick<BrandProfileVersion, 'brandName' | 'colors' | 'typography' | 'logoText'>;
  /** Shown in the footer so a draft cannot be mistaken for an approved mail. */
  draftNoticeNl: string | null;
}): string {
  const { copy } = input.asset;
  const { colors, typography } = input.brand;

  /*
   * The font stack ends in a generic family the client certainly has.
   *
   * A brand font in an e-mail is a request, not an instruction: the recipient's
   * client uses what it has. Naming the fallback keeps the mail readable rather
   * than letting a client pick something arbitrary.
   */
  const bodyFont = cssFontStack(typography.bodyFamily);
  const headingFont = cssFontStack(typography.headingFamily);

  const wordmark = copy.hook.length > 0 ? input.brand.logoText ?? input.brand.brandName : input.brand.brandName;

  const parts: string[] = [
    '<!doctype html>',
    '<html lang="nl">',
    '<head>',
    '<meta charset="utf-8">',
    // Without this, mobile clients zoom out to a desktop width.
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeMarkup(copy.hook)}</title>`,
    '</head>',
    `<body style="margin:0;padding:0;background:${cssColor(colors.surface)};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${cssColor(colors.surface)};">`,
    '<tr><td align="center" style="padding:24px 12px;">',
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;">`,

    // Header band, in the brand's primary colour with its own text colour.
    `<tr><td style="background:${cssColor(colors.primary)};color:${cssColor(colors.onPrimary)};padding:20px 28px;font-family:${headingFont};font-size:15px;font-weight:bold;">`,
    escapeMarkup(wordmark),
    '</td></tr>',

    // Subject line, repeated as the visible headline.
    `<tr><td style="padding:28px 28px 8px 28px;font-family:${headingFont};font-size:24px;line-height:1.25;color:${cssColor(colors.onSurface)};">`,
    escapeMarkup(copy.hook),
    '</td></tr>',

    // The opening paragraph.
    `<tr><td style="padding:0 28px 8px 28px;font-family:${bodyFont};font-size:15px;line-height:1.6;color:${cssColor(colors.onSurface)};">`,
    paragraphs(copy.body, bodyFont),
    '</td></tr>',
  ];

  for (const section of copy.sections) {
    parts.push(
      `<tr><td style="padding:12px 28px 0 28px;font-family:${headingFont};font-size:17px;line-height:1.3;color:${cssColor(colors.onSurface)};font-weight:bold;">`,
      escapeMarkup(section.heading),
      '</td></tr>',
      `<tr><td style="padding:4px 28px 8px 28px;font-family:${bodyFont};font-size:15px;line-height:1.6;color:${cssColor(colors.onSurface)};">`,
      paragraphs(section.text, bodyFont),
      '</td></tr>',
    );
  }

  /*
   * The call to action.
   *
   * A link only when there is a URL. `ctaUrl` is `webUrl` in the contract —
   * http and https only — so a `javascript:` or `data:` address cannot reach
   * this attribute. Escaped as well, because a contract is a boundary and this
   * is the place the value actually becomes markup: two independent reasons the
   * output is safe, and neither relies on the other.
   */
  parts.push(
    `<tr><td style="padding:16px 28px 28px 28px;font-family:${bodyFont};font-size:15px;">`,
  );
  if (copy.ctaUrl === null) {
    parts.push(
      `<span style="color:${cssColor(colors.onSurface)};font-weight:bold;">${escapeMarkup(copy.ctaText)}</span>`,
      `<div style="margin-top:6px;font-size:13px;color:${cssColor(colors.onSurface)};">Nog geen bestemmingslink ingevuld.</div>`,
    );
  } else {
    parts.push(
      `<a href="${escapeMarkup(copy.ctaUrl)}" style="display:inline-block;background:${cssColor(colors.accent)};color:${cssColor(colors.onPrimary)};text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;">`,
      escapeMarkup(copy.ctaText),
      '</a>',
    );
  }
  parts.push('</td></tr>');

  if (input.draftNoticeNl !== null) {
    parts.push(
      `<tr><td style="background:${cssColor(colors.surface)};padding:14px 28px;font-family:${bodyFont};font-size:12px;line-height:1.5;color:${cssColor(colors.onSurface)};">`,
      escapeMarkup(input.draftNoticeNl),
      '</td></tr>',
    );
  }

  parts.push(
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  );

  return parts.join('\n');
}

/**
 * A font-family value that cannot carry anything but a font name.
 *
 * Escaping is not enough here, and this is the trap worth naming: escaping
 * `"` and `<` stops a value breaking *out of the attribute*, but the value is
 * already inside a CSS declaration, so it does not need to. A brand font
 * family is a free string in the contract, and
 * `Inter; background:url(https://evil.test/px.png)` is a perfectly ordinary
 * string that would add a remote background to the e-mail — turning the mail
 * into the tracking beacon this module documents it must never be, with no tag
 * and no quote involved.
 *
 * So the name is matched against what a font name can contain rather than
 * cleaned of what it must not: letters, digits, spaces and hyphens. Anything
 * else and the brand font is dropped and the fallback stack stands alone,
 * because a mail in the wrong typeface is a cosmetic problem and a mail that
 * phones home is not.
 */
function cssFontStack(family: string): string {
  const FALLBACK = 'Helvetica, Arial, sans-serif';
  if (!/^[A-Za-z0-9 -]{1,80}$/u.test(family)) {
    return FALLBACK;
  }
  // Quoted, so a name containing spaces is one family and not several.
  return `'${family}', ${FALLBACK}`;
}

/**
 * A colour that cannot carry a CSS declaration.
 *
 * `hexColor` in the contract already guarantees this shape. Checked again
 * because this is the line where the value becomes CSS, and a control that
 * depends on a caller having validated correctly is one refactor away from
 * being no control at all. The fallback is a visible, deliberate black rather
 * than something that silently looks plausible.
 */
function cssColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/u.test(value) ? value : '#000000';
}

/**
 * Splits text into paragraphs on blank lines.
 *
 * Line breaks a writer typed are meaning, and an e-mail client collapses raw
 * newlines — so they become `<p>` elements. Nothing else about the text is
 * interpreted: this is not Markdown, and a `*` stays a `*`.
 */
function paragraphs(text: string, font: string): string {
  const blocks = text
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  const source = blocks.length > 0 ? blocks : [text.trim()];

  return source
    .map(
      (block) =>
        `<p style="margin:0 0 12px 0;font-family:${font};">${escapeMarkup(block).replace(/\n/gu, '<br>')}</p>`,
    )
    .join('');
}
