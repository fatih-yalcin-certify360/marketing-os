import { useId, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  Campaign,
  CampaignObjective,
  JobSummary,
  LabelSummary,
  RadarCard,
  RadarRun,
  TrackedCompetitor,
} from '@c360/contracts';
import { OBJECTIVE_LABEL_NL, RADAR_FOCUS_LABEL_NL, statableFacts, type RadarScanFocus } from '@c360/contracts';
import { Badge, Button, Card, Notice } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { useCourses, type CourseListItem } from '../api/campaign-queries.js';
import { AdvertisingPanel } from '../components/AdvertisingPanel.js';
import { AudiencePanel } from '../components/AudiencePanel.js';
import { CompetitorRegistry, CompetitorSuggestions } from '../components/CompetitorRegistry.js';
import { AddSourceAsCompetitor } from '../components/AddSourceAsCompetitor.js';
import { MakeSomethingOf } from '../components/MakeSomethingOf.js';
import { Modal } from '../components/Modal.js';
import { KeywordPanel } from '../components/KeywordPanel.js';
import { MarketPicturePanel } from '../components/MarketPicturePanel.js';
import { ObjectiveSelect } from '../components/ObjectiveSelect.js';
import './radar.css';

/**
 * Marktradar: from public sources to a market picture to a campaign.
 *
 * The screen reads in the order a marketing lead decides: the **market
 * picture** first (what changed, the insights with their evidence and
 * confidence, what competitors say next to what we can say), then the
 * evidence layers — kansen, doelgroepen & concurrenten, advertenties,
 * zoekvragen — and last the scan's own notes and limits. Every hand-off to a
 * campaign carries the objective the person confirmed, so the campaign lands
 * in the eight-step screen with its funnel stages decided.
 *
 * State that a colleague might want to link to lives in the URL: the course,
 * the tab and the run. One primary action per view: the scan button while
 * there is nothing to read, the chosen insight's hand-off once there is.
 *
 * Counts on this screen are counts of what the scan looked at, never market
 * figures: "3 van 40 bekeken records", not "3 advertenties in de markt".
 */

const TERMINAL = new Set(['succeeded', 'failed', 'dead', 'cancelled']);

const RELATION_NL: Record<RadarCard['relationship'], string> = {
  competitor: 'Opleidingsaanbieder',
  adjacent: 'Dezelfde doelgroep',
  own_brand: 'Eigen merk / verbonden aanbod',
  authority: 'Vakbron',
  uncertain: 'Relatie te controleren',
};

const CHANGE_NL: Record<RadarCard['change'], string> = {
  first_seen: 'Eerst gevonden',
  changed: 'Brontekst gewijzigd',
  unchanged: 'Brontekst ongewijzigd',
};

type Tab = 'picture' | 'opportunities' | 'saved' | 'audience' | 'ads' | 'keywords' | 'sources' | 'competitors';
const TABS: readonly Tab[] = ['picture', 'opportunities', 'saved', 'audience', 'ads', 'keywords', 'sources', 'competitors'];
const isTab = (value: string | null): value is Tab => value !== null && (TABS as readonly string[]).includes(value);

export function RadarPage(props: { label: LabelSummary | undefined }): ReactNode {
  return props.label ? (
    <RadarLabel key={props.label.id} label={props.label} />
  ) : (
    <Notice tone="warning">Kies eerst een label.</Notice>
  );
}

function RadarLabel(props: { label: LabelSummary }): ReactNode {
  const { label } = props;
  const courses = useCourses(label.id);
  const [params, setParams] = useSearchParams();
  const requested = params.get('course');
  const item =
    courses.data?.items.find((entry) => entry.course.id === requested) ?? courses.data?.items[0];
  const courseId = useId();

  const chooser = (
    <label className="c360-field" htmlFor={courseId}>
      <span className="c360-label">Voor welke opleiding?</span>
      <select
        id={courseId}
        className="c360-select"
        value={item?.course.id ?? ''}
        onChange={(event) => {
          setParams(
            (previous) => {
              const next = new URLSearchParams(previous);
              next.set('course', event.target.value);
              next.delete('run');
              return next;
            },
            { replace: true },
          );
        }}
      >
        {courses.data?.items.map((entry) => (
          <option key={entry.course.id} value={entry.course.id}>
            {entry.course.name}
          </option>
        ))}
      </select>
    </label>
  );

  if (item === undefined) {
    return (
      <div className="os-page">
        {courses.isError && <Notice tone="warning">{courses.error.userMessage}</Notice>}
        {courses.isPending ? (
          <p className="c360-card__hint">Opleidingen laden…</p>
        ) : (
          <Notice tone="info">
            Voeg eerst een opleiding toe onder Kennis &amp; beheer. De radar leest de markt rond één
            opleidingskaart, dus zonder kaart is er niets om omheen te kijken.
          </Notice>
        )}
      </div>
    );
  }

  return <RadarCourse key={item.course.id} label={label} item={item} chooser={chooser} />;
}

function RadarCourse(props: {
  label: LabelSummary;
  item: CourseListItem;
  /** The course selector, rendered inside the rail where the context lives. */
  chooser: ReactNode;
}): ReactNode {
  const { label, item } = props;
  const courseId = item.course.id;
  const navigate = useNavigate();
  const base = `/labels/${label.id}/courses/${courseId}/radar`;
  const canEdit = label.role !== 'label_viewer';
  const [params, setParams] = useSearchParams();
  const setParam = (key: string, value: string | null): void => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === null) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  };
  const [urls, setUrls] = useState('');
  const [discover, setDiscover] = useState(true);
  const [includeAds, setIncludeAds] = useState(true);
  const [includeKeywords, setIncludeKeywords] = useState(true);
  const [filter, setFilter] = useState('all');
  const [scanOpen, setScanOpen] = useState(false);
  const [focus, setFocus] = useState<RadarScanFocus>('market');
  const scanHeadingId = useId();
  const focusId = useId();

  const saved = useQuery<{ items: { runId: string; card: RadarCard; isMock: boolean }[] }, ApiClientError>({
    queryKey: ['radar-saved', label.id, courseId],
    queryFn: ({ signal }) => api.get(`${base}/saved`, signal),
  });
  const bookmark = useMutation<unknown, ApiClientError, { runId: string; cardId: string; remove: boolean }>({
    mutationFn: (input) => {
      const path = `/labels/${label.id}/radar/${input.runId}/cards/${input.cardId}/save`;
      return input.remove ? api.remove(path) : api.post(path);
    },
    onSuccess: () => {
      void saved.refetch();
    },
  });

  const scan = useMutation<JobSummary, ApiClientError, RadarScanFocus | undefined>({
    mutationFn: (override): Promise<JobSummary> => {
      // A focus passed in is a button with its own instruction, not the dialog:
      // searching is the whole point of the aanbiederszoektocht, and it does not
      // ask for advertenties, zoekvragen or handmatige bronnen. Inheriting the
      // dialog state would let a toggle someone flipped earlier silently turn
      // the sweep into a scan that finds nothing (2026-09-16).
      const chosen = override ?? focus;
      const sweep = override !== undefined;
      return api.post(`${base}/scan`, {
        focus: chosen,
        // A competitors-only scan searches for nothing; sending `discover: true`
        // with it would ask for something the scan does not do.
        discover:
          chosen !== 'competitors' && (sweep || discover) && reports.data?.canDiscover === true,
        includeAds: sweep ? false : includeAds,
        includeKeywords: sweep ? false : includeKeywords,
        urls: sweep
          ? []
          : urls
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean),
      });
    },
    onSuccess: (job) => {
      sessionStorage.setItem(`radar-job:${label.id}:${courseId}`, job.id);
      setParam('run', null);
      // The scan runs on the worker and the shell announces it; keeping the
      // dialog open would ask the person to watch a bar for several minutes.
      setScanOpen(false);
    },
  });
  const [restoredJob] = useState(() => sessionStorage.getItem(`radar-job:${label.id}:${courseId}`));
  const jobId = scan.data?.id ?? restoredJob;
  const job = useQuery<JobSummary, ApiClientError>({
    queryKey: ['radar-job', label.id, jobId],
    queryFn: ({ signal }) => api.get(`/jobs/${String(jobId)}`, signal),
    enabled: Boolean(jobId),
    refetchInterval: (query) => (TERMINAL.has(query.state.data?.status ?? '') ? false : 2000),
  });
  const reports = useQuery<{ items: RadarRun[]; canDiscover: boolean; latestJob: JobSummary | null }, ApiClientError>({
    queryKey: ['radar', label.id, courseId, job.data?.status],
    queryFn: ({ signal }) => api.get(base, signal),
    refetchInterval: (query) =>
      query.state.data?.latestJob && !TERMINAL.has(query.state.data.latestJob.status) ? 3000 : false,
  });

  const run = reports.data?.items.find((entry) => entry.id === params.get('run')) ?? reports.data?.items[0];
  const tab: Tab = run && isTab(params.get('tab')) ? (params.get('tab') as Tab) : params.get('tab') === 'competitors' || !run ? 'competitors' : 'picture';
  const serverJob = reports.data?.latestJob;
  const visibleJob =
    serverJob && (!job.data || serverJob.createdAt > job.data.createdAt) ? serverJob : (job.data ?? serverJob);
  const working = scan.isPending || Boolean(visibleJob && !TERMINAL.has(visibleJob.status));
  const jobAction = useMutation<unknown, ApiClientError, 'retry' | 'cancel'>({
    mutationFn: (action) => api.post(`/jobs/${String(visibleJob?.id)}/${action}`),
    onSuccess: () => {
      if (jobId) void job.refetch();
      void reports.refetch();
    },
  });

  const ownFacts = statableFacts(item.course).map((fact) => ({ label: fact.label, value: fact.value }));
  /* Our own course page, so a card citing it is never offered as a competitor. */
  const ownHosts = [item.course.courseUrl]
    .flatMap((url) => {
      const host = /^https?:\/\/([^/?#]+)/iu.exec((url ?? '').trim())?.[1]?.toLowerCase();
      return host === undefined ? [] : [host.replace(/\.$/u, '')];
    });

  const counts = {
    insights: run?.report.insights.length,
    cards: run?.report.cards.length,
    saved: saved.data?.items.length,
    audience: run?.report.audience?.findings.length,
    ads: run?.report.advertising?.ads.length,
    keywords: run?.report.keywords?.items.length,
    notes: run === undefined ? undefined : run.report.notes.length + run.report.failures.length,
  };

  const views: readonly { id: Tab; labelNl: string; hintNl: string; count?: number | undefined }[] = [
    ...(run
      ? ([
          { id: 'picture', labelNl: 'Marktbeeld', hintNl: 'Wat de scan samen betekent', count: counts.insights },
          { id: 'opportunities', labelNl: 'Kansen', hintNl: 'Voorstellen om iets mee te doen', count: counts.cards },
          { id: 'saved', labelNl: 'Bewaarde kansen', hintNl: 'Jouw shortlist', count: counts.saved },
        ] as const)
      : []),
    { id: 'competitors', labelNl: 'Concurrenten', hintNl: 'Aanbieders die je volgt' },
    ...(run
      ? ([
          { id: 'audience', labelNl: 'Doelgroepen', hintNl: 'Wie er in deze markt zoekt', count: counts.audience },
          { id: 'ads', labelNl: 'Advertenties', hintNl: 'Wat anderen adverteren', count: counts.ads },
          { id: 'keywords', labelNl: 'Zoekvragen', hintNl: 'Waar mensen op zoeken', count: counts.keywords },
          { id: 'sources', labelNl: 'Scannotities', hintNl: 'Wat is gelezen en wat niet', count: counts.notes },
        ] as const)
      : []),
  ];

  return (
    <div className={run ? 'os-flow' : 'os-flow os-flow--two'}>
      <aside className="os-siderail">
        <div className="os-siderail__intro">
          <p className="os-eyebrow">Marktradar</p>
          <p className="os-siderail__course">{item.course.name}</p>
          <p className="os-siderail__note">
            {`${String(item.confirmed.length)} gecontroleerde feiten op de opleidingskaart`}
            {item.unconfirmed.length > 0
              ? ` · ${String(item.unconfirmed.length)} nog niet gecontroleerd`
              : ''}
          </p>
        </div>

        {props.chooser}

        <div className="os-siderail__group" role="tablist" aria-label="Marktradar-weergaven">
          {views.map((view) => (
            <button
              key={view.id}
              type="button"
              role="tab"
              id={`radar-tab-${view.id}`}
              aria-selected={tab === view.id}
              aria-controls={`radar-${view.id}`}
              className="os-step os-step--plain"
              onClick={() => {
                setParam('tab', view.id);
              }}
            >
              <span className="os-step__text">
                <span className="os-step__label">{view.labelNl}</span>
                <span className="os-step__state" title={view.hintNl}>
                  {view.hintNl}
                </span>
              </span>
              {view.count !== undefined && <span className="os-step__count">{view.count}</span>}
            </button>
          ))}
        </div>

        {/* The scan is a dialog, not a drawer in the rail: it is a decision
            with four choices and a cost, and it deserves the screen while it is
            being made. It runs on the queue, so the dialog closes and the
            notice arrives when the scan lands (2026-09-15). */}
        <button
          type="button"
          className="os-branch"
          onClick={() => {
            setScanOpen(true);
          }}
        >
          Nieuwe scan instellen
        </button>
      </aside>

      {scanOpen && (
        <Modal
          labelledBy={scanHeadingId}
          busy={working}
          onClose={() => {
            setScanOpen(false);
          }}
        >
        <div>
          <h2 className="c360-section-title" id={scanHeadingId} style={{ margin: '0 0 8px' }}>
            Een frisse blik op jouw markt
          </h2>
          <p>
            We zoeken opleidingsaanbieders, organisaties met dezelfde doelgroep en vakinformatie,
            lezen de pagina's en controleren elke passage. Daarna volgt het marktbeeld: wat de
            bevindingen samen betekenen, met bewijs en zekerheid erbij. Opgeslagen concurrenten worden
            meegenomen; daarnaast onderzoeken we een begrensde selectie nieuwe bronnen. Dit is een
            steekproef, geen marktinventaris.
          </p>
          <p className="c360-card__hint">Beheer je vaste aanbieders in Concurrenten. Je kunt daarnaast losse bronlinks toevoegen en nieuwe aanbieders laten zoeken.</p>
          <details>
            <summary>Eigen bronnen toevoegen</summary>
            <label className="c360-field">
              Bronlinks, één per regel (maximaal 10)
              <textarea
                className="c360-textarea"
                rows={4}
                value={urls}
                onChange={(event) => {
                  setUrls(event.target.value);
                }}
                placeholder="https://…"
              />
            </label>
          </details>
          {/* What the scan goes looking for. The default is the mixed market
              sweep; the other two answer one question each. */}
          <label className="c360-field" htmlFor={focusId} style={{ marginTop: 'var(--c360-space-3)' }}>
            <span className="c360-label">Waar gaat deze scan naar op zoek?</span>
            <select
              id={focusId}
              className="c360-select"
              value={focus}
              disabled={working}
              onChange={(event) => {
                setFocus(event.target.value as RadarScanFocus);
              }}
            >
              {(Object.keys(RADAR_FOCUS_LABEL_NL) as RadarScanFocus[]).map((option) => (
                <option key={option} value={option}>
                  {RADAR_FOCUS_LABEL_NL[option]}
                </option>
              ))}
            </select>
          </label>
          <p className="c360-card__hint">{FOCUS_HINT_NL[focus]}</p>

          <div className="radar-toolbar">
            <label hidden={focus === 'competitors'}>
              <input
                type="checkbox"
                checked={discover && reports.data?.canDiscover === true}
                disabled={!reports.data?.canDiscover || working || focus === 'competitors'}
                onChange={(event) => {
                  setDiscover(event.target.checked);
                }}
              />{' '}
              Ook nieuwe bronnen zoeken
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeKeywords}
                disabled={working}
                onChange={(event) => {
                  setIncludeKeywords(event.target.checked);
                }}
              />{' '}
              Vragen en zoekvoorstellen onderzoeken
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
              Ook advertentiebibliotheken controleren
            </label>
            <Button
              variant={run ? 'secondary' : 'primary'}
              disabled={!canEdit || working || reports.isPending}
              busy={working}
              onClick={() => {
                scan.mutate(undefined);
              }}
            >
              {working ? 'Scan loopt…' : SCAN_BUTTON_NL[focus]}
            </Button>
          </div>
          {reports.data?.canDiscover === false && (
            <Notice tone="info">
              Automatisch zoeken is niet beschikbaar bij deze AI-aanbieder. Je kunt wel eigen
              bronlinks laten lezen.
            </Notice>
          )}
          {(scan.error ?? job.error ?? reports.error) && (
            <Notice tone="warning">{(scan.error ?? job.error ?? reports.error)?.userMessage}</Notice>
          )}
          {working && (
            <Notice tone="info" live>
              {visibleJob?.progress?.message ?? 'Scan wordt gestart…'}
            </Notice>
          )}
          {visibleJob?.failureMessage && <Notice tone="warning">{visibleJob.failureMessage}</Notice>}
          {jobAction.error && <Notice tone="warning">{jobAction.error.userMessage}</Notice>}
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
            <Notice tone="info">Scan geannuleerd. Eerdere resultaten blijven beschikbaar.</Notice>
          )}
        </div>
        </Modal>
      )}

      <section className="os-detail">
      <div className="flow-panel" role="tabpanel" aria-labelledby="radar-tab-competitors" id="radar-competitors" hidden={tab !== 'competitors'}>
        {/* The question this tab exists for, asked directly. It runs the narrow
            sweep: search and read, no doelgroep-, zoekvraag- or
            advertentieonderzoek and geen marktbeeld (2026-09-16). */}
        <section className="os-panel os-panel--pad" aria-label="Concurrenten zoeken">
          <div className="c360-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: '1 1 30rem' }}>
              <h2 className="os-panel__title">Wie biedt deze opleiding nog meer aan?</h2>
              <p className="os-panel__sub" style={{ marginTop: 4 }}>
                Het systeem doorzoekt het openbare web op organisaties die deze opleiding of een
                gelijkwaardige aanbieden — ook als zij een andere term gebruiken — en leest hun
                opleidingspagina. Je krijgt ze hieronder te zien met de passage erbij; opslaan doe
                je zelf.
              </p>
            </div>
            <Button
              variant="primary"
              icon="search"
              disabled={!canEdit || working || reports.data?.canDiscover !== true}
              busy={working}
              title={
                reports.data?.canDiscover === true
                  ? undefined
                  : 'Webzoeken is niet beschikbaar bij de ingestelde AI-provider.'
              }
              onClick={() => {
                scan.mutate('providers');
              }}
            >
              {working ? 'Bezig met zoeken…' : 'Concurrenten zoeken'}
            </Button>
          </div>
          {reports.data?.canDiscover !== true && (
            <Notice tone="info">
              Webzoeken is niet beschikbaar bij de ingestelde AI-provider. Voeg concurrenten met de
              hand toe, of zet webzoeken aan.
            </Notice>
          )}
          {scan.error && <Notice tone="warning">{scan.error.userMessage}</Notice>}
          {working && (
            <Notice tone="info" live>
              {visibleJob?.progress?.message ?? 'Zoekopdracht wordt gestart…'}
            </Notice>
          )}
          <p className="os-limit" style={{ marginTop: 8 }}>
            Dit is een steekproef van het openbare web, geen register: een aanbieder die niet in de
            zoekresultaten stond, staat hier niet — en dat bewijst niet dat die er niet is.
          </p>
        </section>

        <CompetitorRegistry labelId={label.id} courseVersionId={courseId} courseName={item.course.name} canEdit={canEdit} />
        {run && <CompetitorSuggestions labelId={label.id} courseVersionId={courseId} canEdit={canEdit} run={run} />}
      </div>
      {run && (
        <>
          <div className="os-page__head" hidden={tab === 'competitors'}>
            <div className="os-page__head-text">
              <h1>{VIEW_TITLE_NL[tab]}</h1>
              <p className="c360-page-lead">{VIEW_LEAD_NL[tab]}</p>
            </div>
            <label className="os-runpicker">
              <span>Scan</span>
              <select
                className="c360-select"
                value={run.id}
                onChange={(event) => {
                  setParam('run', event.target.value);
                }}
              >
                {reports.data?.items.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {new Date(entry.createdAt).toLocaleString('nl-NL')}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div hidden={tab === 'competitors'}>
            {run.report.isMock && <Notice tone="warning">Demodata — geen echte marktanalyse.</Notice>}
            <p className="os-limit">
              {`${String(run.report.insights.length)} inzichten · ${String(run.report.cards.length)} kansen · ${String(run.report.audience?.findings.length ?? 0)} doelgroepbevindingen · ${String(run.report.keywords?.items.length ?? 0)} zoekvragen · ${String(reports.data?.items.length ?? 0)} scan(s) voor deze opleiding. Elke passage is teruggevonden op de bronpagina; een gewijzigde brontekst is nog geen marktbeweging, en wat niet gevonden is, is niet bewezen afwezig.`}
            </p>
          </div>

          <div className="flow-panel" role="tabpanel" aria-labelledby="radar-tab-picture" id="radar-picture" hidden={tab !== 'picture'}>
            <MarketPicturePanel key={`picture:${run.id}`} run={run} labelId={label.id} canEdit={canEdit} ownFacts={ownFacts} />
          </div>
          <div className="flow-panel" role="tabpanel" aria-labelledby="radar-tab-opportunities" id="radar-opportunities" hidden={tab !== 'opportunities'}>
            <OpportunityCards
              label={label}
              run={run}
              cards={run.report.cards
                .filter((card) => filter === 'all' || card.relationship === filter)
                .map((card) => ({ card, runId: run.id, isMock: run.report.isMock }))}
              filter={filter}
              onFilter={setFilter}
              saved={saved.data?.items ?? []}
              savedBusy={bookmark.isPending || saved.isPending || saved.isError}
              onBookmark={(input) => bookmark.mutate(input)}
              error={bookmark.error ?? saved.error ?? null}
              canEdit={canEdit}
              ownHosts={ownHosts}
              onCreated={(campaign) => void navigate(`/campagnes/${campaign.id}`)}
              onLooseMade={() => void navigate('/content')}
              emptyNl="Geen kansen in deze selectie. Bekijk de scannotities of probeer andere bronnen."
            />
          </div>
          <div className="flow-panel" role="tabpanel" aria-labelledby="radar-tab-saved" id="radar-saved" hidden={tab !== 'saved'}>
            <p className="c360-card__hint">
              Jouw shortlist voor deze opleiding. Een bewaarde kans houdt de scan waaruit ze komt;
              bewaren doet geen nieuwe AI-aanroep.
            </p>
            {saved.isPending && <p className="c360-card__hint">Bewaarde kansen laden…</p>}
            <OpportunityCards
              label={label}
              run={run}
              cards={(saved.data?.items ?? []).filter((entry) => filter === 'all' || entry.card.relationship === filter)}
              filter={filter}
              onFilter={setFilter}
              saved={saved.data?.items ?? []}
              savedBusy={bookmark.isPending || saved.isPending || saved.isError}
              onBookmark={(input) => bookmark.mutate(input)}
              error={bookmark.error ?? saved.error ?? null}
              canEdit={canEdit}
              ownHosts={ownHosts}
              onCreated={(campaign) => void navigate(`/campagnes/${campaign.id}`)}
              onLooseMade={() => void navigate('/content')}
              emptyNl="Nog geen kansen bewaard. Gebruik Bewaar kans op een kanskaart."
            />
          </div>
          <div className="flow-panel" role="tabpanel" aria-labelledby="radar-tab-audience" id="radar-audience" hidden={tab !== 'audience'}>
            <AudiencePanel key={`audience:${run.id}`} run={run} labelId={label.id} canEdit={canEdit} />
          </div>
          <div className="flow-panel" role="tabpanel" aria-labelledby="radar-tab-ads" id="radar-ads" hidden={tab !== 'ads'}>
            <AdvertisingPanel key={`ads:${run.id}`} run={run} labelId={label.id} canEdit={canEdit} />
          </div>
          <div className="flow-panel" role="tabpanel" aria-labelledby="radar-tab-keywords" id="radar-keywords" hidden={tab !== 'keywords'}>
            <KeywordPanel key={`keywords:${run.id}`} run={run} labelId={label.id} canEdit={canEdit} />
          </div>
          <div className="flow-panel" role="tabpanel" aria-labelledby="radar-tab-sources" id="radar-sources" hidden={tab !== 'sources'}>
            <Card title="Scannotities en beperkingen" ariaLabel="Scannotities">
              {run.report.notes.map((note, index) => (
                <p key={index}>{note}</p>
              ))}
              {run.report.failures.length > 0 && (
                <>
                  <h3 className="c360-card__title">Niet gelezen</h3>
                  {run.report.failures.map((failure, index) => (
                    <p key={index}>
                      <a href={/^https?:\/\//u.test(failure.url) ? failure.url : undefined} target="_blank" rel="noreferrer">
                        {failure.url}
                      </a>
                      : {failure.reason}
                    </p>
                  ))}
                </>
              )}
              <p className="c360-card__hint">
                Deze scan las een steekproef van openbare pagina's en advertentiebibliotheken. Ze
                meet geen zoekvolume, bereik of marktaandeel; een geblokkeerde of beperkte controle
                bewijst niet dat er niets is. Passages met een e-mailadres of telefoonnummer zijn
                weggelaten; namen van personen worden niet verzameld.
              </p>
            </Card>
          </div>
        </>
      )}
      </section>

      {run && (
        <aside className="os-context" aria-label="Context bij deze scan">
          <div>
            <p className="os-eyebrow os-eyebrow--muted">Onze opleiding (gecontroleerd)</p>
            {ownFacts.length === 0 ? (
              <p className="os-limit">
                Er is nog geen gecontroleerd feit op de opleidingskaart, dus er valt niets naast te
                leggen.
              </p>
            ) : (
              <dl className="c360-definition">
                {ownFacts.slice(0, 6).map((fact) => (
                  <div key={fact.label}>
                    <dt className="c360-definition__term">{fact.label}</dt>
                    <dd className="c360-definition__value" style={{ margin: 0 }}>
                      {fact.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="os-limit" style={{ marginTop: 8 }}>
              Dit is wat op de opleidingskaart is gecontroleerd. Wat hier niet staat, wordt niet in
              content gebruikt.
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}

/** What each scan focus does, said before it is started. */
const FOCUS_HINT_NL: Readonly<Record<RadarScanFocus, string>> = Object.freeze({
  market:
    'De brede blik: concurrerende opleidingen, organisaties met dezelfde doelgroep en actuele vakinformatie. Een markt is meer dan haar aanbieders, dus de zoekacties worden verdeeld.',
  providers:
    'Alle zoekacties gaan naar organisaties die deze opleiding of een gelijkwaardige aanbieden, ook als zij een andere term gebruiken. Het blijft een steekproef van het openbare web: wie niet in de zoekresultaten stond, staat hier niet — en dat bewijst niet dat die er niet is.',
  competitors:
    'Er wordt niets nieuws gezocht. De opgeslagen concurrenten van deze opleiding worden opnieuw gelezen, dus je ziet wat er op hún pagina’s veranderde. Deze scan zegt niets over wie er nog meer is.',
});

const SCAN_BUTTON_NL: Readonly<Record<RadarScanFocus, string>> = Object.freeze({
  market: 'Scan de markt',
  providers: 'Zoek de aanbieders',
  competitors: 'Lees de concurrenten opnieuw',
});

/** What each sub-view is, in the workspace header. */
const VIEW_TITLE_NL: Readonly<Record<Tab, string>> = Object.freeze({
  picture: 'Marktbeeld',
  opportunities: 'Kansen',
  saved: 'Bewaarde kansen',
  competitors: 'Concurrenten',
  audience: 'Doelgroepen',
  ads: 'Advertenties',
  keywords: 'Zoekvragen',
  sources: 'Scannotities',
});

const VIEW_LEAD_NL: Readonly<Record<Tab, string>> = Object.freeze({
  picture: 'Wat de bevindingen samen betekenen, met het bewijs en de zekerheid erbij. Kies één inzicht om er iets van te maken.',
  opportunities: 'Eén kaart per gelezen pagina: wat de bron zegt, waarom het ons raakt, en drie creatieve richtingen.',
  saved: 'Jouw shortlist voor deze opleiding. Een bewaarde kans houdt de scan waaruit ze komt; bewaren doet geen nieuwe AI-aanroep.',
  competitors: 'De aanbieders die je volgt, en wat de scan over hen vond.',
  audience: 'Rolbeschrijvingen die in de bronnen voorkwamen. Wie er zoekt, niet hoeveel er zoeken.',
  ads: 'Advertentieteksten die anderen publiceerden, per adverteerder. Geen budget en geen bereik: die staan niet in een advertentiebibliotheek.',
  keywords: 'Vragen die mensen over dit onderwerp stellen. Geen zoekvolume en geen positie: er is niets gemeten.',
  sources: 'Wat is gelezen, wat is geweigerd, en wat buiten beeld bleef.',
});

/**
 * The objective a card's hand-off suggests: the insight that cites the card
 * knows the stage; without one, Overwegen is the neutral default — a page
 * about a course is most often read by someone comparing.
 */
function objectiveForCard(run: RadarRun, cardId: string): { objective: CampaignObjective; whyNl: string } {
  const insight = run.report.insights.find((entry) =>
    entry.evidence.some((ref) => ref.kind === 'card' && ref.id === cardId),
  );
  return insight
    ? {
        objective: insight.suggestedObjective,
        whyNl: `${OBJECTIVE_LABEL_NL[insight.suggestedObjective]}, uit het inzicht "${insight.headlineNl}".`,
      }
    : { objective: 'consideration', whyNl: 'Overweging: een bronpagina wordt meestal gelezen door iemand die vergelijkt.' };
}

function OpportunityCards(props: {
  label: LabelSummary;
  run: RadarRun;
  cards: readonly { card: RadarCard; runId: string; isMock: boolean }[];
  filter: string;
  onFilter: (value: string) => void;
  saved: readonly { runId: string; card: RadarCard }[];
  savedBusy: boolean;
  onBookmark: (input: { runId: string; cardId: string; remove: boolean }) => void;
  error: ApiClientError | null;
  canEdit: boolean;
  /** Our own hosts, so a card citing our own page offers no competitor button. */
  ownHosts: readonly string[];
  onCreated: (campaign: Campaign) => void;
  /** Where to go after a loose piece was made from a card. */
  onLooseMade: () => void;
  emptyNl: string;
}): ReactNode {
  const { label, run, cards, canEdit } = props;

  /*
   * One read of the registry for the whole list, so a provider already saved is
   * shown as such instead of being offered twice — the same rule the cited
   * sources under an AI Visibility answer follow.
   */
  const known = useQuery<{ items: TrackedCompetitor[] }, ApiClientError>({
    queryKey: ['competitors', label.id],
    queryFn: ({ signal }) => api.get(`/labels/${label.id}/competitors`, signal),
  });
  const create = useMutation<Campaign, ApiClientError, { runId: string; cardId: string; index: number; objective: CampaignObjective }>({
    mutationFn: (input) =>
      api.post(`/labels/${label.id}/radar/${input.runId}/cards/${input.cardId}/campaign`, {
        approachIndex: input.index,
        objective: input.objective,
      }),
    onSuccess: props.onCreated,
  });

  return (
    <>
      {/* The view's own lead already says what a card is; this is the filter. */}
      <div className="radar-toolbar">
        <label>
          Toon{' '}
          <select
            className="c360-select"
            value={props.filter}
            onChange={(event) => {
              props.onFilter(event.target.value);
            }}
          >
            <option value="all">Alle bronnen</option>
            {Object.entries(RELATION_NL).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
      </div>
      {props.error && <Notice tone="warning">{props.error.userMessage}</Notice>}
      {create.error && <Notice tone="warning">{create.error.userMessage}</Notice>}
      {cards.length === 0 && <Notice tone="info">{props.emptyNl}</Notice>}
      <div className="radar-grid">
        {cards.map(({ card, runId, isMock }) => {
          const isSaved = props.saved.some((entry) => entry.runId === runId && entry.card.id === card.id);
          return (
            <OpportunityCard
              key={`${runId}:${card.id}`}
              label={label}
              run={run}
              card={card}
              runId={runId}
              isMock={isMock}
              isSaved={isSaved}
              savedBusy={props.savedBusy}
              onBookmark={() => props.onBookmark({ runId, cardId: card.id, remove: isSaved })}
              canEdit={canEdit}
              known={known.data?.items ?? []}
              ownHosts={props.ownHosts}
              creating={create.isPending}
              onCreate={(index, objective) => {
                create.mutate({ runId, cardId: card.id, index, objective });
              }}
              onLooseMade={props.onLooseMade}
            />
          );
        })}
      </div>
    </>
  );
}

function OpportunityCard(props: {
  label: LabelSummary;
  run: RadarRun;
  card: RadarCard;
  runId: string;
  isMock: boolean;
  isSaved: boolean;
  savedBusy: boolean;
  onBookmark: () => void;
  canEdit: boolean;
  known: readonly TrackedCompetitor[];
  ownHosts: readonly string[];
  creating: boolean;
  onCreate: (index: number, objective: CampaignObjective) => void;
  /** Called after a loose piece was made, so the screen can move on. */
  onLooseMade: () => void;
}): ReactNode {
  const { label, run, card, runId } = props;
  const suggestion = objectiveForCard(run, card.id);
  const [objective, setObjective] = useState<CampaignObjective>(suggestion.objective);
  const objectiveId = useId();
  return (
    <Card ariaLabel={card.title}>
      <Preview
        src={card.imageUrl ? `/api/v1/labels/${label.id}/radar/${runId}/cards/${card.id}/preview` : null}
        title={card.organization}
      />
      <div className="radar-toolbar">
        <Badge tone="neutral">{RELATION_NL[card.relationship]}</Badge>
        <Badge tone={card.change === 'changed' ? 'amber' : 'neutral'}>{CHANGE_NL[card.change]}</Badge>
      </div>
      <p className="c360-card__hint">{`${card.organization} · webpagina · geen advertentie`}</p>
      <h3 className="c360-card__title">{card.title}</h3>
      {props.isMock && <Badge tone="amber">Demodata</Badge>}
      <p>
        <strong>Wat de bron zegt:</strong> {card.observation}
      </p>
      <p>
        <strong>Waarom dit ons raakt:</strong> {card.relevance}
      </p>
      <details>
        <summary>Bekijk de bron en de letterlijke passage</summary>
        <p>{card.relationshipReason}</p>
        <blockquote>{card.excerpt}</blockquote>
        <a href={card.sourceUrl} target="_blank" rel="noreferrer">
          Bekijk de oorspronkelijke bron ↗
        </a>
        <p className="c360-stat__caption">
          {`Gelezen: ${new Date(card.retrievedAt).toLocaleString('nl-NL')} · Publicatiedatum: ${card.publishedDate ?? 'niet vastgesteld'}`}
          {card.period && ` · Beschreven periode: ${card.period}`}
        </p>
        <p>
          <strong>Nog te beoordelen:</strong> {card.uncertainty}
        </p>
      </details>
      <div className="radar-toolbar">
        <Button disabled={!props.canEdit || props.savedBusy} onClick={props.onBookmark}>
          {props.isSaved ? '✓ Bewaard — verwijderen' : 'Bewaar kans'}
        </Button>
        {/* A card about a provider is the most direct competitor evidence the
            scan produces. Until now it was a page you could read and not act
            on (2026-09-16). */}
        {props.canEdit && (card.relationship === 'competitor' || card.relationship === 'uncertain') && (
          <AddSourceAsCompetitor
            labelId={label.id}
            sourceUrl={card.sourceUrl}
            sourceTitle={card.organization}
            known={props.known}
            ownHosts={props.ownHosts}
          />
        )}
      </div>
      <details className="radar-approaches">
        <summary>Drie creatieve richtingen — en er een campagne van maken</summary>
        {props.canEdit && (
          <ObjectiveSelect id={objectiveId} value={objective} onChange={setObjective} suggestionNl={suggestion.whyNl} disabled={props.creating} />
        )}
        {card.approaches.map((approach, index) => (
          <section className="radar-approach" key={index}>
            <h4>{approach.title}</h4>
            <p className="c360-card__hint">{`${approach.format} · ${approach.audience}`}</p>
            <p>{approach.idea}</p>
            <MakeSomethingOf
              labelId={label.id}
              courseVersionId={run.courseVersionId}
              buttonLabel="Hier iets van maken"
              dialogTitle="Wat maak je van deze kans?"
              subjectNl={approach.title}
              angleNl={`${approach.title}\n\n${approach.idea}\n\nAanleiding: ${card.organization} — ${card.observation}`}
              originKind="radar_card"
              disabled={!props.canEdit}
              busy={props.creating}
              onCampaign={() => {
                props.onCreate(index, objective);
              }}
              onLooseMade={props.onLooseMade}
            />
          </section>
        ))}
      </details>
    </Card>
  );
}

function Preview(props: { src: string | null; title: string }): ReactNode {
  const [failed, setFailed] = useState(false);
  return props.src && !failed ? (
    <figure className="radar-preview">
      <img
        src={props.src}
        alt={`Beeld van de bronpagina van ${props.title}`}
        loading="lazy"
        onError={() => {
          setFailed(true);
        }}
      />
      <figcaption>Referentie van de bronpagina — geen advertentie</figcaption>
    </figure>
  ) : (
    <div className="radar-preview radar-preview--empty">
      {props.title}
      <small>Geen beeldpreview beschikbaar · bron blijft te openen</small>
    </div>
  );
}
