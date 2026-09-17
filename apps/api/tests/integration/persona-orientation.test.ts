import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRODUCIBLE_CHANNELS, createCampaignInput } from '@c360/contracts';
import { verifyOrientationSources } from '../../src/modules/personas/service.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * Audience evidence for the channel plan (R-3), and what a revised audience
 * does to a briefing (R-5).
 *
 * A persona now says where its audience orients, each statement with evidence
 * or marked as an assumption. The evidence is *verified* against what the
 * service handed the model: a source the model produced on its own is not
 * something we gave it, so it cannot pass as evidence. And a brief pinned to a
 * persona version that gets a successor needs a second look — the same
 * transition content already makes when a course fact changes.
 */
describe('persona orientation sources', () => {
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

  it('keeps evidence it handed the model and strips evidence it did not', async () => {
    const s = h.appContext.services;
    const proposed = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId });
    const persona = proposed.personas[0]!;

    expect(persona.orientationSources.length).toBeGreaterThan(0);
    // The mock cites one confirmed course fact, one nothing, and one source it
    // invented. The first stays grounded, the other two read as assumptions.
    const grounded = persona.orientationSources.filter((source) => source.grounding !== null);
    const assumptions = persona.orientationSources.filter((source) => source.grounding === null);
    expect(grounded.every((source) => source.grounding?.kind === 'course_fact')).toBe(true);
    expect(assumptions.length).toBeGreaterThanOrEqual(2);
    expect(
      persona.orientationSources.some((source) => source.grounding?.sourceRef.includes('example.invalid')),
    ).toBe(false);
  });

  /**
   * Filling the field for a persona that has none.
   *
   * A persona written by hand or imported from a document arrives with an empty
   * orientation list, and that is exactly the field the channel plan leans on —
   * so until 2026-09-16 the one kind of persona a marketer makes themselves
   * could never move a channel verdict, and nothing could fill it for them.
   */
  it('researches where an audience orients, adds without overwriting, and never fakes a source', async () => {
    const s = h.appContext.services;

    // A hand-written persona: everything filled in except the one field.
    const own = await s.personas.createVersion(h.db, h.currentUser, {
      labelId,
      courseVersionId,
      personaKey: `handmade-${Date.now().toString(36)}`,
      origin: 'user',
      promptVersion: null,
      proposal: {
        name: 'Met de hand geschreven doelgroep',
        summary: 'Iemand die de rol er net bij heeft gekregen en zich moet inlezen.',
        need: 'Wil weten wat er van de rol wordt verwacht voordat zij zich inschrijft.',
        motivation: 'De verantwoordelijkheid is toegewezen en de kennis ontbreekt nog.',
        barriers: ['Weinig tijd naast de eigen dossiers'],
        decisionCriteria: ['Past het naast een volledige baan'],
        relationToCourse: 'De opleiding beschrijft precies de taken die zij erbij heeft gekregen.',
        grounding: [],
        assumptions: [],
        orientationSources: [
          {
            statementNl: 'Met de hand ingevoerd: vraagt altijd eerst de leidinggevende om akkoord.',
            channel: null,
            grounding: null,
          },
        ],
      },
    });
    expect(own.orientationSources).toHaveLength(1);

    const filled = await s.personas.fillOrientation(h.db, h.currentUser, {
      labelId,
      personaVersionId: own.id,
    });

    // It is a new version of the same persona, not a new persona.
    expect(filled.persona.personaKey).toBe(own.personaKey);
    expect(filled.persona.version).toBe(own.version + 1);

    // What somebody typed survives, first and unchanged.
    expect(filled.persona.orientationSources[0]?.statementNl).toBe(
      'Met de hand ingevoerd: vraagt altijd eerst de leidinggevende om akkoord.',
    );
    expect(filled.persona.orientationSources.length).toBeGreaterThan(1);
    expect(filled.addedNl.length).toBeGreaterThan(0);

    // Every statement is a sentence about behaviour with a channel from our own
    // vocabulary, or no channel at all — never an invented one.
    for (const source of filled.persona.orientationSources) {
      expect(source.statementNl.length).toBeGreaterThanOrEqual(10);
      if (source.channel !== null) {
        expect(PRODUCIBLE_CHANNELS).toContain(source.channel);
      }
    }

    // The provider cited a source that was never handed to it. That grounding
    // is removed, so it reads as an assumption instead of passing as evidence.
    const invented = filled.persona.orientationSources.find((source) =>
      source.statementNl.includes('leidinggevende om akkoord voordat'),
    );
    expect(invented?.grounding ?? null).toBeNull();

    // Pressing it again adds nothing: the statements are already there.
    const again = await s.personas.fillOrientation(h.db, h.currentUser, {
      labelId,
      personaVersionId: filled.persona.id,
    });
    expect(again.addedNl).toEqual([]);
    expect(again.noteNl).toContain('niets toegevoegd');
  });

  it('verifies each grounding kind on its own terms', () => {
    const course = {
      name: 'Demo',
      facts: {
        summary: { value: 'Een opleiding.', state: 'user_confirmed' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
        targetAudience: { value: null, state: 'unverified' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
        entryConditions: { value: null, state: 'unverified' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
        duration: { value: null, state: 'unverified' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
        contentOutline: { value: null, state: 'unverified' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
        price: { value: '€ 1', state: 'unverified' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
        dates: { value: null, state: 'unverified' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
        accreditation: { value: null, state: 'unverified' as const, sourceRef: null, confirmedAt: null, confirmedByUserId: null, uncertaintyNl: null },
      },
    };
    const known = { findingSourceRefs: new Set(['https://bron.example/a']), course, hasBrand: true };
    const statement = 'Leest vakmedia tijdens werktijd op LinkedIn.';
    const verified = verifyOrientationSources(
      [
        { statementNl: statement, channel: 'linkedin_organic', grounding: { claim: 'x', kind: 'external_source', sourceRef: 'https://bron.example/a', retrievedAt: null } },
        { statementNl: statement, channel: 'linkedin_organic', grounding: { claim: 'x', kind: 'external_source', sourceRef: 'https://bron.example/b', retrievedAt: null } },
        { statementNl: statement, channel: 'course_page_update', grounding: { claim: 'x', kind: 'course_fact', sourceRef: 'Opleidingskaart · Korte omschrijving', retrievedAt: null } },
        // An unconfirmed fact is not evidence, whatever the model says.
        { statementNl: statement, channel: 'course_page_update', grounding: { claim: 'x', kind: 'course_fact', sourceRef: 'Opleidingskaart · Prijs', retrievedAt: null } },
        { statementNl: statement, channel: null, grounding: { claim: 'x', kind: 'observed_outcome', sourceRef: 'campagne 12', retrievedAt: null } },
        { statementNl: statement, channel: null, grounding: null },
      ],
      known,
    );
    expect(verified.map((source) => source.grounding !== null)).toEqual([true, false, true, false, false, false]);
    // Statements are never dropped, only demoted: the hypothesis stays visible.
    expect(verified).toHaveLength(6);
  });

  it('flags a briefing for re-review when one of its personas gets a new version (R-5)', async () => {
    const s = h.appContext.services;
    const proposed = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId });
    const ids = proposed.personas.map((persona) => persona.id);
    for (const id of ids) {
      await s.personas.approve(h.db, h.currentUser, labelId, id);
    }
    const campaign = await s.campaigns.create(
      h.db,
      h.currentUser,
      labelId,
      createCampaignInput.parse({ name: 'Herbeoordeling (Demo)', entryMode: 'discover_opportunities', objective: 'consideration', courseVersionId }),
    );
    const brief = await s.campaigns.draftBrief(h.db, h.currentUser, { labelId, campaignId: campaign.id, personaVersionIds: ids });
    await s.campaigns.approveBrief(h.db, h.currentUser, labelId, campaign.id, brief.id, null);
    expect((await s.campaigns.approvedBrief(h.db, campaign.id))?.id).toBe(brief.id);

    // Editing a persona makes version n+1 and leaves version n untouched…
    const before = await s.personas.requireVersion(h.db, labelId, ids[0]!);
    const edited = await s.personas.edit(h.db, h.currentUser, labelId, ids[0]!, { summary: 'Een herschreven samenvatting van deze doelgroep.' });
    expect(edited.version).toBe(before.version + 1);
    expect((await s.personas.requireVersion(h.db, labelId, ids[0]!)).version).toBe(before.version);

    // …but the brief that rests on version n is no longer approved: it needs
    // a second look, and the gate says why.
    expect(await s.campaigns.approvedBrief(h.db, campaign.id)).toBeUndefined();
    expect((await s.campaigns.latestBrief(h.db, campaign.id))?.reviewState).toBe('needs_rereview');
    await expect(s.campaigns.requireApprovedBrief(h.db, campaign.id)).rejects.toMatchObject({
      code: 'gate_not_passed',
      publicMessage: expect.stringContaining('doelgroep') as unknown,
    });

    // Approving it again is allowed — a person looked again — and re-opens the chain.
    await s.campaigns.approveBrief(h.db, h.currentUser, labelId, campaign.id, brief.id, 'Opnieuw gelezen.');
    expect((await s.campaigns.approvedBrief(h.db, campaign.id))?.id).toBe(brief.id);
  });
});
