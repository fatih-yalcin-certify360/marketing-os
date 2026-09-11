import { and, desc, eq } from 'drizzle-orm';
import {
  campaignPackageReport, deliverableRecommendations, campaignPackageContent, radarReport, statableFacts,
  type CurrentUser, type CampaignPackageRun, type CampaignPackageReport,
  type CampaignDeliverable, type BrandProfileVersion,
} from '@c360/contracts';
import type { Db } from '../../core/db/types.js';
import { campaignPackages, radarRuns } from '../../core/db/schema.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import { AppError } from '../../core/errors/app-error.js';
import { inspectUrl } from '../../core/net/index.js';
import type { GenerationService } from '../../core/ai/generation.js';
import type { BrandService } from '../brand/service.js';
import type { CampaignService } from '../campaigns-briefs/service.js';
import type { CourseService } from '../courses/service.js';
import { buildCampaignPackage } from './render.js';

export class CampaignPackageService {
  constructor(private readonly generation: GenerationService, private readonly campaigns: CampaignService,
    private readonly courses: CourseService, private readonly brand: BrandService, private readonly storageRoot: string) {}
  private async currentBrand(db: Db, labelId: string): Promise<BrandProfileVersion> {
    return this.brand.requireCurrent(db, labelId);
  }
  async assertReady(db: Db, user: CurrentUser, labelId: string, campaignId: string) {
    requireLabelPermission(user, labelId, 'content:write');
    const campaign = await this.campaigns.requireById(db, labelId, campaignId);
    const brief = await this.campaigns.requireApprovedBrief(db, campaignId);
    const latest = await this.campaigns.latestBrief(db, campaignId);
    if (latest?.id !== brief.id) throw new AppError('gate_not_passed', { publicMessage: 'Keur eerst de nieuwste briefing goed.' });
    const course = await this.courses.requireVersion(db, labelId, campaign.courseVersionId);
    if (course.reviewState !== 'approved') throw new AppError('gate_not_passed', { publicMessage: 'Keur eerst de opleidingskaart goed.' });
    const destination = brief.ctaUrl ?? course.courseUrl ?? course.sourceRef;
    if (!destination || !inspectUrl(destination, { allowedHostSuffixes: [], allowInsecureHttp: false }).ok)
      throw new AppError('gate_not_passed', { publicMessage: 'De briefing heeft een openbare HTTPS-bestemmingspagina nodig.' });
    return { campaign, brief, course, destination };
  }
  async list(db: Db, user: CurrentUser, labelId: string, campaignId: string): Promise<CampaignPackageRun[]> {
    requireLabelPermission(user, labelId, 'content:read');
    const campaign = await this.campaigns.requireById(db, labelId, campaignId);
    const course = await this.courses.requireVersion(db, labelId, campaign.courseVersionId);
    const brand = await this.brand.approved(db, labelId);
    const brief = await this.campaigns.latestBrief(db, campaignId);
    const rows = await db.select().from(campaignPackages).where(and(eq(campaignPackages.labelId, labelId), eq(campaignPackages.campaignId, campaignId))).orderBy(desc(campaignPackages.createdAt)).limit(20);
    return rows.map((row) => { const report = campaignPackageReport.parse(row.report); return { id: row.id, createdAt: row.createdAt.toISOString(), report, stale: course.reviewState !== 'approved' || report.brand.id !== brand?.id || report.briefVersionId !== brief?.id || brief?.reviewState !== 'approved' }; });
  }
  async assertSelection(db: Db, user: CurrentUser, labelId: string, campaignId: string, selected: CampaignDeliverable[]) {
    const proposal = (await this.list(db, user, labelId, campaignId)).find((item) => !item.stale && item.report.recommendations);
    if (!proposal?.report.recommendations || selected.some((type) => !proposal.report.recommendations!.items.some((item) => item.type === type)))
      throw new AppError('gate_not_passed', { publicMessage: 'Laat eerst passende contentvormen voorstellen. Kies uit die vormen, of pas de briefing aan als je een ander campagnedoel wilt.' });
    const brief = await this.campaigns.requireApprovedBrief(db, campaignId);
    if (selected.includes('google_studio') && brief.cta.length > 32) throw new AppError('gate_not_passed', { publicMessage: 'Maak de goedgekeurde CTA maximaal 32 tekens voor de bannerset.' });
    return proposal.report.recommendations;
  }
  async generate(db: Db, user: CurrentUser, input: { labelId: string; campaignId: string; mode: 'recommend' | 'generate'; selected: CampaignDeliverable[]; interactionStyle?: 'scenario' | 'dilemma' | 'priorities'; jobId: string; attempt: number; progress?: (percent:number,message:string)=>Promise<void> }) {
    const context = await this.assertReady(db, user, input.labelId, input.campaignId);
    const [prior] = await db.select().from(campaignPackages).where(and(eq(campaignPackages.labelId, input.labelId), eq(campaignPackages.jobId, input.jobId))).limit(1);
    if (prior) return { id: prior.id };
    const brand = await this.currentBrand(db, input.labelId);
    let sourceSnapshot: CampaignPackageReport['sourceSnapshot'] = null;
    if (context.campaign.radarRunId) {
      const [source] = await db.select().from(radarRuns).where(and(eq(radarRuns.id, context.campaign.radarRunId), eq(radarRuns.labelId, input.labelId), eq(radarRuns.courseVersionId, context.course.id))).limit(1);
      if (!source) throw new AppError('dependency_changed');
      sourceSnapshot = radarReport.parse(source.report);
    }
    const common = { organizationId: user.organizationId, labelId: input.labelId, jobId: input.jobId, attempt: input.attempt,
      context: { language: context.campaign.contentLanguage, course: context.course, brand, brief: context.brief,
        suppliedBrief: context.campaign.suppliedBrief,
        pageText: JSON.stringify({ interactionStyle: input.interactionStyle ?? 'scenario', selected: input.selected, sourceSnapshot: sourceSnapshot ? { ...sourceSnapshot, package: null, advertising: null } : null }) } };
    let recommendations: CampaignPackageReport['recommendations'];
    let content: CampaignPackageReport['content'] = null;
    let promptVersion: string;
    await input.progress?.(30, input.mode === 'recommend' ? 'Passende contentvormen uit de briefing afleiden' : 'Gekozen content volgens de briefing uitwerken');
    if (input.mode === 'recommend') {
      const result = await this.generation.generate(db, { ...common, template: 'campaign.deliverables', schema: deliverableRecommendations });
      recommendations = result.value; promptVersion = result.promptVersion;
      if (new Set(recommendations.items.map((item) => item.type)).size !== recommendations.items.length) throw new AppError('provider_invalid_output');
    } else {
      recommendations = await this.assertSelection(db, user, input.labelId, input.campaignId, input.selected);
      const result = await this.generation.generate(db, { ...common, template: 'campaign.package', schema: campaignPackageContent });
      content = result.value; promptVersion = result.promptVersion;
      if (!content.evidenceIds.every((id) => sourceSnapshot?.keywords?.items.some((item) => item.id === id))) throw new AppError('provider_invalid_output');
    }
    const report = campaignPackageReport.parse({ campaignId: context.campaign.id, briefVersionId: context.brief.id, courseVersionId: context.course.id,
      sourceRadarRunId: context.campaign.radarRunId ?? null, sourceSnapshot, brand, selected: input.selected, interactionStyle: input.interactionStyle ?? 'scenario',
      recommendations, content, courseName: context.course.name, courseUrl: context.destination, ctaLabel: context.brief.cta,
      confirmedFacts: statableFacts(context.course), state: input.mode === 'recommend' ? 'recommended' : 'draft', isMock: this.generation.isMock, promptVersion });
    // A concurrent brief/brand update must not be presented as a current package.
    const latest = await this.campaigns.latestBrief(db, context.campaign.id);
    const current = await this.brand.requireApproved(db, input.labelId);
    if (latest?.id !== context.brief.id || latest.reviewState !== 'approved' || current.id !== brand.id) throw new AppError('dependency_changed');
    await input.progress?.(75, 'Merkbestanden en technische uitvoer controleren');
    if (content) await buildCampaignPackage(db, this.storageRoot, report); // fail generation if assets or platform preflight fail
    const [saved] = await db.insert(campaignPackages).values({ organizationId: user.organizationId, labelId: input.labelId, campaignId: context.campaign.id, jobId: input.jobId, report }).onConflictDoNothing().returning();
    if (!saved) throw new AppError('conflict');
    return { id: saved.id };
  }
  async download(db: Db, user: CurrentUser, labelId: string, campaignId: string, packageId: string): Promise<Buffer> {
    requireLabelPermission(user, labelId, 'export:create_draft');
    const run = (await this.list(db, user, labelId, campaignId)).find((item) => item.id === packageId);
    if (!run) throw AppError.notFoundOrForbidden('campaign_package', packageId);
    const current = await this.currentBrand(db, labelId);
    if (run.stale || run.report.brand.id !== current.id) throw new AppError('dependency_changed', { publicMessage: 'Merkregels of briefing zijn gewijzigd. Genereer het pakket opnieuw.' });
    if (!run.report.content) throw new AppError('conflict', { publicMessage: 'Kies eerst de gewenste onderdelen en maak het pakket.' });
    return buildCampaignPackage(db, this.storageRoot, run.report);
  }
}
