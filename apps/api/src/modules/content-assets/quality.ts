import {
  CHANNEL_CONFIG,
  CHANNEL_LABEL_NL,
  GOOGLE_RSA,
  GOOGLE_RSA_HOUSE,
  findChannelSpec,
  lengthGuidanceFor,
  type AdProposal,
  type ChannelWarning,
  type ContentCopy,
  type MarketingChannel,
} from '@c360/contracts';
import { MARKETESE, articleText, checkArticleFacts, checkArticleStructure } from './article-quality.js';

/**
 * House-style quality checks on a piece of content.
 *
 * The schema says what a piece may *contain*; these checks say when it is
 * worth a reader's time. They exist because a real run produced a landing page
 * of two sentences, an e-mail that recited the course card and a set of posts
 * that all opened the same way — every one of them schema-valid.
 *
 * Two families, because they are recomputable to different degrees:
 *
 *  - **Shape** checks need only the copy and its channel: minimum length,
 *    section count, hashtag range and format, alt text when an image is
 *    planned, the website form on a page. They are recomputed on every read,
 *    like the channel checks, so the interface can never disagree with the
 *    export gate.
 *  - **Context** checks need what the piece was written *from*: the briefing's
 *    search phrases, the course card, the live course page, the other pieces
 *    of the campaign. They run once at generation and are stored with the
 *    piece.
 *
 * Every warning here blocks a publish-ready export. For the long-form
 * channels the service goes further and asks the model to repair a piece that
 * fails a shape check, rather than storing it thin.
 */

export const SHAPE_WARNING_KINDS: ReadonlySet<ChannelWarning['kind']> = new Set<ChannelWarning['kind']>([
  'body_too_short',
  'sections_missing',
  'hashtags_missing',
  'hashtags_invalid',
  'alt_text_missing',
  'website_form_missing',
  // Google Search Ads (google-ads-practice.md, 2026-09-15).
  'ad_headline_too_long',
  'ad_description_too_long',
  'ad_assets_missing',
  'ad_policy_risk',
  'ad_keyword_missing',
]);

export const CONTEXT_WARNING_KINDS: ReadonlySet<ChannelWarning['kind']> = new Set<ChannelWarning['kind']>([
  'keywords_missing',
  'copied_fact_sentence',
  'repeated_across_pieces',
  'page_excerpt_not_found',
  'page_unavailable',
]);

/**
 * The channels whose piece is a page or a mail rather than a post.
 *
 * `landing_page` is the pre-split website channel; stored rows still read back
 * through here (2026-09-15).
 */
export const LONG_FORM_CHANNELS: ReadonlySet<MarketingChannel> = new Set<MarketingChannel>([
  'landing_page',
  'course_page_update',
  'blog_article',
  'email',
]);

/** The channels whose piece is a website deliverable, old form or new. */
export const WEBSITE_CHANNELS: ReadonlySet<MarketingChannel> = new Set<MarketingChannel>([
  'landing_page',
  'course_page_update',
  'blog_article',
]);

/** A blog article is a page in its own right; fewer words is a summary, not an article. */
export const MIN_ARTICLE_WORDS = 800;

/** Two texts this alike are the same text with the names changed. */
export const REPEAT_THRESHOLD = 0.6;

/** A run of this many words copied from a course fact is recitation, not writing. */
const COPIED_SENTENCE_WORDS = 10;

export function wordCount(text: string): number {
  const words = text.trim().split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word));
  return words.length;
}

/**
 * Text folded for comparison: no diacritics, no case, no punctuation, one
 * space between words. "Verzuim-dossier" and "verzuimdossier" still differ —
 * that is a spelling, not a formatting, difference.
 */
export function normaliseText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * `#Tag` from whatever the model wrote, or null when it is not a hashtag:
 * letters, digits and underscores only, after an optional `#`. Spaces are the
 * usual failure ("#sociale zekerheid" is two words and no tag).
 */
export function normaliseHashtag(raw: string): string | null {
  const stripped = raw.trim().replace(/^#+/u, '');
  if (stripped.length < 2 || stripped.length > 59) return null;
  if (!/^[\p{L}\p{N}_]+$/u.test(stripped)) return null;
  if (!/\p{L}/u.test(stripped)) return null;
  return `#${stripped}`;
}

/** Word trigrams of the normalised text; the unit of "the same text". */
function trigrams(text: string): Set<string> {
  const words = normaliseText(text).split(' ').filter((word) => word.length > 0);
  const grams = new Set<string>();
  for (let index = 0; index + 3 <= words.length; index += 1) {
    grams.add(words.slice(index, index + 3).join(' '));
  }
  return grams;
}

/** Jaccard similarity of the two texts' word trigrams, 0 to 1. Short texts compare by words. */
export function trigramJaccard(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) {
    const wa = new Set(normaliseText(a).split(' ').filter(Boolean));
    const wb = new Set(normaliseText(b).split(' ').filter(Boolean));
    if (wa.size === 0 || wb.size === 0) return 0;
    let shared = 0;
    for (const word of wa) if (wb.has(word)) shared += 1;
    return shared / (wa.size + wb.size - shared);
  }
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Whether a quoted passage is on the page, folded the same way on both sides. */
export function excerptFound(excerpt: string, pageText: string): boolean {
  const needle = normaliseText(excerpt);
  return needle.length >= 10 && normaliseText(pageText).includes(needle);
}

/** Whether a phrase occurs literally (folded) in a text. */
export function phraseOccurs(phrase: string, text: string): boolean {
  const needle = normaliseText(phrase);
  return needle.length > 0 && ` ${normaliseText(text)} `.includes(` ${needle} `);
}

/**
 * Every sentence of ten or more words that a text copies verbatim from a
 * course fact. The course name is not a sentence and is exempt; a fact value
 * shorter than ten words cannot be recited, only used.
 */
export function verbatimFactSentences(text: string, facts: readonly string[], courseName: string): string[] {
  const haystack = ` ${normaliseText(text)} `;
  const name = normaliseText(courseName);
  const copied: string[] = [];
  for (const fact of facts) {
    for (const sentence of fact.split(/(?<=[.!?;:])\s+|\n+/u)) {
      const folded = normaliseText(sentence);
      if (folded === name) continue;
      if (folded.split(' ').length < COPIED_SENTENCE_WORDS) continue;
      if (haystack.includes(` ${folded} `)) copied.push(sentence.trim());
    }
  }
  return [...new Set(copied)];
}

/** Every text of a piece, in reading order: what a reader would see. */
export function copyText(copy: ContentCopy): string {
  const parts: string[] = [copy.hook, copy.body, ...copy.sections.flatMap((section) => [section.heading, section.text])];
  if (copy.website?.form === 'blog_article') {
    parts.push(copy.website.metaDescription, articleText(copy.website));
  }
  if (copy.website?.form === 'course_page_update') {
    parts.push(...copy.website.changes.flatMap((change) => [change.placement, change.proposedText]));
  }
  return parts.join('\n');
}

/** The words a page or a mail offers a reader: introduction plus sections. */
function longFormWords(copy: ContentCopy): number {
  return wordCount(copy.body) + copy.sections.reduce((sum, section) => sum + wordCount(section.text), 0);
}

const label = (channel: MarketingChannel): string => CHANNEL_LABEL_NL[channel];

/**
 * Shape: what can be said from the copy alone. Recomputed on every read.
 */
export function checkCopyShape(input: {
  copy: ContentCopy;
  channel: MarketingChannel;
  withImage: boolean;
}): ChannelWarning[] {
  const { copy, channel } = input;
  const rules = lengthGuidanceFor(channel);
  const warnings: ChannelWarning[] = [];
  const warn = (kind: ChannelWarning['kind'], messageNl: string): void => {
    warnings.push({ kind, messageNl, blocksPublishReady: true });
  };
  if (channel === 'google_search_ads') warnings.push(...checkGoogleAdsShape(copy.ads));
  if (channel === 'linkedin_ads' || channel === 'meta_ads') {
    warnings.push(...checkPaidSocialAdShape(channel, copy.ads));
  }

  if (rules.minBodyWords !== null) {
    const words = wordCount(copy.body);
    if (words < rules.minBodyWords) {
      warn(
        'body_too_short',
        `De tekst telt ${String(words)} woorden; een bericht voor ${label(channel)} heeft er minimaal ${String(rules.minBodyWords)} nodig om iets te zeggen.`,
      );
    }
  }

  // A change proposal's substance is its changes; the section mirror of a
  // change list is as long as the list, and is judged below by change.
  const changeProposal =
    channel === 'course_page_update' ||
    (channel === 'landing_page' && copy.website?.form === 'course_page_update');

  if (rules.minTotalWords !== null && !changeProposal) {
    const words = longFormWords(copy);
    if (words < rules.minTotalWords) {
      warn(
        'body_too_short',
        `Inleiding en secties tellen samen ${String(words)} woorden; voor ${label(channel)} is minimaal ${String(rules.minTotalWords)} woorden nodig.`,
      );
    }
  }
  if (rules.minSections !== null && !changeProposal && copy.sections.length < rules.minSections) {
    warn(
      'sections_missing',
      `Het stuk heeft ${String(copy.sections.length)} secties; voor ${label(channel)} zijn er minimaal ${String(rules.minSections)} nodig.`,
    );
  }
  if (rules.maxSections !== null && copy.sections.length > rules.maxSections) {
    warn(
      'sections_missing',
      `Het stuk heeft ${String(copy.sections.length)} secties; voor ${label(channel)} zijn er maximaal ${String(rules.maxSections)} zinvol.`,
    );
  }
  if (rules.minSectionWords !== null && !changeProposal) {
    for (const section of copy.sections) {
      const words = wordCount(section.text);
      if (words < rules.minSectionWords) {
        warn(
          'sections_missing',
          `De sectie “${section.heading}” telt ${String(words)} woorden; een sectie heeft er minimaal ${String(rules.minSectionWords)} nodig.`,
        );
      }
    }
  }

  const tags = copy.hashtags.map(normaliseHashtag);
  const invalid = copy.hashtags.filter((_, index) => tags[index] === null);
  if (invalid.length > 0) {
    warn('hashtags_invalid', `Geen geldige hashtag: ${invalid.map((tag) => `“${tag}”`).join(', ')}. Een hashtag is één woord zonder spaties.`);
  }
  if (rules.maxHashtags === 0 && copy.hashtags.length > 0) {
    warn('hashtags_invalid', `${label(channel)} draagt geen hashtags; verwijder ze.`);
  } else if (copy.hashtags.length < rules.minHashtags) {
    warn(
      'hashtags_missing',
      `Het bericht heeft ${String(copy.hashtags.length)} hashtags; voor ${label(channel)} zijn ${String(rules.minHashtags)} tot ${String(rules.maxHashtags)} passend.`,
    );
  } else if (copy.hashtags.length > rules.maxHashtags) {
    warn(
      'hashtags_missing',
      `Het bericht heeft ${String(copy.hashtags.length)} hashtags; voor ${label(channel)} zijn ${String(rules.minHashtags)} tot ${String(rules.maxHashtags)} passend.`,
    );
  }

  if (input.withImage && (copy.imageAltText === null || copy.imageAltText.trim().length === 0)) {
    warn('alt_text_missing', 'Er is een beeld gepland maar geen alt-tekst; schermlezers hebben die nodig.');
  }

  if (WEBSITE_CHANNELS.has(channel)) {
    // Since the split the channel *is* the form, so the two cannot disagree.
    // A mismatch means the model wrote the wrong deliverable, which is a
    // repairable problem rather than a note on the side (2026-09-15).
    if (
      copy.website !== null &&
      ((channel === 'blog_article' && copy.website.form !== 'blog_article') ||
        (channel === 'course_page_update' && copy.website.form !== 'course_page_update'))
    ) {
      warn(
        'website_form_missing',
        `Dit stuk is gevraagd als ${label(channel)} maar geleverd als ${copy.website.form === 'blog_article' ? 'blogartikel' : 'wijzigingsvoorstel'}. Lever de gevraagde vorm.`,
      );
    }
    if (copy.website === null) {
      warnings.push({
        kind: 'website_form_missing',
        messageNl:
          'Dit stuk heeft nog geen vorm — wijzigingsvoorstel voor de opleidingspagina of blogartikel. Maak de content opnieuw om die te krijgen.',
        // Content from before the two forms existed; readable, not repaired.
        blocksPublishReady: false,
      });
    } else if (copy.website.form === 'blog_article') {
      // Structure and tone of the article, from the article alone; the
      // keywords are not known here, so the opening check runs in context.
      warnings.push(...checkArticleStructure(copy.website, null, []));
    } else {
      for (const change of copy.website.changes) {
        const words = wordCount(change.proposedText);
        if (words < 80) {
          warn(
            'body_too_short',
            `De voorgestelde tekst bij “${change.placement}” telt ${String(words)} woorden; een wijziging die iets toevoegt heeft er minimaal 80.`,
          );
        }
      }
    }
  }

  return warnings;
}

export interface CopyContext {
  /** The briefing's search phrases; empty when the briefing predates them. */
  keywords: readonly string[];
  /** Confirmed course-fact values, for the recitation check. */
  courseFacts: readonly string[];
  courseName: string;
  /** Source references the model was handed (persona groundings, the course page); an article may cite only these. */
  allowedSourceRefs?: readonly string[] | undefined;
  /** The live course page text, when it could be fetched. */
  pageText: string | null;
  /** Hooks and bodies of the campaign's other pieces. */
  otherPieces: readonly { label: string; hook: string; body: string }[];
}

/**
 * Context: what can only be judged against what the piece was written from.
 * Run at generation; stored with the piece.
 */
export function checkCopyContext(input: {
  copy: ContentCopy;
  channel: MarketingChannel;
  context: CopyContext;
}): ChannelWarning[] {
  const { copy, channel, context } = input;
  const warnings: ChannelWarning[] = [];
  if (input.channel === 'google_search_ads' && input.copy.ads !== null) {
    warnings.push(...checkGoogleAdsContext(input.copy.ads, { courseFacts: input.context.courseFacts }));
  }
  const warn = (kind: ChannelWarning['kind'], messageNl: string): void => {
    warnings.push({ kind, messageNl, blocksPublishReady: true });
  };
  const everything = copyText(copy);

  // Keywords: what the piece says it used must be there, and a page or a
  // mail must carry at least one of the briefing's phrases where a reader
  // and a search engine look first.
  const missingUsed = copy.keywordsUsed.filter((phrase) => !phraseOccurs(phrase, everything));
  if (missingUsed.length > 0) {
    warn(
      'keywords_missing',
      `Als gebruikt opgegeven maar niet in de tekst: ${missingUsed.map((phrase) => `“${phrase}”`).join(', ')}.`,
    );
  }
  // The article has its own opening rule (title, direct answer, meta description); the
  // generic one would demand the course name in an intro that must not carry it.
  if (context.keywords.length > 0 && LONG_FORM_CHANNELS.has(channel) && copy.website?.form !== 'blog_article') {
    const opening = [copy.hook, copy.body, copy.sections[0]?.text ?? ''].join('\n');
    if (!context.keywords.some((phrase) => phraseOccurs(phrase, opening))) {
      warn(
        'keywords_missing',
        `Geen van de zoektermen uit de briefing staat in de kop, de inleiding of de eerste sectie (${context.keywords
          .slice(0, 3)
          .map((phrase) => `“${phrase}”`)
          .join(', ')}).`,
      );
    }
  }

  const copied = verbatimFactSentences(everything, context.courseFacts, context.courseName);
  if (copied.length > 0) {
    warn(
      'copied_fact_sentence',
      `Letterlijk overgenomen uit de opleidingskaart in plaats van geschreven voor de lezer: “${(copied[0] ?? '').slice(0, 120)}”${copied.length > 1 ? ` en ${String(copied.length - 1)} andere zin(nen)` : ''}. Gebruik het feit als antwoord op een vraag, met dezelfde waarden.`,
    );
  }

  for (const other of context.otherPieces) {
    const hookAlike = trigramJaccard(copy.hook, other.hook);
    const bodyAlike = trigramJaccard(copy.body, other.body);
    if (hookAlike > REPEAT_THRESHOLD || bodyAlike > REPEAT_THRESHOLD) {
      warn(
        'repeated_across_pieces',
        `Deze tekst is grotendeels dezelfde als ${other.label}. Elk kanaal en elke fase opent anders en beantwoordt een andere vraag van de lezer.`,
      );
      break;
    }
  }

  if (copy.website?.form === 'blog_article') {
    // With the course name known: the course-before-the-answer rules and the
    // keyword opening; with the material known: numbers and sources.
    const structural = checkArticleStructure(copy.website, context.courseName, context.keywords).filter(
      (warning) => warning.kind === 'keywords_missing' || /opleiding wordt al|titel noemt de opleiding|brugzin noemt/u.test(warning.messageNl),
    );
    warnings.push(
      ...structural,
      ...checkArticleFacts(copy.website, {
        courseName: context.courseName,
        courseFacts: context.courseFacts,
        allowedSourceRefs: context.allowedSourceRefs ?? [],
      }),
    );
  }

  if (copy.website?.form === 'course_page_update') {
    if (context.pageText === null) {
      warn(
        'page_unavailable',
        'Een wijzigingsvoorstel vraagt de huidige opleidingspagina, en die kon niet worden gelezen. De voorgestelde tekst staat er, maar de huidige passages zijn nergens tegen gecontroleerd. Controleer de opleidings-URL op de opleidingskaart en maak dit stuk opnieuw, of beoordeel het met de pagina ernaast.',
      );
    } else {
      const missing = copy.website.changes.filter((change) => !excerptFound(change.currentExcerpt, context.pageText ?? ''));
      if (missing.length > 0) {
        warn(
          'page_excerpt_not_found',
          `Niet op de opleidingspagina gevonden: “${(missing[0]?.currentExcerpt ?? '').slice(0, 100)}”${missing.length > 1 ? ` en ${String(missing.length - 1)} andere passage(s)` : ''}. Een wijzigingsvoorstel citeert alleen tekst die er staat.`,
      );
      }
    }
  }

  return warnings;
}

/**
 * The warnings that send a piece back to the model for one repair before it
 * may be stored: thinness and form on a page or a mail, hashtags on a post,
 * a change that quotes text the page does not have, and a piece that repeats
 * another. Everything else is stored as a warning a person sees.
 */
export function repairableProblems(channel: MarketingChannel, warnings: readonly ChannelWarning[]): string[] {
  const kinds = new Set<ChannelWarning['kind']>(['hashtags_missing', 'hashtags_invalid', 'repeated_across_pieces', 'alt_text_missing']);
  if (channel === 'google_search_ads') {
    for (const kind of ['ad_headline_too_long', 'ad_description_too_long', 'ad_assets_missing', 'ad_policy_risk', 'ad_keyword_missing', 'marketese', 'unverified_number'] as const) {
      kinds.add(kind);
    }
  }
  if (LONG_FORM_CHANNELS.has(channel)) {
    for (const kind of [
      'body_too_short',
      'sections_missing',
      'page_excerpt_not_found',
      // `page_unavailable` is deliberately absent. It used to be repairable
      // because the model could switch to the article form; since the split the
      // channel decides the form, so there is nothing the model can do about a
      // website that will not load. The piece is stored with the warning, which
      // blocks a publish-ready export until a person has looked (2026-09-15).
      'article_structure',
      'marketese',
      'unverified_number',
      'unsourced_fact',
      'course_share',
    ] as const) {
      kinds.add(kind);
    }
  }
  return warnings.filter((warning) => kinds.has(warning.kind)).map((warning) => warning.messageNl);
}

const chars = (text: string): number => [...text].length;

/**
 * A paid social advertisement against the platform's own published limits.
 *
 * Both channels were `unverified` until 2026-09-15 and therefore carried no
 * limit at all: a headline of 200 characters exported clean and was refused in
 * Ads Manager. The numbers come from the channel registry, which names the page
 * each was read on, so there is one place to correct when a platform changes.
 */
export function checkPaidSocialAdShape(
  channel: 'linkedin_ads' | 'meta_ads',
  ads: AdProposal | null,
): ChannelWarning[] {
  const warnings: ChannelWarning[] = [];
  const spec = findChannelSpec(CHANNEL_CONFIG, channel, 'single_image')
    ?? findChannelSpec(CHANNEL_CONFIG, channel, 'text_only');
  const max = spec?.guidance.headlineMaxChars ?? null;
  if (ads === null) {
    warnings.push({
      kind: 'ad_assets_missing',
      messageNl: `Een advertentie voor ${label(channel)} bestaat uit koppen en beschrijvingen; het veld ads ontbreekt.`,
      blocksPublishReady: true,
    });
    return warnings;
  }
  if (max === null) {
    return warnings;
  }
  for (const headline of ads.headlines) {
    if (chars(headline) > max) {
      warnings.push({
        kind: 'ad_headline_too_long',
        messageNl: `Kop "${headline}" telt ${String(chars(headline))} tekens; ${label(channel)} staat er ${String(max)} toe.`,
        blocksPublishReady: true,
      });
    }
  }
  return warnings;
}

/**
 * A Google Search ad against Google's own limits and editorial policy
 * (google-ads-practice.md, read 2026-09-15). Shape only: nothing here needs
 * the briefing. Every message names the line so the repair round can fix it.
 */
export function checkGoogleAdsShape(ads: AdProposal | null): ChannelWarning[] {
  const warnings: ChannelWarning[] = [];
  const warn = (kind: ChannelWarning['kind'], messageNl: string): void => {
    warnings.push({ kind, messageNl, blocksPublishReady: true });
  };
  if (ads === null) {
    warn('ad_assets_missing', 'Een Google-zoekadvertentie bestaat uit koppen, beschrijvingen en zoektermen; het veld ads ontbreekt.');
    return warnings;
  }
  if (ads.headlines.length < GOOGLE_RSA_HOUSE.minHeadlines) {
    warn(
      'ad_assets_missing',
      `${String(ads.headlines.length)} koppen; Google accepteert ${String(GOOGLE_RSA.headlines.min)} tot ${String(GOOGLE_RSA.headlines.max)} en de advertentiesterkte vraagt variatie: lever er minimaal ${String(GOOGLE_RSA_HOUSE.minHeadlines)}, elk met een ander verkoopargument of een andere call to action.`,
    );
  }
  if (ads.descriptions.length < GOOGLE_RSA_HOUSE.minDescriptions) {
    warn(
      'ad_assets_missing',
      `${String(ads.descriptions.length)} beschrijvingen; Google accepteert ${String(GOOGLE_RSA.descriptions.min)} tot ${String(GOOGLE_RSA.descriptions.max)}: lever er minimaal ${String(GOOGLE_RSA_HOUSE.minDescriptions)}.`,
    );
  }
  for (const headline of ads.headlines) {
    if (chars(headline) > GOOGLE_RSA.headlines.maxChars) {
      warn('ad_headline_too_long', `Kop "${headline}" telt ${String(chars(headline))} tekens; Google staat maximaal ${String(GOOGLE_RSA.headlines.maxChars)} toe.`);
    }
    if (headline.includes('!')) {
      warn('ad_policy_risk', `Kop "${headline}" bevat een uitroepteken; Google rekent uitroeptekens in koppen tot opvallend leestekengebruik.`);
    }
  }
  for (const description of ads.descriptions) {
    if (chars(description) > GOOGLE_RSA.descriptions.maxChars) {
      warn('ad_description_too_long', `Beschrijving "${description}" telt ${String(chars(description))} tekens; Google staat maximaal ${String(GOOGLE_RSA.descriptions.maxChars)} toe.`);
    }
  }
  for (const path of ads.paths) {
    if (chars(path) > GOOGLE_RSA.paths.maxChars) {
      warn('ad_policy_risk', `Weergavepad "${path}" telt ${String(chars(path))} tekens; Google staat maximaal ${String(GOOGLE_RSA.paths.maxChars)} toe.`);
    }
  }
  const lines = [...ads.headlines, ...ads.descriptions];
  for (const line of lines) {
    if (/([!?.,])\1/u.test(line)) {
      warn('ad_policy_risk', `"${line}" herhaalt een leesteken; Google keurt herhaalde leestekens af.`);
    }
    if (/[•*]|\p{Extended_Pictographic}/u.test(line)) {
      warn('ad_policy_risk', `"${line}" bevat een opsommingsteken, sterretje of emoji; Google staat die niet toe in advertentietekst.`);
    }
    const shouting = line.match(/\b[A-ZÀ-Ý]{6,}\b/gu);
    if (shouting !== null) {
      warn('ad_policy_risk', `"${line}" schrijft ${shouting.join(', ')} in hoofdletters; Google keurt opvallend hoofdlettergebruik af (afkortingen en merknamen uitgezonderd).`);
    }
    const lower = line.toLowerCase();
    for (const term of MARKETESE) {
      if (lower.includes(term)) {
        warn('marketese', `"${line}" bevat "${term}": een superlatief of garantie zonder bewijs; Google keurt onwaarschijnlijke claims af en de huisstijl verbiedt ze.`);
      }
    }
  }
  if (ads.keywords.length === 0) {
    warn('ad_keyword_missing', 'Er zijn geen zoektermen geleverd; een zoekadvertentie zonder zoektermen kan niet worden ingericht.');
  } else if (!ads.keywords.some((keyword) => ads.headlines.some((headline) => normaliseText(headline).includes(normaliseText(keyword))))) {
    warn(
      'ad_keyword_missing',
      `Geen kop bevat een van de zoektermen (${ads.keywords.slice(0, 3).join(', ')}) letterlijk; Google's advertentiesterkte en relevantie vragen de zoekterm in minstens één kop.`,
    );
  }
  return warnings;
}

/**
 * What only the course card can judge: a number in an ad — a price, a
 * duration, a date — is a claim, and Google's misrepresentation policy and
 * our own rule agree that it must be true and visible on the destination.
 */
export function checkGoogleAdsContext(ads: AdProposal, context: { courseFacts: readonly string[] }): ChannelWarning[] {
  const warnings: ChannelWarning[] = [];
  const facts = normaliseText(context.courseFacts.join(' '));
  for (const line of [...ads.headlines, ...ads.descriptions]) {
    for (const number of line.match(/\d[\d.,]*/gu) ?? []) {
      if (!facts.includes(number)) {
        warnings.push({
          kind: 'unverified_number',
          messageNl: `"${line}" noemt ${number}; dat getal staat niet op de goedgekeurde opleidingskaart en mag niet in een advertentie.`,
          blocksPublishReady: true,
        });
      }
    }
  }
  return warnings;
}
