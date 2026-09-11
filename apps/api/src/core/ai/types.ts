import type { z } from 'zod';

/**
 * AI provider layer (ADR-0013).
 *
 * Capabilities are separate interfaces on purpose. A provider that cannot
 * generate images simply does not implement `ImageGenerationAdapter`, and the
 * caller receives `capability_unavailable` — an honest answer. A single
 * monolithic client would force stub methods that either throw or, worse,
 * return plausible-looking empty results.
 *
 * Two rules hold for every adapter:
 *  - the response is validated against a Zod schema before it is used, and an
 *    invalid response is a *failure*, never a partially-trusted success;
 *  - the adapter reports token counts and latency so cost can be recorded as
 *    estimated and actual separately.
 */

export type AiCapability = 'text' | 'research' | 'image';

export interface AiUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  /** What the provider actually charged, in eurocents, when it can be derived. */
  actualCostCents: number | null;
}

export interface StructuredRequest<TSchema extends z.ZodTypeAny> {
  /** Identifies the prompt template, recorded on the usage row. */
  webSearch?: boolean;
  promptTemplate: string;
  /** Bumped whenever the template changes, so output stays traceable. */
  promptVersion: string;
  /** Instructions the model must follow. Never contains retrieved content. */
  system: string;
  /**
   * The task input.
   *
   * Retrieved pages, uploaded documents and user text are placed here as
   * clearly-delimited *data*, never merged into `system`. Content inside this
   * field is untrusted: it may contain instructions, and those instructions
   * must not be followed (threat T-05).
   */
  user: string;
  /** The shape the response must have. Enforced, not requested politely. */
  schema: TSchema;
  /** Upper bound on output size, so a runaway response cannot burn budget. */
  maxOutputTokens: number;
  /** Cancellation from the job runner. */
  signal?: AbortSignal | undefined;
}

export interface StructuredResult<T> {
  sources?: string[];
  value: T;
  usage: AiUsage;
  /** How many repair attempts were needed. >0 is worth logging. */
  repairAttempts: number;
}

export interface TextGenerationAdapter {
  readonly provider: string;
  readonly model: string;
  /** True for adapters whose output is fabricated and must be labelled. */
  readonly isMock: boolean;
  readonly supportsWebSearch?: boolean;
  generateStructured<TSchema extends z.ZodTypeAny>(
    request: StructuredRequest<TSchema>,
  ): Promise<StructuredResult<z.infer<TSchema>>>;
  /**
   * Pessimistic cost estimate in eurocents, used to reserve budget *before* the
   * call. Absent on a free adapter (the mock), which is why it is optional
   * rather than returning 0 — an adapter that cannot price itself should say
   * so instead of claiming to be free.
   */
  estimateCostCents?(inputChars: number, maxOutputTokens: number): number;
}

export interface ResearchFinding {
  claim: string;
  sourceUrl: string;
  retrievedAt: string;
  /** The passage the claim rests on, so a reviewer can check it. */
  excerpt: string;
}

export interface ResearchAdapter {
  readonly provider: string;
  readonly isMock: boolean;
  research(input: {
    question: string;
    /** Hostname suffixes the fetch is confined to, when configured. */
    allowedHostSuffixes: readonly string[];
    maxFindings: number;
    signal?: AbortSignal | undefined;
  }): Promise<{ findings: ResearchFinding[]; usage: AiUsage }>;
}

export interface ImageGenerationAdapter {
  readonly quality?: string;
  readonly model?: string;
  readonly provider: string;
  readonly isMock: boolean;
  /** Pessimistic per-image estimate in eurocents, for budget reservation. */
  estimateCostCents?(): number;
  generateImage(input: {
    references?: readonly { bytes: Buffer; mimeType: string }[] | undefined;
    prompt: string;
    widthPx: number;
    heightPx: number;
    signal?: AbortSignal | undefined;
  }): Promise<{ png: Buffer; usage: AiUsage }>;
}

/**
 * What the application asks for a capability.
 *
 * Returning `undefined` rather than throwing lets a caller decide how to
 * present the absence — the brief stage can carry on without research, while
 * content generation cannot carry on without text.
 */
export interface AiProvider {
  readonly name: string;
  readonly isMock: boolean;
  text(): TextGenerationAdapter | undefined;
  research(): ResearchAdapter | undefined;
  image(): ImageGenerationAdapter | undefined;
}

/** Thrown when a provider response cannot be made to satisfy its schema. */
export class AiInvalidOutputError extends Error {
  constructor(
    public readonly promptTemplate: string,
    public readonly issues: readonly string[],
    public readonly repairAttempts: number,
  ) {
    super(
      `Provider output failed schema validation for ${promptTemplate} after ${String(repairAttempts)} repair attempt(s): ${issues.join('; ')}`,
    );
    this.name = 'AiInvalidOutputError';
  }
}

/** Thrown when the provider is unreachable, rate-limited or times out. */
export class AiUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    detail: string,
    public readonly retryable = true,
  ) {
    super(`AI provider ${provider} unavailable: ${detail}`);
    this.name = 'AiUnavailableError';
  }
}
