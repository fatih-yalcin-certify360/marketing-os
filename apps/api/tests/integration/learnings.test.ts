import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LightMyRequestResponse } from 'fastify';
import { eq } from 'drizzle-orm';
import { createCampaignInput } from '@c360/contracts';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';
import { brandProfileVersions, personaVersions } from '../../src/core/db/schema.js';

/**
 * Learnings, and the two things P4-2 says they must not do (P4-2).
 *
 *  1. **No causality claims from thin data.** The system writes no conclusions;
 *     it stores what a person wrote and states how much evidence is behind it.
 *     The arithmetic of that is unit-tested in `contracts/tests/learnings.test.ts`;
 *     what is tested here is that the summary actually reaches the prompt, with
 *     its thinness intact.
 *  2. **No automatic persona or brand changes.** The strongest test available:
 *     snapshot every persona and brand row, approve a learning, and assert
 *     nothing moved.
 */
describe('learnings', () => {
  let h: TestHarness;
  let root: string;
  let labelId: string;
  let campaignId: string;
  const outcomeIds: string[] = [];

  const valid = {
    observationNl: 'De variant met een vraag als kop kreeg meer doorkliks dan de variant zonder.',
    hypothesisNl: 'Een vraag in de kop spreekt mensen aan die zich nog aan het oriënteren zijn.',
    nextTestNl: 'Zelfde opzet een campagne later, met de kopvormen omgedraaid.',
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'c360-learning-'));
    h = await createTestHarness({ envOverrides: { STORAGE_ROOT: root } });
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');

    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    const courseVersionId = h.seed.pilot.courseVersionId;
    if (courseVersionId === undefined || courseVersionId === null) {
      throw new Error('the seed no longer provides a pilot course version');
    }
    const campaign = await s.campaigns.create(
      db,
      user,
      labelId,
      createCampaignInput.parse({
        name: 'Lessen-test (Demo)',
        entryMode: 'discover_opportunities',
        courseVersionId,
      }),
    );
    campaignId = campaign.id;

    // Two measured outcomes to cite, from one campaign — deliberately thin.
    for (const period of [
      ['2027-02-01', '2027-02-07'],
      ['2027-02-08', '2027-02-14'],
    ] as const) {
      const record = await s.outcomes.recordOutcome(db, user, labelId, campaignId, {
        channel: 'linkedin_organic',
        publicationRecordId: null,
        periodStart: period[0],
        periodEnd: period[1],
        impressions: 1_000,
        clicks: 40,
        signups: null,
        spendCents: null,
        source: 'manual_entry',
        reportAssetId: null,
        noteNl: null,
      });
      outcomeIds.push(record.id);
    }
  });

  afterAll(async () => {
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  const post = async (
    path: string,
    payload: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> =>
    h.app.inject({ method: 'POST', url: `/api/v1/labels/${labelId}${path}`, payload });

  it('is created as a draft, so nothing just typed influences the next proposal', async () => {
    const response = await post('/learnings', { ...valid, outcomeReportIds: outcomeIds });
    expect(response.statusCode).toBe(201);
    const created = response.json<{ reviewState: string; approvedAt: string | null }>();
    expect(created.reviewState).toBe('draft');
    expect(created.approvedAt).toBeNull();
  });

  it('reports how thin the evidence is, in Dutch, alongside the claim', async () => {
    const listed = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/learnings`,
    });
    const [first] = listed.json<{
      items: { evidence: { outcomeCount: number; campaignCount: number; isThin: boolean; reasonsNl: string[] } }[];
    }>().items;

    expect(first?.evidence.outcomeCount).toBe(2);
    expect(first?.evidence.campaignCount).toBe(1);
    // Two measurements from one campaign over a fortnight is not a pattern.
    expect(first?.evidence.isThin).toBe(true);
    expect(first?.evidence.reasonsNl.join(' ')).toMatch(/één campagne/u);
  });

  it('refuses evidence from another label rather than accepting the rest', async () => {
    /*
     * A learning resting on three outcomes of which one belongs elsewhere is
     * not "mostly right" — it is a claim about data we cannot see. So the list
     * is refused whole.
     */
    const response = await post('/learnings', {
      ...valid,
      outcomeReportIds: [...outcomeIds, '00000000-0000-4000-8000-000000000000'],
    });
    expect(response.statusCode).toBe(404);
  });

  it('changes no persona and no brand rule when a learning is approved', async () => {
    /*
     * The second constraint of P4-2, tested the only way that means anything:
     * snapshot the tables that must not move, approve, and compare.
     *
     * A comment promising "this does not touch personas" is worth nothing next
     * to a diff of the rows.
     */
    const { db } = h;
    const personasBefore = await db.select().from(personaVersions).where(eq(personaVersions.labelId, labelId));
    const brandBefore = await db
      .select()
      .from(brandProfileVersions)
      .where(eq(brandProfileVersions.labelId, labelId));

    const created = await post('/learnings', { ...valid, outcomeReportIds: outcomeIds });
    const { id } = created.json<{ id: string }>();
    const approved = await post(`/learnings/${id}/approve`, {});

    expect(approved.statusCode).toBe(200);
    const record = approved.json<{ reviewState: string; approvedByUserId: string | null }>();
    expect(record.reviewState).toBe('approved');
    // Who approved it: a learning influences later work, so that is a decision
    // with a name on it.
    expect(record.approvedByUserId).not.toBeNull();

    const personasAfter = await db.select().from(personaVersions).where(eq(personaVersions.labelId, labelId));
    const brandAfter = await db
      .select()
      .from(brandProfileVersions)
      .where(eq(brandProfileVersions.labelId, labelId));
    expect(personasAfter).toEqual(personasBefore);
    expect(brandAfter).toEqual(brandBefore);
  });

  it('hands only approved learnings to a proposal, with their thinness attached', async () => {
    /*
     * The feeding half of the item, observed at the boundary: what the model is
     * actually told. A draft must not appear, and an approved one must arrive
     * with the evidence sentence — a hypothesis handed over without its
     * thinness reads as settled.
     */
    const { db, currentUser: user } = h;
    const draft = await post('/learnings', {
      ...valid,
      observationNl: 'Deze waarneming hoort bij een les die nog niet is goedgekeurd.',
      outcomeReportIds: [],
    });
    expect(draft.statusCode).toBe(201);

    const spy = vi.spyOn(h.appContext.services.generation, 'generate');
    let handed: { observationNl: string; evidenceNl: string }[];
    try {
      // Assigned inside the try; if `propose` throws, the test fails there and
      // there is nothing to assert about.
      await h.appContext.services.personas.propose(db, user, {
        labelId,
        courseVersionId: h.seed.pilot.courseVersionId ?? '',
      });
      /*
       * Read *before* restoring the spy.
       *
       * `mockRestore` clears the recorded calls as well as restoring the
       * original method, so inspecting `spy.mock.calls` after the `finally`
       * reports zero — which looked exactly like "the learnings never reached
       * the prompt" and cost a debugging detour.
       */
      const call = spy.mock.calls[0]?.[1] as
        | { context: { learnings?: { observationNl: string; evidenceNl: string }[] } }
        | undefined;
      handed = [...(call?.context.learnings ?? [])];
    } finally {
      spy.mockRestore();
    }

    expect(handed.length).toBeGreaterThan(0);
    // The draft is absent.
    expect(handed.some((item) => item.observationNl.includes('nog niet is goedgekeurd'))).toBe(false);
    // And every approved one carries its evidence.
    for (const item of handed) {
      expect(item.evidenceNl.length).toBeGreaterThan(0);
    }
    expect(handed.some((item) => item.evidenceNl.includes('Dun onderbouwd'))).toBe(true);
  });
});
