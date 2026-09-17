import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  Campaign,
  CampaignListItem,
  CampaignObjective,
  CampaignProgressState,
  CampaignStepId,
  LabelSummary,
} from '@c360/contracts';
import {
  CAMPAIGN_STEPS,
  FUNNEL_STAGE_LABEL_NL,
  OBJECTIVE_HINT_NL,
  OBJECTIVE_LABEL_NL,
  campaignObjective,
  campaignStepLabel,
  stagesForObjective,
} from '@c360/contracts';
import { Badge, Button, Card, Field, Notice, Progress } from '@c360/ui';
import { useCampaigns, useCourses, useCreateCampaign } from '../api/campaign-queries.js';
import { ErrorState, LoadingState } from '../components/states.js';
import { FunnelPills } from '../components/FunnelPills.js';
import './campaign-flow.css';
import './radar.css';
import './campaigns-list.css';

/**
 * The campaigns of a label, and the form that starts one.
 *
 * The list is the page. It used to sit under a three-hundred-line form, with
 * a server enum as its only status — an enum that stops at "production", so a
 * campaign that had been exported and measured still read as "Content". Now
 * each row says where the campaign stands (the server computes it with the
 * same rule the detail page uses), what to do next, how far it is and when it
 * last moved; the form sits behind the one primary action, open by default
 * only when there is nothing to list yet.
 *
 * Everything a person needs to find a campaign is a control, not a scroll:
 * search on name, the next step, the objective, the course, and a sort.
 */
export function CampagnesPage(props: { label: LabelSummary | undefined }): ReactNode {
  const labelId = props.label?.id;
  const campaigns = useCampaigns(labelId);
  const courses = useCourses(labelId);

  if (props.label === undefined) {
    return <Notice tone="warning">Kies eerst een label.</Notice>;
  }
  if (campaigns.isPending) {
    return <LoadingState label="Campagnes worden geladen" />;
  }
  if (campaigns.isError) {
    return (
      <ErrorState
        message={campaigns.error.userMessage}
        requestId={campaigns.error.requestId}
        onRetry={() => void campaigns.refetch()}
      />
    );
  }

  return (
    <CampaignsScreen
      label={props.label}
      items={campaigns.data.items}
      courses={courses.data?.items ?? []}
      coursesPending={courses.isPending}
      coursesError={courses.isError ? courses.error.userMessage : null}
    />
  );
}

/**
 * The stand-of-affairs strip above the list.
 *
 * The list used to open on 22 rows sorted by date, with the campaign that
 * needed a person indistinguishable from the one that was finished
 * (2026-09-15). These are counts of the same `progress.state` the row badge
 * shows, so the strip cannot drift from the rows under it.
 */
const STATE_TILES: readonly {
  key: 'all' | CampaignProgressState;
  label: string;
  note: string;
  tone: 'all' | 'active' | 'attention' | 'finished';
}[] = Object.freeze([
  { key: 'all', label: 'Alle campagnes', note: 'in dit label', tone: 'all' },
  { key: 'open', label: 'Nu aan zet', note: 'wacht op een volgende stap', tone: 'active' },
  { key: 'attention', label: 'Opnieuw beoordelen', note: 'een bron is gewijzigd', tone: 'attention' },
  { key: 'finished', label: 'Afgerond', note: 'alle acht stappen gedaan', tone: 'finished' },
]);

type SortKey = 'activity' | 'name' | 'created';

const SORT_NL: Record<SortKey, string> = {
  activity: 'Laatst gewijzigd',
  name: 'Naam',
  created: 'Aangemaakt',
};

function CampaignsScreen(props: {
  label: LabelSummary;
  items: CampaignListItem[];
  courses: { course: { id: string; name: string } }[];
  coursesPending: boolean;
  coursesError: string | null;
}): ReactNode {
  const { label, items } = props;
  const canEdit = label.role !== 'label_viewer';
  const ids = { form: useId(), list: useId() };
  const formRef = useRef<HTMLDivElement>(null);

  // Open by default only when there is nothing to list: a returning person
  // wants the list, a new label wants the form. Decided once, on mount — the
  // first campaign a person creates must not collapse the form (and its
  // success notice) the moment the list learns about it.
  const [formOpen, setFormOpen] = useState<boolean>(() => items.length === 0);
  const open = canEdit && formOpen;

  const [search, setSearch] = useState('');
  // The three states the progress model already knows. A person opens this
  // screen to answer "what needs me now", so that is the first control.
  const [state, setState] = useState<'all' | CampaignProgressState>('all');
  const [step, setStep] = useState<'all' | CampaignStepId>('all');
  const [objective, setObjective] = useState<'all' | CampaignObjective | 'none'>('all');
  // 'all' or a course version id.
  const [course, setCourse] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('activity');

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = items.filter(
      (item) =>
        (needle.length === 0 || item.name.toLowerCase().includes(needle)) &&
        (state === 'all' || item.progress.state === state) &&
        (step === 'all' || item.progress.nextStepId === step) &&
        (objective === 'all' ||
          (objective === 'none' ? item.objective === null : item.objective === objective)) &&
        (course === 'all' || item.courseVersionId === course),
    );
    const collator = new Intl.Collator('nl');
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return collator.compare(a.name, b.name);
      if (sort === 'created') return b.createdAt.localeCompare(a.createdAt);
      return b.progress.lastActivityAt.localeCompare(a.progress.lastActivityAt);
    });
  }, [items, search, state, step, objective, course, sort]);

  const courseNames = new Map(props.courses.map((item) => [item.course.id, item.course.name]));
  const stepsInUse = new Set(items.map((item) => item.progress.nextStepId));

  const showForm = (): void => {
    setFormOpen(true);
    setTimeout(() => formRef.current?.querySelector<HTMLElement>('select, input')?.focus(), 0);
  };

  return (
    <div className="os-page">
      <header className="os-page__head">
        <div className="os-page__head-text">
          <p className="os-eyebrow">{`Campagnes · ${label.name}`}</p>
          <h1 className="c360-page-title">Campagnes</h1>
          <p className="c360-page-lead">
            Elke campagne doorloopt dezelfde acht stappen; de lijst zegt per campagne welke stap nu
            aan de beurt is. Controles kunnen niet worden overgeslagen.
          </p>
        </div>
        {canEdit && (
          <div className="os-page__actions">
            <Button
              variant="primary"
              icon="plus"
              aria-expanded={open}
              aria-controls={ids.form}
              onClick={() => {
                if (open) {
                  setFormOpen(false);
                } else {
                  showForm();
                }
              }}
            >
              Nieuwe campagne
            </Button>
          </div>
        )}
      </header>

      {!canEdit && (
        <Notice tone="neutral">
          Als meelezer bekijk je campagnes; een redacteur of labelbeheerder start ze.
        </Notice>
      )}
      {props.coursesError !== null && (
        <Notice tone="warning">{`De opleidingen konden niet worden geladen: ${props.coursesError}`}</Notice>
      )}

      <div id={ids.form} ref={formRef} hidden={!open}>
        {open &&
          (props.coursesPending ? (
            <LoadingState label="Opleidingen worden geladen" />
          ) : props.courses.length === 0 ? (
            <Notice tone="warning">
              Er is nog geen opleidingskaart voor dit label. Leg eerst een opleiding vast onder{' '}
              <Link to="/beheer/opleidingen">Kennis &amp; beheer → Opleidingen</Link>.
            </Notice>
          ) : (
            <NewCampaignForm label={label} courses={props.courses} />
          ))}
      </div>

      <section aria-labelledby={ids.list}>
        <div className="radar-toolbar">
          <div>
            <h2 className="c360-section-title" id={ids.list} style={{ margin: 0 }}>
              {`Campagnes (${String(items.length)})`}
            </h2>
            <p className="c360-card__hint">
              Volgende stap en voortgang komen uit wat er op de server staat: een goedgekeurde briefing,
              een gekozen concept, een goedgekeurd plan. Amber vraagt om een nieuwe beoordeling.
            </p>
          </div>
        </div>

        {items.length > 0 && (
          <div className="campaigns-states" role="group" aria-label="Filter op stand van zaken">
            {STATE_TILES.map((tile) => {
              const count = items.filter((item) => tile.key === 'all' || item.progress.state === tile.key).length;
              const active = state === tile.key;
              return (
                <button
                  key={tile.key}
                  type="button"
                  className={`campaigns-state campaigns-state--tone-${tile.tone}${active ? ' campaigns-state--active' : ''}`}
                  aria-pressed={active}
                  onClick={() => {
                    setState(tile.key);
                  }}
                >
                  <span className="campaigns-state__count">{count}</span>
                  <span className="campaigns-state__label">{tile.label}</span>
                  <span className="campaigns-state__note">{tile.note}</span>
                </button>
              );
            })}
          </div>
        )}

        {items.length > 0 && (
          <div className="campaigns-filters" role="search">
            <label>
              Zoek op naam
              <input
                className="c360-input"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
            </label>
            <label>
              Volgende stap
              <select
                className="c360-select"
                value={step}
                onChange={(event) => {
                  setStep(event.target.value as 'all' | CampaignStepId);
                }}
              >
                <option value="all">Alle stappen</option>
                {CAMPAIGN_STEPS.filter((entry) => stepsInUse.has(entry.id)).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {`${String(CAMPAIGN_STEPS.indexOf(entry) + 1)}. ${entry.label}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Doel
              <select
                className="c360-select"
                value={objective}
                onChange={(event) => {
                  setObjective(event.target.value as 'all' | CampaignObjective | 'none');
                }}
              >
                <option value="all">Alle doelen</option>
                {campaignObjective.options.map((option) => (
                  <option key={option} value={option}>
                    {OBJECTIVE_LABEL_NL[option]}
                  </option>
                ))}
                <option value="none">Geen doel vastgelegd</option>
              </select>
            </label>
            <label>
              Filter op opleiding
              <select
                className="c360-select"
                value={course}
                onChange={(event) => {
                  setCourse(event.target.value);
                }}
              >
                <option value="all">Alle opleidingen</option>
                {[...new Set(items.map((item) => item.courseVersionId))].map((id) => (
                  <option key={id} value={id}>
                    {courseNames.get(id) ?? items.find((item) => item.courseVersionId === id)?.courseName ?? id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sorteren
              <select
                className="c360-select"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as SortKey);
                }}
              >
                {(Object.keys(SORT_NL) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_NL[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {items.length === 0 ? (
          <Notice tone="info">
            <div className="campaigns-empty">
              <span>
                Nog geen campagnes voor dit label. Een campagne begint bij een opleiding en een doel;
                daarna stelt het systeem doelgroepen, een richting en een briefing voor die jij
                beoordeelt.
              </span>
              {canEdit && !open && (
                <Button variant="primary" onClick={showForm}>
                  Eerste campagne starten
                </Button>
              )}
            </div>
          </Notice>
        ) : visible.length === 0 ? (
          <Notice tone="neutral">Geen campagne voldoet aan deze filters.</Notice>
        ) : (
          <Card ariaLabel="Campagnes in dit label">
            <div className="c360-table-scroll">
              <table className="c360-table campaigns-table">
                <thead>
                  <tr>
                    <th scope="col">Campagne</th>
                    <th scope="col">Doel</th>
                    <th scope="col">Volgende stap</th>
                    <th scope="col">Voortgang</th>
                    <th scope="col">Laatst gewijzigd</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <CampaignRow key={item.id} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="c360-stat__caption" style={{ marginTop: 'var(--c360-space-3)' }}>
              {`${String(visible.length)} van ${String(items.length)} campagnes getoond.`}
            </p>
          </Card>
        )}
      </section>
    </div>
  );
}

function CampaignRow(props: { item: CampaignListItem }): ReactNode {
  const { item } = props;
  const { progress } = item;
  const tone = progress.state === 'attention' ? 'amber' : progress.state === 'finished' ? 'green' : 'purple';
  const badge =
    progress.state === 'attention'
      ? 'Opnieuw beoordelen'
      : progress.state === 'finished'
        ? 'Afgerond'
        : 'Nu aan zet';
  const done = progress.doneStepIds.length;
  return (
    <tr>
      <td data-label="Campagne" className="campaigns-table__name">
        <Link to={`/campagnes/${item.id}?fase=${progress.nextStepId}`}>{item.name}</Link>
        <span className="campaigns-table__muted">{`${item.courseName} · ${ENTRY_MODE_NL[item.entryMode]}`}</span>
      </td>
      <td data-label="Doel">
        {item.objective === null ? 'Geen doel vastgelegd' : OBJECTIVE_LABEL_NL[item.objective]}
        <span className="campaigns-table__muted">
          <FunnelPills
            small
            stages={stagesForObjective(item.objective ?? 'full_funnel')}
            label="Fasen van deze campagne"
          />
        </span>
      </td>
      <td data-label="Volgende stap">
        <Badge tone={tone}>{badge}</Badge>{' '}
        <span>{`${String(progress.nextStepNumber)}. ${campaignStepLabel(progress.nextStepId)}`}</span>
        <span className="campaigns-table__action">{progress.nextActionNl}</span>
      </td>
      <td data-label="Voortgang">
        <div className="campaigns-progress">
          <span>{`${String(done)} van ${String(CAMPAIGN_STEPS.length)} stappen`}</span>
          <Progress
            percent={(done / CAMPAIGN_STEPS.length) * 100}
            label={`Voortgang van ${item.name}: ${String(done)} van ${String(CAMPAIGN_STEPS.length)} stappen afgerond`}
          />
        </div>
      </td>
      <td data-label="Laatst gewijzigd">
        <time dateTime={progress.lastActivityAt} title={formatDateTime(progress.lastActivityAt)}>
          {formatRelative(progress.lastActivityAt)}
        </time>
      </td>
    </tr>
  );
}

// ------------------------------------------------------------------ form ---

/** The contract's limits (`createCampaignInput`), repeated here only for the counter. */
const IDEA_LIMIT = 4_000;
const BRIEF_LIMIT = 20_000;

type FieldKey = 'course' | 'objective' | 'text' | 'name';
type FormErrors = Partial<Record<FieldKey, string>>;

const STEP_NAMES_NL = CAMPAIGN_STEPS.map((step) => step.label).join(', ');

/**
 * The form, in the order a marketer thinks: which course, what it must
 * achieve, what material already exists, and only then a name — which the
 * form proposes from the first two answers.
 *
 * Validation runs on submit, not by disabling the button: a disabled button
 * gives no reason and cannot be reached with a keyboard, while an error
 * summary at the top names every problem and links to the field. The one
 * pre-selected answer, "Ik heb nog geen idee", is the safe, input-free choice
 * and is made visible rather than hidden in a small radio row.
 */
function NewCampaignForm(props: {
  label: LabelSummary;
  courses: { course: { id: string; name: string } }[];
}): ReactNode {
  const ids = {
    course: useId(),
    objective: useId(),
    entry: useId(),
    text: useId(),
    name: useId(),
  };
  const summaryRef = useRef<HTMLDivElement>(null);

  // One course is a fact, not a decision, so it is filled in. Several is a
  // choice, so the select opens on a placeholder and is checked on submit.
  const single = props.courses.length === 1 ? props.courses[0] : undefined;
  const [courseVersionId, setCourseVersionId] = useState(single?.course.id ?? '');
  // No default on purpose: the objective is the one choice a marketer must
  // make consciously, because everything downstream is argued from it.
  const [objective, setObjective] = useState<CampaignObjective | null>(null);
  const [entryMode, setEntryMode] = useState<Campaign['entryMode']>('discover_opportunities');
  // One text for both the idea and the briefing, so a mis-click on the radios
  // costs nothing; it is only sent for the modes that use it.
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  // The suggestion is written into the name only while the person has never
  // typed there; clearing the field brings the suggestion back.
  const [nameTouched, setNameTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const create = useCreateCampaign(props.label.id);

  const course = props.courses.find((item) => item.course.id === courseVersionId);
  const suggestion =
    course !== undefined && objective !== null ? suggestName(course.course.name, objective) : '';
  const nameValue = nameTouched ? name : suggestion;
  const needsText = entryMode !== 'discover_opportunities';
  const limit = entryMode === 'start_from_briefing' ? BRIEF_LIMIT : IDEA_LIMIT;
  const errors = validate({ courseVersionId, objective, entryMode, text, name: nameValue });
  const shownErrors: FormErrors = attempted ? errors : {};
  const errorEntries = Object.entries(shownErrors) as [FieldKey, string][];
  // The summary links to the first control of a group; the textarea for the text.
  const errorTarget: Record<FieldKey, string> = {
    course: ids.course,
    objective: ids.objective,
    text: ids.text,
    name: ids.name,
  };

  const reset = (): void => {
    create.reset();
    setCourseVersionId(single?.course.id ?? '');
    setObjective(null);
    setEntryMode('discover_opportunities');
    setText('');
    setName('');
    setNameTouched(false);
    setAttempted(false);
  };

  return (
    <Card title="Nieuwe campagne" ariaLabel="Nieuwe campagne">
      <form
        className="c360-stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          if (Object.keys(errors).length > 0 || objective === null) {
            // The summary renders after this state update; focus it once it exists.
            setTimeout(() => summaryRef.current?.focus(), 0);
            return;
          }
          create.mutate({
            name: nameValue.trim(),
            entryMode,
            objective,
            courseVersionId,
            ...(needsText
              ? entryMode === 'start_from_briefing'
                ? { suppliedBrief: text }
                : { userIdea: text }
              : {}),
          });
        }}
      >
        <p className="c360-card__hint">
          {`Vier keuzes op één pagina. Daarna doorloopt elke campagne dezelfde acht stappen: ${STEP_NAMES_NL}.`}
        </p>

        {(errorEntries.length > 0 || create.isError) && (
          <div className="c360-error-summary" role="alert" tabIndex={-1} ref={summaryRef}>
            <p className="c360-error-summary__title">Controleer het formulier</p>
            <ul>
              {errorEntries.map(([key, message]) => (
                <li key={key}>
                  <a
                    href={`#${errorTarget[key]}`}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(errorTarget[key])?.focus();
                    }}
                  >
                    {message}
                  </a>
                </li>
              ))}
              {create.isError && <li>{create.error.userMessage}</li>}
            </ul>
          </div>
        )}

        <Field
          id={ids.course}
          label="Opleiding"
          hint="Doelgroepen, feiten en controles komen uit de opleidingskaart van deze opleiding."
          error={shownErrors.course}
        >
          {(fieldProps) => (
            <select
              {...fieldProps}
              className="c360-select"
              value={courseVersionId}
              onChange={(event) => {
                setCourseVersionId(event.target.value);
              }}
            >
              {single === undefined && (
                <option value="" disabled>
                  Kies een opleiding…
                </option>
              )}
              {props.courses.map((item) => (
                <option key={item.course.id} value={item.course.id}>
                  {item.course.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <fieldset
          className={`c360-fieldset${shownErrors.objective === undefined ? '' : ' c360-fieldset--error'}`}
          aria-describedby={`${ids.objective}-help`}
        >
          <legend className="c360-label">Wat moet deze campagne bereiken?</legend>
          <p className="c360-fieldset__help" id={`${ids.objective}-help`}>
            Het doel bepaalt welke funnelfasen het kanaalplan en de content dekken; elke fase krijgt
            een eigen boodschap en call to action.
          </p>
          {shownErrors.objective !== undefined && (
            <p className="c360-field__error" role="alert">
              {shownErrors.objective}
            </p>
          )}
          <div className="objective-grid">
            {campaignObjective.options.map((option, index) => {
              const titleId = `${ids.objective}-${option}-title`;
              const descId = `${ids.objective}-${option}-desc`;
              const metaId = `${ids.objective}-${option}-meta`;
              // Generated from the contract, so the card cannot drift from the
              // stages the plan will actually cover.
              const stages = stagesForObjective(option).map((stage) => FUNNEL_STAGE_LABEL_NL[stage]);
              return (
                <label key={option} className="objective-card">
                  <input
                    type="radio"
                    name="objective"
                    value={option}
                    id={index === 0 ? ids.objective : undefined}
                    checked={objective === option}
                    onChange={() => {
                      setObjective(option);
                    }}
                    aria-labelledby={titleId}
                    aria-describedby={`${descId} ${metaId}`}
                  />
                  <span>
                    <span className="objective-card__title" id={titleId}>
                      {OBJECTIVE_LABEL_NL[option]}
                    </span>
                    <span className="objective-card__desc" id={descId}>
                      {OBJECTIVE_HINT_NL[option]}
                    </span>
                    <span className="objective-card__meta" id={metaId}>
                      {stages.length === 1 ? `Fase: ${stages[0] ?? ''}` : `Fasen: ${stages.join(' → ')}`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="c360-fieldset" aria-describedby={`${ids.entry}-help`}>
          <legend className="c360-label">Wat heb je al?</legend>
          <p className="c360-fieldset__help" id={`${ids.entry}-help`}>
            Je keuze bepaalt alleen waarmee het systeem begint; de acht stappen blijven dezelfde.
          </p>
          <div className="entry-grid">
            {ENTRY_OPTIONS.map((option) => {
              const titleId = `${ids.entry}-${option.value}-title`;
              const descId = `${ids.entry}-${option.value}-desc`;
              const metaId = `${ids.entry}-${option.value}-meta`;
              return (
                <label key={option.value} className="objective-card">
                  <input
                    type="radio"
                    name="entryMode"
                    value={option.value}
                    checked={entryMode === option.value}
                    onChange={() => {
                      setEntryMode(option.value);
                    }}
                    aria-labelledby={titleId}
                    aria-describedby={`${descId} ${metaId}`}
                    aria-controls={option.value === 'discover_opportunities' ? undefined : `${ids.text}-reveal`}
                  />
                  <span>
                    <span className="objective-card__title" id={titleId}>
                      {option.labelNl}
                    </span>
                    <span className="objective-card__desc" id={descId}>
                      {option.descriptionNl}
                    </span>
                    <span className="objective-card__meta" id={metaId}>
                      {option.metaNl}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          {/* Revealed directly under the choice that needs it, so cause and
              effect stay together; outside the card, because a label may hold
              only one control. */}
          <div className="choice-reveal" id={`${ids.text}-reveal`} hidden={!needsText}>
            <Field
              id={ids.text}
              label={entryMode === 'start_from_briefing' ? 'Plak je briefing' : 'Beschrijf je idee'}
              hint={
                entryMode === 'start_from_briefing'
                  ? 'Plak de hele tekst; opmaak mag. Je oorspronkelijke tekst blijft ongewijzigd bewaard. In de stap Briefing deelt het systeem de tekst in vaste velden in en controleert de feiten tegen de vastgelegde opleidingsinformatie en de merkregels; wat ontbreekt of botst zie je daar. Maximaal 20.000 tekens.'
                  : 'Een paar zinnen is genoeg: voor wie, welk moment of probleem, en wat je wilt benadrukken. Prijzen en data hoeven niet; die komen uit de opleidingskaart. Het systeem toetst je idee aan de opleidingskaart en de merkregels en werkt het uit tot een briefing die jij goedkeurt. Maximaal 4.000 tekens.'
              }
              error={shownErrors.text}
            >
              {(fieldProps) => (
                <textarea
                  {...fieldProps}
                  className="c360-textarea"
                  rows={6}
                  placeholder={
                    entryMode === 'start_from_briefing'
                      ? 'Plak hier de volledige briefing zoals je die hebt: doel, doelgroep, boodschap, kanalen, planning, budget.'
                      : 'Bijvoorbeeld (fictief): een reeks LinkedIn-berichten waarin deelnemers vertellen hoe ze de opleiding naast hun werk deden, voor teamleiders die twijfelen over de tijdsinvestering.'
                  }
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                  }}
                />
              )}
            </Field>
            {/* Only from three quarters of the limit, so the count is a warning
                and not keystroke noise. */}
            {text.length >= limit * 0.75 && (
              <p
                className={`c360-char-count${text.length > limit ? ' c360-char-count--over' : ''}`}
                aria-live="polite"
              >
                {text.length > limit
                  ? `${formatCount(text.length - limit)} tekens te veel`
                  : `Nog ${formatCount(limit - text.length)} tekens`}
              </p>
            )}
          </div>
        </fieldset>

        <Field
          id={ids.name}
          label="Naam van de campagne"
          hint="Voorstel op basis van opleiding, doel en maand; pas aan wat je wilt."
          error={shownErrors.name}
        >
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="c360-input"
              maxLength={200}
              value={nameValue}
              onChange={(event) => {
                const value = event.target.value;
                setName(value);
                setNameTouched(value.length > 0);
              }}
            />
          )}
        </Field>

        {create.isSuccess ? (
          <div className="c360-stack">
            <Notice tone="info" live>
              {`Campagne “${create.data.name}” is aangemaakt. ${NEXT_AFTER_CREATE_NL[create.data.entryMode]}`}
            </Notice>
            <div className="c360-row">
              <Link className="c360-button c360-button--secondary" to={`/campagnes/${create.data.id}?fase=audience`}>
                Open campagne
              </Link>
              <Button variant="ghost" onClick={reset}>
                Nog een campagne starten
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="form-summary" aria-live="polite">
              {course === undefined || objective === null ? (
                `Kies nog: ${[course === undefined ? 'opleiding' : null, objective === null ? 'doel' : null]
                  .filter((part) => part !== null)
                  .join(', ')}. Hier lees je dan terug wat je aanmaakt.`
              ) : (
                <>
                  Je start een campagne voor <strong>{course.course.name}</strong> met als doel{' '}
                  <strong>{OBJECTIVE_LABEL_NL[objective]}</strong>
                  {` (${stagesForObjective(objective)
                    .map((stage) => FUNNEL_STAGE_LABEL_NL[stage])
                    .join(', ')}), ${START_POINT_NL[entryMode]}. Na het aanmaken begin je bij de stap Doelgroep.`}
                </>
              )}
            </p>
            <div className="c360-row">
              <Button type="submit" variant="primary" disabled={create.isPending} busy={create.isPending}>
                {create.isPending ? 'Aanmaken…' : 'Campagne starten'}
              </Button>
            </div>
          </>
        )}
      </form>
    </Card>
  );
}

/** Every problem with the form, in reading order. Empty when it can be sent. */
function validate(input: {
  courseVersionId: string;
  objective: CampaignObjective | null;
  entryMode: Campaign['entryMode'];
  text: string;
  name: string;
}): FormErrors {
  const errors: FormErrors = {};
  if (input.courseVersionId.length === 0) {
    errors.course = 'Kies een opleiding.';
  }
  if (input.objective === null) {
    errors.objective = 'Kies wat de campagne moet bereiken.';
  }
  if (input.entryMode === 'develop_my_idea') {
    if (input.text.trim().length === 0) {
      errors.text = 'Beschrijf je idee, of kies “Ik heb nog geen idee”.';
    } else if (input.text.length > IDEA_LIMIT) {
      // Says what is wrong and how to fix it — never "pick the other mode for a
      // longer limit", which would be asking the user to misdeclare their material.
      errors.text = `Je idee is ${formatCount(input.text.length - IDEA_LIMIT)} tekens te lang. Maximaal 4.000 tekens.`;
    }
  }
  if (input.entryMode === 'start_from_briefing') {
    if (input.text.trim().length === 0) {
      errors.text = 'Plak je briefing, of kies “Ik heb nog geen idee”.';
    } else if (input.text.length > BRIEF_LIMIT) {
      errors.text = `Je briefing is ${formatCount(input.text.length - BRIEF_LIMIT)} tekens te lang. Maximaal 20.000 tekens.`;
    }
  }
  if (input.name.trim().length === 0) {
    errors.name = 'Geef de campagne een naam.';
  }
  return errors;
}

/**
 * A name from what the form already knows: course, objective and month.
 * Derived only from the person's own choices — nothing invented, nothing to
 * label as demo.
 */
function suggestName(courseName: string, objective: CampaignObjective): string {
  const month = new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' }).format(new Date());
  return [courseName, OBJECTIVE_LABEL_NL[objective], month].join(' – ').slice(0, 200);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('nl-NL').format(value);
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('nl-NL', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(iso));
}

/**
 * "vandaag", "gisteren", "3 dagen geleden", then the date. Relative for the
 * week a campaign is being worked on, absolute once it is history — the full
 * timestamp is always in the title.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'vandaag';
  if (days === 1) return 'gisteren';
  if (days < 7) return new Intl.RelativeTimeFormat('nl-NL', { numeric: 'always' }).format(-days, 'day');
  return new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' }).format(then);
}

/**
 * The three starting points, phrased as what the marketer already has.
 *
 * The question used to be "Hoe wil je beginnen?" with answers that named the
 * system's process ("Ontdek kansen", "Werk mijn idee uit"); a person knows what
 * they have, not what a process name triggers. Each description says what you
 * supply, what the system does with it and what you get back.
 */
const ENTRY_OPTIONS: {
  value: Campaign['entryMode'];
  labelNl: string;
  descriptionNl: string;
  metaNl: string;
}[] = [
  {
    value: 'discover_opportunities',
    labelNl: 'Ik heb nog geen idee',
    descriptionNl:
      'Je levert nu niets aan. Het systeem stelt doelgroepen en campagnekansen voor op basis van de opleidingskaart en het onderzoek; jij kiest een doelgroep en een kans, daarna volgt de briefing.',
    metaNl: 'Standaardkeuze · Je hoeft nu niets aan te leveren.',
  },
  {
    value: 'develop_my_idea',
    labelNl: 'Ik heb een idee',
    descriptionNl:
      'Je beschrijft je idee in een paar zinnen. Het systeem toetst het aan de opleidingskaart en de merkregels en werkt het uit tot een briefing die jij controleert en goedkeurt. Je idee blijft leidend en wordt ongewijzigd bij de campagne bewaard.',
    metaNl: 'Hieronder verschijnt een tekstveld · max. 4.000 tekens',
  },
  {
    value: 'start_from_briefing',
    labelNl: 'Ik heb al een briefing',
    descriptionNl:
      'Je plakt je bestaande briefing. Het systeem deelt die in vaste velden in en controleert de feiten tegen de vastgelegde opleidingsinformatie en de merkregels; je ziet wat ontbreekt of botst. Je oorspronkelijke tekst blijft ongewijzigd bewaard; het systeem bedenkt geen andere campagne.',
    metaNl: 'Hieronder verschijnt een tekstveld · max. 20.000 tekens',
  },
];

/** How the summary sentence names the starting point. */
const START_POINT_NL: Record<Campaign['entryMode'], string> = {
  discover_opportunities: 'zonder eigen idee: het systeem stelt doelgroepen en kansen voor',
  develop_my_idea: 'vanuit je eigen idee',
  start_from_briefing: 'vanuit je bestaande briefing',
};

/** What the success notice says the person does next, per starting point. */
const NEXT_AFTER_CREATE_NL: Record<Campaign['entryMode'], string> = {
  discover_opportunities:
    'Volgende stap: Doelgroep — laat doelgroepen voorstellen of kies bestaande; daarna stelt het systeem kansen voor in de stap Richting.',
  develop_my_idea:
    'Volgende stap: Doelgroep — kies of laat doelgroepen voorstellen; daarna werkt het systeem je idee in de stap Briefing uit. Je idee staat ongewijzigd bij de campagne.',
  start_from_briefing:
    'Volgende stap: Doelgroep — kies of laat doelgroepen voorstellen; daarna structureert en controleert het systeem je briefing in de stap Briefing. Je briefing staat ongewijzigd bij de campagne.',
};

// Noun forms for the list: these describe a campaign, not a choice to make.
const ENTRY_MODE_NL: Record<Campaign['entryMode'], string> = {
  discover_opportunities: 'Startpunt: voorstellen van het systeem',
  develop_my_idea: 'Startpunt: eigen idee',
  start_from_briefing: 'Startpunt: bestaande briefing',
};
