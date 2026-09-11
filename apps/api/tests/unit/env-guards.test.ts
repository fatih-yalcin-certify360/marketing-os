import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadServerEnv } from '@c360/config';
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
