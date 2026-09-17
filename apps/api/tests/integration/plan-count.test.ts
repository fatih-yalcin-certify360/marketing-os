import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createCampaignInput } from '@c360/contracts';
import { courseVersions } from '../../src/core/db/schema.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * A channel plan says how many pieces each cell holds, and until 2026-09-15 the
 * number was ignored.
 *
 * The calendar expanded one publication moment per piece, and the plan grid
 * showed the number, but generation wrote exactly one asset per stage and
 * channel because the asset key was pinned to `-1`. So a plan of "LinkedIn ×2"
 * produced a calendar with two moments and an export with one file, and the
 * person who approved that plan was never told.
 */
describe('a channel plan that asks for more than one piece per cell', () => {
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

  it('produces every piece it promises, each under its own key', async () => {
    const s = h.appContext.services;
    const personas = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId });
    const campaign = await s.campaigns.create(
      h.db,
      h.currentUser,
      labelId,
      createCampaignInput.parse({
        name: 'Aantallen uit het plan (Demo)',
        entryMode: 'start_from_briefing',
        objective: 'awareness',
        courseVersionId,
        suppliedBrief: 'Laat professionals de opleiding leren kennen.',
      }),
    );
    const brief = await s.campaigns.draftBrief(h.db, h.currentUser, {
      labelId,
      campaignId: campaign.id,
      personaVersionIds: personas.personas.map((persona) => persona.id),
    });
    await s.campaigns.approveBrief(h.db, h.currentUser, labelId, campaign.id, brief.id, null);

    const concepts = await s.concepts.propose(h.db, h.currentUser, { labelId, campaignId: campaign.id });
    const chosen = concepts.concepts[0];
    if (chosen === undefined) throw new Error('the mock proposed no concepts');
    await s.concepts.select(h.db, h.currentUser, labelId, campaign.id, chosen.id);

    const proposed = await s.concepts.proposePlan(h.db, h.currentUser, { labelId, campaignId: campaign.id });

    // One cell of the proposed plan is asked for twice; everything else stays
    // as proposed, so the test measures the repeat and nothing else.
    const first = proposed.plan.items[0];
    if (first === undefined) throw new Error('the mock proposed an empty plan');
    const edited = {
      ...proposed.plan,
      items: proposed.plan.items.map((item, index) => (index === 0 ? { ...item, count: 2 } : item)),
    };
    const approved = await s.concepts.approvePlan(h.db, h.currentUser, labelId, campaign.id, edited);
    expect(approved.plan.items[0]?.count).toBe(2);

    await s.content.generate(h.db, h.currentUser, { labelId, campaignId: campaign.id }).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.log('WHY', (error as { internalDetail?: string }).internalDetail ?? 'geen detail');
      throw error;
    });
    const produced = await s.content.list(h.db, h.currentUser, labelId, campaign.id);

    // As many pieces as the plan asks for, in total.
    const promised = approved.plan.items.reduce((sum, item) => sum + item.count, 0);
    expect(produced).toHaveLength(promised);

    // And the doubled cell really holds two distinct pieces, not one written twice.
    const doubled = produced.filter(
      (asset) => asset.channel === first.channel && asset.funnelStage === first.stage,
    );
    expect(doubled).toHaveLength(2);
    expect(new Set(doubled.map((asset) => asset.assetKey)).size).toBe(2);
    expect(doubled[0]?.copy.hook).not.toBe(doubled[1]?.copy.hook);
  });
});
