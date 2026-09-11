import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { assets, auditEvents } from '../../src/core/db/schema.js';
import { FileStore } from '../../src/core/files/storage.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * The upload surface over HTTP (backlog P1-2).
 *
 * The unit tests cover the validation rules; this file covers what happens
 * around them — authorisation, quarantine, what actually reaches disk, how a
 * file is handed back, and whether a second label can see it.
 */

/** A multipart body, built by hand so the boundary is exactly what we send. */
function multipart(
  fieldName: string,
  filename: string,
  contentType: string,
  content: Buffer,
): { body: Buffer; headers: Record<string, string> } {
  const boundary = '----c360testboundary9f2c';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    body: Buffer.concat([head, content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(128, 0x20),
]);

const CLEAN_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/></svg>',
);

const SCRIPTED_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/v1/me")</script></svg>',
);

describe('upload surface', () => {
  let harness: TestHarness;
  let storageRoot: string;
  let labelId: string;
  let otherLabelId: string;

  const upload = async (
    label: string,
    purpose: string,
    filename: string,
    contentType: string,
    content: Buffer,
  ) => {
    const { body, headers } = multipart('file', filename, contentType, content);
    return harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${label}/uploads/${purpose}`,
      headers,
      payload: body,
    });
  };

  beforeAll(async () => {
    storageRoot = await mkdtemp(path.join(tmpdir(), 'c360-upload-test-'));
    harness = await createTestHarness({ envOverrides: { STORAGE_ROOT: storageRoot } });
    labelId = labelIdBySlug(harness.seed, 'lindenhaeghe');
    otherLabelId = labelIdBySlug(harness.seed, 'demolabel-2');
  });

  afterAll(async () => {
    await harness.close();
  });

  it('accepts a PNG logo and records it as an upload asset', async () => {
    const response = await upload(labelId, 'brand_logo', 'logo.png', 'image/png', PNG);
    expect(response.statusCode).toBe(201);

    const body = response.json<{ id: string; mimeType: string; servingMode: string; sha256: string }>();
    expect(body.mimeType).toBe('image/png');
    expect(body.servingMode).toBe('inline_image');

    const rows = await harness.db.select({ kind: assets.kind, storagePath: assets.storagePath })
      .from(assets)
      .where(eq(assets.id, body.id));
    expect(rows[0]?.kind).toBe('upload');
    // Content-addressed, so the filename never reaches the filesystem.
    expect(rows[0]?.storagePath).toMatch(/^uploads\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/u);
  });

  it('leaves nothing in quarantine after an accepted upload', async () => {
    await upload(labelId, 'brand_logo', 'second.png', 'image/png', Buffer.concat([PNG, Buffer.from('x')]));

    const entries = await readdir(path.join(storageRoot, 'quarantine')).catch(() => []);
    expect(entries.filter((entry) => entry.endsWith('.bin'))).toHaveLength(0);
  });

  it('leaves nothing in quarantine after a refused upload either', async () => {
    const response = await upload(labelId, 'brand_logo', 'evil.svg', 'image/svg+xml', SCRIPTED_SVG);
    expect(response.statusCode).toBe(422);

    const entries = await readdir(path.join(storageRoot, 'quarantine')).catch(() => []);
    expect(entries.filter((entry) => entry.endsWith('.bin'))).toHaveLength(0);
  });

  it('refuses a scripted SVG with a Dutch reason and no internal detail', async () => {
    const response = await upload(labelId, 'brand_logo', 'evil.svg', 'image/svg+xml', SCRIPTED_SVG);
    const body = response.json<{ error: { code: string; message: string } }>();

    expect(response.statusCode).toBe(422);
    expect(body.error.message).toMatch(/script/iu);
    // The internal finding stays in the audit trail.
    expect(response.body).not.toMatch(/script element/u);
    expect(response.body).not.toMatch(/at .*\.ts:/u);
  });

  it('records a refusal in the audit trail without storing the file content', async () => {
    await upload(labelId, 'brand_logo', 'evil2.svg', 'image/svg+xml', SCRIPTED_SVG);

    const rows = await harness.db
      .select({ action: auditEvents.action, outcome: auditEvents.outcome, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(eq(auditEvents.action, 'upload.rejected'));

    expect(rows.length).toBeGreaterThan(0);
    const record = rows[rows.length - 1];
    expect(record?.outcome).toBe('denied');
    // What was detected, never the payload.
    expect(JSON.stringify(record?.metadata)).toMatch(/script element/u);
    expect(JSON.stringify(record?.metadata)).not.toMatch(/fetch\(/u);
  });

  it('refuses a document in the logo slot', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
    const response = await upload(labelId, 'brand_logo', 'brochure.pdf', 'application/pdf', pdf);
    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(/afbeelding/u);
  });

  it('refuses an unknown purpose rather than guessing a permission', async () => {
    const response = await upload(labelId, 'anything_goes', 'logo.png', 'image/png', PNG);
    expect(response.statusCode).toBe(422);
  });

  it('accepts exactly the purposes that have a consumer', async () => {
    /*
     * The list, pinned, so adding one is a deliberate act.
     *
     * Every purpose here has something on the other end that reads what was
     * uploaded: references reach image generation, source documents reach
     * research runs, course documents reach the extraction job, a logo reaches
     * the render layer, an outcome report is referenced by the figures somebody
     * read off it. `brand_document` was accepted for a while and had
     * none — it stored files no code path ever read, which is storage and
     * accepted-file surface in exchange for nothing. It was removed rather
     * than given a screen.
     *
     * This test is the forcing function for the rule: a purpose arrives with
     * its consumer, in the same change. Adding one to the API without adding
     * it here fails, and the reader of that failure has to answer "what reads
     * this?".
     */
    const images = ['visual_reference', 'brand_logo'];
    const documents = ['course_document', 'source_document', 'outcome_report'];
    const document = Buffer.from('Basisopleiding Praktijkvoorbeeld (Demo)\n', 'utf8');

    for (const purpose of images) {
      const response = await upload(labelId, purpose, 'logo.png', 'image/png', PNG);
      expect(response.statusCode, purpose).toBe(201);
    }
    for (const purpose of documents) {
      const response = await upload(labelId, purpose, 'brochure.txt', 'text/plain', document);
      expect(response.statusCode, purpose).toBe(201);
    }

    // Removed, and therefore now indistinguishable from a typo.
    const gone = await upload(labelId, 'brand_document', 'guidelines.txt', 'text/plain', document);
    expect(gone.statusCode).toBe(422);
  });

  it('refuses a request with no file part', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/labels/${labelId}/uploads/brand_logo`,
      headers: { 'content-type': 'multipart/form-data; boundary=----empty' },
      payload: Buffer.from('------empty--\r\n'),
    });
    expect(response.statusCode).toBe(400);
  });

  it('serves an accepted SVG as an attachment, never inline', async () => {
    const created = await upload(labelId, 'brand_logo', 'clean.svg', 'image/svg+xml', CLEAN_SVG);
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/uploads/${id}/file`,
    });

    expect(response.statusCode).toBe(200);
    // The decisive headers: an SVG must never be handed back as a renderable
    // document from this origin.
    expect(response.headers['content-type']).toBe('application/octet-stream');
    expect(String(response.headers['content-disposition'])).toMatch(/^attachment;/u);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(String(response.headers['content-security-policy'])).toMatch(/sandbox/u);
    expect(String(response.headers['cache-control'])).toMatch(/no-store/u);
  });

  it('serves a raster image inline, with sniffing still disabled', async () => {
    const created = await upload(labelId, 'brand_logo', 'inline.png', 'image/png', Buffer.concat([PNG, Buffer.from('yy')]));
    const { id } = created.json<{ id: string }>();

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/uploads/${id}/file`,
    });

    expect(response.headers['content-type']).toBe('image/png');
    expect(String(response.headers['content-disposition'])).toMatch(/^inline;/u);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('does not serve an upload to another label', async () => {
    const created = await upload(labelId, 'brand_logo', 'private.png', 'image/png', Buffer.concat([PNG, Buffer.from('zz')]));
    const { id } = created.json<{ id: string }>();

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${otherLabelId}/uploads/${id}/file`,
    });

    // Not "forbidden": that would confirm the id exists in another label.
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('not_found');
  });

  it('stores identical content once per label', async () => {
    const content = Buffer.concat([PNG, Buffer.from('dedupe')]);
    const first = await upload(labelId, 'brand_logo', 'a.png', 'image/png', content);
    const second = await upload(labelId, 'brand_logo', 'b.png', 'image/png', content);

    expect(first.statusCode).toBe(201);
    expect(second.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    expect(second.json<{ deduplicated: boolean }>().deduplicated).toBe(true);
  });

  it('reports not found when the row outlives the file', async () => {
    const created = await upload(labelId, 'brand_logo', 'gone.png', 'image/png', Buffer.concat([PNG, Buffer.from('gone')]));
    const { id } = created.json<{ id: string }>();

    const rows = await harness.db
      .select({ storagePath: assets.storagePath })
      .from(assets)
      .where(eq(assets.id, id));
    const absolute = path.join(storageRoot, String(rows[0]?.storagePath));
    // Simulate a restore that brought back the database but not the files.
    await writeFile(absolute, Buffer.alloc(0));
    const { rm } = await import('node:fs/promises');
    await rm(absolute);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/labels/${labelId}/uploads/${id}/file`,
    });
    // Honest 404 rather than a zero-length body presented as the file.
    expect(response.statusCode).toBe(404);
  });
});

describe('quarantine housekeeping', () => {
  it('removes abandoned files and leaves accepted ones alone', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'c360-sweep-test-'));
    const store = new FileStore(root);

    const abandoned = await store.quarantine(Buffer.from('interrupted'));
    const fresh = await store.quarantine(Buffer.from('in progress'));

    // Nothing is old enough yet.
    expect(await store.sweepQuarantine(60_000)).toBe(0);

    // An hour later, both are stale.
    const removed = await store.sweepQuarantine(60_000, Date.now() + 3_600_000);
    expect(removed).toBe(2);

    for (const file of [abandoned, fresh]) {
      await expect(stat(path.join(root, file.storagePath))).rejects.toThrow();
    }
  });

  it('refuses a storage path that escapes the root', () => {
    const store = new FileStore('/tmp/c360-root');
    expect(() => store.absolutePathFor('../../etc/passwd')).toThrow(/escapes STORAGE_ROOT/u);
    expect(() => store.absolutePathFor('/etc/passwd')).toThrow(/escapes STORAGE_ROOT/u);
    // A legitimate relative path still resolves.
    expect(store.absolutePathFor('uploads/ab/cd.png')).toBe('/tmp/c360-root/uploads/ab/cd.png');
  });

  it('does not touch the served store', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'c360-sweep-keep-'));
    const store = new FileStore(root);
    const quarantined = await store.quarantine(PNG);
    const stored = await store.promote(quarantined.storagePath, PNG, 'png');

    await store.sweepQuarantine(0, Date.now() + 3_600_000);

    // Deleting a file an asset row still references would be data loss.
    expect((await stat(path.join(root, stored.storagePath))).size).toBe(PNG.length);
  });
});
