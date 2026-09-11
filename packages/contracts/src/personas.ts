import { z } from 'zod';
import { dataOrigin, isoTimestamp, uuid, versionNumber } from './primitives.js';
import { reviewState } from './workflow.js';

/**
 * Personas.
 *
 * Two rules from the requirements shape this schema directly:
 *
 *  1. **Grounding is separated from assumption.** Every persona carries both
 *     lists explicitly, so a reader can see what rests on evidence and what is
 *     a hypothesis. A persona with no grounding is not thereby forbidden — it
 *     is visibly a hypothesis.
 *  2. **Three is a target, not a quota.** When the available material does not
 *     support three distinct personas, fewer are produced and the reason is
 *     recorded. `PersonaProposalSet.shortfallReasonNl` exists so that "only two"
 *     is an explained outcome rather than a silent one.
 *
 * Personas describe need and behaviour. Age, gender and similar demographic
 * attributes have no field here on purpose — the requirement is explicit that
 * unnecessary demographic stereotypes are not to be produced.
 */

export const groundingKind = z.enum([
  /** From a document the user supplied. */
  'user_document',
  /** From the course card's confirmed facts. */
  'course_fact',
  /** From the brand profile. */
  'brand_profile',
  /** From a retrieved external page, with URL and date. */
  'external_source',
  /** From recorded campaign outcomes. */
  'observed_outcome',
]);
export type GroundingKind = z.infer<typeof groundingKind>;

export const grounding = z.object({
  claim: z.string().min(3).max(400),
  kind: groundingKind,
  /** Document name, course field, or URL. */
  sourceRef: z.string().max(2_000),
  /** When the source was retrieved or confirmed. */
  retrievedAt: isoTimestamp.nullable(),
});
export type Grounding = z.infer<typeof grounding>;

export const personaVersion = z.object({
  id: uuid,
  labelId: uuid,
  /** A persona is always about a specific course version. */
  courseVersionId: uuid,
  version: versionNumber,
  name: z.string().min(1).max(120),
  /** One sentence: who this is, in behavioural terms. */
  summary: z.string().min(10).max(400),
  need: z.string().min(10).max(1_000),
  motivation: z.string().min(10).max(1_000),
  barriers: z.array(z.string().min(3).max(300)).min(1).max(8),
  decisionCriteria: z.array(z.string().min(3).max(300)).min(1).max(8),
  relationToCourse: z.string().min(10).max(1_000),
  grounding: z.array(grounding).max(20),
  assumptions: z.array(z.string().min(3).max(300)).max(12),
  reviewState,
  origin: dataOrigin,
  /** Which prompt produced it, for traceability. Null for manual entry. */
  promptVersion: z.string().max(40).nullable(),
  createdAt: isoTimestamp,
  createdByUserId: uuid.nullable(),
});
export type PersonaVersion = z.infer<typeof personaVersion>;

/** Shape the AI adapter must return. Ids and versions are assigned server-side. */
export const personaProposal = z.object({
  name: z.string().min(1).max(120),
  summary: z.string().min(10).max(400),
  need: z.string().min(10).max(1_000),
  motivation: z.string().min(10).max(1_000),
  barriers: z.array(z.string().min(3).max(300)).min(1).max(8),
  decisionCriteria: z.array(z.string().min(3).max(300)).min(1).max(8),
  relationToCourse: z.string().min(10).max(1_000),
  grounding: z.array(grounding).max(20),
  assumptions: z.array(z.string().min(3).max(300)).max(12),
});
export type PersonaProposal = z.infer<typeof personaProposal>;

export const personaProposalSet = z.object({
  personas: z.array(personaProposal).min(1).max(3),
  /**
   * Set when fewer than three were produced. Required in that case — the
   * service rejects a short set with no reason, so "only two" can never be
   * silent.
   */
  shortfallReasonNl: z.string().max(600).nullable(),
});
export type PersonaProposalSet = z.infer<typeof personaProposalSet>;

export const personaInput = personaProposal;

/**
 * A campaign-specific adaptation of a library persona.
 *
 * Stored separately and referencing the persona *version*, so editing a
 * campaign's angle can never silently rewrite the shared library persona —
 * the requirement is explicit about that.
 */
export const personaAdaptation = z.object({
  personaVersionId: uuid,
  /** What is different about this persona for this campaign only. */
  campaignAngleNl: z.string().max(1_000),
});
export type PersonaAdaptation = z.infer<typeof personaAdaptation>;
