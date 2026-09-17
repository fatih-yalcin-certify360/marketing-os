import { z } from 'zod';
import { isoTimestamp } from './primitives.js';
import { campaignEntryMode, reviewState } from './workflow.js';

/**
 * Where a campaign stands, computed by one rule for every screen.
 *
 * The detail page used to derive "the next step" from the full detail payload
 * in a function of its own, and the campaigns list showed a server enum
 * (`campaign.stage`) that is advanced at four points and stops at production —
 * so a fully exported campaign read as "Content" in the list while the detail
 * page said "Leg resultaten vast". Two rules, two answers. This module is the
 * one rule: the detail page feeds it the detail it has, the list route feeds it
 * grouped queries, and both say the same thing.
 *
 * The input is deliberately small and flat so a server can fill it without a
 * detail call per campaign.
 */

export const CAMPAIGN_STEPS = [
  { id: 'audience', label: 'Doelgroep' },
  { id: 'direction', label: 'Richting' },
  { id: 'brief', label: 'Briefing' },
  { id: 'concept', label: 'Concept' },
  { id: 'plan', label: 'Kanaalplan' },
  { id: 'content', label: 'Content & beelden' },
  { id: 'export', label: 'Export' },
  { id: 'results', label: 'Resultaten & lessen' },
] as const;

export const campaignStepId = z.enum([
  'audience',
  'direction',
  'brief',
  'concept',
  'plan',
  'content',
  'export',
  'results',
]);
export type CampaignStepId = z.infer<typeof campaignStepId>;

/** The card number of a step: its 1-based position in the chain. */
export function campaignStepNumber(id: CampaignStepId): number {
  return CAMPAIGN_STEPS.findIndex((step) => step.id === id) + 1;
}

export function campaignStepLabel(id: CampaignStepId): string {
  return CAMPAIGN_STEPS.find((step) => step.id === id)?.label ?? id;
}

export const campaignProgressInput = z.object({
  entryMode: campaignEntryMode,
  /** A direction was chosen (an opportunity is attached). */
  hasOpportunity: z.boolean(),
  /**
   * How many personas the campaign is being built for. Before a brief exists
   * this is the person's unsaved choice on the detail page and zero for the
   * server, which cannot see that choice; once a brief exists it is the count
   * pinned on the latest brief.
   */
  personaCount: z.number().int().min(0),
  /**
   * The campaign was started from a radar scan or a saved opportunity card.
   *
   * Such a campaign *has* a direction — it is the reason it exists — but it
   * carries no `opportunityId`, so the step bar showed "Richting" as never
   * done and the one screen that says what to do next was wrong for the two
   * entry points that matter most (audit 2026-09-15). Defaulted, so every
   * existing caller keeps working.
   */
  fromRadar: z.boolean().default(false),
  brief: z
    .object({
      reviewState,
      /** An approved version exists; the latest may still be a newer draft. */
      approved: z.boolean(),
    })
    .nullable(),
  hasSelectedConcept: z.boolean(),
  plan: z.object({ reviewState }).nullable(),
  /** Latest version per asset key. */
  assets: z.object({
    total: z.number().int().min(0),
    approved: z.number().int().min(0),
    needsRereview: z.number().int().min(0),
  }),
  /** An export with bytes in it exists. */
  hasExport: z.boolean(),
  /** At least one outcome report was recorded. */
  hasOutcomes: z.boolean(),
  lastActivityAt: isoTimestamp,
});
export type CampaignProgressInput = z.infer<typeof campaignProgressInput>;

/**
 * `state` is the one word the list needs: `attention` when a person has to
 * re-review something that changed under them, `finished` when results are
 * being recorded, `open` otherwise. It is derived, never stored.
 */
export const campaignProgressState = z.enum(['open', 'attention', 'finished']);
export type CampaignProgressState = z.infer<typeof campaignProgressState>;

export const campaignProgress = z.object({
  nextStepId: campaignStepId,
  nextStepNumber: z.number().int().min(1).max(CAMPAIGN_STEPS.length),
  /** What to do now, in Dutch, without a figure. */
  nextActionNl: z.string().min(1).max(200),
  doneStepIds: z.array(campaignStepId).max(CAMPAIGN_STEPS.length),
  attention: z.boolean(),
  state: campaignProgressState,
  lastActivityAt: isoTimestamp,
});
export type CampaignProgress = z.infer<typeof campaignProgress>;

/**
 * The rule. Read top to bottom: the first gate that is not passed is the next
 * step. The order is the chain's order, and every branch names the action a
 * person takes, not a status.
 */
export function computeCampaignProgress(input: CampaignProgressInput): CampaignProgress {
  const next = nextStep(input);
  const done: CampaignStepId[] = [];
  if (input.personaCount > 0 && input.brief !== null) done.push('audience');
  if (input.hasOpportunity || input.fromRadar) done.push('direction');
  if (input.brief?.approved === true) done.push('brief');
  if (input.hasSelectedConcept) done.push('concept');
  if (input.plan?.reviewState === 'approved') done.push('plan');
  if (input.assets.total > 0 && input.assets.approved === input.assets.total) done.push('content');
  if (input.hasExport) done.push('export');
  if (input.hasOutcomes) done.push('results');

  const attention = input.brief?.reviewState === 'needs_rereview' || input.assets.needsRereview > 0;
  const state: CampaignProgressState = attention
    ? 'attention'
    : next.id === 'results' && input.hasOutcomes
      ? 'finished'
      : 'open';

  return {
    nextStepId: next.id,
    nextStepNumber: campaignStepNumber(next.id),
    nextActionNl: next.actionNl,
    doneStepIds: done,
    attention,
    state,
    lastActivityAt: input.lastActivityAt,
  };
}

function nextStep(input: CampaignProgressInput): { id: CampaignStepId; actionNl: string } {
  if (input.brief === null) {
    if (input.personaCount === 0) {
      return { id: 'audience', actionNl: 'Kies de doelgroepen voor deze campagne.' };
    }
    if (input.entryMode === 'discover_opportunities' && !input.hasOpportunity && !input.fromRadar) {
      return { id: 'direction', actionNl: 'Laat kansen voorstellen en kies een richting.' };
    }
    return { id: 'brief', actionNl: 'Werk de briefing uit.' };
  }
  if (!input.brief.approved) {
    return {
      id: 'brief',
      actionNl:
        input.brief.reviewState === 'needs_rereview'
          ? 'Een doelgroep is gewijzigd: beoordeel de briefing opnieuw.'
          : 'Controleer de briefing en keur haar goed.',
    };
  }
  if (!input.hasSelectedConcept) {
    return { id: 'concept', actionNl: 'Kies een concept en beeldrichting.' };
  }
  if (input.plan === null) {
    return { id: 'plan', actionNl: 'Laat het kanaalplan voorstellen.' };
  }
  if (input.plan.reviewState !== 'approved') {
    return { id: 'plan', actionNl: 'Controleer het kanaalplan en keur het goed.' };
  }
  if (input.assets.total === 0) {
    return { id: 'content', actionNl: 'Maak de content per fase.' };
  }
  if (input.assets.approved < input.assets.total) {
    return { id: 'content', actionNl: 'Beoordeel de content en keur elk item goed.' };
  }
  if (!input.hasExport) {
    return { id: 'export', actionNl: 'Exporteer het pakket.' };
  }
  return { id: 'results', actionNl: 'Leg publicaties, resultaten en lessen vast.' };
}
