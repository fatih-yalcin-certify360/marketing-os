import { randomUUID } from 'node:crypto';
import type { VisualGenerationService } from '../../core/ai/visuals.js';
import { loadRenderResources } from '../../core/render/brand-resources.js';
import { creativeTextZone, creativeSourceZones, resolveCreativePalette, CreativeContrastError, CreativeTextOverflowError } from '../../core/render/creative-layouts.js';
import { creativeImagePrompt, creativeProblems, repeatedCreativeScenes, SOCIAL_IMAGE_CHANNELS } from './creative.js';
import { prepareCreativeResearch } from './creative-research.js';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { googleAdsFrameText,
  CHANNEL_CONFIG,
  CHANNEL_LABEL_NL,
  channelWarning,
  checkAgainstChannel,
  contentCopy,
  type AssetFormat,
  contentProposalSet,
  defaultImageSpec,
  imageEncodingFor,
  lengthGuidanceFor,
  stageMessageFor,
  statableFacts,
  FUNNEL_STAGES,
  FUNNEL_STAGE_LABEL_NL,
  imageIsClickable,
  type ActorRef,
  type ArtDirection,
  type BriefKeyword,
  type ChannelWarning,
  type ContentAssetVersion,
  type ContentProposal,
  type ContentCopy,
  type ContentOriginKind,
  type ContentEditInput,
  type ContentPlan,
  type ContentReviseInput,
  type CurrentUser,
  type FunnelStage,
  type LearningWithEvidence,
  type MarketingChannel,
  type RenderSpec,
  type SocialCreativeBrief,
  type CreativeResearchSnapshot,
  type ReviewState,
} from '@c360/contracts';
import { learningsForPrompt } from '../learnings/service.js';
import type { CoursePageText } from './course-page.js';
import {
  CONTEXT_WARNING_KINDS,
  LONG_FORM_CHANNELS,
  WEBSITE_CHANNELS,
  MIN_ARTICLE_WORDS,
  checkCopyContext,
  checkCopyShape,
  repairableProblems,
  type CopyContext,
} from './quality.js';
import type { Db, DbOrTx } from '../../core/db/types.js';
import { assets, campaigns, contentAssetVersions, courseVersions, labels, users } from '../../core/db/schema.js';
import { buildDossier, type Dossier } from './dossier.js';
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

/**
 * What the render layer needs to know about the creative behind one image.
 *
 * A campaign piece fills this from its chosen concept and its approved brief; a
 * standalone piece fills it from the requester's own instruction. Keeping it a
 * separate shape is what stops the second case from having to fake a concept
 * row: `concept_version_id` stays null, because there is no concept.
 */
interface VisualDescriptor {
  layout: 'bold_statement' | 'split_panel' | 'quiet_editorial';
  artDirection: ArtDirection | null;
  coreIdea: string;
  visualApproach: string;
  coreMessage: string;
  contentScope: string;
  /** Which version the image can be traced back to, for the prompt's audit line. */
  sourceRef: string;
}

/**
 * The creative descriptor for a loose piece.
 *
 * Every field is the requester's own sentence or the course it is about —
 * nothing is invented. There is no art direction, so the model is left to
 * propose the scene through the creative brief it returns with the copy, which
 * is the same route a campaign piece takes when its concept has none.
 *
 * `quiet_editorial` is the default layout because it is the one that reads
 * acceptably with any subject: a loose piece has no concept that argued for a
 * bolder composition.
 */
function standaloneVisual(angleNl: string, courseName: string): VisualDescriptor {
  return {
    layout: 'quiet_editorial',
    artDirection: null,
    coreIdea: angleNl,
    visualApproach: angleNl,
    coreMessage: angleNl,
    contentScope: `Losse uiting over ${courseName}, zonder campagnebriefing.`,
    sourceRef: 'losse-uiting',
  };
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
    /** Approved learnings, when the deployment has them; see `ConceptService`. */
    private readonly learnings?: {
      approvedForPrompt(db: Db, labelId: string): Promise<LearningWithEvidence[]>;
    },
    /**
     * Reads the live course page for the website piece; null when the page
     * cannot be read, and the article form is then the only one allowed.
     * Absent in tests that do not reach the network.
     */
    private readonly coursePage?: (courseUrl: string | null) => Promise<CoursePageText | null>,
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
     * One call per stage for the posts and adverts, and one call per page or
     * mail.
     *
     * Each stage has its own message, proof and kind of call to action, so a
     * stage is never mixed with another. Within a stage the website piece and
     * the e-mail each get a call of their own: they are long, and a long piece
     * sharing one output budget with four posts came out as two lines. Items
     * from a plan made before stages existed form a stage-less group.
     *
     * What every call also receives: the briefing's search phrases, the live
     * course page (read once), and the hook and opening of every piece the
     * campaign already has — so the next piece can be told what not to
     * repeat, and checked against it.
     */
    const stored: ContentAssetVersion[] = [];
    // What the plan actually promises. This counted plan *cells*, so a plan of
    // "LinkedIn ×4, Instagram ×3" reported "2 items" and produced two files
    // while the calendar showed seven moments (audit 2026-09-15).
    const total = plan.items.reduce((sum, item) => sum + item.count, 0);
    let isMock = false;
    const learnings = learningsForPrompt(
      (await this.learnings?.approvedForPrompt(db, input.labelId)) ?? [],
    );
    const coursePage = (await this.coursePage?.(course.courseUrl ?? null)) ?? null;
    /*
     * A change proposal without the page it changes is not refused here.
     *
     * Before the split the model silently wrote an article instead when the
     * course page could not be read, so a plan cell that said "opleidingspagina"
     * produced a blog and nobody was told (audit 2026-09-15). Since the channel
     * *is* the deliverable that substitution can no longer happen: the form must
     * match the channel. What remains is the page itself, which may be
     * unreachable for a minute or for good — and refusing the whole run over a
     * temporarily unreachable website would be worse than the problem. The
     * piece is made and carries `page_unavailable`, which blocks a
     * publish-ready export until someone has looked.
     */
    const existingAssets = await this.list(db, user, input.labelId, input.campaignId);
    const previous: PreviousPiece[] = existingAssets.map(pieceSummary);
    const imageChannels = [...new Set(plan.items.filter(item => item.withImage && SOCIAL_IMAGE_CHANNELS.has(item.channel)).map(item => item.channel))];
    const creativeResearch = imageChannels.length === 0 ? null : await prepareCreativeResearch(db, {
      labelId: input.labelId, campaign, brief, concept, brandProfile, course, personas,
      channels: imageChannels, coursePage,
      previousSnapshots: existingAssets.flatMap(asset => asset.variants.flatMap(variant => variant.spec.creativeResearch ? [variant.spec.creativeResearch] : [])),
      fetchPage: this.coursePage, signal: input.signal,
    });
    const shared = {
      labelId: input.labelId,
      campaignId: input.campaignId,
      jobId: input.jobId ?? null,
      attempt: input.attempt ?? 0,
      signal: input.signal,
      language: campaign.contentLanguage,
      course,
      brandProfile,
      personas,
      brief,
      concept,
      learnings,
      coursePage,
      creativeResearch,
    };
    for (const group of groupByStage(plan.items)) {
      /*
       * One round per repeat the plan asks for.
       *
       * Round `r` carries only the cells that want more than `r` pieces, so a
       * plan of "LinkedIn ×4, Instagram ×1" makes four LinkedIn posts and one
       * Instagram post rather than four of each. Each stored piece is appended
       * to `previous` before the next round, which is what stops the second
       * LinkedIn post from repeating the first: the model is told what the
       * campaign already says and the house-style check refuses a repeat.
       */
      const rounds = Math.max(...group.items.map((item) => item.count));
      for (let piece = 1; piece <= rounds; piece += 1) {
        const dueThisRound = group.items.filter((item) => item.count >= piece);
        for (const batch of splitBatches(dueThisRound)) {
        const generated = await this.generateBatch(db, user, {
          ...shared,
          stage: group.stage,
          items: batch,
          piece,
          previous,
        });
        isMock = isMock || generated.isMock;

        for (const proposal of generated.proposals) {
          const withImage = batch.find((item) => item.channel === proposal.channel)?.withImage ?? true;
          const asset = await this.storeVersion(db, user, {
            labelId: input.labelId,
            campaignId: input.campaignId,
            // The stage is part of the identity: the same channel serves each
            // stage with a different piece, and the versions of each piece
            // must line up under their own key.
            assetKey: assetKeyFor(group.stage, proposal.channel, piece),
            channel: proposal.channel,
            funnelStage: group.stage,
            copy: { ...proposal.copy, ctaUrl: brief.ctaUrl ?? proposal.copy.ctaUrl ?? course.courseUrl },
            imageHeadline: proposal.imageHeadline,
            imageSubline: proposal.imageSubline,
            creativeBrief: proposal.creativeBrief,
            creativeResearch: creativeResearch ?? undefined,
            withImage,
            generateVisual: true,
            beforeVisual: input.beforeVisual,
            jobId: input.jobId,
            attempt: input.attempt,
            signal: input.signal,
            brandProfile,
            concept,
            brief,
            course,
            personaVersionIds: brief.personaVersionIds,
            origin: 'ai_generated',
            promptVersion: generated.promptVersion,
            contextWarnings: generated.contextWarnings.get(proposal.channel) ?? [],
          });
          stored.push(asset);
          // The next piece of this run is checked against this one too.
          previous.push(pieceSummary(asset));
          await input.onChannelDone?.(proposal.channel, stored.length, total, group.stage);
        }
        }
      }
    }

    return { assets: stored, isMock };
  }

  /**
   * One generation call for a set of channels of one stage, with one repair.
   *
   * The answer is checked before anything is stored: exactly the requested
   * channels for exactly this stage (a model that drops or doubles a channel
   * has not done the job), then the house-style checks in `quality.ts`. A
   * problem the model can fix — a page below its minimum, a post without
   * hashtags, a change that quotes text the page does not have, a piece that
   * repeats another — goes back once as `<herstelpunten>`; a second failure
   * is a provider error with the problems named, and nothing is stored thin.
   * Warnings a person should see but the model need not fix (a recited fact,
   * a missing keyword) travel with the piece.
   */
  private async generateBatch(
    db: Db,
    user: CurrentUser,
    args: {
      labelId: string;
      campaignId: string;
      jobId: string | null;
      attempt: number;
      signal: AbortSignal | undefined;
      language: ContentAssetVersion['language'];
      course: Awaited<ReturnType<CourseService['requireVersion']>>;
      brandProfile: Awaited<ReturnType<BrandService['requireApproved']>>;
      personas: Awaited<ReturnType<PersonaService['findManyByIds']>>;
      brief: Awaited<ReturnType<CampaignService['requireApprovedBrief']>>;
      concept: Awaited<ReturnType<ConceptService['requireSelectedConcept']>>;
      learnings: ReturnType<typeof learningsForPrompt>;
      coursePage: CoursePageText | null;
      creativeResearch: CreativeResearchSnapshot | null;
      stage: FunnelStage | null;
      items: readonly ContentPlan['items'][number][];
      /** Which piece of the cell this call makes; see `assetKeyFor`. */
      piece: number;
      previous: readonly PreviousPiece[];
    },
  ): Promise<{
    proposals: ContentProposal[];
    promptVersion: string;
    isMock: boolean;
    contextWarnings: Map<MarketingChannel, ChannelWarning[]>;
  }> {
    const channels = args.items.map((item) => item.channel);
    const ownKeys = new Set(channels.map((channel) => assetKeyFor(args.stage, channel, args.piece)));
    // Earlier versions of the very pieces being rewritten are not "other"
    // pieces: a regeneration may resemble what it replaces.
    const others = args.previous.filter((piece) => !ownKeys.has(piece.assetKey));
    const courseFacts = statableFacts(args.course).map((fact) => fact.value);
    let repairNotes: string[] = [];

    for (let round = 0; round < 2; round += 1) {
      const result = await this.generation.generate(db, {
        template: 'content.generate',
        schema: contentProposalSet,
        organizationId: user.organizationId,
        labelId: args.labelId,
        jobId: args.jobId,
        attempt: args.attempt,
        signal: args.signal,
        context: {
          language: args.language,
          course: args.course,
          brand: args.brandProfile,
          personas: args.personas,
          brief: args.brief,
          concept: args.concept,
          channels,
          channelNotes: channelNotes(channels),
          funnelStage: args.stage,
          /*
           * The briefing's own message for this stage, when it has one. Its
           * proof fields are resolved against the course card in the prompt
           * builder, so only facts confirmed now are quoted. A brief from
           * before stage messages existed has none, and the stage guidance
           * alone leads, as it did.
           */
          stageMessage:
            args.stage === null ? null : stageMessageFor(args.brief.stageMessages, args.stage) ?? null,
          learnings: args.learnings,
          keywords: args.brief.keywords,
          coursePage: args.coursePage,
          googleAdsFrame:
            args.stage !== null && channels.includes('google_search_ads') ? googleAdsFrameText(args.stage) : null,
          creativeResearch: args.items.some(item => item.withImage && SOCIAL_IMAGE_CHANNELS.has(item.channel)) ? args.creativeResearch : null,
          previousPieces: others.map((piece) => ({ label: piece.label, hook: piece.hook, opening: piece.opening, visualIdea: piece.visualIdea })),
          piece: { number: args.piece, of: Math.max(...args.items.map((item) => item.count)) },
          repairNotes,
        },
      });

      /*
       * The answer must be exactly the batch's channels, once each, all for
       * this stage. A model that quietly drops a channel, doubles one or
       * answers for another stage has not done the job, and the failure
       * belongs here — before anything is stored under an asset key.
       */
      const returned = result.value.items.map((item) => item.channel);
      if (
        returned.length !== channels.length ||
        new Set(returned).size !== channels.length ||
        returned.some((channel) => !channels.includes(channel)) ||
        result.value.items.some((item) => item.stage !== args.stage)
      ) {
        throw new AppError('provider_invalid_output', {
          publicMessage:
            'De AI-inhoud komt niet overeen met de goedgekeurde kanalen en fase. Probeer opnieuw.',
        });
      }

      const problems: string[] = repeatedCreativeScenes(result.value.items.filter(item => args.items.some(planned => planned.channel === item.channel && planned.withImage)));
      const contextWarnings = new Map<MarketingChannel, ChannelWarning[]>();
      for (const proposal of result.value.items) {
        const withImage = args.items.find((item) => item.channel === proposal.channel)?.withImage ?? true;
        problems.push(...creativeProblems(proposal, withImage, args.creativeResearch).map(message => `${CHANNEL_LABEL_NL[proposal.channel]}: ${message}`));
        const shape = checkCopyShape({ copy: proposal.copy, channel: proposal.channel, withImage });
        const siblings = result.value.items
          .filter((item) => item.channel !== proposal.channel)
          .map((item) => ({
            label: `${CHANNEL_LABEL_NL[item.channel]} (${stageLabel(item.stage)})`,
            hook: item.copy.hook,
            body: item.copy.body,
          }));
        const context: CopyContext = {
          keywords: args.brief.keywords.map((keyword: BriefKeyword) => keyword.phrase),
          courseFacts,
          courseName: args.course.name,
          // What an article may cite: the personas' groundings and the course page.
          allowedSourceRefs: [
            ...args.personas.flatMap((persona) => persona.grounding.map((item) => item.sourceRef)),
            ...(args.coursePage === null ? [] : [args.coursePage.url]),
          ],
          pageText: args.coursePage?.text ?? null,
          otherPieces: [...others.map((piece) => ({ label: piece.label, hook: piece.hook, body: piece.body })), ...siblings],
        };
        const contextual = checkCopyContext({ copy: proposal.copy, channel: proposal.channel, context });
        contextWarnings.set(proposal.channel, contextual);
        const websiteMissing =
          WEBSITE_CHANNELS.has(proposal.channel) && proposal.copy.website === null
            ? [
                proposal.channel === 'blog_article'
                  ? 'Vul website volledig in met form "blog_article": titel, metabeschrijving, secties, FAQ en de interne link.'
                  : 'Vul website volledig in met form "course_page_update": de pagina-URL en per wijziging de plek, de reden, de huidige passage en de voorgestelde tekst.',
              ]
            : [];
        problems.push(
          ...[...repairableProblems(proposal.channel, [...shape, ...contextual]), ...websiteMissing].map(
            (message) => `${CHANNEL_LABEL_NL[proposal.channel]}: ${message}`,
          ),
        );
      }

      if (problems.length === 0) {
        return {
          proposals: result.value.items,
          promptVersion: result.promptVersion,
          isMock: result.isMock,
          contextWarnings,
        };
      }
      if (round === 0) {
        repairNotes = problems;
        continue;
      }
      throw new AppError('provider_invalid_output', {
        publicMessage:
          'De AI-content haalt ook na een herstelronde de vereiste tekstvorm of beeldbrief niet. Voor dit onderdeel is niets opgeslagen; probeer het opnieuw.',
        internalDetail: problems.join(' | '),
        context: { stage: args.stage ?? 'none', channels: channels.join(',') },
      });
    }
    throw new AppError('internal_error', { internalDetail: 'content batch loop ended without a result' });
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
      /** Null for a standalone piece; `ownerScope` follows from it. */
      campaignId: string | null;
      /** Where a standalone piece came from; ignored for a campaign piece. */
      standaloneOrigin?: { kind: ContentOriginKind; refId: string | null } | undefined;
      /**
       * The sentence a loose piece was written from, kept with the piece.
       *
       * Passed on by every path that writes a new version of an existing
       * piece, so an edit or a revision does not lose what the piece was asked
       * to be (migration 0030).
       */
      instructionNl?: string | null | undefined;
      assetKey: string;
      channel: MarketingChannel;
      funnelStage: FunnelStage | null;
      copy: ContentCopy;
      imageHeadline: string;
      imageSubline: string | null;
      creativeBrief?: SocialCreativeBrief | null | undefined;
      creativeResearch?: CreativeResearchSnapshot | undefined;
      withImage: boolean;
      brandProfile: Awaited<ReturnType<BrandService['requireApproved']>>;
      /** Null for a standalone piece, which has neither (migration 0029). */
      concept: Awaited<ReturnType<ConceptService['requireSelectedConcept']>> | null;
      brief: Awaited<ReturnType<CampaignService['requireApprovedBrief']>> | null;
      /**
       * What the render layer needs to know about the creative, for a piece
       * that has no stored concept and no approved brief to read it from.
       *
       * A campaign piece leaves this out and the descriptor is derived from its
       * concept and brief. A standalone piece supplies it from what it does
       * have: the requester's own instruction and the course card. The
       * alternative — handing `storeVersion` a made-up concept object — would
       * have written a `concept_version_id` pointing at a row that does not
       * exist (2026-09-15).
       */
      visual?: VisualDescriptor | undefined;
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
      /** Context checks from generation, stored with the piece; see `quality.ts`. */
      contextWarnings?: readonly ChannelWarning[] | undefined;
    },
  ): Promise<ContentAssetVersion> {
    const imageSize = defaultImageSpec(CHANNEL_CONFIG, input.channel, 'single_image');
    // The channel registry says which formats the platform accepts; until
    // 2026-09-15 it said 'jpeg' for Instagram while we stored PNG regardless,
    // so the file could not be uploaded at all.
    const encoding = imageEncodingFor(CHANNEL_CONFIG, input.channel, 'single_image');
    const variants: AssetVariantRow[] = [];

    /*
     * The creative a render needs: a layout, an art direction, the idea behind
     * the campaign and the message it has to carry.
     *
     * A campaign piece has all four in its chosen concept and approved brief. A
     * standalone piece has neither and brings the same four itself, so an
     * Instagram post made outside a campaign gets a real image instead of being
     * silently text-only (2026-09-15).
     */
    const visual: VisualDescriptor | null =
      input.visual ??
      (input.concept !== null && input.brief !== null
        ? {
            layout: input.concept.visualLayout,
            artDirection: input.concept.artDirection,
            coreIdea: input.concept.coreIdea,
            visualApproach: input.concept.visualApproach,
            coreMessage: input.brief.coreMessage,
            contentScope: input.brief.contentScope,
            sourceRef: input.concept.id,
          }
        : null);

    if (input.withImage && imageSize !== undefined && visual !== null) {
      // Resolve the current brand's real files before spending on a new scene.
      const resources = await loadRenderResources(db, this.renderer.storageRootPath, input.brandProfile);
      const specs = layoutsForVariants(visual.layout).map(({ variant, layout }) => {
        const spec: RenderSpec = {
          layout,
          variant,
          backgroundAssetId: null,
          ...(input.creativeBrief ? { creativeBrief: input.creativeBrief } : {}),
          ...(input.creativeResearch ? { creativeResearch: input.creativeResearch } : {}),
          ...(visual.artDirection ? { visualStyle: visual.artDirection.medium } : {}),
          widthPx: imageSize.widthPx,
          heightPx: imageSize.heightPx,
          headline: input.imageHeadline,
          subline: input.imageSubline,
          /*
           * The call to action goes into the picture only where the picture is
           * a link.
           *
           * On an organic post the image is not a click target — tapping it
           * opens the post, and the destination lives in the caption. Drawing
           * "Bekijk de opleiding →" into it is an instruction the viewer cannot
           * follow, with an arrow pointing at nothing (2026-09-16). The call to
           * action stays in the copy, where it *is* followable; a paid single
           * image is the click target and keeps it (`CLICKABLE_IMAGE_CHANNELS`).
           *
           * Identical across variants, by construction.
           */
          ctaText: imageIsClickable(input.channel) ? input.copy.ctaText : null,
          logoText: input.brandProfile.logoText,
          colors: {
            background: input.brandProfile.colors.primary,
            foreground: input.brandProfile.colors.onPrimary,
            accent: input.brandProfile.colors.accent,
            surface: input.brandProfile.colors.surface,
            onSurface: input.brandProfile.colors.onSurface,
          },
          headingFamily: resources.headingFamily ?? input.brandProfile.typography.headingFamily,
          bodyFamily: resources.bodyFamily ?? input.brandProfile.typography.bodyFamily,
          fontSource: resources.fontFiles.length > 0 ? 'brand_files' : 'system_fallback',
        };

        if (spec.creativeBrief) {
          try { spec.colorResolution = resolveCreativePalette(spec); }
          catch (error) {
            if (error instanceof CreativeContrastError) throw new AppError('bad_request', { publicMessage: error.message });
            throw error;
          }
        }
        return spec;
      });

      let backgroundAssetId = input.backgroundAssetId ?? null;
      let backgroundPng: Buffer | undefined;
      if (backgroundAssetId && this.visuals) {
        backgroundPng = await this.visuals.load(db, user, input.labelId, backgroundAssetId);
      } else if (input.generateVisual && this.visuals?.enabled) {
        await input.beforeVisual?.();
        const direction = visual.artDirection;
        const nativeFrame = this.visuals.requestDimensions(imageSize.widthPx, imageSize.heightPx);
        const prompt = input.creativeBrief ? creativeImagePrompt({
          courseName: input.course.name, channel: input.channel, stage: input.funnelStage,
          campaignIdea: visual.coreIdea, visualApproach: visual.visualApproach,
          medium: direction?.medium ?? 'conceptual', lighting: direction?.lighting ?? 'Intentional, believable lighting',
          treatment: direction?.treatment ?? 'Tactile detail appropriate to the concept',
          coreMessage: visual.coreMessage, contentScope: visual.contentScope,
          headline: input.imageHeadline, subline: input.imageSubline,
          creativeBrief: { ...input.creativeBrief, avoid: [...input.creativeBrief.avoid, ...(direction?.avoid ?? [])] },
          creativeResearch: input.creativeResearch,
          brand: input.brandProfile, widthPx: imageSize.widthPx, heightPx: imageSize.heightPx,
          textZone: creativeTextZone(imageSize.widthPx, imageSize.heightPx, input.creativeBrief.textPosition),
          nativeFrame,
          sourceZones: creativeSourceZones(imageSize.widthPx, imageSize.heightPx, nativeFrame.widthPx, nativeFrame.heightPx, input.creativeBrief.textPosition),
          revision: input.visualInstruction,
        }) : [
          'Create a distinctive campaign image with a specific visual idea. Art direction, physical plausibility and material detail matter more than polished stock-photo aesthetics.',
          `Course context: ${input.course.name}. Channel: ${input.channel}.`,
          `Campaign idea: ${visual.coreIdea}. Visual intent: ${visual.visualApproach}.`,
          direction ? `MEDIUM: ${direction.medium}. SCENE: ${direction.scene}. COMPOSITION: ${direction.composition}. LIGHT: ${direction.lighting}. TREATMENT: ${direction.treatment}. AVOID: ${direction.avoid.join('; ')}.` : '',
          `Approved brief: ${visual.coreMessage}. Creative scope: ${visual.contentScope}.`,
          `Brand palette accents: ${input.brandProfile.colors.primary}, ${input.brandProfile.colors.accent}. Use selectively, do not tint every surface.`,
          'Show a believable, specific moment or a clear physical metaphor. In photographs: unposed behaviour, natural skin texture, plausible hands, coherent shadows and ordinary material imperfections. Avoid plastic skin, forced smiles, generic meeting scenes, fake bokeh and stock-photo poses.',
          'Keep complete faces, hands and significant objects within the frame, at least 10% from edges. This image has its own space; do not add empty text panels. No lettering, logos, watermarks or pseudo-text.',
          input.brandProfile.portal?.imageInstructions ?? '',
          input.brandProfile.imageUsageNote ?? '',
          input.visualInstruction ?? '',
          `Source versions: ${input.brandProfile.id}, ${input.course.id}, ${visual.sourceRef}.`,
        ].join('\n');
        const generated = await this.visuals.generate(db, user, { labelId: input.labelId, campaignId: input.campaignId ?? undefined,
          prompt, widthPx: imageSize.widthPx, heightPx: input.creativeBrief ? imageSize.heightPx : Math.round(imageSize.heightPx * 0.64),
          jobId: input.jobId, attempt: input.attempt, signal: input.signal });
        backgroundAssetId = generated.assetId; backgroundPng = generated.png;
      }
      for (const spec of specs) {
        spec.backgroundAssetId = backgroundAssetId;
        const variant = spec.variant;
        const rendered = await this.renderer.render(input.labelId, spec, { ...resources, encoding, ...(backgroundPng ? { backgroundPng } : {}) }).catch((error: unknown) => {
          if (error instanceof CreativeContrastError || error instanceof CreativeTextOverflowError) {
            throw new AppError('bad_request', { publicMessage: error.message });
          }
          throw error;
        });
        if (rendered.colorResolution) spec.colorResolution = rendered.colorResolution;

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
              mimeType: rendered.mimeType,
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

    const warnings: ChannelWarning[] = [
      ...checkAgainstChannel({
        config: CHANNEL_CONFIG,
        channel: input.channel,
        format,
        body: publishedText(input.copy, input.channel),
        hasImage: variants.length > 0,
      }),
      ...checkCopyShape({ copy: input.copy, channel: input.channel, withImage: variants.length > 0 }),
      ...(input.contextWarnings ?? []),
    ];

    return db.transaction(async (tx) => {
      const maxRows = await tx
        .select({ max: sql<number | null>`max(${contentAssetVersions.version})` })
        .from(contentAssetVersions)
        .where(
          and(
            // Version numbers run per campaign, or per label for a standalone
            // piece — the two partial unique indexes of migration 0029.
            input.campaignId === null
              ? eq(contentAssetVersions.labelId, input.labelId)
              : eq(contentAssetVersions.campaignId, input.campaignId),
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
          briefVersionId: input.brief?.id ?? null,
          conceptVersionId: input.concept?.id ?? null,
          brandProfileVersionId: input.brandProfile.id,
          courseVersionId: input.course.id,
          // The database holds the invariant: `owner_scope = 'campaign'` and a
          // campaign id are true together or false together (migration 0029).
          ownerScope: input.campaignId === null ? 'standalone' : 'campaign',
          originKind: input.campaignId === null ? input.standaloneOrigin?.kind ?? 'manual' : null,
          originRefId: input.campaignId === null ? input.standaloneOrigin?.refId ?? null : null,
          instructionNl: input.instructionNl ?? null,
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

  /**
   * One piece of content that belongs to no campaign.
   *
   * The reason this exists: the AI-visibility research already writes a blog
   * proposal and a course-page change, and both stayed a field in a JSON report
   * with no version, no review state and no export. A marketer who wanted one
   * supporting piece had to invent a whole campaign around it (audit
   * 2026-09-15).
   *
   * What it keeps from the campaign path, deliberately: a confirmed course
   * version, an approved brand version, the same house-style and channel
   * checks, the same review state and the same version history. What it drops:
   * the briefing, the concept and the channel plan — the three artefacts that
   * exist to keep *a campaign* coherent. The grounding in the course card and
   * the brand is what makes a piece without them safe to write.
   *
   * Text only for now. A rendered image needs the concept's layout and the
   * briefing's core message, and imagery is the internal tool's job
   * (Edumotion); a standalone image is the next slice, not a half-rendering.
   */
  /**
   * One piece outside any campaign.
   *
   * The requester's own sentence is the whole instruction, so it travels into
   * the prompt as the idea, the visual intent and the message. For a channel
   * that carries an image the model is asked for a creative brief in the same
   * call, and the piece is rendered exactly the way a campaign piece is — two
   * variants, the label's own colours, the wordmark set by our renderer.
   */
  async generateStandalone(
    db: Db,
    user: CurrentUser,
    input: {
      labelId: string;
      courseVersionId: string;
      channel: MarketingChannel;
      funnelStage: FunnelStage | null;
      /** What the piece should be about, in the requester's own words. */
      angleNl: string;
      /** The audience to write for, or null to write for the course in general. */
      personaVersionId?: string | null | undefined;
      origin: { kind: ContentOriginKind; refId: string | null };
      ctaUrl?: string | null | undefined;
      signal?: AbortSignal | undefined;
      jobId?: string | null | undefined;
      attempt?: number | undefined;
      /** Checked before the expensive image call, so a cancel is honoured. */
      beforeVisual?: (() => Promise<void>) | undefined;
      onProgress?: ((percent: number, message: string) => Promise<void>) | undefined;
    },
  ): Promise<ContentAssetVersion> {
    requireLabelPermission(user, input.labelId, 'content:write');

    const course = await this.courses.requireVersion(db, input.labelId, input.courseVersionId);
    const brandProfile = await this.brand.requireApproved(db, input.labelId);
    const coursePage = (await this.coursePage?.(course.courseUrl ?? null)) ?? null;
    const learnings = learningsForPrompt((await this.learnings?.approvedForPrompt(db, input.labelId)) ?? []);
    /*
     * The audience, when one was chosen.
     *
     * Loaded through the same lookup the campaign path uses, so a persona of
     * another label cannot be written for: `findManyByIds` is scoped to the
     * label. An unknown or foreign id yields an empty list, and the piece is
     * then written for the course in general rather than silently for somebody
     * else's audience.
     */
    const personas =
      input.personaVersionId === null || input.personaVersionId === undefined
        ? []
        : await this.personas.findManyByIds(db, input.labelId, [input.personaVersionId]);
    if ((input.personaVersionId ?? null) !== null && personas.length === 0) {
      throw AppError.notFoundOrForbidden('persona_version', input.personaVersionId ?? '');
    }

    // Existing standalone pieces of this label, so the next one differs from
    // them the way campaign pieces differ from each other.
    const previous = (await this.listStandalone(db, user, input.labelId)).map(pieceSummary);

    let repairNotes: readonly string[] = [];
    for (let round = 0; round < 2; round += 1) {
      const result = await this.generation.generate(db, {
        template: 'content.generate',
        schema: contentProposalSet,
        organizationId: user.organizationId,
        labelId: input.labelId,
        signal: input.signal,
        context: {
          language: 'nl',
          course,
          brand: brandProfile,
          personas,
          channels: [input.channel],
          channelNotes: channelNotes([input.channel]),
          funnelStage: input.funnelStage,
          learnings,
          coursePage,
          // No briefing and no concept: the standalone path has neither, and
          // both are optional in the prompt context by design.
          userIdea: input.angleNl,
          previousPieces: previous.map((piece) => ({
            label: piece.label,
            hook: piece.hook,
            opening: piece.opening,
            visualIdea: piece.visualIdea,
          })),
          repairNotes,
        },
      });

      const proposal = result.value.items[0];
      if (proposal?.channel !== input.channel) {
        throw new AppError('provider_invalid_output', {
          publicMessage: 'De AI leverde geen stuk voor het gevraagde kanaal. Probeer het opnieuw.',
          internalDetail: `expected ${input.channel}, got ${proposal?.channel ?? 'nothing'}`,
        });
      }

      // An image channel gets an image. The channel registry decides, the same
      // way the campaign path decides it.
      const withImage = SOCIAL_IMAGE_CHANNELS.has(input.channel);
      const shape = checkCopyShape({ copy: proposal.copy, channel: input.channel, withImage });
      const contextual = checkCopyContext({
        copy: proposal.copy,
        channel: input.channel,
        context: {
          keywords: [],
          courseFacts: statableFacts(course).map((fact) => fact.value),
          courseName: course.name,
          pageText: coursePage === null ? null : coursePage.text,
          otherPieces: previous,
        },
      });
      const problems = repairableProblems(input.channel, [...shape, ...contextual]);
      if (problems.length > 0 && round === 0) {
        repairNotes = problems;
        continue;
      }
      if (problems.length > 0) {
        throw new AppError('provider_invalid_output', {
          publicMessage:
            'De AI-content haalt ook na een herstelronde de vereiste tekstvorm niet. Er is niets opgeslagen; probeer het opnieuw.',
          internalDetail: problems.join(' | '),
        });
      }

      await input.onProgress?.(withImage ? 55 : 85, withImage ? 'Tekst klaar; beeld wordt gemaakt' : 'Tekst klaar');

      return this.storeVersion(db, user, {
        labelId: input.labelId,
        campaignId: null,
        standaloneOrigin: input.origin,
        // Unique within the label, which is what the standalone partial index
        // enforces; the channel is in the key so a list reads at a glance.
        assetKey: `los-${input.channel}-${randomUUID().slice(0, 8)}`,
        instructionNl: input.angleNl,
        channel: input.channel,
        funnelStage: input.funnelStage,
        copy: { ...proposal.copy, ctaUrl: input.ctaUrl ?? proposal.copy.ctaUrl ?? course.courseUrl },
        imageHeadline: proposal.imageHeadline,
        imageSubline: proposal.imageSubline,
        creativeBrief: proposal.creativeBrief,
        withImage,
        generateVisual: withImage,
        brandProfile,
        // No stored concept and no approved brief exist for a loose piece; the
        // descriptor carries what the render layer needs, and the two version
        // columns stay null because there is nothing for them to point at.
        concept: null,
        brief: null,
        ...(withImage ? { visual: standaloneVisual(input.angleNl, course.name) } : {}),
        ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
        ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
        ...(input.beforeVisual === undefined ? {} : { beforeVisual: input.beforeVisual }),
        course,
        personaVersionIds: personas.map((persona) => persona.id),
        origin: 'ai_generated',
        promptVersion: result.promptVersion,
        contextWarnings: contextual,
      });
    }
    throw new AppError('internal_error', { internalDetail: 'standalone generation fell through' });
  }

  /**
   * Every standalone piece of a label, latest version first.
   *
   * A separate method rather than a flag on `list`, because `list` starts by
   * requiring a campaign and every one of its callers has one.
   */
  async listStandalone(db: Db, user: CurrentUser, labelId: string): Promise<ContentAssetVersion[]> {
    requireLabelPermission(user, labelId, 'content:read');
    const rows = await db
      .select()
      .from(contentAssetVersions)
      .where(and(eq(contentAssetVersions.labelId, labelId), isNull(contentAssetVersions.campaignId)))
      .orderBy(desc(contentAssetVersions.version));

    const byKey = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const existing = byKey.get(row.assetKey);
      if (existing === undefined || row.version > existing.version) byKey.set(row.assetKey, row);
    }
    return [...byKey.values()].filter((row) => row.reviewState !== 'archived').map(toAsset);
  }

  /**
   * Attaches a standalone piece to a campaign.
   *
   * Not exclusive and not destructive in the way HubSpot's is, where adding an
   * asset to one campaign silently removes it from another (market research,
   * 2026-09-15): a piece has no campaign until it is given one, and giving it
   * one is a deliberate act with an audit line behind it.
   */
  async attachToCampaign(
    db: Db,
    user: CurrentUser,
    labelId: string,
    assetId: string,
    campaignId: string,
  ): Promise<ContentAssetVersion> {
    requireLabelPermission(user, labelId, 'content:write');
    const campaign = await this.campaigns.requireById(db, labelId, campaignId);
    const current = await this.requireById(db, labelId, assetId);
    if (current.campaignId !== null) {
      throw new AppError('conflict', {
        publicMessage: 'Deze uiting hoort al bij een campagne.',
        context: { assetId, campaignId: current.campaignId },
      });
    }
    if (current.courseVersionId !== campaign.courseVersionId) {
      throw new AppError('conflict', {
        publicMessage:
          'Deze uiting hoort bij een andere opleiding dan de campagne. Koppelen zou de onderbouwing van het stuk losmaken van waar het over gaat.',
        context: { assetId, campaignId },
      });
    }

    await db
      .update(contentAssetVersions)
      .set({ campaignId, ownerScope: 'campaign' })
      .where(and(eq(contentAssetVersions.labelId, labelId), eq(contentAssetVersions.assetKey, current.assetKey)));
    return this.requireById(db, labelId, assetId);
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
    // A withdrawn piece is out of the campaign but stays in the database with
    // its approvals intact: `archived` is the whole point of withdrawing, and
    // hard-deleting would take the audit trail with it (2026-09-15).
    return [...byKey.values()].filter((row) => row.reviewState !== 'archived').map(toAsset);
  }

  /**
   * Withdraws a piece from the campaign.
   *
   * There was no way at all to remove content. That mattered because three
   * producible channels can never be exported publish-ready — their platform
   * specifications are not verified against a primary source — so one generated
   * e-mail blocked every publish-ready export of that campaign for good, with
   * no way out (audit 2026-09-15).
   *
   * Every version of the piece is archived, not deleted, so approvals and the
   * export history keep pointing at something real. Generating again creates a
   * new piece under the same key; `storeVersion` counts versions over all rows,
   * so numbering keeps rising.
   */
  async withdraw(
    db: Db,
    user: CurrentUser,
    labelId: string,
    campaignId: string,
    assetId: string,
  ): Promise<{ assetKey: string; archivedVersions: number }> {
    requireLabelPermission(user, labelId, 'content:write');
    await this.campaigns.requireById(db, labelId, campaignId);

    return db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(contentAssetVersions)
        .where(
          and(
            eq(contentAssetVersions.id, assetId),
            eq(contentAssetVersions.labelId, labelId),
            eq(contentAssetVersions.campaignId, campaignId),
          ),
        )
        .limit(1);
      const target = rows[0];
      if (target === undefined) {
        throw AppError.notFoundOrForbidden('content', assetId);
      }

      const archived = await tx
        .update(contentAssetVersions)
        .set({ reviewState: 'archived' })
        .where(
          and(
            eq(contentAssetVersions.campaignId, campaignId),
            eq(contentAssetVersions.assetKey, target.assetKey),
          ),
        )
        .returning({ id: contentAssetVersions.id });

      return { assetKey: target.assetKey, archivedVersions: archived.length };
    });
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
   * Everything about one piece, assembled as a document.
   *
   * Gathered here rather than in the route because it is five reads that have
   * to agree with each other, and because every one of them is scoped to the
   * label: the piece, its course, its audiences, its campaign and the person
   * who asked for it. An id that belongs to another label reads as absent, the
   * same as anywhere else.
   *
   * The reads that can come back empty do not fail the document. A user who
   * has since been removed, a campaign that was renamed away — the dossier
   * says "niet vastgelegd" and stays useful, because a missing name is not a
   * reason to refuse somebody the text they wrote.
   */
  async dossierFor(
    db: DbOrTx,
    user: CurrentUser,
    labelId: string,
    assetId: string,
    generatedAt: string,
  ): Promise<Dossier> {
    requireLabelPermission(user, labelId, 'content:read');
    const asset = await this.requireById(db, labelId, assetId);

    const [labelRow] = await db
      .select({ name: labels.name })
      .from(labels)
      .where(eq(labels.id, labelId))
      .limit(1);
    const [courseRow] = await db
      .select({
        name: courseVersions.name,
        externalCode: courseVersions.externalCode,
        courseUrl: courseVersions.courseUrl,
      })
      .from(courseVersions)
      .where(and(eq(courseVersions.id, asset.courseVersionId), eq(courseVersions.labelId, labelId)))
      .limit(1);

    const personas = await this.personas.findManyByIds(db, labelId, asset.personaVersionIds);

    /*
     * Every author in one query.
     *
     * The person who asked for the piece and the people who wrote its
     * audiences are all rows of the same table, and looking them up one at a
     * time would be a query per persona for a document nobody builds twice.
     */
    const authorIds = [
      ...new Set(
        [asset.createdByUserId, ...personas.map((persona) => persona.createdByUserId)].filter(
          (id): id is string => id !== null,
        ),
      ),
    ];
    const byUserId = new Map<string, { displayName: string; email: string }>();
    if (authorIds.length > 0) {
      const rows = await db
        .select({ id: users.id, displayName: users.displayName, email: users.email })
        .from(users)
        .where(and(inArray(users.id, authorIds), eq(users.organizationId, user.organizationId)));
      for (const row of rows) byUserId.set(row.id, { displayName: row.displayName, email: row.email });
    }
    /** A recorded author we can no longer name is still a recorded author. */
    const actorFor = (id: string | null): ActorRef | null => {
      if (id === null) return null;
      const found = byUserId.get(id);
      return found === undefined
        ? { userId: id, displayName: 'Onbekende gebruiker', email: null }
        : { userId: id, ...found };
    };
    const createdBy = asset.createdByUserId === null ? null : byUserId.get(asset.createdByUserId) ?? null;

    let campaignName: string | null = null;
    if (asset.campaignId !== null) {
      const [row] = await db
        .select({ name: campaigns.name })
        .from(campaigns)
        .where(and(eq(campaigns.id, asset.campaignId), eq(campaigns.labelId, labelId)))
        .limit(1);
      campaignName = row?.name ?? null;
    }

    return buildDossier({
      asset,
      label: { name: labelRow?.name ?? 'Onbekend label' },
      course: {
        name: courseRow?.name ?? 'Onbekende opleiding',
        externalCode: courseRow?.externalCode ?? null,
        courseUrl: courseRow?.courseUrl ?? null,
      },
      personas: personas.map((persona) => ({
        version: persona,
        createdBy: actorFor(persona.createdByUserId),
      })),
      createdBy,
      campaignName,
      generatedAt,
    });
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
    labelId: string,
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
          // A standalone piece is unique per label, a campaign piece per
          // campaign — the two partial indexes of migration 0029.
          asset.campaignId === null
            ? eq(contentAssetVersions.labelId, labelId)
            : eq(contentAssetVersions.campaignId, asset.campaignId),
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
    await this.requireLatestVersion(db, labelId, current, input.expectedVersion);

    const merged = contentCopy.parse({ ...current.copy, ...input.copy });
    const context = await this.contextFor(db, labelId, current);

    return this.storeVersion(db, user, {
      labelId,
      campaignId: current.campaignId,
      assetKey: current.assetKey,
      instructionNl: current.instructionNl,
      channel: current.channel,
      funnelStage: current.funnelStage,
      copy: merged,
      contextWarnings: carriedContextWarnings(current, merged, context.course, context.brief),
      imageHeadline: current.variants[0]?.spec.headline ?? merged.hook,
      imageSubline: current.variants[0]?.spec.subline ?? null,
      creativeBrief: current.variants[0]?.spec.creativeBrief,
      creativeResearch: current.variants[0]?.spec.creativeResearch,
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
    await this.requireLatestVersion(db, labelId, current, input.expectedVersion);

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
    await this.requireLatestVersion(db, labelId, current, input.expectedVersion);

    if (input.scope !== 'images' && current.editedByUserId !== null && input.acceptOverwritingUserEdit !== true) {
      throw new AppError('conflict', {
        publicMessage:
          'Deze content is met de hand aangepast. Bevestig dat de AI-herziening jouw wijzigingen mag overschrijven, of pas de tekst zelf aan.',
        context: { assetId, version: current.version },
      });
    }

    if (current.campaignId === null) {
      throw new AppError('capability_unavailable', {
        publicMessage:
          'Een losse uiting heeft geen briefing en geen concept om tegen te herschrijven. Pas de tekst met de hand aan, of koppel de uiting eerst aan een campagne.',
        context: { assetId },
      });
    }
    const campaign = await this.campaigns.requireById(db, labelId, current.campaignId);
    const context = await this.contextFor(db, labelId, current);
    // `revise` refuses a standalone piece above, so a campaign piece always has
    // both; narrowing here keeps that promise visible rather than implied.
    const { brief: reviseBrief, concept: reviseConcept } = context;
    if (reviseBrief === null || reviseConcept === null) {
      throw new AppError('dependency_changed', {
        publicMessage: 'Een onderliggende bron van deze content bestaat niet meer. Beoordeel de campagne opnieuw.',
        context: { assetId },
      });
    }
    const personas = await this.personas.findManyByIds(db, labelId, current.personaVersionIds);

    if (input.scope === 'images') {
      return this.storeVersion(db, user, {
        labelId, campaignId: current.campaignId, assetKey: current.assetKey, channel: current.channel,
        instructionNl: current.instructionNl,
        funnelStage: current.funnelStage, copy: current.copy, imageHeadline: current.variants[0]?.spec.headline ?? current.copy.hook,
        imageSubline: current.variants[0]?.spec.subline ?? null, withImage: current.variants.length > 0,
        creativeBrief: current.variants[0]?.spec.creativeBrief,
        creativeResearch: current.variants[0]?.spec.creativeResearch,
        ...context, personaVersionIds: current.personaVersionIds, origin: 'ai_generated',
        generateVisual: true, visualInstruction: input.instructionNl, beforeVisual: input.beforeVisual,
        jobId: input.jobId, attempt: input.attempt, signal: input.signal,
        promptVersion: current.promptVersion, editedByUserId: current.editedByUserId,
      });
    }

    const previousResearch = current.variants[0]?.spec.creativeResearch;
    const creativeResearch = input.scope === 'both' && current.variants.length > 0 && SOCIAL_IMAGE_CHANNELS.has(current.channel)
      ? await prepareCreativeResearch(db, {
        labelId, campaign, brandProfile: context.brandProfile, course: context.course,
        brief: reviseBrief, concept: reviseConcept, personas,
        channels: previousResearch?.channels.map(item => item.channel) ?? [current.channel],
        coursePage: (await this.coursePage?.(context.course.courseUrl ?? null)) ?? null,
        previousSnapshots: previousResearch ? [previousResearch] : [],
        fetchPage: this.coursePage, signal: input.signal,
      }) : previousResearch;
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
        stageMessage:
          current.funnelStage === null
            ? null
            : stageMessageFor(reviseBrief.stageMessages, current.funnelStage) ?? null,
        revisionInstruction: input.instructionNl,
        // The whole piece, not three fields: a revision of a page that cannot
        // see its own sections rewrites them blind.
        existingCopy: current.copy,
        existingCreativeBrief: current.variants[0]?.spec.creativeBrief ?? null,
        // A copy-only rewrite preserves the historical image dossier but
        // must not pass its old brand rules as current copy instructions.
        creativeResearch: input.scope === 'copy' ? null : creativeResearch ?? null,
        keywords: reviseBrief.keywords,
      },
    });

    const revised = result.value.items[0];
    if (revised === undefined || result.value.items.length !== 1 || revised.channel !== current.channel || revised.stage !== current.funnelStage) {
      throw new AppError('provider_invalid_output', {
        publicMessage: 'De herziening moet precies één voorstel voor dit kanaal en deze funnelfase bevatten. Er is niets gewijzigd.',
      });
    }

    if (input.scope === 'both') {
      const problems = creativeProblems(revised, current.variants.length > 0, creativeResearch);
      if (problems.length > 0) throw new AppError('provider_invalid_output', {
        publicMessage: 'De herziening bevat geen bruikbare creatieve beeldbrief of beeldtekst. Het bestaande beeld is behouden.',
        internalDetail: problems.join(' | '),
      });
    }

    return this.storeVersion(db, user, {
      labelId,
      campaignId: current.campaignId,
      assetKey: current.assetKey,
      instructionNl: current.instructionNl,
      channel: current.channel,
      funnelStage: current.funnelStage,
      copy: revised.copy,
      contextWarnings: carriedContextWarnings(current, revised.copy, context.course, context.brief),
      imageHeadline:
        input.scope === 'copy'
          ? current.variants[0]?.spec.headline ?? revised.imageHeadline
          : revised.imageHeadline,
      imageSubline: input.scope === 'copy' ? current.variants[0]?.spec.subline ?? null : revised.imageSubline,
      creativeBrief: input.scope === 'copy' ? current.variants[0]?.spec.creativeBrief : revised.creativeBrief,
      creativeResearch,
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
   * Called from inside the approve transaction of a course or a brand version
   * (wired in `server.ts`), so the flag lands in the same commit that archives
   * the version the asset rested on. Only *unpublished* drafts and approvals
   * are flagged; nothing is republished and nothing is changed on the user's
   * behalf.
   *
   * Until 2026-09-15 this method had no caller at all: approving a new course
   * card or brand version silently left approved content resting on a version
   * that no longer existed, and the person only found out at the export gate.
   */
  async flagStaleForLabel(db: DbOrTx, labelId: string): Promise<number> {
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
    /** Null for a standalone piece, which has neither (migration 0029). */
    concept: Awaited<ReturnType<ConceptService['requireSelectedConcept']>> | null;
    brief: Awaited<ReturnType<CampaignService['requireApprovedBrief']>> | null;
    course: Awaited<ReturnType<CourseService['requireVersion']>>;
  }> {
    const brandProfile = await this.brand.requireCurrent(db, labelId);
    const concept =
      asset.conceptVersionId === null
        ? undefined
        : await this.concepts.findById(db, labelId, asset.conceptVersionId);
    const course = await this.courses.findVersion(db, labelId, asset.courseVersionId);
    const brief = asset.campaignId === null ? undefined : await this.campaigns.latestBrief(db, asset.campaignId);

    /*
     * A campaign piece must still find all four; a standalone piece has no
     * briefing and no concept to find, and losing one that never existed is
     * not a changed dependency (migration 0029).
     */
    const standalone = asset.campaignId === null;
    if (
      brandProfile === undefined ||
      course === undefined ||
      (!standalone && (concept === undefined || brief === undefined))
    ) {
      throw new AppError('dependency_changed', {
        publicMessage:
          'Een onderliggende bron van deze content bestaat niet meer. Beoordeel de campagne opnieuw.',
        context: { assetId: asset.id },
      });
    }
    return { brandProfile, concept: concept ?? null, course, brief: brief ?? null };
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
 * `${stage}-${channel}-${n}` for staged content; `${channel}-${n}`, the
 * historical key, when the plan had no stages — so content made before this
 * existed keeps its version history under the key it always had.
 *
 * `n` is the piece's place within its cell. It was pinned to 1 until
 * 2026-09-15, which is why a plan of "LinkedIn ×4" produced one LinkedIn post:
 * every repeat wrote over the same key.
 */
function assetKeyFor(stage: FunnelStage | null, channel: MarketingChannel, piece = 1): string {
  return stage === null ? `${channel}-${String(piece)}` : `${stage}-${channel}-${String(piece)}`;
}

/**
 * Channel guidance, phrased for the prompt: the minimum as well as the
 * maximum. This used to look up the `single_image` spec only, so a page, a
 * mail or an advert — all `text_only` — fell through to "geen specificaties
 * vastgelegd; houd de tekst kort": an explicit instruction to keep the
 * long-form channels short. That is how a two-line landing page was made.
 */
function channelNotes(channels: readonly MarketingChannel[]): string[] {
  return channels.flatMap((channel) => {
    const label = CHANNEL_LABEL_NL[channel];
    const spec =
      CHANNEL_CONFIG.formats.find((item) => item.channel === channel && item.format === 'single_image') ??
      CHANNEL_CONFIG.formats.find((item) => item.channel === channel);
    const rules = lengthGuidanceFor(channel);
    const notes: string[] = [];
    if (rules.minBodyWords !== null) {
      notes.push(`${label}: body minimaal ${String(rules.minBodyWords)} woorden — een bericht met een gedachte, geen regel.`);
    }
    if (rules.minTotalWords !== null) {
      notes.push(
        `${label}: ${String(rules.minSections ?? 0)} tot ${String(rules.maxSections ?? 0)} secties van minimaal ${String(rules.minSectionWords ?? 0)} woorden; inleiding en secties samen minimaal ${String(rules.minTotalWords)} woorden.`,
      );
    }
    if (channel === 'blog_article' || channel === 'landing_page') {
      notes.push(`${label}: een blogartikel telt minimaal ${String(MIN_ARTICLE_WORDS)} woorden.`);
    }
    if (channel === 'course_page_update' || channel === 'landing_page') {
      notes.push(
        `${label}: minimaal 80 woorden per wijziging, en citeer als huidige passage alleen tekst die werkelijk op de pagina staat.`,
      );
    }
    notes.push(
      rules.maxHashtags > 0
        ? `${label}: ${String(rules.minHashtags)} tot ${String(rules.maxHashtags)} hashtags, elk één woord zonder spaties.`
        : `${label}: geen hashtags.`,
    );
    const limit = spec?.guidance.bodyMaxCharsWithMedia ?? spec?.guidance.bodyMaxChars ?? null;
    if (limit !== null) {
      notes.push(`${label}: body maximaal ${String(limit)} tekens.`);
    }
    if (spec?.guidance.bodyTruncatesAtChars != null) {
      notes.push(
        `${label}: tekst wordt afgekort na circa ${String(spec.guidance.bodyTruncatesAtChars)} tekens; zet de kern vooraan.`,
      );
    }
    return notes;
  });
}

/**
 * Posts and adverts of a stage in one call; every page or mail alone.
 *
 * Order within the stage: the long pieces first, so their hooks are known
 * when the posts are written and the posts can be told not to repeat them.
 */
function splitBatches(
  items: readonly ContentPlan['items'][number][],
): ContentPlan['items'][number][][] {
  const long = items.filter((item) => LONG_FORM_CHANNELS.has(item.channel)).map((item) => [item]);
  const short = items.filter((item) => !LONG_FORM_CHANNELS.has(item.channel));
  return short.length > 0 ? [...long, short] : long;
}

/** What a later piece is told about, and checked against, of an earlier one. */
interface PreviousPiece {
  assetKey: string;
  label: string;
  hook: string;
  opening: string;
  body: string;
  visualIdea: string;
}

function stageLabel(stage: FunnelStage | null): string {
  return stage === null ? 'zonder fase' : FUNNEL_STAGE_LABEL_NL[stage];
}

function pieceSummary(asset: ContentAssetVersion): PreviousPiece {
  return {
    assetKey: asset.assetKey,
    label: `${CHANNEL_LABEL_NL[asset.channel]} (${stageLabel(asset.funnelStage)})`,
    hook: asset.copy.hook,
    opening: asset.copy.body.slice(0, 200),
    body: asset.copy.body,
    visualIdea: asset.variants[0]?.spec.creativeBrief?.scene ?? '',
  };
}

/**
 * The context warnings a hand edit or a revision carries.
 *
 * What can be re-judged from what the service has here — the recited fact,
 * the keywords — is re-judged, so a person who fixes a problem sees it go.
 * What needs the live page or the other pieces is carried from the version
 * being replaced, because the edit did not change what it was judged against.
 */
/**
 * What a reader actually sees in the post, for the channel's length check.
 *
 * The check measured `copy.body` alone, while the hook is the first line of
 * the post and the hashtags sit under it — both published text, both counted
 * by the platform, neither counted by us (audit 2026-09-15). A page, a mail
 * and an advertisement are not posts: their body is the text and their other
 * fields have their own rules, so they are measured unchanged.
 */
const POST_CHANNELS: ReadonlySet<MarketingChannel> = new Set<MarketingChannel>([
  'linkedin_organic',
  'instagram_organic',
  'facebook_organic',
]);

function publishedText(copy: Pick<ContentCopy, 'hook' | 'body' | 'hashtags'>, channel: MarketingChannel): string {
  if (!POST_CHANNELS.has(channel)) {
    return copy.body;
  }
  const tags = copy.hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ');
  return [copy.hook, copy.body, tags].filter((part) => part.trim().length > 0).join('\n\n');
}

function carriedContextWarnings(
  current: ContentAssetVersion,
  copy: ContentCopy,
  course: Awaited<ReturnType<CourseService['requireVersion']>>,
  /** Null for a standalone piece, which has no briefing and so no phrases. */
  brief: Awaited<ReturnType<CampaignService['requireApprovedBrief']>> | null,
): ChannelWarning[] {
  const rejudged = checkCopyContext({
    copy,
    channel: current.channel,
    context: {
      keywords: brief?.keywords.map((keyword) => keyword.phrase) ?? [],
      courseFacts: statableFacts(course).map((fact) => fact.value),
      courseName: course.name,
      // Not re-fetched here; the page checks are carried instead.
      pageText: copy.website?.form === 'course_page_update' ? '' : null,
      otherPieces: [],
    },
  }).filter((warning) => warning.kind === 'keywords_missing' || warning.kind === 'copied_fact_sentence');
  const carried = current.warnings.filter(
    (warning) =>
      warning.kind === 'repeated_across_pieces' ||
      warning.kind === 'page_excerpt_not_found' ||
      warning.kind === 'page_unavailable',
  );
  return [...rejudged, ...carried];
}

interface AssetRow {
  id: string;
  campaignId: string | null;
  ownerScope?: string | null;
  originKind?: string | null;
  originRefId?: string | null;
  instructionNl?: string | null;
  assetKey: string;
  version: number;
  channel: string;
  funnelStage?: string | null;
  format: string;
  language: string;
  copy: unknown;
  variants: unknown;
  briefVersionId: string | null;
  conceptVersionId: string | null;
  brandProfileVersionId: string;
  courseVersionId: string;
  personaVersionIds: unknown;
  warnings: unknown;
  channelConfigVersion: number;
  reviewState: string;
  origin: string;
  promptVersion: string | null;
  editedByUserId: string | null;
  createdByUserId?: string | null;
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
    ownerScope: (row.ownerScope ?? 'campaign') as ContentAssetVersion['ownerScope'],
    originKind: (row.originKind ?? null) as ContentAssetVersion['originKind'],
    originRefId: row.originRefId ?? null,
    instructionNl: row.instructionNl ?? null,
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
    /*
     * Channel and shape checks recomputed now; context checks read back from
     * the row, because they were judged against the page, the briefing and
     * the other pieces as they were at generation. Unknown kinds from older
     * rows are dropped, not failed.
     */
    warnings: [
      ...checkAgainstChannel({
        config: CHANNEL_CONFIG,
        channel: row.channel as MarketingChannel,
        format: row.format as ContentAssetVersion['format'],
        body: publishedText(copy, row.channel as MarketingChannel),
        hasImage: variants.length > 0,
      }),
      ...checkCopyShape({ copy, channel: row.channel as MarketingChannel, withImage: variants.length > 0 }),
      ...storedContextWarnings(row.warnings),
    ],
    channelConfigVersion: row.channelConfigVersion,
    reviewState: row.reviewState as ReviewState,
    origin: row.origin as ContentAssetVersion['origin'],
    promptVersion: row.promptVersion,
    editedByUserId: row.editedByUserId,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The stored context warnings of a row, each validated on its own. */
function storedContextWarnings(value: unknown): ChannelWarning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const parsed = channelWarning.safeParse(item);
    return parsed.success && CONTEXT_WARNING_KINDS.has(parsed.data.kind) ? [parsed.data] : [];
  });
}
