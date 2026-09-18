import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createCampaignInput, isImplementedJobType } from '@c360/contracts';
import { courseVersions } from '../../src/core/db/schema.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * Content that belongs to no campaign.
 *
 * Until 2026-09-15 every piece had to be born inside one: `campaign_id`,
 * `brief_version_id` and `concept_version_id` were all NOT NULL. So a blog
 * article straight out of an AI-visibility finding could not exist — the
 * research already wrote one, but it stayed a field in a JSON report with no
 * version, no review state and no export.
 *
 * What a standalone piece keeps is what makes it safe: a confirmed course
 * version, an approved brand version, the same house-style checks and the same
 * review state. What it drops is the briefing, the concept and the plan.
 */
describe('a piece of content without a campaign', () => {
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

  it('writes for the chosen audience, and records which one', async () => {
    const s = h.appContext.services;
    /*
     * A loose piece had no audience at all: the prompt received an empty list
     * and every piece was written for the course in general. The persona now
     * travels to the model and is recorded on the asset, so what it was written
     * for is still knowable months later (2026-09-17).
     */
    const proposed = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId });
    const persona = proposed.personas[0];
    expect(persona).toBeDefined();
    await s.personas.approve(h.db, h.currentUser, labelId, persona!.id);

    const generate = vi.spyOn(s.generation, 'generate');
    const asset = await s.content.generateStandalone(h.db, h.currentUser, {
      labelId,
      courseVersionId,
      // Not a blog article: the mock writes the same text per channel, and a
      // second one would be refused as a repeat of the piece above rather than
      // for anything to do with the audience.
      channel: 'email',
      funnelStage: 'discover',
      angleNl: 'Schrijf een mail voor deze doelgroep over regie op een verzuimdossier.',
      personaVersionId: persona!.id,
      origin: { kind: 'manual', refId: null },
    });

    expect(asset.personaVersionIds).toEqual([persona!.id]);
    // The context carries the persona's content, not its id — so the check is
    // that this audience's own words reached the model, not that a field was set.
    const context = generate.mock.calls[0]![1].context;
    expect(context.personas?.map((entry) => entry.name)).toEqual([persona!.name]);
    expect(context.personas?.[0]?.need).toBe(persona!.need);
    generate.mockRestore();
  });

  it('refuses an audience that does not belong to this label', async () => {
    const s = h.appContext.services;
    // Scoped lookup, so a persona of another label cannot be written for — and
    // the refusal is explicit rather than a piece quietly written for nobody.
    await expect(
      s.content.generateStandalone(h.db, h.currentUser, {
        labelId,
        courseVersionId,
        channel: 'course_page_update',
        funnelStage: null,
        angleNl: 'Schrijf iets over regie op verzuim voor een onbekende doelgroep.',
        personaVersionId: randomUUID(),
        origin: { kind: 'manual', refId: null },
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('is produced, versioned and listed, with its origin kept', async () => {
    const s = h.appContext.services;
    const asset = await s.content.generateStandalone(h.db, h.currentUser, {
      labelId,
      courseVersionId,
      channel: 'blog_article',
      funnelStage: 'discover',
      angleNl:
        'Schrijf een artikel over wat er komt kijken bij regie op een verzuimdossier, vanuit de vraag van iemand die de rol er net bij heeft gekregen.',
      origin: { kind: 'geo_report', refId: null },
    });

    expect(asset.campaignId).toBeNull();
    expect(asset.ownerScope).toBe('standalone');
    // The provenance travels with the piece: this is the one thing every tool
    // in the market drops at the hand-off from research to draft.
    expect(asset.originKind).toBe('geo_report');
    expect(asset.briefVersionId).toBeNull();
    expect(asset.conceptVersionId).toBeNull();
    // The grounding is not dropped.
    expect(asset.courseVersionId).toBe(courseVersionId);
    expect(asset.brandProfileVersionId.length).toBeGreaterThan(0);
    expect(asset.version).toBe(1);
    expect(asset.reviewState).toBe('draft');
    expect(asset.copy.body.length).toBeGreaterThan(0);
    // A blog article is text on every channel configuration: it declares no
    // image size, so asking for one would invent a dimension nothing enforces.
    expect(asset.variants).toEqual([]);

    const listed = await s.content.listStandalone(h.db, h.currentUser, labelId);
    expect(listed.map((item) => item.id)).toContain(asset.id);
  });

  /**
   * An image channel gets an image.
   *
   * It did not until 2026-09-15: a standalone piece was stored with
   * `withImage: false` because the render layer read its layout and art
   * direction off the chosen concept, and a loose piece has none. An Instagram
   * post without a picture is not an Instagram post, so the render layer now
   * takes a *descriptor* — which a campaign fills from its concept and brief,
   * and a loose piece fills from the requester's own instruction.
   *
   * The two version columns stay null, which is the point: the descriptor is
   * not a concept, and nothing pretends there is a row behind it.
   */
  it('renders two image variants for an image channel, without inventing a concept', async () => {
    const s = h.appContext.services;
    const asset = await s.content.generateStandalone(h.db, h.currentUser, {
      labelId,
      courseVersionId,
      // A different image channel from the revision case below: the mock
      // provider writes one deterministic piece per channel, so two loose
      // pieces on the *same* channel trip the repetition check that exists to
      // keep real output from repeating itself.
      channel: 'facebook_organic',
      funnelStage: 'discover',
      angleNl:
        'Een bericht over het moment waarop een verzuimdossier van losse gesprekken naar één lijn gaat.',
      origin: { kind: 'manual', refId: null },
    });

    expect(asset.channel).toBe('facebook_organic');
    expect(asset.variants).toHaveLength(2);
    expect(asset.variants.map((variant) => variant.variant)).toEqual(['A', 'B']);
    for (const variant of asset.variants) {
      expect(variant.spec.widthPx).toBeGreaterThan(0);
      expect(variant.spec.heightPx).toBeGreaterThan(0);
    }
    // No campaign, so no concept and no briefing to point at.
    expect(asset.conceptVersionId).toBeNull();
    expect(asset.briefVersionId).toBeNull();
    expect(asset.campaignId).toBeNull();
  });

  /**
   * The request queues the work; it does not do it.
   *
   * Writing a piece — and, for an image channel, rendering two variants of
   * it — takes minutes, and until 2026-09-15 the requester held an open HTTP
   * connection for all of it. They get a job back, and the interface tells them
   * when it has landed.
   */
  it('queues the work and answers with a job instead of holding the request open', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/content/standalone`,
      payload: {
        courseVersionId,
        channel: 'blog_article',
        stage: 'consider',
        angleNl:
          'Een artikel over wat een casemanager op de eerste dag van een dossier vastlegt, en waarom.',
        originKind: 'manual',
      },
    });

    expect(response.statusCode).toBe(202);
    const job = response.json<{ id: string; type: string; status: string; labelId: string }>();
    expect(job.type).toBe('content.standalone');
    expect(job.labelId).toBe(labelId);
    expect(['queued', 'running']).toContain(job.status);

    // And the job is one a deployed worker really has a handler for; enqueuing
    // a type nothing implements would leave the user watching a bar forever.
    expect(isImplementedJobType('content.standalone')).toBe(true);
  });

  it('can be edited by hand, which versions it like any other piece', async () => {
    const s = h.appContext.services;
    const asset = await s.content.generateStandalone(h.db, h.currentUser, {
      labelId,
      courseVersionId,
      channel: 'linkedin_organic',
      funnelStage: 'consider',
      angleNl: 'Een kort bericht over het verschil tussen meedenken en verantwoordelijk zijn bij een verzuimdossier.',
      origin: { kind: 'manual', refId: null },
    });

    const edited = await s.content.editCopy(h.db, h.currentUser, labelId, asset.id, {
      copy: { hook: 'Met de hand herschreven kop' },
      expectedVersion: asset.version,
    });
    expect(edited.version).toBe(asset.version + 1);
    expect(edited.copy.hook).toBe('Met de hand herschreven kop');
    expect(edited.campaignId).toBeNull();

    // The list shows the newest version, once.
    const listed = await s.content.listStandalone(h.db, h.currentUser, labelId);
    const mine = listed.filter((item) => item.assetKey === asset.assetKey);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.version).toBe(edited.version);
  });

  it('can be attached to a campaign afterwards, but only one about the same course', async () => {
    const s = h.appContext.services;
    const asset = await s.content.generateStandalone(h.db, h.currentUser, {
      labelId,
      courseVersionId,
      // A different channel from the piece above: two standalone pieces of one
      // label are checked against each other for repetition, exactly as two
      // pieces of one campaign are.
      channel: 'facebook_organic',
      funnelStage: null,
      angleNl: 'Een los bericht dat later bij een campagne kan horen, over samenwerking rond een verzuimdossier.',
      origin: { kind: 'manual', refId: null },
    });
    const campaign = await s.campaigns.create(
      h.db,
      h.currentUser,
      labelId,
      createCampaignInput.parse({
        name: 'Koppeldoel (Demo)',
        entryMode: 'start_from_briefing',
        objective: 'consideration',
        courseVersionId,
        suppliedBrief: 'Laat professionals de opleiding vergelijken en bekijken.',
      }),
    );

    const attached = await s.content.attachToCampaign(h.db, h.currentUser, labelId, asset.id, campaign.id);
    expect(attached.campaignId).toBe(campaign.id);
    expect(attached.ownerScope).toBe('campaign');

    // It has left the standalone list and joined the campaign's.
    const loose = await s.content.listStandalone(h.db, h.currentUser, labelId);
    expect(loose.map((item) => item.id)).not.toContain(asset.id);
    const inCampaign = await s.content.list(h.db, h.currentUser, labelId, campaign.id);
    expect(inCampaign.map((item) => item.assetKey)).toContain(asset.assetKey);

    // A second attach is refused rather than silently moving it, which is the
    // mistake HubSpot makes: adding to one campaign removes it from another.
    await expect(
      s.content.attachToCampaign(h.db, h.currentUser, labelId, asset.id, campaign.id),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses an AI revision, because there is no briefing to rewrite against', async () => {
    const s = h.appContext.services;
    const asset = await s.content.generateStandalone(h.db, h.currentUser, {
      labelId,
      courseVersionId,
      channel: 'instagram_organic',
      funnelStage: 'discover',
      angleNl: 'Een los beeldbericht over het moment waarop verzuim jouw taak wordt, zonder verkooppraat.',
      origin: { kind: 'manual', refId: null },
    });

    await expect(
      s.content.revise(h.db, h.currentUser, labelId, asset.id, {
        instructionNl: 'Maak het korter.',
        expectedVersion: asset.version,
        scope: 'copy',
      }),
    ).rejects.toMatchObject({ code: 'capability_unavailable' });
  });
});
