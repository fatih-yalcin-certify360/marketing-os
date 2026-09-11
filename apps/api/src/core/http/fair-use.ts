import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServerEnv } from '@c360/config';
import { AppError } from '../errors/app-error.js';

/**
 * Per-user and per-label fair use, applied after authentication.
 *
 * The transport-level limiter in `security.ts` is keyed on the socket peer
 * address. That is the right control for an unauthenticated flood, but behind
 * the Entra ID reverse proxy every request shares one address, so it cannot
 * distinguish one busy user from a hundred ordinary ones. Fair use therefore
 * lives here, where the actor and the label are known.
 *
 * Three budgets, because the costs are not comparable:
 *
 *  - **Per user, all requests.** Generous. Its job is to stop a runaway client
 *    or a stuck polling loop, not to pace normal use.
 *  - **Per user, generation.** Tight. Each of these spends money at the
 *    provider, so a mis-click loop must not become a bill.
 *  - **Per label, generation.** So one label's burst cannot crowd out the
 *    others sharing the deployment.
 *
 * ## What this is not
 *
 * The counters are in process memory, so with more than one API replica each
 * replica enforces its own share. That is deliberate and adequate here: it
 * smooths request floods, which is a per-process concern. The controls that
 * must hold across replicas are already in PostgreSQL and are unaffected by
 * this — the budget reservation is a single conditional UPDATE, and the
 * per-label worker ceiling is enforced in the claim query. In other words,
 * money and queue fairness are database-enforced; this is only pacing.
 */

/** One fixed window's count, with the window it belongs to. */
interface Bucket {
  windowStartedAtMs: number;
  count: number;
}

const WINDOW_MS = 60_000;

/** Idle buckets are dropped so a long-running process does not accumulate keys. */
const PRUNE_AFTER_MS = 10 * WINDOW_MS;

export interface FairUseDecision {
  allowed: boolean;
  /** Seconds until the caller's window resets. Only meaningful when denied. */
  retryAfterSeconds: number;
  /** Which budget was exhausted, for the audit record and the message. */
  scope: 'user' | 'user_generation' | 'label_generation' | null;
}

export class FairUseLimiter {
  private readonly buckets = new Map<string, Bucket>();

  private lastPrunedAtMs = 0;

  constructor(
    private readonly limits: {
      userPerMinute: number;
      userGenerationPerMinute: number;
      labelGenerationPerMinute: number;
    },
    private readonly now: () => number = () => Date.now(),
  ) {}

  static fromEnv(env: ServerEnv, now?: () => number): FairUseLimiter {
    return new FairUseLimiter(
      {
        userPerMinute: env.RATE_LIMIT_USER_MAX_PER_MINUTE,
        userGenerationPerMinute: env.RATE_LIMIT_USER_GENERATION_PER_MINUTE,
        labelGenerationPerMinute: env.RATE_LIMIT_LABEL_GENERATION_PER_MINUTE,
      },
      now,
    );
  }

  /**
   * Counts one request against a budget.
   *
   * @returns whether the budget still had room *before* this call.
   */
  private consume(key: string, max: number): { allowed: boolean; retryAfterSeconds: number } {
    const nowMs = this.now();
    this.prune(nowMs);

    const existing = this.buckets.get(key);
    if (existing === undefined || nowMs - existing.windowStartedAtMs >= WINDOW_MS) {
      this.buckets.set(key, { windowStartedAtMs: nowMs, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const elapsedMs = nowMs - existing.windowStartedAtMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((WINDOW_MS - elapsedMs) / 1_000));

    if (existing.count >= max) {
      // Not incremented: a denied request must not push the reset further out,
      // or a client that keeps retrying would lock itself out indefinitely.
      return { allowed: false, retryAfterSeconds };
    }

    existing.count += 1;
    return { allowed: true, retryAfterSeconds };
  }

  /** General per-user budget, for every authenticated request. */
  checkRequest(userId: string): FairUseDecision {
    const result = this.consume(`u:${userId}`, this.limits.userPerMinute);
    return {
      allowed: result.allowed,
      retryAfterSeconds: result.retryAfterSeconds,
      scope: result.allowed ? null : 'user',
    };
  }

  /**
   * Budget for work that spends money at the provider.
   *
   * The user budget is checked first, so a single user hitting their own ceiling
   * does not consume the label's shared allowance on the way to being refused.
   */
  checkGeneration(userId: string, labelId: string): FairUseDecision {
    const user = this.consume(`ug:${userId}`, this.limits.userGenerationPerMinute);
    if (!user.allowed) {
      return { allowed: false, retryAfterSeconds: user.retryAfterSeconds, scope: 'user_generation' };
    }

    const label = this.consume(`lg:${labelId}`, this.limits.labelGenerationPerMinute);
    if (!label.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: label.retryAfterSeconds,
        scope: 'label_generation',
      };
    }

    return { allowed: true, retryAfterSeconds: 0, scope: null };
  }

  /** Number of tracked keys, for the metrics endpoint. */
  size(): number {
    return this.buckets.size;
  }

  private prune(nowMs: number): void {
    // Pruning is a sweep, so it is rate-limited to once per window rather than
    // run on every request.
    if (nowMs - this.lastPrunedAtMs < WINDOW_MS) {
      return;
    }
    this.lastPrunedAtMs = nowMs;
    for (const [key, bucket] of this.buckets) {
      if (nowMs - bucket.windowStartedAtMs > PRUNE_AFTER_MS) {
        this.buckets.delete(key);
      }
    }
  }
}

const MESSAGES: Readonly<Record<NonNullable<FairUseDecision['scope']>, string>> = Object.freeze({
  user: 'Er zijn te veel verzoeken vanaf dit account. Probeer het over een moment opnieuw.',
  user_generation:
    'Je hebt kort achter elkaar veel voorstellen aangevraagd. Wacht even voordat je een nieuwe start — er is niets verloren gegaan.',
  label_generation:
    'Voor dit label lopen al veel aanvragen. Wacht even voordat je een nieuwe start — er is niets verloren gegaan.',
});

/** Turns a refusal into the 429 the client understands. */
export function fairUseError(decision: FairUseDecision): AppError {
  const scope = decision.scope ?? 'user';
  return new AppError('rate_limited', {
    publicMessage: MESSAGES[scope],
    internalDetail: `fair-use budget exhausted: ${scope}`,
    context: { scope, retryAfterSeconds: decision.retryAfterSeconds },
  });
}

/**
 * Scope-wide hook enforcing the general per-user budget.
 *
 * Registered as a `preHandler` on the authenticated scope, so it runs after the
 * `onRequest` authentication hook and therefore knows who is asking.
 */
export function enforceFairUse(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (error?: Error) => void,
): void {
  const user = request.authenticatedUser;
  if (user === undefined) {
    done();
    return;
  }
  const decision = request.server.appContext.fairUse.checkRequest(user.userId);
  if (decision.allowed) {
    done();
    return;
  }
  reply.header('retry-after', String(decision.retryAfterSeconds));
  done(fairUseError(decision));
}
