import { z } from 'zod';
import type { CampaignPackageReport } from './campaign-package.js';
export const reviewCriteria = {
  facts: 'Feiten en brongebruik', usefulness: 'Nut voor de doelgroep',
  originality: 'Eigen waarde boven de bron', brand: 'Merk en toon',
  usability: 'Leesbaarheid en interactie', measurement: 'Vergelijking en meetplan',
} as const;
const assessment=z.object({verdict:z.enum(['pass','revise']),evidence:z.string().trim().min(20).max(2000)});
export const packageReviewInput=z.object({
  decision:z.enum(['needs_changes','ready_for_pilot']),
  criteria:z.object({facts:assessment,usefulness:assessment,originality:assessment,brand:assessment,usability:assessment,measurement:assessment}),
  comparisonReference:z.string().trim().min(10).max(2000),
  testPlan:z.string().trim().min(30).max(3000),
  baselineMinutes:z.number().finite().min(0).max(100000).nullable(),
  editingMinutes:z.number().finite().min(0).max(100000).nullable(),
}).refine(r=>r.decision!=='ready_for_pilot'||Object.values(r.criteria).every(c=>c.verdict==='pass'),'Voor een pilot moeten alle criteria door de beoordelaar zijn geaccepteerd.');
export type PackageReviewInput=z.infer<typeof packageReviewInput>;
export interface PackageReviewRecord {id:string;createdAt:string;reviewerUserId:string;assessment:PackageReviewInput;}
export function packageQualityDossier(report:CampaignPackageReport,stale=false){
  const textRules=Boolean(report.brand.tone.description.trim()||report.brand.tone.traits.length||report.brand.rules.length||report.brand.portal?.contentInstructions.trim());
  const sources=report.sourceSnapshot;
  const usedQuestions=sources?.keywords?.items.filter(k=>report.content?.evidenceIds.includes(k.id))??[];
  return {
    schemaVersion:1,
    scope:'Bewijs van herkomst en beschikbare controles; geen automatische inhoudelijke goedkeuring of effectmeting.',
    versions:{campaign:report.campaignId,brief:report.briefVersionId,course:report.courseVersionId,brand:report.brand.id,prompt:report.promptVersion,radar:report.sourceRadarRunId},
    checks:[
      {id:'real',label:'Echte generatie',status:report.isMock?'missing':'present',detail:report.isMock?'Demodata; niet als praktijkbewijs gebruiken.':'Niet als mock geregistreerd. Dit bewijst geen inhoudelijke juistheid.'},
      {id:'current',label:'Versies actueel',status:stale?'missing':'present',detail:stale?'Briefing, cursus of merk is gewijzigd.':'Snapshot beschikbaar; actuele status wordt bij openen en downloaden opnieuw gecontroleerd.'},
      {id:'facts',label:'Eigen opleidingsfeiten',status:report.confirmedFacts.length?'present':'missing',detail:`${String(report.confirmedFacts.length)} gecontroleerde feiten als input. Geen automatische controle van alle outputclaims.`},
      {id:'sources',label:'Onderzoekscontext',status:sources?'present':'missing',detail:sources?'Bronnen vastgelegd; een bron bewijst niet dat de creatieve interpretatie klopt.':'Geen radarsnapshot; onderbouwing komt uit briefing en cursusgegevens.'},
      {id:'brand',label:'Tekstuele merkregels',status:textRules?'present':'missing',detail:textRules?'Tekstregels aanwezig; toepassing moet een redacteur beoordelen.':'Tekstuele merkregels ontbreken. Kleuren en fonts bewijzen geen juiste tone of voice.'},
    ],
    facts:report.confirmedFacts,
    sources:[...(sources?.cards??[]).map(c=>({id:c.id,url:c.sourceUrl,excerpt:c.excerpt,retrievedAt:c.retrievedAt,role:'Onderzoekscontext, geen gemeten effect'})),...usedQuestions.map(k=>({id:k.id,url:k.sourceUrl,excerpt:k.excerpt,retrievedAt:k.retrievedAt,role:'Door generator gekoppelde bronvraag; inhoudelijke relevantie niet automatisch geverifieerd'}))],
    hypotheses:report.recommendations?.items.filter(r=>report.selected.includes(r.type))??[],
    unresolved:[...(report.brand.portal?.warnings??[]),...(report.content?.reviewNotes??[]),'Geen volledige bronkoppeling per afzonderlijke claim.','Geen doelgroeptest of conversieresultaat automatisch geregistreerd.','Technische tests bewijzen werking; geen originaliteit, relevantie of marketingeffect.'],
    nextAction:stale?'Maak eerst een versie met de actuele briefing en merkregels.':'Laat een inhoudsdeskundige vergelijken met een bestaand stuk en leg de beoordeling vast.',
  };
}
