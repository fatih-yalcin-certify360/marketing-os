import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { BrandProfileVersion } from '@c360/contracts';
import type { DbOrTx } from '../db/types.js';
import { assets } from '../db/schema.js';
import { AppError } from '../errors/app-error.js';
import { FileStore } from '../files/storage.js';
import { loadBrandResources, readStoredFile } from '../../integrations/brand-portal/service.js';

/**
 * The files the renderer composites: brand fonts and the real logo.
 *
 * Two sources, and the distinction is not cosmetic:
 *
 *  - A **Portal-linked** label gets everything from its published release —
 *    logo *and* licensed fonts — and `loadBrandResources` refuses to render
 *    at all if any of it is missing or has changed underneath. That strictness
 *    is right there: the release is the authority, and a half-loaded release
 *    would silently produce off-brand output.
 *  - A label with **no Portal link** may still have uploaded a logo. Local
 *    editing is refused for Portal-managed labels (`saveDraft` throws), so
 *    these two cases cannot both apply and there is nothing to reconcile.
 *
 * This wrapper exists because the Portal function returns `{ fontFiles: [] }`
 * for any label without a `portal` block, which meant an uploaded logo was
 * accepted, stored, referenced by the brand profile — and then never reached
 * the renderer. The upload endpoint had existed for some time with nothing on
 * the other end of it.
 *
 * No brand *fonts* come from a local upload: fonts are licensed files that
 * arrive with a Portal release. A local label therefore renders in the
 * renderer's own families, which is what it did before and is visibly a
 * placeholder rather than a wrong brand.
 */
export async function loadRenderResources(
  db: DbOrTx,
  storageRoot: string,
  brand: BrandProfileVersion,
): Promise<{
  fontFiles: string[];
  logoDataUri?: string;
  headingFamily?: string;
  bodyFamily?: string;
}> {
  if (brand.portal) {
    return loadBrandResources(db, storageRoot, brand);
  }
  if (brand.logoAssetId === null) {
    return { fontFiles: [] };
  }

  /*
   * Label-scoped and kind-checked, again.
   *
   * The reference was validated when it was saved, but this read is what
   * decides which bytes get composited into an exportable image, so it does
   * not lean on that earlier check: an asset that has since been replaced, or
   * an id that somehow belongs elsewhere, must not render.
   */
  const rows = await db
    .select({ storagePath: assets.storagePath, sha256: assets.sha256 })
    .from(assets)
    .where(
      and(
        eq(assets.id, brand.logoAssetId),
        eq(assets.labelId, brand.labelId),
        // Uploads are all stored as kind `upload`; `logo` belongs to a Portal
        // release, which the branch above has already handled.
        eq(assets.kind, 'upload'),
        eq(assets.mimeType, 'image/png'),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new AppError('dependency_changed', {
      publicMessage: 'Het logo van dit merkprofiel is niet meer beschikbaar. Upload het opnieuw.',
      internalDetail: `brand logo asset ${brand.logoAssetId} not found for label ${brand.labelId}`,
    });
  }

  const filename = new FileStore(storageRoot).absolutePathFor(row.storagePath);
  const bytes = await readStoredFile(filename, 'logo');
  /*
   * The stored hash decides whether these bytes are the file that was
   * validated. Without it, anything that could alter a file on disk would be
   * composited into a branded image and exported — the one place where the
   * product's output stops being reviewable text.
   */
  if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
    throw new AppError('dependency_changed', {
      publicMessage: 'Het logo van dit merkprofiel kan niet worden gelezen. Upload het opnieuw.',
      internalDetail: `brand logo asset ${brand.logoAssetId} failed its content hash`,
    });
  }

  return { fontFiles: [], logoDataUri: `data:image/png;base64,${bytes.toString('base64')}` };
}
