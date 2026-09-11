import {sql} from 'drizzle-orm';
import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {currentUser} from '../../core/http/authenticate.js';
const params=z.object({labelId:z.uuid()});
const withId=params.extend({id:z.uuid()});
export const visibilityRoutes:FastifyPluginAsync=async app=>{
 const {db,services:{visibility:s}}=app.appContext;
 const root='/labels/:labelId/ai-visibility';
 app.get(`${root}/geo/setup/:id`,r=>{const p=withId.parse(r.params);return app.appContext.services.geo.setup(db,currentUser(r),p.labelId,p.id);});
 app.get(`${root}/geo/latest/:id`,async r=>{const p=withId.parse(r.params);const user=currentUser(r);await app.appContext.services.geo.setup(db,user,p.labelId,p.id);const rows=await db.execute(sql`SELECT id FROM jobs WHERE label_id=${p.labelId} AND type='geo.research' AND payload->>'courseVersionId'=${p.id} ORDER BY created_at DESC LIMIT 1`);const reports=rows.rows[0]?await db.execute(sql`SELECT id FROM geo_reports WHERE job_id=${String(rows.rows[0].id)} AND label_id=${p.labelId}`):null;return {reportId:reports?.rows[0]?.id??null,job:rows.rows[0]?await app.appContext.services.jobs.get(db,user,String(rows.rows[0].id)):null};});
 app.get(`${root}/geo/answers/:id`,r=>{const p=withId.parse(r.params);return app.appContext.services.geo.engineAnswers(db,currentUser(r),p.labelId,p.id);});
 app.get(`${root}/geo/reports`,async r=>{const p=params.parse(r.params);const q=z.object({search:z.string().max(200).default('')}).parse(r.query);return {items:await app.appContext.services.geo.list(db,currentUser(r),p.labelId,q.search)};});
 app.get(`${root}/geo/reports/:id`,r=>{const p=withId.parse(r.params);return app.appContext.services.geo.get(db,currentUser(r),p.labelId,p.id);});
 app.post(`${root}/geo/start`,async(r,reply)=>{
   const p=params.parse(r.params);const user=currentUser(r);const {geo,generationJobs}=app.appContext.services;
   const input=await geo.validate(db,user,p.labelId,r.body);
   const queued=await generationJobs.enqueue(db,user,{labelId:p.labelId,type:'geo.research',intent:['geo',input.courseVersionId,input.requestKey,JSON.stringify([input.mode,input.courseUrl,input.questions])],payload:input,requestId:r.id});
   await geo.saveUrl(db,p.labelId,input.courseVersionId,input.courseUrl);
   return reply.code(202).send(queued.summary);
 });

 app.get(root,r=>s.overview(db,currentUser(r),params.parse(r.params).labelId));
 app.post(`${root}/entities`,r=>s.addEntity(db,currentUser(r),params.parse(r.params).labelId,r.body));
 app.post(`${root}/entities/:id`,r=>{const p=withId.parse(r.params);return s.addEntity(db,currentUser(r),p.labelId,r.body,p.id);});
 app.post(`${root}/prompts`,r=>s.addPrompt(db,currentUser(r),params.parse(r.params).labelId,r.body));
 app.post(`${root}/proposals`,r=>s.propose(db,currentUser(r),params.parse(r.params).labelId,z.object({courseVersionId:z.uuid()}).parse(r.body).courseVersionId));
 app.post(`${root}/prompts/:id/approve`,r=>{const p=withId.parse(r.params);return s.approve(db,currentUser(r),p.labelId,p.id);});
 app.post(`${root}/benchmarks`,r=>s.benchmark(db,currentUser(r),params.parse(r.params).labelId,r.body));
 app.post(`${root}/benchmarks/:id/runs`,r=>{const p=withId.parse(r.params);return s.start(db,currentUser(r),p.labelId,p.id,z.object({requestKey:z.uuid()}).parse(r.body).requestKey);});
 app.get(`${root}/runs/:id`,r=>{const p=withId.parse(r.params);return s.run(db,currentUser(r),p.labelId,p.id);});
 app.post(`${root}/runs/:id/observations`,r=>{const p=withId.parse(r.params);return s.import(db,currentUser(r),p.labelId,p.id,r.body);});
 app.post(`${root}/runs/:id/campaigns`,r=>{const p=withId.parse(r.params);return s.campaign(db,currentUser(r),p.labelId,p.id,z.object({observationId:z.uuid()}).parse(r.body).observationId);});
};
