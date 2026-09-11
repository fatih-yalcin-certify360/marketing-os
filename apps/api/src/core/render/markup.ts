/**
 * Escaping for the markup this system generates.
 *
 * Two renderers produce markup from text the product does not control: the SVG
 * image layer and the e-mail builder. Both put user and model text inside tags
 * and attributes, so both need the same five replacements — and the codebase
 * had grown four separate implementations of them, in four modules, differing
 * in which characters they covered.
 *
 * One is enough, and it has to be the strict one. `layouts.ts` escaped only
 * `&`, `<` and `>`, which is sufficient for SVG *text nodes* and not for an
 * attribute value; a version that covers both is correct in both places, and
 * there is no case where escaping too much breaks the output.
 *
 * This is not a sanitiser and must not be mistaken for one. It assumes the
 * surrounding markup is ours and only the interpolated values are foreign. The
 * e-mail builder relies on exactly that: no model output ever arrives as
 * markup, so there is nothing to clean — only text to escape.
 */

/** Escapes text for use in an XML/HTML text node or a quoted attribute. */
export function escapeMarkup(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    // `&#39;` rather than `&apos;`: both are valid in XML and in HTML5, but
    // `&apos;` is not defined in HTML 4, and an e-mail client's parser is the
    // least predictable renderer this product writes for.
    .replace(/'/gu, '&#39;');
}
