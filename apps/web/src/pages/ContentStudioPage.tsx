import { PackageEvidencePanel } from '../components/PackageEvidencePanel.js';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Campaign, CampaignPackageRun, LabelSummary } from '@c360/contracts';
import { CHANNEL_LABEL_NL } from '@c360/contracts';
import { Badge, Button, Card, Notice } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { assetImageUrl, useCampaigns, type CampaignDetail } from '../api/campaign-queries.js';
import './radar.css';
const reviewLabels={draft:'Concept',in_review:'Ter beoordeling',changes_requested:'Wijziging gevraagd',approved:'Goedgekeurd',needs_rereview:'Opnieuw beoordelen',archived:'Gearchiveerd'};
const types = {blog_faq:'Blog & FAQ',fit_check:'Interactief verhaal',google_studio:'Google Studio banners',social:'Social & beelden'};
type ContentType = keyof typeof types;
interface Collection { campaign: Campaign; detail: CampaignDetail | null; packages: CampaignPackageRun[]; errors: string[]; }
export function ContentStudioPage({label}:{label:LabelSummary|undefined}):ReactNode {
  return label ? <Studio key={label.id} label={label}/> : <Notice tone="warning">Kies eerst een label.</Notice>;
}
function Studio({label}:{label:LabelSummary}):ReactNode {
  const campaigns=useCampaigns(label.id);
  const [campaignId,setCampaignId]=useState('all');
  const [type,setType]=useState('all');
  const [history,setHistory]=useState(false);
  const [search,setSearch]=useState('');
  const collection=useQuery<Collection[],ApiClientError>({
    queryKey:['studio',label.id,campaigns.data?.items.map(c=>c.id)],enabled:Boolean(campaigns.data),staleTime:30_000,
    queryFn:async({signal})=>{
      const result:Collection[]=[];
      const all=campaigns.data?.items??[];
      // Bound concurrent requests; failed campaigns must not hide other outputs.
      for(let i=0;i<all.length;i+=3){
        signal.throwIfAborted();
        const batch=await Promise.all(all.slice(i,i+3).map(async campaign=>{
          const base=`/labels/${label.id}/campaigns/${campaign.id}`;
          const [detail,packages]=await Promise.allSettled([api.get<CampaignDetail>(base,signal),api.get<{items:CampaignPackageRun[]}>(`${base}/packages`,signal)]);
          return {campaign,detail:detail.status==='fulfilled'?detail.value:null,packages:packages.status==='fulfilled'?packages.value.items:[],errors:[detail,packages].flatMap(r=>r.status==='rejected'?['Een deel van de content kon niet worden geladen.']:[])};
        }));result.push(...batch);
      }return result;
    },
  });
  const rows=(collection.data??[]).filter(row=>campaignId==='all'||row.campaign.id===campaignId);
  const entries=rows.flatMap(row=>{
    const seen=new Set<string>();
    return row.packages.flatMap(run=>run.report.content?run.report.selected.flatMap(kind=>{
      const duplicate=seen.has(kind);seen.add(kind);
      return !history&&duplicate?[]:[{row,run,kind}];
    }):[]);
  }).filter(({row,run,kind})=>(type==='all'||type===kind)&&`${row.campaign.name} ${run.report.content!.title}`.toLowerCase().includes(search.toLowerCase()));
  const social=rows.flatMap(row=>(row.detail?.assets??[]).map(asset=>({row,asset}))).filter(({row,asset})=>(type==='all'||type==='social')&&`${row.campaign.name} ${asset.copy.hook} ${asset.copy.body}`.toLowerCase().includes(search.toLowerCase()));
  const loading=campaigns.isPending||(Boolean(campaigns.data)&&collection.isPending);
  return <>
    <header><h1 className="c360-page-title">Content Studio</h1><p className="c360-page-lead">Je gemaakte content, over alle campagnes heen. Bekijk teksten en beelden, controleer de status en download je pakket.</p><Link to="/campagnes">Campagnes en briefings beheren →</Link></header>
    <Card ariaLabel="Content filteren"><div className="studio-filters">
      <label className="c360-field">Campagne<select value={campaignId} onChange={e=>setCampaignId(e.target.value)}><option value="all">Alle campagnes</option>{campaigns.data?.items.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="c360-field">Contenttype<select value={type} onChange={e=>setType(e.target.value)}><option value="all">Alle content</option>{Object.entries(types).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <label className="c360-field">Zoeken<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Titel of campagne"/></label>
      <Button onClick={()=>{void campaigns.refetch();void collection.refetch();}} disabled={loading}>Vernieuwen</Button>
    </div><label><input type="checkbox" checked={history} onChange={e=>setHistory(e.target.checked)}/> Ook eerdere pakketversies tonen</label><p className="c360-card__hint">Standaard de nieuwste beschikbare pakketversie per contenttype en campagne. Social toont de huidige assetversies. Een concept of verouderd pakket is niet publicatieklaar.</p></Card>
    {(campaigns.error??collection.error)&&<Notice tone="warning">{(campaigns.error??collection.error)?.userMessage}</Notice>}
    {collection.data?.filter(row=>row.errors.length).map(row=><Notice key={row.campaign.id} tone="warning">{row.campaign.name}: een deel van de content ontbreekt door een laadfout. Vernieuw om opnieuw te proberen.</Notice>)}
    {loading?<p>Content verzamelen…</p>:<p>{entries.length+social.length} onderdelen in deze selectie</p>}
    {!loading&&!entries.length&&!social.length&&<Notice tone="info">Geen content in deze selectie. Maak in een campagne eerst een contentpakket of pas de filters aan.</Notice>}
    <div className="radar-grid">
      {entries.map(({row,run,kind})=><PackageCard key={`${run.id}:${kind}`} campaign={row.campaign} run={run} kind={kind} label={label}/>)}
      {social.map(({row,asset})=><Card key={asset.id} ariaLabel={asset.copy.hook}><Badge tone={asset.reviewState==='approved'?'green':'amber'}>{reviewLabels[asset.reviewState]}</Badge><p className="c360-card__hint">{CHANNEL_LABEL_NL[asset.channel]} · {row.campaign.name} · v{asset.version}</p><h2>{asset.copy.hook}</h2><p style={{whiteSpace:'pre-wrap'}}>{asset.copy.body}</p><div className="c360-row">{asset.variants.filter(v=>v.imageAssetId).map(v=><a key={v.variant} href={assetImageUrl(label.id,v.imageAssetId!)} target="_blank" rel="noreferrer"><img style={{width:160,maxWidth:'100%',borderRadius:12}} src={assetImageUrl(label.id,v.imageAssetId!)} alt={asset.copy.imageAltText??`Variant ${v.variant}`} loading="lazy"/></a>)}</div>{asset.warnings.map((w,i)=><p key={i}>{w.messageNl}</p>)}<Link to={`/campagnes/${row.campaign.id}?fase=social`}>Bekijken, bewerken en beoordelen →</Link></Card>)}
    </div>
  </>;
}
function PackageCard({campaign,run,kind,label}:{campaign:Campaign;run:CampaignPackageRun;kind:Exclude<ContentType,'social'>;label:LabelSummary}):ReactNode {
 const content=run.report.content!;
 return <Card ariaLabel={`${types[kind]}: ${content.title}`}><Badge tone={run.stale?'amber':'neutral'}>{run.stale?'Verouderd · opnieuw maken':'Concept · controleren'}</Badge>{run.report.isMock&&<Badge tone="amber">Demodata</Badge>}<p className="c360-card__hint">{types[kind]} · {campaign.name}</p><h2>{kind==='google_studio'?content.banner.headline:content.title}</h2><p>{kind==='google_studio'?content.banner.body:content.intro}</p>
 <PackageEvidencePanel run={run} labelId={label.id} canReview={label.role==='label_manager'||label.role==='label_approver'}/>
 <details><summary>Tekstinhoud bekijken</summary>{kind==='blog_faq'&&<>{content.sections.map((s,i)=><section key={i}><h3>{s.heading}</h3><p>{s.text}</p></section>)}{content.faq.map((f,i)=><section key={i}><h3>{f.question}</h3><p>{f.answer}</p></section>)}</>}{kind==='fit_check'&&content.reflection.map((q,i)=><section key={i}><h3>{q.question}</h3>{q.options.map((o,j)=><p key={j}><strong>{o.label}</strong> — {o.guidance}</p>)}</section>)}{kind==='google_studio'&&<><h3>{content.banner.question}</h3>{content.banner.options.map((o,i)=><p key={i}>{o.label} — {o.feedback}</p>)}<p>300×250 · 336×280 · 300×600. De werkende visuele previews staan in het ZIP-pakket; deze kaart toont de copy.</p></>}</details>
 <details><summary>Bronnen en controlepunten</summary><p>Merkversie {run.report.brand.version} · {new Date(run.createdAt).toLocaleString('nl-NL')}</p><p>Briefing: {run.report.briefVersionId}</p><p>{run.report.sourceRadarRunId?`Gekoppelde radar: ${run.report.sourceRadarRunId}`:'Geen radarscan gekoppeld'}</p>{run.report.sourceSnapshot?.keywords?.items.filter(k=>content.evidenceIds.includes(k.id)).map(k=><p key={k.id}><a href={k.sourceUrl} target="_blank" rel="noreferrer">{k.phrase}</a></p>)}{[...(run.report.brand.portal?.warnings??[]),...content.reviewNotes].map((n,i)=><p key={i}>{n}</p>)}</details>
 <p><Link to={`/campagnes/${campaign.id}?fase=package`}>Open campagne en productie →</Link></p>
 {!run.stale&&label.role!=='label_viewer'&&<a href={`/api/v1/labels/${label.id}/campaigns/${campaign.id}/packages/${run.id}/file`} download>Download volledig pakket (ZIP)</a>}
 </Card>;
}
