import { and, desc, eq } from 'drizzle-orm';
import type {
  CurrentUser,
  OutcomeInput,
  OutcomeReport,
  PublicationInput,
  PublicationRecord,
} from '@c360/contracts';
import type { Db } from '../../core/db/types.js';
import { assets, contentAssetVersions, outcomeReports, publicationRecords } from '../../core/db/schema.js';
import { AppError } from '../../core/errors/app-error.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import type { CampaignService } from '../campaigns-briefs/service.js';

/**
 * Publications and measured results (P4-1).
 *
 * Two things a person records after the product has done its part:
 *
 *  - **that they published something**, pointing at the exact content version
 *    that went out. This system posts nothing and sends nothing, so
 *    "approved" is not "published" and only a human can close that gap.
 *  - **what the platform then reported**, with the period it covers and how the
 *    figure was obtained.
 *
 * The module holds no measurement logic of its own and computes no ratio. It
 * records what it was told, refuses what cannot be true, and keeps every row
 * inside its label.
 */
export class OutcomeService {
  constructor(private readonly campaigns: CampaignService) {}

  /**
   * Records that a content version was published.
   *
   * The channel is taken from the content row rather than from the caller: it
   * is a property of what was published, and accepting it as input would let a
   * LinkedIn post be recorded as an e-mail.
   */
  async recordPublication(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
    input: PublicationInput,
  ): Promise<PublicationRecord> {
    requireLabelPermission(user, labelId, 'outcome:write');
    await this.campaigns.requireById(db, labelId, campaignId);

    /*
     * The content version must belong to this campaign *and* this label.
     *
     * Both predicates matter. Without the label the id becomes a way to attach
     * one label's content to another's campaign; without the campaign, a
     * publication could point at content from a different campaign of the same
     * label and quietly misattribute every later figure.
     */
    const rows = await db
      .select({ channel: contentAssetVersions.channel })
      .from(contentAssetVersions)
      .where(
        and(
          eq(contentAssetVersions.id, input.contentAssetVersionId),
          eq(contentAssetVersions.labelId, labelId),
          eq(contentAssetVersions.campaignId, campaignId),
        ),
      )
      .limit(1);
    const content = rows[0];
    if (content === undefined) {
      throw AppError.notFoundOrForbidden('content', input.contentAssetVersionId);
    }

    const inserted = await db
      .insert(publicationRecords)
      .values({
        organizationId: user.organizationId,
        labelId,
        campaignId,
        contentAssetVersionId: input.contentAssetVersionId,
        channel: content.channel,
        publishedAt: new Date(input.publishedAt),
        externalUrl: input.externalUrl,
        noteNl: input.noteNl,
        recordedByUserId: user.userId,
      })
      .returning();

    const row = inserted[0];
    if (row === undefined) {
      throw new AppError('internal_error', { internalDetail: 'publication insert yielded no row' });
    }
    return toPublication(row);
  }

  async listPublications(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
  ): Promise<PublicationRecord[]> {
    requireLabelPermission(user, labelId, 'outcome:read');
    await this.campaigns.requireById(db, labelId, campaignId);

    const rows = await db
      .select()
      .from(publicationRecords)
      .where(
        and(eq(publicationRecords.labelId, labelId), eq(publicationRecords.campaignId, campaignId)),
      )
      .orderBy(desc(publicationRecords.publishedAt));
    return rows.map(toPublication);
  }

  /**
   * Records measured results.
   *
   * The shape has already refused a period the wrong way round, a
   * platform-report row with no report, and a row with no figure at all — the
   * contract and the database both say so. What is left for this method is what
   * only it can know: that the referenced rows belong here.
   */
  async recordOutcome(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
    input: OutcomeInput,
  ): Promise<OutcomeReport> {
    requireLabelPermission(user, labelId, 'outcome:write');
    await this.campaigns.requireById(db, labelId, campaignId);

    if (input.publicationRecordId !== null) {
      const found = await db
        .select({ id: publicationRecords.id })
        .from(publicationRecords)
        .where(
          and(
            eq(publicationRecords.id, input.publicationRecordId),
            eq(publicationRecords.labelId, labelId),
            eq(publicationRecords.campaignId, campaignId),
          ),
        )
        .limit(1);
      if (found[0] === undefined) {
        throw AppError.notFoundOrForbidden('publication', input.publicationRecordId);
      }
    }

    if (input.reportAssetId !== null) {
      /*
       * The attached report must be a document this label uploaded.
       *
       * `kind = 'upload'` because every upload is stored that way whatever
       * purpose it was sent for, and the purpose is not recorded on the row —
       * so the check that separates a report from a logo is the stored mime
       * type, decided by the file's own bytes. An image is not a report.
       */
      const found = await db
        .select({ mimeType: assets.mimeType })
        .from(assets)
        .where(
          and(
            eq(assets.id, input.reportAssetId),
            eq(assets.labelId, labelId),
            eq(assets.kind, 'upload'),
          ),
        )
        .limit(1);
      const asset = found[0];
      if (asset === undefined) {
        throw AppError.notFoundOrForbidden('asset', input.reportAssetId);
      }
      if (asset.mimeType.startsWith('image/')) {
        throw new AppError('bad_request', {
          publicMessage:
            'Een rapport moet een PDF, Word- of tekstbestand zijn, geen afbeelding.',
          internalDetail: `outcome report asset ${input.reportAssetId} has type ${asset.mimeType}`,
        });
      }
    }

    const inserted = await db
      .insert(outcomeReports)
      .values({
        organizationId: user.organizationId,
        labelId,
        campaignId,
        publicationRecordId: input.publicationRecordId,
        channel: input.channel,
        funnelStage: input.funnelStage,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        impressions: input.impressions,
        clicks: input.clicks,
        signups: input.signups,
        spendCents: input.spendCents,
        source: input.source,
        reportAssetId: input.reportAssetId,
        noteNl: input.noteNl,
        recordedByUserId: user.userId,
      })
      .returning();

    const row = inserted[0];
    if (row === undefined) {
      throw new AppError('internal_error', { internalDetail: 'outcome insert yielded no row' });
    }
    return toOutcome(row);
  }

  async listOutcomes(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
  ): Promise<OutcomeReport[]> {
    requireLabelPermission(user, labelId, 'outcome:read');
    await this.campaigns.requireById(db, labelId, campaignId);

    const rows = await db
      .select()
      .from(outcomeReports)
      .where(and(eq(outcomeReports.labelId, labelId), eq(outcomeReports.campaignId, campaignId)))
      .orderBy(desc(outcomeReports.periodStart));
    return rows.map(toOutcome);
  }
}

interface PublicationRow {
  id: string;
  campaignId: string;
  contentAssetVersionId: string;
  channel: string;
  publishedAt: Date;
  externalUrl: string | null;
  noteNl: string | null;
  recordedByUserId: string | null;
  createdAt: Date;
}

function toPublication(row: PublicationRow): PublicationRecord {
  return {
    id: row.id,
    campaignId: row.campaignId,
    contentAssetVersionId: row.contentAssetVersionId,
    channel: row.channel as PublicationRecord['channel'],
    publishedAt: row.publishedAt.toISOString(),
    externalUrl: row.externalUrl,
    noteNl: row.noteNl,
    recordedByUserId: row.recordedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

interface OutcomeRow {
  id: string;
  campaignId: string;
  publicationRecordId: string | null;
  channel: string;
  funnelStage?: string | null;
  periodStart: string;
  periodEnd: string;
  impressions: number | null;
  clicks: number | null;
  signups: number | null;
  spendCents: number | null;
  source: string;
  reportAssetId: string | null;
  noteNl: string | null;
  recordedByUserId: string | null;
  createdAt: Date;
}

function toOutcome(row: OutcomeRow): OutcomeReport {
  return {
    id: row.id,
    campaignId: row.campaignId,
    publicationRecordId: row.publicationRecordId,
    channel: row.channel as OutcomeReport['channel'],
    funnelStage: (row.funnelStage ?? null) as OutcomeReport['funnelStage'],
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    impressions: row.impressions,
    clicks: row.clicks,
    signups: row.signups,
    spendCents: row.spendCents,
    source: row.source as OutcomeReport['source'],
    reportAssetId: row.reportAssetId,
    noteNl: row.noteNl,
    recordedByUserId: row.recordedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}
