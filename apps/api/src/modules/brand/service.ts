import type { PortalSyncService } from '../../integrations/brand-portal/service.js';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  portalProvenance,
  brandColors,
  brandProfileInput,
  brandTypography,
  toneOfVoice,
  type BrandProfileInput,
  type BrandProfileVersion,
  type CurrentUser,
  type ReviewState,
} from '@c360/contracts';
import { z } from 'zod';
import type { Db, DbOrTx } from '../../core/db/types.js';
import { assets, brandProfileVersions } from '../../core/db/schema.js';
import { AppError } from '../../core/errors/app-error.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import type { ApprovalService } from '../reviews-approvals/service.js';

/**
 * Brand profiles.
 *
 * Append-only: a revision inserts version n+1 and no row is ever updated in
 * place, so an approval bound to a version keeps pointing at exactly what was
 * approved (ADR-0012).
 *
 * `approve` archives the previously approved version in the same transaction,
 * which is what keeps the partial unique index
 * `brand_one_approved_per_label` satisfiable — and means "the approved brand
 * profile" is always a single unambiguous row.
 */

const rulesSchema = z.array(z.object({ kind: z.enum(['must', 'must_not']), text: z.string() }));

export class BrandService {
  /** Set at wiring time (`server.ts`); see the note on `CourseService`. */
  private flagStaleContent?: (db: DbOrTx, labelId: string) => Promise<number>;

  useStaleContentFlagger(flag: (db: DbOrTx, labelId: string) => Promise<number>): void {
    this.flagStaleContent = flag;
  }

  constructor(private readonly approvals: ApprovalService, public readonly portal?: PortalSyncService) {}

  /** The approved profile, or undefined when the label has none yet. */
  async approved(db: DbOrTx, labelId: string): Promise<BrandProfileVersion | undefined> {
    await this.portal?.refresh(db, labelId);
    const rows = await db
      .select()
      .from(brandProfileVersions)
      .where(
        and(
          eq(brandProfileVersions.labelId, labelId),
          eq(brandProfileVersions.reviewState, 'approved'),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toBrandProfile(row);
  }

  /** The most recent version regardless of state, for the editing screen. */
  async latest(db: DbOrTx, labelId: string): Promise<BrandProfileVersion | undefined> {
    const rows = await db
      .select()
      .from(brandProfileVersions)
      .where(eq(brandProfileVersions.labelId, labelId))
      .orderBy(desc(brandProfileVersions.version))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toBrandProfile(row);
  }

  async listVersions(
    db: Db,
    user: CurrentUser,
    labelId: string,
    limit: number,
  ): Promise<BrandProfileVersion[]> {
    requireLabelPermission(user, labelId, 'brand:read');
    const rows = await db
      .select()
      .from(brandProfileVersions)
      .where(eq(brandProfileVersions.labelId, labelId))
      .orderBy(desc(brandProfileVersions.version))
      .limit(limit);
    return rows.map(toBrandProfile);
  }

  async findVersion(
    db: DbOrTx,
    labelId: string,
    id: string,
  ): Promise<BrandProfileVersion | undefined> {
    const rows = await db
      .select()
      .from(brandProfileVersions)
      // The redundant label predicate means a foreign id cannot return a row.
      .where(and(eq(brandProfileVersions.id, id), eq(brandProfileVersions.labelId, labelId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toBrandProfile(row);
  }

  /**
   * Creates the next version from user input.
   *
   * The version number is computed inside the transaction with a
   * `SELECT max(version)`, and the unique constraint on (label_id, version) is
   * the real guard: if two requests race, one fails on the constraint rather
   * than both writing version n+1.
   */
  async saveDraft(
    db: Db,
    user: CurrentUser,
    labelId: string,
    input: BrandProfileInput,
  ): Promise<BrandProfileVersion> {
    requireLabelPermission(user, labelId, 'brand:write');
    if ((await this.portal?.status(db, labelId))?.slug) throw new AppError('conflict', { publicMessage: 'Dit merk wordt beheerd in Brand Portal. Wijzig de regels daar en synchroniseer opnieuw.' });
    const parsed = brandProfileInput.parse(input);

    /*
     * A logo id from the client is a request, not a permission.
     *
     * The asset must exist, belong to *this* label and actually be a logo. A
     * missing or foreign id reads as absent rather than forbidden, so the
     * response cannot be used to find out which asset ids exist elsewhere —
     * the same rule the rest of the product follows for cross-label ids.
     *
     * Checked before the transaction because it is a read that decides whether
     * to write at all, and it needs no isolation from the insert.
     */
    if (parsed.logoAssetId !== null) {
      const found = await db
        .select({ mimeType: assets.mimeType })
        .from(assets)
        .where(
          and(
            eq(assets.id, parsed.logoAssetId),
            eq(assets.labelId, labelId),
            // Every upload is stored as kind `upload` whatever its purpose was;
            // `logo` is reserved for a Brand Portal release, and those labels
            // cannot reach this method at all (refused above).
            eq(assets.kind, 'upload'),
          ),
        )
        .limit(1);
      const asset = found[0];
      if (asset === undefined) {
        throw AppError.notFoundOrForbidden('asset', parsed.logoAssetId);
      }
      /*
       * PNG only, and refused rather than accepted-and-ignored.
       *
       * The purpose an upload was made for is not recorded on the asset row,
       * so this is the check that separates a logo from a course document that
       * happens to belong to the same label: the *stored* type, which was
       * decided by the file's own bytes.
       *
       * PNG specifically because that is the format the renderer is known to
       * composite, and the only one the Portal path produces. A JPEG would be
       * accepted by the upload endpoint and then quietly fail to draw into an
       * exportable image, which is worse than being told now.
       */
      if (asset.mimeType !== 'image/png') {
        throw new AppError('bad_request', {
          publicMessage: 'Een logo moet een PNG-bestand zijn.',
          internalDetail: `brand logo asset ${parsed.logoAssetId} has stored type ${asset.mimeType}`,
        });
      }
    }

    return db.transaction(async (tx) => {
      const next = await nextVersion(tx, labelId);
      const inserted = await tx
        .insert(brandProfileVersions)
        .values({
          organizationId: user.organizationId,
          labelId,
          version: next,
          brandName: parsed.brandName,
          colors: parsed.colors,
          typography: parsed.typography,
          tone: parsed.tone,
          rules: parsed.rules,
          exampleContent: parsed.exampleContent,
          logoText: parsed.logoText,
          logoAssetId: parsed.logoAssetId,
          imageUsageNote: parsed.imageUsageNote,
          reviewState: 'draft',
          origin: 'user',
          createdByUserId: user.userId,
        })
        .returning();

      const row = inserted[0];
      if (row === undefined) {
        throw new AppError('internal_error', { internalDetail: 'brand insert yielded no row' });
      }
      return toBrandProfile(row);
    });
  }

  /**
   * Approves one version and archives the previously approved one.
   *
   * Both happen in one transaction: at no point is there either no approved
   * profile or two of them.
   */
  async approve(
    db: Db,
    user: CurrentUser,
    labelId: string,
    versionId: string,
    noteNl: string | null,
  ): Promise<BrandProfileVersion> {
    requireLabelPermission(user, labelId, 'brand:approve');
    if ((await this.portal?.status(db, labelId))?.slug) throw new AppError('conflict', { publicMessage: 'De gepubliceerde Brand Portal-release is leidend voor dit label.' });

    return db.transaction(async (tx) => {
      const target = await this.findVersion(tx, labelId, versionId);
      if (target === undefined) {
        throw AppError.notFoundOrForbidden('brand_profile', versionId);
      }
      if (target.reviewState === 'approved') {
        return target;
      }

      await tx
        .update(brandProfileVersions)
        .set({ reviewState: 'archived' })
        .where(
          and(
            eq(brandProfileVersions.labelId, labelId),
            eq(brandProfileVersions.reviewState, 'approved'),
          ),
        );

      await tx
        .update(brandProfileVersions)
        .set({ reviewState: 'approved' })
        .where(eq(brandProfileVersions.id, versionId));

      await this.approvals.approve(tx, user, {
        labelId,
        artefactType: 'brand_profile',
        artefactId: versionId,
        artefactVersion: target.version,
        noteNl,
      });

      // Content approved under the merkversie just archived has to be looked
      // at again; flagged in the same commit.
      await this.flagStaleContent?.(tx, labelId);

      const updated = await this.findVersion(tx, labelId, versionId);
      if (updated === undefined) {
        throw new AppError('internal_error', { internalDetail: 'brand row vanished' });
      }
      return updated;
    });
  }

  /**
   * The approved profile, or a clear failure.
   *
   * Content and image generation both need brand rules as hard constraints, so
   * they call this rather than falling back to a default — generating against
   * an unapproved brand is exactly the silent-wrongness the gates exist to
   * prevent.
   */
  async requireCurrent(db: DbOrTx, labelId: string): Promise<BrandProfileVersion> {
    await this.portal?.refresh(db, labelId, true);
    const status = await this.portal?.status(db, labelId);
    if (status?.slug && status.error) throw new AppError('provider_unavailable', { publicMessage: 'De actuele merkregels konden niet worden gecontroleerd. Controleer de Brand Portal voordat je content maakt of downloadt.' });
    return this.requireApproved(db, labelId);
  }

  async requireApproved(db: DbOrTx, labelId: string): Promise<BrandProfileVersion> {
    const profile = await this.approved(db, labelId);
    if (profile === undefined) {
      throw new AppError('gate_not_passed', {
        publicMessage:
          'Er is nog geen goedgekeurd merkprofiel voor dit label. Leg het merkprofiel vast en keur het goed voordat je content maakt.',
        context: { labelId, gate: 'brand_profile_approved' },
      });
    }
    return profile;
  }
}

async function nextVersion(db: DbOrTx, labelId: string): Promise<number> {
  const rows = await db
    .select({ max: sql<number | null>`max(${brandProfileVersions.version})` })
    .from(brandProfileVersions)
    .where(eq(brandProfileVersions.labelId, labelId));
  return (rows[0]?.max ?? 0) + 1;
}

interface BrandRow {
  portal?: unknown;
  id: string;
  labelId: string;
  version: number;
  brandName: string;
  colors: unknown;
  typography: unknown;
  tone: unknown;
  rules: unknown;
  exampleContent: string;
  logoText: string | null;
  logoAssetId: string | null;
  imageUsageNote: string | null;
  reviewState: string;
  origin: string;
  createdAt: Date;
  createdByUserId: string | null;
}

/**
 * Maps a row to the contract type.
 *
 * The JSONB fields are re-validated rather than cast: they were written by a
 * previous version of this code, and a shape change must surface here instead
 * of reaching a render or a prompt as malformed data.
 */
function toBrandProfile(row: BrandRow): BrandProfileVersion {
  return {
    portal: portalProvenance.nullish().parse(row.portal) ?? null,
    id: row.id,
    labelId: row.labelId,
    version: row.version,
    brandName: row.brandName,
    colors: brandColors.parse(row.colors),
    typography: brandTypography.parse(row.typography),
    tone: toneOfVoice.parse(row.tone),
    rules: rulesSchema.parse(row.rules),
    exampleContent: row.exampleContent,
    logoText: row.logoText,
    logoAssetId: row.logoAssetId,
    imageUsageNote: row.imageUsageNote,
    reviewState: row.reviewState as ReviewState,
    origin: row.origin as BrandProfileVersion['origin'],
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
  };
}
