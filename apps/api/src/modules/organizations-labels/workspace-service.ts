import { and, count, eq } from 'drizzle-orm';
import type { AttentionItem, CurrentUser, LabelReadiness, WorkspaceOverview } from '@c360/contracts';
import { confirmedFacts, unconfirmedFacts } from '@c360/contracts';
import type { Db } from '../../core/db/types.js';
import { campaigns, contentAssetVersions, personaVersions } from '../../core/db/schema.js';
import type { JobService } from '../jobs-usage/service.js';
import type { BrandService } from '../brand/service.js';
import type { CourseService } from '../courses/service.js';
import type { ContentAssetService } from '../content-assets/service.js';
import type { CampaignService } from '../campaigns-briefs/service.js';
import { MODULE_AVAILABILITY } from './availability.js';
import type { LabelService } from './service.js';

/**
 * Werkruimte read model.
 *
 * The one place that composes across modules, and it does so through their
 * *services*, never their tables — the boundary rule from requirement 3. The
 * exception is the two aggregate counts below, which are counted directly
 * because loading every row to count it would be wasteful; they are read-only
 * counts, not writes into another module's data.
 *
 * Every figure is derived from rows that actually exist. Nothing is estimated,
 * and where a module has not landed the counter is a real zero with the area
 * reported as unavailable.
 */
export class WorkspaceService {
  constructor(
    private readonly labels: LabelService,
    private readonly jobs: JobService,
    private readonly brand: BrandService,
    private readonly courses: CourseService,
    private readonly content: ContentAssetService,
    private readonly campaigns: CampaignService,
  ) {}

  async overview(db: Db, user: CurrentUser, labelId: string): Promise<WorkspaceOverview> {
    const label = await this.labels.requireAccessible(db, user, labelId);
    const readiness = await this.readiness(db, user, labelId);
    const recentJobs = await this.jobs.listForLabel(db, user, labelId, 25);

    const failedJobs = recentJobs.filter(
      (job) => job.status === 'failed' || job.status === 'dead',
    );

    const attention: AttentionItem[] = [];

    // Content waiting for a decision is the most actionable thing on the page,
    // so it leads.
    const campaignList = await this.campaigns.list(db, user, labelId, 20);
    for (const campaign of campaignList) {
      const assets = await this.content.list(db, user, labelId, campaign.id);
      const stale = assets.filter((asset) => asset.reviewState === 'needs_rereview');
      const drafts = assets.filter((asset) => asset.reviewState === 'draft');

      if (stale.length > 0) {
        attention.push({
          kind: 'needs_rereview',
          title: `${campaign.name} · opnieuw beoordelen`,
          subtitle: `${String(stale.length)} item(s) na een wijziging in een onderliggende bron`,
          badge: 'Review nodig',
          badgeTone: 'amber',
          campaignId: campaign.id,
          stage: campaign.stage,
          state: 'needs_rereview',
          updatedAt: campaign.updatedAt,
        });
      }
      if (drafts.length > 0) {
        attention.push({
          kind: 'ready_for_review',
          title: `${campaign.name} · klaar voor review`,
          subtitle: `${String(drafts.length)} contentitem(s) wacht op beoordeling`,
          badge: 'Review nodig',
          badgeTone: 'purple',
          campaignId: campaign.id,
          stage: campaign.stage,
          state: 'draft',
          updatedAt: campaign.updatedAt,
        });
      }
    }

    if (readiness.unconfirmedCourseCount > 0) {
      attention.push({
        kind: 'needs_source_check',
        title: 'Opleidingsinformatie controleren',
        subtitle: `${String(readiness.unconfirmedCourseCount)} opleiding(en) met niet-gecontroleerde velden`,
        badge: 'Bron aanvullen',
        badgeTone: 'amber',
        campaignId: null,
        stage: null,
        state: null,
        updatedAt: new Date().toISOString(),
      });
    }

    for (const job of failedJobs.slice(0, 3)) {
      attention.push({
        kind: 'job_failed',
        title: 'Achtergrondtaak afgebroken',
        subtitle: job.failureMessage ?? 'De taak is gestopt. Je kunt het opnieuw proberen.',
        badge: 'Opnieuw proberen',
        badgeTone: 'amber',
        campaignId: null,
        stage: null,
        state: null,
        updatedAt: job.finishedAt ?? job.createdAt,
      });
    }

    return {
      labelId: label.id,
      labelName: label.name,
      greetingName: firstName(user.displayName),
      counters: {
        readyForReview: readiness.assetsAwaitingReviewCount,
        actionRequired:
          failedJobs.length +
          readiness.unconfirmedCourseCount +
          readiness.assetsNeedingRereviewCount +
          (readiness.hasApprovedBrandProfile ? 0 : 1),
        // Planning arrives in Phase 3; a real zero rather than a guess.
        plannedThisWeek: 0,
      },
      attention: attention.slice(0, 6),
      readiness,
      moduleAvailability: [...MODULE_AVAILABILITY],
      containsDemoData: label.origin === 'demo',
      generatedAt: new Date().toISOString(),
    };
  }

  /** Foundational-data readiness, counted from real rows. */
  async readiness(db: Db, user: CurrentUser, labelId: string): Promise<LabelReadiness> {
    await this.labels.requireAccessible(db, user, labelId);

    const brandProfile = await this.brand.approved(db, labelId);
    const courseList = await this.courses.listLatestPerCourse(db, user, labelId, 100);

    const confirmedCourseCount = courseList.filter(
      (course) => unconfirmedFacts(course).length === 0 && confirmedFacts(course).length > 0,
    ).length;
    const unconfirmedCourseCount = courseList.filter(
      (course) => unconfirmedFacts(course).length > 0,
    ).length;

    const approvedPersonaCount = await this.countApprovedPersonas(db, labelId);

    const activeCampaigns = await db
      .select({ total: count() })
      .from(campaigns)
      .where(eq(campaigns.labelId, labelId));

    const awaiting = await db
      .select({ total: count() })
      .from(contentAssetVersions)
      .where(
        and(
          eq(contentAssetVersions.labelId, labelId),
          eq(contentAssetVersions.reviewState, 'draft'),
        ),
      );

    const rereview = await db
      .select({ total: count() })
      .from(contentAssetVersions)
      .where(
        and(
          eq(contentAssetVersions.labelId, labelId),
          eq(contentAssetVersions.reviewState, 'needs_rereview'),
        ),
      );

    return {
      labelId,
      hasApprovedBrandProfile: brandProfile !== undefined,
      confirmedCourseCount,
      unconfirmedCourseCount,
      approvedPersonaCount,
      activeCampaignCount: activeCampaigns[0]?.total ?? 0,
      assetsAwaitingReviewCount: awaiting[0]?.total ?? 0,
      assetsNeedingRereviewCount: rereview[0]?.total ?? 0,
    };
  }

  private async countApprovedPersonas(db: Db, labelId: string): Promise<number> {
    const rows = await db
      .select({ total: count() })
      .from(personaVersions)
      .where(
        and(eq(personaVersions.labelId, labelId), eq(personaVersions.reviewState, 'approved')),
      );
    return rows[0]?.total ?? 0;
  }
}

function firstName(displayName: string): string {
  const trimmed = displayName.trim();
  const space = trimmed.indexOf(' ');
  return space === -1 ? trimmed : trimmed.slice(0, space);
}
