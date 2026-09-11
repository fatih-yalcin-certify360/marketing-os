import {z} from 'zod';
export const geoStartInput=z.object({mode:z.enum(['web_research','chatgpt']).default('web_research'),courseVersionId:z.uuid(),courseUrl:z.url({protocol:/^https$/u}).max(2048),questions:z.array(z.string().trim().min(10).max(500)).min(1).max(5),approved:z.literal(true),requestKey:z.uuid()});
export const geoAnalysis=z.object({summary:z.string().max(1500),items:z.array(z.object({question:z.string().max(500),relevance:z.enum(['relevant','not_relevant','unknown']),evidence:z.array(z.object({url:z.string().max(2048),quote:z.string().min(10).max(800)})).max(5),finding:z.string().max(1500),pageChange:z.object({placement:z.string().max(300),reason:z.string().max(1000),proposedText:z.string().max(3000)}).nullable(),blog:z.object({title:z.string().max(180),body:z.string().max(6500),internalLinkText:z.string().max(180)}).nullable(),limitations:z.string().max(1000)})).max(5)});
export type GeoAnalysis=z.infer<typeof geoAnalysis>;
export interface GeoReport {id:string;courseVersionId:string;courseName:string;labelName:string;courseUrl:string;createdAt:string;jobId:string;questions:string[];analysis:GeoAnalysis;pages:{url:string;role:'course_page'|'reference';text:string;retrievedAt:string;hash:string}[];failures:{url:string;reason:string}[];isMock:boolean;brandVersionId:string;promptVersion:string;method:'web_research'|'chatgpt';engineAnswers?:GeoEngineAnswer[];analysisStatus?:'complete'|'unavailable';}
export interface GeoSetup {labelName:string;courseName:string;courseUrl:string|null;questions:string[];canSearch:boolean;canMeasureChatgpt?:boolean;}

export interface GeoEngineAnswer {
 question:string;engine:'chatgpt';provider:'bright_data';status:'succeeded'|'failed';
 answer:string;model:string|null;country:string|null;capturedAt:string|null;webSearchTriggered:boolean|null;
 sources:{url:string;title:string;kind:'citation'|'search_source'|'attached_link'}[];
 citationStatus:'available'|'unknown';error:string|null;
}
