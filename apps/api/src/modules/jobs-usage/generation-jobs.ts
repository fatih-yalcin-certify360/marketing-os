import type { CurrentUser, JobSummary, JobType } from '@c360/contracts';
import type { Db } from '../../core/db/types.js';
import type { GenerationService } from '../../core/ai/generation.js';
import { fairUseError, type FairUseLimiter } from '../../core/http/fair-use.js';
import type { JobService } from './service.js';

/**
 * Enqueues generation work instead of running it in the request.
 *
 * This is the whole answer to "no timeouts": a request writes a job row and
 * returns in milliseconds, and the model call happens on the worker where
 * minutes are normal. Nothing about the business rules moved — the same
 * services run, and their gates still refuse in the same places.
 *
 * Two properties are worth being explicit about:
 *
 *  - **Budget is reserved at enqueue.** A pessimistic estimate is held the
 *    moment the job is created, so a hundred queued jobs count against the
 *    label's ceiling before any of them runs. The worker settles the difference
 *    against the actual token cost once the job finishes.
 *  - **Double submits collapse.** The idempotency key is derived from the
 *    target artefact, so an impatient second click returns the *same* job
 *    rather than paying twice for the same generation.
 */

/** How many provider calls a job type is expected to make. */
const CALLS_PER_JOB: Readonly<Record<string, number>> = Object.freeze({
  'course.extract_from_documents': 1,
  'course.extract_from_url': 1,
  'research.run': 1,
  // discover, analyze, audience, keywords and the synthesis of the market picture.
  'radar.scan': 5,
  // The proposal, then one questionnaire call per persona (up to three).
  'persona.propose': 4,
  // One questionnaire call for one stored persona.
  'persona.fill_questionnaire': 1,
  // One call over the same material, for where that audience orients.
  'persona.fill_orientation': 1,
  'opportunity.propose': 1,
  'brief.draft': 1,
  'concept.propose': 1,
  'content.plan': 1,
  // One text call per funnel stage — a full-funnel campaign makes three —
  // then image work.
  // Up to three calls per stage: the social and advert channels together, then
  // the website piece and the e-mail each on their own, so a long piece has
  // the whole output budget; one repair call may follow each.
  'content.generate': 9,
  // One piece: the text call, plus one repair round if the shape is wrong.
  'content.standalone': 2,
  'content.revise': 1,
});

/** Images a job type may render, for the reservation. */
const IMAGES_PER_JOB: Readonly<Record<string, number>> = Object.freeze({
  // Three stages × three social channels × two variants. Pages, mails and
  // adverts render no image, so this is the ceiling, not the usual case.
  'content.generate': 18,
  'content.revise': 2,
  // One generated scene rendered into two variants, for an image channel.
  'content.standalone': 2,
});

/** Up to three personas can each carry 36 answers of 1,000 characters. */
const PERSONA_CONTEXT_JOBS: ReadonlySet<JobType> = new Set([
  'opportunity.propose', 'brief.draft', 'concept.propose', 'content.plan',
  'content.generate', 'content.revise',
]);

export class GenerationJobService {
  constructor(
    private readonly jobs: JobService,
    private readonly generation: GenerationService,
    /**
     * Pacing for work that costs money.
     *
     * Checked here rather than in a route hook so that every enqueue path is
     * covered, including any future non-HTTP entry point. It is pacing only —
     * the label's spending ceiling is enforced separately and atomically in
     * PostgreSQL, because that is the control that must hold across replicas.
     */
    private readonly fairUse: FairUseLimiter,
  ) {}

  /**
   * Cost to hold for a job.
   *
   * Deliberately pessimistic. A reservation that is too small lets a label
   * exceed its ceiling; one that is too large is released again within seconds
   * of the job finishing, so erring high is the safe direction.
   */
  private estimateFor(type: JobType): number {
    if (type === 'persona.extract_from_text') return this.generation.estimatePerCallCents(30_000);
    if (type === 'campaign.package') return this.generation.estimatePerCallCents(200_000);
    if (type === 'geo.research') return 2 * this.generation.estimatePerCallCents(120_000) + 100;
    if (type === 'radar.scan') return 5 * this.generation.estimatePerCallCents(180_000) + 100;
    const calls = CALLS_PER_JOB[type] ?? 1;
    const images = IMAGES_PER_JOB[type] ?? 0;
    // The shared creative dossier adds bounded source excerpts and channel
    // rationale to image-producing content calls; it makes no extra AI call.
    const creativeChars = type === 'content.generate' || type === 'content.revise' ? 50_000 : 0;
    const inputChars = (type === 'research.run' ? 100_000 : 8_000) + (PERSONA_CONTEXT_JOBS.has(type) ? 140_000 : 0) + creativeChars;
    return (
      calls * this.generation.estimatePerCallCents(inputChars) +
      images * this.generation.estimatePerImageCents()
    );
  }

  /**
   * Queues a generation job and returns it immediately.
   *
   * `intent` identifies *what is being generated*, not *when*, so a repeated
   * request for the same artefact is recognised as the same work.
   */
  async enqueue(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      type: JobType;
      intent: readonly string[];
      payload: Record<string, unknown>;
      requestId?: string | undefined;
      clientAddress?: string | undefined;
    },
  ): Promise<{ summary: JobSummary; created: boolean }> {
    const decision = this.fairUse.checkGeneration(user.userId, input.labelId);
    if (!decision.allowed) {
      throw fairUseError(decision);
    }

    return this.jobs.enqueueForLabel(db, user, {
      labelId: input.labelId,
      type: input.type,
      // The user id travels in the payload so the worker re-resolves their
      // permissions rather than inheriting them from this request.
      payload: { ...input.payload, labelId: input.labelId, userId: user.userId },
      intent: input.intent,
      estimatedCostCents: this.estimateFor(input.type),
      // Generation is slow and retrying is expensive; three attempts is enough
      // to ride out a rate limit without multiplying cost.
      maxAttempts: 3,
      // A deliberate new import supplies a new request key; replaying the old
      // key after a lost response must never buy another completed extraction.
      reuseTerminalJob: input.type === 'persona.extract_from_text',
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      ...(input.clientAddress === undefined ? {} : { clientAddress: input.clientAddress }),
    });
  }
}
