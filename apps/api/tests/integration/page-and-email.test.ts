import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { CHANNEL_CONFIG, createCampaignInput, isPublishable } from '@c360/contracts';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * The two Phase 3 channels that are not social posts: the landing page (P3-1)
 * and the e-mail (P3-2).
 *
 * They are tested together because they share the shape that makes them
 * different from a post — structured sections, no rendered social image — and
 * differ in exactly one interesting way: a landing page can be published, an
 * e-mail cannot. That contrast is the point of several assertions below.
 *
 * A page is not a post, and the two differ in ways that are easy to get almost
 * right: it carries **structured sections** rather than one body, it has no
 * rendered image, and there is no platform whose documentation could verify its
 * limits. That last one decides whether a landing page can ever be exported
 * publish-ready, so it is asserted here against the real chain rather than only
 * in the contract tests.
 *
 * The chain runs on the mock provider, whose brief deliberately suggests a
 * landing page alongside a social channel — so this shape is exercised by the
 * ordinary test run and by the browser smoke, not only when someone pays for a
 * real generation.
 */
describe('a landing page and an e-mail in the campaign chain', () => {
  let h: TestHarness;
  let root: string;
  let labelId: string;
  let campaignId: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'c360-landing-'));
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
    const campaign = await s.campaigns.create(
      db,
      user,
      labelId,
      createCampaignInput.parse({
        name: 'Landingspagina-test (Demo)',
        entryMode: 'discover_opportunities',
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
    await s.concepts.approvePlan(db, user, labelId, campaignId, null);
    await s.content.generate(db, user, { labelId, campaignId });
  });

  afterAll(async () => {
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  it('reaches the plan at all', async () => {
    /*
     * The check that failed first.
     *
     * Widening `plannableChannel` was not enough: the plan intersected the
     * brief's suggestions with the *social pilot* list, so the landing page was
     * filtered out of every plan while the schema said it was allowed. The
     * capability lived in one place and the permission in another.
     */
    const { plan } = await h.appContext.services.concepts.requireApprovedPlan(h.db, campaignId);
    expect(plan.items.map((item) => item.channel)).toContain('landing_page');
  });

  it('is produced as sections, with no rendered image', async () => {
    const assets = await h.appContext.services.content.list(
      h.db,
      h.currentUser,
      labelId,
      campaignId,
    );
    const page = assets.find((asset) => asset.channel === 'landing_page');
    expect(page).toBeDefined();

    // Structured sections, each with a heading and prose.
    expect(page?.copy.sections.length).toBeGreaterThanOrEqual(1);
    for (const section of page?.copy.sections ?? []) {
      expect(section.heading.length).toBeGreaterThanOrEqual(3);
      expect(section.text.length).toBeGreaterThanOrEqual(20);
    }
    // The introduction above the first section is still the body.
    expect(page?.copy.body.length).toBeGreaterThan(0);
    // No social render: the spec declares no image size, so asking for one
    // would invent a dimension nothing enforces.
    expect(page?.variants).toEqual([]);

    // And a post is still a post: no sections.
    const post = assets.find((asset) => asset.channel === 'linkedin_organic');
    expect(post?.copy.sections).toEqual([]);
  });

  it('does not block a publish-ready package for want of a verified platform', async () => {
    /*
     * The design decision, checked where it matters.
     *
     * A landing page has no platform documentation to verify against. If that
     * had been recorded as `unverified`, every campaign containing a page
     * would be unexportable for ever on a check that can never pass — so the
     * page must contribute **no** blocking warning of its own.
     */
    expect(isPublishable(CHANNEL_CONFIG, 'landing_page', 'text_only')).toBe(true);

    const assets = await h.appContext.services.content.list(
      h.db,
      h.currentUser,
      labelId,
      campaignId,
    );
    const page = assets.find((asset) => asset.channel === 'landing_page');
    expect(page?.warnings.filter((warning) => warning.blocksPublishReady)).toEqual([]);

    // The gates still refuse this campaign — unverified demo course facts and
    // unapproved content — and none of the reasons may be about the page's
    // specifications.
    const { reasonsNl } = await h.appContext.services.exports.evaluateGates(
      h.db,
      h.currentUser,
      labelId,
      campaignId,
    );
    expect(reasonsNl.some((reason) => /landingspagina/iu.test(reason))).toBe(false);
  });

  it('produces an e-mail, previews it and ships the HTML in the package', async () => {
    /*
     * E-mail is the channel where the export *is* markup, so it is the one
     * place the "no HTML from a model" rule has to be checked end to end
     * rather than only in the builder's unit tests.
     */
    const assets = await h.appContext.services.content.list(
      h.db,
      h.currentUser,
      labelId,
      campaignId,
    );
    const mail = assets.find((asset) => asset.channel === 'email');
    expect(mail).toBeDefined();
    expect(mail?.copy.sections.length).toBeGreaterThanOrEqual(1);
    expect(mail?.variants).toEqual([]);

    // The preview, over HTTP, with the headers that make a frame safe.
    const preview = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/content/${String(mail?.id)}/email.html`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toMatch(/text\/html/u);
    expect(preview.headers['content-security-policy']).toContain('sandbox');
    expect(preview.headers['x-content-type-options']).toBe('nosniff');
    expect(preview.body).not.toMatch(/<script/iu);
    /*
     * And it is the actual mail, not an empty document.
     *
     * Worth asserting explicitly: a preview that loads but renders nothing is
     * worse than no preview, because the screen then shows a blank rectangle
     * where a person expects to see what a recipient sees.
     */
    expect(preview.body).toContain('<!doctype html>');
    expect(preview.body).toContain(String(mail?.copy.hook));
    expect(preview.body.length).toBeGreaterThan(800);

    // A non-e-mail asset must read as absent here, not as "wrong channel".
    const post = assets.find((asset) => asset.channel === 'linkedin_organic');
    const wrong = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/content/${String(post?.id)}/email.html`,
    });
    expect(wrong.statusCode).toBe(404);

    // And the package carries both the text and the HTML.
    const result = await h.appContext.services.exports.build(
      h.db,
      h.currentUser,
      labelId,
      campaignId,
      'draft',
    );
    const zip = await JSZip.loadAsync(await readFile(join(root, result.storagePath ?? '')));
    const htmlEntry = Object.keys(zip.files).find(
      (name) => name.includes('email') && name.endsWith('.html'),
    );
    expect(htmlEntry).toBeDefined();
    const html = await zip.file(htmlEntry ?? '')?.async('string');
    expect(html).toMatch(/^<!doctype html>/u);
    expect(html).not.toMatch(/<script/iu);
    // The draft says so inside the file, so it cannot be mistaken for approved.
    expect(html).toContain('CONCEPT');
    expect(
      Object.keys(zip.files).some((name) => name.includes('email') && name.endsWith('.txt')),
    ).toBe(true);
  });

  it('refuses to call an e-mail publish-ready, and says why', async () => {
    /*
     * Producible is not publishable. E-mail client rendering has not been
     * checked against a primary source, so the gate refuses — and the reason
     * has to name the channel, or the user cannot act on it.
     */
    const { reasonsNl } = await h.appContext.services.exports.evaluateGates(
      h.db,
      h.currentUser,
      labelId,
      campaignId,
    );
    expect(reasonsNl.some((reason) => /e-?mail/iu.test(reason))).toBe(true);
  });

  it('exposes a relative calendar, and dates it when a start date is chosen', async () => {
    /*
     * Derived on read, so it cannot disagree with the plan it describes.
     *
     * Checked over HTTP rather than against the pure function — that has its
     * own tests — because the wiring is where this could go wrong: the stored
     * plan row wraps the plan itself, and passing the wrapper would have
     * produced an empty calendar with no error anywhere.
     */
    const relative = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}`,
    });
    expect(relative.statusCode).toBe(200);
    const before = relative.json<{
      calendar: { isDated: boolean; slots: { date: string | null }[]; warnings: { kind: string }[] };
    }>().calendar;

    expect(before.isDated).toBe(false);
    expect(before.slots.length).toBeGreaterThan(0);
    expect(before.slots.every((slot) => slot.date === null)).toBe(true);
    expect(before.warnings.map((warning) => warning.kind)).toContain('no_start_date');

    // Choosing a date turns the offsets into dates.
    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/start-date`,
      payload: { startDate: '2027-03-01' },
    });
    expect(patched.statusCode).toBe(200);

    const dated = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}`,
    });
    const after = dated.json<{
      calendar: { isDated: boolean; slots: { date: string | null; offsetDays: number }[] };
    }>().calendar;

    expect(after.isDated).toBe(true);
    expect(after.slots.every((slot) => slot.date !== null)).toBe(true);
    expect(after.slots[0]?.date).toBe('2027-03-01');
    // The shape did not change: only the dates were filled in.
    expect(after.slots.map((slot) => slot.offsetDays)).toEqual(
      before.slots.map((_, index) => after.slots[index]?.offsetDays),
    );

    // And it can be taken back off, returning to the relative form.
    const cleared = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/start-date`,
      payload: { startDate: null },
    });
    expect(cleared.statusCode).toBe(200);
    const again = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}`,
    });
    expect(again.json<{ calendar: { isDated: boolean } }>().calendar.isDated).toBe(false);
  });

  it('refuses an unparseable start date rather than scheduling nonsense', async () => {
    const response = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/start-date`,
      payload: { startDate: 'volgende maand' },
    });
    expect(response.statusCode).toBe(422);
  });

  it('says it is ignoring course dates that nobody has confirmed', async () => {
    /*
     * The demo course card carries date prose that has not been confirmed, so
     * the calendar must say it is not using it. Parsing "12 januari" out of an
     * unverified sentence and scheduling against it is exactly the invention
     * the product refuses everywhere else.
     */
    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}`,
    });
    const warnings = detail.json<{ calendar: { warnings: { kind: string; messageNl: string }[] } }>()
      .calendar.warnings;
    const unconfirmed = warnings.find((warning) => warning.kind === 'course_dates_unconfirmed');

    // The seeded demo card may or may not carry a date value; if it does, the
    // warning is mandatory. Asserted conditionally rather than skipped, so this
    // cannot silently stop testing anything if the seed changes.
    const course = await h.appContext.services.courses.findVersion(
      h.db,
      labelId,
      (await h.appContext.services.campaigns.requireById(h.db, labelId, campaignId))
        .courseVersionId,
    );
    const hasUnconfirmedDates =
      course?.facts.dates.value !== null && course?.facts.dates.state !== 'user_confirmed';
    expect(unconfirmed !== undefined).toBe(hasUnconfirmedDates);
  });

  it('produces a search advertisement with copy and no figures', async () => {
    /*
     * The end of the chain for P3-4, checked against real generated content
     * rather than only against the schema: the shape guarantees no figure can
     * exist, and this proves the chain actually fills the shape.
     */
    const assets = await h.appContext.services.content.list(
      h.db,
      h.currentUser,
      labelId,
      campaignId,
    );
    const advert = assets.find((asset) => asset.channel === 'google_search_ads');
    expect(advert).toBeDefined();
    expect(advert?.copy.ads).not.toBeNull();
    expect(advert?.copy.ads?.headlines.length).toBeGreaterThanOrEqual(1);
    expect(advert?.copy.ads?.descriptions.length).toBeGreaterThanOrEqual(1);
    // Search is the only ad channel that gets keywords: they are what someone
    // types, and on LinkedIn or Meta an audience is chosen rather than typed.
    expect(advert?.copy.ads?.keywords.length).toBeGreaterThanOrEqual(1);
    // No image: the specification declares none.
    expect(advert?.variants).toEqual([]);

    // A post carries no advertising copy.
    const post = assets.find((asset) => asset.channel === 'linkedin_organic');
    expect(post?.copy.ads).toBeNull();

    // And the package says the limits are unchecked and the figures absent.
    const result = await h.appContext.services.exports.build(
      h.db,
      h.currentUser,
      labelId,
      campaignId,
      'draft',
    );
    const zip = await JSZip.loadAsync(await readFile(join(root, result.storagePath ?? '')));
    const entry = Object.keys(zip.files).find(
      (name) => name.includes('google_search_ads') && name.endsWith('.txt'),
    );
    const text = await zip.file(entry ?? '')?.async('string');
    expect(text).toContain('ADVERTENTIETEKST');
    expect(text).toContain('Zoektermen');
    expect(text).toMatch(/geen zoekvolumes, klikprijzen of conversieverwachtingen/u);
  });

  it('ships the sections in the draft package, as readable text', async () => {
    const result = await h.appContext.services.exports.build(
      h.db,
      h.currentUser,
      labelId,
      campaignId,
      'draft',
    );
    expect(result.storagePath).not.toBeNull();

    const zip = await JSZip.loadAsync(await readFile(join(root, result.storagePath ?? '')));
    // The text file, not the folder entry of the same name: a directory reads
    // back as an empty string and every assertion below would pass vacuously.
    const entry = Object.keys(zip.files).find(
      (name) => name.includes('landing_page') && name.endsWith('.txt'),
    );
    expect(entry).toBeDefined();

    const text = await zip.file(entry ?? '')?.async('string');
    expect(text).toBeDefined();
    expect(text).toContain('SECTIES');
    /*
     * Plain text, not markup. The export is what a person pastes into their own
     * CMS, so the structure has to survive without HTML — and nothing this
     * product emits should be markup a user cannot read first.
     */
    expect(text).not.toMatch(/<[a-z]+[ >]/u);
  });
});
