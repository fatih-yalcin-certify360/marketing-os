import {BrightDataCapture} from './bright-data.js';
import {sql} from 'drizzle-orm';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {geoAnalysis,geoStartInput,type GeoReport,type GeoSetup,type GeoAnalysis,type GeoEngineAnswer,type CurrentUser} from '@c360/contracts';
import type {Db} from '../../core/db/types.js';
import type {GenerationService} from '../../core/ai/generation.js';
import type {CourseService} from '../courses/service.js';
import type {BrandService} from '../brand/service.js';
import type {ServerEnv} from '@c360/config';
import {requireLabelPermission} from '../../core/authz/policy.js';
import {AppError} from '../../core/errors/app-error.js';
import {safeFetch,inspectUrl,extractReadableText} from '../../core/net/index.js';
const discovery=z.object({urls:z.array(z.string()).max(6)});
const norm=(s:string)=>s.replace(/\s+/gu,' ').trim().toLowerCase();
export function verifyGeoAnalysis(analysis:GeoAnalysis,questions:string[],pages:GeoReport['pages'],courseReadable:boolean):GeoAnalysis{
 return {...analysis,items:questions.map(question=>{
 const item=analysis.items.find(i=>norm(i.question)===norm(question));
 if(!item)return {question,relevance:'unknown' as const,evidence:[],finding:'Geen onderbouwd antwoord ontvangen.',pageChange:null,blog:null,limitations:'Deze vraag is niet volledig onderzocht.'};
 const evidence=item.evidence.filter(e=>pages.some(p=>p.url===e.url&&norm(p.text).includes(norm(e.quote))));
 const supported=evidence.length>0&&item.relevance==='relevant';
 return {...item,question,evidence,finding:evidence.length?item.finding:'Geen verifieerbaar bronbewijs gevonden voor deze analyse.',relevance:evidence.length?item.relevance:'unknown' as const,pageChange:supported&&courseReadable&&evidence.some(e=>pages.some(p=>p.role==='course_page'&&p.url===e.url))?item.pageChange:null,blog:supported?item.blog:null,limitations:[item.limitations,...(evidence.length<item.evidence.length?['Niet-verifieerbare citaten weggelaten.']:[]),...(!courseReadable?['Eigen cursuspagina niet leesbaar; geen gerichte pagina-ingreep vastgesteld.']:[])].join(' ')};
 })};
}
export class GeoService {
 constructor(private readonly generation:GenerationService,private readonly courses:CourseService,private readonly brand:BrandService,private readonly env:ServerEnv,private readonly fetchPage:typeof safeFetch=safeFetch,private readonly captureEngine:BrightDataCapture|undefined=env.BRIGHT_DATA_API_KEY?new BrightDataCapture(env.BRIGHT_DATA_API_KEY):undefined){}
 async setup(db:Db,user:CurrentUser,labelId:string,courseId:string):Promise<GeoSetup>{
 requireLabelPermission(user,labelId,'research:read');const course=await this.courses.requireVersion(db,labelId,courseId);
 const labels=await db.execute(sql`SELECT name FROM labels WHERE id=${labelId}`);const settings=await db.execute(sql`SELECT course_url FROM geo_course_settings WHERE label_id=${labelId} AND course_version_id=${courseId}`);
 const candidate=settings.rows[0]?.course_url??course.sourceRef;
 const courseUrl=typeof candidate==='string'&&inspectUrl(candidate,{allowedHostSuffixes:[],allowInsecureHttp:false}).ok?candidate:null;
 return {labelName:z.string().parse(labels.rows[0]?.name),courseName:course.name,courseUrl,canSearch:this.generation.supportsWebSearch,canMeasureChatgpt:!!this.captureEngine,questions:[`Voor wie is ${course.name} geschikt en wanneer kies je een andere opleiding?`,`Welke vaardigheden leer je bij ${course.name} en hoe gebruik je die in de praktijk?`,`Hoe vergelijk je aanbieders van ${course.name} en welke vragen stel je vooraf?`]};
 }
 async validate(db:Db,user:CurrentUser,labelId:string,body:unknown){requireLabelPermission(user,labelId,'research:run');const input=geoStartInput.parse(body);await this.courses.requireVersion(db,labelId,input.courseVersionId);if(input.mode==='chatgpt'&&!this.captureEngine)throw new AppError('capability_unavailable',{publicMessage:'Configureer BRIGHT_DATA_API_KEY op de server om ChatGPT-antwoorden op te halen.'});if(input.mode==='web_research'&&!this.generation.supportsWebSearch)throw new AppError('capability_unavailable',{publicMessage:'De ingestelde AI-provider ondersteunt geen webzoeken. Configureer een provider met webzoeken.'});if(!inspectUrl(input.courseUrl,{allowedHostSuffixes:[],allowInsecureHttp:false}).ok)throw new AppError('validation_failed',{publicMessage:'Gebruik een openbare HTTPS-cursuspagina.'});if(new Set(input.questions.map(norm)).size!==input.questions.length)throw new AppError('validation_failed',{publicMessage:'Kies verschillende vragen.'});return input;}
 async engineAnswers(db:Db,user:CurrentUser,labelId:string,jobId:string):Promise<GeoEngineAnswer[]>{requireLabelPermission(user,labelId,'research:read');const rows=await db.execute(sql`SELECT answers FROM geo_engine_captures WHERE label_id=${labelId} AND job_id=${jobId} AND state='ready'`);return rows.rows[0]?.answers as GeoEngineAnswer[]??[];}
 async saveUrl(db:Db,labelId:string,courseId:string,url:string){await db.execute(sql`INSERT INTO geo_course_settings(label_id,course_version_id,course_url) VALUES(${labelId},${courseId},${url}) ON CONFLICT(label_id,course_version_id) DO UPDATE SET course_url=EXCLUDED.course_url,updated_at=now()`);}
 async list(db:Db,user:CurrentUser,labelId:string,search:string){requireLabelPermission(user,labelId,'research:read');const rows=await db.execute(sql`SELECT id,course_version_id,created_at,report->>'courseName' course_name,report->'analysis'->>'summary' summary,report->>'isMock' is_mock FROM geo_reports WHERE label_id=${labelId} AND report::text ILIKE ${'%'+search+'%'} ORDER BY created_at DESC LIMIT 100`);return rows.rows;}
 async get(db:Db,user:CurrentUser,labelId:string,id:string):Promise<GeoReport>{requireLabelPermission(user,labelId,'research:read');const rows=await db.execute(sql`SELECT report FROM geo_reports WHERE label_id=${labelId} AND id=${id}`);if(!rows.rows[0])throw AppError.notFoundOrForbidden('geo_report',id);return rows.rows[0].report as GeoReport;}
 async research(db:Db,user:CurrentUser,input:z.input<typeof geoStartInput>&{labelId:string;jobId:string;attempt:number;progress?:(percent:number,message:string)=>Promise<void>;signal?:AbortSignal}):Promise<GeoReport>{
 await this.validate(db,user,input.labelId,input);const old=await db.execute(sql`SELECT id FROM geo_reports WHERE label_id=${input.labelId} AND job_id=${input.jobId}`);if(old.rows[0]){const previous=await this.get(db,user,input.labelId,String(old.rows[0].id));if(previous.analysisStatus!=='unavailable')return previous;}
 const setup=await this.setup(db,user,input.labelId,input.courseVersionId);const course=await this.courses.requireVersion(db,input.labelId,input.courseVersionId);
 const engineAnswers=input.mode==='chatgpt'?await this.captureEngine!.capture(db,input.labelId,input.jobId,input.questions,async()=>{await input.progress?.(5,'ChatGPT-antwoorden ophalen via Bright Data');}):undefined;
 const brand=await this.brand.requireCurrent(db,input.labelId);
 const common={organizationId:user.organizationId,labelId:input.labelId,jobId:input.jobId,attempt:input.attempt,signal:input.signal};
 const cached=await db.execute(sql`SELECT snapshot FROM geo_research_sources WHERE job_id=${input.jobId} AND label_id=${input.labelId}`);
 const pages:GeoReport['pages']=[];const failures:GeoReport['failures']=[];let courseReadable=false;let searchIsMock:boolean;
 if(cached.rows[0]){const snapshot=cached.rows[0].snapshot as {pages:GeoReport['pages'];failures:GeoReport['failures'];courseReadable:boolean;isMock:boolean};pages.push(...snapshot.pages);failures.push(...snapshot.failures);courseReadable=snapshot.courseReadable;searchIsMock=snapshot.isMock;}
 else {
 await input.progress?.(10,'Goedgekeurde vragen op het web onderzoeken');
 const found=input.mode==='chatgpt'?null:await this.generation.generate(db,{...common,template:'geo.discover',schema:discovery,webSearch:true,context:{language:'nl',course,brand:null,pageText:JSON.stringify({questions:input.questions,courseUrl:input.courseUrl,label:setup.labelName})}});
 const urls=[input.courseUrl,...(engineAnswers?engineSourceUrls(engineAnswers):(found?.sources??[]).filter(url=>found!.value.urls.includes(url)))];

 for(const [i,url] of [...new Set(urls)].slice(0,7).entries()){
 await input.progress?.(25+i*6,`Bron ${String(i+1)} lezen`);
 const result=await this.fetchPage(url,{timeoutMs:this.env.RESEARCH_FETCH_TIMEOUT_MS,maxResponseBytes:this.env.RESEARCH_MAX_RESPONSE_BYTES,maxRedirects:this.env.RESEARCH_MAX_REDIRECTS,allowedHostSuffixes:this.env.RESEARCH_ALLOWED_HOST_SUFFIXES,allowInsecureHttp:false});
 if(!result.ok){failures.push({url,reason:result.reasonNl});continue;}
 const text=extractReadableText(result.body,12000).text;if(text.length<100){failures.push({url,reason:'Te weinig leesbare inhoud.'});continue;}
 if(url===input.courseUrl)courseReadable=true;
 pages.push({url:result.finalUrl,role:url===input.courseUrl?'course_page':'reference',text,retrievedAt:result.retrievedAt.toISOString(),hash:createHash('sha256').update(text).digest('hex')});
 }
 searchIsMock=found?.isMock??false;
 if(pages.length)await db.execute(sql`INSERT INTO geo_research_sources(job_id,label_id,snapshot) VALUES(${input.jobId},${input.labelId},${JSON.stringify({pages,failures,courseReadable,isMock:searchIsMock})}::jsonb) ON CONFLICT(job_id) DO NOTHING`);
 }
 if(!pages.length&&!engineAnswers)throw new AppError('capability_unavailable',{publicMessage:'Geen leesbare bronnen gevonden. Controleer de cursus-URL en probeer opnieuw.'});
 await input.progress?.(75,'Bronnen vergelijken en pagina- en blogvoorstellen schrijven');
 let analyzed;
 try {analyzed=await this.generation.generate(db,{...common,template:'geo.analyze',schema:geoAnalysis,context:{language:'nl',course,brand,pageText:JSON.stringify({questions:input.questions,courseUrl:input.courseUrl,courseReadable,pages,failures,engineAnswers})}});}
 catch(error){
 if(engineAnswers){const partial:GeoReport={id:old.rows[0]?String(old.rows[0].id):randomUUID(),courseVersionId:course.id,courseName:course.name,labelName:setup.labelName,courseUrl:input.courseUrl,createdAt:new Date().toISOString(),jobId:input.jobId,questions:input.questions,analysis:{summary:'ChatGPT-antwoorden zijn opgeslagen. De vervolganalyse is niet beschikbaar; probeer dezelfde taak opnieuw om deze af te maken.',items:[]},pages,failures,isMock:false,brandVersionId:brand.id,promptVersion:'not_completed',method:'chatgpt',engineAnswers,analysisStatus:'unavailable'};await db.execute(sql`INSERT INTO geo_reports(id,label_id,course_version_id,job_id,report) VALUES(${partial.id},${input.labelId},${course.id},${input.jobId},${JSON.stringify(partial)}::jsonb) ON CONFLICT(job_id) DO UPDATE SET report=EXCLUDED.report`);}
 throw error;
 }
 const report:GeoReport={id:old.rows[0]?String(old.rows[0].id):randomUUID(),courseVersionId:course.id,courseName:course.name,labelName:setup.labelName,courseUrl:input.courseUrl,createdAt:new Date().toISOString(),jobId:input.jobId,questions:input.questions,analysis:verifyGeoAnalysis(analyzed.value,input.questions,pages,courseReadable),pages,failures,isMock:searchIsMock||analyzed.isMock,brandVersionId:brand.id,promptVersion:analyzed.promptVersion,method:input.mode??'web_research',analysisStatus:'complete',...(engineAnswers?{engineAnswers}:{})};
 await input.progress?.(95,'Onderzoek en voorbeelden opslaan');
 await db.execute(sql`INSERT INTO geo_reports(id,label_id,course_version_id,job_id,report) VALUES(${report.id},${input.labelId},${course.id},${input.jobId},${JSON.stringify(report)}::jsonb) ON CONFLICT(job_id) DO UPDATE SET report=EXCLUDED.report`);
 const saved=await db.execute(sql`SELECT id FROM geo_reports WHERE job_id=${input.jobId} AND label_id=${input.labelId}`);return this.get(db,user,input.labelId,String(saved.rows[0]!.id));
 }
}

/** Round-robin keeps one question from consuming the entire six-source reading budget. */
function engineSourceUrls(answers:GeoEngineAnswer[]):string[]{
 const groups=answers.filter(a=>a.status==='succeeded').map(a=>[...new Set(a.sources.map(s=>{const u=new URL(s.url);for(const key of [...u.searchParams.keys()])if(key.startsWith('utm_'))u.searchParams.delete(key);u.hash='';return u.href;}))]);
 const urls:string[]=[];const maximum=Math.max(0,...groups.map(g=>g.length));
 for(let i=0;i<maximum;i++)for(const group of groups){const url=group[i];if(url&&!urls.includes(url))urls.push(url);}
 return urls;
}
