import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import type {VisibilityRun,VisibilityEntity,CurrentUser} from '@c360/contracts';
import {visibilityObservationInput} from '@c360/contracts';
import {createTestHarness,labelIdBySlug,type TestHarness} from '../../src/testing/harness.js';
import {courseVersions} from '../../src/core/db/schema.js';
import {matchedEntities,promptKind,canonicalCitation,ownDomain} from '../../src/modules/ai-visibility/analysis.js';
import {UnavailableBrowserAdapter} from '../../src/modules/ai-visibility/adapters.js';
let h:TestHarness;let labelId:string;let courseId:string;let base:string;
beforeAll(async()=>{h=await createTestHarness();labelId=labelIdBySlug(h.seed,'lindenhaeghe');courseId=h.seed.pilot.courseVersionId!;base=`/api/v1/labels/${labelId}/ai-visibility`;});
afterAll(async()=>{await h.close();});
const own:VisibilityEntity={id:randomUUID(),name:'Example Academy',kind:'own',aliases:['ExampleSchool'],domains:['example.nl']};
describe('AI visibility: persistence, metrics and campaign handoff',()=>{
 it('matches bounded names and exact/subdomains, never deceptive domains',()=>{
 expect(matchedEntities('Example Academy en ExampleSchool.',[own])).toHaveLength(1);
 expect(matchedEntities('NoExampleSchool here',[own])).toHaveLength(0);
 expect(matchedEntities('https://example.nl.evil.org https://notexample.nl',[own])).toHaveLength(0);
 expect(matchedEntities('https://leren.example.nl/course',[own])).toHaveLength(1);
 expect(promptKind('Wat biedt Example Academy?',[own])).toBe('branded');
 expect(promptKind('Welke opleiding kies ik?',[own])).toBe('unbranded');
 expect(canonicalCitation('https://www.example.nl/a#b')).toEqual({url:'https://example.nl/a',domain:'example.nl'});
 expect(ownDomain('example.nl.evil.org',[own])).toBe(false);
 });
 it('does not advertise unsupported browser automation',async()=>{expect((await new UnavailableBrowserAdapter().healthCheck('chatgpt')).available).toBe(false);});
 it('rejects personal email and credentials in evidence',()=>{
 const input={promptId:randomUUID(),engine:'chatgpt',repetition:1,status:'success',rawResponse:'A complete example response without personal data.',capturedAt:new Date().toISOString(),sanitized:true};
 expect(visibilityObservationInput.safeParse({...input,rawResponse:'Contact personal@example.org for the answer'}).success).toBe(false);
 expect(visibilityObservationInput.safeParse({...input,evidenceUrl:'https://user:password@example.org'}).success).toBe(false);
 });
 it('limits write and approval actions by label role',async()=>{
 const asRole=(role:'label_viewer'|'label_editor'):CurrentUser=>({...h.currentUser,memberships:h.currentUser.memberships.map(m=>m.labelId===labelId?{...m,role}:m)});
 await expect(h.appContext.services.visibility.addEntity(h.db,asRole('label_viewer'),labelId,{name:'Forbidden',kind:'own',aliases:[],domains:[]})).rejects.toMatchObject({code:'forbidden'});
 await expect(h.appContext.services.visibility.approve(h.db,asRole('label_editor'),labelId,randomUUID())).rejects.toMatchObject({code:'forbidden'});
 });
 it('requires approval, freezes scope, excludes failures, preserves observations and reuses campaign',async()=>{
 const post=(path:string,payload:unknown)=>h.app.inject({method:'POST',url:base+path,payload:payload as Record<string,unknown>});
 expect((await post('/entities',{name:own.name,kind:'own',aliases:own.aliases,domains:own.domains})).statusCode).toBe(200);
 expect((await post('/entities',{name:'Second own',kind:'own',aliases:[],domains:[]})).statusCode).toBe(409);
 const p=await post('/prompts',{courseVersionId:courseId,text:'Welke opleiding past bij mijn professionele ontwikkeling?',family:'keuze',topic:'Opleidingskeuze',intent:'discovery'});expect(p.statusCode,p.body).toBe(200);const promptId=p.json<{id:string}>().id;
 const config={courseVersionId:courseId,name:'Repeatable measurement',promptIds:[promptId],engines:['chatgpt','api_model'],repeats:2};
 expect((await post('/benchmarks',config)).statusCode).toBe(409);
 expect((await post(`/prompts/${promptId}/approve`,{})).statusCode).toBe(200);
 const b=await post('/benchmarks',config);expect(b.statusCode,b.body).toBe(200);const benchmarkId=b.json<{id:string}>().id;
 const key=randomUUID();const start=()=>post(`/benchmarks/${benchmarkId}/runs`,{requestKey:key});const r=await start();expect(r.statusCode,r.body).toBe(200);const runId=r.json<{id:string}>().id;expect((await start()).json()).toEqual({id:runId});
 const input={promptId,engine:'chatgpt',repetition:1,status:'success',rawResponse:'Example Academy biedt een opleiding. Bekijk https://example.nl/opleiding voor informatie.',capturedAt:new Date().toISOString(),citations:['https://example.nl/opleiding'],citationCapture:'unknown',sanitized:true};
 const save=()=>post(`/runs/${runId}/observations`,input);const saved=await save();expect(saved.statusCode,saved.body).toBe(200);expect((await save()).json()).toEqual(saved.json());
 expect((await post(`/runs/${runId}/observations`,{...input,rawResponse:'Een ander antwoord mag de geschiedenis niet overschrijven.'})).statusCode).toBe(409);
 expect((await post(`/runs/${runId}/observations`,{...input,engine:'api_model'})).statusCode).toBe(422);
 expect((await post(`/runs/${runId}/observations`,{...input,engine:'gemini'})).statusCode).toBe(422);
 expect((await post(`/runs/${runId}/observations`,{promptId,engine:'chatgpt',repetition:2,status:'blocked',failureReason:'De pagina is geblokkeerd.',capturedAt:new Date().toISOString(),sanitized:true})).statusCode).toBe(200);
 await post('/entities',{name:'New Rival',kind:'competitor',aliases:[],domains:['rival.nl']});
 const result=await h.app.inject({method:'GET',url:`${base}/runs/${runId}`});expect(result.statusCode,result.body).toBe(200);const run=result.json<VisibilityRun>();
 expect(run.entities).toHaveLength(1);expect(run.status).toBe('partial');
 const m=run.metrics.find(m=>m.engine==='chatgpt'&&m.kind==='unbranded')!;expect(m).toMatchObject({planned:2,successful:1,failed:1,mentionRate:1,citationRate:null,uniquePrompts:1});
 expect(run.metrics.find(m=>m.engine==='api_model'&&m.kind==='unbranded')?.mentionRate).toBeNull();
 const entityId=run.entities[0]!.id;
 expect((await post(`/entities/${entityId}`,{name:'Updated Academy',kind:'own',aliases:[],domains:['new.example.nl']})).statusCode).toBe(200);
 const unchanged=(await h.app.inject({method:'GET',url:`${base}/runs/${runId}`})).json<VisibilityRun>();expect(unchanged.entities[0]?.name).toBe(own.name);expect(unchanged.metrics).toEqual(run.metrics);
 const other=labelIdBySlug(h.seed,'demolabel-3');
 expect((await h.app.inject({method:'GET',url:`${base.replace(labelId,other)}/runs/${runId}`})).statusCode).toBe(404);
 await h.db.update(courseVersions).set({reviewState:'approved'}).where(eq(courseVersions.id,courseId));
 const observationId=saved.json<{id:string}>().id;const campaign=await post(`/runs/${runId}/campaigns`,{observationId});expect(campaign.statusCode,campaign.body).toBe(200);
 expect((await post(`/runs/${runId}/campaigns`,{observationId})).json()).toEqual(campaign.json());
 const stored=await h.appContext.services.campaigns.requireById(h.db,labelId,campaign.json<{id:string}>().id);
 expect(stored.suppliedBrief).toContain(runId);expect(stored.suppliedBrief).toContain(input.rawResponse);

 });
});
