import { z } from 'zod';

/**
 * Closed set of machine-readable error codes. The API never returns an internal
 * exception message; it maps failures onto one of these codes plus a
 * user-facing Dutch message. See docs/security/threat-model.md §T-09.
 */
export const errorCode = z.enum([
  'bad_request',
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  /** Optimistic-concurrency failure: the record changed since it was read. */
  'stale_version',
  /** A dependency (persona, brief, brand, course) changed; re-review required. */
  'dependency_changed',
  /** A required workflow gate has not been passed yet. */
  'gate_not_passed',
  'rate_limited',
  'payload_too_large',
  'unsupported_media_type',
  /** Label or user AI budget would be exceeded; needs explicit confirmation. */
  'budget_exceeded',
  /** The configured AI provider does not support the requested capability. */
  'capability_unavailable',
  /** Upstream provider failed. Never converted into a fake success. */
  'provider_unavailable',
  'provider_invalid_output',
  'internal_error',
]);
export type ErrorCode = z.infer<typeof errorCode>;

export const fieldIssue = z.object({
  path: z.string(),
  message: z.string(),
});
export type FieldIssue = z.infer<typeof fieldIssue>;

export const apiErrorBody = z.object({
  error: z.object({
    code: errorCode,
    /** Dutch, user-facing, safe to render. Contains no internal detail. */
    message: z.string(),
    /** Correlates a user-visible failure with a server log entry. */
    requestId: z.string(),
    issues: z.array(fieldIssue).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBody>;

/** HTTP status for each error code, kept next to the codes so they cannot drift. */
export const errorHttpStatus: Readonly<Record<ErrorCode, number>> = Object.freeze({
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  stale_version: 409,
  dependency_changed: 409,
  gate_not_passed: 409,
  rate_limited: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  budget_exceeded: 402,
  capability_unavailable: 501,
  provider_unavailable: 502,
  provider_invalid_output: 502,
  internal_error: 500,
});

/** Default Dutch messages. Handlers may override with something more specific. */
export const errorMessageNl: Readonly<Record<ErrorCode, string>> = Object.freeze({
  bad_request: 'Het verzoek kon niet worden verwerkt.',
  validation_failed: 'Niet alle velden zijn correct ingevuld.',
  unauthenticated: 'Je bent niet aangemeld.',
  forbidden: 'Je hebt geen toegang tot dit onderdeel.',
  not_found: 'Dit onderdeel bestaat niet of is niet beschikbaar.',
  conflict: 'Deze actie kan nu niet worden uitgevoerd.',
  stale_version: 'Dit item is inmiddels gewijzigd. Vernieuw en probeer opnieuw.',
  dependency_changed: 'Een onderliggende bron is gewijzigd. Beoordeel het item opnieuw.',
  gate_not_passed: 'Een eerdere stap is nog niet afgerond.',
  rate_limited: 'Te veel verzoeken. Probeer het straks opnieuw.',
  payload_too_large: 'Het bestand of verzoek is te groot.',
  unsupported_media_type: 'Dit bestandstype wordt niet ondersteund.',
  budget_exceeded: 'Het ingestelde budget wordt hiermee overschreden.',
  capability_unavailable: 'Deze functie is niet beschikbaar bij de huidige AI-aanbieder.',
  provider_unavailable: 'De AI-aanbieder is nu niet bereikbaar. Er is niets gewijzigd.',
  provider_invalid_output: 'Het antwoord van de AI-aanbieder was onbruikbaar. Er is niets gewijzigd.',
  internal_error: 'Er is een onverwachte fout opgetreden.',
});
