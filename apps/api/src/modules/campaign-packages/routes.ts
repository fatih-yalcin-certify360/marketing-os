import { requireLabelPermission } from '../../core/authz/policy.js';
import { AppError } from '../../core/errors/app-error.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { campaignPackageInput, packageReviewInput, packageQualityDossier } from '@c360/contracts';
import { currentUser } from '../../core/http/authenticate.js';
import { jobs, briefVersions } from '../../core/db/schema.js';
const params = z.object({ labelId:z.uuid(), campaignId:z.uuid() });
export const campaignPackageRoutes: FastifyPluginAsync = async (app) => {
  const { db, services } = app.appContext;
  const reviewParams=params.extend({packageId:z.uuid()});
  app.get('/labels/:labelId/campaigns/:campaignId/packages/:packageId/evidence',async(request,reply)=>{
    const p=reviewParams.parse(request.params);const user=currentUser(request);
    const run=(await services.campaignPackages.list(db,user,p.labelId,p.campaignId)).find(r=>r.id===p.packageId);
    if(!run?.report.content)throw AppError.notFoundOrForbidden('campaign_package',p.packageId);
    const rows=await db.execute(sql`SELECT id, reviewer_user_id, assessment, created_at FROM campaign_package_reviews WHERE package_id=${p.packageId} ORDER BY created_at DESC LIMIT 50`);
    const [brief]=await db.select({goal:briefVersions.goal,coreMessage:briefVersions.coreMessage,contentScope:briefVersions.contentScope,cta:briefVersions.cta}).from(briefVersions).where(and(eq(briefVersions.id,run.report.briefVersionId),eq(briefVersions.campaignId,p.campaignId),eq(briefVersions.labelId,p.labelId))).limit(1);
    const result={brief:brief??null,dossier:packageQualityDossier(run.report,run.stale),reviews:rows.rows.map(r=>({id:r.id,reviewerUserId:r.reviewer_user_id,assessment:packageReviewInput.parse(r.assessment),createdAt:new Date(String(r.created_at)).toISOString()}))};
    if(z.object({download:z.string().optional()}).parse(request.query).download==='1')reply.header('content-disposition',`attachment; filename="bewijs-${p.packageId}.json"`);
    return reply.header('cache-control','private, no-store').send(result);
  });
  app.post('/labels/:labelId/campaigns/:campaignId/packages/:packageId/reviews',async(request,reply)=>{
    const p=reviewParams.parse(request.params);const user=currentUser(request);
    requireLabelPermission(user,p.labelId,'content:approve');
    const input=packageReviewInput.parse(request.body);
    const run=(await services.campaignPackages.list(db,user,p.labelId,p.campaignId)).find(r=>r.id===p.packageId);
    if(!run?.report.content)throw AppError.notFoundOrForbidden('campaign_package',p.packageId);
    if(input.decision==='ready_for_pilot'){const brand=await services.brand.requireCurrent(db,p.labelId);if(brand.id!==run.report.brand.id)throw new AppError('dependency_changed');}
    const dossier=packageQualityDossier(run.report,run.stale);
    if(input.decision==='ready_for_pilot'&&(run.stale||run.report.isMock||dossier.checks.find(c=>c.id==='brand')?.status==='missing'))throw new AppError('gate_not_passed',{publicMessage:'Een pilotbeoordeling vereist een actuele, niet-demo versie en beschikbare tekstuele merkregels. Leg anders de benodigde verbeteringen vast.'});
    await db.execute(sql`INSERT INTO campaign_package_reviews(package_id,reviewer_user_id,assessment) VALUES(${p.packageId},${user.userId},${JSON.stringify(input)}::jsonb)`);
    return reply.code(201).send({recorded:true});
  });

  app.get('/labels/:labelId/campaigns/:campaignId/packages',async(request)=>{
    const p=params.parse(request.params);const user=currentUser(request);
    const items=await services.campaignPackages.list(db,user,p.labelId,p.campaignId);
    const [job]=await db.select({id:jobs.id}).from(jobs).where(and(eq(jobs.labelId,p.labelId),eq(jobs.type,'campaign.package'),sql`${jobs.payload}->>'campaignId' = ${p.campaignId}`)).orderBy(desc(jobs.createdAt)).limit(1);
    return {items,latestJob:job?await services.jobs.get(db,user,job.id):null};
  });
  app.post('/labels/:labelId/campaigns/:campaignId/packages',async(request,reply)=>{
    const p=params.parse(request.params);const user=currentUser(request);const body=campaignPackageInput.parse(request.body);
    const ready=await services.campaignPackages.assertReady(db,user,p.labelId,p.campaignId);
    if(body.mode==='generate')await services.campaignPackages.assertSelection(db,user,p.labelId,p.campaignId,body.selected);
    const latest=(await services.campaignPackages.list(db,user,p.labelId,p.campaignId))[0];
    const result=await services.generationJobs.enqueue(db,user,{labelId:p.labelId,type:'campaign.package',intent:['campaign-package',p.campaignId,ready.brief.id,latest?.id??'initial',JSON.stringify(body)],payload:{campaignId:p.campaignId,...body},requestId:request.id});
    return reply.code(result.created?202:200).send(result.summary);
  });
  app.get('/labels/:labelId/campaigns/:campaignId/packages/:packageId/file',async(request,reply)=>{
    const p=params.extend({packageId:z.uuid()}).parse(request.params);
    const buffer=await services.campaignPackages.download(db,currentUser(request),p.labelId,p.campaignId,p.packageId);
    return reply.header('content-type','application/zip').header('content-disposition',`attachment; filename="CONCEPT-campagne-${p.packageId}.zip"`).header('cache-control','private, no-store').send(buffer);
  });
};
