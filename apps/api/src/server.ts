import { GeoService } from './modules/ai-visibility/geo-service.js';
import { VisibilityService } from './modules/ai-visibility/service.js';
import { visibilityRoutes } from './modules/ai-visibility/routes.js';
import { CampaignPackageService } from './modules/campaign-packages/service.js';
import { campaignPackageRoutes } from './modules/campaign-packages/routes.js';
import { MarketRadarService } from './modules/market-radar/service.js';
import { radarRoutes } from './modules/market-radar/routes.js';
import { VisualGenerationService } from './core/ai/visuals.js';
import { PortalSyncService } from './integrations/brand-portal/service.js';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ServerEnv } from '@c360/config';
import { registerErrorHandler } from './core/errors/handler.js';
import { registerSecurity } from './core/http/security.js';
import { authenticate } from './core/http/authenticate.js';
import { enforceFairUse, FairUseLimiter } from './core/http/fair-use.js';
import type { AppContext } from './core/http/context.js';
import { createAuthAdapter } from './core/auth/create-adapter.js';
import { createAiProvider } from './core/ai/index.js';
import { GenerationService } from './core/ai/generation.js';
import { ImageRenderer } from './core/render/renderer.js';
import type { Db } from './core/db/types.js';
import { AuditService } from './modules/audit/service.js';
import { IdentityService } from './modules/identity-access/service.js';
import { identityRoutes } from './modules/identity-access/routes.js';
import { MembersService } from './modules/identity-access/members-service.js';
import { memberRoutes } from './modules/identity-access/members-routes.js';
import { BudgetService } from './modules/jobs-usage/budget.js';
import { JobQueue } from './modules/jobs-usage/queue.js';
import { JobService } from './modules/jobs-usage/service.js';
import { GenerationJobService } from './modules/jobs-usage/generation-jobs.js';
import { jobRoutes } from './modules/jobs-usage/routes.js';
import { LabelService } from './modules/organizations-labels/service.js';
import { WorkspaceService } from './modules/organizations-labels/workspace-service.js';
import { labelRoutes } from './modules/organizations-labels/routes.js';
import { ApprovalService } from './modules/reviews-approvals/service.js';
import { BrandService } from './modules/brand/service.js';
import { brandRoutes } from './modules/brand/routes.js';
import { CourseService } from './modules/courses/service.js';
import { courseRoutes } from './modules/courses/routes.js';
import { PersonaService } from './modules/personas/service.js';
import { OpportunityService } from './modules/opportunities/service.js';
import { CampaignService } from './modules/campaigns-briefs/service.js';
import { campaignRoutes } from './modules/campaigns-briefs/routes.js';
import { ConceptService } from './modules/concepts/service.js';
import { ContentAssetService } from './modules/content-assets/service.js';
import { contentRoutes } from './modules/content-assets/routes.js';
import { ExportService } from './modules/exports/service.js';
import { LearningService } from './modules/learnings/service.js';
import { SourceImpactService } from './modules/source-impact/service.js';
import { OutcomeService } from './modules/outcomes/service.js';
import { UploadService } from './modules/uploads/service.js';
import { uploadRoutes } from './modules/uploads/routes.js';
import { outcomeRoutes } from './modules/outcomes/routes.js';
import { learningRoutes } from './modules/learnings/routes.js';
import { sourceImpactRoutes } from './modules/source-impact/routes.js';
import { SourcesResearchService } from './modules/sources-research/service.js';
import { sourceRoutes } from './modules/sources-research/routes.js';

export interface BuildServerOptions {
  env: ServerEnv;
  db: Db;
}

/**
 * Wires the modular monolith.
 *
 * Dependencies are constructed once here and injected, which is what lets a
 * test build the whole application against an in-process PostgreSQL and a
 * mock provider without patching modules.
 *
 * The construction order mirrors the dependency direction: approvals and brand
 * are foundational, the campaign chain builds on them, and exports sit at the
 * end because they read everything.
 */
export function createAppContext({ env, db }: BuildServerOptions): AppContext {
  const audit = new AuditService(env.AUTH_PROXY_SHARED_SECRET);
  const budget = new BudgetService(env.AI_DEFAULT_LABEL_BUDGET_CENTS);
  const jobs = new JobService(audit, budget);
  const labels = new LabelService();

  const provider = createAiProvider(env);
  const generation = new GenerationService(provider, env);
  const renderer = new ImageRenderer(env.STORAGE_ROOT);

  const approvals = new ApprovalService();
  const brand = new BrandService(approvals, new PortalSyncService(env, audit));
  // Generation and the research limits are passed so `extractFromUrl` works;
  // every other course path ignores them.
  // Uploads is constructed before courses because document extraction reads a
  // stored asset through it.
  const uploads = new UploadService(env.STORAGE_ROOT, audit, env.UPLOAD_MAX_BYTES);
  const courses = new CourseService(approvals, generation, env, uploads);
  // Research is built before personas because personas rest on its findings.
  const research = new SourcesResearchService(generation, courses, env, undefined, uploads);
  const learningService = new LearningService();
  const personas = new PersonaService(
    generation,
    brand,
    courses,
    approvals,
    research,
    learningService,
  );
  const opportunities = new OpportunityService(generation, brand, courses, personas);
  const campaigns = new CampaignService(
    generation,
    brand,
    courses,
    personas,
    opportunities,
    approvals,
  );
  const concepts = new ConceptService(
    generation,
    brand,
    courses,
    personas,
    campaigns,
    approvals,
  );
  const content = new ContentAssetService(
    generation,
    renderer,
    brand,
    courses,
    personas,
    campaigns,
    concepts,
    approvals,
    new VisualGenerationService(provider, env),
  );
  const exportService = new ExportService(
    env.STORAGE_ROOT,
    brand,
    courses,
    campaigns,
    concepts,
    content,
  );

  const fairUse = FairUseLimiter.fromEnv(env);

  return {
    env,
    db,
    authAdapter: createAuthAdapter(env),
    fairUse,
    draining: false,
    services: {
      identity: new IdentityService(),
      members: new MembersService(audit),
      labels,
      workspace: new WorkspaceService(labels, jobs, brand, courses, content, campaigns),
      jobs,
      generationJobs: new GenerationJobService(jobs, generation, fairUse),
      audit,
      generation,
      approvals,
      brand,
      courses,
      personas,
      opportunities,
      campaigns,
      concepts,
      content,
      exports: exportService,
      outcomes: new OutcomeService(campaigns),
      learnings: learningService,
      sourceImpact: new SourceImpactService(research),
      uploads,
      research,
      campaignPackages: new CampaignPackageService(generation, campaigns, courses, brand, env.STORAGE_ROOT),
      geo: new GeoService(generation, courses, brand, env),
      visibility: new VisibilityService(campaigns, courses),
      radar: new MarketRadarService(generation, courses, campaigns, brand, env),
    },
  };
}

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const { env } = options;

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Redaction is a safety net, not the primary control: the code paths
      // above simply never put secrets or user content into log objects.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          `req.headers["${env.AUTH_HEADER_PROXY_SECRET.toLowerCase()}"]`,
          `req.headers["${env.AUTH_HEADER_EMAIL.toLowerCase()}"]`,
          'payload',
          'prompt',
        ],
        censor: '[redacted]',
      },
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
        : {}),
    },
    // Never honour X-Forwarded-For for identity or trust decisions. The trusted
    // proxy check reads `socket.remoteAddress` directly, so leaving this off
    // removes any chance of a forwarded header influencing authentication.
    trustProxy: false,
    bodyLimit: env.REQUEST_BODY_LIMIT_BYTES,
    // Fastify generates a request id; it is the only correlation handle given
    // to clients in error responses.
  });

  app.decorate('appContext', createAppContext(options));

  registerErrorHandler(app);
  await registerSecurity(app, env);

  /*
   * Liveness, readiness and metrics are the only unauthenticated routes.
   *
   * They are deliberately split: `/health` must never touch the database, so a
   * database outage does not restart every replica in a loop that cannot help,
   * while `/ready` must, so a replica that cannot serve is taken out of
   * rotation. `/metrics` exposes operational counters only — no user content,
   * no label names, no identifiers.
   */
  app.get('/health', () => ({ status: 'ok' }));

  app.get('/ready', async (_request, reply) => {
    if (app.appContext.draining) {
      return reply.code(503).send({ status: 'draining' });
    }
    try {
      // A trivial query proves the pool can actually reach PostgreSQL.
      await app.appContext.db.execute('SELECT 1');
    } catch {
      return reply.code(503).send({ status: 'unavailable', reason: 'database_unreachable' });
    }
    return { status: 'ready' };
  });

  app.get('/metrics', async (_request, reply) => {
    const queue = new JobQueue();
    const depth = await queue.depth(app.appContext.db).catch(() => undefined);
    const lines = [
      '# HELP c360_fair_use_tracked_keys Rate-limit buckets held in memory by this replica.',
      '# TYPE c360_fair_use_tracked_keys gauge',
      `c360_fair_use_tracked_keys ${String(app.appContext.fairUse.size())}`,
    ];
    if (depth !== undefined) {
      lines.push(
        '# HELP c360_jobs_queued Jobs waiting to be claimed, across all labels.',
        '# TYPE c360_jobs_queued gauge',
        `c360_jobs_queued ${String(depth.queued)}`,
        '# HELP c360_jobs_running Jobs currently being processed.',
        '# TYPE c360_jobs_running gauge',
        `c360_jobs_running ${String(depth.running)}`,
        '# HELP c360_jobs_oldest_queued_age_ms Age of the oldest unclaimed job.',
        '# TYPE c360_jobs_oldest_queued_age_ms gauge',
        `c360_jobs_oldest_queued_age_ms ${String(depth.oldestQueuedAgeMs)}`,
      );
    }
    return reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(`${lines.join('\n')}\n`);
  });

  await app.register(
    async (api) => {
      // Everything in this scope is authenticated by construction: a new route
      // cannot forget the guard, and the fair-use limiter that follows in
      // `preHandler` therefore always knows the actor.
      api.addHook('onRequest', authenticate);
      api.addHook('preHandler', enforceFairUse);

      await api.register(identityRoutes);
      await api.register(memberRoutes);
      await api.register(labelRoutes);
      await api.register(jobRoutes);
      await api.register(brandRoutes);
      await api.register(courseRoutes);
      await api.register(campaignRoutes);
      await api.register(contentRoutes);
      await api.register(uploadRoutes);
      await api.register(sourceRoutes);
      await api.register(outcomeRoutes);
      await api.register(learningRoutes);
      await api.register(sourceImpactRoutes);
      await api.register(radarRoutes);
      await api.register(visibilityRoutes);
    await api.register(campaignPackageRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
