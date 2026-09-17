import { z } from 'zod';
import { brandProfileVersion } from './brand.js';
import { marketPackageContent } from './market-package.js';
import { radarReport } from './radar.js';
import { funnelStage } from './funnel.js';
export const campaignDeliverable = z.enum(['blog_faq', 'fit_check', 'google_studio']);
export type CampaignDeliverable = z.infer<typeof campaignDeliverable>;
export const deliverableRecommendations = z.object({
  items: z.array(z.object({
    type: campaignDeliverable,
    /**
     * The funnel stage this form serves in this campaign, from the stages the
     * objective covers. Required from the model (`.default(null)` keeps older
     * stored reports readable); null only for reports made before stages.
     */
    stage: funnelStage.nullable().default(null),
    reason: z.string().min(10).max(500),
    hypothesis: z.string().min(10).max(500),
    measurement: z.string().min(10).max(300),
  })).min(1).max(3),
  visualAdvice: z.string().min(10).max(500),
});
export const interactionStyle = z.enum(['scenario', 'dilemma', 'priorities']);
export const campaignPackageInput = z.object({
  mode: z.enum(['recommend', 'generate']),
  interactionStyle: interactionStyle.default('scenario'),
  selected: z.array(campaignDeliverable).max(3).default([]),
}).refine((x) => new Set(x.selected).size === x.selected.length && (x.mode === 'recommend' ? x.selected.length === 0 : x.selected.length > 0), 'Kies ten minste één uniek onderdeel voor productie.');
/**
 * What an answer says about the reader's fit with this course, as the quiz
 * reads it: `fit` — the course answers the situation the option describes;
 * `explore` — first orient further, the course may follow; `other` — a
 * different direction or an already-held qualification. The quiz counts
 * these across the answers and shows the matching outcome; there is no
 * score, no percentage and no admission verdict.
 */
export const quizSignal = z.enum(['fit', 'explore', 'other']);
export type QuizSignal = z.infer<typeof quizSignal>;
export const quizOutcome = z.object({
  title: z.string().min(5).max(120),
  /** What the answers say and what the reader best does now, 60–120 words. */
  text: z.string().min(40).max(900),
  nextSteps: z.array(z.string().min(5).max(220)).min(1).max(4),
});
export type QuizOutcome = z.infer<typeof quizOutcome>;
export const quizOutcomes = z.object({ fit: quizOutcome, explore: quizOutcome, other: quizOutcome });
export type QuizOutcomes = z.infer<typeof quizOutcomes>;

/**
 * Words in a call to action that promise an interactive website form — a
 * keuzehulp, a quiz, a checklist. Such a promise is only honest when the
 * campaign makes that form in the Website & interactief branch and links to
 * the page it is embedded on; the interface says so wherever the promise
 * appears.
 */
const INTERACTIVE_PROMISE = /\b(keuzehulp|keuzeverkenner|keuzewijzer|beslishulp|quiz|zelftest|zelfscan|checklist|kennistest)\b/iu;
export function promisesInteractiveForm(texts: readonly (string | null | undefined)[]): boolean {
  return texts.some((text) => typeof text === 'string' && INTERACTIVE_PROMISE.test(text));
}

export const campaignPackageContent = marketPackageContent.extend({
  evidenceIds: z.array(z.uuid()).max(8),
  /**
   * The quiz: three to five questions, each with three options that carry a
   * signal. `signal` defaults so reports stored before the quiz read back;
   * a report without `outcomes` renders the older reflection list.
   */
  reflection: z.array(z.object({
    question: z.string().min(5).max(180),
    options: z.array(z.object({
      label: z.string().min(2).max(160),
      guidance: z.string().min(10).max(400),
      signal: quizSignal.default('explore'),
    })).length(3),
  })).min(3).max(5),
  outcomes: quizOutcomes.nullable().default(null),
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

/** The four gates of the Website & interactief branch, as a checklist (2026-09-15). */
export interface PackageReadiness {
  ok: boolean;
  checks: { id: 'brief' | 'course' | 'destination' | 'brand'; ok: boolean; labelNl: string; hintNl: string | null }[];
  destination: string | null;
  /** The briefing's call to action promises a keuzehulp, quiz or checklist. */
  interactivePromised: boolean;
}

/** The produced pages as self-contained HTML for the sandboxed in-app preview (2026-09-15). */
export interface PackagePreview {
  stale: boolean;
  isMock: boolean;
  parts: { id: 'keuzehulp' | 'blog'; titleNl: string; html: string }[];
  embedHtml: string | null;
  noteNl: string;
}
