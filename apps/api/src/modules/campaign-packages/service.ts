import { and, desc, eq } from 'drizzle-orm';
import {
  campaignPackageReport, deliverableRecommendations, campaignPackageContent, radarReport, statableFacts,
  stagesForObjective,
  type CurrentUser, type CampaignPackageRun, type CampaignPackageReport,
  type CampaignDeliverable, type BrandProfileVersion, type FunnelStage, type MarketingChannel, type PersonaVersion,
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
import JSZip from 'jszip';
import { promisesInteractiveForm, type PackagePreview, type PackageReadiness } from '@c360/contracts';

export class CampaignPackageService {
  constructor(private readonly generation: GenerationService, private readonly campaigns: CampaignService,
    private readonly courses: CourseService, private readonly brand: BrandService, private readonly storageRoot: string,
    /**
     * The campaign's personas and approved channel plan, when the deployment
     * wires them (R-4, first slice). Optional so the existing tests and any
     * caller without the chain still work; absent means the package prompts
     * receive the objective and the stages but no audience and no plan.
     */
    private readonly chain?: {
      personas: { findManyByIds(db: Db, labelId: string, ids: readonly string[]): Promise<PersonaVersion[]> };
      plans: {
        latestPlan(db: Db, campaignId: string): Promise<
          { reviewState: string; plan: { items: { stage: FunnelStage | null; channel: MarketingChannel }[] } } | undefined
        >;
      };
    }) {}
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
  /**
   * What has to be true before a package is made.
   *
   * A recommendation run has to have happened, because its snapshot is the
   * material the package is built from — not because it decides what may be
   * chosen. That distinction used to be missing: a form the model had not
   * proposed was refused here, and the message told the person to change an
   * approved briefing if they wanted something else. Recommending and
   * permitting are different acts, and the channel plan already treats them
   * that way — a discouraged cell can still be ticked, with the advice beside
   * it (2026-09-16).
   *
   * The remaining gate is a production constraint rather than an opinion: a
   * banner set has a button it has to fit into.
   */
  async assertSelection(db: Db, user: CurrentUser, labelId: string, campaignId: string, selected: CampaignDeliverable[]) {
    const proposal = (await this.list(db, user, labelId, campaignId)).find((item) => !item.stale && item.report.recommendations);
    if (!proposal?.report.recommendations)
      throw new AppError('gate_not_passed', { publicMessage: 'Laat eerst vormen voorstellen; die ronde levert het materiaal waaruit het pakket wordt gemaakt. Daarna kies je zelf wat je maakt.' });
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
    /*
     * The package is a branch of the same campaign, so it reads the same
     * objective, stages, personas, per-stage messages and approved channel
     * plan as the chain does. Before this it received the brief alone, and
     * proposed the same three website forms whatever the campaign was for.
     */
    const personas = this.chain === undefined
      ? []
      : await this.chain.personas.findManyByIds(db, input.labelId, context.brief.personaVersionIds);
    const approvedPlan = this.chain === undefined ? undefined : await this.chain.plans.latestPlan(db, context.campaign.id);
    const plannedCells = approvedPlan?.reviewState === 'approved'
      ? approvedPlan.plan.items.map((item) => ({ stage: item.stage, channel: item.channel }))
      : [];
    const common = { organizationId: user.organizationId, labelId: input.labelId, jobId: input.jobId, attempt: input.attempt,
      context: { language: context.campaign.contentLanguage, course: context.course, brand, brief: context.brief,
        suppliedBrief: context.campaign.suppliedBrief,
        personas,
        objective: context.campaign.objective,
        funnelStages: stagesForObjective(context.campaign.objective ?? 'full_funnel'),
        stageMessages: context.brief.stageMessages,
        plannedCells,
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
  /**
   * The same four gates `assertReady` enforces, as a checklist that does not
   * throw (2026-09-15). The branch used to show one disabled button and, at
   * best, one sentence; a person could not tell whether it was broken or
   * waiting. This says which gate is open, which is closed and what to do,
   * and whether the briefing promises an interactive form this branch has
   * to make.
   */
  async readiness(db: Db, user: CurrentUser, labelId: string, campaignId: string): Promise<PackageReadiness> {
    requireLabelPermission(user, labelId, 'content:read');
    const campaign = await this.campaigns.requireById(db, labelId, campaignId);
    const latest = await this.campaigns.latestBrief(db, campaignId);
    const briefApproved = latest?.reviewState === 'approved';
    const course = await this.courses.requireVersion(db, labelId, campaign.courseVersionId);
    const destination = latest?.ctaUrl ?? course.courseUrl ?? course.sourceRef ?? null;
    const destinationOk = destination !== null && inspectUrl(destination, { allowedHostSuffixes: [], allowInsecureHttp: false }).ok;
    const brand = await this.brand.approved(db, labelId);
    const checks: PackageReadiness['checks'] = [
      {
        id: 'brief',
        ok: briefApproved,
        labelNl: 'Nieuwste briefing goedgekeurd',
        hintNl: briefApproved ? null : latest === undefined ? 'Werk eerst de briefing uit in stap 3.' : 'Keur de nieuwste versie van de briefing goed in stap 3.',
      },
      {
        id: 'course',
        ok: course.reviewState === 'approved',
        labelNl: 'Opleidingskaart goedgekeurd',
        hintNl: course.reviewState === 'approved' ? null : 'Keur de opleidingskaart goed onder Kennis & beheer › Opleidingen; de website-vormen citeren alleen gecontroleerde feiten.',
      },
      {
        id: 'destination',
        ok: destinationOk,
        labelNl: 'Openbare HTTPS-bestemmingspagina',
        hintNl: destinationOk ? null : 'Zet de link naar de opleidingspagina in de briefing (call to action) of op de opleidingskaart.',
      },
      {
        id: 'brand',
        ok: brand !== undefined && brand !== null,
        labelNl: 'Goedgekeurde merkversie',
        hintNl: brand !== undefined && brand !== null ? null : 'Keur eerst een merkversie goed onder Merk & bronnen.',
      },
    ];
    return {
      ok: checks.every((check) => check.ok),
      checks,
      destination: destinationOk ? destination : null,
      interactivePromised: promisesInteractiveForm([latest?.cta, ...(latest?.stageMessages ?? []).map((message) => message.ctaNl)]),
    };
  }

  /**
   * The produced pages as self-contained HTML for an in-app preview
   * (2026-09-15): stylesheet and script inlined, the logo as a data URI,
   * brand font files left out (a system font stands in and the preview says
   * so). The interface shows each in a sandboxed frame, so the quiz can be
   * played on the campaign screen instead of only after downloading the ZIP.
   */
  async preview(db: Db, user: CurrentUser, labelId: string, campaignId: string, packageId: string): Promise<PackagePreview> {
    requireLabelPermission(user, labelId, 'content:read');
    const run = (await this.list(db, user, labelId, campaignId)).find((item) => item.id === packageId);
    if (!run) throw AppError.notFoundOrForbidden('campaign_package', packageId);
    if (!run.report.content) throw new AppError('conflict', { publicMessage: 'Kies eerst de gewenste onderdelen en maak het pakket.' });
    const zip = await JSZip.loadAsync(await buildCampaignPackage(db, this.storageRoot, run.report));
    const logo = zip.file('keuzehulp/logo.png') ?? zip.file('blog/logo.png');
    const logoUri = logo ? `data:image/png;base64,${(await logo.async('nodebuffer')).toString('base64')}` : null;
    const parts: PackagePreview['parts'] = [];
    for (const [folder, id, titleNl] of [['keuzehulp', 'keuzehulp', 'Keuzehulp (quiz)'], ['blog', 'blog', 'Blog met FAQ']] as const) {
      const page = zip.file(`${folder}/index.html`);
      if (!page) continue;
      let html = await page.async('string');
      const css = (await zip.file(`${folder}/style.css`)?.async('string')) ?? '';
      const js = (await zip.file(`${folder}/widget.js`)?.async('string')) ?? '';
      // Font files cannot travel in an inline document; the family names stay and a system font stands in.
      const inlineCss = css.replace(/@font-face\{[^}]*\}\n?/gu, '');
      html = html.replace('<link rel="stylesheet" href="style.css">', `<style>${inlineCss}</style>`);
      html = html.replace('<script src="widget.js" defer></script>', js.length > 0 ? `<script>${js}</script>` : '');
      if (logoUri) html = html.replace('src="logo.png"', `src="${logoUri}"`);
      parts.push({ id, titleNl, html });
    }
    const embed = zip.file('keuzehulp/embed.html');
    return {
      stale: run.stale,
      isMock: run.report.isMock,
      parts,
      embedHtml: embed ? await embed.async('string') : null,
      noteNl: 'Voorvertoning: merkfonts zijn hier vervangen door een systeemfont; het ZIP-pakket bevat de echte fontbestanden.',
    };
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
