import { z } from 'zod';
export const audienceFindingProposal = z.object({
  sourceUrl: z.url(),
  sourceKind: z.enum([
    'employer_team',
    'vacancy',
    'alumni_story',
    'course_audience',
  ]),
  organization: z.string().max(150),
  role: z.string().min(2).max(150),
  excerpt: z.string().min(20).max(650),
  sector: z.string().max(150).nullable(),
  sectorExcerpt: z.string().min(10).max(400).nullable(),
  educationProvider: z.string().max(150).nullable(),
  educationExcerpt: z.string().min(20).max(500).nullable(),
  hypothesis: z.string().min(10).max(500),
  uncertainty: z.string().min(10).max(400),
});
export const competitorEvidence = z.object({
  sourceUrl: z.url().max(2000),
  organization: z.string().max(150),
  excerpt: z.string().min(20).max(500),
  reason: z.string().min(10).max(350),
});
export const audienceAnalysis = z.object({
  competitors: z.array(competitorEvidence).max(2).default([]),
  findings: z.array(audienceFindingProposal).max(6),
  note: z.string().max(700),
});
export const audienceFinding = audienceFindingProposal.extend({
  id: z.uuid(),
  retrievedAt: z.string(),
});
export type AudienceFinding = z.infer<typeof audienceFinding>;
export const audienceReport = z.object({
  competitors: z.array(competitorEvidence).default([]),
  findings: z.array(audienceFinding),
  checkedSources: z.number().int().nonnegative(),
  independentDomains: z.number().int().nonnegative(),
  notes: z.array(z.string()),
});
export type AudienceReport = z.infer<typeof audienceReport>;
