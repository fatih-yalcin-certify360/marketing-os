import { keywordReport, marketPackage, packageSelection } from './market-package.js';
import { z } from 'zod';
import { webUrl } from './primitives.js';
import { audienceReport } from './audience.js';
import { advertisingReport } from './advertisements.js';

export const radarApproach = z.object({
  title: z.string().min(3).max(150),
  format: z.string().max(100),
  idea: z.string().min(10).max(1200),
  audience: z.string().max(300),
});
export const radarProposal = z.object({
  sourceUrl: webUrl.max(2000),
  organization: z.string().max(200),
  relationship: z.enum([
    'competitor',
    'adjacent',
    'own_brand',
    'authority',
    'uncertain',
  ]),
  relationshipReason: z.string().min(10).max(700),
  title: z.string().min(3).max(200),
  observation: z.string().min(10).max(1200),
  excerpt: z.string().min(20).max(1000),
  relevance: z.string().min(10).max(1000),
  publishedDate: z.string().max(100).nullable(),
  dateExcerpt: z.string().max(300).nullable(),
  period: z.string().max(200).nullable(),
  uncertainty: z.string().max(700),
  approaches: z.array(radarApproach).length(3),
});
export const radarAnalysis = z.object({
  cards: z.array(radarProposal).max(6),
  note: z.string().max(1000),
});
export const radarDiscovery = z.object({
  urls: z.array(z.url().max(2000)).max(10),
});
export const radarCard = radarProposal.extend({
  id: z.uuid(),
  retrievedAt: z.string(),
  contentHash: z.string(),
  imageUrl: z.url().nullable(),
  materialType: z.literal('web_page'),
  change: z.enum(['first_seen', 'changed', 'unchanged']),
});
export type RadarCard = z.infer<typeof radarCard>;
export const radarReport = z.object({
  keywords: keywordReport.nullable().default(null),
  package: marketPackage.nullable().default(null),
  audience: audienceReport.nullable().default(null),
  advertising: advertisingReport.nullable().default(null),
  cards: z.array(radarCard),
  notes: z.array(z.string()),
  failures: z.array(z.object({ url: z.string(), reason: z.string() })),
  isMock: z.boolean(),
});
export type RadarReport = z.infer<typeof radarReport>;
export interface RadarRun {
  id: string;
  courseVersionId: string;
  createdAt: string;
  report: RadarReport;
}
export const radarScanInput = z.object({
  urls: z.array(z.url().max(2000)).max(10).default([]),
  discover: z.boolean().default(true),
  includeKeywords: z.boolean().default(true),
  deliverables: packageSelection.default([]),
  includeAds: z.boolean().default(true),
});
