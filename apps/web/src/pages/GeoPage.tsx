import {useState,type ReactNode} from 'react';
import {useQuery,useMutation} from '@tanstack/react-query';
import {useSearchParams} from 'react-router-dom';
import type {LabelSummary,GeoSetup,GeoReport,GeoEngineAnswer,JobSummary,TrackedCompetitor} from '@c360/contracts';
import {Badge,Button,Card,Disclosure,Notice} from '@c360/ui';
import {api,type ApiClientError} from '../api/client.js';
import {useCourses} from '../api/campaign-queries.js';
import {StandaloneContentForm} from '../components/StandaloneContentForm.js';
import {AddSourceAsCompetitor} from '../components/AddSourceAsCompetitor.js';
import {AiVisibilityPage} from './AiVisibilityPage.js';
import './ai-visibility.css';
const finished=new Set(['succeeded','dead','failed','cancelled']);
function download(name:string,text:string,type='text/markdown'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
/**
 * AI Visibility & GEO — pattern C, without a third column.
 *
 * Four sub-views in a rail, one subject in the workspace: what assistants
 * answered, which sources they leaned on, what that means for the course page
 * and the blog, and what the research itself could not see.
 *
 * Every count on this screen is computed from the data it is about to render.
 * "11 bronnen, 26 vermeldingen, 6 met citaatlink" is three `length` calls, not
 * three numbers typed into the markup — a number nobody can recompute is a
 * number nobody can check.
 */
export function GeoPage({ label }: { label: LabelSummary | undefined }): ReactNode {
  return label ? (
    <GeoLabel key={label.id} label={label} />
  ) : (
    <div className="os-page">
      <Notice tone="warning">Kies eerst een label.</Notice>
    </div>
  );
}

function GeoLabel({ label }: { label: LabelSummary }): ReactNode {
  const [course, setCourse] = useState('');
  const [search, setSearch] = useState('');
  const [params, setParams] = useSearchParams();
  const courses = useCourses(label.id);
  const courseId =
    course ||
    ((params.get('label') === label.id ? params.get('course') : null) ??
      courses.data?.items[0]?.course.id ??
      '');
  const base = `/labels/${label.id}/ai-visibility/geo`;
  const view = params.get('view') ?? '';

  const history = useQuery<
    {
      items: {
        id: string;
        course_version_id: string;
        course_name: string;
        created_at: string;
        summary: string;
        is_mock: string;
      }[];
    },
    ApiClientError
  >({
    queryKey: ['geo-history', label.id, search],
    queryFn: ({ signal }) => api.get(`${base}/reports?search=${encodeURIComponent(search)}`, signal),
    enabled: view === 'history',
  });

  const chooser = (
    <label className="c360-field">
      <span className="c360-label">Voor welke opleiding?</span>
      <select
        className="c360-select"
        aria-label="Opleiding"
        value={courseId}
        onChange={(event) => {
          setCourse(event.target.value);
          setParams({});
        }}
      >
        {courses.data?.items.map((entry) => (
          <option value={entry.course.id} key={entry.course.id}>
            {entry.course.name}
          </option>
        ))}
      </select>
    </label>
  );

  if (!courseId) {
    return (
      <div className="os-page">
        {(courses.error ?? history.error) && (
          <Notice tone="warning">{(courses.error ?? history.error)?.userMessage}</Notice>
        )}
        <Notice tone="info">
          Voeg eerst een opleiding toe onder Kennis &amp; beheer. Dit onderzoek vergelijkt wat
          assistenten antwoorden met wat jouw opleidingspagina zegt, dus zonder pagina is er niets om
          mee te vergelijken.
        </Notice>
      </div>
    );
  }

  return (
    <div className="os-flow os-flow--two">
      {(courses.error ?? history.error) && (
        <Notice tone="warning">{(courses.error ?? history.error)?.userMessage}</Notice>
      )}
      <GeoCourse
        key={courseId}
        label={label}
        courseId={courseId}
        chooser={chooser}
        view={view}
        onView={(next) => {
          setParams(
            (previous) => {
              const nextParams = new URLSearchParams(previous);
              if (next === '') nextParams.delete('view');
              else nextParams.set('view', next);
              return nextParams;
            },
            { replace: true },
          );
        }}
        history={{
          search,
          onSearch: setSearch,
          items: history.data?.items ?? [],
          pending: history.isPending,
          open: (reportId, courseVersionId) => {
            setCourse(courseVersionId);
            setParams({ report: reportId, label: label.id, course: courseVersionId });
          },
        }}
        selectedReport={params.get('label') === label.id ? (params.get('report') ?? '') : ''}
        onReport={(id) => {
          setParams(id ? { report: id, label: label.id, course: courseId } : {});
        }}
        onSaved={() => {
          void history.refetch();
        }}
      />
    </div>
  );
}

interface GeoHistory {
  search: string;
  onSearch: (value: string) => void;
  items: readonly {
    id: string;
    course_version_id: string;
    course_name: string;
    created_at: string;
    summary: string;
    is_mock: string;
  }[];
  pending: boolean;
  open: (reportId: string, courseVersionId: string) => void;
}

/** The sub-views of one research run, in the order the questions arrive. */
type GeoView =
  | 'answers'
  | 'comparison'
  | 'advice'
  | 'sources'
  | 'notes'
  | 'history'
  | 'setup'
  | 'manual';

function GeoCourse({
  label,
  courseId,
  chooser,
  view,
  onView,
  history,
  selectedReport,
  onReport,
  onSaved,
}: {
  label: LabelSummary;
  courseId: string;
  chooser: ReactNode;
  view: string;
  onView: (view: string) => void;
  history: GeoHistory;
  selectedReport: string;
  onReport: (id: string) => void;
  onSaved: () => void;
}): ReactNode {
  const base = `/labels/${label.id}/ai-visibility/geo`;
  const setup = useQuery<GeoSetup, ApiClientError>({
    queryKey: ['geo-setup', label.id, courseId],
    queryFn: ({ signal }) => api.get(`${base}/setup/${courseId}`, signal),
  });
  const latest = useQuery<{ job: JobSummary | null; reportId?: string | null }, ApiClientError>({
    queryKey: ['geo-job', label.id, courseId],
    queryFn: ({ signal }) => api.get(`${base}/latest/${courseId}`, signal),
    refetchInterval: (q) => (q.state.data?.job && !finished.has(q.state.data.job.status) ? 2000 : false),
  });
  const captured = useQuery<GeoEngineAnswer[], ApiClientError>({
    queryKey: ['geo-answers', label.id, latest.data?.job?.id, latest.data?.job?.status],
    queryFn: ({ signal }) => api.get(`${base}/answers/${String(latest.data?.job?.id)}`, signal),
    enabled: Boolean(latest.data?.job),
    refetchInterval: (q) =>
      latest.data?.job && !finished.has(latest.data.job.status) && !q.state.data?.length ? 3000 : false,
  });
  const job = latest.data?.job;
  const automaticId =
    job?.status === 'succeeded' && typeof job.result?.reportId === 'string' ? job.result.reportId : '';
  const reportId = selectedReport || automaticId || (latest.data?.reportId ?? '');
  const report = useQuery<GeoReport, ApiClientError>({
    queryKey: ['geo-report', label.id, reportId, job?.status],
    queryFn: ({ signal }) => api.get(`${base}/reports/${reportId}`, signal),
    enabled: Boolean(reportId),
  });

  const busy = Boolean(job) && !finished.has(job?.status ?? '');
  const canWrite = label.role === 'label_manager' || label.role === 'label_editor';
  const r = report.data;

  /* One row per cited URL, with how often it came back and under how many
     questions. Counted here from the answers themselves. */
  const citedSources = aggregateSources(r?.engineAnswers ?? captured.data ?? []);
  const ownHosts = hostsOf([r?.courseUrl ?? setup.data?.courseUrl]);
  const proposals = (r?.analysis.items ?? []).filter(
    (item) => item.pageChange !== null || item.blog !== null,
  );

  const views: readonly { id: GeoView; labelNl: string; hintNl: string; count?: number }[] = [
    ...(r?.engineAnswers
      ? ([
          {
            id: 'answers' as const,
            labelNl: 'Zoekvragen',
            hintNl: 'Wat een assistent antwoordde',
            count: r.engineAnswers.length,
          },
          {
            id: 'sources' as const,
            labelNl: 'Genoemde bronnen',
            hintNl: 'Welke pagina’s zijn aangehaald',
            count: citedSources.length,
          },
          { id: 'comparison' as const, labelNl: 'Vergelijking', hintNl: 'Antwoord naast onze pagina' },
        ] as const)
      : []),
    ...(r
      ? ([
          {
            id: 'advice' as const,
            labelNl: 'Paginavoorstellen',
            hintNl: 'Tekst voor pagina en blog',
            count: proposals.length,
          },
          {
            id: 'notes' as const,
            labelNl: 'Onderzoeksnotities',
            hintNl: 'Wat is gelezen en wat niet',
            count: r.pages.length + r.failures.length,
          },
        ] as const)
      : []),
    { id: 'setup' as const, labelNl: 'Nieuw onderzoek', hintNl: 'Vragen controleren en starten' },
    { id: 'history' as const, labelNl: 'Bewaarde onderzoeken', hintNl: 'Terugvinden wat eerder liep' },
    { id: 'manual' as const, labelNl: 'Handmatige metingen', hintNl: 'Losse metingen in AI-producten' },
  ];

  const fallback: GeoView = r === undefined ? 'setup' : r.engineAnswers ? 'answers' : 'advice';
  const active: GeoView = views.some((entry) => entry.id === view) ? (view as GeoView) : fallback;

  return (
    <>
      <aside className="os-siderail">
        <div className="os-siderail__intro">
          <p className="os-eyebrow">AI Visibility &amp; GEO</p>
          <p className="os-siderail__course">
            {r === undefined
              ? 'Nog geen onderzoek'
              : `Onderzoek van ${new Date(r.createdAt).toLocaleString('nl-NL')}`}
          </p>
          {r !== undefined && (
            <p className="os-siderail__note">
              {`${String(r.engineAnswers?.length ?? 0)} vragen · ${String(citedSources.length)} bronnen · ${String(
                citedSources.reduce((total, source) => total + source.mentions, 0),
              )} vermeldingen`}
            </p>
          )}
        </div>

        {chooser}

        <div className="os-siderail__group" role="tablist" aria-label="AI Visibility-weergaven">
          {views.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`geo-tab-${entry.id}`}
              aria-selected={active === entry.id}
              aria-controls={`geo-${entry.id}`}
              className="os-step os-step--plain"
              onClick={() => {
                onView(entry.id);
              }}
            >
              <span className="os-step__text">
                <span className="os-step__label">{entry.labelNl}</span>
                <span className="os-step__state" title={entry.hintNl}>
                  {entry.hintNl}
                </span>
              </span>
              {entry.count !== undefined && <span className="os-step__count">{entry.count}</span>}
            </button>
          ))}
        </div>

        {r !== undefined && (
          <div className="os-siderail__divider">
            <p className="os-eyebrow os-eyebrow--muted">Downloaden</p>
            <div className="c360-stack" style={{ gap: 6 }}>
              <Button
                size="sm"
                variant="secondary"
                disabled={r.analysisStatus === 'unavailable'}
                onClick={() => {
                  download(`geo-${r.id}.md`, reportMarkdown(r));
                }}
              >
                Pagina- en blogvoorstellen
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  download(`geo-bewijs-${r.id}.json`, JSON.stringify(r, null, 2), 'application/json');
                }}
              >
                Bronnen &amp; onderzoek
              </Button>
            </div>
          </div>
        )}
      </aside>

      <section className="os-detail os-detail--reading">
        {(setup.error ?? latest.error ?? report.error) && (
          <Notice tone="warning">{(setup.error ?? latest.error ?? report.error)?.userMessage}</Notice>
        )}

        <div className="os-page__head">
          <div className="os-page__head-text">
            <h1>{GEO_VIEW_TITLE_NL[active]}</h1>
            <p className="c360-page-lead">{GEO_VIEW_LEAD_NL[active]}</p>
          </div>
        </div>

        {r?.isMock === true && (
          <Notice tone="warning">Testresultaat — geen echte marktmeting.</Notice>
        )}

        {job && (busy || job.failureMessage !== null || r === undefined) && (
          <section className="os-panel os-panel--pad" aria-label="Voortgang">
            <h2 className="os-panel__title">{busy ? 'Onderzoek loopt' : 'Laatste onderzoek'}</h2>
            <p className="os-panel__sub">{job.progress?.message ?? job.status}</p>
            {busy && (
              <p className="os-limit" style={{ marginTop: 6 }}>
                Je kunt deze pagina sluiten; het onderzoek loopt op de achtergrond door.
              </p>
            )}
            {job.failureMessage !== null && (
              <Notice tone="warning">
                {captured.data?.some((a) => a.status === 'succeeded')
                  ? 'ChatGPT-antwoorden zijn bewaard. De vervolgstap is niet voltooid. Opnieuw proberen gebruikt dezelfde antwoorden.'
                  : job.failureMessage}
              </Notice>
            )}
            {job.retryable && canWrite && (
              <Retry
                jobId={job.id}
                onRetry={() => {
                  void latest.refetch();
                }}
              />
            )}
          </section>
        )}

        {active === 'setup' && setup.data && (
          <ResearchForm
            key={`${courseId}:${setup.data.courseUrl ?? ''}`}
            setup={setup.data}
            canWrite={canWrite}
            busy={busy}
            base={base}
            courseId={courseId}
            onStart={async () => {
              onReport('');
              await latest.refetch();
              await setup.refetch();
              onSaved();
            }}
          />
        )}

        {active === 'history' && <GeoHistoryView history={history} />}

        {active === 'manual' && (
          <div id="geo-manual" role="tabpanel" aria-labelledby="geo-tab-manual">
            <AiVisibilityPage label={label} />
          </div>
        )}

        {active === 'answers' && (
          <div id="geo-answers" role="tabpanel" aria-labelledby="geo-tab-answers">
            <EngineAnswers
              answers={r?.engineAnswers ?? captured.data ?? []}
              labelName={r?.labelName ?? label.name}
              labelId={label.id}
              ownHosts={ownHosts}
            />
          </div>
        )}

        {active === 'sources' && (
          <div id="geo-sources" role="tabpanel" aria-labelledby="geo-tab-sources">
            <CitedSourcesTable sources={citedSources} labelId={label.id} ownHosts={ownHosts} />
          </div>
        )}

        {active === 'comparison' && r !== undefined && (
          <div id="geo-comparison" role="tabpanel" aria-labelledby="geo-tab-comparison" className="c360-stack">
            <p className="os-limit">{r.analysis.summary}</p>
            {r.analysis.items.map((item, index) => (
              <article className="os-rowcard" key={index}>
                <p className="os-rowcard__title">{item.question}</p>
                <p className="os-rowcard__body">{item.finding}</p>
                {item.evidence.map((evidence, j) => (
                  <blockquote key={j}>
                    {evidence.quote}
                    <br />
                    <a href={evidence.url} target="_blank" rel="noreferrer">
                      {evidence.url}
                    </a>
                  </blockquote>
                ))}
                <p className="os-rowcard__meta">{item.limitations}</p>
              </article>
            ))}
          </div>
        )}

        {active === 'advice' && r !== undefined && (
          <GeoAdvice report={r} labelId={label.id} />
        )}

        {active === 'notes' && r !== undefined && (
          <div id="geo-notes" role="tabpanel" aria-labelledby="geo-tab-notes" className="os-panel">
            {r.pages.map((page, index) => (
              <details key={index} className="os-defrow" style={{ borderTop: index === 0 ? 0 : undefined }}>
                <summary>{`${page.role === 'course_page' ? 'Cursuspagina' : 'Externe bron'} · ${page.url}`}</summary>
                <p className="os-rowcard__meta">{page.retrievedAt}</p>
                <pre>{page.text}</pre>
              </details>
            ))}
            {r.failures.map((failure, index) => (
              <p className="os-defrow" key={`fail-${String(index)}`}>
                <span className="os-rowcard__meta">{`${failure.url}: ${failure.reason}`}</span>
              </p>
            ))}
            <div className="os-panel__foot">
              <p className="os-limit">
                {`Gelezen tekst is maximaal 12.000 tekens per pagina; citaten zijn tegen die opgeslagen tekst gecontroleerd. Dit is geen volledige technische site-audit. Wat hier niet staat, is niet gemeten: er is geen positie, geen aandeel en geen trend over tijd. Onderzoek ${r.id} · merkreferentie ${r.brandVersionId} · prompt ${r.promptVersion}.`}
              </p>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

const GEO_VIEW_TITLE_NL: Readonly<Record<GeoView, string>> = Object.freeze({
  answers: 'Zoekvragen & antwoorden',
  sources: 'Genoemde bronnen',
  comparison: 'Vergelijking',
  advice: 'Paginavoorstellen',
  notes: 'Onderzoeksnotities',
  setup: 'Nieuw onderzoek',
  history: 'Bewaarde onderzoeken',
  manual: 'Handmatige metingen',
});

const GEO_VIEW_LEAD_NL: Readonly<Record<GeoView, string>> = Object.freeze({
  answers:
    'De letterlijke antwoordtekst per vraag, met het oordeel of dit label erin voorkomt. Eén momentopname per vraag, geen algemene ranking.',
  sources:
    'De pagina’s die in de antwoorden werden aangehaald, met hoe vaak en onder hoeveel vragen. Een genoemde zoekbron bewijst geen koppeling met een specifieke zin.',
  comparison: 'Wat de antwoorden zeggen, naast wat onze eigen pagina erover uitlegt.',
  advice:
    'Tekstvoorstellen voor de opleidingspagina en de blog, met het bewijs eronder. Voorstellen om te controleren, geen goedgekeurde publicaties en geen bewezen zichtbaarheidstoename.',
  notes: 'Wat is gelezen, wat is geweigerd, en wat buiten beeld bleef.',
  setup: 'Controleer de vragen en start. Vragen zijn voorstellen, geen gemeten zoekvolume.',
  history: 'Onderzoeken die eerder zijn bewaard voor dit label.',
  manual:
    'Losse metingen die iemand met de hand in een AI-product doet. Ze staan bewust apart van het webonderzoek: het zijn twee verschillende manieren van kijken, en een los antwoord is geen onderzoek.',
});

function GeoHistoryView({ history }: { history: GeoHistory }): ReactNode {
  return (
    <div id="geo-history" role="tabpanel" aria-labelledby="geo-tab-history" className="c360-stack">
      <label className="c360-field">
        <span className="c360-label">Zoeken op opleiding, vraag of inhoud</span>
        <input
          className="c360-input"
          value={history.search}
          onChange={(event) => {
            history.onSearch(event.target.value);
          }}
          placeholder="Bijvoorbeeld CROV of vaardigheden"
        />
      </label>
      {history.pending && <p className="c360-card__hint">Laden…</p>}
      {!history.pending && history.items.length === 0 && (
        <Notice tone="info">Nog geen passende onderzoeken gevonden.</Notice>
      )}
      {history.items.map((entry) => (
        <article className="os-rowcard" key={entry.id}>
          <div className="os-rowcard__top">
            <div style={{ minWidth: 0 }}>
              <p className="os-eyebrow os-eyebrow--muted">{entry.course_name}</p>
              <p className="os-rowcard__title">{entry.summary}</p>
            </div>
            {entry.is_mock === 'true' && <span className="os-pill os-pill--warn">Testdata</span>}
          </div>
          <p className="os-rowcard__meta">{new Date(entry.created_at).toLocaleString('nl-NL')}</p>
          <div>
            <Button
              size="sm"
              onClick={() => {
                history.open(entry.id, entry.course_version_id);
              }}
            >
              Onderzoek openen
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * The page and blog proposals, one card per question.
 *
 * A proposal that exists only in this report is a proposal nobody can review,
 * version or export, so each one carries the hand-off into Content Studio with
 * the finding attached (`originKind`).
 */
function GeoAdvice({ report: r, labelId }: { report: GeoReport; labelId: string }): ReactNode {
  const [making, setMaking] = useState<{ title: string; question: string; finding: string } | null>(
    null,
  );

  return (
    <div id="geo-advice" role="tabpanel" aria-labelledby="geo-tab-advice" className="c360-stack">
      {making !== null && (
        <StandaloneContentForm
          labelId={labelId}
          seed={{
            courseVersionId: r.courseVersionId,
            angleNl: `${making.title}\n\nVraag uit het onderzoek: ${making.question}\n\nBevinding: ${making.finding}`,
            originKind: 'geo_report',
            originRefId: r.id,
          }}
          onQueued={() => {
            setMaking(null);
          }}
          onCancel={() => {
            setMaking(null);
          }}
        />
      )}

      {r.analysisStatus === 'unavailable' && (
        <Notice tone="warning">
          {`De analyse is niet voltooid, dus er zijn nog geen onderbouwde tekstvoorstellen. ${r.analysis.summary}`}
        </Notice>
      )}

      {r.analysis.items.map((item, index) => (
        <article className="os-rowcard" key={index}>
          <div className="os-rowcard__top">
            <div style={{ minWidth: 0 }}>
              <p className="os-eyebrow os-eyebrow--muted">
                {item.relevance === 'relevant'
                  ? 'Relevant voor deze cursus'
                  : item.relevance === 'not_relevant'
                    ? 'Geen passende cursuskoppeling'
                    : 'Relevantie onvoldoende onderbouwd'}
              </p>
              <p className="os-rowcard__title">{item.question}</p>
            </div>
            <span className={`os-pill ${item.blog === null && item.pageChange === null ? '' : 'os-pill--brand'}`}>
              {item.blog === null && item.pageChange === null ? 'Geen voorstel' : 'Voorstel'}
            </span>
          </div>
          <p className="os-rowcard__body">{item.finding}</p>

          {item.pageChange !== null && (
            <div>
              <h3>{`Wijziging cursuspagina: ${item.pageChange.placement}`}</h3>
              <p className="os-rowcard__body">{item.pageChange.reason}</p>
              <pre>{item.pageChange.proposedText}</pre>
            </div>
          )}

          {item.blog !== null && (
            <div>
              <h3>{`Blogvoorstel: ${item.blog.title}`}</h3>
              <pre>{item.blog.body}</pre>
              <p className="os-rowcard__body">
                Interne link:{' '}
                <a href={r.courseUrl} target="_blank" rel="noreferrer">
                  {item.blog.internalLinkText}
                </a>
              </p>
              <div className="c360-row">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const blog = item.blog;
                    if (blog === null) return;
                    download(
                      `blog-${String(index + 1)}.md`,
                      `# ${blog.title}\n\n${blog.body}\n\n[${blog.internalLinkText}](${r.courseUrl})\n\nConcept — controleer voor publicatie.`,
                    );
                  }}
                >
                  Deze blog downloaden
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    const blog = item.blog;
                    if (blog === null) return;
                    setMaking({ title: blog.title, question: item.question, finding: item.finding });
                  }}
                >
                  Hier een losse uiting van maken
                </Button>
              </div>
            </div>
          )}

          {item.pageChange === null && item.blog === null && (
            <p className="os-note os-note--quiet">Geen tekstvoorstel: onvoldoende relevant bewijs.</p>
          )}

          <p className="os-rowcard__meta">{item.limitations}</p>
          <details>
            <summary>Waar komt dit advies vandaan?</summary>
            {item.evidence.map((evidence, j) => (
              <blockquote key={j}>
                {evidence.quote}
                <br />
                <a href={evidence.url} target="_blank" rel="noreferrer">
                  {evidence.url}
                </a>
              </blockquote>
            ))}
          </details>
        </article>
      ))}
    </div>
  );
}

interface CitedSource {
  url: string;
  title: string;
  kinds: string[];
  /** In how many of the asked questions this page came back. */
  inQuestions: number;
  /** How often it was named across all answers. */
  mentions: number;
  /** Whether the collector supplied it as a real citation link. */
  linked: boolean;
}

/**
 * Every page the answers leaned on, counted.
 *
 * `mentions` and `inQuestions` differ on purpose: one page can be named twice
 * under the same question (once as a search source and once as an attached
 * link), and reporting that as two questions would overstate its reach.
 */
function aggregateSources(answers: readonly GeoEngineAnswer[]): CitedSource[] {
  const byUrl = new Map<string, CitedSource>();
  for (const answer of answers) {
    const seenHere = new Set<string>();
    for (const source of answer.sources) {
      const kind = geoSourceKindNl(source.kind);
      const existing = byUrl.get(source.url);
      const entry: CitedSource = existing ?? {
        url: source.url,
        title: source.title,
        kinds: [],
        inQuestions: 0,
        mentions: 0,
        linked: false,
      };
      if (!entry.kinds.includes(kind)) entry.kinds.push(kind);
      entry.mentions += 1;
      if (!seenHere.has(source.url)) {
        entry.inQuestions += 1;
        seenHere.add(source.url);
      }
      if (source.kind === 'citation') entry.linked = true;
      byUrl.set(source.url, entry);
    }
  }
  return [...byUrl.values()].sort((a, b) => b.mentions - a.mentions || a.title.localeCompare(b.title, 'nl'));
}

function CitedSourcesTable({
  sources,
  labelId,
  ownHosts,
}: {
  sources: readonly CitedSource[];
  labelId: string;
  ownHosts: readonly string[];
}): ReactNode {
  const known = useQuery<{ items: TrackedCompetitor[] }, ApiClientError>({
    queryKey: ['competitors', labelId],
    queryFn: ({ signal }) => api.get(`/labels/${labelId}/competitors`, signal),
  });

  if (sources.length === 0) {
    return (
      <Notice tone="info">
        Dit onderzoek heeft geen bronnen aangeleverd gekregen. Dat betekent niet dat het antwoord er
        geen gebruikte — het betekent dat de collector er geen meestuurde.
      </Notice>
    );
  }

  const linked = sources.filter((source) => source.linked).length;

  return (
    <div className="os-panel">
      <div className="c360-table-scroll">
        <table className="c360-table">
          <thead>
            <tr>
              <th scope="col">Bron</th>
              <th scope="col">In vragen</th>
              <th scope="col">Genoemd</th>
              <th scope="col">Soort</th>
              <th scope="col">Toevoegen</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.url}>
                <td>
                  <a href={source.url} target="_blank" rel="noreferrer" title={source.url}>
                    {source.title}
                  </a>
                  <br />
                  <span className="os-num" style={{ fontSize: 10.5, color: 'var(--tx-3)' }}>
                    {hostOf(source.url)}
                  </span>
                </td>
                <td className="os-num">{source.inQuestions}</td>
                <td className="os-num">{source.mentions}</td>
                <td>{source.kinds.join(' · ')}</td>
                <td>
                  <AddSourceAsCompetitor
                    labelId={labelId}
                    sourceUrl={source.url}
                    sourceTitle={source.title}
                    known={known.data?.items ?? []}
                    ownHosts={ownHosts}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="os-panel__foot">
        <p className="os-limit">
          {`${String(sources.length)} bron(nen), ${String(
            sources.reduce((total, source) => total + source.mentions, 0),
          )} vermelding(en), ${String(linked)} met citaatlink. Een genoemde zoekbron bewijst geen koppeling met een specifieke zin in het antwoord.`}
        </p>
      </div>
    </div>
  );
}

/** The host of a URL, for the second line of a source row. */
function hostOf(url: string): string {
  return /^https?:\/\/([^/?#]+)/iu.exec(url.trim())?.[1]?.toLowerCase() ?? url;
}

/** The whole report as one Markdown document, for the download. */
function reportMarkdown(r: GeoReport): string {
  return `# GEO-onderzoek: ${r.courseName}\n\nConcept voor inhoudelijke controle. ${r.createdAt}\nCursuspagina: ${r.courseUrl}\n\n${r.analysis.summary}\n\n${r.analysis.items
    .map(
      (i) =>
        `## ${i.question}\n\n${i.finding}\n\n${i.pageChange ? `### Cursuspagina — ${i.pageChange.placement}\n${i.pageChange.reason}\n\n${i.pageChange.proposedText}` : ''}\n\n${i.blog ? `### Blog: ${i.blog.title}\n\n${i.blog.body}\n\n[${i.blog.internalLinkText}](${r.courseUrl})` : ''}\n\nBeperkingen: ${i.limitations}\n\n${i.evidence.map((e) => `Bron: ${e.url}\n> ${e.quote}`).join('\n\n')}`,
    )
    .join('\n\n')}\n\nOnderzoek-ID: ${r.id}`;
}

function Retry({jobId,onRetry}:{jobId:string;onRetry:()=>void}):ReactNode{const retry=useMutation<unknown,ApiClientError>({mutationFn:()=>api.post(`/jobs/${jobId}/retry`),onSuccess:onRetry});return <>{retry.error&&<Notice tone="warning">{retry.error.userMessage}</Notice>}<Button disabled={retry.isPending} onClick={()=>retry.mutate()}>Opnieuw proberen</Button></>;}
function ResearchForm({setup,canWrite,busy,base,courseId,onStart}:{setup:GeoSetup;canWrite:boolean;busy:boolean;base:string;courseId:string;onStart:()=>Promise<void>}):ReactNode{
 const [mode,setMode]=useState<'web_research'|'chatgpt'>(setup.canMeasureChatgpt?'chatgpt':'web_research');
 const [questions,setQuestions]=useState(setup.questions);const [selected,setSelected]=useState(setup.questions.map(()=>true));const [url,setUrl]=useState(setup.courseUrl??'');const [key,setKey]=useState(()=>crypto.randomUUID());
 const start=useMutation<JobSummary,ApiClientError>({mutationFn:()=>api.post(`${base}/start`,{mode,courseVersionId:courseId,courseUrl:url,questions:questions.filter((_,i)=>selected[i]),approved:true,requestKey:key}),onSuccess:async()=>{setKey(crypto.randomUUID());await onStart();}});
 return <Card ariaLabel="Vragen controleren"><h2>1. Controleer de vragen en start</h2><p>Label en cursus zijn ingevuld. Selecteer of wijzig de vragen; we zoeken bronnen en onderzoeken wat jouw pagina hierover uitlegt.</p><form onSubmit={e=>{e.preventDefault();start.mutate();}}><label>Onderzoeksmethode<select value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="chatgpt" disabled={!setup.canMeasureChatgpt}>ChatGPT-antwoorden → bronnen vergelijken → siteadvies</option><option value="web_research">Alleen webonderzoek</option></select></label>{!setup.canMeasureChatgpt&&<p>ChatGPT-metingen worden beschikbaar zodra Bright Data op de server is ingesteld.</p>}<label>Cursuspagina<input aria-label="Cursuspagina" type="url" value={url} onChange={e=>setUrl(e.target.value)} required placeholder="https://…"/></label><small>Deze URL wordt bij de opleiding onthouden. Je hoeft hem maar één keer in te vullen als hij nog ontbreekt.</small>
 {questions.map((q,i)=><div className="geo-question" key={i}><label><input aria-label={`Vraag ${String(i+1)} meenemen`} type="checkbox" checked={selected[i]} onChange={e=>setSelected(old=>old.map((v,j)=>j===i?e.target.checked:v))}/>Vraag {i+1}</label><textarea aria-label={`Vraag ${String(i+1)}`} value={q} onChange={e=>setQuestions(old=>old.map((v,j)=>j===i?e.target.value:v))} minLength={10} maxLength={500} required={selected[i]}/></div>)}
 <p>{mode==='chatgpt'?'Elke gekozen vraag wordt ongewijzigd aan ChatGPT gesteld via Bright Data, vanuit Nederland met webzoeken toegestaan. Daarna lezen we bronnen en maken we siteadvies. Maximaal vijf metingen; providerkosten staan los van de AI-analyse en hangen af van je Bright Data-tegoed.':'Automatisch webonderzoek: één zoekstap en één analysestap.'} Vragen zijn voorstellen, geen gemeten zoekvolume. Controleer dat je vraag geen gewenst merkantwoord voorschrijft.</p>{mode==='web_research'&&!setup.canSearch&&<Notice tone="warning">Webzoeken is niet beschikbaar bij de ingestelde provider.</Notice>}{start.error&&<Notice tone="warning">{start.error.userMessage}</Notice>}
 <Button type="submit" disabled={!canWrite||busy||start.isPending||(mode==='chatgpt'?!setup.canMeasureChatgpt:!setup.canSearch)||!selected.some(Boolean)}>{start.isPending?'Onderzoek starten…':'Vragen goedkeuren & onderzoek starten'}</Button></form></Card>;
}
/** How the collector labelled a source, in the words of the screen. */
const GEO_SOURCE_KIND_NL = {
  citation: 'Citaatlink',
  search_source: 'Zoekbron',
} as const;

function geoSourceKindNl(kind: string): string {
  return kind === 'citation' || kind === 'search_source' ? GEO_SOURCE_KIND_NL[kind] : 'Bijgevoegde link';
}

/**
 * One row per URL, with every label the collector gave it.
 *
 * The same nine pages came back once as "Zoekbron" and again as "Bijgevoegde
 * link", so the list read as eighteen sources where there were nine
 * (2026-09-15). Collapsing them keeps both labels visible without claiming two
 * findings.
 */
function mergeGeoSources(
  sources: readonly { url: string; title: string; kind: string }[],
): { url: string; title: string; kinds: string[] }[] {
  const byUrl = new Map<string, { url: string; title: string; kinds: string[] }>();
  for (const source of sources) {
    const existing = byUrl.get(source.url);
    const kind = geoSourceKindNl(source.kind);
    if (existing === undefined) byUrl.set(source.url, { url: source.url, title: source.title, kinds: [kind] });
    else if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
  }
  return [...byUrl.values()];
}

/** The hostnames of our own pages, for the "this is your own site" check. */
function hostsOf(urls: readonly (string|null|undefined)[]): string[] {
  return [...new Set(urls.flatMap(url => {
    const host = /^https?:\/\/([^/?#]+)/iu.exec((url ?? '').trim())?.[1]?.toLowerCase().replace(/\.$/u, '');
    return host === undefined ? [] : [host];
  }))];
}

function EngineAnswers({
  answers,
  labelName,
  labelId,
  ownHosts,
}: {
  answers: GeoEngineAnswer[];
  labelName: string;
  labelId: string;
  ownHosts: readonly string[];
}): ReactNode {
  // One read of the registry for the whole list, so a source already known is
  // shown as such instead of offering to add it twice.
  const known = useQuery<{ items: TrackedCompetitor[] }, ApiClientError>({
    queryKey: ['competitors', labelId],
    queryFn: ({ signal }) => api.get(`/labels/${labelId}/competitors`, signal),
  });
  return (
    <>
      <h3>Wat antwoordde ChatGPT?</h3>
      <p>
        Letterlijke antwoordtekst via Bright Data. Dit is een momentopname per vraag; geen algemene
        ranking. De vermelding hieronder is een exacte tekstcontrole op de labelnaam, geen herkenning
        van alle merknamen.
      </p>
      {answers.map((answer, index) => (
        <EngineAnswer key={index} answer={answer} labelName={labelName} labelId={labelId} known={known.data?.items ?? []} ownHosts={ownHosts} />
      ))}
    </>
  );
}

function EngineAnswer({
  answer,
  labelName,
  labelId,
  known,
  ownHosts,
}: {
  answer: GeoEngineAnswer;
  labelName: string;
  labelId: string;
  known: readonly TrackedCompetitor[];
  ownHosts: readonly string[];
}): ReactNode {
  const mentioned = answer.answer.toLocaleLowerCase().includes(labelName.toLocaleLowerCase());
  const sources = mergeGeoSources(answer.sources);
  return (
    <article className="geo-answer">
      <div className="geo-answer__head">
        <h4 className="geo-answer__question">{answer.question}</h4>
        {answer.status !== 'failed' && (
          <Badge tone={mentioned ? 'green' : 'neutral'}>
            {mentioned ? `${labelName} genoemd` : `${labelName} niet letterlijk gevonden`}
          </Badge>
        )}
      </div>
      {answer.status === 'failed' ? (
        <Notice tone="warning">{answer.error}</Notice>
      ) : (
        <>
          <p className="c360-card__hint">
            {`Land: ${answer.country ?? 'onbekend'} · Model: ${answer.model ?? 'niet aangeleverd'} · Webzoeken: ${answer.webSearchTriggered === null ? 'onbekend' : answer.webSearchTriggered ? 'uitgevoerd' : 'niet uitgevoerd'} · ${answer.capturedAt ?? 'Tijdstip niet aangeleverd'}`}
          </p>
          {/* The verbatim answer runs to a full screen; it scrolls in its own box
              so the questions under it stay reachable (2026-09-15). */}
          <pre className="geo-answer__text">{answer.answer}</pre>
          <p className="c360-card__hint">
            {answer.citationStatus === 'unknown'
              ? 'Citaatkoppelingen niet aangeleverd; onderstaande zoekbronnen en links bewijzen geen koppeling met een specifieke zin.'
              : 'Citaatlinks aangeleverd door de collector.'}
          </p>
          <Disclosure summary={`${String(sources.length)} bron(nen) die het antwoord noemde`} tone="plain">
            <ul className="geo-answer__sources">
              {sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>{' '}
                  <span className="c360-stat__caption">{source.kinds.join(' · ')}</span>
                  {/* Several of these pages are providers of the same course,
                      which is the most direct competitor evidence the product
                      has; until now it was a list of links with no way to act
                      on it (2026-09-15). */}
                  <div className="geo-answer__source-action">
                    <AddSourceAsCompetitor
                      labelId={labelId}
                      sourceUrl={source.url}
                      sourceTitle={source.title}
                      known={known}
                      ownHosts={ownHosts}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Disclosure>
        </>
      )}
    </article>
  );
}
