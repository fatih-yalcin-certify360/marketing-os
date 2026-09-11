import { FlowNavigation } from '../components/FlowNavigation.js';
import { KeywordPanel } from '../components/KeywordPanel.js';
import { AudiencePanel } from '../components/AudiencePanel.js';
import { AdvertisingPanel } from '../components/AdvertisingPanel.js';
import { useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  LabelSummary,
  RadarRun,
  RadarCard,
  JobSummary,
  Campaign,
} from '@c360/contracts';
import { Button, Card, Notice, Badge } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { useCourses } from '../api/campaign-queries.js';
import './radar.css';
const terminal = new Set(['succeeded', 'failed', 'dead', 'cancelled']);
const relation: Record<RadarCard['relationship'], string> = {
  competitor: 'Opleidingsaanbieder',
  adjacent: 'Dezelfde doelgroep',
  own_brand: 'Eigen merk / verbonden aanbod',
  authority: 'Vakbron',
  uncertain: 'Relatie te controleren',
};
const changeLabel = {
  first_seen: 'Eerst gevonden',
  changed: 'Bron gewijzigd',
  unchanged: 'Bron ongewijzigd',
};
export function RadarPage({
  label,
}: {
  label: LabelSummary | undefined;
}): ReactNode {
  return label ? (
    <RadarLabel key={label.id} label={label} />
  ) : (
    <Notice tone="warning">Kies eerst een label.</Notice>
  );
}
function RadarLabel({ label }: { label: LabelSummary }): ReactNode {
  const courses = useCourses(label.id);
  const [selected, setSelected] = useState('');
  const courseId =
    courses.data?.items.find((item) => item.course.id === selected)?.course
      .id ?? courses.data?.items[0]?.course.id;
  return (
    <>
      <header>
        <h1 className="c360-page-title">Marktradar</h1>
        <p className="c360-page-lead">
          Ontdek wat er speelt. Bekijk de bronnen. Maak er een eigen campagne
          van.
        </p>
      </header>
      {courses.isError && (
        <Notice tone="warning">{courses.error.userMessage}</Notice>
      )}
      <Card ariaLabel="Opleiding kiezen">
        <label className="c360-field">
          Voor welke opleiding?
          <select
            value={courseId ?? ''}
            onChange={(event) => {
              setSelected(event.target.value);
            }}
          >
            {courses.data?.items.map((item) => (
              <option key={item.course.id} value={item.course.id}>
                {item.course.name}
              </option>
            ))}
          </select>
        </label>
        {courses.isPending && <p>Opleidingen laden…</p>}
        {courses.data?.items.length === 0 && (
          <p>Voeg eerst een opleiding toe onder Kennis &amp; beheer.</p>
        )}
      </Card>
      {courseId && (
        <RadarCourse key={courseId} label={label} courseId={courseId} />
      )}
    </>
  );
}
function RadarCourse({
  label,
  courseId,
}: {
  label: LabelSummary;
  courseId: string;
}): ReactNode {
  const navigate = useNavigate();
  const base = `/labels/${label.id}/courses/${courseId}/radar`;
  const [urls, setUrls] = useState('');
  const [discover, setDiscover] = useState(true);
  const [includeAds, setIncludeAds] = useState(true);
  const [includeKeywords, setIncludeKeywords] = useState(true);
  const [selectedRun, setSelectedRun] = useState('');
  const [filter, setFilter] = useState('all');
  const [params]=useSearchParams();
  const [tab,setTab]=useState(params.get('tab')==='saved'?'saved':'opportunities');
  const saved=useQuery<{items:{runId:string;card:RadarCard;isMock:boolean}[]},ApiClientError>({queryKey:['radar-saved',label.id,courseId],queryFn:({signal})=>api.get(`${base}/saved`,signal)});
  const bookmark=useMutation<unknown,ApiClientError,{runId:string;cardId:string;remove:boolean}>({mutationFn:input=>{const path=`/labels/${label.id}/radar/${input.runId}/cards/${input.cardId}/save`;return input.remove?api.remove(path):api.post(path);},onSuccess:()=>{void saved.refetch();}});
  const canEdit = label.role !== 'label_viewer';
  const scan = useMutation<JobSummary, ApiClientError>({
    mutationFn: (): Promise<JobSummary> =>
      api.post(`${base}/scan`, {
        discover: discover && reports.data?.canDiscover === true,
        includeAds,
        includeKeywords,
        urls: urls
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: (job) => {
      sessionStorage.setItem(`radar-job:${label.id}:${courseId}`, job.id);
      setSelectedRun('');
    },
  });
  const [restoredJob] = useState(() =>
    sessionStorage.getItem(`radar-job:${label.id}:${courseId}`),
  );
  const jobId = scan.data?.id ?? restoredJob;
  const job = useQuery<JobSummary, ApiClientError>({
    queryKey: ['radar-job', label.id, jobId],
    queryFn: ({ signal }) => api.get(`/jobs/${String(jobId)}`, signal),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      terminal.has(query.state.data?.status ?? '') ? false : 2000,
  });
  const reports = useQuery<
    { items: RadarRun[]; canDiscover: boolean; latestJob: JobSummary | null },
    ApiClientError
  >({
    queryKey: ['radar', label.id, courseId, job.data?.status],
    queryFn: ({ signal }) => api.get(base, signal),
    refetchInterval: (query) =>
      query.state.data?.latestJob &&
      !terminal.has(query.state.data.latestJob.status)
        ? 3000
        : false,
  });
  const run =
    reports.data?.items.find((item) => item.id === selectedRun) ??
    reports.data?.items[0];
  const serverJob = reports.data?.latestJob;
  const visibleJob =
    serverJob && (!job.data || serverJob.createdAt > job.data.createdAt)
      ? serverJob
      : (job.data ?? serverJob);
  const working =
    scan.isPending || Boolean(visibleJob && !terminal.has(visibleJob.status));
  const jobAction = useMutation<unknown, ApiClientError, 'retry' | 'cancel'>({
    mutationFn: (action) =>
      api.post(`/jobs/${String(visibleJob?.id)}/${action}`),
    onSuccess: () => {
      if (jobId) void job.refetch();
      void reports.refetch();
    },
  });
  const create = useMutation<
    Campaign,
    ApiClientError,
    { cardId: string; index: number; runId:string }
  >({
    mutationFn: (input) =>
      api.post(
        `/labels/${label.id}/radar/${input.runId}/cards/${input.cardId}/campaign`,
        { approachIndex: input.index },
      ),
    onSuccess: (campaign) => {
      void navigate(`/campagnes/${campaign.id}`);
    },
  });
  const cards =
    run?.report.cards.filter(
      (card) => filter === 'all' || card.relationship === filter,
    ) ?? [];
  return (
    <>
      <details open={!run || working}><summary>Nieuwe scan instellen</summary>
      <Card title="Een frisse blik op jouw markt" ariaLabel="Markt scannen">
        <p>
          We zoeken naar opleidingsaanbieders, organisaties met dezelfde
          doelgroep en relevante vakinformatie. Je krijgt maximaal vier
          onderbouwde kansen per scan.
        </p>
        <details>
          <summary>Eigen bronnen toevoegen</summary>
          <label className="c360-field">
            Bronlinks, één per regel (maximaal 10)
            <textarea
              rows={4}
              value={urls}
              onChange={(event) => {
                setUrls(event.target.value);
              }}
              placeholder="https://…"
            />
          </label>
        </details>
        <label className="c360-field"><span><input type="checkbox" checked={includeKeywords} disabled={working} onChange={(event) => { setIncludeKeywords(event.target.checked); }} /> Vragen en long-tail zoekvoorstellen onderzoeken</span></label>
        <p className="c360-card__hint">Kies daarna een bevinding om een campagne te starten. Contentvormen en productie volgen na de goedgekeurde briefing.</p>
        <div className="radar-toolbar">
          <label>
            <input
              type="checkbox"
              checked={discover && reports.data?.canDiscover === true}
              disabled={!reports.data?.canDiscover || working}
              onChange={(event) => {
                setDiscover(event.target.checked);
              }}
            />{' '}
            Ook nieuwe bronnen zoeken
          </label>
          <label>
            <input
              type="checkbox"
              checked={includeAds}
              disabled={working}
              onChange={(event) => {
                setIncludeAds(event.target.checked);
              }}
            />{' '}
            Ook Google en sociale advertenties onderzoeken
          </label>
          <Button
            variant="primary"
            disabled={!canEdit || working || reports.isPending}
            onClick={() => {
              scan.mutate();
            }}
          >
            {working ? 'Markt wordt gescand…' : 'Scan de markt'}
          </Button>
        </div>
        {reports.data?.canDiscover === false && (
          <Notice tone="info">
            Automatisch zoeken is niet beschikbaar bij deze aanbieder. Je kunt
            wel eigen bronlinks laten lezen.
          </Notice>
        )}
        {(scan.error ?? job.error ?? reports.error) && (
          <Notice tone="warning">
            {(scan.error ?? job.error ?? reports.error)?.userMessage}
          </Notice>
        )}
        {working && (
          <Notice tone="info" live>
            {visibleJob?.progress?.message ?? 'Scan wordt gestart…'}
          </Notice>
        )}
        {visibleJob?.failureMessage && (
          <Notice tone="warning">{visibleJob.failureMessage}</Notice>
        )}
        {jobAction.error && (
          <Notice tone="warning">{jobAction.error.userMessage}</Notice>
        )}
        {canEdit && visibleJob?.retryable && (
          <Button
            disabled={jobAction.isPending}
            onClick={() => {
              jobAction.mutate('retry');
            }}
          >
            Scan opnieuw proberen
          </Button>
        )}
        {canEdit && working && visibleJob && (
          <Button
            disabled={jobAction.isPending}
            onClick={() => {
              jobAction.mutate('cancel');
            }}
          >
            Scan annuleren
          </Button>
        )}
        {job.data?.status === 'cancelled' && (
          <Notice tone="info">
            Scan geannuleerd. Eerdere resultaten blijven beschikbaar.
          </Notice>
        )}
      </Card>
      </details>
      {run && (
        <>
          <div className="radar-toolbar">
            <h2>{tab==='saved'?'Bewaarde kansen voor deze opleiding':`${String(run.report.cards.length)} kansen om te onderzoeken`}</h2>
            <label hidden={tab==='saved'}>
              Scan{' '}
              <select
                value={run.id}
                onChange={(event) => {
                  setSelectedRun(event.target.value);
                }}
              >
                {reports.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {new Date(item.createdAt).toLocaleString('nl-NL')}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {tab!=='saved'&&run.report.isMock && (
            <Notice tone="warning">Demodata — geen echte marktanalyse.</Notice>
          )}
          <p className="c360-card__hint">
            Bronpassages zijn teruggevonden op de pagina. Interpretaties en
            creatieve voorstellen beoordeel je zelf. Een bronwijziging is nog
            geen markttrend.
          </p>
          <FlowNavigation label="Radarresultaten" value={tab} onChange={setTab} items={[{id:'opportunities',panelId:'radar-opportunities',label:`Kansen (${String(run.report.cards.length)})`},{id:'saved',panelId:'radar-opportunities',label:`Bewaarde kansen (${String(saved.data?.items.length??0)})`},{id:'audience',panelId:'radar-audience',label:'Doelgroepen & concurrenten'},{id:'ads',panelId:'radar-ads',label:'Advertenties'},{id:'keywords',panelId:'radar-keywords',label:`Zoekvragen (${String(run.report.keywords?.items.length ?? 0)})`},{id:'sources',panelId:'radar-sources',label:'Scan & beperkingen'}]} />
          <div className="flow-panel" role="tabpanel" aria-label="Zoekvragen" id="radar-keywords" hidden={tab!=='keywords'}><KeywordPanel key={`keywords:${run.id}`} run={run} labelId={label.id} canEdit={canEdit} /></div>
          <div className="flow-panel" role="tabpanel" aria-label="Doelgroepen en concurrenten" id="radar-audience" hidden={tab!=='audience'}><AudiencePanel key={`audience:${run.id}`} run={run} labelId={label.id} canEdit={canEdit} /></div>
          <div className="flow-panel" role="tabpanel" aria-label="Advertenties" id="radar-ads" hidden={tab!=='ads'}><AdvertisingPanel key={run.id} run={run} labelId={label.id} canEdit={canEdit} /></div>
          <div className="flow-panel" role="tabpanel" aria-label={tab==='saved'?'Bewaarde kansen':'Kansen'} id="radar-opportunities" hidden={tab!=='opportunities'&&tab!=='saved'}>
          <div className="radar-toolbar">
            <label>
              Toon{' '}
              <select
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                }}
              >
                <option value="all">Alle bronnen</option>
                {Object.entries(relation).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(bookmark.error??saved.error)&&<Notice tone="warning">{(bookmark.error??saved.error)?.userMessage}</Notice>}
          {tab==='saved'&&<p>Jouw shortlist voor deze opleiding. Vergelijk de bronnen en kies een creatieve richting om een campagne te starten. Bewaren doet geen nieuwe AI-aanroep.</p>}
          {tab==='saved'&&saved.isPending&&<p>Bewaarde kansen laden…</p>}
          {tab==='saved'&&saved.data?.items.length===0&&<Notice tone="info">Nog geen kansen bewaard. Gebruik Bewaar kans op een kanskaart.</Notice>}
          {create.error && (
            <Notice tone="warning">{create.error.userMessage}</Notice>
          )}
          <div className="radar-grid">
            {(tab==='saved'?(saved.data?.items??[]).filter(item=>filter==='all'||item.card.relationship===filter):cards.map(card=>({card,runId:run.id,isMock:run.report.isMock}))).map(({card,runId,isMock}) => (
              <Card key={`${runId}:${card.id}`} ariaLabel={card.title}>
                <Preview
                  key={`${runId}:${card.id}`}
                  src={
                    card.imageUrl
                      ? `/api/v1/labels/${label.id}/radar/${runId}/cards/${card.id}/preview`
                      : null
                  }
                  title={card.organization}
                />
                <div className="radar-toolbar">
                  <Badge tone="neutral">{relation[card.relationship]}</Badge>
                  <Badge tone={card.change === 'changed' ? 'amber' : 'neutral'}>
                    {changeLabel[card.change]}
                  </Badge>
                </div>
                <p className="c360-card__hint">
                  {card.organization} · Webpagina · Advertentiestatus niet
                  vastgesteld
                </p>
                <h3>{card.title}</h3>
                {isMock&&<Badge tone="amber">Demodata</Badge>}
                <Button disabled={!canEdit||bookmark.isPending||saved.isPending||saved.isError} onClick={()=>bookmark.mutate({runId,cardId:card.id,remove:Boolean(saved.data?.items.some(item=>item.runId===runId&&item.card.id===card.id))})}>{saved.data?.items.some(item=>item.runId===runId&&item.card.id===card.id)?'✓ Bewaard — verwijderen':'Bewaar kans'}</Button>
                <p>{card.observation}</p>
                <p>
                  <strong>Kans voor ons:</strong> {card.relevance}
                </p>
                <details>
                  <summary>Bron en onderbouwing bekijken</summary>
                  <p>{card.relationshipReason}</p>
                  <blockquote>{card.excerpt}</blockquote>
                  <a href={card.sourceUrl} target="_blank" rel="noreferrer">
                    Bekijk de oorspronkelijke bron ↗
                  </a>
                  <p>
                    Gelezen:{' '}
                    {new Date(card.retrievedAt).toLocaleString('nl-NL')}
                    <br />
                    Publicatiedatum: {card.publishedDate ?? 'Niet vastgesteld'}
                    {card.period && (
                      <>
                        <br />
                        Beschreven periode: {card.period}
                      </>
                    )}
                  </p>
                  <p>{card.uncertainty}</p>
                </details>
                <details className="radar-approaches">
                  <summary>Ontdek 3 creatieve richtingen</summary>
                  {card.approaches.map((approach, index) => (
                    <section className="radar-approach" key={index}>
                      <h4>{approach.title}</h4>
                      <p className="c360-card__hint">
                        {approach.format} · {approach.audience}
                      </p>
                      <p>{approach.idea}</p>
                      <Button
                        disabled={!canEdit || create.isPending}
                        onClick={() => {
                          create.mutate({ cardId: card.id, index, runId });
                        }}
                      >
                        Maak hier een campagne van
                      </Button>
                    </section>
                  ))}
                </details>
              </Card>
            ))}
          </div>
          {tab==='opportunities'&&cards.length === 0 && (
            <Notice tone="info">
              Geen kansen in deze selectie. Bekijk de scannotities of probeer
              andere bronnen.
            </Notice>
          )}
          </div>
          <div className="flow-panel" role="tabpanel" aria-label="Scan en beperkingen" id="radar-sources" hidden={tab!=='sources'}>
          <Card title="Scannotities" ariaLabel="Scannotities">
            {run.report.notes.map((note, index) => (
              <p key={index}>{note}</p>
            ))}
            {run.report.failures.map((failure, index) => (
              <p key={index}>
                <a
                  href={
                    /^https?:\/\//u.test(failure.url) ? failure.url : undefined
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {failure.url}
                </a>
                : {failure.reason}
              </p>
            ))}
            <p>
              Advertentiebibliotheken kunnen aanvullende toegang vereisen.
              Alleen expliciet vastgelegde bibliotheekstatus geldt als
              advertentiestatus; bereik of rendement wordt niet afgeleid.
            </p>
          </Card>
          </div>
        </>
      )}
    </>
  );
}
function Preview({
  src,
  title,
}: {
  src: string | null;
  title: string;
}): ReactNode {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <figure className="radar-preview">
      <img
        src={src}
        alt={`Beeld van de bronpagina van ${title}`}
        loading="lazy"
        onError={() => {
          setFailed(true);
        }}
      />
      <figcaption>Referentie van de bronpagina</figcaption>
    </figure>
  ) : (
    <div className="radar-preview radar-preview--empty">
      {title}
      <small>Geen beeldpreview beschikbaar · bron blijft te openen</small>
    </div>
  );
}
