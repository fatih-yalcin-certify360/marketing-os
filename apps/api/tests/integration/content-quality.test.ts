import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCampaignInput, lengthGuidanceFor, type ContentProposalSet } from '@c360/contracts';
import { AppError } from '../../src/core/errors/app-error.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';
import { LONG_FORM_CHANNELS, MIN_ARTICLE_WORDS, wordCount } from '../../src/modules/content-assets/quality.js';

/**
 * Content that is long enough, specific, findable and shareable (slice C),
 * checked against the real chain on the mock provider.
 */
describe('content quality in the campaign chain', () => {
  let h: TestHarness;
  let root: string;
  let labelId: string;
  let campaignId: string;
  let courseVersionId: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'c360-quality-'));
    h = await createTestHarness({ envOverrides: { STORAGE_ROOT: root } });
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    const seeded = h.seed.pilot.courseVersionId;
    if (seeded === undefined || seeded === null) {
      throw new Error('the seed no longer provides a pilot course version');
    }
    courseVersionId = seeded;
    const campaign = await s.campaigns.create(
      db,
      user,
      labelId,
      createCampaignInput.parse({
        name: 'Kwaliteit (Demo)',
        entryMode: 'discover_opportunities',
        objective: 'full_funnel',
        courseVersionId,
      }),
    );
    campaignId = campaign.id;
    const proposed = await s.personas.propose(db, user, { labelId, courseVersionId, campaignId });
    const brief = await s.campaigns.draftBrief(db, user, {
      labelId,
      campaignId,
      personaVersionIds: proposed.personas.map((persona) => persona.id),
    });
    await s.campaigns.approveBrief(db, user, labelId, campaignId, brief.id, null);
    const concepts = await s.concepts.propose(db, user, { labelId, campaignId });
    await s.concepts.select(db, user, labelId, campaignId, concepts.concepts[0]!.id);
    await s.concepts.proposePlan(db, user, { labelId, campaignId });
    await s.concepts.approvePlan(db, user, labelId, campaignId, null);
  });

  afterAll(async () => {
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  it('gives the briefing search phrases from the pool only, and notes what it dropped', async () => {
    const s = h.appContext.services;
    const brief = await s.campaigns.requireApprovedBrief(h.db, campaignId);
    expect(brief.keywords.length).toBeGreaterThan(0);
    // No radar run behind this campaign: everything is derived and says so.
    expect(brief.keywords.every((keyword) => keyword.kind === 'afgeleid')).toBe(true);
    expect(brief.keywords.every((keyword) => keyword.sourceRef.startsWith('Opleidingskaart'))).toBe(true);

    // A model that invents a phrase sees it dropped and named.
    const real = s.generation.generate.bind(s.generation);
    const spy = vi.spyOn(s.generation, 'generate').mockImplementation(async (db, request) => {
      const result = await real(db, request);
      if (request.template !== 'brief.draft') return result;
      const value = result.value as { keywords: { phrase: string; sourceRef: string; kind: string }[] };
      return {
        ...result,
        value: { ...value, keywords: [...value.keywords, { phrase: 'verzonnen zoekterm', sourceRef: 'nergens', kind: 'radar' }] },
      };
    });
    const personas = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId, campaignId });
    const redrafted = await s.campaigns.draftBrief(h.db, h.currentUser, {
      labelId,
      campaignId,
      personaVersionIds: personas.personas.map((persona) => persona.id),
    });
    spy.mockRestore();
    expect(redrafted.keywords.some((keyword) => keyword.phrase === 'verzonnen zoekterm')).toBe(false);
    expect(redrafted.reviewNotes.join(' ')).toContain('verzonnen zoekterm');
  });

  it('refuses a two-line landing page after one repair round, storing nothing thin', async () => {
    const s = h.appContext.services;
    const real = s.generation.generate.bind(s.generation);
    let calls = 0;
    const spy = vi.spyOn(s.generation, 'generate').mockImplementation(async (db, request) => {
      const result = await real(db, request);
      if (request.template !== 'content.generate') return result;
      const value = result.value as ContentProposalSet;
      if (!value.items.some((item) => item.channel === 'course_page_update')) return result;
      calls += 1;
      return {
        ...result,
        value: {
          items: value.items.map((item) =>
            item.channel === 'course_page_update'
              ? {
                  ...item,
                  copy: {
                    ...item.copy,
                    body: 'De opleiding is bedoeld voor mensen in verzuim. Bekijk de opleiding.',
                    sections: [{ heading: 'Voor wie', text: 'Mensen die werkzaam zijn in verzuim en sociale zekerheid.' }],
                    website: null,
                  },
                }
              : item,
          ),
        },
      };
    });
    let failure: unknown;
    try {
      await s.content.generate(h.db, h.currentUser, { labelId, campaignId });
    } catch (error: unknown) {
      failure = error;
    }
    spy.mockRestore();
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).code).toBe('provider_invalid_output');
    expect((failure as AppError).internalDetail).toMatch(/woorden|secties|vorm|website/u);
    // The page was asked once and repaired once — then refused.
    expect(calls).toBe(2);
    const stored = await s.content.list(h.db, h.currentUser, labelId, campaignId);
    expect(stored.filter((asset) => asset.channel === 'course_page_update')).toEqual([]);
  });

  it('stores pieces that meet their minimums: a website form, hashtags on the post, search phrases used, nothing repeated', async () => {
    const s = h.appContext.services;
    const out = await s.content.generate(h.db, h.currentUser, { labelId, campaignId });
    expect(out.assets.length).toBeGreaterThan(0);

    for (const asset of out.assets) {
      const rules = lengthGuidanceFor(asset.channel);
      const total = wordCount(asset.copy.body) + asset.copy.sections.reduce((sum, section) => sum + wordCount(section.text), 0);
      if (rules.minTotalWords !== null && asset.copy.website?.form !== 'course_page_update') {
        expect(total, `${asset.channel} ${String(asset.funnelStage)}`).toBeGreaterThanOrEqual(rules.minTotalWords);
      }
      if (rules.minBodyWords !== null) {
        expect(wordCount(asset.copy.body), asset.channel).toBeGreaterThanOrEqual(rules.minBodyWords);
      }
      expect(asset.copy.hashtags.length).toBeGreaterThanOrEqual(rules.minHashtags);
      expect(asset.copy.hashtags.length).toBeLessThanOrEqual(rules.maxHashtags);
      // None of the house-style warnings that send a piece back survived.
      expect(asset.warnings.map((warning) => warning.kind)).not.toContain('body_too_short');
      expect(asset.warnings.map((warning) => warning.kind)).not.toContain('repeated_across_pieces');
      expect(asset.warnings.map((warning) => warning.kind)).not.toContain('hashtags_missing');
      if (LONG_FORM_CHANNELS.has(asset.channel)) {
        expect(asset.copy.keywordsUsed.length).toBeGreaterThan(0);
        expect(asset.warnings.map((warning) => warning.kind)).not.toContain('keywords_missing');
      }
    }

    /*
     * Since the website split (2026-09-15) the channel is the deliverable: a
     * cell asking for a course-page change gets a change proposal, never an
     * article, even when the page cannot be read in the test environment. That
     * substitution was exactly the silent one the split removed.
     */
    const page = out.assets.find((asset) => asset.channel === 'course_page_update');
    expect(page).toBeDefined();
    expect(page!.copy.website?.form).toBe('course_page_update');

    const article = out.assets.find((asset) => asset.channel === 'blog_article');
    if (article !== undefined && article.copy.website?.form === 'blog_article') {
      const piece = article.copy.website;
      const words =
        wordCount(piece.intro) +
        piece.sections.reduce((sum, section) => sum + wordCount(section.text), 0) +
        piece.faq.reduce((sum, item) => sum + wordCount(item.answer), 0);
      expect(words).toBeGreaterThanOrEqual(MIN_ARTICLE_WORDS);
      expect(piece.faq.length).toBeGreaterThanOrEqual(2);
    }

    const post = out.assets.find((asset) => asset.channel === 'linkedin_organic');
    expect(post).toBeDefined();
    expect(post!.copy.hashtags.every((tag) => /^#[\p{L}\p{N}_]+$/u.test(tag))).toBe(true);

    // Hooks differ across every piece of the campaign.
    const hooks = out.assets.map((asset) => asset.copy.hook);
    expect(new Set(hooks).size).toBe(hooks.length);
  });

  it('reads the shape warnings back on every read, and carries the context ones', async () => {
    const s = h.appContext.services;
    const post = (await s.content.list(h.db, h.currentUser, labelId, campaignId)).find(
      (asset) => asset.channel === 'linkedin_organic',
    )!;
    // A hand edit that strips the hashtags is stored — a draft must always be
    // possible — and comes back warning about it on the next read.
    const edited = await s.content.editCopy(h.db, h.currentUser, labelId, post.id, {
      expectedVersion: post.version,
      copy: { hashtags: [] },
    });
    expect(edited.warnings.map((warning) => warning.kind)).toContain('hashtags_missing');
    const reread = await s.content.requireById(h.db, labelId, edited.id);
    expect(reread.warnings.map((warning) => warning.kind)).toContain('hashtags_missing');
    expect(reread.warnings.find((warning) => warning.kind === 'hashtags_missing')?.blocksPublishReady).toBe(true);
  });
});
