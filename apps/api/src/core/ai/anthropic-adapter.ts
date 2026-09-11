import { z } from 'zod';
import type { ServerEnv } from '@c360/config';
import {
  AiInvalidOutputError,
  AiUnavailableError,
  type AiProvider,
  type AiUsage,
  type ImageGenerationAdapter,
  type ResearchAdapter,
  type StructuredRequest,
  type StructuredResult,
  type TextGenerationAdapter,
} from './types.js';

/**
 * Anthropic text adapter.
 *
 * Called over plain HTTPS rather than through the SDK: the surface used here is
 * one endpoint, and avoiding the dependency keeps the production bundle small
 * and the failure modes explicit.
 *
 * Three properties matter:
 *
 *  - **Structured output is enforced, not requested.** The schema is sent as a
 *    tool definition and the model must call that tool, so the response is
 *    already JSON of the right shape. It is then validated with Zod anyway,
 *    because a tool call is a strong hint and not a guarantee.
 *  - **Repair is bounded.** One repair attempt, carrying the validation errors
 *    back. After that the job fails as `provider_invalid_output` — it never
 *    degrades into a partially-trusted result.
 *  - **Retrieved and user content never becomes an instruction.** It is passed
 *    inside the user message as delimited data, and the system prompt states
 *    that instructions found in it must be ignored (threat T-05).
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * Per-million-token prices in eurocents, used only to *estimate* cost before a
 * call and to derive an actual figure from returned token counts.
 *
 * These are configuration, not fact: they are not fetched from the provider and
 * will drift. `usage_records` keeps estimated and actual apart precisely so a
 * stale price here cannot be mistaken for billing truth.
 */
const PRICE_PER_MTOK_CENTS: Readonly<Record<string, { input: number; output: number }>> =
  Object.freeze({
    'claude-sonnet-5': { input: 300, output: 1_500 },
    'claude-opus-5': { input: 1_500, output: 7_500 },
    'claude-haiku-4-5-20251001': { input: 100, output: 500 },
  });

const anthropicResponse = z.object({
  content: z.array(
    z.union([
      z.object({ type: z.literal('text'), text: z.string() }),
      z.object({
        type: z.literal('tool_use'),
        name: z.string(),
        input: z.unknown(),
      }),
      z.object({ type: z.string() }).loose(),
    ]),
  ),
  stop_reason: z.string().nullable().optional(),
  usage: z
    .object({
      input_tokens: z.number().int().optional(),
      output_tokens: z.number().int().optional(),
    })
    .optional(),
});

const TOOL_NAME = 'lever_resultaat';

export class AnthropicTextAdapter implements TextGenerationAdapter {
  public readonly provider = 'anthropic';
  public readonly model: string;
  public readonly isMock = false;

  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(env: ServerEnv) {
    if (env.ANTHROPIC_API_KEY === undefined) {
      throw new Error('AnthropicTextAdapter requires ANTHROPIC_API_KEY.');
    }
    this.apiKey = env.ANTHROPIC_API_KEY;
    this.model = env.AI_TEXT_MODEL;
    this.timeoutMs = env.AI_REQUEST_TIMEOUT_MS;
  }

  /** Cost estimate used to reserve budget before the call is made. */
  estimateCostCents(inputChars: number, maxOutputTokens: number): number {
    const price = PRICE_PER_MTOK_CENTS[this.model] ?? { input: 300, output: 1_500 };
    // ~4 characters per token is a rough but adequate planning figure; the
    // reservation is released and replaced by the actual afterwards.
    const inputTokens = Math.ceil(inputChars / 4);
    const cents =
      (inputTokens / 1_000_000) * price.input + (maxOutputTokens / 1_000_000) * price.output;
    return Math.max(1, Math.ceil(cents));
  }

  async generateStructured<TSchema extends z.ZodTypeAny>(
    request: StructuredRequest<TSchema>,
  ): Promise<StructuredResult<z.infer<TSchema>>> {
    const started = Date.now();
    const jsonSchema = z.toJSONSchema(request.schema, { io: 'output' });

    let repairAttempts = 0;
    let lastIssues: string[] = [];
    let messages: { role: 'user' | 'assistant'; content: unknown }[] = [
      { role: 'user', content: request.user },
    ];

    // One initial attempt plus one bounded repair. Never an unbounded loop:
    // that would burn budget on a model that cannot satisfy the schema.
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      const body = {
        model: this.model,
        max_tokens: request.maxOutputTokens,
        system: request.system,
        tools: [
          {
            name: TOOL_NAME,
            description:
              'Lever het resultaat uitsluitend via dit hulpmiddel, volgens het opgegeven schema.',
            input_schema: jsonSchema,
          },
        ],
        // Forces the tool call, so the response is structured by construction.
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages,
      };

      const parsed = await this.call(body, request.signal);
      const toolUse = parsed.content.find(
        (block): block is { type: 'tool_use'; name: string; input: unknown } =>
          'type' in block && block.type === 'tool_use',
      );

      const usage: AiUsage = {
        inputTokens: parsed.usage?.input_tokens ?? null,
        outputTokens: parsed.usage?.output_tokens ?? null,
        latencyMs: Date.now() - started,
        actualCostCents: this.actualCost(
          parsed.usage?.input_tokens ?? null,
          parsed.usage?.output_tokens ?? null,
        ),
      };

      if (toolUse === undefined) {
        lastIssues = ['Het model gaf geen structureel resultaat terug.'];
      } else {
        const validated = request.schema.safeParse(toolUse.input);
        if (validated.success) {
          return { value: validated.data, usage, repairAttempts };
        }
        lastIssues = validated.error.issues.map(
          (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
        );
      }

      if (attempt === 0) {
        repairAttempts += 1;
        messages = [
          ...messages,
          { role: 'assistant', content: parsed.content },
          {
            role: 'user',
            content:
              `Het resultaat voldeed niet aan het schema. Corrigeer precies deze punten en lever opnieuw via ${TOOL_NAME}:\n` +
              lastIssues.map((issue) => `- ${issue}`).join('\n'),
          },
        ];
      }
    }

    throw new AiInvalidOutputError(request.promptTemplate, lastIssues, repairAttempts);
  }

  private actualCost(inputTokens: number | null, outputTokens: number | null): number | null {
    if (inputTokens === null || outputTokens === null) {
      return null;
    }
    const price = PRICE_PER_MTOK_CENTS[this.model];
    if (price === undefined) {
      // Unknown model: report no actual cost rather than a made-up one.
      return null;
    }
    const cents =
      (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
    return Math.ceil(cents);
  }

  private async call(
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<z.infer<typeof anthropicResponse>> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    // Honour cancellation from the job runner as well as our own timeout.
    signal?.addEventListener('abort', () => {
      controller.abort();
    });

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.name : 'network error';
      throw new AiUnavailableError('anthropic', detail, true);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // 429 and 5xx are worth retrying; a 4xx is our own mistake and is not.
      const retryable = response.status === 429 || response.status >= 500;
      throw new AiUnavailableError(
        'anthropic',
        `HTTP ${String(response.status)}`,
        retryable,
      );
    }

    const json: unknown = await response.json();
    const parsed = anthropicResponse.safeParse(json);
    if (!parsed.success) {
      throw new AiInvalidOutputError(
        'anthropic.envelope',
        parsed.error.issues.map((issue) => issue.message),
        0,
      );
    }
    return parsed.data;
  }
}

/**
 * Anthropic provider.
 *
 * `research()` and `image()` return undefined: these models do not generate
 * images, and controlled web research needs the SSRF-safe fetcher that is not
 * built yet. Callers therefore receive `capability_unavailable` and say so —
 * which is the required behaviour, rather than simulating the capability.
 */
export class AnthropicProvider implements AiProvider {
  public readonly name = 'anthropic';
  public readonly isMock = false;
  private readonly textAdapter: AnthropicTextAdapter;

  constructor(env: ServerEnv) {
    this.textAdapter = new AnthropicTextAdapter(env);
  }

  text(): TextGenerationAdapter {
    return this.textAdapter;
  }

  research(): ResearchAdapter | undefined {
    return undefined;
  }

  image(): ImageGenerationAdapter | undefined {
    return undefined;
  }
}
