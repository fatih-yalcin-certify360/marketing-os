import type { VisualGenerationService } from '../../core/ai/visuals.js';
import { loadRenderResources } from '../../core/render/brand-resources.js';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  CHANNEL_CONFIG,
  CHANNEL_LABEL_NL,
  checkAgainstChannel,
  contentCopy,
  type AssetFormat,
  contentProposalSet,
  defaultImageSpec,
  FUNNEL_STAGES,
  type ContentAssetVersion,
  type ContentCopy,
  type ContentEditInput,
  type ContentPlan,
  type ContentReviseInput,
  type CurrentUser,
  type FunnelStage,
  type MarketingChannel,
  type RenderSpec,
  type ReviewState,
} from '@c360/contracts';
import type { Db, DbOrTx } from '../../core/db/types.js';
import { assets, contentAssetVersions } from '../../core/db/schema.js';
import { AppError } from '../../core/errors/app-error.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import type { GenerationService } from '../../core/ai/generation.js';
import { layoutsForVariants } from '../../core/render/layouts.js';
import type { ImageRenderer } from '../../core/render/renderer.js';
import type { BrandService } from '../brand/service.js';
import type { CourseService } from '../courses/service.js';
import type { PersonaService } from '../personas/service.js';
import type { CampaignService } from '../campaigns-briefs/service.js';
import type { ConceptService } from '../concepts/service.js';
import type { ApprovalService } from '../reviews-approvals/service.js';

/**
 * Content assets.
 *
 * The properties this service exists to hold:
 *
 *  - **Two variants share one copy record.** Both render specs are built from
 *    the same `copy`, so "same message and CTA, different visual approach" is
 *    structural rather than a rule someone has to follow.
 *  - **Provenance is stored, so staleness is computable.** Each version records
 *    the brief, concept, brand, course and persona versions it came from.
 *  - **A hand edit is never silently discarded.** `revise` refuses to run over
 *    a user-edited version unless the caller explicitly confirms.
 *  - **Regeneration is per asset.** Nothing regenerates a whole campaign, so an
 *    already-approved piece is not quietly replaced.
 */

export interface AssetVariantRow {
  variant: 'A' | 'B';
  spec: RenderSpec;
  imageAssetId: string | null;
}

export class ContentAssetService {
  constructor(
    private readonly generation: GenerationService,
    private readonly renderer: ImageRenderer,
    private readonly brand: BrandService,
    private readonly courses: CourseService,
    private readonly personas: PersonaService,
    private readonly campaigns: CampaignService,
    private readonly concepts: ConceptService,
    private readonly approvals: ApprovalService,
    private readonly visuals?: VisualGenerationService,
  ) {}

  /**
   * Produces the content for an approved plan.
   *
   * Every gate is read before anything is generated: approved plan, approved
   * brief, selected concept, approved brand. A missing gate fails with
   * `gate_not_passed` and a Dutch explanation, before any budget is spent.
   */
  /**
   * Pre-enqueue gate for `generate`.
   *
   * Content generation is the most expensive step in the chain — one text call
   * plus two rendered images per channel — so discovering a missing approval
   * only after the job has been accepted and its budget reserved is the worst
   * place to find out.
   */
  async assertCanGenerate(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
  ): Promise<void> {
    requireLabelPermission(user, labelId, 'content:write');
    await this.campaigns.requireById(db, labelId, campaignId);
    await this.campaigns.requireApprovedBrief(db, campaignId);
    await this.concepts.requireSelectedConcept(db, campaignId);
    await this.concepts.requireApprovedPlan(db, campaignId);
    await this.brand.requireCurrent(db, labelId);
    this.visuals?.requireCapability();
  }

  async generate(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      campaignId: string;
      jobId?: string | null;
      attempt?: number;
      signal?: AbortSignal | undefined;
      beforeVisual?: (() => Promise<void>) | undefined;
      /**
       * Reports progress per channel. A content job makes one text call and
       * then renders two images per channel, so without this the user would
       * watch a spinner for the whole run.
       */
      onChannelDone?:
        | ((
            channel: MarketingChannel,
            done: number,
            total: number,
            stage: FunnelStage | null,
          ) => Promise<void>)
        | undefined;
    },
  ): Promise<{ assets: ContentAssetVersion[]; isMock: boolean }> {
    requireLabelPermission(user, input.labelId, 'content:write');

    const campaign = await this.campaigns.requireById(db, input.labelId, input.campaignId);
    const brief = await this.campaigns.requireApprovedBrief(db, input.campaignId);
    const concept = await this.concepts.requireSelectedConcept(db, input.campaignId);
    const { plan } = await this.concepts.requireApprovedPlan(db, input.campaignId);
    const brandProfile = await this.brand.requireCurrent(db, input.labelId);
    const course = await this.courses.requireVersion(db, input.labelId, campaign.courseVersionId);
    const personas = await this.personas.findManyByIds(db, input.labelId, brief.personaVersionIds);

    /*
     * One provider call per funnel stage, not one for everything.
     *
     * Each stage has its own message, its own allowed proof and its own kind
     * of call to action, and the prompt for a stage says exactly that. Writing
     * three stages in one call would put three sets of instructions in front
     * of the model at once — and the result would drift back to the one
     * message on every channel that this whole change exists to remove. It
     * also keeps each answer well inside the output limit and lets progress
     * be reported per stage. Items from a plan made before stages existed
     * form a stage-less group and are written the old way.
     */
    const stored: ContentAssetVersion[] = [];
    const total = plan.items.length;
    let isMock = false;
    for (const group of groupByStage(plan.items)) {
      const channels = group.items.map((item) => item.channel);

      const result = await this.generation.generate(db, {
        template: 'content.generate',
        schema: contentProposalSet,
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
          channelNotes: channelNotes(channels),
          funnelStage: group.stage,
        },
      });
      isMock = isMock || result.isMock;

      /*
       * The answer must be exactly the stage's channels, once each, all for
       * this stage. A model that quietly drops a channel, doubles one or
       * answers for another stage has not done the job, and the failure
       * belongs here — before anything is stored under an asset key.
       */
      const returnedChannels = result.value.items.map((item) => item.channel);
      if (
        returnedChannels.length !== channels.length ||
        new Set(returnedChannels).size !== channels.length ||
        returnedChannels.some((channel) => !channels.includes(channel)) ||
        result.value.items.some((item) => item.stage !== group.stage)
      ) {
        throw new AppError('provider_invalid_output', {
          publicMessage:
            'De AI-inhoud komt niet overeen met de goedgekeurde kanalen en fase. Probeer opnieuw.',
        });
      }

      for (const proposal of result.value.items) {
        const withImage =
          group.items.find((item) => item.channel === proposal.channel)?.withImage ?? true;

        stored.push(
          await this.storeVersion(db, user, {
            labelId: input.labelId,
            campaignId: input.campaignId,
            // The stage is part of the identity: the same channel serves each
            // stage with a different piece, and the versions of each piece
            // must line up under their own key.
            assetKey: assetKeyFor(group.stage, proposal.channel),
            channel: proposal.channel,
            funnelStage: group.stage,
            copy: { ...proposal.copy, ctaUrl: brief.ctaUrl ?? proposal.copy.ctaUrl },
            imageHeadline: proposal.imageHeadline,
            imageSubline: proposal.imageSubline,
            withImage,
            generateVisual: true, beforeVisual: input.beforeVisual, jobId: input.jobId, attempt: input.attempt, signal: input.signal,
            brandProfile,
            concept,
            brief,
            course,
            personaVersionIds: brief.personaVersionIds,
            origin: 'ai_generated',
            promptVersion: result.promptVersion,
          }),
        );

        await input.onChannelDone?.(proposal.channel, stored.length, total, group.stage);
      }
    }

    return { assets: stored, isMock };
  }

  /**
   * Writes one version: renders both variants, then inserts.
   *
   * Rendering happens before the insert so a render failure leaves no
   * half-formed asset row pointing at images that do not exist.
   */
  private async storeVersion(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      campaignId: string;
      assetKey: string;
      channel: MarketingChannel;
      funnelStage: FunnelStage | null;
      copy: ContentCopy;
      imageHeadline: string;
      imageSubline: string | null;
      withImage: boolean;
      brandProfile: Awaited<ReturnType<BrandService['requireApproved']>>;
      concept: Awaited<ReturnType<ConceptService['requireSelectedConcept']>>;
      brief: Awaited<ReturnType<CampaignService['requireApprovedBrief']>>;
      course: Awaited<ReturnType<CourseService['requireVersion']>>;
      personaVersionIds: readonly string[];
      origin: ContentAssetVersion['origin'];
      promptVersion: string | null;
      editedByUserId?: string | null;
      generateVisual?: boolean;
      backgroundAssetId?: string | null | undefined;
      visualInstruction?: string | undefined;
      jobId?: string | null | undefined;
      attempt?: number | undefined;
      signal?: AbortSignal | undefined;
      beforeVisual?: (() => Promise<void>) | undefined;
    },
  ): Promise<ContentAssetVersion> {
    const imageSize = defaultImageSpec(CHANNEL_CONFIG, input.channel, 'single_image');
    const variants: AssetVariantRow[] = [];

    if (input.withImage && imageSize !== undefined) {
      let backgroundAssetId = input.backgroundAssetId ?? null;
      let backgroundPng: Buffer | undefined;
      if (backgroundAssetId && this.visuals) {
        backgroundPng = await this.visuals.load(db, user, input.labelId, backgroundAssetId);
      } else if (input.generateVisual && this.visuals?.enabled) {
        await input.beforeVisual?.();
        const direction = input.concept.artDirection;
        const prompt = [
          'Create a distinctive campaign image with a specific visual idea. Art direction, physical plausibility and material detail matter more than polished stock-photo aesthetics.',
          `Course context: ${input.course.name}. Channel: ${input.channel}.`,
          `Campaign idea: ${input.concept.coreIdea}. Visual intent: ${input.concept.visualApproach}.`,
          direction ? `MEDIUM: ${direction.medium}. SCENE: ${direction.scene}. COMPOSITION: ${direction.composition}. LIGHT: ${direction.lighting}. TREATMENT: ${direction.treatment}. AVOID: ${direction.avoid.join('; ')}.` : '',
          `Approved brief: ${input.brief.coreMessage}. Creative scope: ${input.brief.contentScope}.`,
          `Brand palette accents: ${input.brandProfile.colors.primary}, ${input.brandProfile.colors.accent}. Use selectively, do not tint every surface.`,
          'Show a believable, specific moment or a clear physical metaphor. In photographs: unposed behaviour, natural skin texture, plausible hands, coherent shadows and ordinary material imperfections. Avoid plastic skin, forced smiles, generic meeting scenes, fake bokeh and stock-photo poses.',
          'Keep complete faces, hands and significant objects within the frame, at least 10% from edges. This image has its own space; do not add empty text panels. No lettering, logos, watermarks or pseudo-text.',
          input.brandProfile.portal?.imageInstructions ?? '',
          input.brandProfile.imageUsageNote ?? '',
          input.visualInstruction ?? '',
          `Source versions: ${input.brandProfile.id}, ${input.course.id}, ${input.concept.id}.`,
        ].join('\n');
        const generated = await this.visuals.generate(db, user, { labelId: input.labelId, campaignId: input.campaignId,
          prompt, widthPx: imageSize.widthPx, heightPx: Math.round(imageSize.heightPx * 0.64),
          jobId: input.jobId, attempt: input.attempt, signal: input.signal });
        backgroundAssetId = generated.assetId; backgroundPng = generated.png;
      }
      for (const { variant, layout } of layoutsForVariants(input.concept.visualLayout)) {
        const spec: RenderSpec = {
          layout,
          variant,
          backgroundAssetId,
          ...(input.concept.artDirection ? { visualStyle: input.concept.artDirection.medium } : {}),
          widthPx: imageSize.widthPx,
          heightPx: imageSize.heightPx,
          headline: input.imageHeadline,
          subline: input.imageSubline,
          // Identical CTA across variants, by construction.
          ctaText: input.copy.ctaText,
          logoText: input.brandProfile.logoText,
          colors: {
            background: input.brandProfile.colors.primary,
            foreground: input.brandProfile.colors.onPrimary,
            accent: input.brandProfile.colors.accent,
          },
          headingFamily: input.brandProfile.typography.headingFamily,
          bodyFamily: input.brandProfile.typography.bodyFamily,
        };

        const resources = await loadRenderResources(db, this.renderer.storageRootPath, input.brandProfile);
        const rendered = await this.renderer.render(input.labelId, spec, { ...resources, ...(backgroundPng ? { backgroundPng } : {}) });

        // Reuse an identical image instead of storing a duplicate.
        const existing = await db
          .select({ id: assets.id })
          .from(assets)
          .where(
            and(
              eq(assets.labelId, input.labelId),
              eq(assets.sha256, rendered.sha256),
              eq(assets.kind, 'rendered_image'),
            ),
          )
          .limit(1);

        let imageAssetId = existing[0]?.id ?? null;
        if (imageAssetId === null) {
          const insertedAsset = await db
            .insert(assets)
            .values({
              organizationId: user.organizationId,
              labelId: input.labelId,
              kind: 'rendered_image',
              mimeType: 'image/png',
              byteSize: rendered.byteSize,
              sha256: rendered.sha256,
              storagePath: rendered.storagePath,
              widthPx: rendered.widthPx,
              heightPx: rendered.heightPx,
              createdByUserId: user.userId,
            })
            .returning({ id: assets.id });
          imageAssetId = insertedAsset[0]?.id ?? null;
        }

        variants.push({ variant, spec, imageAssetId });
      }
    }

    /*
     * The format follows what was actually produced.
     *
     * This was hardcoded to `single_image`, which held while every channel was
     * a social post with a picture. It is wrong in two ways once it is not: a
     * landing page has no `single_image` specification at all, so the check
     * fell into the "no specifications recorded" branch and blocked every
     * publish-ready export containing a page — a channel refused for lacking
     * a spec it should never have been asked for. And the `text_only`
     * specification that already existed for LinkedIn was unreachable, because
     * nothing ever selected that format.
     */
    const format: AssetFormat = variants.length > 0 ? 'single_image' : 'text_only';

    const warnings = checkAgainstChannel({
      config: CHANNEL_CONFIG,
      channel: input.channel,
      format,
      body: input.copy.body,
      hasImage: variants.length > 0,
    });

    return db.transaction(async (tx) => {
      const maxRows = await tx
        .select({ max: sql<number | null>`max(${contentAssetVersions.version})` })
        .from(contentAssetVersions)
        .where(
          and(
            eq(contentAssetVersions.campaignId, input.campaignId),
            eq(contentAssetVersions.assetKey, input.assetKey),
          ),
        );

      const inserted = await tx
        .insert(contentAssetVersions)
        .values({
          organizationId: user.organizationId,
          labelId: input.labelId,
          campaignId: input.campaignId,
          assetKey: input.assetKey,
          version: (maxRows[0]?.max ?? 0) + 1,
          channel: input.channel,
          funnelStage: input.funnelStage,
          format,
          language: 'nl',
          copy: input.copy,
          variants,
          briefVersionId: input.brief.id,
          conceptVersionId: input.concept.id,
          brandProfileVersionId: input.brandProfile.id,
          courseVersionId: input.course.id,
          personaVersionIds: [...input.personaVersionIds],
          warnings,
          channelConfigVersion: CHANNEL_CONFIG.version,
          reviewState: 'draft',
          origin: input.origin,
          promptVersion: input.promptVersion,
          editedByUserId: input.editedByUserId ?? null,
          createdByUserId: user.userId,
        })
        .returning();

      const row = inserted[0];
      if (row === undefined) {
        throw new AppError('internal_error', { internalDetail: 'content insert yielded no row' });
      }
      return toAsset(row);
    });
  }

  /** Latest version of every asset in a campaign. */
  async list(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
  ): Promise<ContentAssetVersion[]> {
    requireLabelPermission(user, labelId, 'content:read');
    await this.campaigns.requireById(db, labelId, campaignId);

    const rows = await db
      .select()
      .from(contentAssetVersions)
      .where(eq(contentAssetVersions.campaignId, campaignId))
      .orderBy(desc(contentAssetVersions.version));

    const byKey = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const existing = byKey.get(row.assetKey);
      if (existing === undefined || row.version > existing.version) {
        byKey.set(row.assetKey, row);
      }
    }
    return [...byKey.values()].map(toAsset);
  }

  async listVersions(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
    assetKey: string,
  ): Promise<ContentAssetVersion[]> {
    requireLabelPermission(user, labelId, 'content:read');
    const rows = await db
      .select()
      .from(contentAssetVersions)
      .where(
        and(
          eq(contentAssetVersions.campaignId, campaignId),
          eq(contentAssetVersions.assetKey, assetKey),
          eq(contentAssetVersions.labelId, labelId),
        ),
      )
      .orderBy(desc(contentAssetVersions.version));
    return rows.map(toAsset);
  }

  async findById(db: DbOrTx, labelId: string, id: string): Promise<ContentAssetVersion | undefined> {
    const rows = await db
      .select()
      .from(contentAssetVersions)
      .where(and(eq(contentAssetVersions.id, id), eq(contentAssetVersions.labelId, labelId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toAsset(row);
  }

  async requireById(db: DbOrTx, labelId: string, id: string): Promise<ContentAssetVersion> {
    const found = await this.findById(db, labelId, id);
    if (found === undefined) {
      throw AppError.notFoundOrForbidden('content_asset', id);
    }
    return found;
  }


  /**
   * Optimistic-concurrency guard.
   *
   * Comparing an immutable version row's own number against the echoed token
   * would always succeed, so the real question is asked instead: **is this
   * still the newest version of this asset?** If someone else saved in the
   * meantime, a newer row exists and the edit is refused rather than silently
   * forking off an older version.
   */
  private async requireLatestVersion(
    db: DbOrTx,
    asset: ContentAssetVersion,
    expectedVersion: number,
  ): Promise<void> {
    if (asset.version !== expectedVersion) {
      throw AppError.staleVersion('content_asset');
    }
    const rows = await db
      .select({ max: sql<number | null>`max(${contentAssetVersions.version})` })
      .from(contentAssetVersions)
      .where(
        and(
          eq(contentAssetVersions.campaignId, asset.campaignId),
          eq(contentAssetVersions.assetKey, asset.assetKey),
        ),
      );
    const latest = rows[0]?.max ?? asset.version;
    if (latest !== asset.version) {
      throw AppError.staleVersion('content_asset');
    }
  }

  /**
   * Direct text editing.
   *
   * `expectedVersion` is the optimistic-concurrency token: if someone else
   * saved in between, this fails with `stale_version` rather than overwriting
   * their work.
   */
  async editCopy(
    db: Db,
    user: CurrentUser,
    labelId: string,
    assetId: string,
    input: ContentEditInput,
  ): Promise<ContentAssetVersion> {
    requireLabelPermission(user, labelId, 'content:write');
    const current = await this.requireById(db, labelId, assetId);
    await this.requireLatestVersion(db, current, input.expectedVersion);

    const merged = contentCopy.parse({ ...current.copy, ...input.copy });
    const context = await this.contextFor(db, labelId, current);

    return this.storeVersion(db, user, {
      labelId,
      campaignId: current.campaignId,
      assetKey: current.assetKey,
      channel: current.channel,
      funnelStage: current.funnelStage,
      copy: merged,
      imageHeadline: current.variants[0]?.spec.headline ?? merged.hook,
      imageSubline: current.variants[0]?.spec.subline ?? null,
      withImage: current.variants.length > 0,
      ...context,
      personaVersionIds: current.personaVersionIds,
      origin: 'user',
      backgroundAssetId: current.variants[0]?.spec.backgroundAssetId,
      promptVersion: current.promptVersion,
      // Records that a person wrote this, so a later regeneration warns.
      editedByUserId: user.userId,
    });
  }

  /**
   * Checks the revision guards without doing any work.
   *
   * Called by the route before enqueueing, so a stale version or an
   * unconfirmed overwrite of a hand edit is answered immediately with a 409
   * rather than discovered later as a failed job. The handler checks the same
   * conditions again at run time, because state can change in between.
   */
  async assertRevisable(
    db: Db,
    user: CurrentUser,
    labelId: string,
    assetId: string,
    input: { expectedVersion: number; scope?: ContentReviseInput['scope']; acceptOverwritingUserEdit?: boolean | undefined },
  ): Promise<void> {
    requireLabelPermission(user, labelId, 'content:write');
    const current = await this.requireById(db, labelId, assetId);
    await this.requireLatestVersion(db, current, input.expectedVersion);

    if (input.scope !== 'images' && current.editedByUserId !== null && input.acceptOverwritingUserEdit !== true) {
      throw new AppError('conflict', {
        publicMessage:
          'Deze content is met de hand aangepast. Bevestig dat de AI-herziening jouw wijzigingen mag overschrijven, of pas de tekst zelf aan.',
        context: { assetId, version: current.version },
      });
    }
  }

  /**
   * AI revision of **one** asset, from the user's own instruction.
   *
   * Refuses to overwrite a hand-edited version unless the caller passes
   * `acceptOverwritingUserEdit`. That is the "user edits must not disappear
   * silently" requirement, enforced rather than documented.
   */
  async revise(
    db: Db,
    user: CurrentUser,
    labelId: string,
    assetId: string,
    input: ContentReviseInput & {
      acceptOverwritingUserEdit?: boolean | undefined;
      jobId?: string | null | undefined;
      attempt?: number | undefined;
      signal?: AbortSignal | undefined;
      beforeVisual?: (() => Promise<void>) | undefined;
    },
  ): Promise<ContentAssetVersion> {
    requireLabelPermission(user, labelId, 'content:write');
    const current = await this.requireById(db, labelId, assetId);
    await this.requireLatestVersion(db, current, input.expectedVersion);

    if (input.scope !== 'images' && current.editedByUserId !== null && input.acceptOverwritingUserEdit !== true) {
      throw new AppError('conflict', {
        publicMessage:
          'Deze content is met de hand aangepast. Bevestig dat de AI-herziening jouw wijzigingen mag overschrijven, of pas de tekst zelf aan.',
        context: { assetId, version: current.version },
      });
    }

    const campaign = await this.campaigns.requireById(db, labelId, current.campaignId);
    const context = await this.contextFor(db, labelId, current);
    const personas = await this.personas.findManyByIds(db, labelId, current.personaVersionIds);

    if (input.scope === 'images') {
      return this.storeVersion(db, user, {
        labelId, campaignId: current.campaignId, assetKey: current.assetKey, channel: current.channel,
        funnelStage: current.funnelStage, copy: current.copy, imageHeadline: current.variants[0]?.spec.headline ?? current.copy.hook,
        imageSubline: current.variants[0]?.spec.subline ?? null, withImage: current.variants.length > 0,
        ...context, personaVersionIds: current.personaVersionIds, origin: 'ai_generated',
        generateVisual: true, visualInstruction: input.instructionNl, beforeVisual: input.beforeVisual,
        jobId: input.jobId, attempt: input.attempt, signal: input.signal,
        promptVersion: current.promptVersion, editedByUserId: current.editedByUserId,
      });
    }

    const result = await this.generation.generate(db, {
      signal: input.signal,
      template: 'content.revise',
      schema: contentProposalSet,
      organizationId: user.organizationId,
      labelId,
      jobId: input.jobId ?? null,
      attempt: input.attempt ?? 0,
      context: {
        language: campaign.contentLanguage,
        course: context.course,
        brand: context.brandProfile,
        personas,
        brief: context.brief,
        concept: context.concept,
        channels: [current.channel],
        channelNotes: channelNotes([current.channel]),
        // The revision stays in the piece's stage: the same message, proof
        // and CTA rules apply to the rewrite as to the original.
        funnelStage: current.funnelStage,
        revisionInstruction: input.instructionNl,
        existingCopy: {
          hook: current.copy.hook,
          body: current.copy.body,
          ctaText: current.copy.ctaText,
        },
      },
    });

    const revised = result.value.items[0];
    if (revised === undefined) {
      throw new AppError('provider_invalid_output', {
        publicMessage: 'De herziening leverde geen content op. Er is niets gewijzigd.',
      });
    }

    return this.storeVersion(db, user, {
      labelId,
      campaignId: current.campaignId,
      assetKey: current.assetKey,
      channel: current.channel,
      funnelStage: current.funnelStage,
      copy: revised.copy,
      imageHeadline:
        input.scope === 'copy'
          ? current.variants[0]?.spec.headline ?? revised.imageHeadline
          : revised.imageHeadline,
      imageSubline: revised.imageSubline,
      withImage: current.variants.length > 0,
      ...context,
      personaVersionIds: current.personaVersionIds,
      origin: 'ai_generated',
      generateVisual: input.scope !== 'copy',
      backgroundAssetId: input.scope === 'copy' ? current.variants[0]?.spec.backgroundAssetId : null,
      visualInstruction: input.instructionNl, beforeVisual: input.beforeVisual, jobId: input.jobId, attempt: input.attempt, signal: input.signal,
      promptVersion: result.promptVersion,
      editedByUserId: null,
    });
  }

  async approve(
    db: Db,
    user: CurrentUser,
    labelId: string,
    assetId: string,
    noteNl: string | null,
  ): Promise<ContentAssetVersion> {
    requireLabelPermission(user, labelId, 'content:approve');

    return db.transaction(async (tx) => {
      const target = await this.requireById(tx, labelId, assetId);

      // Approving out of `needs_rereview` is allowed — a person looking again
      // is exactly what that state asks for — and the previous state is
      // recorded in the audit metadata so the decision stays reconstructable.
      await tx
        .update(contentAssetVersions)
        .set({ reviewState: 'approved' })
        .where(eq(contentAssetVersions.id, assetId));

      await this.approvals.approve(tx, user, {
        labelId,
        artefactType: 'content_asset',
        artefactId: assetId,
        artefactVersion: target.version,
        noteNl:
          target.reviewState === 'needs_rereview'
            ? `${noteNl ?? ''} (opnieuw beoordeeld na wijziging in een onderliggende bron)`.trim()
            : noteNl,
      });

      return this.requireById(tx, labelId, assetId);
    });
  }

  /**
   * Flags every asset whose dependencies moved on.
   *
   * Called after a brand or course version is approved. Only *unpublished*
   * drafts and approvals are flagged; nothing is republished and nothing is
   * changed on the user's behalf.
   */
  async flagStaleForLabel(db: Db, labelId: string): Promise<number> {
    const flagged = await db
      .update(contentAssetVersions)
      .set({ reviewState: 'needs_rereview' })
      .where(
        and(
          eq(contentAssetVersions.labelId, labelId),
          sql`${contentAssetVersions.reviewState} IN ('draft', 'approved')`,
          sql`(
            ${contentAssetVersions.brandProfileVersionId} NOT IN (
              SELECT id FROM brand_profile_versions
              WHERE label_id = ${labelId} AND review_state = 'approved'
            )
            OR ${contentAssetVersions.courseVersionId} NOT IN (
              SELECT id FROM course_versions
              WHERE label_id = ${labelId} AND review_state = 'approved'
            )
          )`,
        ),
      )
      .returning({ id: contentAssetVersions.id });
    return flagged.length;
  }

  /** Loads the provenance a new version must carry forward. */
  private async contextFor(
    db: DbOrTx,
    labelId: string,
    asset: ContentAssetVersion,
  ): Promise<{
    brandProfile: Awaited<ReturnType<BrandService['requireApproved']>>;
    concept: Awaited<ReturnType<ConceptService['requireSelectedConcept']>>;
    brief: Awaited<ReturnType<CampaignService['requireApprovedBrief']>>;
    course: Awaited<ReturnType<CourseService['requireVersion']>>;
  }> {
    const brandProfile = await this.brand.requireCurrent(db, labelId);
    const concept = await this.concepts.findById(db, labelId, asset.conceptVersionId);
    const course = await this.courses.findVersion(db, labelId, asset.courseVersionId);
    const brief = await this.campaigns.latestBrief(db, asset.campaignId);

    if (
      brandProfile === undefined ||
      concept === undefined ||
      course === undefined ||
      brief === undefined
    ) {
      throw new AppError('dependency_changed', {
        publicMessage:
          'Een onderliggende bron van deze content bestaat niet meer. Beoordeel de campagne opnieuw.',
        context: { assetId: asset.id },
      });
    }
    return { brandProfile, concept, course, brief };
  }
}

/**
 * Plan items grouped by stage, in journey order, stage-less items last.
 *
 * Only groups that have items are returned, so a conversion campaign makes
 * one call and a full-funnel campaign three.
 */
function groupByStage(
  items: readonly ContentPlan['items'][number][],
): { stage: FunnelStage | null; items: ContentPlan['items'][number][] }[] {
  const order: (FunnelStage | null)[] = [...FUNNEL_STAGES, null];
  return order
    .map((stage) => ({ stage, items: items.filter((item) => item.stage === stage) }))
    .filter((group) => group.items.length > 0);
}

/**
 * The stable identity of one piece of content.
 *
 * `${stage}-${channel}-1` for staged content; `${channel}-1`, the historical
 * key, when the plan had no stages — so content made before this existed keeps
 * its version history under the key it always had.
 */
function assetKeyFor(stage: FunnelStage | null, channel: MarketingChannel): string {
  return stage === null ? `${channel}-1` : `${stage}-${channel}-1`;
}

/** Channel guidance, phrased for the prompt. */
function channelNotes(channels: readonly MarketingChannel[]): string[] {
  return channels.flatMap((channel) => {
    const spec = CHANNEL_CONFIG.formats.find(
      (item) => item.channel === channel && item.format === 'single_image',
    );
    if (spec === undefined) {
      return [`${CHANNEL_LABEL_NL[channel]}: geen specificaties vastgelegd; houd de tekst kort.`];
    }
    const notes: string[] = [];
    const limit = spec.guidance.bodyMaxCharsWithMedia ?? spec.guidance.bodyMaxChars;
    if (limit !== null) {
      notes.push(`${CHANNEL_LABEL_NL[channel]}: maximaal ${String(limit)} tekens.`);
    }
    if (spec.guidance.bodyTruncatesAtChars !== null) {
      notes.push(
        `${CHANNEL_LABEL_NL[channel]}: tekst wordt afgekort na circa ${String(spec.guidance.bodyTruncatesAtChars)} tekens; zet de kern vooraan.`,
      );
    }
    return notes;
  });
}

interface AssetRow {
  id: string;
  campaignId: string;
  assetKey: string;
  version: number;
  channel: string;
  funnelStage?: string | null;
  format: string;
  language: string;
  copy: unknown;
  variants: unknown;
  briefVersionId: string;
  conceptVersionId: string;
  brandProfileVersionId: string;
  courseVersionId: string;
  personaVersionIds: unknown;
  warnings: unknown;
  channelConfigVersion: number;
  reviewState: string;
  origin: string;
  promptVersion: string | null;
  editedByUserId: string | null;
  createdAt: Date;
}

/**
 * Maps a stored row to the shape the product speaks.
 *
 * The one non-obvious part: `warnings` are **recomputed** from the current
 * channel config rather than read back from the row. The stored ones are the
 * verdict at the time the asset was made, and they go stale the moment a
 * channel's specification is verified or changes — which happened: a stored
 * warning kept saying "cannot be exported publish-ready" while the export,
 * reading the current config, no longer blocked on it. The interface and the
 * gate disagreed, and a user would have believed the interface.
 *
 * Recomputing means the two can never disagree. `channelConfigVersion` keeps
 * the history answerable.
 */
function toAsset(row: AssetRow): ContentAssetVersion {
  const copy = contentCopy.parse(row.copy);
  const variants = (row.variants ?? []) as ContentAssetVersion['variants'];

  return {
    id: row.id,
    campaignId: row.campaignId,
    assetKey: row.assetKey,
    version: row.version,
    channel: row.channel as MarketingChannel,
    funnelStage: (row.funnelStage ?? null) as FunnelStage | null,
    format: row.format as ContentAssetVersion['format'],
    language: row.language as ContentAssetVersion['language'],
    copy,
    variants,
    briefVersionId: row.briefVersionId,
    conceptVersionId: row.conceptVersionId,
    brandProfileVersionId: row.brandProfileVersionId,
    courseVersionId: row.courseVersionId,
    personaVersionIds: (row.personaVersionIds ?? []) as string[],
    warnings: checkAgainstChannel({
      config: CHANNEL_CONFIG,
      channel: row.channel as MarketingChannel,
      format: row.format as ContentAssetVersion['format'],
      body: copy.body,
      hasImage: variants.length > 0,
    }),
    channelConfigVersion: row.channelConfigVersion,
    reviewState: row.reviewState as ReviewState,
    origin: row.origin as ContentAssetVersion['origin'],
    promptVersion: row.promptVersion,
    editedByUserId: row.editedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}
