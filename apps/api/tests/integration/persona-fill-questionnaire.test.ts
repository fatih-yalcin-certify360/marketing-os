import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PERSONA_QUESTIONS, type JobSummary, type PersonaVersion } from '@c360/contracts';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * Completing the questionnaire of a stored persona (2026-09-14).
 *
 * Personas made before every question was answered by design, and hand-made
 * ones, can have their open questions answered by the system. The answered
 * cells are never touched, the persona keeps its identity and origin, and
 * the work is a job a person starts.
 */
describe('filling the open questions of a stored persona', () => {
  let h: TestHarness;
  let labelId: string;
  let courseVersionId: string;

  const proposal = {
    name: 'HR-adviseur met verzuimtaken (Demo)',
    summary: 'Een HR-adviseur die verzuimdossiers begeleidt naast het reguliere werk.',
    need: 'Grip op de regels en de gesprekken rond verzuim.',
    motivation: 'Steeds vaker aanspreekpunt voor leidinggevenden bij lastige dossiers.',
    barriers: ['Tijd naast het werk'],
    decisionCriteria: ['Inpasbaar naast werk'],
    relationToCourse: 'De opleiding legt de basis onder wat deze adviseur al doet.',
    grounding: [],
    assumptions: ['Oriënteert zich eerst via collega’s.'],
    orientationSources: [],
    questionnaire: {
      q01: { answer: 'HR-adviseur met verzuimtaken.', status: 'provided' as const, sourceQuote: null, origin: 'user' as const },
      q30: { answer: 'Vraagt eerst collega’s.', status: 'assumption' as const, sourceQuote: null },
      q05: { answer: '', status: 'unknown' as const, sourceQuote: null },
    },
  };

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

  it('answers only the open questions, keeps the answered ones and the identity, and labels every new cell', async () => {
    const s = h.appContext.services;
    const created = await s.personas.createVersion(h.db, h.currentUser, {
      labelId,
      courseVersionId,
      proposal,
      personaKey: 'test:fill:hr-adviseur',
      origin: 'user',
    });
    expect(Object.keys(created.questionnaire ?? {})).toHaveLength(3);

    const result = await s.personas.fillQuestionnaire(h.db, h.currentUser, { labelId, personaVersionId: created.id });
    const { persona } = result;
    expect(persona.id).not.toBe(created.id);
    expect(persona.personaKey).toBe(created.personaKey);
    expect(persona.version).toBe(2);
    // A hand-made persona stays hand-made; only its open cells were filled.
    expect(persona.origin).toBe('user');
    expect(persona.promptVersion).toBe('v2');

    const questionnaire = persona.questionnaire ?? {};
    expect(Object.keys(questionnaire)).toHaveLength(PERSONA_QUESTIONS.length);
    expect(questionnaire.q01).toEqual(proposal.questionnaire.q01);
    expect(questionnaire.q30).toEqual(proposal.questionnaire.q30);
    // The mock answers every question, so nothing stays open.
    expect(result.filledIds).toHaveLength(34);
    expect(result.filledIds).toContain('q05');
    expect(result.stillOpenIds).toEqual([]);
    for (const id of result.filledIds) {
      const cell = questionnaire[id as keyof typeof questionnaire];
      expect(cell?.status).not.toBe('unknown');
      expect(['ai_source', 'ai_inference']).toContain(cell?.origin);
      if (cell?.origin === 'ai_inference') expect(cell.reasoningNl ?? '').not.toBe('');
      if (cell?.origin === 'ai_source') expect(cell.sourceRef ?? '').toMatch(/^Opleidingskaart · /u);
    }
    expect(result.noteNl).toMatch(/^34 van de 34 open vragen aangevuld/u);
    expect(result.isMock).toBe(true);

    // The list shows the new version only, and the old one is gone from it.
    const listed = await s.personas.listForCourse(h.db, h.currentUser, labelId, courseVersionId, undefined, 'library');
    expect(listed.some((item) => item.id === persona.id)).toBe(true);
    expect(listed.some((item) => item.id === created.id)).toBe(false);

    // A second run has nothing to do and stores nothing.
    const again = await s.personas.fillQuestionnaire(h.db, h.currentUser, { labelId, personaVersionId: persona.id });
    expect(again.persona.id).toBe(persona.id);
    expect(again.filledIds).toEqual([]);
    expect(again.noteNl).toMatch(/niets gewijzigd/u);
  });

  it('stores nothing when the model answer is unusable, so the job fails and can be retried', async () => {
    const s = h.appContext.services;
    const created = await s.personas.createVersion(h.db, h.currentUser, {
      labelId,
      courseVersionId,
      proposal: { ...proposal, name: 'Leidinggevende (Demo)' },
      personaKey: 'test:fill:leidinggevende',
      origin: 'user',
    });
    const real = s.generation.generate.bind(s.generation);
    const spy = vi.spyOn(s.generation, 'generate').mockImplementation(async (db, request) => {
      if (request.template !== 'persona.questionnaire') return real(db, request);
      throw Object.assign(new Error('provider_invalid_output'), { code: 'provider_invalid_output' });
    });
    await expect(s.personas.fillQuestionnaire(h.db, h.currentUser, { labelId, personaVersionId: created.id })).rejects.toThrow();
    spy.mockRestore();
    const stored = await s.personas.requireVersion(h.db, labelId, created.id);
    expect(stored.version).toBe(1);
    const listed = await s.personas.listForCourse(h.db, h.currentUser, labelId, courseVersionId, undefined, 'library');
    expect(listed.filter((item) => item.personaKey === created.personaKey)).toHaveLength(1);
  });

  it('is a job a person starts, scoped to the label', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/courses/${courseVersionId}/personas`,
      payload: { ...proposal, name: 'Casemanager (Demo)', linkedCourseVersionIds: [] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const persona = created.json<PersonaVersion>();

    const queued = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/personas/${persona.id}/questionnaire/fill`,
      payload: {},
    });
    expect(queued.statusCode, queued.body).toBe(202);
    const job = queued.json<JobSummary>();
    expect(job.type).toBe('persona.fill_questionnaire');

    // The same click twice is one job.
    const again = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/personas/${persona.id}/questionnaire/fill`,
      payload: {},
    });
    expect(again.statusCode).toBe(200);
    expect(again.json<JobSummary>().id).toBe(job.id);

    const other = labelIdBySlug(h.seed, 'demolabel-2');
    const foreign = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${other}/personas/${persona.id}/questionnaire/fill`,
      payload: {},
    });
    expect([403, 404]).toContain(foreign.statusCode);
  });
});
