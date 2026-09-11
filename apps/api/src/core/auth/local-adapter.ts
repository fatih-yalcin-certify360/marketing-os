import type { ServerEnv } from '@c360/config';
import type { AuthAdapter, AuthenticatedSubject } from './types.js';

/**
 * Development-only identity.
 *
 * Returns a single fixed test user regardless of request content. It is
 * unreachable in production twice over: `loadServerEnv` refuses
 * `AUTH_MODE=local` when `NODE_ENV=production`, and `createAuthAdapter`
 * refuses to construct this class in production. Two independent checks
 * because this is the highest-severity misconfiguration in the system
 * (docs/security/threat-model.md T-01).
 */
export class LocalAuthAdapter implements AuthAdapter {
  public readonly mode = 'local' as const;
  private readonly subject: AuthenticatedSubject;

  constructor(env: ServerEnv) {
    if (env.NODE_ENV === 'production' && !env.UNSAFE_ALLOW_DEV_AUTH_IN_PRODUCTION) {
      throw new Error(
        'LocalAuthAdapter must never be constructed when NODE_ENV=production. ' +
          'This is a development test identity.',
      );
    }
    this.subject = {
      externalSubject: env.LOCAL_DEV_SUBJECT,
      email: env.LOCAL_DEV_EMAIL,
      displayName: env.LOCAL_DEV_NAME,
      authMode: 'local',
    };
  }

  authenticate(): AuthenticatedSubject {
    return this.subject;
  }
}
