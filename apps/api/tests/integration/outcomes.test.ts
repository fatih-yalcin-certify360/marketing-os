import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCampaignInput } from '@c360/contracts';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * Recording what happened (P4-1).
 *
 * This system measures nothing: it has no advertising account, no analytics
 * access and no measurement period. Every figure here was obtained by a person,
 * and `source` says how — read off an attached platform export, or typed in.
 * That field is what keeps a recorded number distinguishable from an invented
 * one, and the product invents none.
 *
 * So the tests worth having are mostly about **refusals**: what the schema, the
 * database and the service will not let a figure be.
 */
describe('publications and measured outcomes', () => {
  let h: TestHarness;
  let root: string;
  let labelId: string;
  let otherCampaignId: string;
  let campaignId: string;
  let assetId: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'c360-outcome-'));
    h = await createTestHarness({ envOverrides: { STORAGE_ROOT: root } });
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');

    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    const courseVersionId = h.seed.pilot.courseVersionId;
    if (courseVersionId === undefined || courseVersionId === null) {
      throw new Error('the seed no longer provides a pilot course version');
    }
    const proposed = await s.personas.propose(db, user, { labelId, courseVersionId });
    const personaVersionIds = proposed.personas.map((persona) => persona.id);
    for (const id of personaVersionIds) {
      await s.personas.approve(db, user, labelId, id);
    }
    const make = async (name: string): Promise<string> => {
      const campaign = await s.campaigns.create(
        db,
        user,
        labelId,
        createCampaignInput.parse({
          name,
          entryMode: 'discover_opportunities',
          courseVersionId,
        }),
      );
      return campaign.id;
    };
    campaignId = await make('Resultaten-test (Demo)');
    otherCampaignId = await make('Andere campagne (Demo)');

    const brief = await s.campaigns.draftBrief(db, user, { labelId, campaignId, personaVersionIds });
    await s.campaigns.approveBrief(db, user, labelId, campaignId, brief.id, null);
    const concepts = await s.concepts.propose(db, user, { labelId, campaignId });
    await s.concepts.select(db, user, labelId, campaignId, concepts.concepts[0]?.id ?? '');
    await s.concepts.proposePlan(db, user, { labelId, campaignId });
    await s.concepts.approvePlan(db, user, labelId, campaignId, null);
    const generated = await s.content.generate(db, user, { labelId, campaignId });
    assetId = generated.assets[0]?.id ?? '';
  });

  afterAll(async () => {
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  /*
   * Awaited inside the helper on purpose.
   *
   * `inject` returns a chainable object as well as a promise, so returning it
   * straight from an async function types the result as that intersection and
   * every `.statusCode` below stops compiling — while still working at
   * runtime. Awaiting here resolves it to the response.
   */
  const post = async (
    path: string,
    payload: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> =>
    h.app.inject({ method: 'POST', url: `/api/v1/labels/${labelId}${path}`, payload });

  it('records a publication and takes the channel from the content, not the caller', async () => {
    /*
     * The channel is a property of what was published. Accepting it as input
     * would let a LinkedIn post be recorded as an e-mail, and every figure
     * attached to it afterwards would be filed under the wrong channel.
     */
    const response = await post(`/campaigns/${campaignId}/publications`, {
      contentAssetVersionId: assetId,
      publishedAt: '2027-02-01T09:00:00.000Z',
      externalUrl: 'https://example.test/post/1',
      noteNl: 'Handmatig geplaatst.',
    });

    expect(response.statusCode).toBe(201);
    const record = response.json<{ channel: string; recordedByUserId: string | null }>();
    const assets = await h.appContext.services.content.list(h.db, h.currentUser, labelId, campaignId);
    expect(record.channel).toBe(assets.find((asset) => asset.id === assetId)?.channel);
    // Who recorded it, because "we published this" is a human claim.
    expect(record.recordedByUserId).not.toBeNull();
  });

  it('refuses a script URL as the published address', async () => {
    const response = await post(`/campaigns/${campaignId}/publications`, {
      contentAssetVersionId: assetId,
      publishedAt: '2027-02-01T09:00:00.000Z',
      externalUrl: 'javascript:alert(1)',
    });
    expect(response.statusCode).toBe(422);
  });

  it('refuses content from another campaign of the same label', async () => {
    /*
     * Both predicates matter. With only the label check, a publication could
     * point at content from a different campaign and quietly misattribute
     * every figure attached to it later.
     */
    const response = await post(`/campaigns/${otherCampaignId}/publications`, {
      contentAssetVersionId: assetId,
      publishedAt: '2027-02-01T09:00:00.000Z',
    });
    expect(response.statusCode).toBe(404);
  });

  it('records typed-in figures with their period and provenance', async () => {
    const response = await post(`/campaigns/${campaignId}/outcomes`, {
      channel: 'linkedin_organic',
      periodStart: '2027-02-01',
      periodEnd: '2027-02-14',
      impressions: 2_400,
      clicks: 61,
      signups: 3,
      source: 'manual_entry',
      noteNl: 'Overgenomen uit de statistieken van de pagina.',
    });

    expect(response.statusCode).toBe(201);
    const record = response.json<{
      source: string;
      impressions: number | null;
      spendCents: number | null;
    }>();
    expect(record.source).toBe('manual_entry');
    expect(record.impressions).toBe(2_400);
    // Not reported stays absent rather than becoming a zero: an organic post
    // has no spend, and "0" would be a measurement.
    expect(record.spendCents).toBeNull();
  });

  it('stores no derived metric, so nothing can go stale or read as a verdict', async () => {
    const listed = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/outcomes`,
    });
    const [first] = listed.json<{ items: Record<string, unknown>[] }>().items;
    expect(first).toBeDefined();

    for (const field of ['ctr', 'clickThroughRate', 'costPerClick', 'cpc', 'conversionRate', 'roas']) {
      expect(Object.keys(first ?? {}), field).not.toContain(field);
    }
  });

  it('refuses a period that ends before it starts', async () => {
    const response = await post(`/campaigns/${campaignId}/outcomes`, {
      channel: 'linkedin_organic',
      periodStart: '2027-02-14',
      periodEnd: '2027-02-01',
      clicks: 10,
      source: 'manual_entry',
    });
    expect(response.statusCode).toBe(422);
  });

  it('refuses a row with no figure in it at all', async () => {
    // Otherwise the row records nothing while looking like a measurement.
    const response = await post(`/campaigns/${campaignId}/outcomes`, {
      channel: 'linkedin_organic',
      periodStart: '2027-02-01',
      periodEnd: '2027-02-14',
      source: 'manual_entry',
      noteNl: 'Niets ingevuld.',
    });
    expect(response.statusCode).toBe(422);
  });

  it('refuses a negative count', async () => {
    const response = await post(`/campaigns/${campaignId}/outcomes`, {
      channel: 'linkedin_organic',
      periodStart: '2027-02-01',
      periodEnd: '2027-02-14',
      clicks: -5,
      source: 'manual_entry',
    });
    expect(response.statusCode).toBe(422);
  });

  it('refuses to call figures a platform report without the report', async () => {
    /*
     * The provenance has to be true. A row claiming it came from an export,
     * with no export attached, is the one shape that would let a typed guess
     * pass as evidence.
     */
    const response = await post(`/campaigns/${campaignId}/outcomes`, {
      channel: 'linkedin_ads',
      periodStart: '2027-02-01',
      periodEnd: '2027-02-14',
      impressions: 10_000,
      spendCents: 25_000,
      source: 'platform_report',
    });
    expect(response.statusCode).toBe(422);
  });

  it('accepts an uploaded report as the provenance, and refuses an image as one', async () => {
    const document = await h.appContext.services.uploads.accept(h.db, h.currentUser, {
      labelId,
      purpose: 'outcome_report',
      filename: 'linkedin-export.txt',
      bytes: Buffer.from('Datum,Weergaven,Klikken\n2027-02-01,2400,61\n', 'utf8'),
    });

    const ok = await post(`/campaigns/${campaignId}/outcomes`, {
      channel: 'linkedin_ads',
      periodStart: '2027-02-01',
      periodEnd: '2027-02-14',
      impressions: 10_000,
      clicks: 240,
      spendCents: 25_000,
      source: 'platform_report',
      reportAssetId: document.id,
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json<{ reportAssetId: string | null }>().reportAssetId).toBe(document.id);

    /*
     * An image is not a report. The purpose an upload was made for is not
     * recorded on the asset row, so the stored mime type — decided by the
     * file's own bytes — is what separates a spreadsheet export from a logo
     * somebody picked by mistake.
     */
    const logo = await h.appContext.services.uploads.accept(h.db, h.currentUser, {
      labelId,
      purpose: 'brand_logo',
      filename: 'logo.png',
      bytes: Buffer.from(
        '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154089963f8ff1f0001040100b0c0f4a10000000049454e44ae426082',
        'hex',
      ),
    });
    const refused = await post(`/campaigns/${campaignId}/outcomes`, {
      channel: 'linkedin_ads',
      periodStart: '2027-02-01',
      periodEnd: '2027-02-14',
      clicks: 1,
      source: 'platform_report',
      reportAssetId: logo.id,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ error: { message: string } }>().error.message).toMatch(/geen afbeelding/u);
  });

  it('keeps outcomes inside their label', async () => {
    const otherLabel = labelIdBySlug(h.seed, 'demolabel-3');
    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${otherLabel}/campaigns/${campaignId}/outcomes`,
    });
    // The campaign belongs to another label, so it reads as absent.
    expect([403, 404]).toContain(response.statusCode);
  });
});
