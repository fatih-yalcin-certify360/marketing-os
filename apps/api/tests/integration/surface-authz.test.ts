import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * Every label-scoped route refuses a caller who is not a member (P4-6).
 *
 * The security review this belongs to could have been a document saying "the
 * routes were read and they check authorisation". That claim decays the day
 * somebody adds a route, and a reader cannot tell a reviewed surface from an
 * unreviewed one. So the review's finding is expressed as a **test over the
 * route table itself**: it enumerates what Fastify actually registered — not a
 * list somebody maintains — and asserts that a label the caller has no
 * membership on is refused everywhere.
 *
 * The seed creates `demolabel-5` and `demolabel-6` with **no membership** for
 * the development identity, precisely so that "a label that exists but is not
 * mine" is a real state and not a fabricated id. An id that does not exist
 * would prove much less: refusing something absent is easy.
 *
 * ## Why some routes can only be reported, not proved
 *
 * A `POST` with no body is usually refused by schema validation *before*
 * authorisation, and a 422 does not prove a permission check exists. Those are
 * classified as inconclusive and listed rather than silently counted as
 * passing — the honest position, since a body that satisfies every route's
 * schema cannot be synthesised here. What the test does refuse to tolerate, on
 * any route, is a **2xx** or a **5xx**: the first means the data was served,
 * the second that the check crashed instead of deciding.
 */

interface Route {
  method: string;
  path: string;
}

/**
 * Reads Fastify's own route tree.
 *
 * Parsed from `printRoutes` rather than from a hand-kept list, because a list
 * is exactly the thing that goes out of date when a route is added — which is
 * the failure this test exists to prevent.
 */
function parseRoutes(tree: string): Route[] {
  const routes: Route[] = [];
  const stack: string[] = [];

  for (const line of tree.split('\n')) {
    const match = /^([│\s]*)(?:├──|└──)\s(.*)$/u.exec(line);
    if (match === null) {
      continue;
    }
    const depth = Math.floor((match[1] ?? '').length / 4);
    const label = (match[2] ?? '').trim();
    const methodMatch = /^(.*?)\s*\(([A-Z, ]+)\)$/u.exec(label);
    const fragment = (methodMatch?.[1] ?? label).trim();

    stack.length = depth;
    stack[depth] = fragment;

    if (methodMatch !== null) {
      const path = stack.slice(0, depth + 1).join('');
      for (const method of (methodMatch[2] ?? '').split(',').map((value) => value.trim())) {
        if (method !== 'HEAD') {
          routes.push({ method, path });
        }
      }
    }
  }
  return routes;
}

/** Fills in path parameters. `:labelId` is the one under test. */
function concrete(path: string, labelId: string): string {
  return path
    .replace(/:labelId/gu, labelId)
    // A route may declare alternative names for the same segment.
    .replace(/:[A-Za-z]+(\|:[A-Za-z]+)*/gu, '11111111-2222-4333-8444-555555555555');
}

describe('the accumulated surface', () => {
  let h: TestHarness;
  let foreignLabelId: string;
  let ownLabelId: string;
  let routes: Route[];

  beforeAll(async () => {
    h = await createTestHarness();
    /*
     * Read from the database, not from the seed result.
     *
     * `seed.labels` lists only the labels the identity is a member of — which
     * is the whole point of this label. `demolabel-5` exists and has no
     * membership, so it is "a label that exists but is not mine", a real state
     * rather than a fabricated id. Refusing something absent would prove much
     * less.
     */
    const [foreign] = await h.pglite.executor.query<{ id: string }>(
      "SELECT id FROM labels WHERE slug = 'demolabel-5'",
    );
    expect(foreign, 'the seed no longer creates an inaccessible label').toBeDefined();
    foreignLabelId = foreign?.id ?? '';
    ownLabelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    routes = parseRoutes(h.app.printRoutes({ commonPrefix: false }));
  });

  afterAll(async () => {
    await h.close();
  });

  it('has a route table worth checking', () => {
    /*
     * Guards against the parser silently matching nothing, which would make
     * every assertion below iterate an empty list and pass.
     */
    expect(routes.length).toBeGreaterThan(40);
    const labelScoped = routes.filter((route) => route.path.includes(':labelId'));
    expect(labelScoped.length).toBeGreaterThan(30);
    // And the table really is the registered one: a known route is in it.
    expect(routes.some((route) => route.path === '/api/v1/labels/:labelId/brand')).toBe(true);
  });

  /**
   * Routes that answer on organisation authority rather than label membership.
   *
   * Not a loophole: `member:manage` is an organisation permission on purpose,
   * because a brand-new label has no members and requiring membership to manage
   * members would make it unmanageable by anyone. An org administrator
   * administers every label in their organisation.
   *
   * Listed explicitly, and each one is checked separately below against a
   * label from *another organisation* — which is where that authority stops.
   * Writing the exception down is the point: the first version of this test
   * assumed every label-scoped route requires membership, and that assumption
   * was wrong rather than the code.
   */
  const ORG_ADMINISTRATION = ['/api/v1/labels/:labelId/members/candidates'];

  it('refuses every label-scoped route to a caller who is not a member', async () => {
    const labelScoped = routes.filter(
      (route) => route.path.includes(':labelId') && !ORG_ADMINISTRATION.includes(route.path),
    );
    const served: string[] = [];
    const crashed: string[] = [];
    const inconclusive: string[] = [];
    let refused = 0;

    for (const route of labelScoped) {
      const response = await h.app.inject({
        method: route.method as 'GET',
        url: concrete(route.path, foreignLabelId),
      });
      const where = `${route.method} ${route.path} -> ${String(response.statusCode)}`;

      if (response.statusCode >= 200 && response.statusCode < 300) {
        served.push(where);
      } else if (response.statusCode >= 500) {
        crashed.push(where);
      } else if ([400, 415, 422].includes(response.statusCode)) {
        // Schema or content-type validation answered first; authorisation was
        // never reached, so this says nothing either way.
        inconclusive.push(where);
      } else {
        refused += 1;
      }
    }

    // The two failures that matter: data served, or the check crashing rather
    // than deciding.
    expect(served, 'a non-member was served data').toEqual([]);
    expect(crashed, 'authorisation crashed instead of deciding').toEqual([]);

    // Reported so the inconclusive set is visible and can be narrowed, rather
    // than quietly counted as a pass.
    if (inconclusive.length > 0) {
      process.stdout.write(
        `\n  ${String(inconclusive.length)} route(s) answered a validation error before authorisation:\n` +
          inconclusive.map((line) => `    ${line}`).join('\n') +
          '\n',
      );
    }
    expect(refused).toBeGreaterThan(20);
  });

  it('still serves the same routes to a member, so the refusal is not blanket', async () => {
    /*
     * The positive control, and the reason this suite is not vacuous.
     *
     * If authentication broke and every request answered 401, the assertion
     * above would pass while the product was entirely unusable. So a handful of
     * known-good reads must succeed for a label the caller *is* a member of.
     */
    const probes = [
      '/api/v1/labels/:labelId/brand',
      '/api/v1/labels/:labelId/courses',
      '/api/v1/labels/:labelId/campaigns',
      '/api/v1/labels/:labelId/jobs',
      '/api/v1/labels/:labelId/learnings',
      '/api/v1/labels/:labelId/source-impact',
    ];

    for (const path of probes) {
      const response = await h.app.inject({ method: 'GET', url: concrete(path, ownLabelId) });
      expect(response.statusCode, path).toBe(200);
    }
  });

  it('stops organisation authority at the organisation boundary', async () => {
    /*
     * The finding this suite produced.
     *
     * `members/candidates` answered 200 for any label id at all, because the id
     * arrived from the client and went straight into a subquery without anyone
     * checking whose label it was. The returned users are always the caller's
     * own organisation, so the data itself did not cross — but the *absence* of
     * a user from a candidate list is information about that label's
     * membership, and a 200 also confirms the id is real.
     *
     * An org administrator may see candidates for any label **in their own
     * organisation**, including ones they are not a member of. That is the
     * authority. This checks where it ends.
     */
    const [otherOrg] = await h.pglite.executor.query<{ id: string }>(
      `INSERT INTO organizations (slug, name) VALUES ('andere-org', 'Andere organisatie')
       RETURNING id`,
    );
    const [foreignLabel] = await h.pglite.executor.query<{ id: string }>(
      `INSERT INTO labels (organization_id, slug, name) VALUES ($1, 'vreemd-label', 'Vreemd label')
       RETURNING id`,
      [otherOrg?.id ?? ''],
    );

    for (const path of ORG_ADMINISTRATION) {
      const outside = await h.app.inject({
        method: 'GET',
        url: concrete(path, foreignLabel?.id ?? ''),
      });
      expect(outside.statusCode, `${path} must not answer for another organisation`).toBe(404);

      // And it still answers inside the organisation, so the fix did not just
      // close the route.
      const inside = await h.app.inject({ method: 'GET', url: concrete(path, ownLabelId) });
      expect(inside.statusCode, path).toBe(200);
    }
  });

  it('exposes no identifier through the unauthenticated endpoints', async () => {
    /*
     * `/health`, `/ready` and `/metrics` answer without authentication, because
     * an orchestrator and a scraper have no session. `/metrics` carries a
     * comment promising "operational counters only — no user content, no label
     * names, no identifiers", and nothing verified it. As metrics grow, a
     * per-label gauge with the label's name in the series is the obvious and
     * plausible mistake, and it would publish a customer list to anything that
     * can reach the port.
     *
     * The volume of work is still inferable from the queue depth, which is the
     * point of the endpoint. That is a reason to keep the port internal in
     * production (`docs/security/production-readiness.md`), not a reason to
     * blind the operator.
     */
    const labelNames = h.seed.labels.map((label) => label.name);

    for (const path of ['/health', '/ready', '/metrics']) {
      const response = await h.app.inject({ method: 'GET', url: path });
      expect(response.statusCode, path).toBe(200);

      expect(response.body, `${path} contains a UUID`).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
      );
      for (const name of labelNames) {
        expect(response.body, `${path} names a label`).not.toContain(name);
      }
      expect(response.body, `${path} contains an e-mail address`).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/iu);
    }
  });

  it('refuses a label that does not exist the same way as one that is not mine', async () => {
    /*
     * Absence and inaccessibility must be indistinguishable, or the response
     * becomes an oracle for which labels exist.
     */
    const path = '/api/v1/labels/:labelId/campaigns';
    const missing = await h.app.inject({
      method: 'GET',
      url: concrete(path, '99999999-8888-4777-8666-555555555555'),
    });
    const foreign = await h.app.inject({ method: 'GET', url: concrete(path, foreignLabelId) });

    expect(missing.statusCode).toBe(foreign.statusCode);
    expect(missing.json<{ error: { code: string } }>().error.code).toBe(
      foreign.json<{ error: { code: string } }>().error.code,
    );
  });
});
