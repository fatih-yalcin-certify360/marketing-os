import { describe, expect, it } from 'vitest';
import { personaFromQuestionnaire, personaInput } from '@c360/contracts';
import { buildPersonaTextDraft } from '../../src/modules/personas/text-draft.js';

describe('persona source extraction verification', () => {
  it('does not arbitrarily choose between conflicting answers for the same question', () => {
    const result = buildPersonaTextDraft('De persoon is HR-adviseur. De persoon is daarnaast docent.', { answers: [
      { questionId: 'q01', answer: 'HR-adviseur', status: 'provided', quote: 'De persoon is HR-adviseur.' },
      { questionId: 'q01', answer: 'Docent', status: 'provided', quote: 'De persoon is daarnaast docent.' },
    ] }, 'Voorbeeldopleiding');
    expect(result.personaDraft.questionnaire?.q01).toEqual({ answer: '', status: 'unknown', sourceQuote: null });
    expect(result.warnings.some(warning => warning.includes('q01'))).toBe(true);
    expect(result.personaDraft.grounding).toEqual([]);
  });

  it('accepts a short role without breaking required summary validation', () => {
    const result = buildPersonaTextDraft('De functie van deze persoon is HR. Het persoonlijke doel is groeien.', { answers: [
      { questionId: 'q01', answer: 'HR', status: 'provided', quote: 'De functie van deze persoon is HR.' },
      { questionId: 'q10', answer: 'Groeien', status: 'provided', quote: 'Het persoonlijke doel is groeien.' },
    ] }, 'Voorbeeldopleiding');
    expect(result.personaDraft.questionnaire?.q01?.answer).toBe('HR');
    expect(result.personaDraft.questionnaire?.q10?.answer).toBe('Groeien');
    expect(personaInput.safeParse(result.personaDraft).success).toBe(true);
  });

  it('keeps source-supplied media habits separate from verified channel evidence', () => {
    const result = buildPersonaTextDraft('Deze persoon leest artikelen op LinkedIn tijdens de lunch.', { answers: [
      { questionId: 'q32', answer: 'Leest artikelen op LinkedIn tijdens de lunch.', status: 'provided', quote: 'Deze persoon leest artikelen op LinkedIn tijdens de lunch.' },
    ] }, 'Voorbeeldopleiding');
    expect(result.personaDraft.questionnaire?.q32?.status).toBe('provided');
    expect(result.personaDraft.orientationSources).toEqual([
      { statementNl: 'Leest artikelen op LinkedIn tijdens de lunch.', channel: null, grounding: null },
    ]);
    expect(result.personaDraft.grounding).toEqual([]);
  });

  it('allows an unanswered assumption field and short tentative answers without breaking the campaign card', () => {
    const draft = personaFromQuestionnaire({
      q23: { answer: 'Ja', status: 'assumption', sourceQuote: null },
      q24: { answer: '', status: 'assumption', sourceQuote: null },
    });
    expect(draft.questionnaire?.q23?.answer).toBe('Ja');
    expect(draft.questionnaire?.q24?.answer).toBe('');
    expect(draft.assumptions).toHaveLength(1);
    expect(personaInput.safeParse(draft).success).toBe(true);
  });
});
