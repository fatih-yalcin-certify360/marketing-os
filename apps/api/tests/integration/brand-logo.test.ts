import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { BRAND_STARTING_POINT } from '@c360/contracts';
import { createHash } from 'node:crypto';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';
import { assets } from '../../src/core/db/schema.js';
import { loadRenderResources } from '../../src/core/render/brand-resources.js';

/**
 * A label's own logo: uploaded, referenced, and actually composited.
 *
 * The endpoint that receives a logo, its file validation and the column that
 * holds the reference had all existed for some time with **nothing on the other
 * end**: the render path loaded a logo only for labels linked to Brand Portal,
 * so a locally uploaded logo was validated, stored, referenced — and never
 * drawn. This covers the chain end to end, and the two places it can go wrong
 * without anyone noticing.
 *
 * The subtle one is the asset *kind*. Every upload is stored as kind `upload`
 * whatever purpose it was sent for, and `logo` is reserved for a Portal
 * release. A check for kind `logo` therefore looks right, passes review, and
 * rejects every uploaded logo — which is what the first version of this did.
 */
describe('a brand logo uploaded by the label itself', () => {
  let h: TestHarness;
  let root: string;
  let labelId: string;
  let otherLabelId: string;
  const png = Buffer.from(
    new Resvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="16"><rect width="48" height="16" fill="#123456"/></svg>',
    )
      .render()
      .asPng(),
  );

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'c360-logo-'));
    h = await createTestHarness({ envOverrides: { STORAGE_ROOT: root } });
    labelId = labelIdBySlug(h.seed, 'lindenhaeghe');
    otherLabelId = labelIdBySlug(h.seed, 'demolabel-3');
  });

  afterAll(async () => {
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  /** Uploads a logo and returns its asset id. */
  async function uploadLogo(target: string, bytes: Buffer = png): Promise<string> {
    const asset = await h.appContext.services.uploads.accept(h.db, h.currentUser, {
      labelId: target,
      purpose: 'brand_logo',
      filename: 'logo.png',
      bytes,
    });
    return asset.id;
  }

  it('stores the reference and composites the file into a rendered image', async () => {
    const { db, currentUser: user } = h;
    const brand = h.appContext.services.brand;
    const assetId = await uploadLogo(labelId);

    const saved = await brand.saveDraft(db, user, labelId, {
      ...BRAND_STARTING_POINT,
      brandName: 'Logo-test (Demo)',
      logoAssetId: assetId,
    });
    expect(saved.logoAssetId).toBe(assetId);

    /*
     * The decisive assertion: the bytes reach the renderer.
     *
     * Storing the reference is the easy half. This is the half that was
     * missing — `loadRenderResources` returning nothing for a label without a
     * Portal link meant the logo existed everywhere except in the output.
     */
    const resources = await loadRenderResources(db, root, saved);
    expect(resources.logoDataUri).toMatch(/^data:image\/png;base64,/u);
    expect(resources.logoDataUri).toContain(png.toString('base64'));
    // No brand fonts come from a local upload; the renderer uses its own.
    expect(resources.fontFiles).toEqual([]);
  });

  it('refuses a logo belonging to another label, without confirming it exists', async () => {
    const { db, currentUser: user } = h;
    /*
     * Written directly, because the upload endpoint would refuse first.
     *
     * The seeded identity has no `brand:write` on the other label, so it
     * cannot upload there — and that refusal is not what this test is about.
     * The property under test is the *brand service's* label scoping: an asset
     * id that genuinely exists, genuinely is a PNG, and simply belongs
     * somewhere else.
     */
    const foreign = crypto.randomUUID();
    await db.insert(assets).values({
      id: foreign,
      organizationId: user.organizationId,
      labelId: otherLabelId,
      kind: 'upload',
      mimeType: 'image/png',
      byteSize: png.byteLength,
      sha256: createHash('sha256').update(png).digest('hex'),
      storagePath: 'uploads/ff/foreign-logo.png',
      originalName: 'logo.png',
      createdByUserId: user.userId,
    });

    // `not_found`, not `forbidden`: with authority on this label, an id from
    // another one must not become an existence oracle.
    await expect(
      h.appContext.services.brand.saveDraft(db, user, labelId, {
        ...BRAND_STARTING_POINT,
        logoAssetId: foreign,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses a document that happens to belong to the same label', async () => {
    const { db, currentUser: user } = h;
    /*
     * The purpose an upload was made for is not recorded on the asset row, so
     * nothing stops a client sending the id of a course document as its logo.
     * The stored type — decided by the file's own bytes — is what refuses it.
     */
    const document = await h.appContext.services.uploads.accept(h.db, h.currentUser, {
      labelId,
      purpose: 'course_document',
      filename: 'brochure.txt',
      bytes: Buffer.from('Basisopleiding Praktijkvoorbeeld (Demo)\n\nVier bijeenkomsten.\n', 'utf8'),
    });

    await expect(
      h.appContext.services.brand.saveDraft(db, user, labelId, {
        ...BRAND_STARTING_POINT,
        logoAssetId: document.id,
      }),
    ).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('refuses to render a logo whose bytes no longer match what was validated', async () => {
    const { db, currentUser: user } = h;
    const assetId = await uploadLogo(labelId, Buffer.concat([png, Buffer.from('#')]));
    const saved = await h.appContext.services.brand.saveDraft(db, user, labelId, {
      ...BRAND_STARTING_POINT,
      logoAssetId: assetId,
    });

    /*
     * Overwrite the stored file, then render.
     *
     * This is the last point at which content is checked before it is
     * composited into an image the product exports. Anything that could alter
     * a file on disk — a restore, a bug, an attacker with filesystem access —
     * must not reach a branded PNG.
     */
    const stored = await h.appContext.services.uploads.requireForDownload(
      db,
      user,
      labelId,
      assetId,
    );
    await writeFile(
      h.appContext.services.uploads.absolutePathFor(stored.storagePath),
      Buffer.from('not the file that was validated', 'utf8'),
    );

    await expect(loadRenderResources(db, root, saved)).rejects.toMatchObject({
      code: 'dependency_changed',
    });
  });
});
