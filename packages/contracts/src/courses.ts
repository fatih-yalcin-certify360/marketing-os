import { z } from 'zod';
import {
  cents,
  dataOrigin,
  isoTimestamp,
  uuid,
  verificationState,
  versionNumber,
} from './primitives.js';
import { reviewState } from './workflow.js';

/**
 * Course card — the single source of truth for what a course actually is.
 *
 * The central idea: **every factual field carries its own verification state.**
 * Course conditions, duration, price and dates are exactly the fields where a
 * wrong published claim causes real damage, so each is tracked separately
 * rather than the record having one overall "checked" flag.
 *
 * A field that is `unverified` may appear in a draft, but blocks a
 * publish-ready export. Generation is told which facts it may state and which
 * it must leave out — it never fills a gap with a plausible value.
 */

/** Fields whose correctness someone is accountable for. */
export const courseFactField = z.enum([
  'summary',
  'targetAudience',
  'entryConditions',
  'duration',
  'contentOutline',
  'price',
  'dates',
  'accreditation',
]);
export type CourseFactField = z.infer<typeof courseFactField>;

/**
 * One factual field: its value, where it came from, and whether a person has
 * confirmed it. `value === null` means "not known" — never a guess.
 */
export const courseFact = z.object({
  value: z.string().max(4_000).nullable(),
  state: verificationState,
  /** Where the value came from: a document name, a URL, or 'handmatig'. */
  sourceRef: z.string().max(500).nullable(),
  /** What the extractor was unsure about, in Dutch, for the reviewer. */
  uncertaintyNl: z.string().max(500).nullable(),
  confirmedByUserId: uuid.nullable(),
  confirmedAt: isoTimestamp.nullable(),
});
export type CourseFact = z.infer<typeof courseFact>;

export const emptyFact: CourseFact = Object.freeze({
  value: null,
  state: 'unverified',
  sourceRef: null,
  uncertaintyNl: null,
  confirmedByUserId: null,
  confirmedAt: null,
});

export const courseDate = z.object({
  /** ISO date. Used to place a campaign calendar against real course dates. */
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  location: z.string().max(160).nullable(),
  format: z.enum(['classroom', 'online', 'blended', 'self_paced']).nullable(),
});
export type CourseDate = z.infer<typeof courseDate>;

export const courseSourceKind = z.enum(['manual', 'document', 'course_page_url']);
export type CourseSourceKind = z.infer<typeof courseSourceKind>;

export const courseVersion = z.object({
  id: uuid,
  labelId: uuid,
  version: versionNumber,
  name: z.string().min(1).max(200),
  /** Free-form external identifier, e.g. a course code. */
  externalCode: z.string().max(80).nullable(),
  sourceKind: courseSourceKind,
  sourceRef: z.string().max(1_000).nullable(),

  facts: z.object({
    summary: courseFact,
    targetAudience: courseFact,
    entryConditions: courseFact,
    duration: courseFact,
    contentOutline: courseFact,
    price: courseFact,
    dates: courseFact,
    accreditation: courseFact,
  }),

  /** Structured price, only set once `facts.price` is user-confirmed. */
  priceCents: cents.nullable(),
  priceNote: z.string().max(200).nullable(),
  /** Structured dates, only set once `facts.dates` is user-confirmed. */
  dates: z.array(courseDate).max(60),
  courseUrl: z.url().nullable(),

  reviewState,
  origin: dataOrigin,
  createdAt: isoTimestamp,
  createdByUserId: uuid.nullable(),
});
export type CourseVersion = z.infer<typeof courseVersion>;

export const courseInput = z.object({
  name: z.string().min(1).max(200),
  externalCode: z.string().max(80).nullable().default(null),
  sourceKind: courseSourceKind.default('manual'),
  sourceRef: z.string().max(1_000).nullable().default(null),
  courseUrl: z.url().nullable().default(null),
  facts: z
    .object({
      summary: courseFact.partial().optional(),
      targetAudience: courseFact.partial().optional(),
      entryConditions: courseFact.partial().optional(),
      duration: courseFact.partial().optional(),
      contentOutline: courseFact.partial().optional(),
      price: courseFact.partial().optional(),
      dates: courseFact.partial().optional(),
      accreditation: courseFact.partial().optional(),
    })
    .default({}),
  priceCents: cents.nullable().default(null),
  priceNote: z.string().max(200).nullable().default(null),
  dates: z.array(courseDate).max(60).default([]),
});
export type CourseInput = z.infer<typeof courseInput>;

/**
 * What an extractor may propose for one factual field.
 *
 * `value: null` means **not stated on the page**. That is the whole point: a
 * course page that does not mention the price must produce a null, not a
 * plausible figure. The model is told this in the prompt and the schema makes
 * it expressible, so there is no pressure to invent.
 *
 * `uncertaintyNl` is where the extractor says what it was unsure about, in
 * Dutch, for the person who has to confirm the field. "Er staan twee prijzen
 * op de pagina" is worth far more to a reviewer than a confident single value.
 */
export const courseFactProposal = z.object({
  value: z.string().max(4_000).nullable(),
  uncertaintyNl: z.string().max(500).nullable(),
});
export type CourseFactProposal = z.infer<typeof courseFactProposal>;

/**
 * A course card proposed from a page or a document.
 *
 * Every field is present and every value may be null, because the strict
 * Structured Outputs subset has no optional keys — and because "we did not
 * find this" is a real answer that must be representable.
 *
 * Nothing here is trusted: the result is stored with every field
 * `unverified`, and an unverified field is excluded from generation prompts
 * and blocks a publish-ready export until a person confirms it.
 */
export const courseExtraction = z.object({
  /** The course name as the page states it. */
  name: z.string().min(1).max(200),
  facts: z.object({
    summary: courseFactProposal,
    targetAudience: courseFactProposal,
    entryConditions: courseFactProposal,
    duration: courseFactProposal,
    contentOutline: courseFactProposal,
    price: courseFactProposal,
    dates: courseFactProposal,
    accreditation: courseFactProposal,
  }),
  /**
   * What the extractor could not settle at all, in Dutch.
   *
   * Distinct from a per-field uncertainty: this is for problems with the page
   * itself — "de pagina beschrijft drie varianten van deze opleiding".
   */
  overallUncertaintyNl: z.string().max(1_000).nullable(),
});
export type CourseExtraction = z.infer<typeof courseExtraction>;

/** Which factual fields a person has confirmed. */
export function confirmedFacts(course: Pick<CourseVersion, 'facts'>): CourseFactField[] {
  return courseFactField.options.filter(
    (field) => course.facts[field].state === 'user_confirmed' && course.facts[field].value !== null,
  );
}

/**
 * Fields that block a publish-ready export: they hold a value nobody has
 * confirmed, or they conflict. A field that is simply empty does not block —
 * not stating a price is fine; stating an unchecked one is not.
 */
export function unconfirmedFacts(course: Pick<CourseVersion, 'facts'>): CourseFactField[] {
  return courseFactField.options.filter((field) => {
    const fact = course.facts[field];
    if (fact.state === 'conflicting') {
      return true;
    }
    return fact.value !== null && fact.state !== 'user_confirmed';
  });
}

export const COURSE_FACT_LABEL_NL: Readonly<Record<CourseFactField, string>> = Object.freeze({
  summary: 'Korte omschrijving',
  targetAudience: 'Voor wie',
  entryConditions: 'Toelatingsvoorwaarden',
  duration: 'Duur en studielast',
  contentOutline: 'Inhoud',
  price: 'Prijs',
  dates: 'Data',
  accreditation: 'Accreditatie',
});

/**
 * Facts a generator is allowed to state, formatted for a prompt.
 *
 * Only confirmed fields are included. This is the mechanism that stops a model
 * repeating an unchecked price or an invented entry condition: the unchecked
 * value never reaches the prompt at all.
 */
export function statableFacts(
  course: Pick<CourseVersion, 'name' | 'facts'>,
): { field: CourseFactField; label: string; value: string }[] {
  return confirmedFacts(course).map((field) => ({
    field,
    label: COURSE_FACT_LABEL_NL[field],
    value: course.facts[field].value ?? '',
  }));
}
