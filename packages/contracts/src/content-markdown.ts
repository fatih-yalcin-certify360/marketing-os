import type { ContentAssetVersion } from './content.js';

/**
 * One piece of content as Markdown, in reading order.
 *
 * Shared on purpose. The screen had a "copy as Markdown" button while the
 * export package shipped the same piece as plain text, so the only publishable
 * form of a website piece lived in the browser and never reached the ZIP
 * (audit 2026-09-15). One builder, both surfaces.
 */
export function contentMarkdown(asset: ContentAssetVersion): string {
  const { copy } = asset;
  const lines: string[] = [`# ${copy.hook}`, '', copy.body, ''];
  if (copy.website?.form === 'blog_article') {
    const article = copy.website;
    const link = copy.ctaUrl ?? '#';
    lines.push(`# ${article.title}`, '', `_${article.metaDescription}_`, '');
    if (article.directAnswerNl.length > 0) lines.push(`**${article.directAnswerNl}**`, '');
    lines.push(article.intro, '');
    for (const [index, section] of article.sections.entries()) {
      lines.push(`## ${section.heading}`, '', section.text, '');
      if (index === 1 && article.scenarioNl.length > 0) lines.push(`> ${article.scenarioNl}`, '');
      if (index === article.midCtaAfterSection && article.midCtaNl.length > 0) {
        lines.push(article.midCtaNl.replace(new RegExp(article.internalLinkText.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), `[${article.internalLinkText}](${link})`), '');
      }
    }
    if (article.externalFacts.length > 0) {
      lines.push('## Bronnen', '');
      for (const fact of article.externalFacts) lines.push(`- ${fact.statementNl} — ${fact.sourceRef}`);
      lines.push('');
    }
    if (article.coursePathNl.length > 0) lines.push('## Wat dit van je vraagt', '', article.coursePathNl, '');
    lines.push('## Veelgestelde vragen', '');
    for (const item of article.faq) lines.push(`**${item.question}**`, '', item.answer, '');
    if (article.closingCtaNl.length > 0) lines.push(article.closingCtaNl, '');
    lines.push(`[${article.internalLinkText}](${link})`, '');
  } else if (copy.website?.form === 'course_page_update') {
    lines.push(`Pagina: ${copy.website.pageUrl}`, '');
    for (const [index, change] of copy.website.changes.entries()) {
      lines.push(
        `## Wijziging ${String(index + 1)} — ${change.placement}`,
        '',
        `**Waarom:** ${change.reason}`,
        '',
        `**Huidige passage:** “${change.currentExcerpt}”`,
        '',
        '**Voorgestelde tekst:**',
        '',
        change.proposedText,
        '',
      );
    }
  } else {
    for (const section of copy.sections) lines.push(`## ${section.heading}`, '', section.text, '');
  }
  if (copy.ads !== null) {
    lines.push('## Advertentietekst', '');
    for (const headline of copy.ads.headlines) lines.push(`- Kop: ${headline}`);
    for (const description of copy.ads.descriptions) lines.push(`- Beschrijving: ${description}`);
    if (copy.ads.keywords.length > 0) lines.push(`- Zoektermen: ${copy.ads.keywords.join(', ')}`);
    lines.push('');
  }
  lines.push(`**${copy.ctaText}**${copy.ctaUrl === null ? '' : ` → ${copy.ctaUrl}`}`, '');
  if (copy.hashtags.length > 0) lines.push(copy.hashtags.map(hashtagText).join(' '), '');
  if (copy.imageAltText !== null) lines.push(`Alt-tekst: ${copy.imageAltText}`, '');
  return lines.join('\n');
}

/** A hashtag with exactly one leading `#`, however it was stored. */
export function hashtagText(tag: string): string {
  return tag.startsWith('#') ? tag : `#${tag}`;
}
