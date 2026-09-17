import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCampaignInput, type CampaignListItem } from '@c360/contracts';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * The campaigns list says where each campaign stands (slice K).
 *
 * The list used to show `campaign.stage`, a server enum advanced at four
 * points and stopping at "production". Now every row carries `progress`
 * computed by the same rule the detail page uses, from grouped queries — and
 * the list is paginated by keyset, without the briefing bodies.
 */
describe('the campaigns list with progress', () => {
  let h: TestHarness;
  let labelId: string;
  let courseVersionId: string;
  let fresh: string;
  let briefed: string;

  beforeAll(async () => {
    h = await createTestHarness();
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const seeded = h.seed.pilot.courseVersionId;
    if (seeded === undefined || seeded === null) {
      throw new Error('the seed no longer provides a pilot course version');
    }
    courseVersionId = seeded;
    const s = h.appContext.services;
    const { db, currentUser: user } = h;

    const first = await s.campaigns.create(
      db,
      user,
      labelId,
      createCampaignInput.parse({
        name: 'Met briefing (Demo)',
        entryMode: 'develop_my_idea',
        objective: 'consideration',
        courseVersionId,
        userIdea: 'Een idee dat in de lijst niet mag meereizen omdat het lang kan zijn.',
      }),
    );
    briefed = first.id;
    const proposed = await s.personas.propose(db, user, { labelId, courseVersionId, campaignId: briefed });
    const brief = await s.campaigns.draftBrief(db, user, {
      labelId,
      campaignId: briefed,
      personaVersionIds: proposed.personas.map((persona) => persona.id),
    });
    await s.campaigns.approveBrief(db, user, labelId, briefed, brief.id, null);

    const second = await s.campaigns.create(
      db,
      user,
      labelId,
      createCampaignInput.parse({
        name: 'Nog leeg (Demo)',
        entryMode: 'discover_opportunities',
        courseVersionId,
      }),
    );
    fresh = second.id;
  });

  afterAll(async () => {
    await h.close();
  });

  const list = async (query = ''): Promise<{ items: CampaignListItem[]; nextCursor: string | null }> => {
    const response = await h.app.inject({ method: 'GET', url: `/api/v1/labels/${labelId}/campaigns${query}` });
    expect(response.statusCode).toBe(200);
    return response.json<{ items: CampaignListItem[]; nextCursor: string | null }>();
  };

  it('returns campaigns newest first, each with its course and where it stands', async () => {
    const { items } = await list();
    const ids = items.map((item) => item.id);
    expect(ids.indexOf(fresh)).toBeLessThan(ids.indexOf(briefed));

    const empty = items.find((item) => item.id === fresh)!;
    expect(empty.progress).toMatchObject({ nextStepId: 'audience', nextStepNumber: 1, doneStepIds: [], attention: false, state: 'open' });
    expect(empty.courseName.length).toBeGreaterThan(0);

    const withBrief = items.find((item) => item.id === briefed)!;
    expect(withBrief.progress.nextStepId).toBe('concept');
    expect(withBrief.progress.doneStepIds).toEqual(expect.arrayContaining(['audience', 'brief']));
    expect(withBrief.progress.nextActionNl).not.toMatch(/\d/u);
    // Not from the stale enum: `stage` says brief_approval-ish things, progress says concept.
    expect(withBrief.progress.lastActivityAt >= withBrief.updatedAt).toBe(true);
  });

  it('keeps the briefing bodies off the list rows', async () => {
    const { items } = await list();
    for (const item of items) {
      expect(item.userIdea).toBeNull();
      expect(item.suppliedBrief).toBeNull();
    }
  });

  it('pages by keyset', async () => {
    const page = await list('?limit=1');
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const next = await list(`?limit=1&cursor=${encodeURIComponent(page.nextCursor ?? '')}`);
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
    // A garbled cursor reads as "from the start", never as an error.
    const garbled = await list('?limit=1&cursor=nonsense');
    expect(garbled.items[0]?.id).toBe(page.items[0]?.id);
  });
});
