import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadServerEnv } from '@c360/config';
import { createAiProvider } from '../../src/core/ai/index.js';
import { createAuthAdapter } from '../../src/core/auth/create-adapter.js';
import { LocalAuthAdapter } from '../../src/core/auth/local-adapter.js';

const base = {
  DATABASE_URL: 'postgresql://c360:c360@db:5432/c360',
  TRUSTED_PROXY_IPS: '10.0.0.5',
  AUTH_PROXY_SHARED_SECRET: 'x'.repeat(48),
};

function issuesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return [...error.issues];
    }
    throw error;
  }
  throw new Error('expected loadServerEnv to throw');
}

describe('production configuration guards', () => {
  it('refuses the development test identity in production', () => {
    const issues = issuesOf(() =>
      loadServerEnv({ ...base, NODE_ENV: 'production', AUTH_MODE: 'local', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }),
    );
    expect(issues.join('\n')).toMatch(/AUTH_MODE/u);
    expect(issues.join('\n')).toMatch(/development-only/u);
  });

  it('refuses the mock AI provider in production', () => {
    const issues = issuesOf(() =>
      loadServerEnv({ ...base, NODE_ENV: 'production', AUTH_MODE: 'trusted-header', AI_PROVIDER: 'mock' }),
    );
    expect(issues.join('\n')).toMatch(/AI_PROVIDER/u);
  });

  it('refuses trusted-header mode without a trusted proxy allow-list', () => {
    const issues = issuesOf(() =>
      loadServerEnv({
        ...base,
        TRUSTED_PROXY_IPS: '',
        NODE_ENV: 'development',
        AUTH_MODE: 'trusted-header',
      }),
    );
    expect(issues.join('\n')).toMatch(/TRUSTED_PROXY_IPS/u);
  });

  it('refuses production trusted-header mode without a proxy shared secret', () => {
    const issues = issuesOf(() =>
      loadServerEnv({
        NODE_ENV: 'production',
        DATABASE_URL: base.DATABASE_URL,
        TRUSTED_PROXY_IPS: '10.0.0.5',
        AUTH_MODE: 'trusted-header',
        AI_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'k',
      }),
    );
    expect(issues.join('\n')).toMatch(/AUTH_PROXY_SHARED_SECRET/u);
  });

  it('refuses the anthropic provider without an API key', () => {
    const issues = issuesOf(() =>
      loadServerEnv({ ...base, NODE_ENV: 'development', AI_PROVIDER: 'anthropic' }),
    );
    expect(issues.join('\n')).toMatch(/ANTHROPIC_API_KEY/u);
  });

  it('accepts a valid production configuration', () => {
    const env = loadServerEnv({
      ...base,
      NODE_ENV: 'production',
      AUTH_MODE: 'trusted-header',
      AI_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'secret',
    });
    expect(env.AUTH_MODE).toBe('trusted-header');
    expect(env.TRUSTED_PROXY_IPS).toEqual(['10.0.0.5']);
  });

  it('never reveals configuration values in the error message', () => {
    // A misconfiguration message goes to logs; echoing the value could leak a
    // connection string or secret.
    const issues = issuesOf(() => loadServerEnv({ DATABASE_URL: '' }));
    expect(issues.join('\n')).not.toMatch(/postgresql:\/\//u);
  });
});

describe('adapter construction guards', () => {
  it('refuses to construct the local adapter in production', () => {
    // Even if env validation were bypassed, constructing the development
    // identity in production must fail. Two independent checks by design.
    const env = loadServerEnv({ ...base, NODE_ENV: 'development', AUTH_MODE: 'local' });
    const productionEnv = { ...env, NODE_ENV: 'production' as const };
    expect(() => new LocalAuthAdapter(productionEnv)).toThrow(/never be constructed/u);
    expect(() => createAuthAdapter(productionEnv)).toThrow(/Refusing to start/u);
  });

  it('builds the local adapter in development', () => {
    const env = loadServerEnv({ ...base, NODE_ENV: 'development', AUTH_MODE: 'local' });
    expect(createAuthAdapter(env).mode).toBe('local');
  });
});

/**
 * The LiteLLM gateway.
 *
 * A gateway is a supplier, not a model: it speaks OpenAI's API in front of
 * whatever an operator configured behind it. So the adapter is shared and the
 * *claims* are not — what the product may offer depends on what is behind the
 * proxy, and the safe default is the one that refuses.
 */
describe('the LiteLLM gateway', () => {
  const litellm = {
    ...base,
    AUTH_MODE: 'trusted-header',
    AI_PROVIDER: 'litellm',
    LITELLM_BASE_URL: 'https://llm.internal',
    LITELLM_API_KEY: 'sk-virtual-key',
  };

  it('refuses to start without a base URL or a virtual key', () => {
    const noUrl = issuesOf(() => loadServerEnv({ ...litellm, LITELLM_BASE_URL: '' }));
    expect(noUrl.join('\n')).toMatch(/LITELLM_BASE_URL/u);

    const noKey = issuesOf(() => loadServerEnv({ ...litellm, LITELLM_API_KEY: '' }));
    expect(noKey.join('\n')).toMatch(/LITELLM_API_KEY/u);
  });

  it('accepts plain http inside a container network, but not in production', () => {
    const local = loadServerEnv({
      ...litellm,
      NODE_ENV: 'development',
      LITELLM_BASE_URL: 'http://litellm:4000',
    });
    expect(local.LITELLM_BASE_URL).toBe('http://litellm:4000');

    // Prompts, documents and the key travel over this connection.
    const issues = issuesOf(() =>
      loadServerEnv({ ...litellm, NODE_ENV: 'production', LITELLM_BASE_URL: 'http://litellm:4000' }),
    );
    expect(issues.join('\n')).toMatch(/https in production/u);
  });

  it('does not claim web search unless the operator says the proxy passes it through', () => {
    const plain = createAiProvider(loadServerEnv(litellm));
    expect(plain.name).toBe('litellm');
    expect(plain.text()?.supportsWebSearch).toBe(false);

    const declared = createAiProvider(
      loadServerEnv({ ...litellm, AI_WEB_SEARCH_ENABLED: 'true' }),
    );
    expect(declared.text()?.supportsWebSearch).toBe(true);

    // OpenAI directly keeps the capability it has always had.
    const direct = createAiProvider(
      loadServerEnv({ ...base, AUTH_MODE: 'trusted-header', AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k' }),
    );
    expect(direct.name).toBe('openai');
    expect(direct.text()?.supportsWebSearch).toBe(true);
  });

  /** The reservation the budget check makes before a call is allowed. */
  function reservation(env: Record<string, string>): number {
    const text = createAiProvider(loadServerEnv(env)).text();
    if (text?.estimateCostCents === undefined) {
      throw new Error('the text adapter no longer estimates cost, so nothing reserves budget');
    }
    return text.estimateCostCents(40_000, 8_192);
  }

  it('prices a gateway alias from configuration, and reserves a high placeholder without it', () => {
    // An unknown model must not spend without a budget check.
    expect(reservation({ ...litellm, AI_TEXT_MODEL: 'team-default' })).toBe(100);

    // 10k input tokens at 200 + 8_192 output tokens at 1200, in eurocents.
    expect(
      reservation({
        ...litellm,
        AI_TEXT_MODEL: 'team-default',
        AI_TEXT_PRICE_INPUT_CENTS_PER_MTOK: '200',
        AI_TEXT_PRICE_OUTPUT_CENTS_PER_MTOK: '1200',
      }),
    ).toBe(12);
  });

  it('half a price is not a price', () => {
    expect(
      reservation({
        ...litellm,
        AI_TEXT_MODEL: 'team-default',
        AI_TEXT_PRICE_INPUT_CENTS_PER_MTOK: '200',
      }),
    ).toBe(100);
  });

  it('lets images through a gateway, which the old guard tied to OpenAI alone', () => {
    const withImages = loadServerEnv({ ...litellm, AI_IMAGE_ENABLED: 'true' });
    expect(withImages.AI_IMAGE_ENABLED).toBe(true);
    expect(createAiProvider(withImages).image()).toBeDefined();

    // Anthropic still generates none, and says so at boot.
    const issues = issuesOf(() =>
      loadServerEnv({
        ...base,
        AUTH_MODE: 'trusted-header',
        AI_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'k',
        AI_IMAGE_ENABLED: 'true',
      }),
    );
    expect(issues.join('\n')).toMatch(/AI_IMAGE_ENABLED/u);
  });
});
