import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createCampaignInput } from '@c360/contracts';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';
import { researchRuns, sources } from '../../src/core/db/schema.js';

/**
 * "A source changed — what does that touch?" (P4-3)
 *
 * Per-campaign staleness already existed and gates a publish-ready export. What
 * is tested here is the inverse and wider question, across a label's campaigns
 * at once, and the two things that make the answer trustworthy: the link from a
 * changed source to the findings it produced is a **foreign key** rather than a
 * text match, and the report says how *exposed* each campaign is rather than
 * whether its content is wrong.
 */
describe('source-change impact across campaigns', () => {
  let h: TestHarness;
  let root: string;
  let labelId: string;
  let campaignId: string;
  let courseVersionId: string;
  let sourceId: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'c360-impact-'));
    h = await createTestHarness({ envOverrides: { STORAGE_ROOT: root } });
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    courseVersionId = h.seed.pilot.courseVersionId ?? '';

    const campaign = await h.appContext.services.campaigns.create(
      h.db,
      h.currentUser,
      labelId,
      createCampaignInput.parse({
        name: 'Impact-test (Demo)',
        entryMode: 'discover_opportunities',
        courseVersionId,
      }),
    );
    campaignId = campaign.id;

    /*
     * The seed registers no source, so the test builds its own precondition.
     *
     * A page source and one completed research run that recorded a hash for
     * it: without a recorded hash a later change is *unknowable* rather than
     * absent, and the report would correctly say nothing — which would make
     * this test pass for the wrong reason.
     */
    const source = await h.appContext.services.research.addSource(h.db, h.currentUser, labelId, {
      kind: 'reference_page',
      // `example.org` rather than `example.test`: the URL guard refuses
      // special-use domains at registration, which is correct of it.
      url: 'https://www.example.org/achtergrond',
      title: 'Achtergrondpagina (Demo)',
      timeSensitivity: 'medium',
    });
    sourceId = source.id;

    await h.db.insert(researchRuns).values({
      organizationId: h.currentUser.organizationId,
      labelId,
      courseVersionId,
      version: 1,
      status: 'completed',
      sourcesSnapshot: [
        {
          sourceId,
          contentSha256: 'a'.repeat(64),
          retrievedAt: new Date('2027-01-01T00:00:00.000Z').toISOString(),
          failureNl: null,
        },
      ],
      findingCount: 0,
      createdByUserId: h.currentUser.userId,
    });
    await h.db
      .update(sources)
      .set({ contentSha256: 'a'.repeat(64) })
      .where(eq(sources.id, sourceId));
  });

  afterAll(async () => {
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  const report = async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/source-impact`,
    });
    expect(response.statusCode).toBe(200);
    return response.json<{
      changedSources: { sourceId: string; title: string; detailNl: string }[];
      campaigns: {
        campaignId: string;
        exposure: string;
        severity: string;
        reasonsNl: string[];
        affectedFindings: { claim: string }[];
      }[];
    }>();
  };

  it('lists nothing to act on while every source is as it was read', async () => {
    /*
     * A campaign with nothing stale behind it is left out entirely. A report
     * that lists every campaign as "fine" is a report nobody opens twice, and
     * the emptiness *is* the finding.
     */
    const initial = await report();
    expect(initial.changedSources).toEqual([]);
    expect(initial.campaigns.map((item) => item.campaignId)).not.toContain(campaignId);
  });

  it('names the campaign, its exposure and the changed source once a source moves', async () => {
    /*
     * The source's content moves.
     *
     * Rewritten directly rather than by re-fetching a page: the property under
     * test is the hash comparison, and driving it through a real fetch would
     * make the test depend on somebody else's page changing.
     */
    await h.db
      .update(sources)
      .set({ contentSha256: 'b'.repeat(64) })
      .where(eq(sources.id, sourceId));

    const after = await report();

    expect(after.changedSources.map((item) => item.sourceId)).toContain(sourceId);
    expect(after.changedSources[0]?.detailNl).toMatch(/is gewijzigd sinds het onderzoek/u);

    const impacted = after.campaigns.find((item) => item.campaignId === campaignId);
    expect(impacted).toBeDefined();
    // Nothing has been approved or exported, so regenerating is enough.
    expect(impacted?.exposure).toBe('draft');
    expect(impacted?.severity).toBe('low');
    // The exposure sentence comes first: it decides whether this needs
    // attention today or at the next review.
    expect(impacted?.reasonsNl[0]).toMatch(/Opnieuw genereren/u);
    expect(impacted?.reasonsNl.length).toBeGreaterThan(1);
  });

  it('never says the content is wrong', async () => {
    /*
     * A changed page may have had a typo fixed. The report says what rests on
     * the change; it does not adjudicate the claim, because sending people to
     * retract material over a corrected comma is worse than saying nothing.
     */
    const after = await report();
    const text = [
      ...after.changedSources.map((item) => item.detailNl),
      ...after.campaigns.flatMap((item) => item.reasonsNl),
    ].join(' ');
    expect(text).not.toMatch(/onjuist|verkeerd|niet waar|klopt niet/iu);
  });

  it('refuses the report to a label the caller cannot read', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/v1/labels/00000000-0000-4000-8000-000000000000/source-impact',
    });
    expect([403, 404]).toContain(response.statusCode);
  });
});
