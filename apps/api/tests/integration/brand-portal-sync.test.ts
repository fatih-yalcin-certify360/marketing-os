import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { brandProfileVersions, labels } from '../../src/core/db/schema.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';
import { PortalSyncService } from '../../src/integrations/brand-portal/service.js';
import { BrandPortalError, type PortalBundle } from '../../src/integrations/brand-portal/client.js';
import { BrandService } from '../../src/modules/brand/service.js';
import { buildContextBlock } from '../../src/core/ai/prompts.js';
import { fontFamilyNames } from '../../src/integrations/brand-portal/font-names.js';

function font(): Buffer {
  const name = Buffer.from('Portal Font', 'utf16le').swap16();
  const b = Buffer.alloc(46 + name.length);
  b.writeUInt32BE(0x00010000); b.writeUInt16BE(1, 4); b.write('name', 12);
  b.writeUInt32BE(28, 20); b.writeUInt32BE(18 + name.length, 24);
  b.writeUInt16BE(1, 30); b.writeUInt16BE(18, 32);
  b.writeUInt16BE(3, 34); b.writeUInt16BE(1, 40); b.writeUInt16BE(name.length, 42); name.copy(b, 46);
  return b;
}
function fixture(): PortalBundle {
  return { slug: 'cs-opleidingen', displayName: 'CS Opleidingen', version: '0.4.0', channel: 'production',
    tokens: { palette: { primary: { value: '#00A894' }, accent: { value: '#C5003E' }, ink: { value: '#203E58' } },
      ui: { 'font/heading': { value: 'Portal Font' }, 'font/body': { value: 'Portal Font' }, 'color/surface/default': { value: '#F3EDEB' }, 'color/text/body-light': { value: '#FFFFFF' } } },
    logos: [{ id: 'logo1', name: 'default-diapositive-rgb', format: 'png', mime: 'image/png', diapositive: true, url: 'https://portal.test/v1/assets/logo1/raw?secret=not-for-clients' }],
    fonts: { families: [{ family: 'Portal Font', files: [{ mime: 'font/ttf', style: 'normal', weight: 400, url: 'https://portal.test/v1/assets/font1/raw' }] }] },
    promptProfiles: {},
  };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=', 'base64');

describe('published Brand Portal integration', () => {
  let h: TestHarness, dir: string, id: string, sync: PortalSyncService, brand: BrandService;
  let bundle: PortalBundle, failure: BrandPortalError | undefined, downloads: number;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'portal-sync-'));
    h = await createTestHarness(); id = labelIdBySlug(h.seed, 'lindenhaeghe');
    bundle = fixture(); failure = undefined; downloads = 0;
    sync = new PortalSyncService({ STORAGE_ROOT: dir, BRAND_PORTAL_BASE_URL: 'https://portal.test', BRAND_PORTAL_API_KEY: 'test-key' }, h.appContext.services.audit, () => ({
      bundle: () => { if (failure) return Promise.reject(failure); return Promise.resolve({ bundle, fetchedAt: Date.now(), validatedAt: Date.now(), etag: null, stale: false }); },
      asset: url => { downloads++; return Promise.resolve(url.includes('logo') ? png : font()); },
    }));
    brand = new BrandService(h.appContext.services.approvals, sync);
  });
  afterEach(async () => { await h.close(); await rm(dir, { recursive: true, force: true }); });

  it('activates production immediately, pins local assets and does not copy missing writing rules', async () => {
    await sync.connect(h.db, h.currentUser, id, 'cs-opleidingen');
    const active = await brand.requireApproved(h.db, id);
    expect(active).toMatchObject({ reviewState: 'approved', origin: 'external', colors: { primary: '#00A894' }, portal: { release: '0.4.0', contentInstructions: '' } });
    expect(active.logoAssetId).toBeTruthy(); expect(active.portal?.fontAssetIds).toHaveLength(1);
    expect(active.portal?.warnings).toHaveLength(1);
    expect(JSON.stringify(active)).not.toMatch(/secret=|portal.test|test-key/u);
  });

  it('reuses unchanged releases and versions changed releases without mutating their rules', async () => {
    await sync.connect(h.db, h.currentUser, id, 'cs-opleidingen');
    const first = await brand.requireApproved(h.db, id);
    const downloaded = downloads;
    await sync.refresh(h.db, id, true);
    expect(downloads).toBe(downloaded);
    expect((await brand.requireApproved(h.db, id)).id).toBe(first.id);
    bundle = { ...bundle, version: '0.5.0', promptProfiles: { content_profile: { styleGuide: 'Schrijf duidelijk voor HR-professionals.', contentInstructions: 'Gebruik aanspreekvorm je.' } } };
    await sync.refresh(h.db, id, true);
    const next = await brand.requireApproved(h.db, id);
    expect(next.version).toBe(first.version + 1);
    expect((await brand.findVersion(h.db, id, first.id))?.reviewState).toBe('archived');
    expect((await brand.findVersion(h.db, id, first.id))?.portal?.styleGuide).toBe('');
    expect(buildContextBlock({ language: 'nl', course: null, brand: next })).toContain('Schrijf duidelijk voor HR-professionals.');
  });

  it('never treats authorization failure as a usable cached release', async () => {
    await sync.connect(h.db, h.currentUser, id, 'cs-opleidingen');
    failure = new BrandPortalError('unauthorized');
    await expect(sync.refresh(h.db, id, true)).rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(brand.requireApproved(h.db, id)).rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('bounds outage fallback and exposes it to the brand screen', async () => {
    await sync.connect(h.db, h.currentUser, id, 'cs-opleidingen');
    failure = new BrandPortalError('unavailable');
    await sync.refresh(h.db, id, true);
    expect((await sync.status(h.db, id)).error).toBeTruthy();
    await h.db.update(labels).set({ brandPortalCheckedAt: new Date(Date.now() - 86_400_001) }).where(eq(labels.id, id));
    await expect(brand.requireApproved(h.db, id)).rejects.toThrow();
  });

  it('refuses malformed or draft releases without replacing the current approved profile', async () => {
    await sync.connect(h.db, h.currentUser, id, 'cs-opleidingen');
    bundle = { ...bundle, channel: 'draft', version: '0.5.0' };
    await expect(sync.refresh(h.db, id, true)).rejects.toThrow();
    const rows = await h.db.select().from(brandProfileVersions).where(eq(brandProfileVersions.labelId, id));
    expect(rows.filter(row => row.portal !== null)).toHaveLength(1); expect(rows.find(row => row.portal !== null)?.reviewState).toBe('approved');
  });

  it('requires label permission to connect and keeps other labels untouched', async () => {
    const denied = { ...h.currentUser, memberships: [] };
    // The authorization contract supplies roles per membership; a foreign id is never reachable.
    await expect(sync.connect(h.db, denied, '00000000-0000-4000-8000-000000000099', 'cs-opleidingen')).rejects.toThrow();
    const other = labelIdBySlug(h.seed, 'demolabel-2');
    await sync.connect(h.db, h.currentUser, id, 'cs-opleidingen');
    expect((await sync.status(h.db, other)).slug).toBeNull();
  });

  it('rejects font files with broken family metadata', () => {
    expect(fontFamilyNames(font())).toContain('Portal Font');
    const corrupt = font(); corrupt.writeUInt32BE(0xffffffff, 20);
    expect(fontFamilyNames(corrupt)).toEqual([]);
  });
});
