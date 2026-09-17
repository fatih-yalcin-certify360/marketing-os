import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCampaignInput, type PersonaVersion } from '@c360/contracts';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * A persona linked to more than one course (2026-09-14): it appears under
 * each linked course, can be chosen for a campaign on a linked course, and
 * cannot be linked to a course the label does not have.
 */
describe('persona course links', () => {
  let h: TestHarness;
  let labelId: string;
  let primaryCourse: string;
  let secondCourse: string;

  const proposal = {
    name: 'HR-adviseur met verzuimtaken',
    summary: 'Een HR-adviseur die verzuimdossiers begeleidt naast het reguliere werk.',
    need: 'Grip op de regels en de gesprekken rond verzuim, zonder er een tweede baan van te maken.',
    motivation: 'Steeds vaker aanspreekpunt voor leidinggevenden bij lastige dossiers.',
    barriers: ['Tijd naast het werk', 'Twijfel over het niveau'],
    decisionCriteria: ['Inpasbaar naast werk', 'Praktijkgericht'],
    relationToCourse: 'De opleiding legt de basis onder wat deze adviseur in de praktijk al doet.',
    grounding: [],
    assumptions: ['Oriënteert zich eerst via collega’s.'],
    orientationSources: [],
  };

  beforeAll(async () => {
    h = await createTestHarness();
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const seeded = h.seed.pilot.courseVersionId;
    if (seeded === undefined || seeded === null) {
      throw new Error('the seed no longer provides a pilot course version');
    }
    primaryCourse = seeded;
    const second = await h.appContext.services.courses.saveDraft(h.db, h.currentUser, labelId, {
      name: 'Tweede opleiding (Demo)',
      externalCode: null,
      sourceKind: 'manual',
      sourceRef: null,
      courseUrl: null,
      facts: { summary: { value: 'Een tweede demo-opleiding voor dezelfde doelgroep.' } },
      priceCents: null,
      priceNote: null,
      dates: [],
    });
    secondCourse = second.id;
  });

  afterAll(async () => {
    await h.close();
  });

  const listFor = async (course: string): Promise<PersonaVersion[]> => {
    const response = await h.app.inject({ method: 'GET', url: `/api/v1/labels/${labelId}/courses/${course}/personas` });
    expect(response.statusCode).toBe(200);
    return response.json<{ items: PersonaVersion[] }>().items;
  };

  it('links a persona to a second course and lists it under both', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/courses/${primaryCourse}/personas`,
      payload: { ...proposal, linkedCourseVersionIds: [secondCourse, primaryCourse] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const persona = created.json<PersonaVersion>();
    expect(persona.courseVersionId).toBe(primaryCourse);
    // The primary course is not repeated in the links.
    expect(persona.linkedCourseVersionIds).toEqual([secondCourse]);

    expect((await listFor(primaryCourse)).some((item) => item.id === persona.id)).toBe(true);
    expect((await listFor(secondCourse)).some((item) => item.id === persona.id)).toBe(true);

    // Unlinking through an edit removes it from the second course's list.
    const edited = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/personas/${persona.id}`,
      payload: { linkedCourseVersionIds: [] },
    });
    expect(edited.statusCode).toBe(200);
    const next = edited.json<PersonaVersion>();
    expect(next.version).toBe(2);
    expect(next.linkedCourseVersionIds).toEqual([]);
    expect((await listFor(secondCourse)).some((item) => item.personaKey === persona.personaKey)).toBe(false);
    expect((await listFor(primaryCourse)).some((item) => item.id === next.id)).toBe(true);
  });

  it('lets a campaign on the linked course brief with a linked persona', async () => {
    const s = h.appContext.services;
    const created = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/courses/${primaryCourse}/personas`,
      payload: { ...proposal, name: 'Leidinggevende met verzuimtaken', linkedCourseVersionIds: [secondCourse] },
    });
    const persona = created.json<PersonaVersion>();
    const campaign = await s.campaigns.create(
      h.db,
      h.currentUser,
      labelId,
      createCampaignInput.parse({
        name: 'Op de tweede opleiding (Demo)',
        entryMode: 'develop_my_idea',
        objective: 'consideration',
        courseVersionId: secondCourse,
        userIdea: 'Leidinggevenden die net verzuimtaken hebben gekregen laten vergelijken.',
      }),
    );
    const brief = await s.campaigns.draftBrief(h.db, h.currentUser, {
      labelId,
      campaignId: campaign.id,
      personaVersionIds: [persona.id],
    });
    expect(brief.personaVersionIds).toEqual([persona.id]);
  });

  it('refuses a link to a course the label does not have', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/courses/${primaryCourse}/personas`,
      payload: { ...proposal, name: 'Onbekende koppeling', linkedCourseVersionIds: ['11111111-1111-4111-8111-111111111111'] },
    });
    expect(response.statusCode).toBe(400);
  });
});
