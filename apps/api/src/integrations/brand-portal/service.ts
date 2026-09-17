import { fontFamilyNames } from './font-names.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, desc, eq, sql } from 'drizzle-orm';
import { portalProvenance, type BrandProfileVersion, type CurrentUser } from '@c360/contracts';
import type { ServerEnv } from '@c360/config';
import { labels, brandProfileVersions, assets, contentAssetVersions } from '../../core/db/schema.js';
import type { DbOrTx } from '../../core/db/types.js';
import { FileStore } from '../../core/files/storage.js';
import { AppError } from '../../core/errors/app-error.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import type { AuditService } from '../../modules/audit/service.js';
import { configuredPortalClient } from './configured-client.js';
import { BrandPortalError, type BrandPortalClient } from './client.js';
import { mapPortalBundle } from './mapping.js';

export class PortalSyncService {
  constructor(private readonly env: Pick<ServerEnv, 'STORAGE_ROOT' | 'BRAND_PORTAL_BASE_URL' | 'BRAND_PORTAL_API_KEY'>,
    private readonly audit: AuditService,
    private readonly factory: (organizationId: string) => Pick<BrandPortalClient, 'bundle' | 'asset'> = organizationId => configuredPortalClient({
      STORAGE_ROOT: env.STORAGE_ROOT, BRAND_PORTAL_BASE_URL: env.BRAND_PORTAL_BASE_URL, BRAND_PORTAL_API_KEY: env.BRAND_PORTAL_API_KEY,
    }, organizationId)) {}

  async status(db: DbOrTx, labelId: string) {
    const [label] = await db.select().from(labels).where(eq(labels.id, labelId));
    if (!label) throw AppError.notFoundOrForbidden('label', labelId);
    return { configured: !!(this.env.BRAND_PORTAL_BASE_URL && this.env.BRAND_PORTAL_API_KEY),
      slug: label.brandPortalSlug, checkedAt: label.brandPortalCheckedAt?.toISOString() ?? null,
      error: label.brandPortalError };
  }

  async connect(db: DbOrTx, user: CurrentUser, labelId: string, slug: string): Promise<void> {
    requireLabelPermission(user, labelId, 'brand:write');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) throw new AppError('validation_failed');
    // Verify the credential can read the selected production brand before linking.
    await this.factory(user.organizationId).bundle({ slug, include: ['tokens', 'logos', 'fonts', 'profiles'], freshAssetUrls: true });
    await db.update(labels).set({ brandPortalSlug: slug, brandPortalCheckedAt: null, brandPortalError: null })
      .where(and(eq(labels.id, labelId), eq(labels.organizationId, user.organizationId)));
    await this.refresh(db, labelId, true);
  }

  async refresh(db: DbOrTx, labelId: string, force = false): Promise<void> {
    const [label] = await db.select().from(labels).where(eq(labels.id, labelId));
    if (!label?.brandPortalSlug) return;
    const slug = label.brandPortalSlug;
    if (!force && !label.brandPortalError && label.brandPortalCheckedAt && Date.now() - label.brandPortalCheckedAt.getTime() < 300_000) return;
    try {
      const client = this.factory(label.organizationId);
      const snapshot = await client.bundle({ slug, include: ['tokens', 'logos', 'fonts', 'profiles'], freshAssetUrls: true });
      if (snapshot.stale) throw new BrandPortalError('unavailable');
      const mapped = mapPortalBundle(snapshot.bundle);
      const fingerprint = createHash('sha256').update(JSON.stringify({ input: mapped.input, rules: mapped.rules,
        release: mapped.release, slug, logoId: mapped.logo.id,
        fonts: mapped.fonts.map(font => ({ family: font.family, weight: font.weight, paths: font.candidates.map(candidate => new URL(candidate.url, this.env.BRAND_PORTAL_BASE_URL).pathname) })),
      })).digest('hex');
      const [existing] = await db.select().from(brandProfileVersions).where(and(eq(brandProfileVersions.labelId, labelId), eq(brandProfileVersions.reviewState, 'approved')));
      const existingPortal = portalProvenance.nullish().parse(existing?.portal);
      if (existingPortal?.fingerprint === fingerprint) {
        await db.update(labels).set({ brandPortalCheckedAt: new Date(), brandPortalError: null }).where(and(eq(labels.id, labelId), eq(labels.brandPortalSlug, slug)));
        return;
      }
      const logo = await this.storeAsset(db, label.organizationId, labelId, await client.asset(mapped.logo.url), 'logo');
      const fontIds: string[] = [];
      for (const font of mapped.fonts) {
        let selected: Buffer | undefined;
        for (const candidate of font.candidates) {
          const bytes = await client.asset(candidate.url);
          if (fontFamilyNames(bytes).some(name => name.toLowerCase() === font.family.toLowerCase())) { selected = bytes; break; }
        }
        if (!selected) throw new BrandPortalError('invalid_response');
        fontIds.push(await this.storeAsset(db, label.organizationId, labelId, selected, 'font'));
      }
      await db.transaction(async tx => {
        const [locked] = await tx.select().from(labels).where(eq(labels.id, labelId)).for('update');
        if (locked?.brandPortalSlug !== slug) throw new AppError('conflict');
        const [latest] = await tx.select().from(brandProfileVersions).where(eq(brandProfileVersions.labelId, labelId)).orderBy(desc(brandProfileVersions.version)).limit(1);
        const [current] = await tx.select().from(brandProfileVersions).where(and(eq(brandProfileVersions.labelId, labelId), eq(brandProfileVersions.reviewState, 'approved')));
        const currentPortal = portalProvenance.nullish().parse(current?.portal);
        if (currentPortal?.fingerprint !== fingerprint) {
          if (currentPortal?.slug === slug && mapped.release.localeCompare(currentPortal.release, 'en', { numeric: true }) < 0) throw new AppError('conflict', { publicMessage: 'Een oudere Brand Portal-release wordt niet automatisch teruggezet.' });
          await tx.update(brandProfileVersions).set({ reviewState: 'archived' }).where(and(eq(brandProfileVersions.labelId, labelId), eq(brandProfileVersions.reviewState, 'approved')));
          const [saved] = await tx.insert(brandProfileVersions).values({ ...mapped.input,
            organizationId: label.organizationId, labelId, version: (latest?.version ?? 0) + 1,
            logoAssetId: logo, reviewState: 'approved', origin: 'external',
            portal: portalProvenance.parse({ slug, release: mapped.release, channel: 'production',
              importedAt: new Date().toISOString(), fingerprint, fontAssetIds: fontIds, ...mapped.rules, warnings: mapped.warnings }),
          }).returning();
          await tx.update(contentAssetVersions).set({ reviewState: 'needs_rereview' }).where(and(eq(contentAssetVersions.labelId, labelId), sql`${contentAssetVersions.reviewState} IN ('draft', 'approved')`));
          await this.audit.record(tx, { organizationId: label.organizationId, labelId, actorKind: 'system', action: 'brand.portal_imported',
            resourceType: 'brand_profile', resourceId: saved?.id ?? null, outcome: 'allowed', metadata: { slug, release: mapped.release, fingerprint } });
        }
        await tx.update(labels).set({ brandPortalCheckedAt: new Date(), brandPortalError: null }).where(eq(labels.id, labelId));
      });
    } catch (error) {
      const message = error instanceof BrandPortalError && error.kind === 'unavailable'
        ? 'Brand Portal is tijdelijk niet bereikbaar. De laatst gecontroleerde release blijft maximaal 24 uur bruikbaar.'
        : 'Brand Portal kon niet worden gesynchroniseerd. Controleer de verbinding, toegang en gepubliceerde merkgegevens.';
      await db.update(labels).set({ brandPortalError: message }).where(eq(labels.id, labelId));
      if (error instanceof BrandPortalError && error.kind === 'unavailable' && label.brandPortalCheckedAt && Date.now() - label.brandPortalCheckedAt.getTime() < 86_400_000) return;
      throw new AppError('provider_unavailable', { publicMessage: message });
    }
  }

  private async storeAsset(db: DbOrTx, organizationId: string, labelId: string, bytes: Buffer, kind: 'logo' | 'font'): Promise<string> {
    const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const otf = bytes.subarray(0, 4).toString('ascii') === 'OTTO';
    const ttf = bytes.length >= 12 && (bytes.readUInt32BE(0) === 0x00010000 || otf);
    if ((kind === 'logo' && (!png || bytes.length < 24 || bytes.readUInt32BE(16) > 10_000 || bytes.readUInt32BE(20) > 10_000)) || (kind === 'font' && !ttf)) throw new BrandPortalError('invalid_response');
    const store = new FileStore(this.env.STORAGE_ROOT);
    const quarantine = await store.quarantine(bytes);
    const stored = await store.promote(quarantine.storagePath, bytes, kind === 'logo' ? 'png' : otf ? 'otf' : 'ttf');
    await db.insert(assets).values({ organizationId, labelId, kind, ...stored, mimeType: kind === 'logo' ? 'image/png' : otf ? 'font/otf' : 'font/ttf' }).onConflictDoNothing();
    const [row] = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.labelId, labelId), eq(assets.kind, kind), eq(assets.sha256, stored.sha256)));
    if (!row) throw new AppError('internal_error');
    return row.id;
  }
}

/**
 * Reads a brand file, or says plainly that the storage does not have it.
 *
 * A raw `ENOENT` here used to surface as "Er is een onverwachte fout
 * opgetreden" and a dead job: the file was in another process's storage root.
 * The database row is intact, so this is a dependency that moved, not a crash
 * — and the message names the two things that fix it.
 */
export async function readStoredFile(filename: string, kindNl: string): Promise<Buffer> {
  try {
    return await readFile(filename);
  } catch (error: unknown) {
    throw new AppError('dependency_changed', {
      publicMessage: `Het ${kindNl} van dit merk staat niet in de opslag van deze omgeving. Controleer of api en worker dezelfde STORAGE_ROOT gebruiken, of synchroniseer het merk opnieuw.`,
      internalDetail: `brand ${kindNl} unreadable at ${filename}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function loadBrandResources(db: DbOrTx, storageRoot: string, brand: BrandProfileVersion): Promise<{ fontFiles: string[]; logoDataUri?: string; headingFamily?: string; bodyFamily?: string }> {
  if (!brand.portal) return { fontFiles: [] };
  const store = new FileStore(storageRoot);
  const fontFiles: string[] = [];
  let logoDataUri: string | undefined;
  const names: string[] = [];
  if (!brand.logoAssetId || !brand.portal.fontAssetIds.length) throw new AppError('dependency_changed');
  for (const id of [brand.logoAssetId, ...brand.portal.fontAssetIds]) {
    const [row] = await db.select().from(assets).where(and(eq(assets.id, id), eq(assets.labelId, brand.labelId), eq(assets.kind, id === brand.logoAssetId ? 'logo' : 'font')));
    if (!row) throw new AppError('dependency_changed');
    const filename = store.absolutePathFor(row.storagePath);
    const bytes = await readStoredFile(filename, id === brand.logoAssetId ? 'logo' : 'lettertype');
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new AppError('dependency_changed');
    if (id === brand.logoAssetId) logoDataUri = `data:image/png;base64,${bytes.toString('base64')}`;
    else { fontFiles.push(filename); names.push(...fontFamilyNames(bytes)); }
  }
  const headingFamily = names.find(name => name.toLowerCase() === brand.typography.headingFamily.toLowerCase());
  const bodyFamily = names.find(name => name.toLowerCase() === brand.typography.bodyFamily.toLowerCase());
  if (!headingFamily || !bodyFamily) throw new AppError('dependency_changed', { publicMessage: 'Een merkfont kan niet correct worden geladen. Synchroniseer het merk opnieuw.' });
  return { fontFiles, headingFamily, bodyFamily, ...(logoDataUri ? { logoDataUri } : {}) };
}
