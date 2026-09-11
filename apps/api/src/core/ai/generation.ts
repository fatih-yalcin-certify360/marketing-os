import type { z } from 'zod';
import type { ServerEnv } from '@c360/config';
import type { Db } from '../db/types.js';
import { AppError } from '../errors/app-error.js';
import { UsageRecorder } from '../../modules/jobs-usage/usage.js';
import { BudgetService } from '../../modules/jobs-usage/budget.js';
import { buildContextBlock, PROMPT_VERSIONS, systemPromptFor } from './prompts.js';
import type { PromptContext, PromptTemplate } from './prompts.js';
import {
  AiInvalidOutputError,
  AiUnavailableError,
  type AiProvider,
  type TextGenerationAdapter,
} from './types.js';

/**
 * The one place a generation call is made.
 *
 * Everything the requirements demand around an AI call happens here, once,
 * rather than being repeated in each domain module:
 *
 *  - budget is **reserved before** the call and settled with the *actual* cost
 *    after it, so pending work counts against the ceiling;
 *  - one usage row per (job, attempt, kind), so a retried attempt cannot
 *    double-charge;
 *  - the prompt template and its version are recorded on the usage row and
 *    returned for storage on the produced artefact, keeping output traceable;
 *  - a provider failure becomes an `AppError` with a Dutch message — it is
 *    never converted into an empty-but-successful result.
 */

export interface GenerationRequest<TSchema extends z.ZodTypeAny> {
  webSearch?: boolean;
  template: PromptTemplate;
  schema: TSchema;
  context: PromptContext;
  organizationId: string;
  labelId: string;
  /** Present when running inside a job, so usage rows are idempotent. */
  jobId?: string | null;
  attempt?: number;
  signal?: AbortSignal | undefined;
}

export interface GenerationResult<T> {
  sources?: string[];
  value: T;
  promptVersion: string;
  isMock: boolean;
  actualCostCents: number;
  latencyMs: number;
}

export class GenerationService {
  private readonly usage = new UsageRecorder();
  private readonly budget: BudgetService;

  constructor(
    private readonly provider: AiProvider,
    private readonly env: ServerEnv,
  ) {
    this.budget = new BudgetService(env.AI_DEFAULT_LABEL_BUDGET_CENTS);
  }

  get supportsWebSearch(): boolean { return this.provider.text()?.supportsWebSearch === true; }

  get isMock(): boolean {
    return this.provider.isMock;
  }

  get providerName(): string {
    return this.provider.name;
  }

  /**
   * What one generation call is expected to cost, in eurocents.
   *
   * Used to size a job's reservation at enqueue time, so pending work counts
   * against the label's ceiling before the worker picks it up.
   */
  estimatePerCallCents(inputChars = 8_000): number {
    const adapter = this.provider.text();
    if (adapter?.estimateCostCents === undefined) {
      return 0;
    }
    // A generous fixed input size: prompts here are a few thousand characters.
    return adapter.estimateCostCents(inputChars, this.env.AI_MAX_OUTPUT_TOKENS);
  }

  /** Per-image estimate, or 0 when image generation is not configured. */
  estimatePerImageCents(): number {
    return this.provider.image()?.estimateCostCents?.() ?? 0;
  }

  /**
   * Text adapter, or a clear refusal.
   *
   * A provider without text generation cannot run this product's chain, so this
   * is a hard failure with an explanatory Dutch message rather than a silent
   * fallback to the mock (ADR-0013).
   */
  private requireText(): TextGenerationAdapter {
    const adapter = this.provider.text();
    if (adapter === undefined) {
      throw new AppError('capability_unavailable', {
        publicMessage:
          'De ingestelde AI-aanbieder ondersteunt geen tekstgeneratie. Neem contact op met beheer.',
        context: { provider: this.provider.name },
      });
    }
    return adapter;
  }

  async generate<TSchema extends z.ZodTypeAny>(
    db: Db,
    request: GenerationRequest<TSchema>,
  ): Promise<GenerationResult<z.infer<TSchema>>> {
    const adapter = this.requireText();
    if (request.webSearch && !this.supportsWebSearch) throw new AppError('capability_unavailable', { publicMessage: 'Webzoeken is niet beschikbaar bij deze aanbieder. Schakel zoeken uit en voeg bronlinks toe.' });
    const promptVersion = PROMPT_VERSIONS[request.template];
    const system = systemPromptFor(request.template);
    const user = buildContextBlock(request.context);
    const maxOutputTokens = this.env.AI_MAX_OUTPUT_TOKENS;

    const estimatedCostCents =
      (adapter.estimateCostCents?.(system.length + user.length, maxOutputTokens) ?? 0) + (request.webSearch ? 100 : 0);

    /**
     * Who holds the budget depends on where this runs.
     *
     * Inside a job (`jobId` set) the job already reserved an estimate at
     * enqueue time, and the runner settles it once when the job finishes —
     * reserving again here would double-count the same work. Outside a job the
     * call reserves for itself, before the request is made, so a burst cannot
     * all spend before any of them was checked.
     */
    const reserveHere = request.jobId == null && estimatedCostCents > 0;
    if (reserveHere) {
      await this.budget.reserve(db, request.organizationId, request.labelId, estimatedCostCents);
    }

    try {
      const result = await adapter.generateStructured({
        ...(request.webSearch ? { webSearch: true } : {}),
        promptTemplate: request.template,
        promptVersion,
        system,
        user,
        schema: request.schema,
        maxOutputTokens,
        signal: request.signal,
      });

      const actualCostCents = result.usage.actualCostCents ?? 0;
      const settlementCost = request.webSearch ? result.usage.actualCostCents ?? estimatedCostCents : actualCostCents;

      await this.usage.record(db, {
        organizationId: request.organizationId,
        labelId: request.labelId,
        jobId: request.jobId ?? null,
        attempt: request.attempt ?? 0,
        unitKey: request.template,
        kind: request.webSearch ? 'ai_research' : 'ai_text',
        provider: adapter.provider,
        model: adapter.model,
        promptTemplate: request.template,
        promptVersion,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCostCents,
        actualCostCents: result.usage.actualCostCents,
        latencyMs: result.usage.latencyMs,
      });

      // Release our own hold and commit what was really spent. Inside a job the
      // runner does this once for the whole job instead.
      if (reserveHere) {
        await this.budget.settle(db, request.labelId, estimatedCostCents, settlementCost);
      }

      return {
        sources: result.sources ?? [],
        value: result.value,
        promptVersion,
        isMock: adapter.isMock,
        actualCostCents,
        latencyMs: result.usage.latencyMs,
      };
    } catch (error: unknown) {
      // Nothing was produced, so release the whole hold. Charging for a failed
      // call would make the budget drift away from reality.
      if (reserveHere) {
        await this.budget
          .settle(db, request.labelId, estimatedCostCents, 0)
          .catch(() => undefined);
      }
      throw toAppError(error, request.template);
    }
  }
}

/**
 * Maps a provider failure onto our error model.
 *
 * The distinction that matters: `provider_unavailable` is retryable (the job
 * runner will back off and try again), `provider_invalid_output` is retryable
 * once, and neither ever yields a successful-looking empty result.
 */
function toAppError(error: unknown, template: string): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof AiUnavailableError) {
    return new AppError('provider_unavailable', {
      publicMessage:
        'De AI-aanbieder is nu niet bereikbaar. Er is niets gewijzigd; je kunt het opnieuw proberen.',
      internalDetail: error.message,
      context: { template, retryable: error.retryable },
    });
  }
  if (error instanceof AiInvalidOutputError) {
    return new AppError('provider_invalid_output', {
      publicMessage:
        'Het antwoord van de AI-aanbieder was onbruikbaar. Er is niets opgeslagen; probeer het opnieuw.',
      internalDetail: error.message,
      context: { template, repairAttempts: error.repairAttempts },
    });
  }
  return new AppError('internal_error', {
    internalDetail: error instanceof Error ? error.message : 'unknown generation failure',
    context: { template },
    cause: error,
  });
}
