import {
  PERSONA_QUESTIONS,
  personaQuestionnaireProposal,
  statableFacts,
  type CourseVersion,
  type PersonaAnswer,
  type PersonaAnswerSourceKind,
  type PersonaQuestionnaire,
} from '@c360/contracts';

/**
 * The 36-question persona questionnaire, filled by the system from its own
 * research and verified against it.
 *
 * Codex built the questionnaire for hand-written and text-imported personas;
 * personas the system proposes arrived with the card only. This fills the
 * questionnaire for every proposed persona from three kinds of **material the
 * system itself supplied to the model** — research findings, confirmed course
 * facts and the campaign's own idea or briefing — and then checks the model's
 * work the way the text import does: an answer is *provided* only when its
 * quote is a literal passage of that material, and the reference names which
 * piece.
 *
 * Since 2026-09-14 no question is left open by design. The model answers all
 * 36: from a passage (origin `ai_source`, the source fields say where) or as a
 * reasoned assumption (origin `ai_inference`, `reasoningNl` says what it was
 * inferred from — "door AI afgeleid"). What the model still leaves out, or
 * answers twice, the service fills with an explicit cell of origin `system`
 * that says so; nothing is filled with a plausible guess dressed as research.
 * Age is never estimated: a q07 answer that names an age without a passage
 * is replaced by the statement that age is not derivable and not decisive.
 */

export interface QuestionnaireMaterial {
  kind: PersonaAnswerSourceKind;
  /** The reference the model must echo: a finding's source, `Opleidingskaart · <label>`, or `campagne-input`. */
  ref: string;
  text: string;
  retrievedAt: string | null;
}

const normalize = (text: string): string => text.replace(/[\s\u200b]+/gu, ' ').trim().toLowerCase();

/** The material one proposal may draw on, in the order the model sees it. */
export function questionnaireMaterial(input: {
  findings: readonly { claim: string; sourceRef: string; retrievedAt: string | null }[];
  course: Pick<CourseVersion, 'name' | 'facts'>;
  campaignInput: string | null;
}): QuestionnaireMaterial[] {
  const material: QuestionnaireMaterial[] = input.findings.map((finding) => ({
    kind: 'research_finding',
    ref: finding.sourceRef,
    text: finding.claim,
    retrievedAt: finding.retrievedAt,
  }));
  for (const fact of statableFacts(input.course)) {
    material.push({ kind: 'course_fact', ref: `Opleidingskaart · ${fact.label}`, text: fact.value, retrievedAt: null });
  }
  if (input.campaignInput !== null && input.campaignInput.trim().length > 0) {
    material.push({ kind: 'campaign_input', ref: 'campagne-input', text: input.campaignInput, retrievedAt: null });
  }
  return material;
}

/** The material as the model reads it: reference and text, nothing else. */
export function materialForPrompt(material: readonly QuestionnaireMaterial[]): { kind: string; ref: string; text: string }[] {
  return material.map((item) => ({ kind: item.kind, ref: item.ref, text: item.text.slice(0, 4_000) }));
}

/** The meta-question — which answers are assumptions — describes the questionnaire itself and needs no passage. */
const META_QUESTION = 'q36';
/** Demographic and personal-circumstance questions: answered about relevance, never as an estimate. */
const PERSONAL_QUESTIONS = new Set(['q07', 'q08', 'q09']);
/** The age question: a number in an unquoted answer is an estimate, which is the stereotype the persona rules forbid. */
const AGE_QUESTION = 'q07';

/** What the service writes when the model left a question open. */
export const OPEN_ANSWER_NL = 'Niet door AI beantwoord; het materiaal en het profiel gaven er geen houvast voor. Handmatig aan te vullen.';
/** What the service writes when the model answered one question twice. */
export const CONFLICT_ANSWER_NL = 'Het model gaf tegenstrijdige antwoorden op deze vraag; geen van beide is overgenomen. Handmatig aan te vullen.';
/** What the service writes when the model's whole answer was unusable. */
export const UNUSABLE_ANSWER_NL = 'De vragenlijst kon niet uit het onderzoek worden ingevuld. Handmatig aan te vullen of opnieuw laten invullen.';
/** The age question, when the model estimated an age instead of stating relevance. */
export const AGE_NOT_DERIVABLE_NL =
  'Leeftijd is uit het materiaal niet af te leiden en wordt niet geschat. De leerbehoefte en de keuze volgen uit rol en situatie, niet uit leeftijd.';
const AGE_REASONING_NL =
  'Het model noemde een leeftijd zonder passage in het materiaal; het systeem heeft die verwijderd, omdat een geschatte leeftijd een stereotype is.';
const DEFAULT_REASONING_NL = 'Door AI afgeleid uit het doelgroepprofiel en het materiaal; geen letterlijke passage.';

const systemCell = (answer: string): PersonaAnswer => ({
  answer,
  status: 'unknown',
  sourceQuote: null,
  sourceRef: null,
  sourceKind: null,
  sourceRetrievedAt: null,
  origin: 'system',
  reasoningNl: null,
});

export interface QuestionnaireCounts {
  /** Answers with a literal passage in the material. */
  sourced: number;
  /** Assumptions the model reasoned, and the meta-question. */
  inferred: number;
  /** Cells the service filled because the model left them open or in conflict. */
  open: number;
}

/**
 * Turns the model's answers into a questionnaire the product can stand
 * behind, and says what it changed.
 */
export function verifyQuestionnaire(
  value: unknown,
  material: readonly QuestionnaireMaterial[],
): { questionnaire: PersonaQuestionnaire; notesNl: string[]; counts: QuestionnaireCounts } {
  const notesNl: string[] = [];
  const questionnaire: PersonaQuestionnaire = {};
  const parsed = personaQuestionnaireProposal.safeParse(value);
  if (!parsed.success) {
    for (const question of PERSONA_QUESTIONS) questionnaire[question.id] = systemCell(UNUSABLE_ANSWER_NL);
    notesNl.push('De vragenlijst kon niet uit het onderzoek worden ingevuld; alle vragen staan op onbekend.');
    return { questionnaire, notesNl, counts: { sourced: 0, inferred: 0, open: PERSONA_QUESTIONS.length } };
  }
  if (parsed.data.noteNl.trim().length > 0) notesNl.push(parsed.data.noteNl.trim());

  const find = (quote: string, ref: string | null): QuestionnaireMaterial | undefined => {
    const needle = normalize(quote);
    if (needle.length < 8) return undefined;
    const preferred = ref === null ? undefined : material.find((item) => item.ref === ref && normalize(item.text).includes(needle));
    return preferred ?? material.find((item) => normalize(item.text).includes(needle));
  };

  let demoted = 0;
  let conflicting = 0;
  let ageRemoved = 0;
  const counts: QuestionnaireCounts = { sourced: 0, inferred: 0, open: 0 };
  for (const question of PERSONA_QUESTIONS) {
    const matches = parsed.data.answers.filter((answer) => answer.questionId === question.id);
    if (matches.length > 1) {
      // Two answers to one question is a contradiction the model did not
      // resolve; choosing one silently would resolve it for them.
      conflicting += 1;
      counts.open += 1;
      questionnaire[question.id] = systemCell(CONFLICT_ANSWER_NL);
      continue;
    }
    const answer = matches[0];
    const text = answer?.answer.trim() ?? '';
    if (answer === undefined || answer.status === 'unknown' || text.length === 0) {
      counts.open += 1;
      // The model's own explanation of why it could not answer is worth
      // more than the generic sentence, when it gave one.
      questionnaire[question.id] = systemCell(text.length > 0 ? text : OPEN_ANSWER_NL);
      continue;
    }
    const reasoning = answer.reasoningNl?.trim() ?? '';

    const source = answer.quote === null ? undefined : find(answer.quote, answer.sourceRef);
    if (source !== undefined) {
      const inferred = answer.status === 'assumption';
      questionnaire[question.id] = {
        answer: text,
        status: answer.status,
        sourceQuote: answer.quote,
        sourceRef: source.ref,
        sourceKind: source.kind,
        sourceRetrievedAt: source.retrievedAt,
        origin: inferred ? 'ai_inference' : 'ai_source',
        reasoningNl: inferred ? (reasoning.length > 0 ? reasoning : 'Door AI afgeleid uit de aangehaalde passage.') : null,
      };
      if (inferred) counts.inferred += 1;
      else counts.sourced += 1;
      continue;
    }
    if (question.id === META_QUESTION) {
      questionnaire[question.id] = {
        answer: text,
        status: answer.status,
        sourceQuote: null,
        sourceRef: null,
        sourceKind: null,
        sourceRetrievedAt: null,
        origin: 'ai_inference',
        reasoningNl: reasoning.length > 0 ? reasoning : 'Samenvatting door AI van de onderbouwing van deze vragenlijst.',
      };
      counts.inferred += 1;
      continue;
    }
    if (question.id === AGE_QUESTION && /\d/u.test(text)) {
      // An age without a passage is an estimate, and an estimate of age is
      // exactly the stereotype the persona rules forbid. The question is
      // still answered — with the honest statement.
      ageRemoved += 1;
      questionnaire[question.id] = {
        answer: AGE_NOT_DERIVABLE_NL,
        status: 'assumption',
        sourceQuote: null,
        sourceRef: null,
        sourceKind: null,
        sourceRetrievedAt: null,
        origin: 'system',
        reasoningNl: AGE_REASONING_NL,
      };
      counts.inferred += 1;
      continue;
    }
    // Stated but not traceable: a hypothesis, labelled as one, with the
    // model's reasoning — or the plain statement that there is no passage.
    questionnaire[question.id] = {
      answer: text,
      status: 'assumption',
      sourceQuote: null,
      sourceRef: null,
      sourceKind: null,
      sourceRetrievedAt: null,
      origin: 'ai_inference',
      reasoningNl:
        reasoning.length > 0
          ? reasoning
          : PERSONAL_QUESTIONS.has(question.id)
            ? 'Door AI afgeleid uit rol en situatie in het doelgroepprofiel; het materiaal zegt hier niets over.'
            : DEFAULT_REASONING_NL,
    };
    counts.inferred += 1;
    if (answer.status === 'provided') demoted += 1;
  }

  if (demoted > 0) {
    notesNl.push(
      `${String(demoted)} antwoord(en) hadden geen letterlijke passage in het onderzoek, de opleidingskaart of de campagne-invoer en staan daarom als aanname (door AI afgeleid).`,
    );
  }
  if (ageRemoved > 0) {
    notesNl.push('Een geschatte leeftijd zonder passage is verwijderd; de vraag is beantwoord met wat uit rol en situatie volgt.');
  }
  if (conflicting > 0) {
    notesNl.push(`${String(conflicting)} vraag/vragen kregen tegenstrijdige antwoorden en staan open.`);
  }
  notesNl.push(questionnaireSummaryNl(counts));
  return { questionnaire, notesNl, counts };
}

/** One sentence: how many of the 36 rest on a passage, how many are inferred, how many are open. */
export function questionnaireSummaryNl(counts: QuestionnaireCounts): string {
  const total = PERSONA_QUESTIONS.length;
  const answered = total - counts.open;
  const tail =
    counts.open === 0
      ? 'geen vraag staat open.'
      : `${String(counts.open)} open en handmatig aan te vullen.`;
  return `${String(answered)} van de ${String(total)} vragen ingevuld: ${String(counts.sourced)} uit bron (letterlijke passage), ${String(counts.inferred)} door AI afgeleid als aanname; ${tail}`;
}

/** A cell counts as answered when it has text and is not on unknown. */
export function isAnswered(cell: PersonaAnswer | undefined): cell is PersonaAnswer {
  return cell !== undefined && cell.status !== 'unknown' && cell.answer.trim().length > 0;
}

/** The ids of the questions a questionnaire leaves open. */
export function openQuestionIds(questionnaire: PersonaQuestionnaire | undefined): string[] {
  return PERSONA_QUESTIONS.filter((question) => !isAnswered(questionnaire?.[question.id])).map((question) => question.id);
}

/**
 * Fills the open questions of an existing questionnaire from a freshly
 * verified one, and touches nothing a person or an earlier run already
 * answered. Used to complete personas stored before every question was
 * answered by design.
 */
export function fillOpenQuestions(
  existing: PersonaQuestionnaire | undefined,
  filled: PersonaQuestionnaire,
): { questionnaire: PersonaQuestionnaire; filledIds: string[]; stillOpenIds: string[] } {
  const questionnaire: PersonaQuestionnaire = {};
  const filledIds: string[] = [];
  const stillOpenIds: string[] = [];
  for (const question of PERSONA_QUESTIONS) {
    const current = existing?.[question.id];
    if (isAnswered(current)) {
      questionnaire[question.id] = current;
      continue;
    }
    const candidate = filled[question.id];
    if (isAnswered(candidate)) {
      questionnaire[question.id] = candidate;
      filledIds.push(question.id);
      continue;
    }
    // Keep whatever explanation is the more specific: the new system cell
    // says why the model could not answer; an older empty cell says nothing.
    questionnaire[question.id] = candidate ?? current ?? systemCell(OPEN_ANSWER_NL);
    stillOpenIds.push(question.id);
  }
  return { questionnaire, filledIds, stillOpenIds };
}
