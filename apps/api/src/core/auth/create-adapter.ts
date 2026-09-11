import type { ServerEnv } from '@c360/config';
import { LocalAuthAdapter } from './local-adapter.js';
import { TrustedHeaderAuthAdapter } from './trusted-header-adapter.js';
import type { AuthAdapter } from './types.js';

/**
 * Selects the identity adapter for this process.
 *
 * The production guard is repeated here rather than relying only on env
 * validation, so that a caller constructing the app with a hand-built env
 * object still cannot get a development identity in production.
 */
export function createAuthAdapter(env: ServerEnv): AuthAdapter {
  if (env.AUTH_MODE === 'local') {
    if (env.NODE_ENV === 'production' && !env.UNSAFE_ALLOW_DEV_AUTH_IN_PRODUCTION) {
      throw new Error(
        'Refusing to start: AUTH_MODE=local is a development test identity and is not allowed when NODE_ENV=production.',
      );
    }
    return new LocalAuthAdapter(env);
  }
  return new TrustedHeaderAuthAdapter(env);
}
