import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobs } from '../../src/core/db/schema.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * The workflow gates, checked where the user can act on the answer.
 *
 * This file exists because of a real regression. Generation was moved onto the
 * worker so that a slow model can never time out a request, and the gate checks
 * moved with it. The result was that asking for concepts without an approved
 * brief returned **202 Accepted** with a job id: the control still held — the
 * job died with the right Dutch message — but the user got a progress bar for
 * work that was never going to run, a budget reservation was held against it,
 * and a precise refusal became a delayed failure.
 *
 * The requirement is that critical controls are not skipped, and a control that
 * fires a minute later in a failure message is not the same control. So each
 * gated step is checked twice: before enqueueing, so the answer is immediate,
 * and again in the handler, because state can change in between. These tests
 * pin the first half; the job-runner tests cover the second.
 */
describe('generation gates', () => {
  let harness: TestHarness;
  let labelId: string;
  let campaignId: string;
  let courseVersionId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    labelId = labelIdBySlug(harness.seed, 'lindenhaeghe');

    const courses = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/courses`,
    });
    const courseBody = courses.json<{ items: { course: { id: string } }[] }>();
    courseVersionId = courseBody.items[0]?.course.id ?? '';
    expect(courseVersionId).not.toBe('');

    const campaign = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/campaigns`,
      payload: {
        name: 'Gate test (Demo)',
        entryMode: 'discover_opportunities',
        courseVersionId,
      },
    });
    expect(campaign.statusCode).toBe(201);
    campaignId = campaign.json<{ id: string }>().id;
  });

  afterAll(async () => {
    await harness.close();
  });

  /** Jobs created so far, to prove a refusal queued nothing. */
  const jobCount = async (): Promise<number> => {
    const rows = await harness.db.select({ id: jobs.id }).from(jobs);
    return rows.length;
  };

  it('refuses concepts before the brief is approved, without queueing anything', async () => {
    const before = await jobCount();

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/concepts/propose`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('gate_not_passed');
    // Dutch, and specific enough to act on.
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(/briefing/iu);

    // The decisive assertion: no job row, so no progress bar and no budget hold.
    expect(await jobCount()).toBe(before);
  });

  it('refuses a content plan before a concept is selected', async () => {
    const before = await jobCount();

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/plan/propose`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(await jobCount()).toBe(before);
  });

  it('refuses content production before the plan is approved', async () => {
    const before = await jobCount();

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/content/generate`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(await jobCount()).toBe(before);
  });

  it('refuses a brief draft naming a persona that does not exist', async () => {
    const before = await jobCount();

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/campaigns/${campaignId}/brief/draft`,
      payload: { personaVersionIds: ['11111111-1111-4111-8111-111111111111'] },
    });

    // Not found rather than forbidden: the id must not be confirmed to exist
    // somewhere else.
    expect(response.statusCode).toBe(404);
    expect(await jobCount()).toBe(before);
  });

  it('refuses a label where the caller may read but not write', async () => {
    // Seeded as label_viewer on this label, so the permission check refuses
    // before anything is looked up. 403 is right here and leaks nothing: the
    // caller already knows they are a member.
    const viewerLabel = labelIdBySlug(harness.seed, 'demolabel-2');
    const before = await jobCount();

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${viewerLabel}/campaigns/${campaignId}/concepts/propose`,
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(await jobCount()).toBe(before);
  });

  /*
   * The SSRF guard belongs at the door as well as in the job.
   *
   * It was only in the job at first, so `file:///etc/passwd` and
   * `http://169.254.169.254/` both came back as **202 Accepted** with a job id:
   * a progress bar for a URL that would never be fetched, a budget reservation
   * held for it, and a queue slot spent. `z.url()` does not help — it accepts
   * any scheme.
   *
   * Everything decidable from the URL alone is decided in the route.
   * The *address* check stays in the job, because DNS can resolve differently a
   * second later and must be checked next to the connection.
   */
  it('refuses a hostile course-page URL before queueing anything', async () => {
    const hostile = [
      'file:///etc/passwd',
      'http://169.254.169.254/latest/meta-data/',
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://example.com:6379/x',
      'https://user:secret@example.com/x',
      'https://intranet/wiki',
      'gopher://example.com/x',
      'https://something.internal/x',
    ];

    for (const url of hostile) {
      const before = await jobCount();
      const response = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/labels/${labelId}/courses/extract-from-url`,
        payload: { url },
      });

      expect(response.statusCode, url).toBe(400);
      // The decisive assertion: nothing was queued.
      expect(await jobCount(), url).toBe(before);
      // Dutch, and free of internal detail about what was found.
      const message = response.json<{ error: { message: string } }>().error.message;
      expect(message, url).not.toMatch(/169\.254|metadata|loopback|link-local/iu);
    }
  });

  it('accepts a plausible public https course page', async () => {
    // Shape only — nothing is fetched here, and the address check runs in the
    // job. This is the counterpart to the test above: the guard must not be so
    // broad that an ordinary source is refused.
    const before = await jobCount();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/courses/extract-from-url`,
      payload: { url: 'https://www.example.org/opleidingen/wft-basis' },
    });

    expect(response.statusCode).toBe(202);
    expect(await jobCount()).toBe(before + 1);
  });

  it('refuses a campaign belonging to another label, without confirming it exists', async () => {
    // label_editor here, so the permission check passes and the campaign
    // lookup is what refuses. That is the case worth pinning: with authority on
    // the label, a campaign id from a *different* label must read as absent
    // rather than forbidden, or the id becomes an existence oracle.
    const editorLabel = labelIdBySlug(harness.seed, 'demolabel-3');
    const before = await jobCount();

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${editorLabel}/campaigns/${campaignId}/concepts/propose`,
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('not_found');
    expect(await jobCount()).toBe(before);
  });
});
