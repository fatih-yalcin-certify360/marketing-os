import { describe, expect, it } from 'vitest';
import { briefProposal, type BriefProposal } from '@c360/contracts';
import {
  BRIEF_MIN_TOTAL_WORDS,
  BRIEF_SECTION_MIN_WORDS,
  briefNarrativeWords,
  briefProblems,
} from '../../src/modules/campaigns-briefs/service.js';

/**
 * The difference between a briefing and a form, as code: every narrative
 * section has a floor in words, the whole has a floor, every suggested channel
 * has a role, and nothing in the goal or the measurement reads as a forecast.
 */
const words = (count: number, seed = 'woord'): string =>
  Array.from({ length: count }, (_, index) => `${seed}${String(index % 9)}`).join(' ');

const full = (): BriefProposal =>
  briefProposal.parse({
    reviewNotes: [],
    keywords: [],
    ctaUrl: null,
    contextNl: words(130, 'context'),
    goal: words(60, 'doel'),
    audienceInsightNl: words(140, 'inzicht'),
    propositionNl: words(45, 'propositie'),
    coreMessage: words(20, 'kern'),
    stageMessages: [],
    evidence: [],
    usableClaims: [],
    offLimits: ['Geen beloftes.'],
    cta: 'Bekijk de opleiding',
    toneOfVoiceNl: words(35, 'toon'),
    mandatories: ['Elke uiting verwijst naar de opleidingspagina.'],
    channelRoles: [
      { channel: 'linkedin_organic', roleNl: words(25, 'rolA') },
      { channel: 'course_page_update', roleNl: words(25, 'rolB') },
    ],
    timingNl: words(35, 'timing'),
    risks: ['De doelgroepomschrijving rust op aannames.', 'Niet-gecontroleerde feiten blijven weg.'],
    channelSuggestions: ['linkedin_organic', 'course_page_update'],
    contentScope: words(90, 'scope'),
    measurement: words(60, 'meten'),
    stopConditions: words(30, 'stop'),
  });

describe('briefProblems', () => {
  it('accepts a briefing with every section at length', () => {
    const brief = full();
    expect(briefNarrativeWords(brief)).toBeGreaterThanOrEqual(BRIEF_MIN_TOTAL_WORDS);
    expect(briefProblems(brief)).toEqual([]);
  });

  it('names every thin section and the total, in words', () => {
    const thin: BriefProposal = {
      ...full(),
      contextNl: words(BRIEF_SECTION_MIN_WORDS.contextNl - 1, 'c'),
      audienceInsightNl: words(20, 'i'),
    };
    const problems = briefProblems(thin);
    expect(problems.some((problem) => problem.startsWith('Aanleiding en context (contextNl) telt 79 woorden'))).toBe(true);
    expect(problems.some((problem) => problem.startsWith('Doelgroep en inzicht (audienceInsightNl) telt 20 woorden'))).toBe(true);
    expect(problems.some((problem) => problem.includes('in totaal'))).toBe(true);
  });

  it('refuses a suggested channel without a role and a percentage in the goal', () => {
    const brief: BriefProposal = {
      ...full(),
      channelSuggestions: ['linkedin_organic', 'course_page_update', 'email'],
      goal: `${words(60, 'doel')} Minimaal 15% meer inschrijvingen.`,
    };
    const problems = briefProblems(brief);
    expect(problems.some((problem) => problem.includes('E-mail'))).toBe(true);
    expect(problems.some((problem) => problem.includes('percentage'))).toBe(true);
  });
});
