import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { contentCopy, type ContentCopy } from '@c360/contracts';
import {
  checkCopyContext,
  checkCopyShape,
  excerptFound,
  normaliseHashtag,
  repairableProblems,
  trigramJaccard,
  verbatimFactSentences,
  wordCount,
} from '../../src/modules/content-assets/quality.js';

/**
 * The house-style checks, on synthetic copy. Each rule that can send a piece
 * back to the model, or block its export, has a case here — including the
 * two-line landing page that started all this.
 */
const words = (count: number, seed = 'woord'): string =>
  Array.from({ length: count }, (_, index) => `${seed}${String(index % 7)}`).join(' ');

const post = (over: Partial<z.input<typeof contentCopy>> = {}): ContentCopy =>
  contentCopy.parse({
    hook: 'Een opening',
    body: words(90),
    ctaText: 'Bekijk de opleiding',
    ctaUrl: null,
    imageAltText: 'Beeld met de kop.',
    hashtags: ['#Verzuim', '#HRM', '#Casemanager'],
    sections: [],
    ads: null,
    ...over,
  });

const page = (over: Partial<z.input<typeof contentCopy>> = {}): ContentCopy =>
  contentCopy.parse({
    hook: 'Opleiding X: inhoud, doelgroep en werkwijze',
    body: words(60, 'intro'),
    ctaText: 'Bekijk de opleiding',
    ctaUrl: 'https://example.org/opleiding',
    imageAltText: null,
    hashtags: [],
    sections: [1, 2, 3, 4].map((index) => ({ heading: `Sectie ${String(index)}`, text: words(130, `s${String(index)}`) })),
    ads: null,
    ...over,
  });

describe('checkCopyShape', () => {
  it('refuses the two-line landing page', () => {
    const thin = page({
      body: 'De opleiding is bedoeld voor mensen in verzuim. Bekijk de opleiding.',
      sections: [{ heading: 'Voor wie', text: 'Mensen die werkzaam zijn in verzuim en sociale zekerheid.' }],
    });
    const kinds = checkCopyShape({ copy: thin, channel: 'landing_page', withImage: false }).map((warning) => warning.kind);
    expect(kinds).toContain('body_too_short');
    expect(kinds).toContain('sections_missing');
    expect(kinds).toContain('website_form_missing');
    expect(repairableProblems('landing_page', checkCopyShape({ copy: thin, channel: 'landing_page', withImage: false })).length).toBeGreaterThan(0);
  });

  it('accepts a page of four real sections and does not block one without a form', () => {
    const warnings = checkCopyShape({ copy: page(), channel: 'landing_page', withImage: false });
    expect(warnings.map((warning) => warning.kind)).toEqual(['website_form_missing']);
    expect(warnings[0]?.blocksPublishReady).toBe(false);
  });

  it('judges a page change by its changes, not by section counts', () => {
    const proposal = page({
      sections: [{ heading: 'Boven de eerste kop', text: words(90, 'w') }],
      website: {
        form: 'course_page_update',
        pageUrl: 'https://example.org/opleiding',
        changes: [
          { placement: 'Boven de eerste kop', reason: 'De lezer mist hier een antwoord op zijn eigen vraag.', currentExcerpt: 'Deze opleiding is bedoeld voor professionals.', proposedText: words(90, 'w') },
        ],
      },
    });
    expect(checkCopyShape({ copy: proposal, channel: 'landing_page', withImage: false })).toEqual([]);
    const thinChange = page({
      website: {
        form: 'course_page_update',
        pageUrl: 'https://example.org/opleiding',
        changes: [
          { placement: 'Onderaan', reason: 'De lezer mist hier een antwoord op zijn eigen vraag.', currentExcerpt: 'Deze opleiding is bedoeld voor professionals.', proposedText: words(80, 'w') },
        ],
      },
    });
    // 80 words satisfies the contract; the check asks for at least 80 too.
    expect(checkCopyShape({ copy: thinChange, channel: 'landing_page', withImage: false })).toEqual([]);
  });

  it('measures an article against its own minimum', () => {
    const article = page({
      website: {
        form: 'blog_article',
        title: 'Waar let je op bij opleiding X?',
        metaDescription: 'Wat de opleiding inhoudt, voor wie die is en hoe je kiest, zonder verkooppraat.',
        intro: words(100, 'i'),
        sections: [1, 2, 3].map((index) => ({ heading: `Deel ${String(index)}`, text: words(120, `a${String(index)}`) })),
        faq: [
          { question: 'Voor wie is de opleiding?', answer: words(30, 'f') },
          { question: 'Hoe combineer je het met werk?', answer: words(30, 'g') },
        ],
        internalLinkText: 'Bekijk de opleiding',
      },
    });
    const kinds = checkCopyShape({ copy: article, channel: 'landing_page', withImage: false }).map((warning) => warning.kind);
    // 100 + 360 + 60 = 520 words: an outline, not an article.
    expect(kinds).toContain('body_too_short');
  });

  it('wants a post to say something and to carry its hashtags', () => {
    expect(checkCopyShape({ copy: post({ body: 'Kort.' }), channel: 'linkedin_organic', withImage: true }).map((w) => w.kind)).toEqual(['body_too_short']);
    expect(checkCopyShape({ copy: post({ hashtags: ['#Een'] }), channel: 'linkedin_organic', withImage: true }).map((w) => w.kind)).toEqual(['hashtags_missing']);
    expect(checkCopyShape({ copy: post({ hashtags: ['sociale zekerheid', '#HRM', '#Verzuim'] }), channel: 'linkedin_organic', withImage: true }).map((w) => w.kind)).toEqual(['hashtags_invalid']);
    expect(checkCopyShape({ copy: post(), channel: 'linkedin_organic', withImage: true })).toEqual([]);
    expect(checkCopyShape({ copy: post({ imageAltText: null }), channel: 'linkedin_organic', withImage: true }).map((w) => w.kind)).toEqual(['alt_text_missing']);
  });

  it('refuses hashtags where they do not belong', () => {
    const mail = page({ hashtags: ['#Verzuim'], sections: [1, 2].map((index) => ({ heading: `Deel ${String(index)}`, text: words(70, `m${String(index)}`) })) });
    expect(checkCopyShape({ copy: mail, channel: 'email', withImage: false }).map((w) => w.kind)).toEqual(['hashtags_invalid']);
  });
});

describe('checkCopyContext', () => {
  const context = {
    keywords: ['opleiding casemanager verzuim', 'regie op verzuim'],
    courseFacts: [
      'De opleiding is bedoeld voor mensen die werkzaam zijn in verzuim en sociale zekerheid, zoals casemanagers en leidinggevenden.',
      'hbo-niveau',
    ],
    courseName: 'Opleiding X',
    pageText: 'Welkom bij de opleiding. Deze opleiding is bedoeld voor professionals met een verzuimrol. Lees verder over de inhoud.',
    otherPieces: [] as { label: string; hook: string; body: string }[],
  };

  it('flags a recited course-card sentence and a keyword that is claimed but absent', () => {
    const copy = page({
      body: `${words(40)} De opleiding is bedoeld voor mensen die werkzaam zijn in verzuim en sociale zekerheid, zoals casemanagers en leidinggevenden. ${words(20)}`,
      keywordsUsed: ['regie op verzuim'],
    });
    const kinds = checkCopyContext({ copy, channel: 'landing_page', context }).map((w) => w.kind);
    expect(kinds).toContain('copied_fact_sentence');
    expect(kinds).toContain('keywords_missing');
  });

  it('accepts a page that opens with a search phrase and says so', () => {
    const copy = page({
      hook: 'Opleiding casemanager verzuim: waar let je op?',
      body: `Regie op verzuim begint bij weten wat de rol vraagt. ${words(60, 'b')}`,
      keywordsUsed: ['opleiding casemanager verzuim', 'regie op verzuim'],
    });
    expect(checkCopyContext({ copy, channel: 'landing_page', context })).toEqual([]);
  });

  it('flags a piece that repeats another and names it', () => {
    const body = words(90, 'zin');
    const copy = post({ body, keywordsUsed: [] });
    const warnings = checkCopyContext({
      copy,
      channel: 'linkedin_organic',
      context: { ...context, keywords: [], otherPieces: [{ label: 'Facebook (Ontdekken)', hook: 'Anders', body }] },
    });
    expect(warnings.map((w) => w.kind)).toEqual(['repeated_across_pieces']);
    expect(warnings[0]?.messageNl).toContain('Facebook (Ontdekken)');
  });

  it('checks a page change against the page it quotes', () => {
    const proposal = page({
      hook: 'Opleiding casemanager verzuim',
      body: `Regie op verzuim: ${words(60, 'b')}`,
      keywordsUsed: [],
      website: {
        form: 'course_page_update',
        pageUrl: 'https://example.org/opleiding',
        changes: [
          { placement: 'Onder de inleiding', reason: 'De lezer mist hier een antwoord op zijn eigen vraag.', currentExcerpt: 'Deze opleiding is bedoeld voor professionals met een verzuimrol.', proposedText: words(90, 'w') },
          { placement: 'Onderaan', reason: 'De lezer mist hier een antwoord op zijn eigen vraag.', currentExcerpt: 'Deze zin staat nergens op de pagina.', proposedText: words(90, 'w') },
        ],
      },
    });
    const kinds = checkCopyContext({ copy: proposal, channel: 'landing_page', context }).map((w) => w.kind);
    expect(kinds).toEqual(['page_excerpt_not_found']);
    expect(checkCopyContext({ copy: proposal, channel: 'landing_page', context: { ...context, pageText: null } }).map((w) => w.kind)).toEqual(['page_unavailable']);
  });
});

describe('the text helpers', () => {
  it('counts words, folds text and normalises hashtags', () => {
    expect(wordCount('Eén, twee — drie.')).toBe(3);
    expect(normaliseHashtag('sociale zekerheid')).toBeNull();
    expect(normaliseHashtag('#SocialeZekerheid')).toBe('#SocialeZekerheid');
    expect(normaliseHashtag('verzuim')).toBe('#verzuim');
    expect(normaliseHashtag('2026')).toBeNull();
    expect(excerptFound('Deze  opleiding is bedoeld', 'Welkom. Deze opleiding is bedoeld voor u.')).toBe(true);
    expect(excerptFound('kort', 'Welkom.')).toBe(false);
  });

  it('measures similarity so that a paraphrase passes and a copy fails', () => {
    const a = 'Steeds meer verantwoordelijkheid vraagt om een stevige basis en die legt de opleiding voor jou neer.';
    expect(trigramJaccard(a, a)).toBe(1);
    expect(trigramJaccard(a, 'Een opleiding die uitlegt wat regie op verzuim in de praktijk van een casemanager betekent.')).toBeLessThan(0.2);
    expect(verbatimFactSentences(`Inleiding. ${a}`, [a], 'Opleiding X')).toEqual([a]);
    expect(verbatimFactSentences('Opleiding X is een opleiding.', ['Opleiding X'], 'Opleiding X')).toEqual([]);
  });
});
