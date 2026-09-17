import { and, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import {
  briefProposal,
  confirmedFacts,
  createCampaignInput,
  stagesForObjective,
  unconfirmedFacts,
  COURSE_FACT_LABEL_NL,
  FUNNEL_STAGE_LABEL_NL,
  type BriefEditInput,
  type BriefVersion,
  type Campaign,
  type CampaignObjective,
  type CourseFactField,
  type CourseVersion,
  type CreateCampaignInputData,
  type CurrentUser,
  type FunnelStage,
  type Grounding,
  type MarketingChannel,
  type ReviewState,
  type StageMessage,
  type UsableClaim,
  type WorkflowStage,
} from '@c360/contracts';
import type { Db, DbOrTx } from '../../core/db/types.js';
import type { AuditEntry } from '../audit/service.js';
import {
  briefVersions,
  campaigns,
  conceptVersions,
  contentAssetVersions,
  contentPlans,
  courseVersions,
  exports as exportsTable,
  outcomeReports,
  radarRuns,
} from '../../core/db/schema.js';
import { z } from 'zod';
import {
  CHANNEL_LABEL_NL,
  computeCampaignProgress,
  statableFacts,
  type BriefKeyword,
  type BriefProposal,
  type CampaignListItem,
  type ChannelRole,
  type Page,
} from '@c360/contracts';
import { AppError } from '../../core/errors/app-error.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import type { GenerationService } from '../../core/ai/generation.js';
import type { BrandService } from '../brand/service.js';
import type { CourseService } from '../courses/service.js';
import type { PersonaService } from '../personas/service.js';
import type { OpportunityService } from '../opportunities/service.js';
import type { ApprovalService } from '../reviews-approvals/service.js';

/**
 * Campaigns and briefs.
 *
 * The brief is the contract for everything downstream, so two things are
 * computed here rather than left to the model:
 *
 *  - **`offLimits`** always includes the brand's `must_not` rules *and* a ban
 *    on every course field nobody has confirmed. It is appended after
 *    generation, so a model cannot omit it.
 *  - **Brief approval is the gate for concepts.** `requireApprovedBrief` is the
 *    only way downstream stages obtain a brief, so the gate cannot be bypassed
 *    by calling a different method.
 */

export class CampaignService {
  constructor(
    private readonly generation: GenerationService,
    private readonly brand: BrandService,
    private readonly courses: CourseService,
    private readonly personas: PersonaService,
    private readonly opportunities: OpportunityService,
    private readonly approvals: ApprovalService,
    /**
     * Optional so every existing call site keeps working; present in the
     * server, where re-pointing a campaign at another course version has to
     * leave a trace of who did it and from which version to which.
     */
    private readonly audit?: { record(db: DbOrTx, entry: AuditEntry): Promise<void> },
  ) {}

  /**
   * Moves a campaign to the currently approved version of its own course.
   *
   * A campaign is pinned to the course version it was created with. Approving
   * a corrected card archives the old one, and from that moment the campaign
   * fails the export gate with "De opleidingskaart is nog niet goedgekeurd" —
   * about a card the user just approved. That was the single worst defect the
   * audit of 2026-09-15 found: one correction froze every running campaign,
   * with no way out but to re-approve the stale card.
   *
   * Moving is deliberately not automatic. The briefing quotes facts from the
   * card, so a changed price or date means the briefing and the content have
   * to be looked at again. This puts the campaign on the current card and
   * flags exactly those artefacts for re-review, in one transaction, and says
   * what it touched.
   */
  async repointToCurrentCourse(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
  ): Promise<{
    campaign: Campaign;
    moved: boolean;
    fromVersion: number;
    toVersion: number;
    briefsFlagged: number;
    assetsFlagged: number;
  }> {
    requireLabelPermission(user, labelId, 'campaign:write');
    const campaign = await this.requireById(db, labelId, campaignId);
    const pinned = await this.courses.requireVersion(db, labelId, campaign.courseVersionId);
    const current = await this.courses.approvedForSameCourse(db, labelId, campaign.courseVersionId);

    if (current === undefined) {
      throw new AppError('gate_not_passed', {
        publicMessage:
          'Er is geen goedgekeurde opleidingskaart voor deze opleiding. Keur eerst een kaart goed.',
      });
    }
    if (current.id === campaign.courseVersionId) {
      return {
        campaign,
        moved: false,
        fromVersion: pinned.version,
        toVersion: current.version,
        briefsFlagged: 0,
        assetsFlagged: 0,
      };
    }

    return db.transaction(async (tx) => {
      await tx
        .update(campaigns)
        .set({ courseVersionId: current.id })
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.labelId, labelId)));

      const briefs = await tx
        .update(briefVersions)
        .set({ reviewState: 'needs_rereview' })
        .where(
          and(
            eq(briefVersions.labelId, labelId),
            eq(briefVersions.campaignId, campaignId),
            sql`${briefVersions.reviewState} IN ('draft', 'approved')`,
          ),
        )
        .returning({ id: briefVersions.id });

      const assets = await tx
        .update(contentAssetVersions)
        .set({ reviewState: 'needs_rereview' })
        .where(
          and(
            eq(contentAssetVersions.labelId, labelId),
            eq(contentAssetVersions.campaignId, campaignId),
            sql`${contentAssetVersions.reviewState} IN ('draft', 'approved')`,
          ),
        )
        .returning({ id: contentAssetVersions.id });

      await this.audit?.record(tx, {
        organizationId: user.organizationId,
        labelId,
        actorKind: 'user',
        actorUserId: user.userId,
        action: 'campaign.course_version_repointed',
        resourceType: 'campaign',
        resourceId: campaignId,
        outcome: 'allowed',
        metadata: {
          fromCourseVersion: pinned.version,
          toCourseVersion: current.version,
          briefsFlagged: briefs.length,
          assetsFlagged: assets.length,
        },
      });

      return {
        campaign: await this.requireById(tx, labelId, campaignId),
        moved: true,
        fromVersion: pinned.version,
        toVersion: current.version,
        briefsFlagged: briefs.length,
        assetsFlagged: assets.length,
      };
    });
  }

  async create(
    db: Db,
    user: CurrentUser,
    labelId: string,
    input: CreateCampaignInputData,
  ): Promise<Campaign> {
    requireLabelPermission(user, labelId, 'campaign:write');
    const parsed = createCampaignInput.parse(input);

    // A campaign cannot exist without an approved brand profile: brand rules
    // are hard constraints for everything it will produce.
    const brandProfile = await this.brand.requireApproved(db, labelId);
    const course = await this.courses.requireVersion(db, labelId, parsed.courseVersionId);

    const inserted = await db
      .insert(campaigns)
      .values({
        organizationId: user.organizationId,
        labelId,
        name: parsed.name,
        entryMode: parsed.entryMode,
        objective: parsed.objective,
        stage: 'persona_selection',
        contentLanguage: parsed.contentLanguage,
        courseVersionId: course.id,
        brandProfileVersionId: brandProfile.id,
        userIdea: parsed.userIdea ?? null,
        suppliedBrief: parsed.suppliedBrief ?? null,
        ownerUserId: user.userId,
        startDate: parsed.startDate,
        budgetCents: parsed.budgetCents,
      })
      .returning();

    const row = inserted[0];
    if (row === undefined) {
      throw new AppError('internal_error', { internalDetail: 'campaign insert yielded no row' });
    }
    return toCampaign(row);
  }

  /**
   * The campaigns of a label, newest first, each with where it stands.
   *
   * Progress comes from `computeCampaignProgress` — the same rule the detail
   * page applies — fed by six grouped queries over the page's campaign ids:
   * briefs, selected concepts, plans, the latest version of every content
   * asset, exports with bytes, outcome reports. Never a detail call per row:
   * the detail route runs nine queries for one campaign, and a list of fifty
   * would run four hundred and fifty. Keyset pagination on (createdAt, id);
   * `userIdea` and `suppliedBrief` are nulled on list rows, because a list
   * must not carry every briefing ever pasted.
   */
  async list(
    db: Db,
    user: CurrentUser,
    labelId: string,
    query: { limit: number; cursor?: string | undefined },
  ): Promise<Page<CampaignListItem>> {
    requireLabelPermission(user, labelId, 'campaign:read');
    const after = decodeListCursor(query.cursor);
    const rows = await db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.labelId, labelId),
          after === undefined
            ? undefined
            : or(
                lt(campaigns.createdAt, after.createdAt),
                and(eq(campaigns.createdAt, after.createdAt), lt(campaigns.id, after.id)),
              ),
        ),
      )
      .orderBy(desc(campaigns.createdAt), desc(campaigns.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > query.limit && last !== undefined
        ? encodeListCursor({ createdAt: last.createdAt, id: last.id })
        : null;
    if (page.length === 0) {
      return { items: [], nextCursor: null };
    }

    const ids = page.map((row) => row.id);
    const [briefRows, conceptRows, planRows, assetRows, exportRows, outcomeRows, courseRows] =
      await Promise.all([
        db
          .select({
            campaignId: briefVersions.campaignId,
            version: briefVersions.version,
            reviewState: briefVersions.reviewState,
            personaVersionIds: briefVersions.personaVersionIds,
            createdAt: briefVersions.createdAt,
          })
          .from(briefVersions)
          .where(inArray(briefVersions.campaignId, ids)),
        db
          .select({ campaignId: conceptVersions.campaignId })
          .from(conceptVersions)
          .where(and(inArray(conceptVersions.campaignId, ids), eq(conceptVersions.selected, true))),
        db
          .select({
            campaignId: contentPlans.campaignId,
            version: contentPlans.version,
            reviewState: contentPlans.reviewState,
            createdAt: contentPlans.createdAt,
          })
          .from(contentPlans)
          .where(inArray(contentPlans.campaignId, ids)),
        db
          .select({
            campaignId: contentAssetVersions.campaignId,
            assetKey: contentAssetVersions.assetKey,
            version: contentAssetVersions.version,
            reviewState: contentAssetVersions.reviewState,
            createdAt: contentAssetVersions.createdAt,
          })
          .from(contentAssetVersions)
          .where(inArray(contentAssetVersions.campaignId, ids)),
        db
          .select({ campaignId: exportsTable.campaignId, createdAt: exportsTable.createdAt })
          .from(exportsTable)
          .where(and(inArray(exportsTable.campaignId, ids), gt(exportsTable.sizeBytes, 0))),
        db
          .select({ campaignId: outcomeReports.campaignId, createdAt: outcomeReports.createdAt })
          .from(outcomeReports)
          .where(inArray(outcomeReports.campaignId, ids)),
        db
          .select({ id: courseVersions.id, name: courseVersions.name })
          .from(courseVersions)
          .where(inArray(courseVersions.id, [...new Set(page.map((row) => row.courseVersionId))])),
      ]);

    const latestBrief = new Map<string, (typeof briefRows)[number]>();
    const approvedBriefs = new Set<string>();
    for (const brief of briefRows) {
      const current = latestBrief.get(brief.campaignId);
      if (current === undefined || brief.version > current.version) latestBrief.set(brief.campaignId, brief);
      if (brief.reviewState === 'approved') approvedBriefs.add(brief.campaignId);
    }
    const selectedConcepts = new Set(conceptRows.map((row) => row.campaignId));
    const latestPlan = new Map<string, (typeof planRows)[number]>();
    for (const plan of planRows) {
      const current = latestPlan.get(plan.campaignId);
      if (current === undefined || plan.version > current.version) latestPlan.set(plan.campaignId, plan);
    }
    const latestAssets = new Map<string, Map<string, (typeof assetRows)[number]>>();
    for (const asset of assetRows) {
      // A standalone piece has no campaign and belongs in no campaign's
      // progress; the query filters on the campaign ids, so this is only a
      // type-level guard (migration 0029).
      if (asset.campaignId === null) continue;
      const perCampaign = latestAssets.get(asset.campaignId) ?? new Map<string, (typeof assetRows)[number]>();
      const current = perCampaign.get(asset.assetKey);
      if (current === undefined || asset.version > current.version) perCampaign.set(asset.assetKey, asset);
      latestAssets.set(asset.campaignId, perCampaign);
    }
    const exported = new Map<string, Date>();
    for (const record of exportRows) {
      const current = exported.get(record.campaignId);
      if (current === undefined || record.createdAt > current) exported.set(record.campaignId, record.createdAt);
    }
    const outcomes = new Map<string, Date>();
    for (const record of outcomeRows) {
      const current = outcomes.get(record.campaignId);
      if (current === undefined || record.createdAt > current) outcomes.set(record.campaignId, record.createdAt);
    }
    const courseNames = new Map(courseRows.map((row) => [row.id, row.name]));

    const items = page.map((row): CampaignListItem => {
      const brief = latestBrief.get(row.id);
      const plan = latestPlan.get(row.id);
      const assets = [...(latestAssets.get(row.id)?.values() ?? [])];
      const activity = [
        row.updatedAt,
        brief?.createdAt,
        plan?.createdAt,
        ...assets.map((asset) => asset.createdAt),
        exported.get(row.id),
        outcomes.get(row.id),
      ].filter((value): value is Date => value instanceof Date);
      const lastActivityAt = new Date(Math.max(...activity.map((value) => value.getTime())));
      const personaIds = brief?.personaVersionIds;
      const progress = computeCampaignProgress({
        entryMode: row.entryMode as CampaignListItem['entryMode'],
        hasOpportunity: row.opportunityId !== null,
        fromRadar: row.radarRunId !== null,
        personaCount: Array.isArray(personaIds) ? personaIds.length : 0,
        brief:
          brief === undefined
            ? null
            : { reviewState: brief.reviewState as ReviewState, approved: approvedBriefs.has(row.id) },
        hasSelectedConcept: selectedConcepts.has(row.id),
        plan: plan === undefined ? null : { reviewState: plan.reviewState as ReviewState },
        assets: {
          total: assets.length,
          approved: assets.filter((asset) => asset.reviewState === 'approved').length,
          needsRereview: assets.filter((asset) => asset.reviewState === 'needs_rereview').length,
        },
        hasExport: exported.has(row.id),
        hasOutcomes: outcomes.has(row.id),
        lastActivityAt: lastActivityAt.toISOString(),
      });
      return {
        ...toCampaign(row),
        userIdea: null,
        suppliedBrief: null,
        courseName: courseNames.get(row.courseVersionId) ?? 'Onbekende opleiding',
        progress,
      };
    });
    return { items, nextCursor };
  }

  async findById(db: DbOrTx, labelId: string, id: string): Promise<Campaign | undefined> {
    const rows = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.labelId, labelId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toCampaign(row);
  }

  async requireById(db: DbOrTx, labelId: string, id: string): Promise<Campaign> {
    const found = await this.findById(db, labelId, id);
    if (found === undefined) {
      throw AppError.notFoundOrForbidden('campaign', id);
    }
    return found;
  }

  /**
   * Sets or clears the campaign's start date.
   *
   * The date is the only input the calendar needs beyond the approved plan —
   * the schedule itself is derived arithmetically, so this is a single field
   * rather than a stored calendar that could drift from the plan it describes.
   *
   * Clearing it is allowed and returns the calendar to its relative form. That
   * is not a curiosity: a date chosen too early, before the plan was approved,
   * should be removable without deleting the campaign.
   */
  async setStartDate(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
    startDate: string | null,
  ): Promise<Campaign> {
    requireLabelPermission(user, labelId, 'campaign:write');
    // Existence is established through the label-scoped read, so a campaign
    // from another label reads as absent rather than as forbidden.
    await this.requireById(db, labelId, campaignId);

    await db
      .update(campaigns)
      .set({ startDate, updatedAt: new Date() })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.labelId, labelId)));

    return this.requireById(db, labelId, campaignId);
  }

  /**
   * Sets the objective of a campaign that was created without one.
   *
   * Campaigns from before objectives existed plan as a full funnel until this
   * is called; the interface says so next to the plan. Deliberately not
   * clearable — the plan and the content that follow are argued from the
   * objective, and un-choosing it would leave them resting on nothing.
   */
  async setObjective(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
    objective: CampaignObjective,
  ): Promise<Campaign> {
    requireLabelPermission(user, labelId, 'campaign:write');
    await this.requireById(db, labelId, campaignId);

    await db
      .update(campaigns)
      .set({ objective, updatedAt: new Date() })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.labelId, labelId)));

    return this.requireById(db, labelId, campaignId);
  }

  async setStage(db: DbOrTx, campaignId: string, stage: WorkflowStage): Promise<void> {
    await db.update(campaigns).set({ stage }).where(eq(campaigns.id, campaignId));
  }

  async attachOpportunity(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
    opportunityId: string,
  ): Promise<Campaign> {
    requireLabelPermission(user, labelId, 'campaign:write');
    await this.requireById(db, labelId, campaignId);
    await this.opportunities.requireById(db, labelId, opportunityId);

    await db
      .update(campaigns)
      .set({ opportunityId, stage: 'brief_approval' })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.labelId, labelId)));
    return this.requireById(db, labelId, campaignId);
  }

  // ------------------------------------------------------------- Briefs ----

  async latestBrief(db: DbOrTx, campaignId: string): Promise<BriefVersion | undefined> {
    const rows = await db
      .select()
      .from(briefVersions)
      .where(eq(briefVersions.campaignId, campaignId))
      .orderBy(desc(briefVersions.version))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toBrief(row);
  }

  async approvedBrief(db: DbOrTx, campaignId: string): Promise<BriefVersion | undefined> {
    const rows = await db
      .select()
      .from(briefVersions)
      .where(and(eq(briefVersions.campaignId, campaignId), eq(briefVersions.reviewState, 'approved')))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toBrief(row);
  }

  /**
   * The gate for the concept stage.
   *
   * Downstream stages have no other way to obtain a brief, so "no concepts
   * before an approved brief" is enforced structurally rather than by a check
   * someone could forget to write.
   */
  async requireApprovedBrief(db: DbOrTx, campaignId: string): Promise<BriefVersion> {
    const brief = await this.approvedBrief(db, campaignId);
    if (brief === undefined) {
      /*
       * Says *why* when the reason is a changed audience. A brief that was
       * approved and then flagged because one of its personas got a new
       * version is not "not yet approved"; it needs a second look, and the
       * message should send the person there rather than to a first approval.
       */
      const latest = await this.latestBrief(db, campaignId);
      throw new AppError('gate_not_passed', {
        publicMessage:
          latest?.reviewState === 'needs_rereview'
            ? 'Een doelgroep van deze briefing is gewijzigd. Beoordeel de briefing opnieuw en keur haar weer goed voordat je verdergaat.'
            : 'De briefing is nog niet goedgekeurd. Keur de briefing goed voordat je concepten laat maken.',
        context: { campaignId, gate: 'brief_version_approved' },
      });
    }
    return brief;
  }

  async listBriefVersions(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
  ): Promise<BriefVersion[]> {
    requireLabelPermission(user, labelId, 'brief:read');
    await this.requireById(db, labelId, campaignId);
    const rows = await db
      .select()
      .from(briefVersions)
      .where(eq(briefVersions.campaignId, campaignId))
      .orderBy(desc(briefVersions.version));
    return rows.map(toBrief);
  }

  /** Generates a brief draft from the campaign's chosen personas and opportunity. */
  /**
   * Pre-enqueue gate for `draftBrief`.
   *
   * Checks the campaign is visible, the brand profile is approved and the named
   * personas exist, so a bad request is answered immediately instead of
   * becoming a failed job the user has to interpret.
   */
  async assertCanDraftBrief(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
    personaVersionIds: readonly string[],
  ): Promise<void> {
    requireLabelPermission(user, labelId, 'brief:write');
    const campaign = await this.requireById(db, labelId, campaignId);
    await this.brand.requireApproved(db, labelId);
    await this.personas.requireForCampaign(db, labelId, campaignId, campaign.courseVersionId, personaVersionIds);
  }

  async draftBrief(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      campaignId: string;
      personaVersionIds: readonly string[];
      jobId?: string | null;
      attempt?: number;
      signal?: AbortSignal | undefined;
    },
  ): Promise<BriefVersion> {
    requireLabelPermission(user, input.labelId, 'brief:write');

    const campaign = await this.requireById(db, input.labelId, input.campaignId);
    const course = await this.courses.requireVersion(db, input.labelId, campaign.courseVersionId);
    const brandProfile = await this.brand.requireApproved(db, input.labelId);
    const personas = await this.personas.requireForCampaign(
      db, input.labelId, input.campaignId, campaign.courseVersionId, input.personaVersionIds,
    );
    const opportunity =
      campaign.opportunityId === null
        ? null
        : await this.opportunities.requireById(db, input.labelId, campaign.opportunityId);
    const stages = stagesForObjective(campaign.objective ?? 'full_funnel');
    const keywordPool = await this.keywordPool(db, campaign, course);

    /*
     * One generation, one repair.
     *
     * A brief has to be long enough to hand to a colleague: the word minimums
     * in `briefProblems` are the difference between a briefing and a form.
     * The provider schema cannot carry them (strict mode drops minimums), so
     * a first answer that falls short goes back once with the shortfall named
     * under `<herstelpunten>`; a second shortfall is a provider error with the
     * problems in the detail, and nothing is stored.
     */
    let repairNotes: string[] = [];
    let result: Awaited<ReturnType<typeof this.generation.generate<typeof briefProposal>>> | undefined;
    for (let round = 0; round < 2; round += 1) {
      const attempt = await this.generation.generate(db, {
        template: 'brief.draft',
        schema: briefProposal,
        organizationId: user.organizationId,
        labelId: input.labelId,
        jobId: input.jobId ?? null,
        attempt: input.attempt ?? 0,
        signal: input.signal,
        context: {
          language: campaign.contentLanguage,
          course,
          brand: brandProfile,
          personas,
          opportunity:
            opportunity === null ? null : { title: opportunity.title, coreIdea: opportunity.coreIdea },
          userIdea: campaign.userIdea,
          suppliedBrief: campaign.suppliedBrief,
          // The stages the brief must speak to follow from the objective; a
          // campaign without one is briefed as a full funnel and told so.
          objective: campaign.objective,
          funnelStages: stages,
          keywords: keywordPool,
          repairNotes,
        },
      });
      const problems = briefProblems(attempt.value);
      if (problems.length === 0) {
        result = attempt;
        break;
      }
      if (round === 0) {
        repairNotes = problems;
        continue;
      }
      throw new AppError('provider_invalid_output', {
        publicMessage:
          'De briefing haalt ook na een herstelronde niet de omvang en de onderdelen van een volwaardige campagnebriefing. Er is niets opgeslagen; probeer het opnieuw.',
        internalDetail: problems.join(' | '),
      });
    }
    if (result === undefined) {
      throw new AppError('internal_error', { internalDetail: 'brief draft loop ended without a result' });
    }

    /*
     * A role for every suggested channel, and for no other.
     *
     * The plan step hands out stages per channel from the suggestions; a role
     * for a channel the brief does not suggest would argue for a channel that
     * is not in the campaign. Dropped silently — it is the model's slip, not
     * information a person needs — while a suggested channel without a role is
     * a `briefProblems` failure above.
     */
    const suggested = new Set<string>(result.value.channelSuggestions);
    const channelRoles = result.value.channelRoles.filter((role) => suggested.has(role.channel));

    /*
     * Keywords come from the pool and nowhere else.
     *
     * The model chooses which of the supplied phrases the campaign writes
     * for; it cannot add one. A phrase outside the pool would be a search
     * term nobody found anywhere — invented demand — and is dropped with a
     * note, so the person sees what the model wanted and can add the phrase
     * by hand if it is real.
     */
    const pool = new Map(keywordPool.map((keyword) => [normalisePhrase(keyword.phrase), keyword]));
    const keywords: BriefKeyword[] = [];
    const rejectedKeywords: string[] = [];
    for (const proposed of result.value.keywords) {
      const known = pool.get(normalisePhrase(proposed.phrase));
      if (known === undefined) {
        rejectedKeywords.push(proposed.phrase);
        continue;
      }
      if (!keywords.some((keyword) => keyword.phrase === known.phrase)) keywords.push(known);
    }
    if (keywords.length === 0) {
      // A model that picks nothing leaves the content without search phrases;
      // the pool's first entries are a better default than none.
      keywords.push(...keywordPool.slice(0, 5));
    }
    const keywordNotes =
      rejectedKeywords.length === 0
        ? []
        : [
            `Niet overgenomen als zoekterm omdat ze in geen onderzoek of opleidingsfeit voorkomen: ${rejectedKeywords.map((phrase) => `“${phrase}”`).join(', ')}. Voeg ze toe als je weet dat ernaar wordt gezocht.`,
          ];

    /*
     * One message per stage, and only confirmed proof.
     *
     * The schema bounds a stage to the three that exist and a proof field to
     * the eight on the card, but it cannot know which stages *this* objective
     * covers or which facts *this* card has confirmed. A message for a stage
     * outside the objective, or a stage left without one, is a model that
     * ignored its instructions and fails here rather than being stored. An
     * unconfirmed proof field is removed and named in the review notes: the
     * brief is still usable, and the person sees what the model wanted to
     * cite and may confirm the fact.
     */
    const stageProblems = stageMessageProblems(result.value.stageMessages, stages);
    if (stageProblems.length > 0) {
      throw new AppError('provider_invalid_output', {
        publicMessage:
          'De briefing bevat geen kloppende boodschap per funnelfase. Er is niets opgeslagen; probeer opnieuw.',
        internalDetail: stageProblems.join(' '),
      });
    }
    const proof = confirmedProofOnly(result.value.stageMessages, course);

    // Appended after generation, so the model cannot leave them out.
    const mandatoryOffLimits = [
      ...brandProfile.rules.filter((rule) => rule.kind === 'must_not').map((rule) => rule.text),
      ...unconfirmedFacts(course).map(
        (field) =>
          `Niet noemen: ${COURSE_FACT_LABEL_NL[field]} — deze informatie is nog niet gecontroleerd.`,
      ),
    ];
    const offLimits = [...new Set([...result.value.offLimits, ...mandatoryOffLimits])];
    const reviewNotes = [...result.value.reviewNotes, ...proof.notesNl, ...keywordNotes];

    return db.transaction(async (tx) => {
      const maxRows = await tx
        .select({ max: sql<number | null>`max(${briefVersions.version})` })
        .from(briefVersions)
        .where(eq(briefVersions.campaignId, input.campaignId));
      const next = (maxRows[0]?.max ?? 0) + 1;

      const inserted = await tx
        .insert(briefVersions)
        .values({
          organizationId: user.organizationId,
          labelId: input.labelId,
          campaignId: input.campaignId,
          version: next,
          reviewNotes,
          contextNl: result.value.contextNl,
          goal: result.value.goal,
          audienceInsightNl: result.value.audienceInsightNl,
          propositionNl: result.value.propositionNl,
          personaVersionIds: [...input.personaVersionIds],
          coreMessage: result.value.coreMessage,
          stageMessages: proof.messages,
          keywords,
          toneOfVoiceNl: result.value.toneOfVoiceNl,
          mandatories: result.value.mandatories,
          channelRoles,
          timingNl: result.value.timingNl,
          risks: result.value.risks,
          evidence: result.value.evidence,
          usableClaims: result.value.usableClaims,
          offLimits,
          cta: result.value.cta,
          // Never a call to action without a destination: the course page is
          // the default, so a briefing that promises "bekijk de keuzehulp"
          // still points at the page where that keuzehulp is embedded.
          ctaUrl: result.value.ctaUrl ?? radarTargetUrl(campaign.suppliedBrief) ?? course.courseUrl,
          channelSuggestions: result.value.channelSuggestions,
          contentScope: result.value.contentScope,
          measurement: result.value.measurement,
          stopConditions: result.value.stopConditions,
          ownerUserId: user.userId,
          budgetCents: campaign.budgetCents,
          startDate: campaign.startDate,
          reviewState: 'draft',
          origin: 'ai_generated',
          promptVersion: result.promptVersion,
        })
        .returning();

      const row = inserted[0];
      if (row === undefined) {
        throw new AppError('internal_error', { internalDetail: 'brief insert yielded no row' });
      }
      await this.setStage(tx, input.campaignId, 'brief_approval');
      return toBrief(row);
    });
  }

  /**
   * The search phrases a briefing may choose from.
   *
   * From the radar's keyword research when the campaign was started from a
   * scan: the questions and queries the research found on public pages, each
   * with the page it was found on. Otherwise derived here from the course
   * name and the confirmed "for whom" and "content" facts, labelled
   * `afgeleid` so nobody mistakes a derivation for a finding. Never a volume,
   * a difficulty or a position: nothing was measured.
   */
  private async keywordPool(
    db: DbOrTx,
    campaign: Campaign,
    course: CourseVersion,
  ): Promise<BriefKeyword[]> {
    const pool: BriefKeyword[] = [];
    const seen = new Set<string>();
    const add = (keyword: BriefKeyword): void => {
      const key = normalisePhrase(keyword.phrase);
      if (key.length < 2 || seen.has(key) || pool.length >= 10) return;
      seen.add(key);
      pool.push(keyword);
    };

    if (campaign.radarRunId != null) {
      const rows = await db
        .select({ report: radarRuns.report })
        .from(radarRuns)
        .where(and(eq(radarRuns.id, campaign.radarRunId), eq(radarRuns.labelId, campaign.labelId)))
        .limit(1);
      const parsed = radarKeywordItems.safeParse(rows[0]?.report);
      if (parsed.success) {
        for (const item of parsed.data.keywords?.items ?? []) {
          add({ phrase: item.phrase, sourceRef: item.sourceUrl, kind: 'radar' });
        }
      }
    }

    add({ phrase: course.name, sourceRef: 'Opleidingskaart · Naam', kind: 'afgeleid' });
    add({ phrase: `opleiding ${course.name}`, sourceRef: 'Opleidingskaart · Naam', kind: 'afgeleid' });
    for (const fact of statableFacts(course)) {
      if (fact.field !== 'targetAudience' && fact.field !== 'contentOutline') continue;
      // Short noun phrases from a confirmed fact: "casemanagers", "leidinggevenden
      // met verzuimtaken". Long clauses are sentences, not search terms.
      for (const phrase of fact.value.split(/[,;.\n]|\ben\b|\bof\b/u)) {
        const clean = phrase.replace(/^(zoals|waaronder|bijvoorbeeld|onder meer|voor)\s+/iu, '').trim();
        const words = clean.split(/\s+/u).filter((word) => word.length > 0);
        if (words.length >= 1 && words.length <= 4 && clean.length >= 5 && clean.length <= 60) {
          add({ phrase: clean.toLowerCase(), sourceRef: `Opleidingskaart · ${fact.label}`, kind: 'afgeleid' });
        }
      }
    }
    return pool;
  }

  /** User edits produce a new version; the previous one is retained. */
  async editBrief(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
    patch: BriefEditInput,
  ): Promise<BriefVersion> {
    requireLabelPermission(user, labelId, 'brief:write');
    const campaign = await this.requireById(db, labelId, campaignId);
    if (patch.personaVersionIds) await this.personas.requireForCampaign(db, labelId, campaignId, campaign.courseVersionId, patch.personaVersionIds);

    const current = await this.latestBrief(db, campaignId);
    if (current === undefined) {
      throw new AppError('not_found', {
        publicMessage: 'Er is nog geen briefing om te wijzigen.',
      });
    }

    /*
     * A person's stage messages are held to the same two rules as the model's:
     * one per stage the objective covers, and confirmed proof only. Here a
     * problem is a bad request rather than a provider error, and an
     * unconfirmed proof field is refused rather than silently dropped — the
     * person is editing, so they can see the refusal and confirm the fact.
     */
    let stageMessages = current.stageMessages;
    if (patch.stageMessages !== undefined) {
      const stages = stagesForObjective(campaign.objective ?? 'full_funnel');
      const course = await this.courses.requireVersion(db, labelId, campaign.courseVersionId);
      const problems = [
        ...stageMessageProblems(patch.stageMessages, stages),
        ...confirmedProofOnly(patch.stageMessages, course).notesNl,
      ];
      if (problems.length > 0) {
        throw new AppError('bad_request', { publicMessage: problems.join(' ') });
      }
      stageMessages = patch.stageMessages;
    }

    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(briefVersions)
        .values({
          organizationId: user.organizationId,
          labelId,
          campaignId,
          version: current.version + 1,
          reviewNotes: patch.reviewNotes ?? current.reviewNotes,
          keywords: patch.keywords ?? current.keywords,
          contextNl: patch.contextNl ?? current.contextNl,
          goal: patch.goal ?? current.goal,
          audienceInsightNl: patch.audienceInsightNl ?? current.audienceInsightNl,
          propositionNl: patch.propositionNl ?? current.propositionNl,
          personaVersionIds: patch.personaVersionIds ?? current.personaVersionIds,
          coreMessage: patch.coreMessage ?? current.coreMessage,
          stageMessages,
          toneOfVoiceNl: patch.toneOfVoiceNl ?? current.toneOfVoiceNl,
          mandatories: patch.mandatories ?? current.mandatories,
          channelRoles: patch.channelRoles ?? current.channelRoles,
          timingNl: patch.timingNl ?? current.timingNl,
          risks: patch.risks ?? current.risks,
          evidence: patch.evidence ?? current.evidence,
          usableClaims: patch.usableClaims ?? current.usableClaims,
          // Off-limits can be added to but the mandatory entries stay.
          offLimits: [...new Set([...(patch.offLimits ?? []), ...current.offLimits])],
          cta: patch.cta ?? current.cta,
          ctaUrl: patch.ctaUrl === undefined ? current.ctaUrl : patch.ctaUrl,
          channelSuggestions: patch.channelSuggestions ?? current.channelSuggestions,
          contentScope: patch.contentScope ?? current.contentScope,
          measurement: patch.measurement ?? current.measurement,
          stopConditions: patch.stopConditions ?? current.stopConditions,
          ownerUserId: current.ownerUserId,
          budgetCents: current.budgetCents,
          startDate: current.startDate,
          reviewState: 'draft',
          origin: 'user',
          promptVersion: current.promptVersion,
        })
        .returning();

      const row = inserted[0];
      if (row === undefined) {
        throw new AppError('internal_error', { internalDetail: 'brief edit yielded no row' });
      }
      return toBrief(row);
    });
  }

  async approveBrief(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
    briefVersionId: string,
    noteNl: string | null,
  ): Promise<BriefVersion> {
    requireLabelPermission(user, labelId, 'brief:approve');
    await this.requireById(db, labelId, campaignId);

    return db.transaction(async (tx) => {
      // Scoped to the campaign as well as the label. Resolving on the label
      // alone let a briefing id from campaign B be approved through campaign
      // A's route: the foreign briefing turned "approved" while the archiving
      // step below silently un-approved A's own, knocking A back to step 3
      // (audit 2026-09-15).
      const rows = await tx
        .select()
        .from(briefVersions)
        .where(
          and(
            eq(briefVersions.id, briefVersionId),
            eq(briefVersions.labelId, labelId),
            eq(briefVersions.campaignId, campaignId),
          ),
        )
        .limit(1);
      const target = rows[0];
      if (target === undefined) {
        throw AppError.notFoundOrForbidden('brief', briefVersionId);
      }
      if (target.reviewState === 'approved') {
        return toBrief(target);
      }

      // Only one approved brief per campaign — the partial unique index would
      // otherwise reject this, so the previous one is archived first.
      await tx
        .update(briefVersions)
        .set({ reviewState: 'archived' })
        .where(
          and(eq(briefVersions.campaignId, campaignId), eq(briefVersions.reviewState, 'approved')),
        );
      await tx
        .update(briefVersions)
        .set({ reviewState: 'approved' })
        .where(eq(briefVersions.id, briefVersionId));

      await this.approvals.approve(tx, user, {
        labelId,
        artefactType: 'brief',
        artefactId: briefVersionId,
        artefactVersion: target.version,
        noteNl,
      });

      await this.setStage(tx, campaignId, 'concept_selection');

      const updated = await tx
        .select()
        .from(briefVersions)
        .where(eq(briefVersions.id, briefVersionId))
        .limit(1);
      const row = updated[0];
      if (row === undefined) {
        throw new AppError('internal_error', { internalDetail: 'brief row vanished' });
      }
      return toBrief(row);
    });
  }
}

interface CampaignRow {
  radarRunId?: string | null;
  visualReferenceAssetIds?: unknown;
  id: string;
  labelId: string;
  name: string;
  entryMode: string;
  objective?: string | null;
  stage: string;
  contentLanguage: string;
  courseVersionId: string;
  brandProfileVersionId: string;
  opportunityId: string | null;
  userIdea: string | null;
  suppliedBrief: string | null;
  ownerUserId: string | null;
  startDate: string | null;
  budgetCents: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The form in which two phrases count as one search term. */
function normalisePhrase(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Only the part of a radar report the briefing needs; the rest of the report may evolve freely. */
const radarKeywordItems = z.object({
  keywords: z
    .object({ items: z.array(z.object({ phrase: z.string(), sourceUrl: z.string() })) })
    .nullable()
    .optional(),
});

/**
 * The list cursor: the (createdAt, id) of the last row, base64url of JSON.
 * Opaque to the client, cheap to decode, and a malformed one reads as "from
 * the start" rather than as an error a person cannot act on.
 */
function encodeListCursor(value: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ c: value.createdAt.toISOString(), i: value.id }), 'utf8').toString(
    'base64url',
  );
}

function decodeListCursor(cursor: string | undefined): { createdAt: Date; id: string } | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { c, i } = parsed as { c?: unknown; i?: unknown };
    if (typeof c !== 'string' || typeof i !== 'string') return undefined;
    const createdAt = new Date(c);
    return Number.isNaN(createdAt.getTime()) ? undefined : { createdAt, id: i };
  } catch {
    return undefined;
  }
}

export function toCampaign(row: CampaignRow): Campaign {
  return {
    radarRunId: row.radarRunId ?? null,
    visualReferenceAssetIds: (row.visualReferenceAssetIds ?? []) as string[],
    id: row.id,
    labelId: row.labelId,
    name: row.name,
    entryMode: row.entryMode as Campaign['entryMode'],
    objective: (row.objective ?? null) as Campaign['objective'],
    stage: row.stage as WorkflowStage,
    contentLanguage: row.contentLanguage as Campaign['contentLanguage'],
    courseVersionId: row.courseVersionId,
    brandProfileVersionId: row.brandProfileVersionId,
    opportunityId: row.opportunityId,
    userIdea: row.userIdea,
    suppliedBrief: row.suppliedBrief,
    ownerUserId: row.ownerUserId,
    startDate: row.startDate,
    budgetCents: row.budgetCents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface BriefRow {
  reviewNotes?: unknown;
  id: string;
  campaignId: string;
  version: number;
  goal: string;
  personaVersionIds: unknown;
  coreMessage: string;
  stageMessages?: unknown;
  keywords?: unknown;
  contextNl?: string | null;
  audienceInsightNl?: string | null;
  propositionNl?: string | null;
  toneOfVoiceNl?: string | null;
  mandatories?: unknown;
  channelRoles?: unknown;
  timingNl?: string | null;
  risks?: unknown;
  evidence: unknown;
  usableClaims: unknown;
  offLimits: unknown;
  cta: string;
  ctaUrl: string | null;
  channelSuggestions: unknown;
  contentScope: string;
  measurement: string;
  stopConditions: string;
  ownerUserId: string | null;
  budgetCents: number | null;
  startDate: string | null;
  reviewState: string;
  origin: string;
  promptVersion: string | null;
  createdAt: Date;
}

export function toBrief(row: BriefRow): BriefVersion {
  return {
    reviewNotes: (row.reviewNotes ?? []) as string[],
    id: row.id,
    campaignId: row.campaignId,
    version: row.version,
    goal: row.goal,
    personaVersionIds: (row.personaVersionIds ?? []) as string[],
    coreMessage: row.coreMessage,
    stageMessages: (row.stageMessages ?? []) as StageMessage[],
    keywords: (row.keywords ?? []) as BriefKeyword[],
    contextNl: row.contextNl ?? '',
    audienceInsightNl: row.audienceInsightNl ?? '',
    propositionNl: row.propositionNl ?? '',
    toneOfVoiceNl: row.toneOfVoiceNl ?? '',
    mandatories: (row.mandatories ?? []) as string[],
    channelRoles: (row.channelRoles ?? []) as ChannelRole[],
    timingNl: row.timingNl ?? '',
    risks: (row.risks ?? []) as string[],
    evidence: (row.evidence ?? []) as Grounding[],
    usableClaims: (row.usableClaims ?? []) as UsableClaim[],
    offLimits: (row.offLimits ?? []) as string[],
    cta: row.cta,
    ctaUrl: row.ctaUrl,
    channelSuggestions: (row.channelSuggestions ?? []) as MarketingChannel[],
    contentScope: row.contentScope,
    measurement: row.measurement,
    stopConditions: row.stopConditions,
    ownerUserId: row.ownerUserId,
    budgetCents: row.budgetCents,
    startDate: row.startDate,
    reviewState: row.reviewState as ReviewState,
    origin: row.origin as BriefVersion['origin'],
    promptVersion: row.promptVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The narrative sections of a brief and the fewest words each may have. */
export const BRIEF_SECTION_MIN_WORDS: Readonly<
  Record<'contextNl' | 'goal' | 'audienceInsightNl' | 'propositionNl' | 'coreMessage' | 'toneOfVoiceNl' | 'contentScope' | 'timingNl' | 'measurement' | 'stopConditions', number>
> = Object.freeze({
  contextNl: 80,
  goal: 40,
  audienceInsightNl: 80,
  propositionNl: 30,
  coreMessage: 12,
  toneOfVoiceNl: 20,
  contentScope: 60,
  timingNl: 10,
  measurement: 40,
  stopConditions: 20,
});

/** A brief below this, all narrative sections together, is a form, not a briefing. */
export const BRIEF_MIN_TOTAL_WORDS = 550;

const BRIEF_SECTION_LABEL_NL: Readonly<Record<keyof typeof BRIEF_SECTION_MIN_WORDS, string>> = Object.freeze({
  contextNl: 'Aanleiding en context',
  goal: 'Doelstelling',
  audienceInsightNl: 'Doelgroep en inzicht',
  propositionNl: 'Propositie en belofte',
  coreMessage: 'Kernboodschap',
  toneOfVoiceNl: 'Toon en stijl',
  contentScope: 'Deliverables en creatieve richting',
  timingNl: 'Timing en fasering',
  measurement: 'Meten',
  stopConditions: 'Stopcriteria',
});

export function briefWordCount(text: string): number {
  return text.trim().split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Every narrative section of a brief, for a total word count. */
export function briefNarrativeWords(brief: Pick<BriefVersion, keyof typeof BRIEF_SECTION_MIN_WORDS>): number {
  return (Object.keys(BRIEF_SECTION_MIN_WORDS) as (keyof typeof BRIEF_SECTION_MIN_WORDS)[]).reduce(
    (sum, key) => sum + briefWordCount(brief[key]),
    0,
  );
}

/**
 * Why a proposed brief is not yet a briefing, in Dutch; empty when it is.
 *
 * Words, not characters: a writer thinks in words and the prompt states the
 * same numbers. Three kinds of shortfall — a section too thin, the whole too
 * short, a suggested channel without a role — plus the one thing a brief must
 * not contain: a percentage in the goal or the measurement, which reads as a
 * forecast nobody measured.
 */
export function briefProblems(brief: BriefProposal): string[] {
  const problems: string[] = [];
  for (const [key, minimum] of Object.entries(BRIEF_SECTION_MIN_WORDS) as [keyof typeof BRIEF_SECTION_MIN_WORDS, number][]) {
    const words = briefWordCount(brief[key]);
    if (words < minimum) {
      problems.push(
        `${BRIEF_SECTION_LABEL_NL[key]} (${key}) telt ${String(words)} woorden; minimaal ${String(minimum)} nodig.`,
      );
    }
  }
  const total = briefNarrativeWords(brief);
  if (total < BRIEF_MIN_TOTAL_WORDS) {
    problems.push(
      `De briefing telt in totaal ${String(total)} woorden in de tekstonderdelen; een volwaardige briefing heeft er minimaal ${String(BRIEF_MIN_TOTAL_WORDS)}.`,
    );
  }
  const roles = new Set(brief.channelRoles.map((role) => role.channel));
  const withoutRole = brief.channelSuggestions.filter((channel) => !roles.has(channel));
  if (withoutRole.length > 0) {
    problems.push(
      `Geen rol beschreven in channelRoles voor: ${withoutRole.map((channel) => CHANNEL_LABEL_NL[channel]).join(', ')}.`,
    );
  }
  if (/\d+\s*%/u.test(`${brief.goal} ${brief.measurement}`)) {
    problems.push('Doelstelling of Meten bevat een percentage; een briefing noemt indicatoren, geen prognose.');
  }
  return problems;
}

/**
 * Why a set of stage messages does not fit its campaign, in Dutch; empty when it does.
 *
 * Pure, so the same check serves the model's proposal (a problem is a provider
 * error) and a person's edit (a bad request): exactly one message per stage
 * the objective covers, none for any other stage.
 */
export function stageMessageProblems(
  messages: readonly StageMessage[],
  stages: readonly FunnelStage[],
): string[] {
  const problems: string[] = [];
  const seen = new Set<FunnelStage>();
  for (const message of messages) {
    if (!stages.includes(message.stage)) {
      problems.push(
        `De fase ${FUNNEL_STAGE_LABEL_NL[message.stage]} hoort niet bij het doel van deze campagne.`,
      );
    }
    if (seen.has(message.stage)) {
      problems.push(`De fase ${FUNNEL_STAGE_LABEL_NL[message.stage]} heeft meer dan één boodschap.`);
    }
    seen.add(message.stage);
  }
  for (const stage of stages) {
    if (!seen.has(stage)) {
      problems.push(`De fase ${FUNNEL_STAGE_LABEL_NL[stage]} heeft geen boodschap.`);
    }
  }
  return [...new Set(problems)];
}

/**
 * Keeps only confirmed proof fields, and says which were removed.
 *
 * The brief names fields as proof; a field nobody has confirmed cannot be
 * proof of anything yet. The removed ones are reported per stage so the
 * person can see what the model wanted to cite — and confirm the fact if it
 * is true — rather than wondering why a stage cites nothing.
 */
export function confirmedProofOnly(
  messages: readonly StageMessage[],
  course: Pick<CourseVersion, 'facts'>,
): { messages: StageMessage[]; notesNl: string[] } {
  const confirmed = new Set<CourseFactField>(confirmedFacts(course));
  const notesNl: string[] = [];
  const cleaned = messages.map((message) => {
    const removed = message.proofFields.filter((field) => !confirmed.has(field));
    if (removed.length > 0) {
      notesNl.push(
        `Bewijs voor ${FUNNEL_STAGE_LABEL_NL[message.stage]}: ${removed
          .map((field) => COURSE_FACT_LABEL_NL[field])
          .join(', ')} is nog niet gecontroleerd en is uit de fase-boodschap gehaald.`,
      );
    }
    return {
      ...message,
      proofFields: [...new Set(message.proofFields.filter((field) => confirmed.has(field)))],
    };
  });
  return { messages: cleaned, notesNl };
}

/** The radar supplies an explicit destination, distinct from external evidence URLs. */
function radarTargetUrl(suppliedBrief: string | null): string | null {
  if (!suppliedBrief?.includes('Herkomst: radar-run ')) return null;
  const candidate = /Doel-URL: (https:\/\/[^\s]+)/u.exec(suppliedBrief)?.[1];
  if (!candidate) return null;
  try { const url = new URL(candidate); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
