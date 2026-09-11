import {setTimeout as delay} from 'node:timers/promises';
import {sql} from 'drizzle-orm';
import type {GeoEngineAnswer} from '@c360/contracts';
import type {Db} from '../../core/db/types.js';
import {AppError} from '../../core/errors/app-error.js';

const record=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const str=(v:unknown):string|null=>typeof v==='string'&&v.trim()?v:null;
const unavailable=(message:string)=>new AppError('capability_unavailable',{publicMessage:message});
function sourceUrl(v:unknown):string|null {try{const u=new URL(String(v));return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
/** No HTML is rendered or retained. Source positions are not recommendation ranks. */
export function parseBrightAnswers(data:unknown,questions:string[]):GeoEngineAnswer[]{
 const rows=Array.isArray(data)?data:[];
 return questions.map(question=>{
  const matches=rows.map(record).filter(r=>r.prompt===question);
  const r=matches.length===1?matches[0]!:{};
  const answer=str(r.answer_text_raw)??str(r.answer_text)??str(r.answer_text_markdown)??'';
  const sources:GeoEngineAnswer['sources']=[];
  for(const [field,kind] of [['citations','citation'],['search_sources','search_source'],['links_attached','attached_link']] as const){
   const entries=r[field];if(!Array.isArray(entries))continue;
   for(const value of entries){const item=record(value);const url=sourceUrl(item.url);if(url&&!sources.some(s=>s.url===url&&s.kind===kind))sources.push({url,title:(str(item.title)??str(item.text)??url).slice(0,500),kind});}
  }
  const ok=!!answer&&!r.error&&!r.error_code&&matches.length===1;
  return {question,engine:'chatgpt',provider:'bright_data',status:ok?'succeeded':'failed',answer:ok?answer:'',sources:ok?sources:[],model:str(r.model),country:str(r.country),capturedAt:str(r.prompt_sent_at)??str(r.timestamp),webSearchTriggered:typeof r.web_search_triggered==='boolean'?r.web_search_triggered:null,citationStatus:ok&&sources.some(s=>s.kind==='citation')?'available':'unknown',error:ok?null:'Geen eenduidig, bruikbaar antwoord ontvangen voor deze vraag. Dit telt niet als afwezigheid van het merk.'};
 });
}
export class BrightDataCapture {
 constructor(private readonly apiKey:string,private readonly request:typeof fetch=fetch,private readonly pause:()=>Promise<void>=()=>delay(5000)){}
 private async call(path:string,body?:unknown):Promise<unknown>{
  let response:Response;
  try {response=await this.request(`https://api.brightdata.com/datasets/v3/${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000),redirect:'error'});}catch{throw unavailable('Bright Data niet bereikbaar. Een verzonden aanvraag wordt niet automatisch opnieuw besteld.');}
  if(!response.ok)throw unavailable(`Bright Data gaf HTTP ${String(response.status)}. Controleer toegang en tegoed in het providerdashboard.`);
  // A five-question pilot must never download an unbounded provider response.
  const reader=response.body?.getReader();if(!reader)throw unavailable('Leeg antwoord van Bright Data.');
  const chunks:Uint8Array[]=[];let bytes=0;
  for(;;){const next=await reader.read();if(next.done)break;const chunk:unknown=next.value;if(!(chunk instanceof Uint8Array))throw unavailable('Ongeldige antwoordstream.');bytes+=chunk.byteLength;if(bytes>12_000_000){await reader.cancel();throw unavailable('Bright Data antwoord is te groot.');}chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}catch{throw unavailable('Bright Data gaf geen geldig JSON-antwoord.');}
 }
 async capture(db:Db,labelId:string,jobId:string,questions:string[],checkpoint:()=>Promise<void>=()=>Promise.resolve()):Promise<GeoEngineAnswer[]>{
  await checkpoint();
  const existing=await db.execute(sql`SELECT state,snapshot_id,answers FROM geo_engine_captures WHERE job_id=${jobId} AND label_id=${labelId}`);
  const row=existing.rows[0];if(row?.state==='ready')return row.answers as GeoEngineAnswer[];
  let snapshotId=str(row?.snapshot_id);let result:unknown;
  if(!row){
   // Persist before charging: an ambiguous network failure must not cause duplicate purchases.
   const claimed=await db.execute(sql`INSERT INTO geo_engine_captures(job_id,label_id,state) VALUES(${jobId},${labelId},'submitted') ON CONFLICT(job_id) DO NOTHING RETURNING job_id`);
   if(!claimed.rows.length)throw unavailable('Deze meting is al gestart.');
   result=await this.call('scrape?dataset_id=gd_m7aof0k82r803d5bjm&include_errors=true',{input:questions.map(prompt=>({url:'https://chatgpt.com/',prompt,country:'NL',web_search:true}))});
   snapshotId=str(record(result).snapshot_id);
   if(snapshotId){if(!/^[a-zA-Z0-9_-]+$/u.test(snapshotId))throw unavailable('Ongeldig snapshot-ID.');await db.execute(sql`UPDATE geo_engine_captures SET snapshot_id=${snapshotId} WHERE job_id=${jobId} AND label_id=${labelId}`);}
  }else if(!snapshotId){throw unavailable('Eerdere aanvraag heeft een onbekende afleverstatus. Controleer Bright Data voordat je een nieuw onderzoek start; opnieuw proberen bestelt geen tweede meting.');}
  if(snapshotId){
   for(let i=0;i<60;i++){
    await checkpoint();
    const progress=record(await this.call(`progress/${encodeURIComponent(snapshotId)}`));
    if(progress.status==='failed')throw unavailable('Bright Data kon deze meting niet uitvoeren.');
    if(progress.status==='ready'){result=await this.call(`snapshot/${encodeURIComponent(snapshotId)}?format=json`);if(Array.isArray(result))break;}
    await this.pause();
   }
   if(!Array.isArray(result))throw unavailable('Meting loopt nog bij Bright Data. Opnieuw proberen haalt dezelfde meting op zonder nieuwe bestelling.');
  }
  const answers=parseBrightAnswers(result,questions);
  await db.execute(sql`UPDATE geo_engine_captures SET state='ready',answers=${JSON.stringify(answers)}::jsonb WHERE job_id=${jobId} AND label_id=${labelId}`);
  return answers;
 }
}
