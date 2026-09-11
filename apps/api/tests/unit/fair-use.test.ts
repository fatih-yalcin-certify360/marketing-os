import { describe, expect, it } from 'vitest';
import { FairUseLimiter, fairUseError } from '../../src/core/http/fair-use.js';

/**
 * Fair use, which is what makes the 100-user assumption survivable.
 *
 * The bug these tests exist to prevent: the transport limiter is keyed on the
 * socket peer address, and behind the Entra ID reverse proxy that address is
 * the *proxy's* for every request. Keying fair use the same way would give a
 * hundred users one shared bucket, so the whole company would be throttled
 * together. These tests pin the property that each user and each label is
 * counted separately.
 */

function limiter(
  overrides: Partial<{
    userPerMinute: number;
    userGenerationPerMinute: number;
    labelGenerationPerMinute: number;
  }> = {},
  clock?: { nowMs: number },
): FairUseLimiter {
  return new FairUseLimiter(
    {
      userPerMinute: 5,
      userGenerationPerMinute: 2,
      labelGenerationPerMinute: 3,
      ...overrides,
    },
    clock === undefined ? undefined : () => clock.nowMs,
  );
}

describe('fair use — per-user isolation', () => {
  it('counts each user separately', () => {
    const fairUse = limiter();

    // One user exhausts their own budget.
    for (let index = 0; index < 5; index += 1) {
      expect(fairUse.checkRequest('user-a').allowed).toBe(true);
    }
    expect(fairUse.checkRequest('user-a').allowed).toBe(false);

    // Another user is entirely unaffected. This is the property that a
    // socket-keyed limiter cannot provide behind a shared proxy.
    expect(fairUse.checkRequest('user-b').allowed).toBe(true);
  });

  it('does not throttle a hundred users who each stay within budget', () => {
    const fairUse = limiter({ userPerMinute: 60 });

    // 100 users × 60 requests inside one window: 6000 requests, none refused.
    for (let user = 0; user < 100; user += 1) {
      for (let request = 0; request < 60; request += 1) {
        const decision = fairUse.checkRequest(`user-${String(user)}`);
        expect(decision.allowed, `user ${String(user)} request ${String(request)}`).toBe(true);
      }
    }
    expect(fairUse.size()).toBe(100);
  });

  it('names the exhausted budget so the message can be specific', () => {
    const fairUse = limiter({ userPerMinute: 1 });
    fairUse.checkRequest('user-a');
    expect(fairUse.checkRequest('user-a').scope).toBe('user');
  });
});

describe('fair use — generation budgets', () => {
  it('limits a single user before the label runs out', () => {
    const fairUse = limiter();

    expect(fairUse.checkGeneration('user-a', 'label-1').allowed).toBe(true);
    expect(fairUse.checkGeneration('user-a', 'label-1').allowed).toBe(true);

    const refused = fairUse.checkGeneration('user-a', 'label-1');
    expect(refused.allowed).toBe(false);
    expect(refused.scope).toBe('user_generation');
  });

  it('does not spend the label allowance on a request it refuses anyway', () => {
    // userGenerationPerMinute 2, labelGenerationPerMinute 3.
    const fairUse = limiter();

    fairUse.checkGeneration('user-a', 'label-1');
    fairUse.checkGeneration('user-a', 'label-1');
    // Refused on the user budget; must not have consumed a label slot.
    expect(fairUse.checkGeneration('user-a', 'label-1').allowed).toBe(false);

    // The label therefore still has its third slot for someone else.
    expect(fairUse.checkGeneration('user-b', 'label-1').allowed).toBe(true);
  });

  it('stops one label from crowding out another', () => {
    const fairUse = limiter({ userGenerationPerMinute: 100 });

    for (let index = 0; index < 3; index += 1) {
      expect(fairUse.checkGeneration(`user-${String(index)}`, 'label-1').allowed).toBe(true);
    }

    const refused = fairUse.checkGeneration('user-9', 'label-1');
    expect(refused.allowed).toBe(false);
    expect(refused.scope).toBe('label_generation');

    // The second label operates independently — the same guarantee the
    // cross-label tests assert for data now holds for capacity.
    expect(fairUse.checkGeneration('user-9', 'label-2').allowed).toBe(true);
  });
});

describe('fair use — windows', () => {
  it('lets the window reset', () => {
    const clock = { nowMs: 1_000_000 };
    const fairUse = limiter({ userPerMinute: 2 }, clock);

    expect(fairUse.checkRequest('user-a').allowed).toBe(true);
    expect(fairUse.checkRequest('user-a').allowed).toBe(true);
    expect(fairUse.checkRequest('user-a').allowed).toBe(false);

    clock.nowMs += 60_000;
    expect(fairUse.checkRequest('user-a').allowed).toBe(true);
  });

  it('does not let a retrying client push its own reset further out', () => {
    // A limiter that counted refused requests would extend the window on every
    // retry, so a client with a tight retry loop could lock itself out for far
    // longer than a minute.
    const clock = { nowMs: 1_000_000 };
    const fairUse = limiter({ userPerMinute: 1 }, clock);

    fairUse.checkRequest('user-a');
    for (let index = 0; index < 50; index += 1) {
      clock.nowMs += 500;
      expect(fairUse.checkRequest('user-a').allowed).toBe(false);
    }

    // 25 seconds of hammering; the original window still expires on time.
    clock.nowMs = 1_000_000 + 60_000;
    expect(fairUse.checkRequest('user-a').allowed).toBe(true);
  });

  it('reports a retry-after inside the window', () => {
    const clock = { nowMs: 1_000_000 };
    const fairUse = limiter({ userPerMinute: 1 }, clock);
    fairUse.checkRequest('user-a');
    clock.nowMs += 15_000;

    const decision = fairUse.checkRequest('user-a');
    expect(decision.retryAfterSeconds).toBe(45);
  });

  it('drops idle buckets instead of growing without bound', () => {
    const clock = { nowMs: 1_000_000 };
    const fairUse = limiter({ userPerMinute: 10 }, clock);

    for (let index = 0; index < 500; index += 1) {
      fairUse.checkRequest(`user-${String(index)}`);
    }
    expect(fairUse.size()).toBe(500);

    // Long after every window has closed, one more request triggers the sweep.
    clock.nowMs += 20 * 60_000;
    fairUse.checkRequest('user-new');
    expect(fairUse.size()).toBe(1);
  });
});

describe('fair use — refusal', () => {
  it('is a 429 with a Dutch explanation and no internal detail in the message', () => {
    const error = fairUseError({
      allowed: false,
      retryAfterSeconds: 30,
      scope: 'label_generation',
    });

    expect(error.code).toBe('rate_limited');
    expect(error.status).toBe(429);
    expect(error.publicMessage).toMatch(/label/u);
    // The user is told nothing was lost, because nothing was.
    expect(error.publicMessage).toMatch(/niets verloren/u);
    expect(error.publicMessage).not.toMatch(/budget exhausted|label_generation/u);
    expect(error.internalDetail).toMatch(/label_generation/u);
  });
});
