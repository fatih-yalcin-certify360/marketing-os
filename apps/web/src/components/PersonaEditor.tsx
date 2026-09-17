import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CHANNEL_LABEL_NL,
  PERSONA_CORE_QUESTION_IDS,
  PRODUCIBLE_CHANNELS,
  personaFromQuestionnaire,
  personaInput,
  type PersonaInput,
  type PersonaProposal,
  type PersonaVersion,
  type PlannableChannel,
} from '@c360/contracts';
import { Button, Card, Notice } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { useCourses } from '../api/campaign-queries.js';
import { PersonaQuestionnaire, coreQuestionCount, questionnaireCount } from './PersonaQuestionnaire.js';
import { PersonaTextImport } from './PersonaTextImport.js';

/**
 * The one persona editor, shared by the library page and the campaign step.
 *
 * It used to live inside the library page only, which meant a persona the
 * system proposed inside a campaign could be corrected nowhere: the campaign
 * step showed it read-only and the library listed only library personas.
 * Saving here always creates the *next version* of an existing persona (the
 * PATCH route keeps its identity and scope) or a new library persona (POST);
 * nothing is saved until the button at the bottom is pressed, and importing a
 * file or applying an AI draft only fills the form.
 */
export const BLANK_PERSONA: PersonaInput = {
  name: '',
  summary: '',
  need: '',
  motivation: '',
  barriers: [],
  decisionCriteria: [],
  relationToCourse: '',
  grounding: [],
  assumptions: [],
  orientationSources: [],
  linkedCourseVersionIds: [],
};

type ListKey = 'barriers' | 'decisionCriteria' | 'assumptions';

const TEXT_FIELDS = [
  ['name', 'Naam persona', 1, 120],
  ['summary', 'Wie is deze persoon? Rol, ervaring en werksituatie', 10, 400],
  ['need', 'Probleem en gewenste uitkomst', 10, 1000],
  ['motivation', 'Motivatie en aanleiding om te leren', 10, 1000],
  ['relationToCourse', 'Waarom past deze opleiding bij de persona?', 10, 1000],
] as const;

const LIST_FIELDS: readonly [ListKey, string, boolean][] = [
  ['barriers', 'Drempels en bezwaren — één per regel, maximaal 8', true],
  ['decisionCriteria', 'Keuzecriteria en aankoopbeslissing — één per regel, maximaal 8', true],
  ['assumptions', 'Aannames — één per regel, maximaal 12', false],
];

const joinLines = (proposal: Pick<PersonaProposal, ListKey>): Record<ListKey, string> => ({
  barriers: proposal.barriers.join('\n'),
  decisionCriteria: proposal.decisionCriteria.join('\n'),
  assumptions: proposal.assumptions.join('\n'),
});

export function PersonaEditor(props: {
  labelId: string;
  courseId: string;
  courseName: string;
  /** The version being corrected; null for a new library persona. */
  existing: PersonaVersion | null;
  onSaved: (saved: PersonaVersion) => void;
  onCancel: () => void;
  /** Where the editor sits changes the explanation, not the form. */
  hintNl?: string;
}): ReactNode {
  const { labelId, courseId, courseName, existing } = props;
  const [value, setValue] = useState<PersonaInput>(
    existing ? personaInput.parse(existing) : BLANK_PERSONA,
  );
  const courses = useCourses(labelId);
  const otherCourses = (courses.data?.items ?? []).filter((item) => item.course.id !== courseId);
  const [lists, setLists] = useState<Record<ListKey, string>>(joinLines(value));
  const [errors, setErrors] = useState<string[]>([]);
  const [importText, setImportText] = useState('');
  const client = useQueryClient();

  /*
   * Come into view when opened. The editor used to appear wherever the page
   * put it — at the top of the library, under a long row in the campaign
   * step — while the person's eyes were on the button they had just pressed;
   * a form that opens out of sight reads as a button that does nothing.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const applyDraft = (draft: PersonaProposal | PersonaInput): void => {
    setValue({ ...draft, linkedCourseVersionIds: 'linkedCourseVersionIds' in draft ? draft.linkedCourseVersionIds : value.linkedCourseVersionIds });
    setLists(joinLines(draft));
    setErrors([]);
  };

  const toggleCourse = (id: string): void => {
    setValue({
      ...value,
      linkedCourseVersionIds: value.linkedCourseVersionIds.includes(id)
        ? value.linkedCourseVersionIds.filter((entry) => entry !== id)
        : [...value.linkedCourseVersionIds, id],
    });
  };
  const linkedNames = otherCourses
    .filter((item) => value.linkedCourseVersionIds.includes(item.course.id))
    .map((item) => item.course.name);

  const mutation = useMutation<PersonaVersion, ApiClientError, PersonaInput>({
    mutationFn: (proposal) =>
      existing
        ? api.patch<PersonaVersion>(`/labels/${labelId}/personas/${existing.id}`, proposal)
        : api.post<PersonaVersion>(`/labels/${labelId}/courses/${courseId}/personas`, proposal),
    onSuccess: async (saved) => {
      await client.invalidateQueries({ queryKey: ['personas', labelId] });
      props.onSaved(saved);
    },
  });

  const loadJson = (text: string): void => {
    try {
      const raw: unknown = JSON.parse(text);
      const result = personaInput.safeParse(raw);
      if (!result.success) {
        setErrors(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
        return;
      }
      // A file from another label may name courses that do not exist here;
      // the links are chosen on this screen, not imported.
      applyDraft({ ...result.data, linkedCourseVersionIds: value.linkedCourseVersionIds });
    } catch {
      setErrors([
        'Dit is geen geldig JSON-bestand. Gebruik "Persona uit losse tekst met AI" voor notities of tekst uit een document.',
      ]);
    }
  };

  const submit = (): void => {
    const result = personaInput.safeParse({
      ...value,
      barriers: splitLines(lists.barriers),
      decisionCriteria: splitLines(lists.decisionCriteria),
      assumptions: splitLines(lists.assumptions),
    });
    if (!result.success) {
      setErrors(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
      return;
    }
    setErrors([]);
    mutation.mutate(result.data);
  };

  const answered = questionnaireCount(value.questionnaire);
  const coreAnswered = coreQuestionCount(value.questionnaire);

  return (
    <Card ariaLabel="Persona invullen">
      <h2 ref={headingRef} tabIndex={-1}>
        {existing ? `Persona bewerken · v${String(existing.version)}` : 'Nieuwe persona'}
      </h2>
      <p>
        {props.hintNl ??
          `Deze persona is gekoppeld aan ${courseName}. Noteer onzekerheden als aannames. Bewerken maakt een nieuwe versie; een briefing die op de oude versie rust, vraagt daarna om een nieuwe beoordeling.`}
      </p>

      {/*
        The courses this persona belongs to. The course it was made for is
        fixed — its facts and research are what the persona rests on — and the
        others are links: the persona then shows up under each of them in a
        campaign's Doelgroep step without being copied.
      */}
      <details className="persona-courses">
        <summary>
          <strong>Opleidingen</strong>
          {` · ${courseName}${linkedNames.length === 0 ? '' : ` + ${String(linkedNames.length)} gekoppeld: ${linkedNames.join(', ')}`}`}
        </summary>
        <p className="c360-card__hint">
          Vink de opleidingen aan waarvoor deze doelgroep ook geldt. De persona verschijnt dan bij
          elk van die opleidingen; de onderbouwing blijft die van {courseName}.
        </p>
        <ul className="persona-courses__list">
          <li>
            <label>
              <input type="checkbox" checked disabled aria-label={`${courseName} (opleiding waarvoor deze persona is gemaakt)`} />
              {` ${courseName}`}
              <span className="c360-stat__caption"> · gemaakt voor deze opleiding</span>
            </label>
          </li>
          {otherCourses.map((item) => (
            <li key={item.course.id}>
              <label>
                <input
                  type="checkbox"
                  checked={value.linkedCourseVersionIds.includes(item.course.id)}
                  onChange={() => {
                    toggleCourse(item.course.id);
                  }}
                  aria-label={`Koppel aan ${item.course.name}`}
                />
                {` ${item.course.name}`}
              </label>
            </li>
          ))}
          {otherCourses.length === 0 && !courses.isPending && (
            <li className="c360-card__hint">Dit label heeft nog geen andere opleidingskaart om aan te koppelen.</li>
          )}
        </ul>
      </details>

      {existing === null && <PersonaTextImport labelId={labelId} courseId={courseId} onApply={applyDraft} />}

      <details>
        <summary>Persona importeren uit JSON</summary>
        <p>
          Importeer een eerder geëxporteerde persona. Controleer daarna de inhoud en de koppeling met
          de gekozen opleiding. Opslaan gebeurt pas met de knop onderaan.
        </p>
        <input
          aria-label="Persona JSON-bestand"
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            void (async () => {
              if (!file) return;
              if (file.size > 100_000) {
                setErrors(['Het bestand mag maximaal 100 kB zijn.']);
                return;
              }
              try {
                loadJson(await file.text());
              } catch {
                setErrors(['Bestand kon niet worden gelezen.']);
              }
            })();
          }}
        />
        <label>
          Of plak persona-JSON
          <textarea
            value={importText}
            maxLength={100_000}
            onChange={(event) => {
              setImportText(event.target.value);
            }}
          />
        </label>
        <Button
          onClick={() => {
            loadJson(importText);
          }}
        >
          In formulier overnemen
        </Button>
        <p>
          Verplicht: name, summary, need, motivation, barriers, decisionCriteria, relationToCourse,
          grounding, assumptions. Lijsten zijn JSON-arrays; grounding en assumptions mogen leeg zijn.
        </p>
      </details>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {/* Open by default, on the thirteen the persona is written from: a new
            persona starts empty, and thirty-six questions behind a closed
            disclosure is where a real test stops (2026-09-16). */}
        <details open={props.existing === null}>
          <summary>
            {`Vragenlijst · ${String(coreAnswered)} van ${String(PERSONA_CORE_QUESTION_IDS.length)} kernvragen, ${String(answered)} van 36 in totaal`}
          </summary>
          <PersonaQuestionnaire
            value={value.questionnaire}
            defaultScope="core"
            onChange={(questionnaire) => {
              setValue({ ...value, questionnaire });
            }}
          />
          <p>
            Neem je antwoorden zonder AI-kosten over in de personakaart. Dit vervangt de kernvelden
            hieronder; controleer ze vóór het opslaan. Je vragenlijst en bronverwijzingen blijven
            bewaard.
          </p>
          <Button
            disabled={answered === 0 || mutation.isPending}
            onClick={() => {
              const draft = personaFromQuestionnaire(value.questionnaire ?? {}, courseName);
              applyDraft({ ...draft, grounding: value.grounding });
            }}
          >
            Antwoorden in personakaart overnemen
          </Button>
        </details>

        <h3>Personakaart voor de campagne</h3>
        <p>
          Vat de belangrijkste inzichten hieronder samen. De antwoorden op de vragenlijst worden samen
          met deze kaart opgeslagen en blijven beschikbaar voor de campagne.
        </p>
        {TEXT_FIELDS.map(([key, title, min, max]) => (
          <label key={key}>
            {title}
            <textarea
              aria-label={title}
              required
              minLength={min}
              maxLength={max}
              value={value[key]}
              onChange={(event) => {
                setValue({ ...value, [key]: event.target.value });
              }}
            />
          </label>
        ))}
        {LIST_FIELDS.map(([key, title, required]) => (
          <label key={key}>
            {title}
            <textarea
              required={required}
              value={lists[key]}
              onChange={(event) => {
                setLists({ ...lists, [key]: event.target.value });
              }}
            />
          </label>
        ))}

        <details>
          <summary>Bronnen en oriëntatiegedrag (optioneel)</summary>
          <p>
            Leg vast waar een uitspraak vandaan komt. Een handmatig opgegeven bron is nog niet
            automatisch geverifieerd.
          </p>
          {value.grounding.map((item, index) => (
            <fieldset key={index}>
              <legend>{`Bron ${String(index + 1)}`}</legend>
              <label>
                Onderbouwde uitspraak
                <input
                  required
                  minLength={3}
                  maxLength={400}
                  value={item.claim}
                  onChange={(event) => {
                    setValue({
                      ...value,
                      grounding: value.grounding.map((entry, position) =>
                        position === index ? { ...entry, claim: event.target.value } : entry,
                      ),
                    });
                  }}
                />
              </label>
              <label>
                Documentnaam of bron-URL
                <input
                  required
                  maxLength={2000}
                  value={item.sourceRef}
                  onChange={(event) => {
                    setValue({
                      ...value,
                      grounding: value.grounding.map((entry, position) =>
                        position === index ? { ...entry, sourceRef: event.target.value } : entry,
                      ),
                    });
                  }}
                />
              </label>
              <Button
                onClick={() => {
                  setValue({
                    ...value,
                    grounding: value.grounding.filter((_, position) => position !== index),
                  });
                }}
              >
                Bron verwijderen
              </Button>
            </fieldset>
          ))}
          <Button
            disabled={value.grounding.length >= 20}
            onClick={() => {
              setValue({
                ...value,
                grounding: [
                  ...value.grounding,
                  { claim: '', sourceRef: '', kind: 'user_document', retrievedAt: null },
                ],
              });
            }}
          >
            Bron toevoegen
          </Button>
          {value.orientationSources.map((source, index) => (
            <fieldset key={index} className="competitor-registry__scope">
              <legend>{`Oriëntatie ${String(index + 1)}`}</legend>
              <label>
                Wat deze persoon doet — één controleerbare zin
                <textarea
                  minLength={10}
                  maxLength={300}
                  required
                  value={source.statementNl}
                  onChange={(event) => {
                    setValue({
                      ...value,
                      orientationSources: value.orientationSources.map((entry, position) =>
                        position === index
                          ? { ...entry, statementNl: event.target.value, grounding: null }
                          : entry,
                      ),
                    });
                  }}
                />
              </label>
              {/* The channel is what the plan reads. It was never editable, so a
                  hand-written persona could not move a verdict at all. */}
              <label>
                Welk kanaal dit raakt
                <select
                  className="c360-select"
                  value={source.channel ?? ''}
                  onChange={(event) => {
                    const chosen = event.target.value;
                    setValue({
                      ...value,
                      orientationSources: value.orientationSources.map((entry, position) =>
                        position === index
                          ? {
                              ...entry,
                              channel: chosen === '' ? null : (chosen as PlannableChannel),
                            }
                          : entry,
                      ),
                    });
                  }}
                >
                  <option value="">Geen bepaald kanaal</option>
                  {PRODUCIBLE_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {CHANNEL_LABEL_NL[channel]}
                    </option>
                  ))}
                </select>
              </label>
              <small>
                {source.grounding
                  ? 'Bron vastgelegd — het kanaaladvies mag hierop leunen.'
                  : 'Aanname — nog niet onderbouwd. Het kanaaladvies verschuift hier niet op.'}
              </small>
              <Button
                onClick={() => {
                  setValue({
                    ...value,
                    orientationSources: value.orientationSources.filter(
                      (_, position) => position !== index,
                    ),
                  });
                }}
              >
                Verwijderen
              </Button>
            </fieldset>
          ))}
          <Button
            disabled={value.orientationSources.length >= 8}
            onClick={() => {
              setValue({
                ...value,
                orientationSources: [
                  ...value.orientationSources,
                  { statementNl: '', channel: null, grounding: null },
                ],
              });
            }}
          >
            Oriëntatie toevoegen
          </Button>
        </details>

        {errors.length > 0 && (
          <Notice tone="warning">
            <ul>
              {errors.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          </Notice>
        )}
        {mutation.error && <Notice tone="warning">{mutation.error.userMessage}</Notice>}
        <div className="c360-row">
          <Button type="submit" variant="primary" disabled={mutation.isPending} busy={mutation.isPending}>
            Persona opslaan
          </Button>
          <Button variant="ghost" onClick={props.onCancel} disabled={mutation.isPending}>
            Annuleren
          </Button>
        </div>
      </form>
    </Card>
  );
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
