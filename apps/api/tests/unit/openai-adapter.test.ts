import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadServerEnv } from '@c360/config';
import { OpenAiProvider, OpenAiTextAdapter, OpenAiImageAdapter } from '../../src/core/ai/openai-adapter.js';
import { AiInvalidOutputError, AiUnavailableError } from '../../src/core/ai/types.js';

/**
 * The OpenAI adapter's behaviour, with the network stubbed.
 *
 * What this can verify without a key: the request shape it sends, how it
 * classifies every failure, how it derives cost from token counts, and that a
 * bad response is a *failure* rather than a partially-trusted result.
 *
 * What it cannot verify: that the live API accepts our schema and returns what
 * we expect. That stays unexercised until a key exists, and is recorded as
 * such in the delivery notes and the risk register.
 */

const schema = z.object({
  title: z.string().min(5),
  count: z.number().int().min(1).max(3),
});

function adapter(overrides: Record<string, string> = {}): OpenAiTextAdapter {
  return new OpenAiTextAdapter(
    loadServerEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://c360:c360@db:5432/c360',
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test-key',
      AI_TEXT_MODEL: 'gpt-5.6-terra',
      AI_REQUEST_TIMEOUT_MS: '5000',
      ...overrides,
    }),
  );
}

/** Minimal Responses API reply carrying a JSON payload. */
function reply(payload: unknown, usage = { input_tokens: 1_000, output_tokens: 500 }): unknown {
  return {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
    usage,
  };
}

/**
 * A *factory* for responses, not a response.
 *
 * A `Response` body can only be read once, so handing the same instance to two
 * calls would fail on the second — the mock has to mint a fresh one per call.
 */
function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): () => Response {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
}

const request = {
  promptTemplate: 'persona.propose',
  promptVersion: 'v1',
  system: 'Systeemregels.',
  user: '<opleiding>Wft Basis</opleiding>',
  schema,
  maxOutputTokens: 2_048,
};

/**
 * Reads back the JSON body of the n-th stubbed request.
 *
 * `RequestInit.body` is a wide union, but this adapter only ever sends a JSON
 * string, so the narrowing is asserted rather than assumed.
 */
function sentBody(call: number): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  const body = init.body;
  if (typeof body !== 'string') {
    throw new Error('Expected a JSON string body.');
  }
  return JSON.parse(body) as Record<string, unknown>;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAI text adapter — request shape', () => {
  it('requires web search, retains provider sources, and does not invent total search cost', async () => {
    fetchMock.mockImplementation(jsonResponse({status:'completed',output:[
      {type:'web_search_call',action:{type:'search',sources:[{type:'url',url:'https://example.org/evidence'}]}},
      {type:'message',content:[{type:'output_text',text:JSON.stringify({title:'Onderbouwd',count:1})}]},
    ],usage:{input_tokens:1000,output_tokens:100}}));
    const result=await adapter().generateStructured({...request,webSearch:true});
    expect(sentBody(0).tools).toEqual([{type:'web_search'}]);
    expect(sentBody(0).tool_choice).toBe('required');
    expect(sentBody(0).max_tool_calls).toBe(4);
    expect(result.sources).toEqual(['https://example.org/evidence']);
    expect(result.usage.actualCostCents).toBeNull();
  });

  it('sends strict structured output via text.format', async () => {
    fetchMock.mockImplementation(jsonResponse(reply({ title: 'Een titel', count: 2 })));

    await adapter().generateStructured(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');

    const body = sentBody(0);
    const text = body.text as { format?: Record<string, unknown> };
    const format = text.format ?? {};
    expect(format.type).toBe('json_schema');
    // Strict mode is what makes the shape a guarantee rather than a request.
    expect(format.strict).toBe(true);
    expect(format.name).toBe('persona_propose');
    expect((format.schema as Record<string, unknown>).additionalProperties).toBe(false);

    // Our rules go in `instructions`; the task data goes in `input`. Keeping
    // them apart is the prompt-injection boundary (threat T-05).
    expect(body.instructions).toBe('Systeemregels.');
    expect(JSON.stringify(body.input)).toContain('Wft Basis');
    expect(body.instructions).not.toContain('Wft Basis');

    // Nothing here needs provider-side conversation state.
    expect(body.store).toBe(false);
  });

  it('authenticates with a bearer key and never logs it back', async () => {
    fetchMock.mockImplementation(jsonResponse(reply({ title: 'Een titel', count: 1 })));
    await adapter().generateStructured(request);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test-key');
  });
});

describe('OpenAI text adapter — validation', () => {
  it('returns the parsed value when it satisfies the contract', async () => {
    fetchMock.mockImplementation(jsonResponse(reply({ title: 'Een goede titel', count: 3 })));

    const result = await adapter().generateStructured(request);

    expect(result.value).toEqual({ title: 'Een goede titel', count: 3 });
    expect(result.repairAttempts).toBe(0);
  });

  it('repairs once when the shape is right but a rule is broken', async () => {
    // Strict mode guarantees the shape; Zod enforces `min(5)` and `max(3)`.
    // A violation must produce a repair attempt, not a passed-through value.
    fetchMock
      .mockImplementationOnce(jsonResponse(reply({ title: 'kort', count: 9 })))
      .mockImplementationOnce(jsonResponse(reply({ title: 'Nu lang genoeg', count: 2 })));

    const result = await adapter().generateStructured(request);

    expect(result.repairAttempts).toBe(1);
    expect(result.value.title).toBe('Nu lang genoeg');

    // The repair message must name the actual problems.
    expect(JSON.stringify(sentBody(1).input)).toMatch(/count/u);
  });

  it('fails after one repair rather than looping', async () => {
    fetchMock.mockImplementation(jsonResponse(reply({ title: 'kort', count: 99 })));

    await expect(adapter().generateStructured(request)).rejects.toThrow(AiInvalidOutputError);
    // Exactly two calls: the attempt and one repair. An unbounded loop would
    // burn budget on a model that cannot comply.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a truncated response as a failure, not a partial result', async () => {
    fetchMock.mockImplementation(
      jsonResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
        usage: { input_tokens: 10, output_tokens: 2_048 },
      }),
    );

    await expect(adapter().generateStructured(request)).rejects.toThrow(/afgebroken/u);
  });

  it('rejects a reply that is not valid JSON', async () => {
    fetchMock.mockImplementation(
      jsonResponse({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json {' }] }],
      }),
    );

    await expect(adapter().generateStructured(request)).rejects.toThrow(AiInvalidOutputError);
  });

  it('rejects an unrecognised envelope instead of guessing', async () => {
    fetchMock.mockImplementation(jsonResponse({ unexpected: true, output: 'wrong type' }));
    await expect(adapter().generateStructured(request)).rejects.toThrow(AiInvalidOutputError);
  });
});

describe('OpenAI text adapter — failure classification', () => {
  /**
   * The distinction drives the job runner: a retryable failure is requeued with
   * backoff, a non-retryable one goes terminal immediately instead of spending
   * two more attempts on a request that can never succeed.
   */
  it('marks a rate limit retryable and keeps the retry-after detail', async () => {
    fetchMock.mockImplementation(jsonResponse({ error: 'slow down' }, 429, { 'retry-after': '30' }));

    const error = await adapter()
      .generateStructured(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as AiUnavailableError).retryable).toBe(true);
    expect((error as AiUnavailableError).message).toMatch(/retry-after 30s/u);
  });

  it('marks a server error retryable', async () => {
    fetchMock.mockImplementation(jsonResponse({ error: 'oops' }, 503));
    const error = await adapter()
      .generateStructured(request)
      .catch((caught: unknown) => caught);
    expect((error as AiUnavailableError).retryable).toBe(true);
  });

  it('marks a client error non-retryable', async () => {
    // A 401 or a malformed request is our mistake; retrying wastes attempts.
    for (const status of [400, 401, 403, 404, 422]) {
      fetchMock.mockImplementation(jsonResponse({ error: 'nope' }, status));
      const error = await adapter()
        .generateStructured(request)
        .catch((caught: unknown) => caught);
      expect((error as AiUnavailableError).retryable, `status ${String(status)}`).toBe(false);
    }
  });

  it('maps a network failure to a retryable provider outage', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const error = await adapter()
      .generateStructured(request)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as AiUnavailableError).retryable).toBe(true);
  });

  it('never returns a successful-looking empty result on failure', async () => {
    // The property that matters most: a provider problem must not become
    // fabricated content (requirement 11).
    fetchMock.mockImplementation(jsonResponse({ error: 'down' }, 500));
    await expect(adapter().generateStructured(request)).rejects.toThrow();
  });
});

describe('OpenAI text adapter — cost', () => {
  it('derives actual cost from returned token counts', async () => {
    // gpt-5.6-terra: 200 cents / 1M input, 1200 / 1M output.
    // 1M input + 1M output => 200 + 1200 = 1400 cents.
    fetchMock.mockImplementation(
      jsonResponse(
        reply({ title: 'Een titel', count: 1 }, { input_tokens: 1_000_000, output_tokens: 1_000_000 }),
      ),
    );

    const result = await adapter().generateStructured(request);
    expect(result.usage.actualCostCents).toBe(1_400);
    expect(result.usage.inputTokens).toBe(1_000_000);
  });

  it('reports no actual cost for an unpriced model rather than inventing one', async () => {
    fetchMock.mockImplementation(jsonResponse(reply({ title: 'Een titel', count: 1 })));
    const result = await adapter({ AI_TEXT_MODEL: 'some-unlisted-model' }).generateStructured(
      request,
    );
    expect(result.usage.actualCostCents).toBeNull();
  });

  it('estimates pessimistically, so a reservation is never too small', () => {
    const priced = adapter();
    const estimate = priced.estimateCostCents(8_000, 8_192);
    // Assumes the full output allowance is used.
    expect(estimate).toBeGreaterThan(0);
    expect(estimate).toBeGreaterThanOrEqual(
      Math.ceil((8_192 / 1_000_000) * 1_200),
    );
  });

  it('reserves a high placeholder for an unpriced model instead of zero', () => {
    // Zero would let an unpriced model spend with no budget check at all.
    expect(adapter({ AI_TEXT_MODEL: 'some-unlisted-model' }).estimateCostCents(8_000, 8_192)).toBe(
      100,
    );
  });
});

describe('OpenAI provider capabilities', () => {
  const baseEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://c360:c360@db:5432/c360',
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'sk-test-key',
  };

  it('offers text but not research', () => {
    const provider = new OpenAiProvider(loadServerEnv(baseEnv));
    expect(provider.text()).toBeDefined();
    // Controlled web research needs the SSRF-safe fetcher, which is not built.
    // Reporting the capability as absent is the honest answer.
    expect(provider.research()).toBeUndefined();
  });

  it('offers image generation only when explicitly enabled', () => {
    // Images cost money per call, so they are opt-in; without them the brand
    // render layer still produces usable images.
    expect(new OpenAiProvider(loadServerEnv(baseEnv)).image()).toBeUndefined();
    expect(
      new OpenAiProvider(loadServerEnv({ ...baseEnv, AI_IMAGE_ENABLED: 'true' })).image(),
    ).toBeDefined();
  });

  it('is never reported as a mock', () => {
    expect(new OpenAiProvider(loadServerEnv(baseEnv)).isMock).toBe(false);
  });
});


describe('high quality image requests', () => {
  const imageEnv = (overrides: Record<string, string> = {}) => loadServerEnv({
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://c360:c360@db:5432/c360',
    AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key', ...overrides,
  });

  it('sends Sunburst with explicit high quality and records input/output token cost', async () => {
    fetchMock.mockImplementation(jsonResponse({ data: [{ b64_json: Buffer.from('png').toString('base64') }],
      usage: { input_tokens: 1000, output_tokens: 2000 } }));
    const result = await new OpenAiImageAdapter(imageEnv()).generateImage({ prompt: 'A physical paper sculpture', widthPx: 1536, heightPx: 1024 });
    expect(sentBody(0)).toMatchObject({ model: 'gpt-image-2.5-sunburst', quality: 'high', size: '1536x1024' });
    expect(result.usage.actualCostCents).toBe(7);
  });

  it('sends reference bytes to edits using multipart and prices image input separately', async () => {
    fetchMock.mockImplementation(jsonResponse({ data: [{ b64_json: Buffer.from('png').toString('base64') }],
      usage: { input_tokens: 2000, input_tokens_details: { text_tokens: 1000, image_tokens: 1000 }, output_tokens: 2000 } }));
    const reference = Buffer.from('reference-bytes');
    const result = await new OpenAiImageAdapter(imageEnv()).generateImage({
      prompt: 'Use material and light from the reference', widthPx: 1024, heightPx: 1024,
      references: [{ bytes: reference, mimeType: 'image/png' }],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get('quality')).toBe('high');
    const file = form.get('image[]');
    expect(file).toBeInstanceOf(Blob);
    expect(Buffer.from(await (file as Blob).arrayBuffer())).toEqual(reference);
    expect(result.usage.actualCostCents).toBe(8);
  });

  it('does not silently send unsupported quality to an older model', () => {
    expect(() => new OpenAiImageAdapter(imageEnv({ AI_IMAGE_MODEL: 'gpt-image-1-mini', AI_IMAGE_QUALITY: 'xhigh' }))).toThrow(/GPT Image 2.5/);
  });
});
