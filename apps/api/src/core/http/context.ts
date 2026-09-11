import type { GeoService } from '../../modules/ai-visibility/geo-service.js';
import type { VisibilityService } from '../../modules/ai-visibility/service.js';
import type { CampaignPackageService } from '../../modules/campaign-packages/service.js';
import type { MarketRadarService } from '../../modules/market-radar/service.js';
import type { CurrentUser } from '@c360/contracts';
import type { ServerEnv } from '@c360/config';
import type { Db } from '../db/types.js';
import type { AuthAdapter } from '../auth/types.js';
import type { FairUseLimiter } from './fair-use.js';
import type { AuditService } from '../../modules/audit/service.js';
import type { IdentityService } from '../../modules/identity-access/service.js';
import type { MembersService } from '../../modules/identity-access/members-service.js';
import type { JobService } from '../../modules/jobs-usage/service.js';
import type { GenerationJobService } from '../../modules/jobs-usage/generation-jobs.js';
import type { LabelService } from '../../modules/organizations-labels/service.js';
import type { WorkspaceService } from '../../modules/organizations-labels/workspace-service.js';
import type { GenerationService } from '../ai/generation.js';
import type { ApprovalService } from '../../modules/reviews-approvals/service.js';
import type { BrandService } from '../../modules/brand/service.js';
import type { CourseService } from '../../modules/courses/service.js';
import type { PersonaService } from '../../modules/personas/service.js';
import type { OpportunityService } from '../../modules/opportunities/service.js';
import type { CampaignService } from '../../modules/campaigns-briefs/service.js';
import type { ConceptService } from '../../modules/concepts/service.js';
import type { ContentAssetService } from '../../modules/content-assets/service.js';
import type { ExportService } from '../../modules/exports/service.js';
import type { LearningService } from '../../modules/learnings/service.js';
import type { SourceImpactService } from '../../modules/source-impact/service.js';
import type { OutcomeService } from '../../modules/outcomes/service.js';
import type { UploadService } from '../../modules/uploads/service.js';
import type { SourcesResearchService } from '../../modules/sources-research/service.js';

/**
 * Everything a route handler is allowed to reach.
 *
 * Dependencies are passed in rather than imported as singletons, which is what
 * lets a test build the whole app against PGlite and a fixed clock without
 * monkey-patching modules.
 */
export interface AppContext {
  env: ServerEnv;
  db: Db;
  authAdapter: AuthAdapter;
  /** Per-user and per-label pacing, applied once the actor is known. */
  fairUse: FairUseLimiter;
  /**
   * Set when a shutdown signal arrives.
   *
   * `/ready` reports 503 while it is true so the load balancer drains this
   * replica before it stops accepting connections.
   */
  draining: boolean;
  services: {
    identity: IdentityService;
    /** Label membership administration. */
    members: MembersService;
    labels: LabelService;
    workspace: WorkspaceService;
    jobs: JobService;
    /** Enqueues generation work so no model call happens in a request. */
    generationJobs: GenerationJobService;
    audit: AuditService;
    /** AI text generation, with budget reservation and usage accounting. */
    generation: GenerationService;
    approvals: ApprovalService;
    brand: BrandService;
    courses: CourseService;
    personas: PersonaService;
    opportunities: OpportunityService;
    campaigns: CampaignService;
    concepts: ConceptService;
    content: ContentAssetService;
    exports: ExportService;
    outcomes: OutcomeService;
    learnings: LearningService;
    sourceImpact: SourceImpactService;
    /** Untrusted file input: validation, quarantine, authorised download. */
    uploads: UploadService;
    /** Sources a label reads, the runs over them, and the findings produced. */
    research: SourcesResearchService;
  geo: GeoService;
  visibility: VisibilityService;
  radar: MarketRadarService;
  campaignPackages: CampaignPackageService;
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    appContext: AppContext;
  }
  interface FastifyRequest {
    /**
     * Populated by the authentication hook on protected routes. Reading it on
     * an unauthenticated route is a programming error, so `currentUser()`
     * throws rather than returning undefined.
     */
    authenticatedUser?: CurrentUser;
  }
}
