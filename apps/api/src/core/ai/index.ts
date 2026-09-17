import type { ServerEnv } from '@c360/config';
import { AnthropicProvider } from './anthropic-adapter.js';
import { MockProvider } from './mock-adapter.js';
import { OpenAiProvider } from './openai-adapter.js';
import type { AiProvider } from './types.js';

export * from './types.js';
export { buildContextBlock, systemPromptFor, PROMPT_VERSIONS } from './prompts.js';
export type { PromptContext, PromptTemplate } from './prompts.js';
export { MockProvider, MockTextAdapter } from './mock-adapter.js';
export { AnthropicProvider, AnthropicTextAdapter } from './anthropic-adapter.js';
export { OpenAiProvider, OpenAiTextAdapter, OpenAiImageAdapter } from './openai-adapter.js';
export { toStrictJsonSchema } from './strict-schema.js';

/**
 * Selects the AI provider for this process.
 *
 * The production guard lives in `loadServerEnv`, which refuses
 * `AI_PROVIDER=mock` when `NODE_ENV=production`. It is repeated here so that a
 * caller constructing the app with a hand-built env object still cannot get
 * fabricated output in production (ADR-0013).
 */
export function createAiProvider(env: ServerEnv): AiProvider {
  if (env.AI_PROVIDER === 'mock') {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'Refusing to start: AI_PROVIDER=mock produces clearly-labelled fabricated output and is not allowed when NODE_ENV=production.',
      );
    }
    return new MockProvider();
  }
  // OpenAI directly, and LiteLLM in front of whatever an operator configured
  // behind it: one adapter, because the HTTP surface is the same one.
  if (env.AI_PROVIDER === 'openai' || env.AI_PROVIDER === 'litellm') {
    return new OpenAiProvider(env);
  }
  return new AnthropicProvider(env);
}
