import { loadServerEnv, type ServerEnv } from '@c360/config';

/**
 * Builds a valid `ServerEnv` for tests without touching `process.env`.
 *
 * Tests that assert on the safety guards (development auth refused in
 * production, mock provider refused in production) pass overrides here and
 * expect `loadServerEnv` to throw — so this helper must not paper over
 * invalid combinations.
 */
export function testServerEnv(overrides: Record<string, string> = {}): ServerEnv {
  return loadServerEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://c360:c360@127.0.0.1:5432/c360_test',
    AUTH_MODE: 'local',
    AI_PROVIDER: 'mock',
    LOCAL_DEV_SUBJECT: 'dev-local-subject',
    LOCAL_DEV_EMAIL: 'dev@local.test',
    LOCAL_DEV_NAME: 'Lokale Testgebruiker',
    ...overrides,
  });
}

/** A frozen clock, so time-dependent assertions do not flake. */
export function fixedClock(iso = '2026-01-15T10:00:00.000Z'): () => Date {
  const instant = new Date(iso);
  return () => new Date(instant);
}
