import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { packageQualityDossier, reviewCriteria, type CampaignPackageRun, type PackageReviewRecord, type PackageReviewInput } from '@c360/contracts';
import { Button, Notice, Badge } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
export function PackageEvidencePanel({run,labelId,canReview}:{run:CampaignPackageRun;labelId:string;canReview:boolean}):ReactNode {
 const [open,setOpen]=useState(false);
 const base=`/labels/${labelId}/campaigns/${run.report.campaignId}/packages/${run.id}`;
 const evidence=useQuery<{brief:{goal:string;coreMessage:string;contentScope:string;cta:string}|null;dossier:ReturnType<typeof packageQualityDossier>;reviews:PackageReviewRecord[]},ApiClientError>({queryKey:['package-evidence',labelId,run.id],enabled:open,queryFn:({signal})=>api.get(`${base}/evidence`,signal)});
 const dossier=evidence.data?.dossier??packageQualityDossier(run.report,run.stale);
 const [decision,setDecision]=useState<PackageReviewInput['decision']>('needs_changes');
 const [notes,setNotes]=useState<Record<string,string>>({});
 const [passes,setPasses]=useState<Record<string,boolean>>({});
 const [comparison,setComparison]=useState('');const [plan,setPlan]=useState('');
 const [baseline,setBaseline]=useState('');const [editing,setEditing]=useState('');
 const save=useMutation<unknown,ApiClientError>({mutationFn:()=>api.post(`${base}/reviews`,{decision,criteria:Object.fromEntries(Object.keys(reviewCriteria).map(key=>[key,{verdict:passes[key]?'pass':'revise',evidence:notes[key]??''}])),comparisonReference:comparison,testPlan:plan,baselineMinutes:baseline===''?null:Number(baseline),editingMinutes:editing===''?null:Number(editing)}),onSuccess:()=>{void evidence.refetch();}});
 const valid=Object.keys(reviewCriteria).every(key=>(notes[key]??'').trim().length>=20)&&comparison.trim().length>=10&&plan.trim().length>=30;
 const pilotBlocked=run.stale||run.report.isMock||dossier.checks.find(c=>c.id==='brand')?.status==='missing'||Object.keys(reviewCriteria).some(k=>!passes[k]);
 return <details className="package-evidence" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Bewijs & kwaliteitsbeoordeling</summary>
 <p><strong>Herkomst is aantoonbaar. Inhoudelijke kwaliteit en effect moeten apart worden beoordeeld.</strong></p>
 <div className="flow-evidence">{dossier.checks.map(c=><div key={c.id}><Badge tone={c.status==='present'?'neutral':'amber'}>{c.status==='present'?'Aanwezig':'Ontbreekt / gewijzigd'}</Badge> <strong>{c.label}</strong><p>{c.detail}</p></div>)}</div>
 <p>{dossier.nextAction}</p>
 {evidence.data?.brief&&<section><h4>De briefing achter dit pakket</h4><p><strong>Doel:</strong> {evidence.data.brief.goal}</p><p><strong>Boodschap:</strong> {evidence.data.brief.coreMessage}</p><p><strong>Wat leveren we:</strong> {evidence.data.brief.contentScope}</p><p><strong>Volgende stap:</strong> {evidence.data.brief.cta}</p></section>}
 <h4>Waarom deze contentvorm?</h4>{dossier.hypotheses.map(h=><p key={h.type}>{h.reason}<br/><strong>Hypothese:</strong> {h.hypothesis}<br/><strong>Te meten:</strong> {h.measurement}</p>)}
 <details><summary>Bronpassages en open punten</summary>{dossier.sources.map((s,i)=><section key={i}><a href={s.url} target="_blank" rel="noreferrer">{s.url}</a><blockquote>{s.excerpt}</blockquote><p>{s.role} · {new Date(s.retrievedAt).toLocaleDateString('nl-NL')}</p></section>)}{dossier.unresolved.map((text,i)=><p key={i}>{text}</p>)}</details>
 <p><a href={`/api/v1${base}/evidence?download=1`} download>Download bewijsdossier en beoordelingen (JSON)</a></p>
 {evidence.error&&<Notice tone="warning">{evidence.error.userMessage}</Notice>}
 {evidence.data?.reviews.length===0&&<Notice tone="info">Nog geen menselijke beoordeling geregistreerd. Geen doelgroepeffect gemeten.</Notice>}
 {evidence.data?.reviews.map(r=><details key={r.id}><summary>{new Date(r.createdAt).toLocaleString('nl-NL')} — {r.assessment.decision==='ready_for_pilot'?'Beoordelaar: klaar voor pilot':'Verbeteringen nodig'}</summary><p>Beoordelaar: {r.reviewerUserId}. Dit is een vastgelegde beoordeling, geen bewijs van conversiewinst of publicatiegoedkeuring.</p>{Object.entries(r.assessment.criteria).map(([key,c])=><p key={key}><strong>{reviewCriteria[key as keyof typeof reviewCriteria]} — {c.verdict==='pass'?'Geaccepteerd':'Aanpassen'}:</strong> {c.evidence}</p>)}<p>Vergelijking: {r.assessment.comparisonReference}</p><p>Meetplan: {r.assessment.testPlan}</p><p>Door beoordelaar opgegeven minuten: referentie {r.assessment.baselineMinutes??'niet gemeten'} · nabewerking {r.assessment.editingMinutes??'niet gemeten'}. Geen automatische tijdmeting.</p>{run.stale&&<Notice tone="warning">Deze beoordeling hoort bij een inmiddels verouderde versie.</Notice>}</details>)}
 {canReview&&<details><summary>Menselijke beoordeling vastleggen</summary><p>Deze beoordeling geldt voor het hele pakket: {run.report.selected.map(type=>({blog_faq:'blog en FAQ',fit_check:'interactief verhaal',google_studio:'Studio banners'})[type]).join(', ')}. Bekijk eerst de bron en alle echte bestanden. Noteer per criterium een concreet voorbeeld of gebrek (minimaal 20 tekens). Een AI-oordeel telt niet als onafhankelijke beoordeling.</p><form onSubmit={event=>{event.preventDefault();save.mutate();}}>
 {Object.entries(reviewCriteria).map(([key,label])=><fieldset key={key} className="radar-deliverables"><legend>{label}</legend><label><input type="checkbox" checked={passes[key]??false} onChange={e=>setPasses({...passes,[key]:e.target.checked})}/> Door mij beoordeeld en geaccepteerd</label><label className="c360-field">Concrete onderbouwing<textarea required minLength={20} maxLength={2000} value={notes[key]??''} onChange={e=>setNotes({...notes,[key]:e.target.value})}/></label></fieldset>)}
 <label className="c360-field">Vergelijkingsmateriaal (titel/URL en wat je vergeleek)<textarea required minLength={10} maxLength={2000} value={comparison} onChange={e=>setComparison(e.target.value)}/></label>
 <label className="c360-field">Pilotplan: doelgroep, taak, primaire maat, vergelijkingsbasis en evaluatiemoment<textarea required minLength={30} maxLength={3000} value={plan} onChange={e=>setPlan(e.target.value)}/></label>
 <label className="c360-field">Gemeten referentietijd (minuten; leeg als onbekend)<input type="number" min={0} max={100000} step="any" value={baseline} onChange={e=>setBaseline(e.target.value)}/></label><label className="c360-field">Gemeten nabewerkingstijd (minuten; leeg als onbekend)<input type="number" min={0} max={100000} step="any" value={editing} onChange={e=>setEditing(e.target.value)}/></label>
 <label className="c360-field">Besluit<select value={decision} onChange={e=>setDecision(e.target.value as typeof decision)}><option value="needs_changes">Verbeteringen nodig</option><option value="ready_for_pilot" disabled={pilotBlocked}>Klaar voor beperkte pilot — geen publicatiegoedkeuring</option></select></label>
 {pilotBlocked&&<p>Een pilotbesluit vereist alle criteria geaccepteerd, actuele echte output en tekstuele merkregels.</p>}
 <Button type="submit" disabled={!valid||save.isPending||(decision==='ready_for_pilot'&&pilotBlocked)}>Beoordeling opslaan</Button>{save.error&&<Notice tone="warning">{save.error.userMessage}</Notice>}{save.isSuccess&&<Notice tone="info">Beoordeling vastgelegd voor deze pakketversie.</Notice>}
 </form></details>}
 </details>;
}
