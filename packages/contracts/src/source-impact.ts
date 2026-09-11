import { z } from 'zod';
import { isoTimestamp, uuid } from './primitives.js';
import { stalenessReason } from './sources.js';

/**
 * Which campaigns rest on a source that has since changed (P4-3).
 *
 * Per-campaign staleness already existed: a research run snapshots what it read
 * with a content hash, so "is this run still current" is a comparison rather
 * than a guess, and the publish-ready gate refuses on it. What was missing is
 * the **inverse and wider** question — a source changed this morning, so what
 * does that touch? — which is the one somebody actually asks.
 *
 * ## It reports exposure, not wrongness
 *
 * A changed source does not mean the content is wrong. The page may have had a
 * typo fixed. So this never says "this claim is false": it says which campaigns
 * rest on the changed source, which findings came from it — an exact link, via
 * the finding's `sourceId` foreign key, not a text match — and how far each
 * campaign got. Deciding what to do with that is a person's job, and nothing
 * here regenerates or retracts anything.
 *
 * ## Exposure is what makes it urgent
 *
 * A draft campaign resting on a changed source is a nuisance: regenerate it. A
 * campaign whose content somebody has already published is a different problem,
 * because the material is out in the world and the fix involves other people.
 * That distinction is the whole value of the report, so it is computed
 * explicitly rather than left for a reader to infer from a stage name.
 */

export const campaignExposure = z.enum([
  /** Nothing has left the building. */
  'draft',
  /** Content approved, but no publish-ready package and no publication. */
  'approved',
  /** A publish-ready package exists, so the material may have been handed on. */
  'exported',
  /** Somebody recorded publishing it. The material is out there. */
  'published',
]);
export type CampaignExposure = z.infer<typeof campaignExposure>;

export const impactSeverity = z.enum(['low', 'medium', 'high']);
export type ImpactSeverity = z.infer<typeof impactSeverity>;

export const changedSource = z.object({
  sourceId: uuid,
  title: z.string(),
  reason: stalenessReason,
  detailNl: z.string(),
});
export type ChangedSource = z.infer<typeof changedSource>;

export const campaignImpact = z.object({
  campaignId: uuid,
  campaignName: z.string(),
  courseVersionId: uuid.nullable(),
  exposure: campaignExposure,
  severity: impactSeverity,
  /** Why this campaign is implicated, in the order a reader needs them. */
  reasonsNl: z.array(z.string()),
  /**
   * Findings that came from a changed source, by foreign key.
   *
   * Exact, not inferred: a finding records which source it came from. This is
   * what makes the report checkable — a reader can look at the claim and decide
   * whether the change matters, instead of re-reading everything.
   */
  affectedFindings: z.array(z.object({ claim: z.string(), sourceRef: z.string() })),
});
export type CampaignImpact = z.infer<typeof campaignImpact>;

export const sourceImpactReport = z.object({
  checkedAt: isoTimestamp,
  changedSources: z.array(changedSource),
  campaigns: z.array(campaignImpact),
});
export type SourceImpactReport = z.infer<typeof sourceImpactReport>;

/**
 * How exposed a campaign is, and therefore how urgent.
 *
 * The mapping is deliberately dull and written down: published is high because
 * other people are involved in undoing it; a publish-ready export is high
 * because the package exists to be handed on and we cannot know whether it was;
 * approved content is medium because somebody has signed it off but it has not
 * left; anything else is low because regenerating costs nothing but a model
 * call.
 *
 * A judgement expressed as a function rather than as a sentence in a service,
 * so it can be tested and so changing it is a visible decision.
 */
export function assessExposure(input: {
  hasPublications: boolean;
  hasPublishReadyExport: boolean;
  hasApprovedContent: boolean;
}): { exposure: CampaignExposure; severity: ImpactSeverity; reasonNl: string } {
  if (input.hasPublications) {
    return {
      exposure: 'published',
      severity: 'high',
      reasonNl:
        'Er is vastgelegd dat content van deze campagne is gepubliceerd. Materiaal dat op de gewijzigde bron rust, staat dus buiten dit systeem.',
    };
  }
  if (input.hasPublishReadyExport) {
    return {
      exposure: 'exported',
      severity: 'high',
      reasonNl:
        'Er is een publicatieklaar pakket geëxporteerd. Dit systeem weet niet wat daarmee is gebeurd, dus ga ervan uit dat het gebruikt is.',
    };
  }
  if (input.hasApprovedContent) {
    return {
      exposure: 'approved',
      severity: 'medium',
      reasonNl:
        'De content is goedgekeurd maar nog niet geëxporteerd of gepubliceerd. Laat iemand de goedkeuring opnieuw bekijken.',
    };
  }
  return {
    exposure: 'draft',
    severity: 'low',
    reasonNl:
      'Er is nog niets goedgekeurd of geëxporteerd. Opnieuw genereren met het bijgewerkte onderzoek is genoeg.',
  };
}
