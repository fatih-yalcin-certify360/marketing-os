import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PERSONA_QUESTIONS, createCampaignInput } from '@c360/contracts';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * Proposed personas arrive with all 36 questions answered from the system's
 * own research: every answer either quotes a passage and says where it comes
 * from, or is labelled as inferred by AI with its reasoning. No question is
 * left open by design; what the model cannot answer is an explicit open cell.
 */
describe('the questionnaire on proposed personas', () => {
  let h: TestHarness;
  let labelId: string;
  let courseVersionId: string;

  beforeAll(async () => {
    h = await createTestHarness();
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const seeded = h.seed.pilot.courseVersionId;
    if (seeded === undefined || seeded === null) {
      throw new Error('the seed no longer provides a pilot course version');
    }
    courseVersionId = seeded;
  });

  afterAll(async () => {
    await h.close();
  });

  it('fills every proposed persona with all 36 answers: quoted ones with provenance, the rest inferred by AI with reasoning', async () => {
    const s = h.appContext.services;
    const proposed = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId });
    expect(proposed.personas.length).toBeGreaterThan(0);
    expect(proposed.questionnaireNoteNl).toMatch(/van de 36 vragen ingevuld/u);

    for (const persona of proposed.personas) {
      const questionnaire = persona.questionnaire ?? {};
      expect(Object.keys(questionnaire)).toHaveLength(PERSONA_QUESTIONS.length);
      const provided = Object.entries(questionnaire).filter(([, cell]) => cell?.status === 'provided' && cell.sourceQuote !== null);
      // The mock quotes confirmed course facts; the seed confirms at least one.
      expect(provided.length).toBeGreaterThan(0);
      for (const [, cell] of provided) {
        expect(cell?.sourceKind).toBe('course_fact');
        expect(cell?.sourceRef).toMatch(/^Opleidingskaart · /u);
        expect(cell?.origin).toBe('ai_source');
      }
      // No question is open: every cell has an answer and is not on unknown.
      const open = Object.values(questionnaire).filter((cell) => cell?.status === 'unknown' || cell?.answer.trim() === '');
      expect(open).toEqual([]);
      // The age question is answered about relevance, as an inference — never with an estimate.
      expect(questionnaire.q07).toMatchObject({ status: 'assumption', origin: 'ai_inference' });
      expect(questionnaire.q07?.answer).not.toMatch(/\d/u);
      // The assumption without a quote is stored as inferred by AI, with its reasoning, not as research.
      expect(questionnaire.q30).toMatchObject({ status: 'assumption', sourceQuote: null, origin: 'ai_inference' });
      expect(questionnaire.q30?.reasoningNl).toMatch(/afgeleid/u);
      expect(proposed.questionnaireNoteNl).toMatch(/36 van de 36 vragen ingevuld/u);
      // The stored version reads back identically.
      const stored = await s.personas.requireVersion(h.db, labelId, persona.id);
      expect(stored.questionnaire).toEqual(questionnaire);
    }
  });

  it('demotes a model answer whose quote is not in the material, and survives a failed questionnaire call', async () => {
    const s = h.appContext.services;
    const real = s.generation.generate.bind(s.generation);
    let questionnaireCalls = 0;
    const spy = vi.spyOn(s.generation, 'generate').mockImplementation(async (db, request) => {
      if (request.template !== 'persona.questionnaire') return real(db, request);
      questionnaireCalls += 1;
      if (questionnaireCalls === 1) {
        return {
          promptVersion: 'v1',
          isMock: true,
          actualCostCents: 0,
          latencyMs: 0,
          value: {
            answers: [
              { questionId: 'q23', answer: 'De werkgever betaalt de opleiding.', status: 'provided', quote: 'de werkgever betaalt de opleiding altijd volledig', sourceRef: 'Opleidingskaart · Prijs' },
              { questionId: 'q36', answer: 'q23 is een aanname.', status: 'provided', quote: null, sourceRef: null },
            ],
            noteNl: 'Testantwoord.',
          },
        };
      }
      // Every later persona: the model returns something the schema refuses.
      return { promptVersion: 'v1', isMock: true, actualCostCents: 0, latencyMs: 0, value: { nonsense: true } };
    });

    const campaign = await s.campaigns.create(h.db, h.currentUser, labelId, createCampaignInput.parse({
      name: 'Vragenlijst-test (Demo)',
      entryMode: 'develop_my_idea',
      objective: 'consideration',
      courseVersionId,
      userIdea: 'Leidinggevenden die net verzuimtaken hebben gekregen helpen kiezen.',
    }));
    const proposed = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId, campaignId: campaign.id });
    spy.mockRestore();

    const first = proposed.personas[0]!.questionnaire ?? {};
    expect(first.q23).toMatchObject({ status: 'assumption', sourceQuote: null, origin: 'ai_inference' });
    expect(first.q36).toMatchObject({ status: 'provided', answer: 'q23 is een aanname.', origin: 'ai_inference' });
    // What the model left out is an explicit open cell, written by the system.
    expect(first.q01).toMatchObject({ status: 'unknown', origin: 'system' });
    expect(first.q01?.answer.length).toBeGreaterThan(0);
    expect(proposed.questionnaireNoteNl).toMatch(/geen letterlijke passage/u);
    expect(proposed.questionnaireNoteNl).toMatch(/34 open/u);

    if (proposed.personas.length > 1) {
      const second = proposed.personas[1]!.questionnaire ?? {};
      expect(Object.values(second).every((cell) => cell?.status === 'unknown' && cell.origin === 'system')).toBe(true);
      expect(proposed.questionnaireNoteNl).toMatch(/alle vragen staan op onbekend/u);
    }
  });
});
