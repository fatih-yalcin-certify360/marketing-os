import { useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Campaign, CampaignObjective, LabelSummary } from '@c360/contracts';
import {
  FUNNEL_STAGE_LABEL_NL,
  OBJECTIVE_HINT_NL,
  OBJECTIVE_LABEL_NL,
  campaignObjective,
  stagesForObjective,
} from '@c360/contracts';
import { Badge, Button, Card, Field, Notice } from '@c360/ui';
import { useCampaigns, useCourses, useCreateCampaign } from '../api/campaign-queries.js';
import { ErrorState, LoadingState } from '../components/states.js';
import './campaign-flow.css';

/**
 * Campaign list and the form that starts one.
 *
 * A campaign cannot be created without an approved brand profile and a course
 * card — the server refuses, and the form says so up front rather than letting
 * the user fill it in and then fail.
 */
export function CampagnesPage(props: { label: LabelSummary | undefined }): ReactNode {
  const labelId = props.label?.id;
  const campaigns = useCampaigns(labelId);
  const courses = useCourses(labelId);

  if (props.label === undefined) {
    return <Notice tone="warning">Kies eerst een label.</Notice>;
  }
  if (campaigns.isPending || courses.isPending) {
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

  const courseOptions = courses.data?.items ?? [];

  return (
    <>
      <header>
        <h1 className="c360-page-title">Campagnes</h1>
        <p className="c360-page-lead">
          Elke campagne doorloopt dezelfde stappen: Doelgroep, Richting, Briefing, Contentpakket en
          Social &amp; beelden. Controles kunnen niet worden overgeslagen.
        </p>
      </header>

      {courseOptions.length === 0 ? (
        <Notice tone="warning">
          Er is nog geen opleidingskaart voor dit label. Leg eerst een opleiding vast onder Kennis
          &amp; beheer → Opleidingen.
        </Notice>
      ) : (
        <NewCampaignForm label={props.label} courses={courseOptions} />
      )}

      <Card title="Bestaande campagnes" ariaLabel="Bestaande campagnes">
        {campaigns.data.items.length === 0 ? (
          <p className="c360-card__hint">Nog geen campagnes voor dit label.</p>
        ) : (
          <ul className="c360-list">
            {campaigns.data.items.map((campaign) => (
              <li className="c360-list__item" key={campaign.id}>
                <div style={{ minWidth: 0 }}>
                  <p className="c360-list__title">
                    <Link to={`/campagnes/${campaign.id}`}>{campaign.name}</Link>
                  </p>
                  <p className="c360-list__subtitle">
                    {`${campaign.objective === null ? 'Geen doel vastgelegd' : OBJECTIVE_LABEL_NL[campaign.objective]} · ${ENTRY_MODE_NL[campaign.entryMode]} · aangemaakt ${formatDate(campaign.createdAt)}`}
                  </p>
                </div>
                <Badge tone="purple">{STAGE_NL[campaign.stage] ?? campaign.stage}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ form ---

/** The contract's limits (`createCampaignInput`), repeated here only for the counter. */
const IDEA_LIMIT = 4_000;
const BRIEF_LIMIT = 20_000;

type FieldKey = 'course' | 'objective' | 'text' | 'name';
type FormErrors = Partial<Record<FieldKey, string>>;

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
          Vier keuzes op één pagina. Daarna doorloopt elke campagne dezelfde stappen: Doelgroep,
          Richting, Briefing, Contentpakket en Social &amp; beelden.
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
            Elke campagne doorloopt daarna dezelfde stappen: Doelgroep, Richting, Briefing,
            Contentpakket en Social &amp; beelden. Je keuze bepaalt alleen waarmee het systeem
            begint.
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
              {`Campagne “${create.data.name}” is aangemaakt. Volgende stap: Doelgroep — daar laat je doelgroepen voorstellen of kies je bestaande.${
                create.data.entryMode === 'develop_my_idea'
                  ? ' Je idee staat ongewijzigd bij de campagne.'
                  : create.data.entryMode === 'start_from_briefing'
                    ? ' Je briefing staat ongewijzigd bij de campagne; in de stap Briefing structureer en controleer je hem.'
                    : ''
              }`}
            </Notice>
            <div className="c360-row">
              <Link className="c360-button c360-button--secondary" to={`/campagnes/${create.data.id}`}>
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

// Noun forms for the list: these describe a campaign, not a choice to make.
const ENTRY_MODE_NL: Record<Campaign['entryMode'], string> = {
  discover_opportunities: 'Startpunt: voorstellen van het systeem',
  develop_my_idea: 'Startpunt: eigen idee',
  start_from_briefing: 'Startpunt: bestaande briefing',
};

const STAGE_NL: Partial<Record<Campaign['stage'], string>> = {
  persona_selection: 'Doelgroepen',
  opportunity_selection: 'Kansen',
  brief_approval: 'Briefing',
  concept_selection: 'Concept',
  content_plan_approval: 'Pakket',
  production: 'Content',
  editing: 'Bewerken',
  final_approval: 'Goedkeuring',
  export: 'Export',
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );
}
