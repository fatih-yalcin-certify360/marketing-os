import { useState, type ReactNode } from 'react';
import {
  PERSONA_CORE_QUESTION_IDS,
  PERSONA_CORE_WHY_NL,
  PERSONA_QUESTIONS,
  type PersonaCoreQuestionId,
  type PersonaProposal,
} from '@c360/contracts';
import { Badge } from '@c360/ui';

/** The thirteen the persona is actually written from. */
const CORE: ReadonlySet<string> = new Set(PERSONA_CORE_QUESTION_IDS);

function isCore(id: string): id is PersonaCoreQuestionId {
  return CORE.has(id);
}

/** How many of the thirteen are answered. */
export function coreQuestionCount(questionnaire: PersonaProposal['questionnaire']): number {
  return PERSONA_CORE_QUESTION_IDS.filter((id) => hasAnswer(questionnaire?.[id])).length;
}

type Questionnaire = NonNullable<PersonaProposal['questionnaire']>;
type QuestionId = (typeof PERSONA_QUESTIONS)[number]['id'];
type Answer = NonNullable<Questionnaire[QuestionId]>;

const statusNames: Record<Answer['status'], string> = {
  provided: 'Opgegeven of uit bron — niet onafhankelijk geverifieerd',
  assumption: 'Aanname',
  unknown: 'Onbekend / niet relevant',
};
const groups = [...new Set(PERSONA_QUESTIONS.map(question => question.group))];

function sourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

const sourceKinds = {
  research_finding: 'Onderzoeksbevinding',
  course_fact: 'Opleidingsinformatie',
  campaign_input: 'Campagne-invoer',
};

function hasAnswer(answer: Answer | undefined): boolean {
  return Boolean(answer?.answer.trim()) && answer?.status !== 'unknown';
}

/**
 * Where an answer comes from, in one label and one badge colour.
 *
 * The distinction the reader needs is not provided/assumption — it is *who
 * says so*: the material (a literal passage, green), the model's reasoning
 * ("door AI afgeleid", purple), a person (neutral), or nobody yet (open,
 * amber). Answers stored before the origin existed fall back to what their
 * status and source fields imply.
 */
export type Provenance = 'source' | 'inferred' | 'manual' | 'open';

export function provenanceOf(answer: Answer | undefined, questionId?: string): Provenance {
  if (!hasAnswer(answer)) return 'open';
  const origin = answer?.origin ?? null;
  if (origin === 'user') return 'manual';
  if (origin === 'ai_source') return 'source';
  if (origin === 'ai_inference' || origin === 'system') return 'inferred';
  // Older answers: a passage or reference means the system found a source.
  if (answer?.sourceKind || answer?.sourceRef || answer?.sourceQuote) return 'source';
  if (answer?.status === 'assumption') return 'inferred';
  return questionId === 'q36' ? 'inferred' : 'manual';
}

const provenanceLabel = (provenance: Provenance, answer: Answer | undefined, questionId: string): string => {
  switch (provenance) {
    case 'source':
      return answer?.sourceKind ? `Uit bron: ${sourceKinds[answer.sourceKind]}` : 'Uit bron';
    case 'inferred':
      if (answer?.origin === 'system') return answer.status === 'unknown' ? 'Open' : 'Door het systeem ingevuld (aanname)';
      return questionId === 'q36' ? 'Door AI samengevat' : 'Door AI afgeleid (aanname)';
    case 'manual':
      return 'Handmatig ingevuld';
    case 'open':
      return answer?.origin === 'system' ? 'Open — niet door AI af te leiden' : 'Open';
  }
};

const provenanceTone: Record<Provenance, 'green' | 'purple' | 'neutral' | 'amber'> = {
  source: 'green',
  inferred: 'purple',
  manual: 'neutral',
  open: 'amber',
};

export function questionnaireCount(questionnaire: PersonaProposal['questionnaire']): number {
  return PERSONA_QUESTIONS.filter(question => hasAnswer(questionnaire?.[question.id])).length;
}

export function questionnaireStats(questionnaire: PersonaProposal['questionnaire']): {
  answered: number;
  assumptions: number;
  unknown: number;
  withSource: number;
  /** Answers with a literal passage in the system's material. */
  sourced: number;
  /** Answers the model reasoned ("door AI afgeleid"). */
  inferred: number;
  /** Answers a person typed. */
  manual: number;
} {
  const cells = PERSONA_QUESTIONS.map(question => ({ id: question.id, answer: questionnaire?.[question.id] }));
  const answers = cells.flatMap(cell => (cell.answer && hasAnswer(cell.answer) ? [cell] : []));
  const by = (provenance: Provenance): number => answers.filter(cell => provenanceOf(cell.answer, cell.id) === provenance).length;
  return {
    answered: answers.length,
    assumptions: answers.filter(cell => cell.answer?.status === 'assumption').length,
    unknown: PERSONA_QUESTIONS.length - answers.length,
    withSource: answers.filter(cell => Boolean(cell.answer?.sourceQuote) || Boolean(cell.answer?.sourceRef)).length,
    sourced: by('source'),
    inferred: by('inferred'),
    manual: by('manual'),
  };
}

export function PersonaQuestionnaire({
  value,
  onChange,
  /**
   * Which questions to show first.
   *
   * Thirty-six is the full interview and the right depth once a persona
   * matters; it is the wrong place to start. `core` shows the thirteen the
   * persona is actually written from, with the reason each one is there, and
   * the rest stay one click away (2026-09-16).
   */
  defaultScope = 'all',
}: {
  value: PersonaProposal['questionnaire'];
  onChange?: (questionnaire: Questionnaire) => void;
  defaultScope?: 'core' | 'all' | undefined;
}): ReactNode {
  const [scope, setScope] = useState<'core' | 'all'>(defaultScope);
  const update = (id: QuestionId, patch: Partial<Answer>): void => {
    onChange?.({ ...value, [id]: { answer: '', status: 'unknown', sourceQuote: null, ...value?.[id], ...patch } });
  };
  const stats = questionnaireStats(value);
  const core = coreQuestionCount(value);

  return <div className="persona-questionnaire">
    <div className="os-filters" style={{ marginBottom: 10 }}>
      <button
        type="button"
        className="os-filter"
        aria-pressed={scope === 'core'}
        onClick={() => {
          setScope('core');
        }}
      >
        Kernvragen
        <span className="os-filter__count">{`${String(core)}/${String(PERSONA_CORE_QUESTION_IDS.length)}`}</span>
      </button>
      <button
        type="button"
        className="os-filter"
        aria-pressed={scope === 'all'}
        onClick={() => {
          setScope('all');
        }}
      >
        Alle vragen
        <span className="os-filter__count">{`${String(questionnaireCount(value))}/${String(PERSONA_QUESTIONS.length)}`}</span>
      </button>
    </div>
    {scope === 'core' ? (
      <p>
        <strong>{`${String(core)} van de ${String(PERSONA_CORE_QUESTION_IDS.length)} kernvragen beantwoord.`}</strong>{' '}
        Dit zijn de vragen waaruit de persona wordt geschreven: de naam, de behoefte, de motivatie,
        de drempels, de keuzecriteria en de kanalen komen hieruit. De overige vragen blijven open en
        kun je later zelf of door het systeem laten invullen.
      </p>
    ) : (
      <p><strong>{questionnaireCount(value)} van {PERSONA_QUESTIONS.length} vragen beantwoord.</strong> Dit is volledigheid, geen kwaliteitsscore.</p>
    )}
    <p className="persona-questionnaire__legend">
      <Badge tone="green">{`${String(stats.sourced)} uit bron`}</Badge>{' '}
      <Badge tone="purple">{`${String(stats.inferred)} door AI afgeleid`}</Badge>{' '}
      <Badge tone="neutral">{`${String(stats.manual)} handmatig`}</Badge>{' '}
      <Badge tone="amber">{`${String(stats.unknown)} open`}</Badge>
    </p>
    <p className="c360-card__hint">
      <em>Uit bron</em> betekent: het antwoord citeert een passage uit onderzoek, opleidingskaart of campagne-invoer, en de herkomst staat erbij.{' '}
      <em>Door AI afgeleid</em> betekent: het model heeft dit beredeneerd uit het profiel en het materiaal; de redenering staat erbij en het antwoord is een aanname, geen feit.
    </p>
    {value === undefined && <p>Voor deze persona is nog geen vragenlijst vastgelegd.</p>}
    {onChange && <p>Alle vragen zijn optioneel. Gebruik leeftijd en persoonlijke omstandigheden alleen als ze de leerbehoefte of opleidingskeuze beïnvloeden. Een antwoord dat je zelf typt, wordt als handmatig gemarkeerd.</p>}
    {groups.map(group => {
      const questions = PERSONA_QUESTIONS.filter(
        question => question.group === group && (scope === 'all' || isCore(question.id)),
      );
      if (questions.length === 0) return null;
      const complete = questions.filter(question => hasAnswer(value?.[question.id])).length;
      return <details key={group}>
        <summary>{group} <span className="persona-questionnaire__count">{complete}/{questions.length}</span></summary>
        {questions.map(question => {
          const answer = value?.[question.id];
          const number = Number(question.id.slice(1));
          const url = sourceUrl(answer?.sourceRef);
          const retrieved = answer?.sourceRetrievedAt ? new Date(answer.sourceRetrievedAt) : null;
          const provenance = provenanceOf(answer, question.id);
          const reasoning = answer?.reasoningNl?.trim() ?? '';
          return <div className="persona-questionnaire__question" key={question.id}>
            {isCore(question.id) && (
              <p className="persona-questionnaire__why">{PERSONA_CORE_WHY_NL[question.id]}</p>
            )}
            {onChange ? <>
              <label>{number}. {question.questionNl}
                <textarea aria-label={`${String(number)}. ${question.questionNl}`} rows={3} maxLength={1000} value={answer?.answer ?? ''} placeholder="Onbekend of niet relevant? Laat leeg."
                  onChange={event => update(question.id, { answer: event.target.value, status: event.target.value.trim() ? (answer?.status === 'assumption' ? 'assumption' : 'provided') : 'unknown', sourceQuote: null, sourceRef: null, sourceRetrievedAt: null, sourceKind: null, origin: event.target.value.trim() ? 'user' : null, reasoningNl: null })} />
              </label>
              <label className="persona-questionnaire__status">Status van antwoord {number}
                <select aria-label={`Status van antwoord ${String(number)}`} value={answer?.status ?? 'unknown'} onChange={event => {
                  const status = event.target.value;
                  if (status === 'provided' || status === 'assumption' || status === 'unknown') update(question.id, { status, origin: 'user' });
                }}>{Object.entries(statusNames).map(([status, title]) => <option key={status} value={status}>{title}</option>)}</select>
              </label>
              <p><Badge tone={provenanceTone[provenance]}>{provenanceLabel(provenance, answer, question.id)}</Badge></p>
            </> : <>
              <p><strong>{number}. {question.questionNl}</strong></p>
              <p className="persona-preserve-lines">{answer?.answer.trim() ? answer.answer : 'Nog niet ingevuld.'}</p>
              <p>
                <Badge tone={provenanceTone[provenance]}>{provenanceLabel(provenance, answer, question.id)}</Badge>{' '}
                <small>{statusNames[answer?.status ?? 'unknown']}</small>
              </p>
            </>}
            {reasoning.length > 0 && <p className="persona-questionnaire__reasoning"><em>Redenering:</em> {reasoning}</p>}
            {(answer?.sourceQuote ?? answer?.sourceRef) && <details className="persona-questionnaire__quote">
              <summary>Bronpassage en herkomst</summary>
              {answer.sourceKind && <p><strong>{sourceKinds[answer.sourceKind]}</strong></p>}
              {answer.sourceRef && <p>{url ? <a href={url} target="_blank" rel="noreferrer">{answer.sourceRef}</a> : <span>{answer.sourceRef}</span>}</p>}
              {retrieved && !Number.isNaN(retrieved.getTime()) && <small>Geraadpleegd op {retrieved.toLocaleDateString('nl-NL')}</small>}
              {answer.sourceQuote && <blockquote>{answer.sourceQuote}</blockquote>}
              <small>Dit laat de herkomst zien; de uitspraak is niet onafhankelijk gecontroleerd.</small>
            </details>}
          </div>;
        })}
      </details>;
    })}
  </div>;
}
