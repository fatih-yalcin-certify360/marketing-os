import { z } from 'zod';
import { brandProfileVersion } from './brand.js';
import { marketPackageContent } from './market-package.js';
import { radarReport } from './radar.js';
export const campaignDeliverable = z.enum(['blog_faq', 'fit_check', 'google_studio']);
export type CampaignDeliverable = z.infer<typeof campaignDeliverable>;
export const deliverableRecommendations = z.object({
  items: z.array(z.object({ type: campaignDeliverable, reason: z.string().min(10).max(500), hypothesis: z.string().min(10).max(500), measurement: z.string().min(10).max(300) })).min(1).max(3),
  visualAdvice: z.string().min(10).max(500),
});
export const interactionStyle = z.enum(['scenario', 'dilemma', 'priorities']);
export const campaignPackageInput = z.object({
  mode: z.enum(['recommend', 'generate']),
  interactionStyle: interactionStyle.default('scenario'),
  selected: z.array(campaignDeliverable).max(3).default([]),
}).refine((x) => new Set(x.selected).size === x.selected.length && (x.mode === 'recommend' ? x.selected.length === 0 : x.selected.length > 0), 'Kies ten minste één uniek onderdeel voor productie.');
export const campaignPackageContent = marketPackageContent.extend({
  evidenceIds: z.array(z.uuid()).max(8),
  banner: marketPackageContent.shape.banner.extend({
    headline: z.string().min(5).max(45), body: z.string().min(10).max(95),
    question: z.string().min(5).max(65),
    options: z.array(z.object({ label: z.string().min(2).max(22), feedback: z.string().min(10).max(95) })).length(2),
  }),
});
export const campaignPackageReport = z.object({
  campaignId: z.uuid(), briefVersionId: z.uuid(), courseVersionId: z.uuid(),
  sourceRadarRunId: z.uuid().nullable(), sourceSnapshot: radarReport.nullable(),
  brand: brandProfileVersion,
  selected: z.array(campaignDeliverable), recommendations: deliverableRecommendations.nullable(),
  content: campaignPackageContent.nullable(),
  interactionStyle: interactionStyle.optional(),
  courseName: z.string(), courseUrl: z.url(), ctaLabel: z.string().max(200).optional(),
  confirmedFacts: z.array(z.object({ field: z.string(), label: z.string(), value: z.string() })),
  state: z.enum(['recommended', 'draft']), isMock: z.boolean(),
  promptVersion: z.string(),
});
export type CampaignPackageReport = z.infer<typeof campaignPackageReport>;
export interface CampaignPackageRun { id: string; createdAt: string; report: CampaignPackageReport; stale: boolean; }
