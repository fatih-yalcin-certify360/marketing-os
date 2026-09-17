import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createCampaignInput } from '@c360/contracts';
import { briefVersions, courseVersions } from '../../src/core/db/schema.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * Approving a corrected opleidingskaart used to freeze every running campaign
 * (audit 2026-09-15): the campaign stayed pinned to the version it was created
 * with, that version was archived by the approval, and the export gate then
 * refused with "de opleidingskaart is nog niet goedgekeurd" — about a card the
 * user had just approved.
 *
 * Two things fix it, and both are checked here: content that rested on the
 * archived version is flagged in the same commit, and the campaign can be
 * moved to the current card, which flags its briefing and content for a second
 * look rather than pretending nothing changed.
 */
describe('a campaign and a newer opleidingskaart', () => {
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

  /**
   * The next version of the same course card, as a row copy.
   *
   * Copied rather than re-entered through `saveDraft`, because the point of
   * the test is the *approval* — which archives the previous version — and a
   * re-entered card would trip the unconfirmed-facts gate on fields the seed
   * left empty. The copy keeps the confirmed states exactly as they are.
   */
  const nextCourseVersionDraft = async (): Promise<string> => {
    const [row] = await h.db.select().from(courseVersions).where(eq(courseVersions.id, courseVersionId));
    if (row === undefined) throw new Error('the pilot course version vanished');
    // The seed leaves a couple of facts unconfirmed; approval refuses those,
    // so the copy confirms every fact that actually carries a value.
    const facts = Object.fromEntries(
      Object.entries(row.facts as Record<string, { value: string | null }>).map(([field, fact]) => [
        field,
        fact.value === null ? fact : { ...fact, state: 'user_confirmed' },
      ]),
    );
    const inserted = await h.db
      .insert(courseVersions)
      .values({ ...row, facts, id: randomUUID(), version: row.version + 1, reviewState: 'draft' })
      .returning({ id: courseVersions.id });
    return inserted[0]!.id;
  };

  it('moves a campaign to the current card and asks for a second look at what quoted the old one', async () => {
    const s = h.appContext.services;
    const personas = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId });
    const campaign = await s.campaigns.create(h.db, h.currentUser, labelId, createCampaignInput.parse({
      name: 'Kaart-herziening (Demo)',
      entryMode: 'start_from_briefing',
      objective: 'consideration',
      courseVersionId,
      suppliedBrief: 'Laat professionals de opleiding vergelijken en bekijken.',
    }));
    const brief = await s.campaigns.draftBrief(h.db, h.currentUser, {
      labelId,
      campaignId: campaign.id,
      personaVersionIds: personas.personas.map((persona) => persona.id),
    });
    await s.campaigns.approveBrief(h.db, h.currentUser, labelId, campaign.id, brief.id, null);

    // One real piece of content, so the stale flag has something to act on.
    const concepts = await s.concepts.propose(h.db, h.currentUser, { labelId, campaignId: campaign.id });
    await s.concepts.select(h.db, h.currentUser, labelId, campaign.id, concepts.concepts[0]!.id);
    await s.concepts.proposePlan(h.db, h.currentUser, { labelId, campaignId: campaign.id });
    await s.concepts.approvePlan(h.db, h.currentUser, labelId, campaign.id, null);
    await s.content.generate(h.db, h.currentUser, { labelId, campaignId: campaign.id });
    const produced = await s.content.list(h.db, h.currentUser, labelId, campaign.id);
    expect(produced.length).toBeGreaterThan(0);
    expect(produced.every((asset) => asset.reviewState !== 'needs_rereview')).toBe(true);

    // Nothing to catch up on yet: the campaign already sits on the current card.
    const settled = await s.campaigns.repointToCurrentCourse(h.db, h.currentUser, labelId, campaign.id);
    expect(settled.moved).toBe(false);
    expect(settled.briefsFlagged).toBe(0);

    // A corrected card is approved; the version the campaign points at is archived.
    const nextId = await nextCourseVersionDraft();
    await s.courses.approve(h.db, h.currentUser, labelId, nextId, null);
    const archived = await s.courses.requireVersion(h.db, labelId, courseVersionId);
    expect(archived.reviewState).toBe('archived');

    // The flagger now has a caller: content resting on the archived card is
    // marked in the same commit, instead of staying "Goedgekeurd" until the
    // export gate refused it for a reason that pointed at the wrong thing.
    const afterApprove = await s.content.list(h.db, h.currentUser, labelId, campaign.id);
    expect(afterApprove.some((asset) => asset.reviewState === 'needs_rereview')).toBe(true);

    // Before the fix this was the dead end: the gate refuses, naming approval.
    const blocked = await s.exports.evaluateGates(h.db, h.currentUser, labelId, campaign.id);
    expect(blocked.passed).not.toContain('course_version_confirmed');

    const moved = await s.campaigns.repointToCurrentCourse(h.db, h.currentUser, labelId, campaign.id);
    expect(moved.moved).toBe(true);
    expect(moved.toVersion).toBeGreaterThan(moved.fromVersion);
    expect(moved.briefsFlagged).toBeGreaterThan(0);

    const after = await s.campaigns.requireById(h.db, labelId, campaign.id);
    expect(after.courseVersionId).toBe(nextId);

    // The briefing rested on facts from the old card, so it is not silently carried over.
    const [storedBrief] = await h.db.select().from(briefVersions).where(eq(briefVersions.id, brief.id));
    expect(storedBrief?.reviewState).toBe('needs_rereview');

    // And the gate that blocked before now passes on the course card.
    const open = await s.exports.evaluateGates(h.db, h.currentUser, labelId, campaign.id);
    expect(open.passed).toContain('course_version_confirmed');
  });

  it('refuses for a label whose card is not approved, and is scoped to its own label', async () => {
    const s = h.appContext.services;
    const campaign = await s.campaigns.create(h.db, h.currentUser, labelId, createCampaignInput.parse({
      name: 'Scope-test (Demo)',
      entryMode: 'start_from_briefing',
      objective: 'consideration',
      courseVersionId: (await s.courses.approvedForSameCourse(h.db, labelId, courseVersionId))!.id,
      suppliedBrief: 'Een tweede campagne om de afscherming te toetsen.',
    }));

    const other = labelIdBySlug(h.seed, 'demolabel-2');
    const foreign = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${other}/campaigns/${campaign.id}/course-version`,
      payload: {},
    });
    expect([403, 404]).toContain(foreign.statusCode);

    const own = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/campaigns/${campaign.id}/course-version`,
      payload: {},
    });
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json<{ moved: boolean }>().moved).toBe(false);
  });
});
