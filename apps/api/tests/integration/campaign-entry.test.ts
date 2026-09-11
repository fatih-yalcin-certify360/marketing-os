import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';
import { createCampaignInput } from '@c360/contracts';
import { buildContextBlock } from '../../src/core/ai/prompts.js';

describe('campaign entry text reaches brief generation', () => {
  let h: TestHarness;
  beforeAll(async () => { h = await createTestHarness(); });
  afterAll(async () => { await h.close(); });

  it.each(['develop_my_idea', 'start_from_briefing'] as const)('accepts and uses %s', async entryMode => {
    const labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const courseVersionId = h.seed.pilot.courseVersionId!;
    const text = entryMode === 'start_from_briefing' ? 'Campagne voor HR-professionals. '.repeat(180) : 'Werk een praktische campagne voor HR-professionals uit.';
    const field = entryMode === 'start_from_briefing' ? 'suppliedBrief' : 'userIdea';
    const response = await h.app.inject({ method: 'POST', url: `/api/v1/labels/${labelId}/campaigns`, payload: { name: 'Entry regression', entryMode, courseVersionId, [field]: text } });
    expect(response.statusCode).toBe(201);
    const campaign = response.json<{ id: string; userIdea: string | null; suppliedBrief: string | null }>();
    expect(campaign[field]).toBe(text);
    expect(campaign[field === 'userIdea' ? 'suppliedBrief' : 'userIdea']).toBeNull();
    const s = h.appContext.services;
    const personaSpy = vi.spyOn(s.generation, 'generate');
    const proposed = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId, campaignId: campaign.id });
    expect(personaSpy.mock.calls[0]![1].context[field]).toBe(text);
    personaSpy.mockRestore();
    const personaVersionIds = proposed.personas.map(p => p.id);
    for (const id of personaVersionIds) await s.personas.approve(h.db, h.currentUser, labelId, id);
    const spy = vi.spyOn(s.generation, 'generate');
    try {
      await s.campaigns.draftBrief(h.db, h.currentUser, { labelId, campaignId: campaign.id, personaVersionIds });
      const call = spy.mock.calls.find(([, request]) => request.template === 'brief.draft');
      expect(call).toBeDefined();
      expect(call![1].context[field]).toBe(text);
      expect(buildContextBlock(call![1].context)).toContain(text.trim());
    } finally { spy.mockRestore(); }
  });
  it('isolates campaigns on the same course and keeps review notes and original text', async () => {
    const { db, currentUser: user } = h;
    const s = h.appContext.services;
    const labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const courseVersionId = h.seed.pilot.courseVersionId!;
    const first = await s.campaigns.create(db, user, labelId, createCampaignInput.parse({
      name: 'HR briefing', entryMode: 'start_from_briefing', courseVersionId, suppliedBrief: 'Behoud deze exacte oorspronkelijke briefing voor HR.'
    }));
    const second = await s.campaigns.create(db, user, labelId, createCampaignInput.parse({
      name: 'Manager idea', entryMode: 'develop_my_idea', courseVersionId, userIdea: 'Een campagne voor leidinggevenden.'
    }));
    const a = await s.personas.propose(db, user, { labelId, courseVersionId, campaignId: first.id });
    await s.personas.propose(db, user, { labelId, courseVersionId, campaignId: second.id });
    const aIds = a.personas.map(p => p.id);
    const listed = await h.app.inject({ method: 'GET', url: `/api/v1/labels/${labelId}/courses/${courseVersionId}/personas?campaignId=${first.id}` });
    expect(listed.json<{ items: { id: string }[] }>().items.map(p => p.id).sort()).toEqual([...aIds].sort());
    await expect(s.campaigns.draftBrief(db, user, { labelId, campaignId: second.id, personaVersionIds: aIds })).rejects.toMatchObject({ code: 'not_found' });
    const brief = await s.campaigns.draftBrief(db, user, { labelId, campaignId: first.id, personaVersionIds: aIds });
    const edited = await s.campaigns.editBrief(db, user, labelId, first.id, { reviewNotes: ['Budget ontbreekt: nog te bepalen.'], ctaUrl: 'https://example.com/opleiding' });
    const next = await s.campaigns.editBrief(db, user, labelId, first.id, { goal: 'Een aangepast en concreet campagnedoel.' });
    expect(next.reviewNotes).toEqual(edited.reviewNotes);
    expect(next.ctaUrl).toBe(edited.ctaUrl);
    expect((await s.campaigns.requireById(db, labelId, first.id)).suppliedBrief).toBe(first.suppliedBrief);
    expect(brief.reviewState).toBe('draft');
  });

});
