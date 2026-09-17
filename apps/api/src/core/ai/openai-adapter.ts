import { z } from 'zod';
import type { ServerEnv } from '@c360/config';
import { toStrictJsonSchema } from './strict-schema.js';
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
 * The OpenAI-compatible provider: OpenAI itself, or a gateway in front of it.
 *
 * Called over plain HTTPS rather than through the SDK: the surface used is two
 * endpoints, and avoiding the dependency keeps the production bundle small and
 * every failure mode explicit. That is also what makes a gateway a
 * configuration change rather than a second adapter — LiteLLM speaks the same
 * two endpoints, so only the base URL, the key and the *claims* differ
 * (2026-09-16).
 *
 * Design points:
 *
 *  - **Structured output is enforced by the provider.** The Responses API's
 *    `text.format` with `strict: true` guarantees the response matches the
 *    schema, so a malformed shape is impossible rather than merely unlikely.
 *    The result is still validated with Zod, because strict mode guarantees
 *    shape and not our business rules (see `strict-schema.ts`).
 *  - **Retryability is decided from the status code**, and a `Retry-After`
 *    header is honoured, so a rate limit backs off by the amount the provider
 *    asked for instead of a guess.
 *  - **Cost is derived from returned token counts** against a recorded price
 *    table. Estimated and actual stay in separate columns; a stale price here
 *    can never be mistaken for billing truth.
 *  - **Images are backgrounds only.** The logo and every piece of readable
 *    text are composited afterwards by our own render layer, because that is
 *    the one thing image models get wrong in a way that is not recoverable
 *    once published (requirement 8).
 *
 * Prices checked 2026-09-09 against
 * https://developers.openai.com/api/docs/pricing
 */

const OPENAI_BASE_URL = 'https://api.openai.com';

/**
 * Where this process sends generation calls, and who it says it is.
 *
 * One adapter serves OpenAI directly and any OpenAI-compatible gateway in
 * front of it — today LiteLLM. What changes between them is the base URL, the
 * key, and **what may be claimed**: a gateway's capabilities depend on the
 * model configured behind it, so they are resolved here from configuration
 * rather than assumed from the fact that the API shape matches.
 */
interface CompatibleEndpoint {
  /** Recorded on every usage row, so the ledger says which door the call went through. */
  provider: string;
  baseUrl: string;
  apiKey: string;
  organization: string | undefined;
  /** Whether the hosted web-search tool may be asked for. */
  webSearch: boolean;
  /** Eurocents per million tokens, when configuration supplies them. */
  price: ModelPrice | undefined;
  /** Euro per US dollar, for reading a gateway's own cost header. */
  usdToEur: number | undefined;
}

function endpointFor(env: ServerEnv): CompatibleEndpoint {
  if (env.AI_PROVIDER === 'litellm') {
    if (env.LITELLM_BASE_URL === undefined || env.LITELLM_API_KEY === undefined) {
      throw new Error('AI_PROVIDER=litellm requires LITELLM_BASE_URL and LITELLM_API_KEY.');
    }
    return {
      provider: 'litellm',
      baseUrl: env.LITELLM_BASE_URL.replace(/\/+$/u, ''),
      apiKey: env.LITELLM_API_KEY,
      // The virtual key identifies the caller; an OpenAI organisation header
      // means nothing to the proxy.
      organization: undefined,
      /*
       * Off unless the operator says otherwise.
       *
       * `web_search` is a tool OpenAI hosts. A gateway forwards it only when the
       * model behind it is one that has it, and asking for it elsewhere fails
       * the call rather than degrading. The product already refuses discovery
       * honestly when the provider cannot search (`canDiscover`), so the safe
       * default is the one that refuses.
       */
      webSearch: env.AI_WEB_SEARCH_ENABLED ?? false,
      price: configuredPrice(env),
      usdToEur: env.AI_COST_USD_TO_EUR_RATE,
    };
  }

  if (env.OPENAI_API_KEY === undefined) {
    throw new Error('The OpenAI-compatible adapter requires OPENAI_API_KEY.');
  }
  return {
    provider: 'openai',
    baseUrl: OPENAI_BASE_URL,
    apiKey: env.OPENAI_API_KEY,
    organization: env.OPENAI_ORGANIZATION,
    webSearch: env.AI_WEB_SEARCH_ENABLED ?? true,
    price: configuredPrice(env),
    usdToEur: env.AI_COST_USD_TO_EUR_RATE,
  };
}

/**
 * The price an operator configured for the text model, if any.
 *
 * A gateway's model name is an alias it defines, so our own table cannot know
 * it. Both halves are required together: half a price is not a price.
 */
function configuredPrice(env: ServerEnv): ModelPrice | undefined {
  const input = env.AI_TEXT_PRICE_INPUT_CENTS_PER_MTOK;
  const output = env.AI_TEXT_PRICE_OUTPUT_CENTS_PER_MTOK;
  return input === undefined || output === undefined ? undefined : { input, output };
}

/** Eurocents per 1M tokens. Configuration, not fact — see the note above. */
interface ModelPrice {
  input: number;
  output: number;
  imageInput?: number;
}

const TEXT_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  'gpt-6-astra': { input: 1_000, output: 5_000 },
  'gpt-5.6-sol': { input: 400, output: 2_000 },
  'gpt-5.6-terra': { input: 200, output: 1_200 },
  'gpt-5.6-luna': { input: 20, output: 120 },
  'gpt-5.5': { input: 500, output: 3_000 },
  'gpt-5.4': { input: 250, output: 1_500 },
  'gpt-5': { input: 125, output: 1_000 },
  'gpt-4o': { input: 250, output: 1_000 },
  'gpt-4o-mini': { input: 15, output: 60 },
});

const IMAGE_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  'gpt-image-2.5-sunburst': { input: 500, imageInput: 800, output: 3_000 },
  'gpt-image-2.5-flare': { input: 500, imageInput: 800, output: 3_000 },
  'gpt-image-2': { input: 500, output: 3_000 },
  'gpt-image-1.5': { input: 500, output: 3_200 },
  'gpt-image-1-mini': { input: 200, output: 800 },
});

/**
 * The cost a gateway reported for one call, in eurocents.
 *
 * LiteLLM sets `x-litellm-response-cost` in **dollars**. Every column in this
 * product is in eurocents, so the header is only read when a rate has been
 * configured: a currency conversion nobody chose is a figure nobody can check,
 * and this value lands in the ledger as an actual cost.
 */
function gatewayCostCents(response: Response, usdToEur: number | undefined): number | null {
  if (usdToEur === undefined) {
    return null;
  }
  const header = response.headers.get('x-litellm-response-cost');
  if (header === null) {
    return null;
  }
  const dollars = Number(header);
  if (!Number.isFinite(dollars) || dollars < 0) {
    return null;
  }
  return Math.ceil(dollars * usdToEur * 100);
}

/** Shape of a Responses API reply, validated before use. */
const responsesReply = z.object({
  status: z.string().optional(),
  incomplete_details: z.object({ reason: z.string() }).nullish(),
  output: z
    .array(
      z
        .object({
          type: z.string(),
          action: z.object({ sources: z.array(z.object({ url: z.string() }).loose()).optional() }).loose().optional(),
          content: z
            .array(z.object({ type: z.string(), text: z.string().optional() }).loose())
            .optional(),
        })
        .loose(),
    )
    .optional(),
  output_text: z.string().optional(),
  usage: z
    .object({
      input_tokens: z.number().int().optional(),
      output_tokens: z.number().int().optional(),
    })
    .optional(),
});

const imagesReply = z.object({
  data: z.array(z.object({ b64_json: z.string().optional() })),
  usage: z
    .object({
      input_tokens: z.number().int().optional(),
      output_tokens: z.number().int().optional(),
      input_tokens_details: z.object({ text_tokens: z.number().int(), image_tokens: z.number().int() }).optional(),
    })
    .optional(),
});

export class OpenAiTextAdapter implements TextGenerationAdapter {
  public readonly supportsWebSearch: boolean;
  public readonly provider: string;
  public readonly model: string;
  public readonly isMock = false;

  private readonly endpoint: CompatibleEndpoint;
  private readonly timeoutMs: number;
  /** The cost the gateway reported for the last call, in eurocents. */
  private lastGatewayCostCents: number | null = null;

  constructor(env: ServerEnv) {
    this.endpoint = endpointFor(env);
    this.provider = this.endpoint.provider;
    this.supportsWebSearch = this.endpoint.webSearch;
    this.model = env.AI_TEXT_MODEL;
    this.timeoutMs = env.AI_REQUEST_TIMEOUT_MS;
  }

  /**
   * Cost estimate used to reserve budget before the call is made.
   *
   * Deliberately pessimistic: it assumes the full output allowance is used, so
   * a reservation is never too small. The difference is released the moment the
   * actual token counts come back.
   */
  estimateCostCents(inputChars: number, maxOutputTokens: number): number {
    // A configured price wins: behind a gateway the model name is an alias and
    // the table below cannot know it.
    const price = this.endpoint.price ?? TEXT_PRICES[this.model];
    if (price === undefined) {
      // Unknown model: reserve a deliberately high placeholder rather than 0,
      // so an unpriced model cannot spend without any budget check.
      return 100;
    }
    // ~4 characters per token is a rough but adequate planning figure.
    const inputTokens = Math.ceil(inputChars / 4);
    const cents =
      (inputTokens / 1_000_000) * price.input + (maxOutputTokens / 1_000_000) * price.output;
    return Math.max(1, Math.ceil(cents));
  }

  async generateStructured<TSchema extends z.ZodTypeAny>(
    request: StructuredRequest<TSchema>,
  ): Promise<StructuredResult<z.infer<TSchema>>> {
    const started = Date.now();
    const { schema } = toStrictJsonSchema(z.toJSONSchema(request.schema, { io: 'output' }));

    let repairAttempts = 0;
    let lastIssues: string[] = [];
    let input: unknown[] = [{ role: 'user', content: request.user }];

    // One initial attempt plus one bounded repair. Never an unbounded loop:
    // that would burn budget on a model that cannot satisfy the rules.
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      const body = {
        model: this.model,
        ...(request.webSearch ? { tools: [{ type: 'web_search' }], tool_choice: 'required', max_tool_calls: 4, include: ['web_search_call.action.sources'] } : {}),
        instructions: request.system,
        input,
        max_output_tokens: request.maxOutputTokens,
        text: {
          format: {
            type: 'json_schema',
            name: request.promptTemplate.replace(/[^a-zA-Z0-9_-]/gu, '_'),
            schema,
            strict: true,
          },
        },
        // Nothing in this product needs the model to keep server-side state.
        store: false,
      };

      const reply = await this.call(
        `${this.endpoint.baseUrl}/v1/responses`,
        body,
        responsesReply,
        request.signal,
      );

      const usage: AiUsage = {
        inputTokens: reply.usage?.input_tokens ?? null,
        outputTokens: reply.usage?.output_tokens ?? null,
        latencyMs: Date.now() - started,
        actualCostCents: this.actualCost(
          reply.usage?.input_tokens ?? null,
          reply.usage?.output_tokens ?? null,
        ),
      };

      // A truncated response is a failure, not a partial result: parsing half
      // a JSON document would either throw or, worse, validate.
      if (reply.status === 'incomplete') {
        const reason = reply.incomplete_details?.reason ?? 'onbekend';
        throw new AiInvalidOutputError(
          request.promptTemplate,
          [`Het antwoord is afgebroken (${reason}).`],
          repairAttempts,
          reason === 'max_output_tokens',
        );
      }

      const text = extractText(reply);
      if (text === undefined) {
        lastIssues = ['Het model gaf geen tekstueel resultaat terug.'];
      } else {
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(text);
        } catch {
          lastIssues = ['Het antwoord was geen geldige JSON.'];
          parsedJson = undefined;
        }

        if (parsedJson !== undefined) {
          const validated = request.schema.safeParse(parsedJson);
          if (validated.success) {
            return { value: validated.data, usage: request.webSearch ? { ...usage, actualCostCents: null } : usage, repairAttempts,
              sources: (reply.output ?? []).flatMap(item => item.type === 'web_search_call' ? (item.action?.sources ?? []).map(source => source.url) : []),
            };
          }
          lastIssues = validated.error.issues.map(
            (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
          );
        }
      }

      if (attempt === 0) {
        repairAttempts += 1;
        input = [
          ...input,
          { role: 'assistant', content: text ?? '' },
          {
            role: 'user',
            content:
              'Het resultaat voldeed niet aan de regels. Corrigeer precies deze punten en lever opnieuw:\n' +
              lastIssues.map((issue) => `- ${issue}`).join('\n'),
          },
        ];
      }
    }

    throw new AiInvalidOutputError(request.promptTemplate, lastIssues, repairAttempts);
  }

  /**
   * What the call really cost, in eurocents.
   *
   * A gateway knows the upstream price better than our table does, so its own
   * figure wins when it sent one *and* a euro rate makes it convertible. The
   * header is in dollars; without `AI_COST_USD_TO_EUR_RATE` it is ignored,
   * because a conversion nobody configured is a number nobody can check.
   */
  private actualCost(inputTokens: number | null, outputTokens: number | null): number | null {
    if (this.lastGatewayCostCents !== null) {
      return this.lastGatewayCostCents;
    }
    return this.pricedCost(inputTokens, outputTokens);
  }

  private pricedCost(inputTokens: number | null, outputTokens: number | null): number | null {
    if (inputTokens === null || outputTokens === null) {
      return null;
    }
    const price = this.endpoint.price ?? TEXT_PRICES[this.model];
    if (price === undefined) {
      // Report no actual cost rather than a made-up one.
      return null;
    }
    const cents =
      (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
    return Math.ceil(cents);
  }

  private async call<TSchema extends z.ZodTypeAny>(
    url: string,
    body: unknown,
    schema: TSchema,
    signal: AbortSignal | undefined,
  ): Promise<z.infer<TSchema>> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    // Honour cancellation from the job runner as well as our own timeout.
    const onAbort = (): void => {
      controller.abort();
    };
    signal?.addEventListener('abort', onAbort);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.endpoint.apiKey}`,
          ...(this.endpoint.organization === undefined
            ? {}
            : { 'openai-organization': this.endpoint.organization }),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new AiUnavailableError(
        'openai',
        controller.signal.aborted ? `timeout after ${String(this.timeoutMs)}ms` : 'network error',
        // A timeout is worth retrying; a caller-initiated cancel is not.
        signal?.aborted !== true,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    if (!response.ok) {
      throw toUnavailableError(response);
    }

    this.lastGatewayCostCents = gatewayCostCents(response, this.endpoint.usdToEur);

    const json: unknown = await response.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new AiInvalidOutputError(
        'openai.envelope',
        parsed.error.issues.map((issue) => issue.message),
        0,
      );
    }
    return parsed.data;
  }
}

/**
 * Image generation.
 *
 * Produces a **background** only. The prompt is written to ask for an abstract,
 * text-free image, and the render layer composites the headline, CTA and
 * wordmark on top afterwards. A model is never asked to draw a logo or legible
 * type — requirement 8 states this outright, and it is the failure mode that
 * cannot be corrected once something is published.
 */
export class OpenAiImageAdapter implements ImageGenerationAdapter {
  public readonly quality: string;
  public readonly provider: string;
  public readonly isMock = false;

  private readonly endpoint: CompatibleEndpoint;
  private readonly apiKey: string;
  public readonly model: string;
  private readonly timeoutMs: number;

  constructor(env: ServerEnv) {
    this.endpoint = endpointFor(env);
    this.provider = this.endpoint.provider;
    this.apiKey = this.endpoint.apiKey;
    this.model = env.AI_IMAGE_MODEL;
    this.quality = env.AI_IMAGE_QUALITY;
    if (['xhigh', 'max'].includes(this.quality) && !this.model.startsWith('gpt-image-2.5-')) {
      throw new Error('xhigh and max image quality require a GPT Image 2.5 model.');
    }
    this.timeoutMs = env.AI_IMAGE_TIMEOUT_MS;
  }

  estimateCostCents(): number {
    // Conservative budget hold, not a quoted per-image price. Input references
    // and higher quality consume additional tokens.
    return this.quality === 'max' ? 400 : this.quality === 'xhigh' ? 200 : 100;
  }

  requestDimensions(widthPx: number, heightPx: number): { widthPx: number; heightPx: number } {
    const [width, height] = nearestSupportedSize(widthPx, heightPx).split('x').map(Number);
    return { widthPx: width!, heightPx: height! };
  }

  async generateImage(input: {
    references?: readonly { bytes: Buffer; mimeType: string }[] | undefined;
    prompt: string;
    widthPx: number;
    heightPx: number;
    signal?: AbortSignal | undefined;
  }): Promise<{ png: Buffer; usage: AiUsage }> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    const abort = (): void => { controller.abort(); };
    if (input.signal?.aborted) controller.abort();
    input.signal?.addEventListener('abort', abort, { once: true });
    try {

    let response: Response;
    try {
      const fields = {
        model: this.model, quality: this.quality,
        prompt: input.prompt + '\nGeen tekst, letters, cijfers, watermerken of logo. De huisstijl wordt achteraf toegevoegd. Referentiebeelden sturen uitsluitend stijl, materiaal en licht; neem geen tekst, logo of identiteit over.',
        size: nearestSupportedSize(input.widthPx, input.heightPx), n: 1, output_format: 'png',
      };
      const references = input.references ?? [];
      let body: string | FormData = JSON.stringify(fields);
      const headers: Record<string, string> = { authorization: `Bearer ${this.apiKey}` };
      if (references.length > 0) {
        const form = new FormData();
        for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
        references.forEach((reference, index) => {
          const extension = reference.mimeType === 'image/jpeg' ? 'jpg' : reference.mimeType === 'image/webp' ? 'webp' : 'png';
          form.append('image[]', new Blob([new Uint8Array(reference.bytes)], { type: reference.mimeType }), `reference-${String(index)}.${extension}`);
        });
        body = form;
      } else headers['content-type'] = 'application/json';
      const images = `${this.endpoint.baseUrl}/v1/images/generations`;
      response = await fetch(references.length ? images.replace('/generations', '/edits') : images, {
        method: 'POST', headers, body, signal: controller.signal,
      });
    } catch {
      throw new AiUnavailableError(this.provider, 'image request failed or timed out', true);
    }

    if (!response.ok) {
      throw toUnavailableError(response);
    }

    if (!response.body) throw new AiInvalidOutputError('openai.images', ['Geen beeldgegevens.'], 0);
    const chunks: Uint8Array[] = []; let bytes = 0;
    const reader = response.body.getReader();
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk: unknown = next.value;
      if (!(chunk instanceof Uint8Array)) throw new AiInvalidOutputError('openai.images', ['Onverwachte beeldgegevens.'], 0);
      bytes += chunk.length;
      if (bytes > 36 * 1_048_576) { controller.abort(); throw new AiInvalidOutputError('openai.images', ['Afbeelding te groot.'], 0); }
      chunks.push(chunk);
    }
    const parsed = imagesReply.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!parsed.success) {
      throw new AiInvalidOutputError('openai.images', ['Onverwacht antwoordformaat.'], 0);
    }

    const b64 = parsed.data.data[0]?.b64_json;
    if (b64 === undefined) {
      throw new AiInvalidOutputError('openai.images', ['Geen afbeelding ontvangen.'], 0);
    }

    const price = IMAGE_PRICES[this.model];
    const outputTokens = parsed.data.usage?.output_tokens ?? null;
    const inputDetails = parsed.data.usage?.input_tokens_details;
    const unknownReferenceCost = (input.references?.length ?? 0) > 0 && inputDetails === undefined;

    return {
      png: Buffer.from(b64, 'base64'),
      usage: {
        inputTokens: parsed.data.usage?.input_tokens ?? null,
        outputTokens,
        latencyMs: Date.now() - started,
        actualCostCents:
          price === undefined || outputTokens === null || unknownReferenceCost
            ? null
            : Math.ceil((outputTokens * price.output + (inputDetails?.text_tokens ?? parsed.data.usage?.input_tokens ?? 0) * price.input + (inputDetails?.image_tokens ?? 0) * (price.imageInput ?? price.input)) / 1_000_000),
      },
    };
    } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort); }
  }
}

/**
 * The image API accepts a fixed set of sizes, so a channel's exact aspect ratio
 * is matched to the closest one and the render layer crops. Asking for an
 * unsupported size would fail the whole call.
 */
function nearestSupportedSize(width: number, height: number): string {
  const ratio = width / height;
  if (ratio > 1.2) {
    return '1536x1024';
  }
  if (ratio < 0.85) {
    return '1024x1536';
  }
  return '1024x1024';
}

/**
 * Maps an HTTP failure onto a retryability decision.
 *
 * The distinction matters to the job runner: a retryable failure is requeued
 * with backoff, a non-retryable one goes terminal immediately instead of
 * burning attempts on a request that can never succeed.
 */
function toUnavailableError(response: Response): AiUnavailableError {
  const retryAfter = response.headers.get('retry-after');
  const detail =
    retryAfter === null
      ? `HTTP ${String(response.status)}`
      : `HTTP ${String(response.status)}, retry-after ${retryAfter}s`;

  // 429 and 5xx are transient. 400/401/403/404/422 are our own mistake and
  // retrying them would waste attempts and money.
  const retryable = response.status === 429 || response.status >= 500;
  return new AiUnavailableError('openai', detail, retryable);
}

/** Pulls the assistant text out of a Responses API reply. */
function extractText(reply: z.infer<typeof responsesReply>): string | undefined {
  if (typeof reply.output_text === 'string' && reply.output_text.length > 0) {
    return reply.output_text;
  }
  for (const item of reply.output ?? []) {
    for (const block of item.content ?? []) {
      if (typeof block.text === 'string' && block.text.length > 0) {
        return block.text;
      }
    }
  }
  return undefined;
}

export class OpenAiProvider implements AiProvider {
  public readonly name: string;
  public readonly isMock = false;

  private readonly textAdapter: OpenAiTextAdapter;
  private readonly imageAdapter: OpenAiImageAdapter | undefined;

  constructor(env: ServerEnv) {
    this.textAdapter = new OpenAiTextAdapter(env);
    // The ledger records which door the call went through, not which API shape
    // it spoke: `litellm` and `openai` are different suppliers.
    this.name = this.textAdapter.provider;
    // Image generation costs money per image, so it is opt-in rather than on
    // by default. Without it, images are still produced by the render layer.
    this.imageAdapter = env.AI_IMAGE_ENABLED ? new OpenAiImageAdapter(env) : undefined;
  }

  text(): TextGenerationAdapter {
    return this.textAdapter;
  }

  /**
   * Controlled web research is not offered.
   *
   * It needs the SSRF-safe fetcher that has not been built, and every finding
   * must carry a source URL and a retrieval date. Returning undefined makes
   * that an honest `capability_unavailable` rather than a simulation.
   */
  research(): ResearchAdapter | undefined {
    return undefined;
  }

  image(): ImageGenerationAdapter | undefined {
    return this.imageAdapter;
  }
}

export { TEXT_PRICES, IMAGE_PRICES };
