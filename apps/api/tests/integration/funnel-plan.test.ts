import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FUNNEL_STAGES,
  PRODUCIBLE_CHANNELS,
  buildCampaignCalendar,
  channelFit,
  confirmedFacts,
  createCampaignInput,
  stagesForObjective,
  type MarketingChannel,
} from '@c360/contracts';
import { planProblems } from '../../src/modules/concepts/service.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * The funnel in the campaign chain (campaign-flow-design.md, slice 1).
 *
 * A campaign now knows what it is for, the plan says which channel serves
 * which stage and why, and content is written per stage. These tests walk the
 * real chain on the mock provider and hold the properties that make the change
 * more than a label: stages come from the objective, advice rests on the rule
 * table and cannot carry a figure, every piece of content knows its stage, and
 * a person may still choose to make everything.
 */
describe('a full-funnel campaign in the chain', () => {
  let h: TestHarness;
  let root: string;
  let labelId: string;
  let campaignId: string;
  let personaVersionIds: string[] = [];

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'c360-funnel-'));
    h = await createTestHarness({ envOverrides: { STORAGE_ROOT: root } });
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');

    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    const courseVersionId = h.seed.pilot.courseVersionId;
    if (courseVersionId === undefined || courseVersionId === null) {
      throw new Error('the seed no longer provides a pilot course version');
    }
    const proposed = await s.personas.propose(db, user, { labelId, courseVersionId });
    personaVersionIds = proposed.personas.map((persona) => persona.id);
    for (const id of personaVersionIds) {
      await s.personas.approve(db, user, labelId, id);
    }
    const campaign = await s.campaigns.create(
      db,
      user,
      labelId,
      createCampaignInput.parse({
        name: 'Funnel-test (Demo)',
        entryMode: 'discover_opportunities',
        objective: 'full_funnel',
        courseVersionId,
      }),
    );
    campaignId = campaign.id;
    const brief = await s.campaigns.draftBrief(db, user, { labelId, campaignId, personaVersionIds });
    await s.campaigns.approveBrief(db, user, labelId, campaignId, brief.id, null);
    const concepts = await s.concepts.propose(db, user, { labelId, campaignId });
    const first = concepts.concepts[0];
    if (first === undefined) {
      throw new Error('no concept was proposed');
    }
    await s.concepts.select(db, user, labelId, campaignId, first.id);
    await s.concepts.proposePlan(db, user, { labelId, campaignId });
  });

  afterAll(async () => {
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  it('records the objective on the campaign', async () => {
    const campaign = await h.appContext.services.campaigns.requireById(h.db, labelId, campaignId);
    expect(campaign.objective).toBe('full_funnel');
  });

  it('plans every stage the objective covers, each item with a stage', async () => {
    const latest = await h.appContext.services.concepts.latestPlan(h.db, campaignId);
    expect(latest).toBeDefined();
    const plan = latest!.plan;

    const stages = new Set(plan.items.map((item) => item.stage));
    for (const stage of stagesForObjective('full_funnel')) {
      expect([...stages], stage).toContain(stage);
    }
    expect(plan.items.every((item) => item.stage !== null)).toBe(true);
  });

  it('argues every planned cell from the rule table, without a figure in sight', async () => {
    const latest = await h.appContext.services.concepts.latestPlan(h.db, campaignId);
    const plan = latest!.plan;

    expect(plan.channelAdvice.length).toBeGreaterThan(0);
    for (const advice of plan.channelAdvice) {
      // Layer one is ours and must be quoted exactly.
      expect(advice.ruleVerdict).toBe(channelFit(advice.stage, advice.channel).verdict);
      // Layer two may move one step, never further.
      expect(
        Math.abs(rank(advice.ruleVerdict) - rank(advice.advisedVerdict)),
        `${advice.stage}/${advice.channel}`,
      ).toBeLessThanOrEqual(1);
      // No reach, click, cost or conversion figure — the shape has no field
      // for one and the reasoning must not smuggle one in as prose.
      expect(advice.reasoningNl).not.toMatch(/\d+\s*%|\bcpc\b|\bctr\b/iu);
    }

    // Every planned item has advice for its cell, so nothing is planned
    // without an argument next to it.
    for (const item of plan.items) {
      expect(
        plan.channelAdvice.some((a) => a.stage === item.stage && a.channel === item.channel),
        `${String(item.stage)}/${item.channel}`,
      ).toBe(true);
    }
    // And the mock, like the prompt asks of a real model, plans nothing for
    // a discouraged cell: search in the discovery stage is the clearest case.
    expect(
      plan.items.some((item) => item.stage === 'discover' && item.channel === 'google_search_ads'),
    ).toBe(false);
  });

  it('writes content per stage: one piece per planned cell, keyed by stage and channel', async () => {
    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    await s.concepts.approvePlan(db, user, labelId, campaignId, null);
    const { plan } = await s.concepts.requireApprovedPlan(db, campaignId);

    const result = await s.content.generate(db, user, { labelId, campaignId });
    expect(result.assets).toHaveLength(plan.items.length);

    for (const item of plan.items) {
      const asset = result.assets.find(
        (candidate) => candidate.funnelStage === item.stage && candidate.channel === item.channel,
      );
      expect(asset, `${String(item.stage)}/${item.channel}`).toBeDefined();
      expect(asset?.assetKey).toBe(`${String(item.stage)}-${item.channel}-1`);
    }

    /*
     * The point of the whole change: the same channel says something
     * different in different stages. The landing page is planned for every
     * stage, so it is the cleanest comparison.
     */
    const pages = result.assets.filter((asset) => asset.channel === 'course_page_update' || asset.channel === 'blog_article');
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const hooks = new Set(pages.map((asset) => asset.copy.hook));
    expect(hooks.size).toBe(pages.length);
  });

  it('lets a person make every creative anyway, keeping the advice beside the choice', async () => {
    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    const before = await s.concepts.requireApprovedPlan(db, campaignId);

    /*
     * Everything a person may tick — which is everything except the same page
     * twice.
     *
     * Advice is not a gate anywhere in this product: a discouraged cell can be
     * chosen with the advice still beside it. The course page is the one
     * exception, and it is not taste: it is a single object, so two change sets
     * for it cannot both be applied and one of them would silently lose. That
     * is a contradiction rather than an opinion, so it is refused — see the
     * test below (2026-09-16).
     */
    const everything = FUNNEL_STAGES.flatMap((stage) =>
      PRODUCIBLE_CHANNELS.filter(
        (channel) => channel !== 'course_page_update' || stage === 'consider',
      ).map((channel) => ({ stage, channel, count: 1, withImage: false })),
    );
    const approved = await s.concepts.approvePlan(db, user, labelId, campaignId, {
      items: everything,
      cadenceNl: before.plan.cadenceNl,
      rationaleNl: before.plan.rationaleNl,
      // The client sends the advice back unchanged; an empty list would also
      // keep the previous version's advice — and the measurement plan travels
      // the same way.
      channelAdvice: [],
      measurementPlan: [],
    });

    expect(approved.version).toBe(before.version + 1);
    expect(approved.plan.items).toHaveLength(everything.length);

    const stored = await s.concepts.requireApprovedPlan(db, campaignId);
    expect(stored.plan.channelAdvice).toEqual(before.plan.channelAdvice);
    expect(stored.plan.measurementPlan).toEqual(before.plan.measurementPlan);
  });

  it('refuses to plan the one course page more than once, and says why', async () => {
    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    const before = await s.concepts.requireApprovedPlan(db, campaignId);

    /*
     * Three stages each asking for a change to the same page produces three
     * change sets, and applying them all leaves the page in whichever state was
     * applied last. The stages do each want something different from the page —
     * the answer to that is several changes inside one proposal, not three
     * proposals.
     */
    await expect(
      s.concepts.approvePlan(db, user, labelId, campaignId, {
        items: FUNNEL_STAGES.map((stage) => ({
          stage,
          channel: 'course_page_update' as const,
          count: 1,
          withImage: false,
        })),
        cadenceNl: before.plan.cadenceNl,
        rationaleNl: before.plan.rationaleNl,
        channelAdvice: [],
        measurementPlan: [],
      }),
    ).rejects.toThrow(/opleidingspagina staat 3 keer/u);
  });

  it('briefs every stage the objective covers, citing confirmed proof only (slice 2)', async () => {
    const s = h.appContext.services;
    const brief = await s.campaigns.requireApprovedBrief(h.db, campaignId);
    const campaign = await s.campaigns.requireById(h.db, labelId, campaignId);
    const course = await s.courses.requireVersion(h.db, labelId, campaign.courseVersionId);
    const confirmed = new Set(confirmedFacts(course));

    expect(new Set(brief.stageMessages.map((message) => message.stage))).toEqual(
      new Set(stagesForObjective('full_funnel')),
    );
    for (const message of brief.stageMessages) {
      expect(message.coreMessageNl.length).toBeGreaterThan(10);
      expect(message.ctaNl.length).toBeGreaterThan(2);
      // The demo card has unconfirmed facts; none may be cited as proof.
      for (const field of message.proofFields) {
        expect(confirmed.has(field), `${message.stage} cites ${field}`).toBe(true);
      }
    }
    // Three stages, three different things to say.
    expect(new Set(brief.stageMessages.map((message) => message.coreMessageNl)).size).toBe(3);
  });

  it('advises on every producible channel, plans only the briefing channels, measures every stage (R-2, R-7)', async () => {
    const s = h.appContext.services;
    // A fresh proposal: the approved plan above is a person's "everything"
    // edit, and this is about what the *model* proposes.
    const { plan } = await s.concepts.proposePlan(h.db, h.currentUser, { labelId, campaignId });
    const brief = await s.campaigns.requireApprovedBrief(h.db, campaignId);

    const advised = new Set(plan.channelAdvice.map((advice) => advice.channel));
    expect(advised).toEqual(new Set(PRODUCIBLE_CHANNELS));
    expect(plan.channelAdvice).toHaveLength(FUNNEL_STAGES.length * PRODUCIBLE_CHANNELS.length);

    for (const item of plan.items) {
      expect(brief.channelSuggestions, `${item.channel} is not in the brief`).toContain(item.channel);
    }

    expect(new Set(plan.measurementPlan.map((entry) => entry.stage))).toEqual(new Set(FUNNEL_STAGES));
    for (const entry of plan.measurementPlan) {
      // No target, no forecast: the shape has no field for one and the text
      // must not smuggle a percentage in.
      expect(Object.keys(entry).sort()).toEqual(['decisionRuleNl', 'indicatorNl', 'sourceNl', 'stage']);
      expect(`${entry.indicatorNl} ${entry.decisionRuleNl}`).not.toMatch(/\d+\s*%/u);
    }
  });

  it('writes each stage from the briefing\'s own message for that stage (slice 2)', async () => {
    const s = h.appContext.services;
    const brief = await s.campaigns.requireApprovedBrief(h.db, campaignId);
    const assets = await s.content.list(h.db, h.currentUser, labelId, campaignId);
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      const message = brief.stageMessages.find((entry) => entry.stage === asset.funnelStage);
      expect(message, String(asset.funnelStage)).toBeDefined();
      // The blog article opens with the reader's question by design
      // (blog-article-practice.md); the stage message shapes it but is not
      // quoted in it. Every other piece, the course-page change included,
      // leads with the stage's message.
      if (asset.channel === 'blog_article') continue;
      // The stage's message leads the body of every piece — that is the
      // hand-off this slice exists for — and the LinkedIn post opens with it.
      expect(asset.copy.body).toContain(message!.coreMessageNl.replace(/\s*\[Voorbeeldtekst.*$/u, ''));
      if (asset.channel === 'linkedin_organic') {
        expect(message!.coreMessageNl).toContain(asset.copy.hook.replace(/\s*\[Voorbeeldtekst.*$/u, ''));
      }
    }
    // Within a stage, every channel opens differently: one message, many
    // executions — never the same first line on four channels.
    for (const stage of new Set(assets.map((asset) => asset.funnelStage))) {
      const hooks = assets.filter((asset) => asset.funnelStage === stage).map((asset) => asset.copy.hook);
      expect(new Set(hooks).size).toBe(hooks.length);
    }
  });

  it('sequences the calendar by stage: Ontdekken before Overwegen before Beslissen (slice 3)', async () => {
    const s = h.appContext.services;
    const { plan } = await s.concepts.requireApprovedPlan(h.db, campaignId);
    const calendar = buildCampaignCalendar({
      plan,
      startDate: null,
      courseDates: [],
      courseDatesUnconfirmed: false,
    });
    const first = (stage: string): number =>
      Math.min(...calendar.slots.filter((slot) => slot.stage === stage).map((slot) => slot.offsetDays));
    expect(first('discover')).toBeLessThan(first('consider'));
    expect(first('consider')).toBeLessThan(first('decide'));
    // Every slot knows its stage, so the screen can say why it is where it is.
    expect(calendar.slots.every((slot) => slot.stage !== null)).toBe(true);
  });

  it('records a measured outcome per stage and refuses a stage outside the vocabulary (slice 3)', async () => {
    const s = h.appContext.services;
    const recorded = await s.outcomes.recordOutcome(h.db, h.currentUser, labelId, campaignId, {
      channel: 'email',
      funnelStage: 'consider',
      publicationRecordId: null,
      periodStart: '2027-03-01',
      periodEnd: '2027-03-07',
      impressions: null,
      clicks: 12,
      signups: null,
      spendCents: null,
      source: 'manual_entry',
      reportAssetId: null,
      noteNl: null,
    });
    expect(recorded.funnelStage).toBe('consider');

    const listed = await s.outcomes.listOutcomes(h.db, h.currentUser, labelId, campaignId);
    expect(listed.find((item) => item.id === recorded.id)?.funnelStage).toBe('consider');

    const refused = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/outcomes`,
      payload: { channel: 'email', funnelStage: 'growth', periodStart: '2027-03-01', periodEnd: '2027-03-07', clicks: 1, source: 'manual_entry' },
    });
    expect(refused.statusCode).toBe(422);
  });

  it('refuses an edited plan for a stage the objective does not cover', async () => {
    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    const courseVersionId = h.seed.pilot.courseVersionId!;
    // An awareness campaign covers Ontdekken only.
    const campaign = await s.campaigns.create(db, user, labelId, {
      name: 'Bekendheid-test (Demo)',
      entryMode: 'discover_opportunities',
      objective: 'awareness',
      courseVersionId,
    });
    const brief = await s.campaigns.draftBrief(db, user, {
      labelId,
      campaignId: campaign.id,
      personaVersionIds,
    });
    await s.campaigns.approveBrief(db, user, labelId, campaign.id, brief.id, null);
    const concepts = await s.concepts.propose(db, user, { labelId, campaignId: campaign.id });
    await s.concepts.select(db, user, labelId, campaign.id, concepts.concepts[0]!.id);
    const proposed = await s.concepts.proposePlan(db, user, { labelId, campaignId: campaign.id });

    // The model, given one stage, planned only that stage.
    expect(new Set(proposed.plan.items.map((item) => item.stage))).toEqual(new Set(['discover']));

    await expect(
      s.concepts.approvePlan(db, user, labelId, campaign.id, {
        items: [{ stage: 'decide', channel: 'email', count: 1, withImage: false }],
        cadenceNl: proposed.plan.cadenceNl,
        rationaleNl: proposed.plan.rationaleNl,
        channelAdvice: [],
        measurementPlan: [],
      }),
    ).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('sets an objective on a campaign that was created without one', async () => {
    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    const created = await s.campaigns.create(db, user, labelId, {
      name: 'Zonder doel (Demo)',
      entryMode: 'discover_opportunities',
      courseVersionId: h.seed.pilot.courseVersionId!,
    });
    expect(created.objective).toBeNull();

    const updated = await s.campaigns.setObjective(db, user, labelId, created.id, 'conversion');
    expect(updated.objective).toBe('conversion');
  });

  it('sets the objective over HTTP and refuses one outside the vocabulary', async () => {
    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    const created = await s.campaigns.create(db, user, labelId, {
      name: 'Zonder doel, via HTTP (Demo)',
      entryMode: 'discover_opportunities',
      courseVersionId: h.seed.pilot.courseVersionId!,
    });
    const url = `/api/v1/labels/${labelId}/campaigns/${created.id}/objective`;

    // Validation failures answer 422 throughout the API.
    const refused = await h.app.inject({ method: 'PATCH', url, payload: { objective: 'growth' } });
    expect(refused.statusCode).toBe(422);

    const response = await h.app.inject({ method: 'PATCH', url, payload: { objective: 'consideration' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: created.id, objective: 'consideration' });
  });
});

describe('planProblems', () => {
  const channels: readonly MarketingChannel[] = PRODUCIBLE_CHANNELS;

  it('accepts a plan inside its campaign', () => {
    expect(
      planProblems(
        {
          items: [
            { stage: 'discover', channel: 'linkedin_organic', count: 1, withImage: true },
            { stage: 'decide', channel: 'email', count: 1, withImage: false },
          ],
          channelAdvice: [],
        },
        FUNNEL_STAGES,
        channels,
      ),
    ).toEqual([]);
  });

  it('names a stage outside the objective, a stage-less item and a doubled cell', () => {
    const problems = planProblems(
      {
        items: [
          { stage: 'decide', channel: 'email', count: 1, withImage: false },
          { stage: null, channel: 'course_page_update', count: 1, withImage: false },
          { stage: 'discover', channel: 'linkedin_organic', count: 1, withImage: true },
          { stage: 'discover', channel: 'linkedin_organic', count: 1, withImage: false },
        ],
        channelAdvice: [],
      },
      ['discover'],
      channels,
    );
    expect(problems.some((p) => p.includes('"decide"'))).toBe(true);
    expect(problems.some((p) => p.includes('funnelfase'))).toBe(true);
    expect(problems.some((p) => p.includes('meer dan één keer'))).toBe(true);
  });

  it('names a channel the caller does not allow', () => {
    const problems = planProblems(
      {
        items: [{ stage: 'consider', channel: 'meta_ads', count: 1, withImage: false }],
        channelAdvice: [],
      },
      FUNNEL_STAGES,
      ['linkedin_organic', 'course_page_update'],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('meta_ads');
  });
});

function rank(verdict: 'recommended' | 'possible' | 'discouraged'): number {
  return { discouraged: 0, possible: 1, recommended: 2 }[verdict];
}
