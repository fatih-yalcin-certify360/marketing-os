import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_STEPS,
  campaignStepNumber,
  computeCampaignProgress,
  type CampaignProgressInput,
} from '../src/index.js';

/**
 * The one rule for "where does this campaign stand", read by the list and by
 * the detail page. Each branch is a gate; the first gate not passed is the
 * next step.
 */
const base: CampaignProgressInput = {
  entryMode: 'discover_opportunities',
  hasOpportunity: false,
  fromRadar: false,
  personaCount: 0,
  brief: null,
  hasSelectedConcept: false,
  plan: null,
  assets: { total: 0, approved: 0, needsRereview: 0 },
  hasExport: false,
  hasOutcomes: false,
  lastActivityAt: '2026-09-12T08:00:00.000Z',
};

describe('computeCampaignProgress', () => {
  it('starts at the audience, with nothing done', () => {
    const progress = computeCampaignProgress(base);
    expect(progress.nextStepId).toBe('audience');
    expect(progress.nextStepNumber).toBe(1);
    expect(progress.doneStepIds).toEqual([]);
    expect(progress.state).toBe('open');
    expect(progress.nextActionNl).not.toMatch(/\d/u);
  });

  it('asks for a direction only when the campaign discovers opportunities', () => {
    expect(computeCampaignProgress({ ...base, personaCount: 2 }).nextStepId).toBe('direction');
    expect(computeCampaignProgress({ ...base, personaCount: 2, entryMode: 'develop_my_idea' }).nextStepId).toBe('brief');
    expect(computeCampaignProgress({ ...base, personaCount: 2, hasOpportunity: true }).nextStepId).toBe('brief');
  });

  it('holds at the briefing until it is approved, and says why when a doelgroep changed', () => {
    const drafted = computeCampaignProgress({
      ...base,
      personaCount: 2,
      hasOpportunity: true,
      brief: { reviewState: 'draft', approved: false },
    });
    expect(drafted.nextStepId).toBe('brief');
    expect(drafted.doneStepIds).toEqual(['audience', 'direction']);

    const flagged = computeCampaignProgress({
      ...base,
      personaCount: 2,
      hasOpportunity: true,
      brief: { reviewState: 'needs_rereview', approved: true },
    });
    expect(flagged.attention).toBe(true);
    expect(flagged.state).toBe('attention');
    // An approved version exists, so the gate is passed even while the latest is flagged.
    expect(flagged.nextStepId).toBe('concept');
  });

  it('walks concept, plan, content, export and results in the chain order', () => {
    const approved = { ...base, personaCount: 2, hasOpportunity: true, brief: { reviewState: 'approved' as const, approved: true } };
    expect(computeCampaignProgress(approved).nextStepId).toBe('concept');
    const concept = { ...approved, hasSelectedConcept: true };
    expect(computeCampaignProgress(concept).nextStepId).toBe('plan');
    const planned = { ...concept, plan: { reviewState: 'draft' as const } };
    expect(computeCampaignProgress(planned).nextStepId).toBe('plan');
    const planApproved = { ...concept, plan: { reviewState: 'approved' as const } };
    expect(computeCampaignProgress(planApproved).nextStepId).toBe('content');
    const produced = { ...planApproved, assets: { total: 4, approved: 1, needsRereview: 0 } };
    expect(computeCampaignProgress(produced).nextStepId).toBe('content');
    const allApproved = { ...planApproved, assets: { total: 4, approved: 4, needsRereview: 0 } };
    expect(computeCampaignProgress(allApproved).nextStepId).toBe('export');
    const exported = { ...allApproved, hasExport: true };
    const result = computeCampaignProgress(exported);
    expect(result.nextStepId).toBe('results');
    expect(result.nextStepNumber).toBe(CAMPAIGN_STEPS.length);
    expect(result.doneStepIds).toEqual(['audience', 'direction', 'brief', 'concept', 'plan', 'content', 'export']);
    expect(result.state).toBe('open');
    const measured = computeCampaignProgress({ ...exported, hasOutcomes: true });
    expect(measured.state).toBe('finished');
    expect(measured.doneStepIds).toContain('results');
  });

  it('flags content that needs a second look', () => {
    const progress = computeCampaignProgress({
      ...base,
      personaCount: 1,
      hasOpportunity: true,
      brief: { reviewState: 'approved', approved: true },
      hasSelectedConcept: true,
      plan: { reviewState: 'approved' },
      assets: { total: 3, approved: 2, needsRereview: 1 },
    });
    expect(progress.attention).toBe(true);
    expect(progress.nextStepId).toBe('content');
  });

  it('numbers steps by their position in the chain', () => {
    expect(campaignStepNumber('audience')).toBe(1);
    expect(campaignStepNumber('results')).toBe(8);
    expect(CAMPAIGN_STEPS.map((step) => step.id)).toEqual([
      'audience',
      'direction',
      'brief',
      'concept',
      'plan',
      'content',
      'export',
      'results',
    ]);
  });
});

describe('a campaign that came from the radar', () => {
  /**
   * Such a campaign has a direction — the scan is why it exists — but carries
   * no opportunityId. Before 2026-09-15 the step bar showed "Richting" as
   * never done and told the user to go and choose one, for the entry point
   * the product pushes hardest.
   */
  it('counts its direction as chosen and moves straight on to the briefing', () => {
    const fromScan = computeCampaignProgress({ ...base, personaCount: 2, fromRadar: true });
    expect(fromScan.doneStepIds).toContain('direction');
    expect(fromScan.nextStepId).toBe('brief');

    // Without the radar and without a chosen opportunity, it still asks.
    const bare = computeCampaignProgress({ ...base, personaCount: 2 });
    expect(bare.doneStepIds).not.toContain('direction');
    expect(bare.nextStepId).toBe('direction');
  });
});
