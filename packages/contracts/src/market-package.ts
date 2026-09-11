import { z } from 'zod';
import { webUrl } from './primitives.js';

export const keywordAnalysis = z.object({
  items: z.array(z.object({
    phrase: z.string().min(5).max(180),
    kind: z.enum(['page_question', 'suggested_query']),
    sourceUrl: webUrl.max(2000),
    excerpt: z.string().min(20).max(500),
    intent: z.enum(['informational', 'comparison', 'course_choice']),
    rationale: z.string().min(10).max(350),
  })).max(8),
  note: z.string().max(700),
});
export const keywordReport = z.object({
  items: z.array(keywordAnalysis.shape.items.element.extend({
    id: z.uuid(), retrievedAt: z.string(),
    monthlyVolume: z.null(), cpc: z.null(), difficulty: z.null(),
  })),
  notes: z.array(z.string()),
});
export type KeywordReport = z.infer<typeof keywordReport>;
export const packageDeliverable = z.enum(['blog_faq', 'fit_check', 'site_banner']);
export type PackageDeliverable = z.infer<typeof packageDeliverable>;
export const packageSelection = z.array(packageDeliverable).max(3).refine(
  (items) => new Set(items).size === items.length, 'Kies elk onderdeel eenmaal.',
);
export const marketPackageContent = z.object({
  title: z.string().min(5).max(150),
  intro: z.string().min(20).max(700),
  sections: z.array(z.object({ heading: z.string().min(3).max(150), text: z.string().min(20).max(1800) })).min(2).max(4),
  faq: z.array(z.object({ question: z.string().min(5).max(180), answer: z.string().min(10).max(600) })).min(2).max(4),
  reflection: z.array(z.object({
    question: z.string().min(5).max(180),
    options: z.array(z.object({ label: z.string().min(2).max(160), guidance: z.string().min(10).max(400) })).length(3),
  })).length(3),
  banner: z.object({ headline: z.string().min(5).max(80), body: z.string().min(10).max(180) }),
  evidenceIds: z.array(z.uuid()).min(1).max(8),
  reviewNotes: z.array(z.string().max(400)).max(6),
});
export const marketPackage = z.object({
  selected: packageSelection,
  status: z.literal('draft'),
  brandProfileVersionId: z.uuid().nullable().default(null),
  confirmedFacts: z.array(z.object({ field: z.string(), label: z.string(), value: z.string() })).default([]),
  content: marketPackageContent.nullable(),
  courseUrl: z.url().nullable(),
  notes: z.array(z.string()),
});
export type MarketPackage = z.infer<typeof marketPackage>;
