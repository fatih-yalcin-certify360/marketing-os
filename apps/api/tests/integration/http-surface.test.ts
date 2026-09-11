import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditEvents } from '../../src/core/db/schema.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * HTTP surface behaviour: error envelope, identity reporting, origin checks,
 * validation and audit recording.
 */
describe('HTTP surface', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness({
      envOverrides: { CORS_ALLOWED_ORIGINS: 'https://marketing.certify360.test' },
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('serves health and readiness without authentication', async () => {
    expect((await harness.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await harness.app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
  });

  it('reports the identity and the adapter that established it', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(response.statusCode).toBe(200);

    const body = response.json<{
      authMode: string;
      orgRole: string;
      memberships: unknown[];
      email: string;
    }>();
    // Surfacing authMode is what lets the UI say "local test identity" plainly.
    expect(body.authMode).toBe('local');
    expect(body.orgRole).toBe('org_owner');
    expect(body.memberships).toHaveLength(4);
  });

  it('returns the standard error envelope with a request id', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/labels/not-a-uuid' });
    expect(response.statusCode).toBe(422);

    const body = response.json<{
      error: { code: string; message: string; requestId: string; issues?: unknown[] };
    }>();
    expect(body.error.code).toBe('validation_failed');
    // Dutch and safe to render.
    expect(body.error.message).toBe('Niet alle velden zijn correct ingevuld.');
    expect(body.error.requestId).toBeTruthy();
    expect(Array.isArray(body.error.issues)).toBe(true);
  });

  it('never leaks an internal message or stack to the client', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/nope' });
    const raw = response.body;
    expect(raw).not.toMatch(/at .*\.ts:/u);
    expect(raw).not.toMatch(/node_modules/u);
    expect(raw).not.toMatch(/postgres/iu);
  });

  it('rejects a state-changing request from a disallowed origin', async () => {
    const labelId = labelIdBySlug(harness.seed, 'lindenhaeghe');
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/jobs/demo`,
      headers: { origin: 'https://evil.example' },
      payload: { message: 'cross-site', steps: 1 },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('forbidden');
  });

  it('accepts a state-changing request from the configured origin', async () => {
    const labelId = labelIdBySlug(harness.seed, 'lindenhaeghe');
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/jobs/demo`,
      headers: { origin: 'https://marketing.certify360.test' },
      payload: { message: 'zelfde origin', steps: 1 },
    });
    expect(response.statusCode).toBe(202);
  });

  it('validates and bounds the request payload', async () => {
    const labelId = labelIdBySlug(harness.seed, 'lindenhaeghe');

    const tooManySteps = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/jobs/demo`,
      payload: { message: 'te veel', steps: 9999 },
    });
    expect(tooManySteps.statusCode).toBe(422);

    const tooLong = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/jobs/demo`,
      payload: { message: 'x'.repeat(5_000), steps: 1 },
    });
    expect(tooLong.statusCode).toBe(422);
  });

  it('collapses a double submit onto one job', async () => {
    // The idempotency key is derived from the intent, so an impatient second
    // click returns the existing job (200) rather than queueing a duplicate.
    const labelId = labelIdBySlug(harness.seed, 'demolabel-3');
    const payload = { message: 'dubbele klik', steps: 2 };

    const first = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/jobs/demo`,
      payload,
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/jobs/demo`,
      payload,
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
  });

  it('records an audit entry for an enqueue, without any content', async () => {
    const labelId = labelIdBySlug(harness.seed, 'demolabel-4');
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/jobs/demo`,
      payload: { message: 'gevoelige tekst die niet gelogd mag worden', steps: 1 },
    });

    const rows = await harness.db
      .select({
        action: auditEvents.action,
        outcome: auditEvents.outcome,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents);

    const enqueued = rows.filter((row) => row.action === 'job.enqueue');
    expect(enqueued.length).toBeGreaterThan(0);
    expect(enqueued[0]?.outcome).toBe('allowed');
    // The audit trail must not become a content log.
    expect(JSON.stringify(rows)).not.toMatch(/gevoelige tekst/u);
  });

  it('reports module availability honestly in the workspace overview', async () => {
    const labelId = labelIdBySlug(harness.seed, 'lindenhaeghe');
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/workspace`,
    });
    expect(response.statusCode).toBe(200);

    const body = response.json<{
      moduleAvailability: { area: string; status: string }[];
      containsDemoData: boolean;
      readiness: { hasApprovedBrandProfile: boolean };
    }>();

    const byArea = new Map(body.moduleAvailability.map((m) => [m.area, m.status]));

    // Built and working today.
    for (const area of ['werkruimte', 'kennis_beheer', 'kansen', 'campagnes', 'content']) {
      expect(byArea.get(area)).toBe('available');
    }
    // Not built. The guarantee that matters: an unfinished area must never
    // claim to be available, so the UI cannot present it as working.
    for (const area of ['kalender', 'resultaten']) {
      expect(byArea.get(area)).not.toBe('available');
    }

    expect(body.containsDemoData).toBe(true);
    // The demo seed approves a brand profile for the pilot label, which is what
    // lets a campaign be started at all.
    expect(body.readiness.hasApprovedBrandProfile).toBe(true);
  });
});

/**
 * A stored channel verdict must never outlive the config it came from.
 *
 * When Facebook's upload limits were sourced, existing content kept returning a
 * stored warning saying "cannot be exported publish-ready" while the export —
 * which reads the current config — no longer blocked on it. The interface and
 * the gate disagreed, and a user would have believed the interface.
 *
 * Two things changed. The operative warnings are now recomputed from the
 * current config on every read, so the two cannot disagree; and
 * `channel_config_version` records what the asset was judged against, which is
 * the half of "the config is versioned and content records which version it
 * met" that a version number on the config alone does not give.
 *
 * Asserted at the schema level. Fabricating a whole campaign chain to insert
 * one row would test the fixture more than the column.
 */
describe('channel config version is recorded on content', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('exists, is required, and defaults to 1', async () => {
    const result = await harness.pglite.client.query<{
      is_nullable: string;
      column_default: string | null;
      data_type: string;
    }>(
      `SELECT is_nullable, column_default, data_type
         FROM information_schema.columns
        WHERE table_name = 'content_asset_versions'
          AND column_name = 'channel_config_version'`,
    );

    const column = result.rows[0];
    expect(column, 'channel_config_version column').toBeDefined();
    expect(column?.is_nullable).toBe('NO');
    expect(column?.data_type).toBe('integer');
    /*
     * The default is 1, not the current version. Rows written before the column
     * existed were never judged against the current config, and a default that
     * claimed otherwise would be a fabricated provenance told by a DDL
     * statement.
     */
    expect(column?.column_default).toMatch(/^1/u);
  });

  it('refuses a non-positive version', async () => {
    const result = await harness.pglite.client.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname = 'content_asset_channel_config_version_positive'`,
    );
    expect(result.rows[0]?.definition).toMatch(/channel_config_version > 0/u);
  });

  it('is required by the contract, so a producer cannot omit it', async () => {
    const { contentAssetVersion } = await import('@c360/contracts');
    const shape = contentAssetVersion.shape;
    expect('channelConfigVersion' in shape).toBe(true);
  });
});
