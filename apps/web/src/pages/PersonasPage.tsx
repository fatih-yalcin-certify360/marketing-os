import { useId, useState, type ReactNode } from 'react';
import type { JobSummary } from '@c360/contracts';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CHANNEL_LABEL_NL,
  PERSONA_CORE_QUESTION_IDS,
  personaInput,
  type LabelSummary,
  type PersonaProposal,
  type PersonaVersion,
} from '@c360/contracts';
import { Badge, Button, Card, Disclosure, Notice, Skeleton } from '@c360/ui';
import {
  useApprovePersona,
  useCampaigns,
  useCourses,
  useFillPersonaOrientation,
  useFillPersonaQuestionnaire,
  usePersonas,
  usePromotePersona,
} from '../api/campaign-queries.js';
import { PersonaEditor } from '../components/PersonaEditor.js';
import {
  PersonaQuestionnaire,
  coreQuestionCount,
  questionnaireCount,
  questionnaireStats,
} from '../components/PersonaQuestionnaire.js';
import { PersonaQuestionnaireFill } from '../components/PersonaQuestionnaireFill.js';
import { PersonaTrail } from '../components/PersonaTrail.js';
import { JobWatcher } from '../components/JobWatcher.js';
import { Modal } from '../components/Modal.js';
import './personas.css';

/**
 * The persona library of a course, plus everything the campaigns proposed.
 *
 * Two tabs on purpose. The library holds the personas a person chose to
 * keep — made by hand, imported, or saved from a campaign. "Uit campagnes"
 * shows what the system proposed inside campaigns: those personas used to be
 * invisible here and editable nowhere, which read as "new personas are not
 * added". They are listed with the campaign they belong to, can be corrected
 * with the same editor, and can be saved into the library as a copy; the
 * campaign keeps its own version.
 */
export function PersonasPage(props: { label: LabelSummary | undefined }): ReactNode {
  return props.label ? (
    <Library key={props.label.id} label={props.label} />
  ) : (
    <div className="os-page">
      <Notice tone="warning">Kies eerst een label.</Notice>
    </div>
  );
}

function download(proposal: PersonaProposal): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(personaInput.parse(proposal), null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'persona.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

const WRITABLE_ROLES: readonly LabelSummary['role'][] = ['label_manager', 'label_editor'];
/** Mirrors `persona:approve`, which the manager and the approver hold. */
const APPROVING_ROLES: readonly LabelSummary['role'][] = ['label_manager', 'label_approver'];

type Shelf = 'library' | 'campaigns';

function Library(props: { label: LabelSummary }): ReactNode {
  const { label } = props;
  const [params, setParams] = useSearchParams();
  const courses = useCourses(label.id);
  const course = params.get('course') ?? courses.data?.items[0]?.course.id ?? '';
  const courseName =
    courses.data?.items.find((item) => item.course.id === course)?.course.name ?? 'de gekozen opleiding';
  const everything = usePersonas(label.id, course || undefined, undefined, 'all');
  const campaigns = useCampaigns(label.id);
  const promote = usePromotePersona(label.id);
  const approve = useApprovePersona(label.id);
  const [search, setSearch] = useState('');
  const [shelf, setShelf] = useState<Shelf>('library');
  const [editing, setEditing] = useState<PersonaVersion | null>(null);
  const [makingNew, setMakingNew] = useState(false);
  const [saved, setSaved] = useState('');
  const writable = WRITABLE_ROLES.includes(label.role);
  const canApprove = APPROVING_ROLES.includes(label.role);
  const ids = { course: useId(), search: useId(), editor: useId() };

  const matches = (persona: PersonaVersion): boolean =>
    `${persona.name} ${persona.summary}`.toLowerCase().includes(search.toLowerCase());
  const items = everything.data?.items ?? [];
  const libraryAll = items.filter((persona) => persona.campaignId === null);
  const fromCampaignsAll = items.filter((persona) => persona.campaignId !== null);
  const shown = (shelf === 'library' ? libraryAll : fromCampaignsAll).filter(matches);

  const campaignName = (id: string): string =>
    campaigns.data?.items.find((campaign) => campaign.id === id)?.name ?? 'een campagne';
  const courseNameOf = (id: string): string =>
    courses.data?.items.find((item) => item.course.id === id)?.course.name ?? 'een andere opleiding';
  const linkedNote = (persona: PersonaVersion): string | null => {
    const others = [persona.courseVersionId, ...persona.linkedCourseVersionIds].filter((id) => id !== course);
    if (persona.courseVersionId !== course) {
      return `Gemaakt voor ${courseNameOf(persona.courseVersionId)}; hier gekoppeld.`;
    }
    return others.length === 0 ? null : `Ook gekoppeld aan: ${others.map(courseNameOf).join(', ')}.`;
  };

  const selectedId = params.get('persona');
  const selected = shown.find((persona) => persona.id === selectedId) ?? shown[0];
  const select = (id: string): void => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('persona', id);
        return next;
      },
      { replace: true },
    );
    setEditing(null);
  };

  const editor = (persona: PersonaVersion | null): ReactNode => (
    <PersonaEditor
      key={`${course}:${persona?.id ?? 'new'}`}
      labelId={label.id}
      // An existing persona is edited against the course it was made for,
      // even when it is shown here through a link.
      courseId={persona?.courseVersionId ?? course}
      courseName={persona === null ? courseName : courseNameOf(persona.courseVersionId)}
      existing={persona}
      onSaved={(result) => {
        setSaved(
          result.campaignId === null
            ? `${result.name} is opgeslagen bij deze opleiding (versie ${String(result.version)}). Je kunt de persona kiezen in de stap Doelgroep van een campagne.`
            : `${result.name} is bijgewerkt naar versie ${String(result.version)} in ${campaignName(result.campaignId)}. Een briefing die op de oude versie rust, vraagt om een nieuwe beoordeling.`,
        );
        setEditing(null);
        setMakingNew(false);
      }}
      onCancel={() => {
        setEditing(null);
        setMakingNew(false);
      }}
    />
  );

  const loading = everything.isPending && course.length > 0;

  return (
    <div className="os-split os-split--narrow">
      <section className="os-split__list" aria-label="Doelgroepen">
        <div className="os-split__head">
          <div className="os-split__title">
            <h1>Doelgroepen</h1>
            <span className="os-split__count">
              {shown.length === (shelf === 'library' ? libraryAll : fromCampaignsAll).length
                ? `${String(shown.length)} persona’s`
                : `${String(shown.length)} van ${String((shelf === 'library' ? libraryAll : fromCampaignsAll).length)}`}
            </span>
          </div>

          <label className="c360-visually-hidden" htmlFor={ids.course}>
            Opleiding
          </label>
          <select
            id={ids.course}
            className="c360-select"
            value={course}
            onChange={(event) => {
              setParams({ course: event.target.value });
              setEditing(null);
              setSaved('');
            }}
          >
            {courses.data?.items.map((item) => (
              <option key={item.course.id} value={item.course.id}>
                {item.course.name}
              </option>
            ))}
          </select>

          <label className="c360-visually-hidden" htmlFor={ids.search}>
            Zoeken op naam of beschrijving
          </label>
          <input
            id={ids.search}
            className="c360-input"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Naam of beschrijving"
          />

          <div className="os-filters">
            <button
              type="button"
              className="os-filter"
              aria-pressed={shelf === 'library'}
              onClick={() => {
                setShelf('library');
              }}
            >
              Bibliotheek
              <span className="os-filter__count">{libraryAll.length}</span>
            </button>
            <button
              type="button"
              className="os-filter"
              aria-pressed={shelf === 'campaigns'}
              onClick={() => {
                setShelf('campaigns');
              }}
            >
              Uit campagnes
              <span className="os-filter__count">{fromCampaignsAll.length}</span>
            </button>
          </div>
        </div>

        <div className="os-split__scroll">
          {loading && (
            <div style={{ padding: 12 }}>
              <Skeleton lines={4} label="Persona's laden" />
            </div>
          )}
          {!loading && shown.length === 0 && (
            <p className="os-split__foot">
              {search.length > 0
                ? 'Geen persona past bij deze zoekopdracht.'
                : shelf === 'library'
                  ? 'Nog geen persona’s in de bibliotheek voor deze opleiding.'
                  : 'Nog geen voorstellen uit campagnes voor deze opleiding.'}
            </p>
          )}
          {shown.map((persona) => (
            <button
              key={persona.id}
              type="button"
              className="os-split__row"
              aria-current={selected?.id === persona.id}
              onClick={() => {
                select(persona.id);
              }}
            >
              <span className="os-split__marker" />
              <span className="os-split__body">
                <span className="os-split__line">
                  <span className="os-split__meta">{`v${String(persona.version)}`}</span>
                  <span style={{ flex: 1 }} />
                  <span className={`os-pill ${persona.origin === 'user' ? 'os-pill--ok' : 'os-pill--outline'}`}>
                    {persona.origin === 'user' ? 'Handmatig' : 'Voorstel'}
                  </span>
                </span>
                <span className="os-split__name">{persona.name}</span>
                <span className="os-split__meta">
                  {`${String(questionnaireCount(persona.questionnaire))}/36 vragen · ${String(persona.grounding.length)} onderbouwd`}
                </span>
              </span>
            </button>
          ))}
        </div>

        {course !== '' && writable && (
          <div className="os-split__foot">
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                setMakingNew(true);
              }}
            >
              Persona maken of importeren
            </Button>
          </div>
        )}
        {!courses.isPending && !courses.data?.items.length && (
          <div className="os-split__foot">
            <Link to="/beheer/opleidingen">Voeg eerst een opleiding toe.</Link>
          </div>
        )}
      </section>

      <section className="os-detail">
        {(courses.error ?? everything.error ?? promote.error) && (
          <Notice tone="warning">{(courses.error ?? everything.error ?? promote.error)?.userMessage}</Notice>
        )}
        {saved !== '' && (
          <Notice tone="neutral" live>
            {saved}
          </Notice>
        )}

        {makingNew && (
          <Modal
            labelledBy={ids.editor}
            onClose={() => {
              setMakingNew(false);
            }}
          >
            <h2 className="c360-section-title" id={ids.editor} style={{ margin: 0 }}>
              Persona maken of importeren
            </h2>
            {editor(null)}
          </Modal>
        )}

        {selected === undefined ? (
          <>
            <div className="os-page__head">
              <div className="os-page__head-text">
                <p className="os-eyebrow">Kennis &amp; beheer</p>
                <h1>Doelgroepen</h1>
                <p className="c360-page-lead">
                  Persona’s die je bewaart en hergebruikt: met de hand gemaakt, geïmporteerd of uit
                  een campagne overgenomen. Elke persona hoort bij één opleiding en kan aan andere
                  opleidingen worden gekoppeld.
                </p>
              </div>
            </div>
            <Notice tone="info">
              {shelf === 'library'
                ? 'Maak er zelf een, importeer een persona-bestand, of sla een voorstel uit een campagne op in de bibliotheek.'
                : 'Laat in een campagne doelgroepen voorstellen; ze verschijnen hier met de campagne waaruit ze komen.'}
            </Notice>
          </>
        ) : (
          <PersonaDetail
            key={selected.id}
            labelId={label.id}
            persona={selected}
            writable={writable}
            onApprove={
              canApprove && selected.reviewState !== 'approved'
                ? () => {
                    approve.mutate(
                      { personaVersionId: selected.id },
                      {
                        onSuccess: () => {
                          setSaved(`"${selected.name}" is goedgekeurd.`);
                        },
                      },
                    );
                  }
                : undefined
            }
            approving={approve.isPending}
            linkedNoteNl={linkedNote(selected)}
            campaignNameNl={selected.campaignId === null ? null : campaignName(selected.campaignId)}
            editing={editing?.id === selected.id}
            onEdit={() => {
              setEditing((current) => (current?.id === selected.id ? null : selected));
            }}
            onPromote={
              writable && selected.campaignId !== null
                ? () => {
                    promote.mutate(
                      { personaVersionId: selected.id },
                      {
                        onSuccess: (copy) => {
                          setSaved(`${copy.name} staat nu ook in de bibliotheek van deze opleiding.`);
                        },
                      },
                    );
                  }
                : undefined
            }
            promoting={promote.isPending}
            editorNode={editing?.id === selected.id ? editor(selected) : null}
          />
        )}

        {writable && !loading && shown.length > 0 && (
          <FillAllOpen key={`${course}:${shelf}`} labelId={label.id} personas={shown} />
        )}

        <Disclosure summary="Hoe werken persona's in dit systeem?" tone="plain">
          <p>
            Een persona beschrijft een doelgroep in gedrag en behoefte, nooit als demografisch
            stereotype. Bij een voorstel beantwoordt het systeem alle 36 vragen uit zijn eigen
            materiaal: een antwoord is <em>uit bron</em> (het citeert een passage uit onderzoek,
            opleidingskaart of campagne-invoer en noemt de herkomst) of <em>door AI afgeleid</em> (een
            beredeneerde aanname met de redenering erbij). Persona’s met open vragen kun je door AI
            laten aanvullen; al beantwoorde vragen blijven staan. Handmatig invullen en opslaan
            gebruikt geen AI-credits. Bewerken maakt een nieuwe versie; een briefing die op de oude
            versie rust, vraagt daarna om een nieuwe beoordeling.
          </p>
        </Disclosure>
      </section>
    </div>
  );
}

/**
 * One button for every persona in view that still has open questions.
 *
 * It queues one job per persona — the same job the per-card button starts —
 * so each persona's result is its own version and its own note, and a
 * failure in one leaves the others untouched. The count in the label is the
 * number of personas, hence the number of AI calls, this will cost.
 */
function FillAllOpen(props: { labelId: string; personas: PersonaVersion[] }): ReactNode {
  const fill = useFillPersonaQuestionnaire(props.labelId);
  const [started, setStarted] = useState<{ persona: PersonaVersion; job: JobSummary }[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const startedIds = new Set(started.map((entry) => entry.persona.personaKey));
  const candidates = props.personas.filter(
    (persona) => questionnaireStats(persona.questionnaire).unknown > 0 && !startedIds.has(persona.personaKey),
  );
  if (candidates.length === 0 && started.length === 0) return null;

  const startAll = async (): Promise<void> => {
    setBusy(true);
    setFailed([]);
    for (const persona of candidates) {
      try {
        const job = await fill.mutateAsync({ personaVersionId: persona.id });
        setStarted((current) => [...current, { persona, job }]);
      } catch {
        setFailed((current) => [...current, persona.name]);
      }
    }
    setBusy(false);
  };

  return (
    <Card padding="sm" tone="muted">
      <div className="c360-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 'var(--c360-space-2)' }}>
        <p style={{ margin: 0 }}>
          {candidates.length === 0
            ? 'Alle persona’s in dit overzicht zijn aangevuld of worden nu aangevuld.'
            : `${String(candidates.length)} persona’s hebben nog open vragen. Het systeem beantwoordt ze uit onderzoek, opleidingskaart en campagne-invoer; al beantwoorde vragen blijven staan.`}
        </p>
        {candidates.length > 0 && (
          <Button
            variant="secondary"
            icon="sparkles"
            disabled={busy}
            onClick={() => {
              void startAll();
            }}
          >
            {busy
              ? 'Taken worden gestart…'
              : `Open vragen van ${String(candidates.length)} persona’s laten invullen (${String(candidates.length)} AI-aanroepen)`}
          </Button>
        )}
      </div>
      {failed.length > 0 && (
        <Notice tone="warning">{`Niet gestart voor: ${failed.join(', ')}. ${fill.error?.userMessage ?? ''}`}</Notice>
      )}
      {started.length > 0 && (
        <ul className="c360-list" style={{ marginTop: 'var(--c360-space-2)' }}>
          {started.map((entry) => (
            <li key={entry.persona.id}>
              <strong>{entry.persona.name}</strong>
              <PersonaQuestionnaireFill labelId={props.labelId} persona={entry.persona} />
              <JobLine labelId={props.labelId} job={entry.job} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function JobLine(props: { labelId: string; job: JobSummary }): ReactNode {
  return <JobWatcher labelId={props.labelId} job={props.job} doneLabel="Aangevuld; de nieuwe versie staat in het overzicht." />;
}

/**
 * One persona, read in full.
 *
 * Three figures first — how much is grounded, how much is assumed, how many of
 * the 36 questions are answered — because those decide whether this persona is
 * safe to brief on. What is marked as an assumption travels as an assumption
 * into the briefing, never as a fact.
 */
function PersonaDetail(props: {
  labelId: string;
  persona: PersonaVersion;
  writable: boolean;
  editing: boolean;
  campaignNameNl: string | null;
  linkedNoteNl: string | null;
  onEdit: () => void;
  /** Absent when this person may not approve, or when it is already approved. */
  onApprove?: (() => void) | undefined;
  approving?: boolean;
  onPromote?: (() => void) | undefined;
  promoting?: boolean;
  editorNode: ReactNode;
}): ReactNode {
  const { persona } = props;
  const answered = questionnaireCount(persona.questionnaire);
  const coreAnswered = coreQuestionCount(persona.questionnaire);
  const coreOpen = PERSONA_CORE_QUESTION_IDS.length - coreAnswered;

  return (
    <>
      <div className="os-page__head">
        <div className="os-page__head-text">
          <p className="os-eyebrow">{`Doelgroep · v${String(persona.version)}`}</p>
          <h1>{persona.name}</h1>
          <p className="c360-page-lead">{persona.summary}</p>
          {props.linkedNoteNl !== null && <p className="os-limit">{props.linkedNoteNl}</p>}
        </div>
        <div className="os-page__actions">
          {props.writable && (
            <Button
              variant={props.editing ? 'primary' : 'secondary'}
              icon="edit"
              aria-expanded={props.editing}
              onClick={props.onEdit}
            >
              {props.editing ? 'Bewerken sluiten' : 'Bewerken'}
            </Button>
          )}
          {props.onApprove !== undefined && (
            <Button variant="secondary" icon="check" onClick={props.onApprove} disabled={props.approving === true}>
              Goedkeuren
            </Button>
          )}
          {props.onPromote !== undefined && (
            <Button variant="secondary" onClick={props.onPromote} disabled={props.promoting === true}>
              Opslaan in bibliotheek
            </Button>
          )}
          <Button
            variant="secondary"
            icon="download"
            onClick={() => {
              download(persona);
            }}
          >
            JSON downloaden
          </Button>
        </div>
      </div>

      <div className="c360-row">
        <Badge tone={persona.origin === 'user' ? 'green' : 'neutral'}>
          {persona.origin === 'user' ? 'Handmatig gemaakt' : 'Voorstel van het systeem'}
        </Badge>
        {props.campaignNameNl !== null && <Badge tone="purple">{props.campaignNameNl}</Badge>}
      </div>

      <div className="os-kpis">
        <div className="os-kpi os-kpi--ok">
          <div className="os-kpi__top">
            <span className="os-kpi__label">Onderbouwing</span>
            <span className="os-kpi__value">{String(persona.grounding.length).padStart(2, '0')}</span>
          </div>
          <span className="os-kpi__caption">Uitspraken met een bron erbij</span>
        </div>
        <div className={`os-kpi ${persona.assumptions.length > 0 ? 'os-kpi--warn' : 'os-kpi--neutral'}`}>
          <div className="os-kpi__top">
            <span className="os-kpi__label">Aannames</span>
            <span className="os-kpi__value">{String(persona.assumptions.length).padStart(2, '0')}</span>
          </div>
          <span className="os-kpi__caption">Reizen als aanname mee in de briefing</span>
        </div>
        <div className={`os-kpi ${coreOpen > 0 ? 'os-kpi--warn' : 'os-kpi--ok'}`}>
          <div className="os-kpi__top">
            <span className="os-kpi__label">Kernvragen</span>
            <span className="os-kpi__value">
              {`${String(coreAnswered)}/${String(PERSONA_CORE_QUESTION_IDS.length)}`}
            </span>
          </div>
          <span className="os-kpi__caption">
            {coreOpen === 0
              ? `De vragen waaruit de persona is geschreven zijn beantwoord · ${String(answered)}/36 in totaal`
              : `${String(coreOpen)} van de vragen waaruit de persona wordt geschreven nog open · ${String(answered)}/36 in totaal`}
          </span>
        </div>
      </div>

      {/*
        Who made this, who changed it and who approved it.

        Placed above the fields rather than at the bottom: a persona says what
        every campaign aims at, and "on whose say-so" is a question people have
        while they read it, not after.
      */}
      <PersonaTrail labelId={props.labelId} personaVersionId={persona.id} />

      {props.writable && <PersonaQuestionnaireFill labelId={props.labelId} persona={persona} />}

      {props.editorNode}

      <div className="os-panel os-deflist">
        <Facet term="Wat deze persoon wil" value={persona.need} />
        <Facet term="Waarom" value={persona.motivation} />
        <Facet term="Waar het vastloopt" value={persona.barriers} />
        <Facet term="Keuzecriteria" value={persona.decisionCriteria} />
        <Facet term="Relatie met de opleiding" value={persona.relationToCourse} />
        {persona.assumptions.length > 0 && <Facet term="Aannames" value={persona.assumptions} />}
        {persona.grounding.length > 0 && (
          <div className="os-defrow">
            <p className="os-defrow__term">Uit welke bronnen</p>
            <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
              {persona.grounding.map((item, index) => (
                <li key={index} className="os-defrow__value">
                  {item.claim} <span className="c360-card__hint">— {item.sourceRef}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="os-panel__foot">
          <p className="os-limit">
            Een persona hoort bij één opleiding en kan aan andere opleidingen worden gekoppeld. Wat
            als aanname is aangemerkt, gaat als aanname mee in de briefing — niet als feit.
          </p>
        </div>
      </div>

      <OrientationSection
        labelId={props.labelId}
        persona={persona}
        writable={props.writable}
      />

      <Disclosure
        summary={`Vragenlijst · ${String(coreQuestionCount(persona.questionnaire))} van ${String(PERSONA_CORE_QUESTION_IDS.length)} kernvragen beantwoord`}
        tone="plain"
      >
        <PersonaQuestionnaire value={persona.questionnaire} defaultScope="core" />
      </Disclosure>
    </>
  );
}

/**
 * Where this audience orients, and what reaches it.
 *
 * The field the channel plan leans on: a verdict may be moved for an audience
 * on the strength of a *grounded* statement, never on an assumption. It used to
 * be four words at the bottom of the facets, which is not where you look for
 * "which channels reach this person" — and a persona written by hand or
 * imported from a document had it empty with no way to fill it (2026-09-16).
 *
 * Two ways in, on purpose. Research reads the same material the questionnaire
 * reads — this course's findings, its confirmed facts, the campaign input — and
 * *adds*; it never overwrites what somebody typed. Typing it yourself is the
 * other way, in the editor, and needs no AI at all.
 */
function OrientationSection(props: {
  labelId: string;
  persona: PersonaVersion;
  writable: boolean;
}): ReactNode {
  const fill = useFillPersonaOrientation(props.labelId);
  const [job, setJob] = useState<JobSummary | null>(null);
  const sources = props.persona.orientationSources;
  const grounded = sources.filter((source) => source.grounding !== null).length;

  return (
    <section className="os-panel" aria-label="Waar deze doelgroep zich oriënteert">
      <div className="os-panel__head">
        <div>
          <h2 className="os-panel__title">Waar deze persoon zich oriënteert</h2>
          <p className="os-panel__sub">
            {sources.length === 0
              ? 'Nog niets vastgelegd over welke kanalen deze persoon bereiken.'
              : `${String(sources.length)} uitspraak(en), waarvan ${String(grounded)} met een bron. Het kanaaladvies mag alleen op een onderbouwde uitspraak worden verschoven.`}
          </p>
        </div>
        {props.writable && (
          <Button
            variant={sources.length === 0 ? 'primary' : 'secondary'}
            icon="sparkles"
            disabled={fill.isPending || job !== null}
            busy={fill.isPending}
            onClick={() => {
              fill.mutate({ personaVersionId: props.persona.id }, { onSuccess: setJob });
            }}
          >
            {sources.length === 0 ? 'Laten onderzoeken' : 'Aanvullen'}
          </Button>
        )}
      </div>

      {fill.isError && <Notice tone="warning">{fill.error.userMessage}</Notice>}
      {job !== null && (
        <div style={{ padding: '10px 14px' }}>
          <JobWatcher
            labelId={props.labelId}
            job={job}
            doneLabel="Onderzocht; de nieuwe versie staat in het overzicht."
          />
        </div>
      )}

      {sources.length === 0 ? (
        <div className="os-defrow">
          <p className="os-defrow__value" style={{ color: 'var(--tx-2)' }}>
            Dit is het veld waarop het kanaaladvies leunt: via welke kanalen deze mensen op het
            onderwerp stuiten, en wat hen beïnvloedt bij het kiezen. Laat het onderzoeken uit het
            onderzoek, de opleidingskaart en de campagne-invoer van deze opleiding, of schrijf het
            zelf bij <strong>Bewerken</strong>.
          </p>
        </div>
      ) : (
        <div className="os-deflist">
          {sources.map((source, index) => (
            <div className="os-defrow" key={index}>
              <div className="c360-row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <p className="os-defrow__term" style={{ margin: 0 }}>
                  {source.channel === null
                    ? 'Geen bepaald kanaal'
                    : CHANNEL_LABEL_NL[source.channel]}
                </p>
                <Badge tone={source.grounding === null ? 'amber' : 'green'}>
                  {source.grounding === null ? 'aanname' : 'onderbouwd'}
                </Badge>
              </div>
              <p className="os-defrow__value" style={{ marginTop: 4 }}>
                {source.statementNl}
              </p>
              {source.grounding !== null && (
                <p className="os-rowcard__meta" style={{ marginTop: 3 }}>
                  {source.grounding.sourceRef}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="os-panel__foot">
        <p className="os-limit">
          Oriëntatiegedrag wordt afgeleid uit rol, werksituatie en onderwerp — nooit uit leeftijd,
          geslacht of woonplaats. Een uitspraak zonder bron is een aanname en heet zo; er staan hier
          geen zoekvolumes of bereikcijfers, want die zijn niet gemeten.
        </p>
      </div>
    </section>
  );
}

function Facet(props: { term: string; value: string | readonly string[] }): ReactNode {
  return (
    <div className="os-defrow">
      <p className="os-defrow__term">{props.term}</p>
      {typeof props.value === 'string' ? (
        <p className="os-defrow__value">{props.value}</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
          {props.value.map((item, index) => (
            <li key={index} className="os-defrow__value">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
