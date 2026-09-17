import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCampaignInput, type PersonaVersion } from '@c360/contracts';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * Personas that accumulate and can be corrected (slice P).
 *
 * The complaint: "saved personas exist, new ones are not added, existing ones
 * cannot be changed". The cause: a proposal's identity was `campaign:slug`,
 * so a second run became version two of the first run; and campaign
 * personas were listed nowhere editable. These tests pin the behaviour that
 * replaces it.
 */
describe('personas that accumulate', () => {
  let h: TestHarness;
  let labelId: string;
  let courseVersionId: string;
  let campaignId: string;

  beforeAll(async () => {
    h = await createTestHarness();
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const seeded = h.seed.pilot.courseVersionId;
    if (seeded === undefined || seeded === null) {
      throw new Error('the seed no longer provides a pilot course version');
    }
    courseVersionId = seeded;
    const campaign = await h.appContext.services.campaigns.create(
      h.db,
      h.currentUser,
      labelId,
      createCampaignInput.parse({
        name: 'Doelgroepen die bijkomen (Demo)',
        entryMode: 'discover_opportunities',
        objective: 'consideration',
        courseVersionId,
      }),
    );
    campaignId = campaign.id;
  });

  afterAll(async () => {
    await h.close();
  });

  const listCampaign = async (): Promise<PersonaVersion[]> => {
    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/courses/${courseVersionId}/personas?campaignId=${campaignId}`,
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ items: PersonaVersion[] }>().items;
  };

  it('appends new identities on a second proposal instead of bumping versions', async () => {
    const s = h.appContext.services;
    const first = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId, campaignId });
    expect(first.personas.length).toBeGreaterThan(0);
    const afterFirst = await listCampaign();
    expect(afterFirst).toHaveLength(first.personas.length);

    const second = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId, campaignId });
    expect(second.personas.length).toBeGreaterThan(0);
    const afterSecond = await listCampaign();
    expect(afterSecond).toHaveLength(first.personas.length + second.personas.length);
    // Every row is a first version of its own identity: nothing was replaced.
    expect(afterSecond.every((persona) => persona.version === 1)).toBe(true);
    expect(new Set(afterSecond.map((persona) => persona.personaKey)).size).toBe(afterSecond.length);
    expect(afterSecond.every((persona) => persona.campaignId === campaignId)).toBe(true);
    // The model was told what existed: the second run's names are new ones.
    const firstNames = new Set(first.personas.map((persona) => persona.name));
    expect(second.personas.some((persona) => firstNames.has(persona.name))).toBe(false);
  });

  it('skips a proposal whose name already exists and says so, without failing the run', async () => {
    const s = h.appContext.services;
    const existing = (await listCampaign())[0];
    expect(existing).toBeDefined();
    const real = s.generation.generate.bind(s.generation);
    const spy = vi.spyOn(s.generation, 'generate').mockImplementation(async (db, request) => {
      if (request.template !== 'persona.propose') return real(db, request);
      const result = await real(db, request);
      const personas = (result.value as { personas: { name: string }[] }).personas;
      // The first proposal repeats an existing name; the rest stay as the mock made them.
      return {
        ...result,
        value: {
          ...(result.value as object),
          personas: personas.map((persona, index) => (index === 0 ? { ...persona, name: existing!.name } : persona)),
        },
      };
    });
    const before = (await listCampaign()).length;
    const proposed = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId, campaignId });
    spy.mockRestore();

    expect(proposed.shortfallReasonNl).toMatch(/overgeslagen omdat die doelgroep al bestaat/u);
    expect(proposed.shortfallReasonNl).toContain(existing!.name);
    expect(proposed.personas.some((persona) => persona.name === existing!.name)).toBe(false);
    expect((await listCampaign()).length).toBe(before + proposed.personas.length);
  });

  it('lists library and campaign personas together with scope=all, and copies a campaign persona into the library', async () => {
    const s = h.appContext.services;
    const library = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId });
    expect(library.personas.length).toBeGreaterThan(0);

    const all = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/courses/${courseVersionId}/personas?scope=all`,
    });
    expect(all.statusCode).toBe(200);
    const items = all.json<{ items: PersonaVersion[] }>().items;
    expect(items.some((persona) => persona.campaignId === null)).toBe(true);
    expect(items.some((persona) => persona.campaignId === campaignId)).toBe(true);

    const campaignPersona = items.find((persona) => persona.campaignId === campaignId);
    expect(campaignPersona).toBeDefined();
    const promoted = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/personas/${campaignPersona!.id}/library`,
      payload: {},
    });
    expect(promoted.statusCode).toBe(201);
    const copy = promoted.json<PersonaVersion>();
    expect(copy.campaignId).toBeNull();
    expect(copy.id).not.toBe(campaignPersona!.id);
    expect(copy.personaKey).not.toBe(campaignPersona!.personaKey);
    expect(copy.name).toBe(campaignPersona!.name);
    expect(copy.questionnaire).toEqual(campaignPersona!.questionnaire);
    // Provenance travels: the library copy says which campaign it came from.
    expect(copy.grounding.at(-1)).toMatchObject({ sourceRef: `campagne:${campaignId}` });
    expect(copy.grounding.at(-1)?.claim).toMatch(/Overgenomen uit campagne/u);
    expect(copy.origin).toBe('user');

    // The original stays in its campaign, and the library now has the copy.
    const libraryList = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/courses/${courseVersionId}/personas`,
    });
    expect(libraryList.json<{ items: PersonaVersion[] }>().items.some((persona) => persona.id === copy.id)).toBe(true);
    expect((await listCampaign()).some((persona) => persona.id === campaignPersona!.id)).toBe(true);

    // A library persona is not copied twice.
    const again = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/personas/${copy.id}/library`,
      payload: {},
    });
    expect(again.statusCode).toBe(400);
  });

  it('lets a campaign persona be corrected through the same edit route, keeping its identity and scope', async () => {
    const s = h.appContext.services;
    const target = (await listCampaign())[0]!;
    const edited = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/personas/${target.id}`,
      payload: { summary: 'Een gecorrigeerde samenvatting van deze doelgroep uit de campagne.' },
    });
    expect(edited.statusCode).toBe(200);
    const next = edited.json<PersonaVersion>();
    expect(next.version).toBe(target.version + 1);
    expect(next.personaKey).toBe(target.personaKey);
    expect(next.campaignId).toBe(campaignId);
    expect(next.origin).toBe('user');
    // The list shows the latest version only; the old one is history.
    const rows = await listCampaign();
    expect(rows.some((persona) => persona.id === next.id)).toBe(true);
    expect(rows.some((persona) => persona.id === target.id)).toBe(false);
    expect(await s.personas.requireVersion(h.db, labelId, target.id)).toMatchObject({ version: target.version });
  });
});
