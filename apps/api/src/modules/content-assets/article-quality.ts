import type { ChannelWarning, WebsiteCopy } from '@c360/contracts';
import { normaliseText, phraseOccurs, wordCount } from './quality.js';

/**
 * The blog article, checked against the practice in
 * docs/product/blog-article-practice.md: what makes an article rank, get
 * cited by AI answer engines and still lead a reader to the course — and
 * what makes it read as a sales page or as generic prose.
 *
 * Two families again. *Structure and tone* can be judged from the article
 * alone and are sent back to the model once: the title as a question, a
 * direct answer of the right length, question headings that open with a
 * self-contained passage, a scenario, three to five follow-up questions, two
 * calls to action of the right kind, no exclamation marks, no superlatives,
 * no course name before the answer. *Facts and sources* need the material
 * the piece was written from: a number that is not on the course card and
 * not in a cited external fact is an invented statistic; an external fact
 * whose source the service did not hand the model is an invented source.
 * Readability and the share of paragraphs about the course are reported,
 * not repaired: they are judgement calls a reviewer should see.
 */

type Article = Extract<WebsiteCopy, { form: 'blog_article' }>;

export const ARTICLE = Object.freeze({
  titleMaxChars: 70,
  metaMinChars: 120,
  metaMaxChars: 155,
  directAnswerWords: [35, 90] as const,
  introWords: [40, 130] as const,
  sectionsRange: [4, 7] as const,
  sectionWords: [60, 320] as const,
  scenarioMinWords: 40,
  faqRange: [3, 5] as const,
  faqAnswerWords: [30, 110] as const,
  midCtaWords: [10, 70] as const,
  closingCtaWords: [6, 70] as const,
  coursePathWords: [60, 320] as const,
  totalWords: [800, 1_800] as const,
  maxCourseParagraphShare: 0.4,
  maxAverageSentenceWords: 24,
  maxSentenceWords: 45,
});

/** Words that promise or shout; the article carries its claim with facts. */
export const MARKETESE = [
  'beste',
  'uniek',
  'unieke',
  'dé opleiding',
  'revolutionair',
  'ongeëvenaard',
  'toonaangevend',
  'nummer 1',
  'nummer één',
  'marktleider',
  'garantie',
  'gegarandeerd',
] as const;

/** Pressure in a call to action; the reader decides, the article informs. */
export const PRESSURE_CTA = [
  'schrijf je nu in',
  'meld je direct aan',
  'meld je nu aan',
  'wacht niet langer',
  'beperkte plekken',
  'verzeker je plek',
  'nu inschrijven',
  'koop',
  'laatste kans',
] as const;

/** A heading the reader would type: a question, or a wh-word start. */
export function isQuestionHeading(heading: string): boolean {
  const trimmed = heading.trim();
  return trimmed.endsWith('?') || /^(wat|hoe|wanneer|wie|waarom|welke|waar|hoeveel|moet|kun|kan|is|zijn)\b/iu.test(trimmed);
}

/** A first sentence that only makes sense after the previous section. */
export function leansBackward(text: string): boolean {
  return /^(dit|deze|dat|daarom|daardoor|zoals (hierboven|gezegd|eerder)|hierdoor|dus|ook)\b/iu.test(text.trim());
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => wordCount(sentence) > 0);
}

/** The article's prose, in reading order. */
export function articleText(article: Article): string {
  return [
    article.title,
    article.directAnswerNl,
    article.intro,
    ...article.sections.flatMap((section) => [section.heading, section.text]),
    article.scenarioNl,
    article.midCtaNl,
    article.coursePathNl,
    ...article.faq.flatMap((item) => [item.question, item.answer]),
    article.closingCtaNl,
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

export function articleWordCount(article: Article): number {
  return (
    wordCount(article.directAnswerNl) +
    wordCount(article.intro) +
    article.sections.reduce((sum, section) => sum + wordCount(section.text), 0) +
    wordCount(article.scenarioNl) +
    wordCount(article.midCtaNl) +
    wordCount(article.coursePathNl) +
    article.faq.reduce((sum, item) => sum + wordCount(item.answer), 0) +
    wordCount(article.closingCtaNl)
  );
}

/** Numbers that read as facts: two or more digits, a percentage or an amount. */
function factualNumbers(text: string): string[] {
  return [...new Set(text.match(/(?:€\s?\d[\d.,]*|\d[\d.,]*\s?%|\b\d{2,}(?:[.,]\d+)?\b)/gu) ?? [])];
}

/**
 * Structure and tone: what the model can repair on its own.
 */
export function checkArticleStructure(
  article: Article,
  /** Null when the course is not known here; the course-dependent rules then wait for the context check. */
  courseName: string | null,
  keywords: readonly string[],
): ChannelWarning[] {
  const warnings: ChannelWarning[] = [];
  const warn = (kind: ChannelWarning['kind'], messageNl: string): void => {
    warnings.push({ kind, messageNl, blocksPublishReady: true });
  };
  const name = courseName === null ? '' : normaliseText(courseName);
  const knowsCourse = name.length > 0;
  const mentionsCourse = (text: string): boolean => knowsCourse && normaliseText(text).includes(name);

  // Title: the reader's question, short enough for a search result, without the course.
  if (article.title.length > ARTICLE.titleMaxChars) {
    warn('article_structure', `De titel telt ${String(article.title.length)} tekens; maximaal ${String(ARTICLE.titleMaxChars)} zodat hij in een zoekresultaat past.`);
  }
  if (knowsCourse && mentionsCourse(article.title)) {
    warn('article_structure', 'De titel noemt de opleiding; een artikel begint bij de vraag van de lezer, niet bij het aanbod.');
  }
  if (!isQuestionHeading(article.title)) {
    warn('article_structure', 'De titel is geen vraag zoals de lezer die zou zoeken (bijvoorbeeld "Wat …?", "Hoe …?", "Wanneer …?").');
  }

  // Meta description as a click pitch of the right length.
  if (article.metaDescription.length < ARTICLE.metaMinChars || article.metaDescription.length > ARTICLE.metaMaxChars) {
    warn(
      'article_structure',
      `De metabeschrijving telt ${String(article.metaDescription.length)} tekens; ${String(ARTICLE.metaMinChars)} tot ${String(ARTICLE.metaMaxChars)} past in een zoekresultaat.`,
    );
  }

  // The direct answer: present, the right length, declarative, quotable.
  const answerWords = wordCount(article.directAnswerNl);
  if (answerWords < ARTICLE.directAnswerWords[0] || answerWords > ARTICLE.directAnswerWords[1]) {
    warn(
      'article_structure',
      `Het directe antwoord (directAnswerNl) telt ${String(answerWords)} woorden; ${String(ARTICLE.directAnswerWords[0])} tot ${String(ARTICLE.directAnswerWords[1])} maakt het citeerbaar.`,
    );
  }
  if (answerWords > 0 && (/^\s*in dit artikel/iu.test(article.directAnswerNl) || article.directAnswerNl.trim().endsWith('?'))) {
    warn('article_structure', 'Het directe antwoord moet het antwoord zijn, geen aankondiging ("In dit artikel …") en geen vraag.');
  }

  // Intro: the problem in the reader's words, no course yet.
  const introWords = wordCount(article.intro);
  if (introWords < ARTICLE.introWords[0] || introWords > ARTICLE.introWords[1]) {
    warn('article_structure', `De inleiding telt ${String(introWords)} woorden; ${String(ARTICLE.introWords[0])} tot ${String(ARTICLE.introWords[1])} houdt haar bij het probleem van de lezer.`);
  }
  if (knowsCourse && (mentionsCourse(article.directAnswerNl) || mentionsCourse(article.intro))) {
    warn('article_structure', 'De opleiding wordt al in het antwoord of de inleiding genoemd; de opleiding komt pas na het eerste inzicht, in de brugzin.');
  }

  // Sections: enough of them, question headings, self-contained openings, one idea each.
  if (article.sections.length < ARTICLE.sectionsRange[0] || article.sections.length > ARTICLE.sectionsRange[1]) {
    warn('article_structure', `Het artikel heeft ${String(article.sections.length)} secties; ${String(ARTICLE.sectionsRange[0])} tot ${String(ARTICLE.sectionsRange[1])} deelvragen dekken een vraag.`);
  }
  const questionHeadings = article.sections.filter((section) => isQuestionHeading(section.heading)).length;
  if (article.sections.length > 0 && questionHeadings * 2 < article.sections.length) {
    warn('article_structure', 'Minder dan de helft van de tussenkoppen is een vraag; koppen zijn de deelvragen van de lezer, niet slogans.');
  }
  for (const section of article.sections) {
    const words = wordCount(section.text);
    if (words < ARTICLE.sectionWords[0] || words > ARTICLE.sectionWords[1]) {
      warn('article_structure', `De sectie “${section.heading}” telt ${String(words)} woorden; ${String(ARTICLE.sectionWords[0])} tot ${String(ARTICLE.sectionWords[1])} is één idee, volledig uitgelegd.`);
    }
    if (leansBackward(section.text)) {
      warn('article_structure', `De sectie “${section.heading}” opent met een verwijzing naar de vorige sectie; een sectie moet los gelezen kunnen worden.`);
    }
  }

  // One concrete scenario.
  if (wordCount(article.scenarioNl) < ARTICLE.scenarioMinWords) {
    warn('article_structure', `Het praktijkscenario (scenarioNl) telt ${String(wordCount(article.scenarioNl))} woorden; beschrijf één concrete werksituatie met rol, situatie en beslissing in minimaal ${String(ARTICLE.scenarioMinWords)} woorden.`);
  }

  // FAQ: real follow-up questions, answer-first.
  if (article.faq.length < ARTICLE.faqRange[0] || article.faq.length > ARTICLE.faqRange[1]) {
    warn('article_structure', `Het artikel heeft ${String(article.faq.length)} veelgestelde vragen; ${String(ARTICLE.faqRange[0])} tot ${String(ARTICLE.faqRange[1])} echte vervolgvragen horen erbij.`);
  }
  for (const item of article.faq) {
    if (!item.question.trim().endsWith('?')) {
      warn('article_structure', `De veelgestelde vraag “${item.question}” eindigt niet op een vraagteken.`);
    }
    const words = wordCount(item.answer);
    if (words < ARTICLE.faqAnswerWords[0] || words > ARTICLE.faqAnswerWords[1]) {
      warn('article_structure', `Het antwoord op “${item.question}” telt ${String(words)} woorden; ${String(ARTICLE.faqAnswerWords[0])} tot ${String(ARTICLE.faqAnswerWords[1])} is een antwoord, geen opsomming en geen essay.`);
    }
  }
  const headingSet = new Set(article.sections.map((section) => normaliseText(section.heading)));
  if (article.faq.some((item) => headingSet.has(normaliseText(item.question)))) {
    warn('article_structure', 'Een veelgestelde vraag herhaalt een tussenkop; de FAQ beantwoordt vervolgvragen, niet dezelfde vraag opnieuw.');
  }

  // Two calls to action of the right kind.
  const midWords = wordCount(article.midCtaNl);
  if (midWords < ARTICLE.midCtaWords[0] || midWords > ARTICLE.midCtaWords[1]) {
    warn('article_structure', `De brugzin naar de opleiding (midCtaNl) telt ${String(midWords)} woorden; één zin van ${String(ARTICLE.midCtaWords[0])} tot ${String(ARTICLE.midCtaWords[1])} woorden die het inzicht verbindt met de opleiding.`);
  } else if (knowsCourse && !mentionsCourse(article.midCtaNl) && !normaliseText(article.midCtaNl).includes(normaliseText(article.internalLinkText))) {
    warn('article_structure', 'De brugzin noemt de opleiding niet bij naam; de naam is de linktekst.');
  }
  if (article.midCtaAfterSection >= Math.max(1, article.sections.length - 1)) {
    warn('article_structure', 'De brugzin staat na de laatste sectie; plaats haar na het eerste of tweede inzicht, ongeveer halverwege.');
  }
  const pathWords = wordCount(article.coursePathNl);
  if (pathWords < ARTICLE.coursePathWords[0] || pathWords > ARTICLE.coursePathWords[1]) {
    warn('article_structure', `De sectie over de weg naar de opleiding (coursePathNl) telt ${String(pathWords)} woorden; ${String(ARTICLE.coursePathWords[0])} tot ${String(ARTICLE.coursePathWords[1])}: wat een professional nodig heeft, dan de opleiding uit de kaart.`);
  }
  const closingWords = wordCount(article.closingCtaNl);
  if (closingWords < ARTICLE.closingCtaWords[0] || closingWords > ARTICLE.closingCtaWords[1]) {
    warn('article_structure', `De afsluitende call to action telt ${String(closingWords)} woorden; één zin van ${String(ARTICLE.closingCtaWords[0])} tot ${String(ARTICLE.closingCtaWords[1])} woorden.`);
  } else if (!/\b(bekijk|ontdek|lees|mijn|vergelijk)\b/iu.test(article.closingCtaNl)) {
    warn('article_structure', 'De afsluitende call to action beschrijft niet wat de klik oplevert; begin met "Bekijk", "Ontdek", "Lees" of "Vergelijk".');
  }

  // Tone: no shouting, no superlatives, no pressure.
  const text = articleText(article);
  if (text.includes('!')) {
    warn('marketese', 'Het artikel bevat een uitroepteken; een vakartikel schrijft zonder.');
  }
  // Lower-cased but with its accents: "dé opleiding" is a superlative, "de opleiding" is not.
  const spoken = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/gu, ' ').trim()} `;
  const hype = MARKETESE.filter((word) => spoken.includes(` ${word.toLowerCase()} `));
  if (hype.length > 0) {
    warn('marketese', `Overtreffende of belovende woorden: ${hype.map((word) => `“${word}”`).join(', ')}. Laat de feiten de claim dragen.`);
  }
  const pressure = PRESSURE_CTA.filter((phrase) => spoken.includes(` ${phrase.toLowerCase()} `));
  if (pressure.length > 0) {
    warn('marketese', `Druk in de call to action: ${pressure.map((phrase) => `“${phrase}”`).join(', ')}. De lezer beslist; het artikel informeert.`);
  }

  // Keywords where a reader and a search engine look first.
  if (keywords.length > 0) {
    const opening = `${article.title}\n${article.directAnswerNl}\n${article.metaDescription}`;
    if (!keywords.some((phrase) => phraseOccurs(phrase, opening))) {
      warn('keywords_missing', `Geen zoekterm uit de briefing in titel, direct antwoord of metabeschrijving (${keywords.slice(0, 3).map((phrase) => `“${phrase}”`).join(', ')}).`);
    }
  }

  // Length as a band: the floor is enforced, the ceiling reported.
  const total = articleWordCount(article);
  if (total < ARTICLE.totalWords[0]) {
    warn('body_too_short', `Het blogartikel telt ${String(total)} woorden; een artikel dat een vraag beantwoordt heeft er minimaal ${String(ARTICLE.totalWords[0])}.`);
  } else if (total > ARTICLE.totalWords[1]) {
    warnings.push({
      kind: 'readability',
      messageNl: `Het blogartikel telt ${String(total)} woorden; boven ${String(ARTICLE.totalWords[1])} lezen weinigen door. Schrap wat de vraag niet beantwoordt.`,
      blocksPublishReady: false,
    });
  }

  return warnings;
}

/**
 * Facts and sources: numbers must come from the course card or a cited
 * external fact; every external fact must cite a source the service handed
 * the model. Also the two reported-only judgements: the share of paragraphs
 * about the course, and sentence length.
 */
export function checkArticleFacts(
  article: Article,
  input: { courseName: string; courseFacts: readonly string[]; allowedSourceRefs: readonly string[] },
): ChannelWarning[] {
  const warnings: ChannelWarning[] = [];

  const allowed = new Set(input.allowedSourceRefs.map((ref) => normaliseText(ref)));
  const unsourced = article.externalFacts.filter((fact) => !allowed.has(normaliseText(fact.sourceRef)));
  if (unsourced.length > 0) {
    warnings.push({
      kind: 'unsourced_fact',
      messageNl: `Een extern feit verwijst naar een bron die niet in het materiaal zat: ${unsourced.map((fact) => `“${fact.sourceRef}”`).join(', ')}. Alleen bronnen uit <doelgroepen> of de opleidingspagina mogen worden aangehaald.`,
      blocksPublishReady: true,
    });
  }

  const known = new Set([...input.courseFacts, ...article.externalFacts.map((fact) => fact.statementNl)].flatMap(factualNumbers).map((number) => number.replace(/\s/gu, '')));
  const prose = [article.directAnswerNl, article.intro, ...article.sections.map((section) => section.text), article.scenarioNl, article.coursePathNl, ...article.faq.map((item) => item.answer)].join('\n');
  const unknown = factualNumbers(prose).filter((number) => !known.has(number.replace(/\s/gu, '')));
  if (unknown.length > 0) {
    warnings.push({
      kind: 'unverified_number',
      messageNl: `Getallen zonder bron in de tekst: ${unknown.slice(0, 5).join(', ')}. Een getal staat alleen in het artikel als het op de opleidingskaart staat of uit een aangehaald extern feit komt.`,
      blocksPublishReady: true,
    });
  }

  const paragraphs = [article.intro, ...article.sections.map((section) => section.text), article.scenarioNl, article.coursePathNl, ...article.faq.map((item) => item.answer)]
    .flatMap((block) => block.split(/\n{2,}/u))
    .filter((paragraph) => wordCount(paragraph) > 0);
  const name = normaliseText(input.courseName);
  const aboutCourse = paragraphs.filter((paragraph) => {
    const folded = normaliseText(paragraph);
    return (name.length > 0 && folded.includes(name)) || /\b(inschrijv|cursus|training|lesdag|examen)/u.test(folded);
  }).length;
  if (paragraphs.length > 0 && aboutCourse / paragraphs.length > ARTICLE.maxCourseParagraphShare) {
    warnings.push({
      kind: 'course_share',
      messageNl: `${String(aboutCourse)} van ${String(paragraphs.length)} alinea's gaan over de opleiding of het inschrijven; een artikel dat helpt houdt dat onder de helft.`,
      blocksPublishReady: true,
    });
  }

  const all = sentences(prose);
  if (all.length > 0) {
    const lengths = all.map(wordCount);
    const average = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
    const longest = Math.max(...lengths);
    if (average > ARTICLE.maxAverageSentenceWords || longest > ARTICLE.maxSentenceWords) {
      warnings.push({
        kind: 'readability',
        messageNl: `Gemiddeld ${String(Math.round(average))} woorden per zin, de langste ${String(longest)}; korter dan ${String(ARTICLE.maxAverageSentenceWords)} gemiddeld en ${String(ARTICLE.maxSentenceWords)} maximaal leest een professional door.`,
        blocksPublishReady: false,
      });
    }
  }
  return warnings;
}
