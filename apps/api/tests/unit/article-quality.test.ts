import { describe, expect, it } from 'vitest';
import type { WebsiteCopy } from '@c360/contracts';
import {
  ARTICLE,
  articleWordCount,
  checkArticleFacts,
  checkArticleStructure,
  isQuestionHeading,
  leansBackward,
} from '../../src/modules/content-assets/article-quality.js';

/**
 * The blog-article practice (docs/product/blog-article-practice.md) as code:
 * a compliant article passes clean; each way of drifting toward a sales page
 * or a generic essay is named.
 */
type Article = Extract<WebsiteCopy, { form: 'blog_article' }>;

/** Filler prose in sentences of twelve words, so only the rule under test trips. */
const words = (count: number, seed = 'woord'): string =>
  Array.from({ length: count }, (_, index) => `${seed}${String(index % 7)}${(index + 1) % 12 === 0 ? '.' : ''}`).join(' ').replace(/\.?$/u, '.');

const COURSE = 'Opleiding Regie op Verzuim';

function compliant(): Article {
  return {
    form: 'blog_article',
    title: 'Hoe houd je regie op een verzuimdossier naast je werk?',
    metaDescription:
      'Regie op verzuim: wat het in de praktijk vraagt, waar het misgaat en wat je nodig hebt om het goed te doen. Geschreven voor wie de vraag zelf tegenkomt.',
    directAnswerNl: `Regie op verzuim betekent dat één persoon het overzicht houdt en de afspraken bewaakt. ${words(30, 'antwoord')}`,
    intro: `Het begint klein: een collega meldt zich ziek en jij krijgt het dossier erbij. ${words(45, 'intro')}`,
    sections: [
      { heading: 'Wat betekent regie precies?', text: `Het antwoord is overzicht houden. ${words(120, 'een')}` },
      { heading: 'Waarom loopt een dossier vast?', text: `Het misgaat zonder vaste rollen. ${words(120, 'twee')}` },
      { heading: 'Welke stappen horen erbij?', text: `Een vaste volgorde helpt. ${words(120, 'drie')}` },
      { heading: 'Hoe werk je samen met de bedrijfsarts?', text: `Ieder houdt zijn eigen rol. ${words(120, 'vier')}` },
    ],
    scenarioNl: `Een casemanager bij een zorgorganisatie krijgt een dossier van een medewerker die al weken thuis zit. ${words(30, 'scenario')}`,
    externalFacts: [{ statementNl: 'Een openbare bron beschrijft regie als overzicht houden.', sourceRef: 'https://bron.example/regie' }],
    midCtaNl: `Hoe je die structuur zelf opbouwt, is precies wat ${COURSE} behandelt.`,
    midCtaAfterSection: 1,
    coursePathNl: `Wie regie wil voeren, heeft kennis van de regels en een vaste werkwijze nodig. ${COURSE} is bedoeld voor wie die combinatie nodig heeft. ${words(45, 'pad')}`,
    faq: [
      { question: 'Mag een leidinggevende zelf de regie houden?', answer: `Dat mag zolang de termijnen bekend zijn. ${words(30, 'faq')}` },
      { question: 'Hoeveel tijd kost regie per week?', answer: `Dat hangt af van de fase van het dossier. ${words(30, 'tijd')}` },
      { question: 'Wat doe je als een advies niet wordt opgevolgd?', answer: `Leg vast wat het advies was en bespreek het verschil. ${words(30, 'advies')}` },
    ],
    closingCtaNl: `Bekijk het programma van ${COURSE} en zie of het aansluit op mijn praktijk.`,
    internalLinkText: `Bekijk de opleiding: ${COURSE}`,
  };
}

const facts = (article: Article, allowed: string[] = ['https://bron.example/regie']) =>
  checkArticleFacts(article, { courseName: COURSE, courseFacts: ['Circa 140 uur studiebelasting.'], allowedSourceRefs: allowed });

describe('the blog article', () => {
  it('passes clean when it follows the practice', () => {
    const article = compliant();
    expect(articleWordCount(article)).toBeGreaterThanOrEqual(ARTICLE.totalWords[0]);
    expect(checkArticleStructure(article, COURSE, ['regie op verzuim'])).toEqual([]);
    expect(facts(article)).toEqual([]);
  });

  it('refuses a title that is the course name, a course in the intro, and a pitch before the answer', () => {
    const article = compliant();
    article.title = `${COURSE}: alles wat je moet weten`;
    article.intro = `${COURSE} is de opleiding voor jou. ${words(50, 'intro')}`;
    article.directAnswerNl = `In dit artikel lees je alles over regie op verzuim en waarom dat belangrijk is voor jou en je organisatie. ${words(24, 'meer')}`;
    const messages = checkArticleStructure(article, COURSE, []).map((warning) => warning.messageNl);
    expect(messages.some((message) => message.includes('titel noemt de opleiding'))).toBe(true);
    expect(messages.some((message) => message.includes('opleiding wordt al'))).toBe(true);
    expect(messages.some((message) => message.includes('geen aankondiging'))).toBe(true);
  });

  it('names thin structure: too few sections, slogan headings, a dangling opening, two FAQs, a bridge after the last section', () => {
    const article = compliant();
    article.sections = [
      { heading: 'Regie als kunst', text: `Dit is de kern. ${words(90, 'a')}` },
      { heading: 'De kracht van overzicht', text: `Daarom werkt het. ${words(90, 'b')}` },
      { heading: 'Samen sterk', text: `${words(100, 'c')}` },
    ];
    article.faq = article.faq.slice(0, 2);
    article.midCtaAfterSection = 2;
    const messages = checkArticleStructure(article, COURSE, []).map((warning) => warning.messageNl);
    expect(messages.some((message) => message.includes('secties;'))).toBe(true);
    expect(messages.some((message) => message.includes('Minder dan de helft van de tussenkoppen'))).toBe(true);
    expect(messages.filter((message) => message.includes('opent met een verwijzing')).length).toBe(2);
    expect(messages.some((message) => message.includes('veelgestelde vragen;'))).toBe(true);
    expect(messages.some((message) => message.includes('na de laatste sectie'))).toBe(true);
  });

  it('refuses marketese, pressure and a pushy close', () => {
    const article = compliant();
    article.sections[0] = { heading: article.sections[0]!.heading, text: `Dé beste opleiding, uniek in Nederland! ${words(90, 'x')}` };
    article.closingCtaNl = 'Schrijf je nu in, wacht niet langer, beperkte plekken.';
    const warnings = checkArticleStructure(article, COURSE, []);
    const kinds = warnings.map((warning) => warning.kind);
    expect(kinds.filter((kind) => kind === 'marketese').length).toBeGreaterThanOrEqual(3);
    expect(warnings.some((warning) => warning.messageNl.includes('uitroepteken'))).toBe(true);
    expect(warnings.some((warning) => warning.messageNl.includes('Druk in de call to action'))).toBe(true);
    expect(warnings.some((warning) => warning.messageNl.includes('beschrijft niet wat de klik oplevert'))).toBe(true);
  });

  it('accepts numbers from the course card or a cited fact, and refuses the rest', () => {
    const article = compliant();
    article.coursePathNl = `${article.coursePathNl} De opleiding vraagt circa 140 uur.`;
    expect(facts(article)).toEqual([]);
    article.sections[2] = { heading: article.sections[2]!.heading, text: `Ruim 85% van de dossiers loopt vast en het kost gemiddeld € 4.500. ${words(80, 'n')}` };
    const warnings = facts(article);
    expect(warnings.map((warning) => warning.kind)).toContain('unverified_number');
    expect(warnings[0]?.messageNl).toMatch(/85%|4\.500/u);
  });

  it('refuses a source the model was not handed, and flags an article that is mostly about the course', () => {
    const article = compliant();
    article.externalFacts = [{ statementNl: 'Een bewering met een verzonnen bron.', sourceRef: 'https://verzonnen.example/' }];
    expect(facts(article).map((warning) => warning.kind)).toContain('unsourced_fact');

    const salesy = compliant();
    salesy.sections = salesy.sections.map((section) => ({ ...section, text: `${COURSE} leert je dit in de lesdagen en het examen. ${words(80, 's')}` }));
    salesy.intro = `Schrijf je in voor de cursus. ${words(50, 'i')}`;
    expect(facts(salesy).map((warning) => warning.kind)).toContain('course_share');
  });

  it('reports long sentences as a readability note that does not block', () => {
    const article = compliant();
    article.sections[0] = { heading: article.sections[0]!.heading, text: `${Array.from({ length: 50 }, (_, index) => `woord${String(index)}`).join(' ')}. ${words(60, 'r')}` };
    const readability = facts(article).find((warning) => warning.kind === 'readability');
    expect(readability?.blocksPublishReady).toBe(false);
  });

  it('recognises question headings and backward-leaning openings', () => {
    expect(isQuestionHeading('Wat is regie?')).toBe(true);
    expect(isQuestionHeading('Hoe werk je samen met de bedrijfsarts')).toBe(true);
    expect(isQuestionHeading('De kracht van overzicht')).toBe(false);
    expect(leansBackward('Dit is de kern van het verhaal.')).toBe(true);
    expect(leansBackward('Zoals hierboven staat, is het lastig.')).toBe(true);
    expect(leansBackward('Regie betekent overzicht.')).toBe(false);
  });
});
