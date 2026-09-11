import { and, desc, eq, sql } from 'drizzle-orm';
import {
  briefProposal,
  createCampaignInput,
  unconfirmedFacts,
  COURSE_FACT_LABEL_NL,
  type BriefEditInput,
  type BriefVersion,
  type Campaign,
  type CampaignObjective,
  type CreateCampaignInputData,
  type CurrentUser,
  type Grounding,
  type MarketingChannel,
  type ReviewState,
  type UsableClaim,
  type WorkflowStage,
} from '@c360/contracts';
import type { Db, DbOrTx } from '../../core/db/types.js';
import { briefVersions, campaigns } from '../../core/db/schema.js';
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
  ) {}

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

  async list(db: Db, user: CurrentUser, labelId: string, limit: number): Promise<Campaign[]> {
    requireLabelPermission(user, labelId, 'campaign:read');
    const rows = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.labelId, labelId))
      .orderBy(desc(campaigns.createdAt))
      .limit(limit);
    return rows.map(toCampaign);
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
      throw new AppError('gate_not_passed', {
        publicMessage:
          'De briefing is nog niet goedgekeurd. Keur de briefing goed voordat je concepten laat maken.',
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

    const result = await this.generation.generate(db, {
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
      },
    });

    // Appended after generation, so the model cannot leave them out.
    const mandatoryOffLimits = [
      ...brandProfile.rules.filter((rule) => rule.kind === 'must_not').map((rule) => rule.text),
      ...unconfirmedFacts(course).map(
        (field) =>
          `Niet noemen: ${COURSE_FACT_LABEL_NL[field]} — deze informatie is nog niet gecontroleerd.`,
      ),
    ];
    const offLimits = [...new Set([...result.value.offLimits, ...mandatoryOffLimits])];

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
          reviewNotes: result.value.reviewNotes,
          goal: result.value.goal,
          personaVersionIds: [...input.personaVersionIds],
          coreMessage: result.value.coreMessage,
          evidence: result.value.evidence,
          usableClaims: result.value.usableClaims,
          offLimits,
          cta: result.value.cta,
          ctaUrl: result.value.ctaUrl ?? radarTargetUrl(campaign.suppliedBrief),
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

    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(briefVersions)
        .values({
          organizationId: user.organizationId,
          labelId,
          campaignId,
          version: current.version + 1,
          reviewNotes: patch.reviewNotes ?? current.reviewNotes,
          goal: patch.goal ?? current.goal,
          personaVersionIds: patch.personaVersionIds ?? current.personaVersionIds,
          coreMessage: patch.coreMessage ?? current.coreMessage,
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
      const rows = await tx
        .select()
        .from(briefVersions)
        .where(and(eq(briefVersions.id, briefVersionId), eq(briefVersions.labelId, labelId)))
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

/** The radar supplies an explicit destination, distinct from external evidence URLs. */
function radarTargetUrl(suppliedBrief: string | null): string | null {
  if (!suppliedBrief?.includes('Herkomst: radar-run ')) return null;
  const candidate = /Doel-URL: (https:\/\/[^\s]+)/u.exec(suppliedBrief)?.[1];
  if (!candidate) return null;
  try { const url = new URL(candidate); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
