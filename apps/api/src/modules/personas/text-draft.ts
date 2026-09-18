import {
  PERSONA_QUESTIONS, personaFromQuestionnaire,
  type PersonaProposal, type PersonaQuestionnaire, type personaTextExtraction,
} from '@c360/contracts';
import type { z } from 'zod';

const normalize = (text: string): string => text.replace(/\s+/gu, ' ').trim().toLowerCase();

/** One proposed persona, with what could not be taken over from the text. */
export interface PersonaTextDraft {
  personaDraft: PersonaProposal;
  /** Why this is its own persona and not one of the others. */
  distinctionNl: string;
  warnings: string[];
}

/**
 * Turns one text into every persona it describes, kept apart.
 *
 * Quoted support proves only that a claim was supplied, not that it is true —
 * so every answer still has to carry a literal fragment that occurs in the
 * text, and an answer whose quote cannot be found is dropped rather than
 * trusted. That check now runs per persona, which is what keeps them separate:
 * a quote that supports the career changer cannot silently end up under the
 * team lead.
 */
export function buildPersonaTextDrafts(
  rawText: string,
  extracted: z.infer<typeof personaTextExtraction>,
  courseName: string,
): { drafts: PersonaTextDraft[]; warnings: string[] } {
  const source = normalize(rawText);
  const drafts = extracted.personas.map((persona) =>
    buildOne(persona, source, courseName),
  );

  const shared: string[] = [];
  if (drafts.length > 1) {
    shared.push(
      `De tekst beschrijft ${String(drafts.length)} verschillende doelgroepen. Ze zijn apart gehouden — controleer per persona of het onderscheid klopt voordat je ze opslaat.`,
    );
  }
  /*
   * Two personas whose answers are nearly the same are one persona the model
   * split in two. Cheaper to say so than to let somebody save both and find out
   * later that their campaigns are identical.
   */
  for (let a = 0; a < drafts.length; a += 1) {
    for (let b = a + 1; b < drafts.length; b += 1) {
      const first = drafts[a];
      const second = drafts[b];
      if (first === undefined || second === undefined) continue;
      if (overlap(first.personaDraft, second.personaDraft) >= 0.8) {
        shared.push(
          `"${first.personaDraft.name}" en "${second.personaDraft.name}" lijken sterk op elkaar. Kijk of het werkelijk twee doelgroepen zijn.`,
        );
      }
    }
  }
  return { drafts, warnings: shared };
}

function buildOne(
  persona: z.infer<typeof personaTextExtraction>['personas'][number],
  source: string,
  courseName: string,
): PersonaTextDraft {
  const questionnaire: PersonaQuestionnaire = {};
  const warnings: string[] = [];

  for (const question of PERSONA_QUESTIONS) {
    const matches = persona.answers.filter((answer) => answer.questionId === question.id);
    const answer = matches.length === 1 ? matches[0] : undefined;
    const supported =
      answer?.quote && normalize(answer.quote).length >= 8 && source.includes(normalize(answer.quote));
    if (!answer || answer.status === 'unknown' || !answer.answer.trim() || !supported) {
      questionnaire[question.id] = { answer: '', status: 'unknown', sourceQuote: null };
      if (matches.length > 1 || (answer && answer.status !== 'unknown' && answer.answer.trim() && !supported)) {
        warnings.push(`${question.id}: antwoord niet overgenomen; geen eenduidig letterlijk bronfragment.`);
      }
    } else {
      questionnaire[question.id] = { answer: answer.answer.trim(), status: answer.status, sourceQuote: answer.quote };
    }
  }

  const known = Object.values(questionnaire).filter((answer) => answer?.status !== 'unknown').length;
  warnings.push(
    `${String(PERSONA_QUESTIONS.length - known)} van de 36 vragen blijven onbekend. Controleer samenvattingen en bronfragmenten; opgegeven informatie is niet extern geverifieerd.`,
  );

  /*
   * The name and the link to the course come from the model, because neither
   * can be derived. The name used to be the answer to q01, so several personas
   * out of one text would all be called after their role and read alike; and
   * the link was a fixed sentence saying it still had to be checked, which is
   * not a statement about this audience at all.
   */
  const relation = persona.relationToCourseNl?.trim();
  return {
    personaDraft: personaFromQuestionnaire(questionnaire, courseName, {
      name: persona.labelNl.trim(),
      ...(relation !== undefined && relation.length >= 10 ? { relationToCourse: relation } : {}),
    }),
    distinctionNl: persona.distinctionNl.trim(),
    warnings,
  };
}

/** How much two drafts say the same thing, from 0 to 1. */
function overlap(first: PersonaProposal, second: PersonaProposal): number {
  const words = (persona: PersonaProposal): Set<string> =>
    new Set(
      `${persona.summary} ${persona.need} ${persona.motivation}`
        .toLowerCase()
        .split(/[^a-zà-ÿ]+/u)
        .filter((word) => word.length > 4),
    );
  const a = words(first);
  const b = words(second);
  if (a.size === 0 || b.size === 0) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.min(a.size, b.size);
}
