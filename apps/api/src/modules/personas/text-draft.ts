import {
  PERSONA_QUESTIONS, personaFromQuestionnaire,
  type PersonaProposal, type PersonaQuestionnaire, type personaTextExtraction,
} from '@c360/contracts';
import type { z } from 'zod';

const normalize = (text: string): string => text.replace(/\s+/gu, ' ').trim().toLowerCase();

/** Quoted support proves only that a claim was supplied, not that it is true. */
export function buildPersonaTextDraft(
  rawText: string,
  extracted: z.infer<typeof personaTextExtraction>,
  courseName: string,
): { personaDraft: PersonaProposal; warnings: string[] } {
  const questionnaire: PersonaQuestionnaire = {};
  const warnings: string[] = [];
  const source = normalize(rawText);

  for (const question of PERSONA_QUESTIONS) {
    const matches = extracted.answers.filter(answer => answer.questionId === question.id);
    const answer = matches.length === 1 ? matches[0] : undefined;
    const supported = answer?.quote && normalize(answer.quote).length >= 8 && source.includes(normalize(answer.quote));
    if (!answer || answer.status === 'unknown' || !answer.answer.trim() || !supported) {
      questionnaire[question.id] = { answer: '', status: 'unknown', sourceQuote: null };
      if (matches.length > 1 || (answer && answer.status !== 'unknown' && answer.answer.trim() && !supported)) {
        warnings.push(`${question.id}: antwoord niet overgenomen; geen eenduidig letterlijk bronfragment.`);
      }
    } else {
      questionnaire[question.id] = { answer: answer.answer.trim(), status: answer.status, sourceQuote: answer.quote };
    }
  }

  const known = Object.values(questionnaire).filter(answer => answer?.status !== 'unknown').length;
  warnings.push(`${String(PERSONA_QUESTIONS.length - known)} van de 36 vragen blijven onbekend. Controleer samenvattingen en bronfragmenten; opgegeven informatie is niet extern geverifieerd.`);
  return { personaDraft: personaFromQuestionnaire(questionnaire, courseName), warnings };
}
