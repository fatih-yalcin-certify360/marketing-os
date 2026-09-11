import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { jobs, labels, memberships, users } from '../../src/core/db/schema.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * Cross-label and cross-organisation isolation.
 *
 * This is the highest-value suite in the project: every one of these cases is a
 * data-leak between labels if it regresses. They run against the real API over
 * HTTP (`app.inject`) rather than against services directly, so the route
 * wiring is covered too — a missing guard on a handler would fail here.
 */
describe('label isolation', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('lists only the labels the caller is a member of', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/labels' });
    expect(response.statusCode).toBe(200);

    const body = response.json<{ items: { slug: string }[] }>();
    const slugs = body.items.map((item) => item.slug).sort();

    // The dev user is a member of four labels. demolabel-5 and -6 exist in the
    // database but must not appear at all.
    expect(slugs).toEqual(['demolabel-2', 'demolabel-3', 'demolabel-4', 'lindenhaeghe']);
    expect(slugs).not.toContain('demolabel-5');
    expect(slugs).not.toContain('demolabel-6');
  });

  it('returns not-found for a label that exists but is not accessible', async () => {
    const foreign = await harness.db
      .select({ id: labels.id })
      .from(labels)
      .where(eq(labels.slug, 'demolabel-5'))
      .limit(1);
    const foreignId = foreign[0]?.id;
    expect(foreignId).toBeDefined();

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${String(foreignId)}`,
    });

    // 404 rather than 403 on purpose: a 403 would confirm the id exists and
    // hand an attacker a label enumeration oracle.
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('not_found');
  });

  it('refuses the workspace overview of an inaccessible label', async () => {
    const foreign = await harness.db
      .select({ id: labels.id })
      .from(labels)
      .where(eq(labels.slug, 'demolabel-6'))
      .limit(1);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${String(foreign[0]?.id)}/workspace`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('refuses the job list of an inaccessible label', async () => {
    const foreign = await harness.db
      .select({ id: labels.id })
      .from(labels)
      .where(eq(labels.slug, 'demolabel-5'))
      .limit(1);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${String(foreign[0]?.id)}/jobs`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('refuses to enqueue work into an inaccessible label', async () => {
    const foreign = await harness.db
      .select({ id: labels.id })
      .from(labels)
      .where(eq(labels.slug, 'demolabel-5'))
      .limit(1);

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${String(foreign[0]?.id)}/jobs/demo`,
      payload: { message: 'poging', steps: 1 },
    });
    expect(response.statusCode).toBe(404);
  });

  it('does not leak a job across labels via its own id', async () => {
    // IDOR: create a job in a label the *other* user owns, then try to read it
    // as the dev user, who is a member of four other labels.
    const foreignLabel = await harness.db
      .select({ id: labels.id, organizationId: labels.organizationId })
      .from(labels)
      .where(eq(labels.slug, 'demolabel-5'))
      .limit(1);
    const label = foreignLabel[0];
    expect(label).toBeDefined();

    const inserted = await harness.db
      .insert(jobs)
      .values({
        organizationId: label!.organizationId,
        labelId: label!.id,
        type: 'demo.echo',
        payload: { message: 'geheim', steps: 1, failFirstAttempts: 0 },
        idempotencyKey: 'isolation-test-key',
      })
      .returning({ id: jobs.id });

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${String(inserted[0]?.id)}`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('reports the role the caller actually holds, not one they ask for', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/labels',
      headers: {
        // A forged role/label claim must have no effect whatsoever.
        'x-c360-role': 'org_owner',
        'x-c360-labels': 'demolabel-5',
      },
    });
    const body = response.json<{ items: { slug: string; role: string }[] }>();
    const viewer = body.items.find((item) => item.slug === 'demolabel-2');
    expect(viewer?.role).toBe('label_viewer');
    expect(body.items.map((i) => i.slug)).not.toContain('demolabel-5');
  });

  it('keeps a second label independent in the same flow', async () => {
    // Requirement 15: "İkinci label'ın aynı akışta ayrı çalışması."
    const first = labelIdBySlug(harness.seed, 'lindenhaeghe');
    const second = labelIdBySlug(harness.seed, 'demolabel-3');

    const enqueueFirst = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${first}/jobs/demo`,
      payload: { message: 'label een', steps: 1 },
    });
    const enqueueSecond = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${second}/jobs/demo`,
      payload: { message: 'label twee', steps: 1 },
    });
    expect(enqueueFirst.statusCode).toBe(202);
    expect(enqueueSecond.statusCode).toBe(202);

    const firstJobs = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${first}/jobs`,
    });
    const secondJobs = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${second}/jobs`,
    });

    const firstIds = firstJobs.json<{ items: { id: string; labelId: string }[] }>().items;
    const secondIds = secondJobs.json<{ items: { id: string; labelId: string }[] }>().items;

    // Each listing contains only its own label's work.
    expect(firstIds.every((job) => job.labelId === first)).toBe(true);
    expect(secondIds.every((job) => job.labelId === second)).toBe(true);
    expect(firstIds.map((j) => j.id)).not.toEqual(
      expect.arrayContaining(secondIds.map((j) => j.id)),
    );
  });
});

describe('database-level tenant guards', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('refuses a membership that mixes organisations', async () => {
    // The composite foreign key means this is impossible even if application
    // code were wrong. Verified against the real schema, not asserted in prose.
    await harness.pglite.executor.exec(
      "INSERT INTO organizations (id, slug, name) VALUES ('00000000-0000-4000-8000-0000000000ff', 'other-org', 'Andere organisatie')",
    );
    await harness.pglite.executor.exec(
      `INSERT INTO users (id, organization_id, external_subject, email, display_name, auth_source)
       VALUES ('00000000-0000-4000-8000-0000000000fe', '00000000-0000-4000-8000-0000000000ff',
               'outsider', 'outsider@other.test', 'Outsider', 'local')`,
    );

    const ownLabel = await harness.db
      .select({ id: labels.id, organizationId: labels.organizationId })
      .from(labels)
      .where(eq(labels.slug, 'lindenhaeghe'))
      .limit(1);

    await expect(
      harness.pglite.executor.query(
        `INSERT INTO memberships (organization_id, user_id, label_id, role)
         VALUES ($1, '00000000-0000-4000-8000-0000000000fe', $2, 'label_manager')`,
        [ownLabel[0]?.organizationId, ownLabel[0]?.id],
      ),
    ).rejects.toThrow();
  });

  it('rejects an unknown label role at the database level', async () => {
    const user = await harness.db.select({ id: users.id }).from(users).limit(1);
    const label = await harness.db
      .select({ id: labels.id, organizationId: labels.organizationId })
      .from(labels)
      .limit(1);

    await expect(
      harness.pglite.executor.query(
        `INSERT INTO memberships (organization_id, user_id, label_id, role) VALUES ($1, $2, $3, 'superuser')`,
        [label[0]?.organizationId, user[0]?.id, label[0]?.id],
      ),
    ).rejects.toThrow();
  });

  it('enforces one membership per user and label', async () => {
    const existing = await harness.db
      .select({
        organizationId: memberships.organizationId,
        userId: memberships.userId,
        labelId: memberships.labelId,
      })
      .from(memberships)
      .limit(1);
    const row = existing[0];
    expect(row).toBeDefined();

    await expect(
      harness.pglite.executor.query(
        `INSERT INTO memberships (organization_id, user_id, label_id, role) VALUES ($1, $2, $3, 'label_viewer')`,
        [row!.organizationId, row!.userId, row!.labelId],
      ),
    ).rejects.toThrow();
  });
});
