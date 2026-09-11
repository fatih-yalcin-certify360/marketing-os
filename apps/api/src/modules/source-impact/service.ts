import { and, eq, gt, inArray } from 'drizzle-orm';
import {
  assessExposure,
  type CampaignImpact,
  type ChangedSource,
  type CurrentUser,
  type RunFreshness,
  type SourceImpactReport,
} from '@c360/contracts';
import type { Db, DbOrTx } from '../../core/db/types.js';
import {
  campaigns,
  contentAssetVersions,
  exports as exportsTable,
  publicationRecords,
  researchFindings,
  researchRuns,
  sources,
} from '../../core/db/schema.js';
import { requireLabelPermission } from '../../core/authz/policy.js';

/**
 * Which campaigns rest on a source that has since changed (P4-3).
 *
 * Per-campaign staleness already existed and gates a publish-ready export. This
 * answers the question a person actually asks — *a source changed, what does
 * that touch?* — across every campaign of a label at once.
 *
 * ## What it does not do
 *
 * It does not say the content is wrong. A changed page may have had a typo
 * fixed. It reports which campaigns rest on the change, which findings came
 * from it, and how far each campaign got; the decision is a person's. Nothing
 * here regenerates, retracts or re-approves anything, and there is deliberately
 * no "fix it" action: the fix depends on what changed, and a button would
 * invite not reading.
 *
 * ## Read-only, and bounded
 *
 * Every query is a read, and the campaign list is capped. A report over a
 * label with hundreds of campaigns should be paginated before it is trusted at
 * that size, and the cap is what makes that a visible decision rather than a
 * slow page.
 */
export class SourceImpactService {
  constructor(
    private readonly research: {
      freshness(db: DbOrTx, labelId: string, courseVersionId: string): Promise<RunFreshness>;
    },
  ) {}

  async report(
    db: Db,
    user: CurrentUser,
    labelId: string,
    now = new Date(),
  ): Promise<SourceImpactReport> {
    requireLabelPermission(user, labelId, 'research:read');

    const campaignRows = await db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        courseVersionId: campaigns.courseVersionId,
      })
      .from(campaigns)
      .where(eq(campaigns.labelId, labelId))
      .limit(100);

    if (campaignRows.length === 0) {
      return { checkedAt: now.toISOString(), changedSources: [], campaigns: [] };
    }

    /*
     * Freshness is per course version, so it is computed once per *distinct*
     * course version rather than once per campaign. Several campaigns for the
     * same course are the normal case, and each freshness check reads the
     * label's sources.
     */
    const courseVersionIds = [
      ...new Set(campaignRows.map((row) => row.courseVersionId).filter((id) => id !== null)),
    ];
    const freshnessByCourse = new Map<string, RunFreshness>();
    for (const courseVersionId of courseVersionIds) {
      freshnessByCourse.set(
        courseVersionId,
        await this.research.freshness(db, labelId, courseVersionId),
      );
    }

    /*
     * The changed sources, label-wide.
     *
     * Taken from the live source rows rather than from a freshness reason,
     * because a reason is a sentence and this list is what a reader scans
     * first. A source counts as changed when its content hash differs from
     * what *some* run recorded, which is why the snapshots are read here.
     */
    const changedSources = await this.changedSources(db, labelId);
    const changedIds = new Set(changedSources.map((source) => source.sourceId));

    const impacts: CampaignImpact[] = [];

    for (const row of campaignRows) {
      const freshness =
        row.courseVersionId === null ? undefined : freshnessByCourse.get(row.courseVersionId);
      const reasonsNl = (freshness?.reasons ?? []).map((reason) => reason.detailNl);

      // A campaign with nothing stale behind it is left out entirely: a report
      // listing every campaign as "fine" is a report nobody reads.
      if (reasonsNl.length === 0) {
        continue;
      }

      const [approvedContent, publishReady, publications] = await Promise.all([
        this.hasApprovedContent(db, labelId, row.id),
        this.hasPublishReadyExport(db, labelId, row.id),
        this.hasPublications(db, labelId, row.id),
      ]);

      const assessment = assessExposure({
        hasPublications: publications,
        hasPublishReadyExport: publishReady,
        hasApprovedContent: approvedContent,
      });

      impacts.push({
        campaignId: row.id,
        campaignName: row.name,
        courseVersionId: row.courseVersionId,
        exposure: assessment.exposure,
        severity: assessment.severity,
        // The exposure sentence first: it is what decides whether this needs
        // attention today or at the next review.
        reasonsNl: [assessment.reasonNl, ...reasonsNl],
        affectedFindings:
          row.courseVersionId === null || changedIds.size === 0
            ? []
            : await this.findingsFromChangedSources(db, labelId, row.courseVersionId, [
                ...changedIds,
              ]),
      });
    }

    // Worst first: a published campaign is the one somebody has to act on.
    const order = { high: 0, medium: 1, low: 2 };
    impacts.sort((a, b) => order[a.severity] - order[b.severity]);

    return { checkedAt: now.toISOString(), changedSources, campaigns: impacts };
  }

  /** Sources whose live content hash differs from what a run recorded. */
  private async changedSources(db: Db, labelId: string): Promise<ChangedSource[]> {
    const live = await db
      .select({
        id: sources.id,
        title: sources.title,
        contentSha256: sources.contentSha256,
        lastFailureNl: sources.lastFailureNl,
      })
      .from(sources)
      .where(and(eq(sources.labelId, labelId), eq(sources.isActive, true)))
      .limit(200);

    const runs = await db
      .select({ sourcesSnapshot: researchRuns.sourcesSnapshot })
      .from(researchRuns)
      .where(eq(researchRuns.labelId, labelId))
      .limit(200);

    /** The hashes any run has ever recorded for a source. */
    const seen = new Map<string, Set<string>>();
    for (const run of runs) {
      for (const entry of (run.sourcesSnapshot ?? []) as {
        sourceId: string;
        contentSha256: string | null;
      }[]) {
        if (entry.contentSha256 === null) {
          continue;
        }
        const hashes = seen.get(entry.sourceId) ?? new Set<string>();
        hashes.add(entry.contentSha256);
        seen.set(entry.sourceId, hashes);
      }
    }

    const changed: ChangedSource[] = [];
    for (const source of live) {
      const hashes = seen.get(source.id);
      if (source.contentSha256 === null || hashes === undefined || hashes.size === 0) {
        continue;
      }
      if (!hashes.has(source.contentSha256)) {
        changed.push({
          sourceId: source.id,
          title: source.title,
          reason: 'source_content_changed',
          detailNl: `De inhoud van "${source.title}" is gewijzigd sinds het onderzoek dat erop rust.`,
        });
      }
    }
    return changed;
  }

  /** Findings of this course's runs that came from one of the changed sources. */
  private async findingsFromChangedSources(
    db: Db,
    labelId: string,
    courseVersionId: string,
    changedIds: string[],
  ): Promise<{ claim: string; sourceRef: string }[]> {
    return db
      .select({ claim: researchFindings.claim, sourceRef: researchFindings.sourceRef })
      .from(researchFindings)
      .innerJoin(researchRuns, eq(researchRuns.id, researchFindings.runId))
      .where(
        and(
          eq(researchFindings.labelId, labelId),
          eq(researchRuns.courseVersionId, courseVersionId),
          // The exact link: a finding records which source it came from.
          inArray(researchFindings.sourceId, changedIds),
        ),
      )
      .limit(20);
  }

  private async hasApprovedContent(db: Db, labelId: string, campaignId: string): Promise<boolean> {
    const rows = await db
      .select({ id: contentAssetVersions.id })
      .from(contentAssetVersions)
      .where(
        and(
          eq(contentAssetVersions.labelId, labelId),
          eq(contentAssetVersions.campaignId, campaignId),
          eq(contentAssetVersions.reviewState, 'approved'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  private async hasPublishReadyExport(
    db: Db,
    labelId: string,
    campaignId: string,
  ): Promise<boolean> {
    /*
     * A *refused* publish-ready export is recorded too.
     *
     * The export module writes a row for every attempt, including the ones the
     * gates turned down, so that the attempt and its reasons are part of the
     * trail. Counting those as exposure would report a campaign as "the package
     * may have been handed on" when the package was never produced — an
     * over-claim in the direction that wastes people's attention. A produced
     * package has bytes.
     */
    const rows = await db
      .select({ id: exportsTable.id })
      .from(exportsTable)
      .where(
        and(
          eq(exportsTable.labelId, labelId),
          eq(exportsTable.campaignId, campaignId),
          eq(exportsTable.kind, 'publish_ready'),
          gt(exportsTable.sizeBytes, 0),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  private async hasPublications(db: Db, labelId: string, campaignId: string): Promise<boolean> {
    const rows = await db
      .select({ id: publicationRecords.id })
      .from(publicationRecords)
      .where(
        and(
          eq(publicationRecords.labelId, labelId),
          eq(publicationRecords.campaignId, campaignId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
