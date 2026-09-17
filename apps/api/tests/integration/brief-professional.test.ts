import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCampaignInput, type BriefProposal, type BriefVersion } from '@c360/contracts';
import { AppError } from '../../src/core/errors/app-error.js';
import {
  BRIEF_MIN_TOTAL_WORDS,
  BRIEF_SECTION_MIN_WORDS,
  briefNarrativeWords,
  briefWordCount,
} from '../../src/modules/campaigns-briefs/service.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * A briefing a colleague can pick up (2026-09-14): every section of a
 * professional campaign brief, at length, with a role per channel — and a thin
 * one sent back once, then refused rather than stored.
 */
describe('the professional campaign brief', () => {
  let h: TestHarness;
  let labelId: string;
  let courseVersionId: string;
  let campaignId: string;
  let personaVersionIds: string[];

  beforeAll(async () => {
    h = await createTestHarness();
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const seeded = h.seed.pilot.courseVersionId;
    if (seeded === undefined || seeded === null) {
      throw new Error('the seed no longer provides a pilot course version');
    }
    courseVersionId = seeded;
    const s = h.appContext.services;
    const campaign = await s.campaigns.create(
      h.db,
      h.currentUser,
      labelId,
      createCampaignInput.parse({
        name: 'Briefing op niveau (Demo)',
        entryMode: 'discover_opportunities',
        objective: 'full_funnel',
        courseVersionId,
      }),
    );
    campaignId = campaign.id;
    const proposed = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId, campaignId });
    personaVersionIds = proposed.personas.map((persona) => persona.id);
  });

  afterAll(async () => {
    await h.close();
  });

  it('drafts every section at length, with a role for every suggested channel and no forecast', async () => {
    const s = h.appContext.services;
    const brief = await s.campaigns.draftBrief(h.db, h.currentUser, { labelId, campaignId, personaVersionIds });

    for (const [key, minimum] of Object.entries(BRIEF_SECTION_MIN_WORDS) as [keyof typeof BRIEF_SECTION_MIN_WORDS, number][]) {
      expect(briefWordCount(brief[key]), key).toBeGreaterThanOrEqual(minimum);
    }
    expect(briefNarrativeWords(brief)).toBeGreaterThanOrEqual(BRIEF_MIN_TOTAL_WORDS);
    expect(brief.mandatories.length).toBeGreaterThan(0);
    expect(brief.risks.length).toBeGreaterThanOrEqual(2);
    for (const channel of brief.channelSuggestions) {
      expect(brief.channelRoles.some((role) => role.channel === channel), channel).toBe(true);
    }
    expect(`${brief.goal} ${brief.measurement}`).not.toMatch(/\d+\s*%/u);
    // Read back identically.
    const stored = await s.campaigns.latestBrief(h.db, campaignId);
    expect(stored?.contextNl).toBe(brief.contextNl);
    expect(stored?.channelRoles).toEqual(brief.channelRoles);
  });

  it('sends a thin briefing back once and refuses it the second time, storing nothing', async () => {
    const s = h.appContext.services;
    const before = await s.campaigns.latestBrief(h.db, campaignId);
    const real = s.generation.generate.bind(s.generation);
    let rounds = 0;
    let sawRepairNotes = false;
    const spy = vi.spyOn(s.generation, 'generate').mockImplementation(async (db, request) => {
      const result = await real(db, request);
      if (request.template !== 'brief.draft') return result;
      rounds += 1;
      if ((request.context.repairNotes?.length ?? 0) > 0) sawRepairNotes = true;
      const value = result.value as BriefProposal;
      return {
        ...result,
        value: {
          ...value,
          contextNl: 'Te kort om een aanleiding te noemen, maar lang genoeg voor het schema van driehonderd tekens: '.padEnd(320, 'x'),
          audienceInsightNl: 'Ook te kort.'.padEnd(320, 'y'),
        },
      };
    });
    let failure: unknown;
    try {
      await s.campaigns.draftBrief(h.db, h.currentUser, { labelId, campaignId, personaVersionIds });
    } catch (error: unknown) {
      failure = error;
    }
    spy.mockRestore();
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).code).toBe('provider_invalid_output');
    expect((failure as AppError).internalDetail).toMatch(/Aanleiding en context/u);
    expect(rounds).toBe(2);
    expect(sawRepairNotes).toBe(true);
    const after = await s.campaigns.latestBrief(h.db, campaignId);
    expect(after?.id).toBe(before?.id);
  });

  it('drops a role for a channel the briefing does not suggest, and keeps the rest', async () => {
    const s = h.appContext.services;
    const real = s.generation.generate.bind(s.generation);
    const spy = vi.spyOn(s.generation, 'generate').mockImplementation(async (db, request) => {
      const result = await real(db, request);
      if (request.template !== 'brief.draft') return result;
      const value = result.value as BriefProposal;
      return {
        ...result,
        value: {
          ...value,
          channelRoles: [...value.channelRoles, { channel: 'meta_ads', roleNl: 'Een rol voor een kanaal dat de briefing niet voorstelt.' }],
        },
      };
    });
    const brief = await s.campaigns.draftBrief(h.db, h.currentUser, { labelId, campaignId, personaVersionIds });
    spy.mockRestore();
    expect(brief.channelRoles.some((role) => role.channel === 'meta_ads')).toBe(false);
    expect(brief.channelRoles.map((role) => role.channel).sort()).toEqual([...brief.channelSuggestions].sort());
  });

  it('lets a person edit a section without the model minimums, and reads the older format back', async () => {
    const edited = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/brief`,
      payload: { timingNl: 'Nog te bepalen met de opleidingsmanager.' },
    });
    expect(edited.statusCode).toBe(200);
    const brief = edited.json<BriefVersion>();
    expect(brief.timingNl).toBe('Nog te bepalen met de opleidingsmanager.');
    // The other sections travelled along unchanged.
    expect(brief.contextNl.length).toBeGreaterThan(0);
    expect(brief.channelRoles.length).toBeGreaterThan(0);
  });
});
