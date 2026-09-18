import { personaInput, type PersonaProposal } from './personas.js';
import { type PersonaQuestionnaire, type PERSONA_QUESTIONS } from './persona-questionnaire.js';

type QuestionId = (typeof PERSONA_QUESTIONS)[number]['id'];
const unknown = 'Nog onbekend — aanvullen bij controle.';

/**
 * Makes an editable campaign card from the questionnaire without a model call.
 *
 * Deterministic on purpose: the card cannot then claim anything the answers do
 * not say. Two fields are the exception and are passed in, because neither can
 * be derived from the questionnaire — the persona's own name, and how this
 * audience relates to the course. Without them the name was whatever q01 said
 * (so several personas from one text all read alike) and the course link was a
 * fixed sentence stating it still had to be checked (2026-09-17).
 */
export function personaFromQuestionnaire(
  questionnaire: PersonaQuestionnaire,
  courseName = 'de gekozen opleiding',
  written: { name?: string; relationToCourse?: string } = {},
): PersonaProposal {
  const answers = (...ids: QuestionId[]): string[] => ids.flatMap(id => {
    const cell = questionnaire[id];
    const answer = cell?.answer.trim();
    return answer && cell?.status !== 'unknown'
      ? [`${cell?.status === 'assumption' ? 'Aanname: ' : ''}${answer}`]
      : [];
  });
  const prose = (ids: QuestionId[], limit: number): string => {
    const text = answers(...ids).join(' ').slice(0, limit);
    return text ? (text.length < 10 ? `Opgegeven: ${text}` : text) : unknown;
  };
  const list = (ids: QuestionId[]): string[] => {
    const values = answers(...ids).map(text => text.length < 3 ? `Opgegeven: ${text}` : text.slice(0, 300));
    return values.length ? values : [unknown];
  };

  return personaInput.parse({
    name: (written.name ?? answers('q01')[0] ?? 'Nieuwe persona uit tekst').slice(0, 120),
    summary: prose(['q01', 'q02', 'q03', 'q06'], 400),
    need: prose(['q11', 'q12', 'q13', 'q16'], 1000),
    motivation: prose(['q10', 'q14', 'q15', 'q18'], 1000),
    barriers: list(['q19', 'q20', 'q21', 'q29']),
    decisionCriteria: list(['q26', 'q23', 'q24', 'q28']),
    relationToCourse: (
      written.relationToCourse ??
      `De aansluiting op ${courseName} moet nog worden gecontroleerd aan de hand van de leerbehoefte en de opleidingsinformatie.`
    ).slice(0, 1000),
    questionnaire,
    grounding: [],
    assumptions: Object.values(questionnaire)
      .filter(cell => cell?.status === 'assumption' && cell.answer.trim())
      .map(cell => `Aanname: ${cell.answer.trim()}`.slice(0, 300))
      .slice(0, 12),
    // Source notes are not observed channel-performance evidence. Keep null grounding.
    orientationSources: answers('q30', 'q31', 'q32', 'q33')
      .filter(answer => answer.length >= 10)
      .map(statementNl => ({ statementNl: statementNl.slice(0, 300), channel: null, grounding: null })),
  });
}
