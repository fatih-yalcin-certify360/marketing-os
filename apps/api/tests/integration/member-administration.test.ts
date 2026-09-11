import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditEvents, memberships, users } from '../../src/core/db/schema.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * Label membership administration (backlog P1-10).
 *
 * Three acceptance criteria, and the second is the one worth testing hardest:
 * a change must take effect on the actor's **next request**. That is a property
 * of the identity design rather than of this module — `resolveCurrentUser`
 * reads memberships from the database on every request — so the test exists to
 * prove there is no cache anywhere that would delay a revocation until the end
 * of a session.
 *
 * The seeded development identity is `org_owner`, so it holds `member:manage`.
 * Tests that need a caller *without* it lower the row and re-read, which also
 * exercises the "takes effect immediately" property from the other direction.
 */
describe('member administration', () => {
  let harness: TestHarness;
  let labelId: string;
  let otherLabelId: string;
  let selfId: string;
  let colleagueId: string;

  beforeEach(async () => {
    harness = await createTestHarness();
    labelId = labelIdBySlug(harness.seed, 'lindenhaeghe');
    otherLabelId = labelIdBySlug(harness.seed, 'demolabel-2');
    selfId = harness.currentUser.userId;

    // A second person in the same organisation, with no label membership.
    const inserted = await harness.db
      .insert(users)
      .values({
        organizationId: harness.seed.organizationId,
        externalSubject: 'colleague-subject',
        email: 'collega@example.invalid',
        displayName: 'Collega Testpersoon',
        orgRole: 'org_member',
        authSource: 'local',
      })
      .returning({ id: users.id });
    colleagueId = String(inserted[0]?.id);
  });

  afterEach(async () => {
    await harness.close();
  });

  /** Lowers the caller's organisation role, to test a caller without rights. */
  const demoteSelf = async (orgRole: 'org_admin' | 'org_member') => {
    await harness.db.update(users).set({ orgRole }).where(eq(users.id, selfId));
  };

  const auditFor = async (action: string) =>
    harness.db
      .select({
        action: auditEvents.action,
        outcome: auditEvents.outcome,
        resourceId: auditEvents.resourceId,
        actorUserId: auditEvents.actorUserId,
        labelId: auditEvents.labelId,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .where(eq(auditEvents.action, action));

  // ------------------------------------------------------------ authority ---

  it('lets an organisation owner grant a role', async () => {
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/members/${colleagueId}`,
      payload: { role: 'label_editor' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ role: string; email: string }>().role).toBe('label_editor');

    const rows = await harness.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.labelId, labelId), eq(memberships.userId, colleagueId)));
    expect(rows[0]?.role).toBe('label_editor');
  });

  it('refuses a caller without member:manage, however senior on the label', async () => {
    // `label_manager` grants `member:read`, not `member:manage`. Otherwise a
    // manager could grant themselves a second label and the label boundary
    // would be self-serve.
    await demoteSelf('org_member');

    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/members/${colleagueId}`,
      payload: { role: 'label_editor' },
    });

    expect(response.statusCode).toBe(403);
    const rows = await harness.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(eq(memberships.userId, colleagueId));
    expect(rows).toHaveLength(0);
  });

  it('lets a label manager read the member list without being able to change it', async () => {
    await demoteSelf('org_member');

    // Seeded as label_manager on the pilot label, so reading is allowed.
    const read = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/members`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json<{ items: unknown[] }>().items.length).toBeGreaterThan(0);

    // Listing the whole organisation is exactly what a label role must not do.
    const candidates = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/members/candidates`,
    });
    expect(candidates.statusCode).toBe(403);
  });

  it('does not serve the member list of a label the caller has no part in', async () => {
    await harness.db
      .delete(memberships)
      .where(and(eq(memberships.userId, selfId), eq(memberships.labelId, otherLabelId)));
    await demoteSelf('org_member');

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${otherLabelId}/members`,
    });

    // "Not found" rather than "forbidden": confirming the label exists would
    // be the enumeration channel.
    expect(response.statusCode).toBe(404);
  });

  // --------------------------------------------- effective on next request ---

  it('applies a granted role to the very next request', async () => {
    // The seed puts the development identity on every label, so start by
    // taking this one away — which is itself a check that a removal is visible
    // to the next request.
    await harness.db
      .delete(memberships)
      .where(and(eq(memberships.userId, selfId), eq(memberships.labelId, otherLabelId)));

    const before = await harness.app.inject({ method: 'GET', url: '/api/v1/me' });
    const beforeLabels = before
      .json<{ memberships: { labelId: string }[] }>()
      .memberships.map((entry) => entry.labelId);
    expect(beforeLabels).not.toContain(otherLabelId);

    const grant = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${otherLabelId}/members/${selfId}`,
      payload: { role: 'label_editor' },
    });
    expect(grant.statusCode).toBe(200);

    const after = await harness.app.inject({ method: 'GET', url: '/api/v1/me' });
    const afterRole = after
      .json<{ memberships: { labelId: string; role: string }[] }>()
      .memberships.find((entry) => entry.labelId === otherLabelId);

    // No sign-out, no cache to bust: the next request already sees it.
    expect(afterRole?.role).toBe('label_editor');
  });

  it('stops a revoked membership working on the very next request', async () => {
    // Someone else keeps the label manageable, so the last-manager guard is
    // not what refuses this.
    await harness.db.insert(memberships).values({
      organizationId: harness.seed.organizationId,
      userId: colleagueId,
      labelId: labelId,
      role: 'label_manager',
    });

    const before = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/campaigns`,
    });
    expect(before.statusCode).toBe(200);

    const revoke = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/labels/${labelId}/members/${selfId}`,
    });
    expect(revoke.statusCode).toBe(200);
    await demoteSelf('org_member');

    const after = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/campaigns`,
    });
    // Immediately gone, and reported as absent rather than forbidden.
    expect(after.statusCode).toBe(404);
  });

  // ---------------------------------------------------------------- audit ---

  it('audits a grant with the role it set', async () => {
    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/members/${colleagueId}`,
      payload: { role: 'label_viewer' },
    });

    const records = await auditFor('membership.granted');
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record?.outcome).toBe('allowed');
    expect(record?.actorUserId).toBe(selfId);
    expect(record?.resourceId).toBe(colleagueId);
    expect(record?.labelId).toBe(labelId);
    expect(JSON.stringify(record?.metadata)).toContain('label_viewer');
  });

  it('audits a change with the role before and after', async () => {
    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/members/${colleagueId}`,
      payload: { role: 'label_viewer' },
    });
    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/members/${colleagueId}`,
      payload: { role: 'label_approver' },
    });

    const records = await auditFor('membership.changed');
    expect(records).toHaveLength(1);
    // "Who could do what, when" has to be answerable afterwards, which needs
    // both sides of the change.
    const metadata = JSON.stringify(records[0]?.metadata);
    expect(metadata).toContain('label_approver');
    expect(metadata).toContain('label_viewer');
  });

  it('audits a revocation with the role that was removed', async () => {
    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/members/${colleagueId}`,
      payload: { role: 'label_editor' },
    });
    await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/labels/${labelId}/members/${colleagueId}`,
    });

    const records = await auditFor('membership.revoked');
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records[0]?.metadata)).toContain('label_editor');
  });

  it('writes no audit record when the change was refused', async () => {
    await demoteSelf('org_member');
    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/members/${colleagueId}`,
      payload: { role: 'label_editor' },
    });

    // A refusal that never reached the service has nothing to record here; the
    // request-level audit trail covers the attempt.
    expect(await auditFor('membership.granted')).toHaveLength(0);
  });

  // ------------------------------------------------- accountability guard ---

  it('refuses to remove the last label manager', async () => {
    // Confirming a course fact needs `course:write`, which only a manager has.
    // A label with no manager is a label whose price and dates can never be
    // confirmed again — and an unconfirmed fact blocks a publish-ready export.
    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/labels/${labelId}/members/${selfId}`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(
      /labelbeheerder/u,
    );

    const rows = await harness.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.labelId, labelId), eq(memberships.userId, selfId)));
    expect(rows[0]?.role).toBe('label_manager');
  });

  it('refuses to demote the last label manager', async () => {
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/members/${selfId}`,
      payload: { role: 'label_viewer' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('allows the removal once someone else can manage the label', async () => {
    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/members/${colleagueId}`,
      payload: { role: 'label_manager' },
    });

    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/labels/${labelId}/members/${selfId}`,
    });
    expect(response.statusCode).toBe(200);
  });

  // ------------------------------------------------------------- validation ---

  it('refuses an unknown role rather than storing it', async () => {
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/members/${colleagueId}`,
      payload: { role: 'label_superuser' },
    });
    expect(response.statusCode).toBe(422);
  });

  it('refuses a user from outside the organisation', async () => {
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/members/11111111-1111-4111-8111-111111111111`,
      payload: { role: 'label_editor' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('reports revoking a membership that is not there as absent', async () => {
    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/labels/${labelId}/members/${colleagueId}`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('is idempotent: setting the same role twice changes nothing', async () => {
    for (let index = 0; index < 2; index += 1) {
      const response = await harness.app.inject({
        method: 'PATCH',
        url: `/api/v1/labels/${labelId}/members/${colleagueId}`,
        payload: { role: 'label_editor' },
      });
      expect(response.statusCode).toBe(200);
    }

    const rows = await harness.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.labelId, labelId), eq(memberships.userId, colleagueId)));
    // One membership, not two: "add" and "change" are the same operation.
    expect(rows).toHaveLength(1);
  });

  it('lists only people who are not already on the label', async () => {
    const before = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/members/candidates`,
    });
    const beforeIds = before
      .json<{ items: { userId: string }[] }>()
      .items.map((entry) => entry.userId);
    expect(beforeIds).toContain(colleagueId);

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/labels/${labelId}/members/${colleagueId}`,
      payload: { role: 'label_editor' },
    });

    const after = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/members/candidates`,
    });
    const afterIds = after.json<{ items: { userId: string }[] }>().items.map((e) => e.userId);
    expect(afterIds).not.toContain(colleagueId);
  });
});
