import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createCampaignInput } from '@c360/contracts';
import { courseVersions } from '../../src/core/db/schema.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * Approving a briefing and selecting a concept used to resolve the artefact on
 * its label alone, never on the campaign in the route (audit 2026-09-15).
 *
 * That made two campaigns of one label able to damage each other. Passing
 * campaign B's briefing id to campaign A's approve route approved the foreign
 * briefing *and* archived A's own, because the archiving step keys on the
 * campaign in the path — so A silently lost its approval and fell back to step
 * three. Concept selection had the same shape: A's selection was cleared and B
 * ended up with two selected concepts, after which the "one selected concept"
 * lookup picked one arbitrarily.
 *
 * Both now refuse a foreign id, and the test proves the untouched campaign
 * keeps what it had.
 */
describe('approval is scoped to the campaign in the route', () => {
  let h: TestHarness;
  let labelId: string;
  let courseVersionId: string;

  beforeAll(async () => {
    h = await createTestHarness();
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const seeded = h.seed.pilot.courseVersionId;
    if (seeded === undefined || seeded === null) throw new Error('the seed no longer provides a pilot course version');
    courseVersionId = seeded;
    await h.db.update(courseVersions).set({ reviewState: 'approved' }).where(eq(courseVersions.id, courseVersionId));
  });

  afterAll(async () => {
    await h.close();
  });

  /** A campaign with a drafted briefing, ready to approve. */
  const campaignWithBrief = async (name: string): Promise<{ campaignId: string; briefId: string }> => {
    const s = h.appContext.services;
    const personas = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId });
    const campaign = await s.campaigns.create(
      h.db,
      h.currentUser,
      labelId,
      createCampaignInput.parse({
        name,
        entryMode: 'start_from_briefing',
        objective: 'consideration',
        courseVersionId,
        suppliedBrief: 'Laat professionals de opleiding vergelijken en bekijken.',
      }),
    );
    const brief = await s.campaigns.draftBrief(h.db, h.currentUser, {
      labelId,
      campaignId: campaign.id,
      personaVersionIds: personas.personas.map((persona) => persona.id),
    });
    return { campaignId: campaign.id, briefId: brief.id };
  };

  it('refuses a briefing that belongs to another campaign, and leaves both campaigns intact', async () => {
    const s = h.appContext.services;
    const a = await campaignWithBrief('Scope A (Demo)');
    const b = await campaignWithBrief('Scope B (Demo)');

    await s.campaigns.approveBrief(h.db, h.currentUser, labelId, a.campaignId, a.briefId, null);

    // Campaign B's briefing id, offered through campaign A's route.
    await expect(
      s.campaigns.approveBrief(h.db, h.currentUser, labelId, a.campaignId, b.briefId, null),
    ).rejects.toMatchObject({ code: expect.stringMatching(/not_found|forbidden/u) });

    // A keeps the approval it had; B's briefing is untouched.
    const keptA = await s.campaigns.requireApprovedBrief(h.db, a.campaignId);
    expect(keptA.id).toBe(a.briefId);
    const briefsB = await s.campaigns.listBriefVersions(h.db, h.currentUser, labelId, b.campaignId);
    expect(briefsB.find((brief) => brief.id === b.briefId)?.reviewState).toBe('draft');
  });

  it('refuses a concept that belongs to another campaign, and leaves the first selection standing', async () => {
    const s = h.appContext.services;
    const a = await campaignWithBrief('Concept A (Demo)');
    const b = await campaignWithBrief('Concept B (Demo)');
    await s.campaigns.approveBrief(h.db, h.currentUser, labelId, a.campaignId, a.briefId, null);
    await s.campaigns.approveBrief(h.db, h.currentUser, labelId, b.campaignId, b.briefId, null);

    const conceptsA = await s.concepts.propose(h.db, h.currentUser, { labelId, campaignId: a.campaignId });
    const conceptsB = await s.concepts.propose(h.db, h.currentUser, { labelId, campaignId: b.campaignId });
    const chosenA = conceptsA.concepts[0];
    const foreign = conceptsB.concepts[0];
    if (chosenA === undefined || foreign === undefined) throw new Error('the mock proposed no concepts');

    await s.concepts.select(h.db, h.currentUser, labelId, a.campaignId, chosenA.id);

    await expect(
      s.concepts.select(h.db, h.currentUser, labelId, a.campaignId, foreign.id),
    ).rejects.toMatchObject({ code: expect.stringMatching(/not_found|forbidden/u) });

    // A still has its own concept selected, and exactly one.
    const stillA = await s.concepts.requireSelectedConcept(h.db, a.campaignId);
    expect(stillA.id).toBe(chosenA.id);
    const listB = await s.concepts.list(h.db, h.currentUser, labelId, b.campaignId);
    expect(listB.filter((concept) => concept.selected)).toHaveLength(0);
  });
});
