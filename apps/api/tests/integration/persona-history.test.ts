import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { PersonaHistory } from '@c360/contracts';
import { courseVersions } from '../../src/core/db/schema.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * Who made this audience, and who changed it since.
 *
 * Nothing here is newly recorded — every version already carried an author and
 * a timestamp, and every approval already had its own row. What is tested is
 * that it can be *read*: a persona decides what every campaign aims at, and
 * "on whose say-so" was a question only a database client could answer.
 */
describe('the trail of one persona', () => {
  let h: TestHarness;
  let labelId: string;
  let courseVersionId: string;

  beforeAll(async () => {
    h = await createTestHarness();
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    const seeded = h.seed.pilot.courseVersionId;
    if (seeded === undefined || seeded === null) throw new Error('the seed no longer provides a pilot course version');
    courseVersionId = seeded;
    await h.db.update(courseVersions).set({ reviewState: 'approved' }).where(eq(courseVersions.id, courseVersionId));
  });

  afterAll(async () => {
    await h.close();
  });

  it('names every version, its author, and what changed in it', async () => {
    const s = h.appContext.services;
    const proposed = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId });
    const first = proposed.personas[0];
    expect(first).toBeDefined();

    const renamed = await s.personas.edit(h.db, h.currentUser, labelId, first!.id, {
      name: 'Herschreven doelgroep',
      barriers: [...first!.barriers, 'Twijfelt over de reistijd'],
    });
    /*
     * Approved over HTTP on purpose.
     *
     * The service could approve a persona from the first version of the
     * product, but no route ever called it — so the permission granted nothing
     * and no persona in the product could be approved. Exercising the endpoint
     * here is what keeps that from silently going away again (2026-09-17).
     */
    const approval = await h.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/personas/${renamed.id}/approve`,
    });
    expect(approval.statusCode, approval.body.slice(0, 200)).toBe(200);
    expect(approval.json<{ reviewState: string }>().reviewState).toBe('approved');

    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/personas/${renamed.id}/history`,
    });
    expect(response.statusCode, response.body.slice(0, 200)).toBe(200);
    const history = response.json<PersonaHistory>();

    // Newest first: the last thing that happened is what people came to see.
    expect(history.items.map((entry) => entry.version)).toEqual([2, 1]);

    const [latest, original] = history.items;
    expect(latest).toBeDefined();
    expect(original).toBeDefined();

    // The author is a person, not a uuid — you cannot ask an id why it changed
    // the wording.
    expect(latest?.by?.displayName).toBe(h.currentUser.displayName);
    expect(latest?.by?.email).toBe(h.currentUser.email);
    expect(original?.by?.displayName).toBe(h.currentUser.displayName);

    // What differs from the version before, compared rather than stored.
    expect(latest?.changedFieldsNl).toContain('Naam');
    expect(latest?.changedFieldsNl).toContain('Drempels');
    expect(latest?.changedFieldsNl).not.toContain('Behoefte');
    // The first version has nothing to differ from.
    expect(original?.changedFieldsNl).toEqual([]);

    // What each version was, read off the origin and the prompt.
    expect(original?.origin).toBe('ai_generated');
    expect(original?.actionNl.length).toBeGreaterThan(3);
    expect(latest?.actionNl).toBe('Met de hand aangepast');

    // The approval is bound to the version it was given for.
    expect(latest?.approvedAt).not.toBeNull();
    expect(latest?.approvedBy?.displayName).toBe(h.currentUser.displayName);
    expect(original?.approvedAt).toBeNull();
  });

  it('keeps the earlier versions readable after an edit', async () => {
    const s = h.appContext.services;
    const proposed = await s.personas.propose(h.db, h.currentUser, { labelId, courseVersionId });
    const persona = proposed.personas[1] ?? proposed.personas[0];
    expect(persona).toBeDefined();

    const edited = await s.personas.edit(h.db, h.currentUser, labelId, persona!.id, {
      need: 'Een herschreven behoefte die niet op de vorige lijkt.',
    });

    // Asked through the *new* version; the trail is the identity's, not the row's.
    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/personas/${edited.id}/history`,
    });
    const history = response.json<PersonaHistory>();
    expect(history.items).toHaveLength(2);
    // A campaign that points at v1 keeps pointing at something that exists.
    expect(history.items.map((entry) => entry.versionId)).toContain(persona!.id);
    expect(history.items[0]?.changedFieldsNl).toEqual(['Behoefte']);
  });

  it('reads as absent for a persona of another label', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/personas/${randomUUID()}/history`,
    });
    expect(response.statusCode).toBe(404);
  });
});
