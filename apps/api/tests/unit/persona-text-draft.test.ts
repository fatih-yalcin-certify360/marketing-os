import { describe, expect, it } from 'vitest';
import { personaFromQuestionnaire, personaInput } from '@c360/contracts';
import { buildPersonaTextDrafts } from '../../src/modules/personas/text-draft.js';

/** The one draft a single-audience text yields, so each case stays readable. */
const first = (result: ReturnType<typeof buildPersonaTextDrafts>) => {
  const draft = result.drafts[0];
  if (draft === undefined) throw new Error('expected one draft');
  return { ...draft, warnings: [...draft.warnings, ...result.warnings] };
};

describe('persona source extraction verification', () => {
  it('gives every audience the text describes, each with its own name and answers', () => {
    /*
     * The rule used to be "take the first clearly described audience". Research
     * notes routinely describe several — an HR adviser, a career changer, a
     * team lead — and taking one of them silently threw the rest away.
     */
    const text =
      'De HR-adviseur adviseert over verzuim binnen de eigen organisatie. ' +
      'De zij-instromer komt uit een ander vak en wil casemanager worden.';
    const result = buildPersonaTextDrafts(
      text,
      {
        personas: [
          {
            labelNl: 'HR-adviseur met verzuimtaken',
            distinctionNl: 'Werkt al in HR en adviseert intern over verzuim.',
            relationToCourseNl: 'Sluit aan op de opleiding omdat de wettelijke kant nog ontbreekt.',
            answers: [
              { questionId: 'q01', answer: 'HR-adviseur', status: 'provided', quote: 'De HR-adviseur adviseert over verzuim binnen de eigen organisatie.' },
            ],
          },
          {
            labelNl: 'Zij-instromer richting casemanagement',
            distinctionNl: 'Komt uit een ander vakgebied en mist de basiskennis.',
            relationToCourseNl: null,
            answers: [
              { questionId: 'q01', answer: 'Zij-instromer', status: 'provided', quote: 'De zij-instromer komt uit een ander vak en wil casemanager worden.' },
            ],
          },
        ],
      },
      'Voorbeeldopleiding',
    );

    expect(result.drafts).toHaveLength(2);
    // Named after the audience, not after the answer to q01 — otherwise several
    // personas out of one text all read alike.
    expect(result.drafts.map((draft) => draft.personaDraft.name)).toEqual([
      'HR-adviseur met verzuimtaken',
      'Zij-instromer richting casemanagement',
    ]);
    // Each keeps its own answers; a quote from one may not land under the other.
    expect(result.drafts[0]?.personaDraft.questionnaire?.q01?.answer).toBe('HR-adviseur');
    expect(result.drafts[1]?.personaDraft.questionnaire?.q01?.answer).toBe('Zij-instromer');
    // The course link is written where the model could write it, and still the
    // honest placeholder where it could not.
    expect(result.drafts[0]?.personaDraft.relationToCourse).toContain('wettelijke kant');
    expect(result.drafts[1]?.personaDraft.relationToCourse).toContain('moet nog worden gecontroleerd');
    expect(result.warnings.join(' ')).toContain('2 verschillende doelgroepen');
  });

  it('says so when two proposed personas are really the same one', () => {
    const line = 'De adviseur wil meer zekerheid over wetgeving en complexe verzuimdossiers beoordelen.';
    const same = {
      distinctionNl: 'Beweerd onderscheid dat de tekst niet maakt.',
      relationToCourseNl: null,
      answers: [
        { questionId: 'q11' as const, answer: 'Wil zekerheid over wetgeving en complexe verzuimdossiers beoordelen', status: 'provided' as const, quote: line },
      ],
    };
    const result = buildPersonaTextDrafts(
      line,
      { personas: [{ ...same, labelNl: 'Adviseur A' }, { ...same, labelNl: 'Adviseur B' }] },
      'Voorbeeldopleiding',
    );
    expect(result.warnings.join(' ')).toContain('lijken sterk op elkaar');
  });

  it('does not arbitrarily choose between conflicting answers for the same question', () => {
    const result = first(buildPersonaTextDrafts('De persoon is HR-adviseur. De persoon is daarnaast docent.', { personas: [{ labelNl: 'Testdoelgroep', distinctionNl: 'De enige doelgroep in deze testtekst.', relationToCourseNl: null, answers: [
      { questionId: 'q01', answer: 'HR-adviseur', status: 'provided', quote: 'De persoon is HR-adviseur.' },
      { questionId: 'q01', answer: 'Docent', status: 'provided', quote: 'De persoon is daarnaast docent.' },
    ] }] }, 'Voorbeeldopleiding'));
    expect(result.personaDraft.questionnaire?.q01).toEqual({ answer: '', status: 'unknown', sourceQuote: null });
    expect(result.warnings.some(warning => warning.includes('q01'))).toBe(true);
    expect(result.personaDraft.grounding).toEqual([]);
  });

  it('accepts a short role without breaking required summary validation', () => {
    const result = first(buildPersonaTextDrafts('De functie van deze persoon is HR. Het persoonlijke doel is groeien.', { personas: [{ labelNl: 'Testdoelgroep', distinctionNl: 'De enige doelgroep in deze testtekst.', relationToCourseNl: null, answers: [
      { questionId: 'q01', answer: 'HR', status: 'provided', quote: 'De functie van deze persoon is HR.' },
      { questionId: 'q10', answer: 'Groeien', status: 'provided', quote: 'Het persoonlijke doel is groeien.' },
    ] }] }, 'Voorbeeldopleiding'));
    expect(result.personaDraft.questionnaire?.q01?.answer).toBe('HR');
    expect(result.personaDraft.questionnaire?.q10?.answer).toBe('Groeien');
    expect(personaInput.safeParse(result.personaDraft).success).toBe(true);
  });

  it('keeps source-supplied media habits separate from verified channel evidence', () => {
    const result = first(buildPersonaTextDrafts('Deze persoon leest artikelen op LinkedIn tijdens de lunch.', { personas: [{ labelNl: 'Testdoelgroep', distinctionNl: 'De enige doelgroep in deze testtekst.', relationToCourseNl: null, answers: [
      { questionId: 'q32', answer: 'Leest artikelen op LinkedIn tijdens de lunch.', status: 'provided', quote: 'Deze persoon leest artikelen op LinkedIn tijdens de lunch.' },
    ] }] }, 'Voorbeeldopleiding'));
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
