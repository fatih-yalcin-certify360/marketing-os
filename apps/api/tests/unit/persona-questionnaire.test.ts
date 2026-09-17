import { describe, expect, it } from 'vitest';
import { PERSONA_QUESTIONS, type PersonaQuestionnaire } from '@c360/contracts';
import {
  AGE_NOT_DERIVABLE_NL,
  CONFLICT_ANSWER_NL,
  OPEN_ANSWER_NL,
  UNUSABLE_ANSWER_NL,
  fillOpenQuestions,
  openQuestionIds,
  questionnaireMaterial,
  verifyQuestionnaire,
  type QuestionnaireMaterial,
} from '../../src/modules/personas/questionnaire.js';

/**
 * The questionnaire the system fills is only as honest as this check.
 *
 * The model answers all 36 questions; what survives as *uit bron* is what it
 * can quote from the material the system supplied. Everything else is an
 * assumption that says it was inferred by AI, and what the model still left
 * open is an explicit open cell — never a plausible profile dressed as
 * research, and never an estimated age.
 */

const material: QuestionnaireMaterial[] = [
  { kind: 'research_finding', ref: 'https://werkgever.example/team', text: 'Ons team van casemanagers begeleidt verzuimdossiers vanaf de eerste ziektedag.', retrievedAt: '2026-09-10T10:00:00.000Z' },
  { kind: 'course_fact', ref: 'Opleidingskaart · Voor wie', text: 'HR-adviseurs en casemanagers die verzuimdossiers begeleiden.', retrievedAt: null },
  { kind: 'campaign_input', ref: 'campagne-input', text: 'We willen leidinggevenden bereiken die net verzuimtaken hebben gekregen.', retrievedAt: null },
];

const answer = (questionId: string, over: Record<string, unknown> = {}) => ({
  questionId,
  answer: 'Begeleidt verzuimdossiers vanaf de eerste ziektedag.',
  status: 'provided',
  quote: 'begeleidt verzuimdossiers vanaf de eerste ziektedag',
  sourceRef: 'https://werkgever.example/team',
  reasoningNl: null,
  ...over,
});

describe('verifyQuestionnaire', () => {
  it('fills every question: a quoted answer keeps its provenance, the rest is an explicit open cell', () => {
    const { questionnaire, notesNl, counts } = verifyQuestionnaire({ answers: [answer('q03')], noteNl: '' }, material);
    expect(Object.keys(questionnaire)).toHaveLength(PERSONA_QUESTIONS.length);
    expect(questionnaire.q03).toEqual({
      answer: 'Begeleidt verzuimdossiers vanaf de eerste ziektedag.',
      status: 'provided',
      sourceQuote: 'begeleidt verzuimdossiers vanaf de eerste ziektedag',
      sourceRef: 'https://werkgever.example/team',
      sourceKind: 'research_finding',
      sourceRetrievedAt: '2026-09-10T10:00:00.000Z',
      origin: 'ai_source',
      reasoningNl: null,
    });
    expect(questionnaire.q01).toMatchObject({ answer: OPEN_ANSWER_NL, status: 'unknown', origin: 'system' });
    expect(counts).toEqual({ sourced: 1, inferred: 0, open: 35 });
    expect(notesNl.at(-1)).toBe('1 van de 36 vragen ingevuld: 1 uit bron (letterlijke passage), 0 door AI afgeleid als aanname; 35 open en handmatig aan te vullen.');
  });

  it('keeps an inferred answer as an assumption by AI, with its reasoning', () => {
    const { questionnaire, counts } = verifyQuestionnaire(
      {
        answers: [
          answer('q30', { answer: 'Zoekt eerst online.', status: 'assumption', quote: null, sourceRef: null, reasoningNl: 'Afgeleid uit de rol: een werkende professional oriënteert zich online.' }),
          answer('q31', { answer: 'Zoekt op "opleiding casemanager".', status: 'assumption', quote: null, sourceRef: null }),
        ],
        noteNl: '',
      },
      material,
    );
    expect(questionnaire.q30).toMatchObject({
      status: 'assumption',
      origin: 'ai_inference',
      sourceQuote: null,
      reasoningNl: 'Afgeleid uit de rol: een werkende professional oriënteert zich online.',
    });
    // No reasoning given: the cell still says it is inferred, not sourced.
    expect(questionnaire.q31?.reasoningNl).toMatch(/Door AI afgeleid/u);
    expect(counts.inferred).toBe(2);
  });

  it('demotes a stated answer without a traceable passage to an inferred assumption, and says so', () => {
    const { questionnaire, notesNl } = verifyQuestionnaire(
      { answers: [answer('q23', { answer: 'De werkgever betaalt.', quote: 'de werkgever betaalt altijd', sourceRef: 'https://werkgever.example/team' })], noteNl: '' },
      material,
    );
    expect(questionnaire.q23).toMatchObject({ status: 'assumption', origin: 'ai_inference', sourceQuote: null, sourceRef: null, sourceKind: null });
    expect(notesNl.join(' ')).toMatch(/geen letterlijke passage/u);
  });

  it('finds the passage in another item when the reference is wrong, and records the real source', () => {
    const { questionnaire } = verifyQuestionnaire(
      { answers: [answer('q02', { quote: 'HR-adviseurs en casemanagers', sourceRef: 'https://ergens-anders.example/' })], noteNl: '' },
      material,
    );
    expect(questionnaire.q02).toMatchObject({ status: 'provided', sourceRef: 'Opleidingskaart · Voor wie', sourceKind: 'course_fact', origin: 'ai_source' });
  });

  it('answers the personal questions about relevance, never with an estimated age', () => {
    const { questionnaire, notesNl } = verifyQuestionnaire(
      {
        answers: [
          answer('q07', { answer: 'Tussen 35 en 50 jaar.', status: 'assumption', quote: null, sourceRef: null, reasoningNl: 'Geschat.' }),
          answer('q08', { answer: 'Regio is niet bepalend; reistijd moet naast het werk passen.', status: 'assumption', quote: null, sourceRef: null, reasoningNl: 'Afgeleid uit de rol.' }),
          answer('q09', { answer: 'Werkt in deeltijd.', quote: 'leidinggevenden bereiken', sourceRef: 'campagne-input' }),
        ],
        noteNl: '',
      },
      material,
    );
    // An age without a passage is replaced by the honest statement — still answered.
    expect(questionnaire.q07).toMatchObject({ answer: AGE_NOT_DERIVABLE_NL, status: 'assumption', origin: 'system' });
    expect(questionnaire.q07?.reasoningNl).toMatch(/stereotype/u);
    expect(notesNl.join(' ')).toMatch(/geschatte leeftijd/u);
    expect(questionnaire.q08).toMatchObject({ status: 'assumption', origin: 'ai_inference', reasoningNl: 'Afgeleid uit de rol.' });
    // A passage that is in the material does carry the answer — the relevance is stated there.
    expect(questionnaire.q09).toMatchObject({ status: 'provided', origin: 'ai_source' });
  });

  it('lets the meta-question stand without a quote and marks conflicting answers open', () => {
    const { questionnaire, notesNl } = verifyQuestionnaire(
      {
        answers: [
          answer('q36', { answer: 'q03 rust op een bevinding; q30 is een aanname.', quote: null, sourceRef: null }),
          answer('q10'),
          answer('q10', { answer: 'Iets anders.' }),
          answer('q11', { answer: 'Het materiaal zegt hier niets over.', status: 'unknown', quote: null, sourceRef: null }),
        ],
        noteNl: 'Het materiaal zegt niets over budget.',
      },
      material,
    );
    expect(questionnaire.q36).toMatchObject({ status: 'provided', sourceQuote: null, origin: 'ai_inference' });
    expect(questionnaire.q10).toMatchObject({ status: 'unknown', answer: CONFLICT_ANSWER_NL, origin: 'system' });
    // The model's own explanation of an open question is kept in the cell.
    expect(questionnaire.q11).toMatchObject({ status: 'unknown', answer: 'Het materiaal zegt hier niets over.', origin: 'system' });
    expect(notesNl[0]).toBe('Het materiaal zegt niets over budget.');
    expect(notesNl.join(' ')).toMatch(/tegenstrijdige antwoorden/u);
  });

  it('reports an unusable answer as an all-open questionnaire rather than failing the persona', () => {
    const { questionnaire, notesNl, counts } = verifyQuestionnaire({ nonsense: true }, material);
    expect(Object.values(questionnaire).every((cell) => cell?.status === 'unknown' && cell.answer === UNUSABLE_ANSWER_NL)).toBe(true);
    expect(counts.open).toBe(36);
    expect(notesNl[0]).toMatch(/alle vragen staan op onbekend/u);
  });
});

describe('fillOpenQuestions', () => {
  const existing: PersonaQuestionnaire = {
    q01: { answer: 'Casemanager.', status: 'provided', sourceQuote: null, origin: 'user' },
    q05: { answer: '', status: 'unknown', sourceQuote: null },
    q30: { answer: 'Zoekt online.', status: 'assumption', sourceQuote: null },
  };

  it('fills only the open questions and leaves every answered cell exactly as it was', () => {
    const filled = verifyQuestionnaire(
      {
        answers: [
          answer('q01', { answer: 'Iets anders over de rol.' }),
          answer('q05', { answer: 'Hbo-werkniveau.', status: 'assumption', quote: null, sourceRef: null, reasoningNl: 'Uit de rol.' }),
          answer('q30', { answer: 'Anders.', status: 'assumption', quote: null, sourceRef: null }),
        ],
        noteNl: '',
      },
      material,
    ).questionnaire;
    const merged = fillOpenQuestions(existing, filled);
    expect(merged.questionnaire.q01).toEqual(existing.q01);
    expect(merged.questionnaire.q30).toEqual(existing.q30);
    expect(merged.questionnaire.q05).toMatchObject({ answer: 'Hbo-werkniveau.', origin: 'ai_inference' });
    expect(merged.filledIds).toEqual(['q05']);
    // Everything the model left open stays open, with the system's explanation.
    expect(merged.stillOpenIds).toHaveLength(33);
    expect(merged.questionnaire.q02).toMatchObject({ status: 'unknown', origin: 'system' });
    expect(openQuestionIds(merged.questionnaire)).toHaveLength(33);
  });

  it('counts an empty cell and an absent cell alike as open', () => {
    expect(openQuestionIds(existing)).toHaveLength(34);
    expect(openQuestionIds(undefined)).toHaveLength(36);
  });
});

describe('questionnaireMaterial', () => {
  it('lists findings, confirmed facts and the campaign input with the references the model must echo', () => {
    const course = {
      name: 'Demo',
      facts: {
        summary: { value: 'Een opleiding.', state: 'user_confirmed' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
        targetAudience: { value: 'HR-adviseurs.', state: 'unverified' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
        entryConditions: { value: null, state: 'unverified' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
        duration: { value: null, state: 'unverified' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
        contentOutline: { value: null, state: 'unverified' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
        price: { value: null, state: 'unverified' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
        dates: { value: null, state: 'unverified' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
        accreditation: { value: null, state: 'unverified' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
      },
    };
    const items = questionnaireMaterial({
      findings: [{ claim: 'Een bevinding.', sourceRef: 'https://bron.example/', retrievedAt: '2026-09-10T10:00:00.000Z' }],
      course,
      campaignInput: '  ',
    });
    // Only the confirmed fact is material; the unverified one and the blank campaign input are not.
    expect(items).toEqual([
      { kind: 'research_finding', ref: 'https://bron.example/', text: 'Een bevinding.', retrievedAt: '2026-09-10T10:00:00.000Z' },
      { kind: 'course_fact', ref: 'Opleidingskaart · Korte omschrijving', text: 'Een opleiding.', retrievedAt: null },
    ]);
  });
});
