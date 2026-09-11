import type {VisibilityEntity,VisibilityPrompt,VisibilityObservation,VisibilityMetrics} from '@c360/contracts';
export const normalize=(s:string):string=>s.normalize('NFKC').toLocaleLowerCase('nl-NL').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function termMatch(text:string,term:string):boolean {return ` ${normalize(text)} `.includes(` ${normalize(term)} `);}
export function matchedEntities(text:string,entities:VisibilityEntity[]){
 const links=[...text.matchAll(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[^\s<>]*)?/giu)].map(m=>m[0]);
 const hosts=links.flatMap(link=>{try{return [new URL(link.startsWith('http')?link:`https://${link}`).hostname.toLowerCase().replace(/^www\./u,'')];}catch{return [];}});
 const prose=links.reduce((result,link)=>result.replaceAll(link,' '),text);
 return entities.flatMap(e=>{const term=[e.name,...e.aliases].find(t=>termMatch(prose,t));const host=hosts.find(h=>e.domains.some(d=>h===d||h.endsWith(`.${d}`)));return term||host?[{entityId:e.id,name:e.name,kind:e.kind,evidence:term?`Naam/alias gevonden: ${term}`:`Domein gevonden: ${host!}`}]:[];});
}
export function promptKind(text:string,entities:VisibilityEntity[]):VisibilityPrompt['kind']{
 const found=matchedEntities(text,entities);return found.some(e=>e.kind==='own')?'branded':found.length?'competitor_named':'unbranded';
}
export function canonicalCitation(raw:string):{url:string;domain:string}{const u=new URL(raw);u.hash='';u.hostname=u.hostname.toLowerCase().replace(/^www\./u,'');return {url:u.href,domain:u.hostname};}
export function ownDomain(domain:string,entities:VisibilityEntity[]):boolean{return entities.filter(e=>e.kind==='own').some(e=>e.domains.some(d=>domain===d||domain.endsWith(`.${d}`)));}
export function metrics(prompts:VisibilityPrompt[],entities:VisibilityEntity[],engines:string[],repeats:number,observations:VisibilityObservation[]):VisibilityMetrics[]{
 return engines.flatMap(engine=>['unbranded','branded','competitor_named'].map(kind=>{
 const ids=new Set(prompts.filter(p=>promptKind(p.text,entities)===kind).map(p=>p.id));
 const all=observations.filter(o=>o.engine===engine&&ids.has(o.promptId));const good=all.filter(o=>o.status==='success');
 const mentionCount=good.filter(o=>o.mentions.some(m=>m.kind==='own')).length;
 const eligible=good.filter(o=>o.citationCapture==='complete');const cited=eligible.filter(o=>o.citedDomains.some(d=>ownDomain(d,entities))).length;
 const counts=entities.map(e=>({id:e.id,name:e.name,mentions:good.filter(o=>o.mentions.some(m=>m.entityId===e.id)).length}));const total=counts.reduce((sum,c)=>sum+c.mentions,0);
 return {kind,engine,planned:ids.size*repeats,completed:all.length,successful:good.length,failed:all.length-good.length,uniquePrompts:new Set(good.map(o=>o.promptId)).size,mentionCount,mentionRate:good.length?mentionCount/good.length:null,citationEligible:eligible.length,ownCitationCount:cited,citationRate:eligible.length?cited/eligible.length:null,entities:counts.map(c=>({...c,shareOfVoice:total?c.mentions/total:null})),recommendationRate:null,accuracyRate:null,averageMentionPosition:null};
 }));
}
export function similarPrompts(text:string,prompts:VisibilityPrompt[]):VisibilityPrompt[]{const a=new Set(normalize(text).split(' '));return prompts.filter(p=>{const b=new Set(normalize(p.text).split(' '));return [...a].filter(t=>b.has(t)).length/new Set([...a,...b]).size>=.8;});}
