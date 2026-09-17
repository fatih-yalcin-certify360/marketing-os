import { and, desc, eq, sql } from 'drizzle-orm';
import {
  channelFit,
  conceptProposalSet,
  contentPlan,
  PRODUCIBLE_CHANNELS,
  plannableContentPlan,
  stagesForObjective,
  FUNNEL_STAGE_LABEL_NL,
  type ConceptVersion,
  type ContentPlan,
  type CurrentUser,
  type FunnelStage,
  type LearningWithEvidence,
  type MarketingChannel,
  type PersonaVersion,
  type ReviewState,
} from '@c360/contracts';
import { learningsForPrompt } from '../learnings/service.js';
import type { Db, DbOrTx } from '../../core/db/types.js';
import { conceptVersions, contentPlans } from '../../core/db/schema.js';
import { AppError } from '../../core/errors/app-error.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import type { GenerationService } from '../../core/ai/generation.js';
import type { BrandService } from '../brand/service.js';
import type { CourseService } from '../courses/service.js';
import type { PersonaService } from '../personas/service.js';
import type { CampaignService } from '../campaigns-briefs/service.js';
import type { ApprovalService } from '../reviews-approvals/service.js';
import { slugify } from '../personas/service.js';

/**
 * Concepts and the content plan.
 *
 * Concepts are only generated from an **approved** brief — the brief is
 * obtained via `requireApprovedBrief`, which throws `gate_not_passed` when
 * there is none, so the gate cannot be sidestepped.
 *
 * The content plan is a separate, approvable artefact on purpose: the user sees
 * how many pieces across which channels *before* anything is generated, so no
 * budget is spent on a plan they have not agreed to.
 */

export class ConceptService {
  constructor(
    private readonly generation: GenerationService,
    private readonly brand: BrandService,
    private readonly courses: CourseService,
    private readonly personas: PersonaService,
    private readonly campaigns: CampaignService,
    private readonly approvals: ApprovalService,
    /**
     * Approved learnings, when the deployment has them (R-2).
     *
     * Optional like it is on personas: a test can build the service without a
     * learning store, and a call site that only reads or approves a plan needs
     * no learning wiring. Only *approved* learnings arrive, each with the size
     * of its evidence, so the plan can lean on a lesson without mistaking a
     * fortnight for a pattern.
     */
    private readonly learnings?: {
      approvedForPrompt(db: Db, labelId: string): Promise<LearningWithEvidence[]>;
    },
  ) {}

  async list(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
  ): Promise<ConceptVersion[]> {
    requireLabelPermission(user, labelId, 'concept:read');
    await this.campaigns.requireById(db, labelId, campaignId);
    const rows = await db
      .select()
      .from(conceptVersions)
      .where(eq(conceptVersions.campaignId, campaignId))
      .orderBy(desc(conceptVersions.createdAt));

    const byKey = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const existing = byKey.get(row.conceptKey);
      if (existing === undefined || row.version > existing.version) {
        byKey.set(row.conceptKey, row);
      }
    }
    return [...byKey.values()].map(toConcept);
  }

  /**
   * Checks everything `propose` needs, without generating anything.
   *
   * Called by the route before the job is enqueued. Generation runs on the
   * worker now, so without this the gate would only be evaluated after the
   * request had already returned an accepted job: the user would watch a
   * progress bar for work that was never going to run, and a budget
   * reservation would be held for it. The requirement is that critical
   * controls are not skipped, and a control that fires a minute later in a
   * failure message is not the same control.
   *
   * The handler re-checks the same conditions at run time, because the brief
   * can be unapproved in between.
   */
  async assertCanPropose(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
  ): Promise<void> {
    requireLabelPermission(user, labelId, 'concept:write');
    await this.campaigns.requireById(db, labelId, campaignId);
    await this.campaigns.requireApprovedBrief(db, campaignId);
    await this.brand.requireApproved(db, labelId);
  }

  async propose(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      campaignId: string;
      jobId?: string | null;
      attempt?: number;
      signal?: AbortSignal | undefined;
    },
  ): Promise<{ concepts: ConceptVersion[]; shortfallReasonNl: string | null; isMock: boolean }> {
    requireLabelPermission(user, input.labelId, 'concept:write');

    const campaign = await this.campaigns.requireById(db, input.labelId, input.campaignId);
    // The gate: no approved brief, no concepts.
    const brief = await this.campaigns.requireApprovedBrief(db, input.campaignId);
    const course = await this.courses.requireVersion(db, input.labelId, campaign.courseVersionId);
    const brandProfile = await this.brand.requireApproved(db, input.labelId);
    const personas = await this.personas.findManyByIds(
      db,
      input.labelId,
      brief.personaVersionIds,
    );

    const result = await this.generation.generate(db, {
      template: 'concept.propose',
      schema: conceptProposalSet,
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
        brief,
      },
    });

    if (new Set(result.value.concepts.map(concept => concept.artDirection.medium)).size !== 3) {
      throw new AppError('provider_invalid_output', { publicMessage: 'De drie beeldrichtingen zijn onvoldoende verschillend. Probeer opnieuw.' });
    }
    const stored: ConceptVersion[] = [];
    for (const proposal of result.value.concepts) {
      const conceptKey = slugify(proposal.name);
      const inserted = await db.transaction(async (tx) => {
        const maxRows = await tx
          .select({ max: sql<number | null>`max(${conceptVersions.version})` })
          .from(conceptVersions)
          .where(
            and(
              eq(conceptVersions.campaignId, input.campaignId),
              eq(conceptVersions.conceptKey, conceptKey),
            ),
          );
        const rows = await tx
          .insert(conceptVersions)
          .values({
            organizationId: user.organizationId,
            labelId: input.labelId,
            campaignId: input.campaignId,
            briefVersionId: brief.id,
            conceptKey,
            version: (maxRows[0]?.max ?? 0) + 1,
            name: proposal.name,
            coreIdea: proposal.coreIdea,
            exampleHeadline: proposal.exampleHeadline,
            artDirection: proposal.artDirection,
            visualApproach: proposal.visualApproach,
            visualLayout: proposal.visualLayout,
            personaFitRationaleNl: proposal.personaFitRationaleNl,
            reviewState: 'draft',
            origin: 'ai_generated',
            promptVersion: result.promptVersion,
          })
          .returning();
        return rows[0];
      });

      if (inserted === undefined) {
        throw new AppError('internal_error', { internalDetail: 'concept insert yielded no row' });
      }
      stored.push(toConcept(inserted));
    }

    return {
      concepts: stored,
      shortfallReasonNl: result.value.shortfallReasonNl,
      isMock: result.isMock,
    };
  }

  async findById(db: DbOrTx, labelId: string, id: string): Promise<ConceptVersion | undefined> {
    const rows = await db
      .select()
      .from(conceptVersions)
      .where(and(eq(conceptVersions.id, id), eq(conceptVersions.labelId, labelId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toConcept(row);
  }

  /**
   * The same lookup, but the concept must belong to this campaign.
   *
   * Resolving on the label alone let a concept id from campaign B be selected
   * through campaign A's route: A lost its own selection to the clearing step
   * and B ended up with two, after which `selectedConcept`'s `limit(1)` picked
   * one arbitrarily (audit 2026-09-15).
   */
  async requireForCampaign(
    db: DbOrTx,
    labelId: string,
    campaignId: string,
    id: string,
  ): Promise<ConceptVersion> {
    const rows = await db
      .select()
      .from(conceptVersions)
      .where(
        and(
          eq(conceptVersions.id, id),
          eq(conceptVersions.labelId, labelId),
          eq(conceptVersions.campaignId, campaignId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      throw AppError.notFoundOrForbidden('concept', id);
    }
    return toConcept(row);
  }

  async requireById(db: DbOrTx, labelId: string, id: string): Promise<ConceptVersion> {
    const found = await this.findById(db, labelId, id);
    if (found === undefined) {
      throw AppError.notFoundOrForbidden('concept', id);
    }
    return found;
  }

  /** One selected concept per campaign; the partial unique index enforces it. */
  async select(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
    conceptVersionId: string,
  ): Promise<ConceptVersion> {
    requireLabelPermission(user, labelId, 'concept:write');
    await this.campaigns.requireById(db, labelId, campaignId);

    return db.transaction(async (tx) => {
      await this.requireForCampaign(tx, labelId, campaignId, conceptVersionId);
      await tx
        .update(conceptVersions)
        .set({ selected: false })
        .where(eq(conceptVersions.campaignId, campaignId));
      await tx
        .update(conceptVersions)
        .set({ selected: true })
        .where(eq(conceptVersions.id, conceptVersionId));
      await this.campaigns.setStage(tx, campaignId, 'content_plan_approval');
      return this.requireById(tx, labelId, conceptVersionId);
    });
  }

  async selectedConcept(db: DbOrTx, campaignId: string): Promise<ConceptVersion | undefined> {
    const rows = await db
      .select()
      .from(conceptVersions)
      .where(and(eq(conceptVersions.campaignId, campaignId), eq(conceptVersions.selected, true)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toConcept(row);
  }

  async requireSelectedConcept(db: DbOrTx, campaignId: string): Promise<ConceptVersion> {
    const concept = await this.selectedConcept(db, campaignId);
    if (concept === undefined) {
      throw new AppError('gate_not_passed', {
        publicMessage: 'Er is nog geen concept gekozen. Kies eerst een concept.',
        context: { campaignId, gate: 'concept_version_selected' },
      });
    }
    return concept;
  }

  // -------------------------------------------------------- Content plan ---

  /** Pre-enqueue gate for `proposePlan`. See `assertCanPropose`. */
  async assertCanProposePlan(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
  ): Promise<void> {
    requireLabelPermission(user, labelId, 'content:write');
    await this.campaigns.requireById(db, labelId, campaignId);
    await this.campaigns.requireApprovedBrief(db, campaignId);
    await this.requireSelectedConcept(db, campaignId);
    await this.brand.requireApproved(db, labelId);
  }

  async proposePlan(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      campaignId: string;
      jobId?: string | null;
      attempt?: number;
      signal?: AbortSignal | undefined;
    },
  ): Promise<{ plan: ContentPlan; planId: string; version: number; isMock: boolean }> {
    requireLabelPermission(user, input.labelId, 'content:write');

    const campaign = await this.campaigns.requireById(db, input.labelId, input.campaignId);
    const brief = await this.campaigns.requireApprovedBrief(db, input.campaignId);
    const concept = await this.requireSelectedConcept(db, input.campaignId);
    const course = await this.courses.requireVersion(db, input.labelId, campaign.courseVersionId);
    const brandProfile = await this.brand.requireApproved(db, input.labelId);
    const personas = await this.personas.findManyByIds(db, input.labelId, brief.personaVersionIds);

    /*
     * Intersected with what this build can produce, rather than taken from
     * the brief alone: a brief approved before a channel was retired must
     * not make the plan propose it again.
     *
     * `PRODUCIBLE_CHANNELS`, not the social pilot list. This read the
     * pilot list until the landing page became producible, and then
     * silently filtered it out of every plan — the widening was in the
     * schema and the capability was not.
     */
    const channels = brief.channelSuggestions.filter((channel) =>
      (PRODUCIBLE_CHANNELS as readonly string[]).includes(channel),
    );
    /*
     * The stages follow from the objective. A campaign without one (created
     * before objectives existed) plans as a full funnel, and the prompt is
     * told that is why — the model is not asked to guess an objective.
     */
    const stages = stagesForObjective(campaign.objective ?? 'full_funnel');

    const result = await this.generation.generate(db, {
      template: 'content.plan',
      schema: plannableContentPlan,
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
        brief,
        concept,
        channels,
        briefChannels: channels,
        objective: campaign.objective,
        funnelStages: stages,
        /*
         * The editorial rule per cell, as input. This is layer one of the
         * two-layer reasoning: the rule is ours and deterministic, the model
         * writes the campaign-specific argument on top of it and may move one
         * step with a reason. `proposedChannelAdvice` refuses anything else.
         *
         * Every producible channel, not only the brief's: the grid lets the
         * person tick any cell, and a cell without advice is a choice made
         * blind. Items are still planned for the brief's channels only.
         */
        channelFit: stages.flatMap((stage) =>
          PRODUCIBLE_CHANNELS.map((channel) => ({ stage, channel, ...channelFit(stage, channel) })),
        ),
        /*
         * Where the personas orient, with the evidence behind each statement.
         * This is the only audience evidence on which the model may move a
         * verdict; assumptions are marked and are not a ground.
         */
        orientationSources: orientationSourcesOf(personas),
        learnings: learningsForPrompt(
          (await this.learnings?.approvedForPrompt(db, input.labelId)) ?? [],
        ),
      },
    });

    /*
     * The checks the schema cannot make. It bounds a stage to the three that
     * exist and a channel to the producible ones, but it does not know which
     * stages *this* objective covers or which channels *this* brief allows.
     * A "Beslissen" item in an awareness campaign is a model that ignored its
     * instructions, and it fails here rather than being stored. Advice may
     * cover every producible channel; items only the brief's.
     */
    const problems = planProblems(result.value, stages, channels, PRODUCIBLE_CHANNELS);
    if (problems.length > 0) {
      throw new AppError('provider_invalid_output', {
        publicMessage: 'Het voorgestelde kanaalplan valt buiten het doel van deze campagne. Probeer opnieuw.',
        internalDetail: problems.join(' '),
      });
    }

    return db.transaction(async (tx) => {
      const maxRows = await tx
        .select({ max: sql<number | null>`max(${contentPlans.version})` })
        .from(contentPlans)
        .where(eq(contentPlans.campaignId, input.campaignId));
      const version = (maxRows[0]?.max ?? 0) + 1;

      const inserted = await tx
        .insert(contentPlans)
        .values({
          organizationId: user.organizationId,
          labelId: input.labelId,
          campaignId: input.campaignId,
          version,
          items: result.value.items,
          cadenceNl: result.value.cadenceNl,
          rationaleNl: result.value.rationaleNl,
          channelAdvice: result.value.channelAdvice,
          measurementPlan: result.value.measurementPlan,
          reviewState: 'draft',
          origin: 'ai_generated',
        })
        .returning();

      const row = inserted[0];
      if (row === undefined) {
        throw new AppError('internal_error', { internalDetail: 'plan insert yielded no row' });
      }
      return { plan: result.value, planId: row.id, version, isMock: result.isMock };
    });
  }

  async latestPlan(
    db: DbOrTx,
    campaignId: string,
  ): Promise<{ id: string; version: number; plan: ContentPlan; reviewState: ReviewState } | undefined> {
    const rows = await db
      .select()
      .from(contentPlans)
      .where(eq(contentPlans.campaignId, campaignId))
      .orderBy(desc(contentPlans.version))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      id: row.id,
      version: row.version,
      reviewState: row.reviewState as ReviewState,
      plan: contentPlan.parse({
        items: row.items,
        cadenceNl: row.cadenceNl,
        rationaleNl: row.rationaleNl,
        channelAdvice: row.channelAdvice,
        measurementPlan: row.measurementPlan,
      }),
    };
  }

  /** Replaces the plan with the user's edited version, then approves it. */
  async approvePlan(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
    edited: ContentPlan | null,
  ): Promise<{ id: string; version: number; plan: ContentPlan }> {
    requireLabelPermission(user, labelId, 'content:approve');
    const campaign = await this.campaigns.requireById(db, labelId, campaignId);

    return db.transaction(async (tx) => {
      const current = await this.latestPlan(tx, campaignId);
      if (current === undefined) {
        throw new AppError('not_found', {
          publicMessage: 'Er is nog geen kanaalplan om goed te keuren.',
        });
      }

      let planId = current.id;
      let version = current.version;
      let plan = current.plan;

      // An edit becomes a new version, so the approval binds to what the user
      // actually agreed to rather than to the machine's original proposal.
      if (edited !== null) {
        const parsed = contentPlan.parse(edited);
        /*
         * A person may pick any producible channel for any of the campaign's
         * stages — including every cell, against the advice — but not a stage
         * the objective does not cover. The advice is not theirs to edit: it
         * travels with the plan so the approval binds to what they saw.
         */
        const problems = planProblems(
          parsed,
          stagesForObjective(campaign.objective ?? 'full_funnel'),
          PRODUCIBLE_CHANNELS,
          PRODUCIBLE_CHANNELS,
        );
        if (problems.length > 0) {
          throw new AppError('bad_request', { publicMessage: problems.join(' ') });
        }
        const inserted = await tx
          .insert(contentPlans)
          .values({
            organizationId: user.organizationId,
            labelId,
            campaignId,
            version: current.version + 1,
            items: parsed.items,
            cadenceNl: parsed.cadenceNl,
            rationaleNl: parsed.rationaleNl,
            channelAdvice:
              parsed.channelAdvice.length > 0 ? parsed.channelAdvice : current.plan.channelAdvice,
            // The measurement plan travels like the advice: not the person's
            // to edit here, and the approval binds to what they saw.
            measurementPlan:
              parsed.measurementPlan.length > 0 ? parsed.measurementPlan : current.plan.measurementPlan,
            reviewState: 'draft',
            origin: 'user',
          })
          .returning();
        const row = inserted[0];
        if (row === undefined) {
          throw new AppError('internal_error', { internalDetail: 'plan edit yielded no row' });
        }
        planId = row.id;
        version = row.version;
        plan = parsed;
      }

      await tx
        .update(contentPlans)
        .set({ reviewState: 'archived' })
        .where(and(eq(contentPlans.campaignId, campaignId), eq(contentPlans.reviewState, 'approved')));
      await tx.update(contentPlans).set({ reviewState: 'approved' }).where(eq(contentPlans.id, planId));

      await this.approvals.approve(tx, user, {
        labelId,
        artefactType: 'content_plan',
        artefactId: planId,
        artefactVersion: version,
      });
      await this.campaigns.setStage(tx, campaignId, 'production');

      return { id: planId, version, plan };
    });
  }

  async requireApprovedPlan(
    db: DbOrTx,
    campaignId: string,
  ): Promise<{ id: string; version: number; plan: ContentPlan }> {
    const rows = await db
      .select()
      .from(contentPlans)
      .where(and(eq(contentPlans.campaignId, campaignId), eq(contentPlans.reviewState, 'approved')))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      throw new AppError('gate_not_passed', {
        publicMessage:
          'Het kanaalplan is nog niet goedgekeurd. Keur het kanaalplan goed voordat content wordt gemaakt.',
        context: { campaignId, gate: 'content_plan_approved' },
      });
    }
    return {
      id: row.id,
      version: row.version,
      plan: contentPlan.parse({
        items: row.items,
        cadenceNl: row.cadenceNl,
        rationaleNl: row.rationaleNl,
        channelAdvice: row.channelAdvice,
        measurementPlan: row.measurementPlan,
      }),
    };
  }
}

/**
 * Why a plan does not fit its campaign, in Dutch; empty when it does.
 *
 * Pure, so the same check serves the model's proposal (where a problem is a
 * provider error) and a person's edit (where it is a bad request). It answers
 * three questions: is every item in a stage this campaign covers, is every
 * channel one the caller allows, and is each stage × channel cell planned at
 * most once — two items for the same cell would collide on one asset key.
 */
export function planProblems(
  plan: Pick<ContentPlan, 'items' | 'channelAdvice'> & Partial<Pick<ContentPlan, 'measurementPlan'>>,
  stages: readonly FunnelStage[],
  channels: readonly MarketingChannel[],
  /** Channels advice may cover; defaults to the item channels. */
  adviceChannels: readonly MarketingChannel[] = channels,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const item of plan.items) {
    if (item.stage === null) {
      problems.push('Elke regel in het plan hoort bij een funnelfase.');
    } else if (!stages.includes(item.stage)) {
      problems.push(`De fase "${item.stage}" hoort niet bij het doel van deze campagne.`);
    }
    if (!channels.includes(item.channel)) {
      problems.push(`Het kanaal "${item.channel}" is voor deze campagne niet beschikbaar.`);
    }
    const key = `${item.stage ?? ''}/${item.channel}`;
    if (seen.has(key)) {
      problems.push(`De combinatie ${key} staat meer dan één keer in het plan.`);
    }
    seen.add(key);
  }

  /*
   * One page, one plan line.
   *
   * The course page is a single object that every stage points at. Planned per
   * stage it produces three change sets for the same page, and applying them
   * all leaves the page in whichever state happened to be applied last — the
   * proposals contradict each other by construction (2026-09-16).
   *
   * The per-stage advice is still right: each stage does want something
   * different from that page. The place for that is several changes inside one
   * proposal, which is exactly what the deliverable already holds — a list of
   * changes, each with its own placement and reason.
   */
  const pageLines = plan.items.filter((item) => item.channel === 'course_page_update');
  if (pageLines.length > 1) {
    problems.push(
      `De opleidingspagina staat ${String(pageLines.length)} keer in het plan, voor ${pageLines
        .map((item) => (item.stage === null ? 'geen fase' : FUNNEL_STAGE_LABEL_NL[item.stage]))
        .join(', ')}. Het is één pagina: plan haar één keer en zet de wijzigingen die de andere fases vragen in datzelfde voorstel.`,
    );
  }
  for (const advice of plan.channelAdvice) {
    if (!stages.includes(advice.stage) || !adviceChannels.includes(advice.channel)) {
      problems.push(`Het advies voor ${advice.stage}/${advice.channel} valt buiten deze campagne.`);
    }
  }
  /*
   * One measurement per stage the plan covers, when a plan carries any. A
   * plan from before measurement plans existed carries none and passes; a
   * plan that measures a stage the campaign does not run, or leaves one of
   * its stages unmeasured, has not answered the question.
   */
  const measured = plan.measurementPlan ?? [];
  if (measured.length > 0) {
    const stagesMeasured = new Set<FunnelStage>();
    for (const measurement of measured) {
      if (!stages.includes(measurement.stage)) {
        problems.push(
          `Het meetplan voor ${FUNNEL_STAGE_LABEL_NL[measurement.stage]} hoort niet bij het doel van deze campagne.`,
        );
      }
      if (stagesMeasured.has(measurement.stage)) {
        problems.push(`De fase ${FUNNEL_STAGE_LABEL_NL[measurement.stage]} heeft meer dan één meetplan.`);
      }
      stagesMeasured.add(measurement.stage);
    }
    for (const stage of stages) {
      if (!stagesMeasured.has(stage)) {
        problems.push(`De fase ${FUNNEL_STAGE_LABEL_NL[stage]} heeft geen meetplan.`);
      }
    }
  }
  return [...new Set(problems)];
}

/** Every persona's orientation statements, flattened with the persona's name for the prompt. */
export function orientationSourcesOf(
  personas: readonly Pick<PersonaVersion, 'name' | 'orientationSources'>[],
): { persona: string; source: PersonaVersion['orientationSources'][number] }[] {
  return personas.flatMap((persona) =>
    persona.orientationSources.map((source) => ({ persona: persona.name, source })),
  );
}

interface ConceptRow {
  artDirection?: unknown;
  id: string;
  campaignId: string;
  briefVersionId: string;
  version: number;
  name: string;
  coreIdea: string;
  exampleHeadline: string;
  visualApproach: string;
  visualLayout: string;
  personaFitRationaleNl: string;
  selected: boolean;
  reviewState: string;
  origin: string;
  promptVersion: string | null;
  createdAt: Date;
}

function toConcept(row: ConceptRow): ConceptVersion {
  return {
    artDirection: (row.artDirection ?? null) as ConceptVersion['artDirection'],
    id: row.id,
    campaignId: row.campaignId,
    briefVersionId: row.briefVersionId,
    version: row.version,
    name: row.name,
    coreIdea: row.coreIdea,
    exampleHeadline: row.exampleHeadline,
    visualApproach: row.visualApproach,
    visualLayout: row.visualLayout as ConceptVersion['visualLayout'],
    personaFitRationaleNl: row.personaFitRationaleNl,
    selected: row.selected,
    reviewState: row.reviewState as ReviewState,
    origin: row.origin as ConceptVersion['origin'],
    promptVersion: row.promptVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export type { MarketingChannel };
