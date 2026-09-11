import type { GeoService } from './modules/ai-visibility/geo-service.js';
import type { CampaignPackageService } from './modules/campaign-packages/service.js';
import type { MarketRadarService } from './modules/market-radar/service.js';
import type { IdentityService } from './modules/identity-access/service.js';
import type { CourseService } from './modules/courses/service.js';
import type { PersonaService } from './modules/personas/service.js';
import type { SourcesResearchService } from './modules/sources-research/service.js';
import type { OpportunityService } from './modules/opportunities/service.js';
import type { CampaignService } from './modules/campaigns-briefs/service.js';
import type { ConceptService } from './modules/concepts/service.js';
import type { ContentAssetService } from './modules/content-assets/service.js';

/**
 * The services a generation job needs.
 *
 * Declared as one bundle so the worker imports a single named surface from the
 * monolith rather than reaching into module paths. The dependency direction
 * stays worker → api and is enforced by lint (ADR-0001).
 *
 * Note what is *not* here: no HTTP, no auth adapter, no request context. A job
 * re-resolves its actor through `identity` and the services re-check
 * authorisation, so a job carries no ambient privilege.
 */
export interface GenerationDeps {
  identity: IdentityService;
  courses: CourseService;
  research: SourcesResearchService;
  radar: MarketRadarService;
  geo: GeoService;
  campaignPackages: CampaignPackageService;
  personas: PersonaService;
  opportunities: OpportunityService;
  campaigns: CampaignService;
  concepts: ConceptService;
  content: ContentAssetService;
}
