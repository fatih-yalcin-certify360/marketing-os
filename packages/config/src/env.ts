import { z } from 'zod';

/**
 * Environment contract for every server-side process (api, worker, migrator).
 *
 * Two hard safety rules are enforced here rather than at call sites, so that a
 * misconfigured deployment fails at boot instead of at request time:
 *
 *  1. `AUTH_MODE=local` (the development test identity) is rejected when
 *     `NODE_ENV=production`.  See docs/security/threat-model.md §T-01.
 *  2. `AI_PROVIDER=mock` is rejected when `NODE_ENV=production`, so a
 *     production deployment can never silently serve fabricated AI output.
 */

const csv = z
  .string()
  .transform((raw) => raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0));

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/**
 * Treats an empty or whitespace-only value as absent.
 *
 * `.env` files and container platforms both commonly set a variable to the
 * empty string to mean "not configured" (`AUTH_PROXY_SHARED_SECRET=`). Without
 * this, `.optional()` would reject `''` and a developer copying
 * `.env.example` would be blocked by a validation error on a value they had
 * deliberately left blank.
 */
function optionalString<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
    schema.optional(),
  );
}

export const AuthMode = z.enum(['local', 'trusted-header']);
export type AuthMode = z.infer<typeof AuthMode>;

export const AiProviderName = z.enum(['mock', 'anthropic', 'openai']);
export type AiProviderName = z.infer<typeof AiProviderName>;

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // ---- HTTP -------------------------------------------------------------
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Exact allowed browser origins. Empty in production means "same-origin only". */
  CORS_ALLOWED_ORIGINS: csv.default([]),
  /** Hard cap on request body size in bytes. Multipart limits are set separately. */
  REQUEST_BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
  /**
   * Pre-authentication ceiling, keyed on the socket peer address.
   *
   * Behind the Entra ID reverse proxy every request arrives from the *same*
   * address, so this is a whole-deployment circuit breaker against a flood, not
   * a fair-use control. Fair use is enforced per user and per label after
   * authentication (see `RATE_LIMIT_USER_MAX_PER_MINUTE` below), because that is
   * the only place the actor is actually known.
   *
   * Sizing arithmetic, because a number chosen by feel here throttles the whole
   * company at once: a busy user peaks around 75 requests a minute (job polling
   * plus navigation), so 100 users is ~7,500/min. The default carries a factor
   * of four of headroom. It must be raised in step with the user count — a
   * measured run at 338 req/s tripped an earlier 9,000/min default, which is
   * how this number came to be documented rather than guessed. See
   * docs/architecture/load-assumptions.md.
   */
  RATE_LIMIT_MAX_PER_MINUTE: z.coerce.number().int().min(1).default(30_000),
  /** Per-user request budget across all endpoints, applied after authentication. */
  RATE_LIMIT_USER_MAX_PER_MINUTE: z.coerce.number().int().min(1).default(600),
  /** Per-user budget for enqueuing generation work, which costs money. */
  RATE_LIMIT_USER_GENERATION_PER_MINUTE: z.coerce.number().int().min(1).default(20),
  /** Per-label budget for enqueuing generation work, so one label cannot starve others. */
  RATE_LIMIT_LABEL_GENERATION_PER_MINUTE: z.coerce.number().int().min(1).default(60),

  // ---- Database ---------------------------------------------------------
  DATABASE_URL: z.string().min(1),
  /**
   * Connections this process may hold.
   *
   * Every in-flight request needs one for the duration of its query, so this is
   * the real concurrency limit of the API. PostgreSQL's own `max_connections`
   * must exceed the sum across all API replicas *and* workers, or a replica
   * will fail to connect at the worst possible moment.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(15_000),

  // ---- Identity ---------------------------------------------------------
  AUTH_MODE: AuthMode.default('local'),
  /**
   * Header names are configurable because the real Entra ID reverse proxy
   * contract is not fixed yet (see docs/security/trusted-header-contract.md).
   */
  AUTH_HEADER_SUBJECT: z.string().min(1).default('x-c360-subject'),
  AUTH_HEADER_EMAIL: z.string().min(1).default('x-c360-email'),
  AUTH_HEADER_NAME: z.string().min(1).default('x-c360-name'),
  /**
   * Shared secret the trusted proxy must present. Defence in depth only: the
   * primary control is network isolation + `TRUSTED_PROXY_IPS`.
   */
  AUTH_PROXY_SHARED_SECRET: optionalString(z.string().min(32)),
  AUTH_HEADER_PROXY_SECRET: z.string().min(1).default('x-c360-proxy-secret'),
  /** CIDRs or exact IPs permitted to supply identity headers. */
  TRUSTED_PROXY_IPS: csv.default([]),
  /** Local development identity. Ignored unless AUTH_MODE=local. */
  LOCAL_DEV_SUBJECT: z.string().min(1).default('dev-local-subject'),
  LOCAL_DEV_EMAIL: z.string().min(1).default('dev@local.test'),
  LOCAL_DEV_NAME: z.string().min(1).default('Lokale Testgebruiker'),

  // ---- Jobs / worker ----------------------------------------------------
  /**
   * Job slots per worker process.
   *
   * Generation jobs are I/O-bound: they spend almost all of their time waiting
   * for the model, and no database transaction is held across that call (the
   * provider call happens before the write transaction opens, in every service).
   * So a slot costs a pending promise, not a held connection, and concurrency
   * can be well above the core count.
   *
   * Measured, 120 queued jobs, one worker, real PostgreSQL 18
   * (docs/architecture/load-assumptions.md):
   *
   *   concurrency  4 -> drained in 25.1 s, queue head waited 23.6 s
   *   concurrency 12 -> drained in  8.6 s, queue head waited  7.0 s
   *   concurrency 24 -> drained in  4.5 s, queue head waited  3.0 s
   *
   * Close to linear, so the claim query is not the bottleneck in that range.
   * The default of 8 suits a single worker on a small host; raise it, or add
   * worker replicas, in step with real generation volume. Keep
   * `DATABASE_POOL_MAX` at or above this value so slots do not queue on the
   * pool during their write bursts.
   */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  /**
   * How long a stopping worker waits for in-flight jobs before handing them
   * back to the queue.
   *
   * Must be comfortably shorter than the container's termination grace period,
   * or the process is killed before it can release anything and the jobs wait
   * for the heartbeat reaper instead.
   */
  WORKER_SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1_000).default(25_000),
  /** Liveness/readiness port for the worker. 0 disables the probe server. */
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(4001),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(1_000),
  /** A claimed job whose heartbeat is older than this is considered abandoned. */
  WORKER_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(180_000),
  /**
   * Hard ceiling on concurrent jobs for a single label.
   *
   * Fair scheduling already prefers idle labels; this is the backstop that
   * stops one tenant's burst from occupying every worker regardless.
   */
  WORKER_MAX_JOBS_PER_LABEL: z.coerce.number().int().min(1).max(64).default(4),

  // ---- AI provider ------------------------------------------------------
  BRIGHT_DATA_API_KEY: optionalString(z.string().min(1)),
  AD_RESEARCH_ENABLED: boolish.default(true),
  AD_RESEARCH_BROWSER_EXECUTABLE_PATH: optionalString(z.string().min(1)),
  AI_PROVIDER: AiProviderName.default('mock'),
  ANTHROPIC_API_KEY: optionalString(z.string().min(1)),
  OPENAI_API_KEY: optionalString(z.string().min(1)),
  /** Optional: bill against a specific OpenAI organisation. */
  OPENAI_ORGANIZATION: optionalString(z.string().min(1)),
  /**
   * Text model.
   *
   * Default is a mid-tier model: structured marketing copy does not need the
   * flagship, and the price spread across the range is roughly 50x. Cheaper and
   * more capable options are both a config change — see docs/decisions/
   * ADR-0015-openai-provider.md for the table.
   */
  AI_TEXT_MODEL: z.string().min(1).default('gpt-5.6-terra'),
  /**
   * Image generation is **off** by default: it costs money per image, and the
   * brand render layer already produces usable images without it. When on, the
   * model supplies a text-free background and our layer composites the logo
   * and copy on top.
   */
  AI_IMAGE_ENABLED: boolish.default(false),
  AI_IMAGE_MODEL: z.string().min(1).default('gpt-image-2.5-sunburst'),
  AI_IMAGE_QUALITY: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'auto']).default('high'),
  AI_IMAGE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(180_000),
  /**
   * Hard timeout per provider call.
   *
   * This bounds a *job*, not an HTTP request: generation runs on the worker, so
   * a slow model cannot time out a user's request (ADR-0016).
   */
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(900_000).default(300_000),
  /** Cap on output tokens per generation call; bounds worst-case cost. */
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32_000).default(8_192),
  /** Default monthly AI budget in eurocents, applied per label. */
  AI_DEFAULT_LABEL_BUDGET_CENTS: z.coerce.number().int().min(0).default(50_000),

  // ---- Outbound research (SSRF surface) ---------------------------------
  /**
   * Permit plain `http:` when fetching a research source.
   *
   * Off by default: TLS is the baseline, and a course page that is only
   * available over http is a signal in itself. The SSRF control is the resolved
   * address check, not the scheme, so this widens confidentiality exposure
   * rather than the attack surface — which is why it is a flag and not a
   * hard-coded refusal.
   */
  RESEARCH_ALLOW_HTTP: boolish.default(false),
  RESEARCH_FETCH_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),
  RESEARCH_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1024).default(2_097_152),
  RESEARCH_MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(3),
  /** When non-empty, only these hostname suffixes may be fetched. */
  RESEARCH_ALLOWED_HOST_SUFFIXES: csv.default([]),

  // ---- Storage ----------------------------------------------------------
  /** Uploads are written here and served only through authorised endpoints. */
  BRAND_PORTAL_BASE_URL: z.url().optional(),
  BRAND_PORTAL_API_KEY: z.string().min(1).optional(),
  STORAGE_ROOT: z.string().min(1).default('./var/storage'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).default(26_214_400),

  /** Opt-in escape hatch used only by tests that assert the guards themselves. */
  UNSAFE_ALLOW_DEV_AUTH_IN_PRODUCTION: boolish.default(false),
});

export type RawServerEnv = z.input<typeof baseSchema>;

export const serverEnvSchema = baseSchema.superRefine((env, ctx) => {
  const isProduction = env.NODE_ENV === 'production';

  if (isProduction && env.AUTH_MODE === 'local' && !env.UNSAFE_ALLOW_DEV_AUTH_IN_PRODUCTION) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_MODE'],
      message:
        'AUTH_MODE=local is a development-only test identity and is refused when NODE_ENV=production. Set AUTH_MODE=trusted-header.',
    });
  }

  if (isProduction && env.AI_PROVIDER === 'mock') {
    ctx.addIssue({
      code: 'custom',
      path: ['AI_PROVIDER'],
      message:
        'AI_PROVIDER=mock produces clearly-labelled fake output and is refused when NODE_ENV=production.',
    });
  }

  if (env.AUTH_MODE === 'trusted-header' && env.TRUSTED_PROXY_IPS.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRUSTED_PROXY_IPS'],
      message:
        'AUTH_MODE=trusted-header requires TRUSTED_PROXY_IPS so identity headers are only accepted from the authenticating proxy.',
    });
  }

  if (isProduction && env.AUTH_MODE === 'trusted-header' && !env.AUTH_PROXY_SHARED_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_PROXY_SHARED_SECRET'],
      message:
        'AUTH_PROXY_SHARED_SECRET is required in production so a request that bypasses the proxy cannot forge identity headers.',
    });
  }

  if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['ANTHROPIC_API_KEY'],
      message: 'AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY.',
    });
  }

  if (env.AI_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['OPENAI_API_KEY'],
      message: 'AI_PROVIDER=openai requires OPENAI_API_KEY.',
    });
  }

  if (env.AI_IMAGE_ENABLED && env.AI_PROVIDER !== 'openai') {
    ctx.addIssue({
      code: 'custom',
      path: ['AI_IMAGE_ENABLED'],
      message:
        'AI_IMAGE_ENABLED requires AI_PROVIDER=openai; no other configured provider generates images.',
    });
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  public readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Parses and validates process environment. Throws `EnvValidationError` with a
 * readable list of problems — never a raw Zod dump, and never echoing values,
 * which would risk writing secrets into logs.
 */
export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `${path}: ${issue.message}`;
  });
  throw new EnvValidationError(issues);
}

let cached: ServerEnv | undefined;

/** Memoised accessor for long-lived processes. */
export function serverEnv(): ServerEnv {
  cached ??= loadServerEnv();
  return cached;
}

/** Test-only: clears the memoised env so a case can re-load with new values. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
