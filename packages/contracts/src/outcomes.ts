import { z } from 'zod';
import { marketingChannel } from './channels.js';
import { isoTimestamp, uuid, webUrl } from './primitives.js';

/**
 * What actually happened, recorded by a person (P4-1).
 *
 * ## This system measures nothing
 *
 * It has no advertising account, no analytics access and no measurement
 * period. Every figure here was obtained by a human — read off a platform
 * report that is attached, or typed in — and `source` says which. That field is
 * the whole point: without it a number in this table would be
 * indistinguishable from one the product had produced, and the product produces
 * none. A fabricated performance figure is acted on with money.
 *
 * ## Absence is not zero
 *
 * Every metric is nullable. A platform reports what it reports; `null` means
 * "not reported" and `0` means "reported as none". Collapsing them would turn
 * an absence into a measurement, and a campaign with no impressions recorded
 * would read as a campaign nobody saw.
 *
 * ## No derived metric is stored, and none is a verdict
 *
 * There is no click-through rate, cost per click or conversion rate here. They
 * are arithmetic on the fields beside them, so storing them would go stale the
 * moment an input is corrected — and a stored ratio invites being read as a
 * judgement on the campaign. Whether the campaign *caused* any of this is not a
 * question these numbers answer: two of them moving together is not a cause,
 * and P4-2 is where that gets its own guardrails.
 */

/** How a figure was obtained. There is no third option, and no fourth. */
export const outcomeSource = z.enum([
  /** Read off an attached platform export. The file is required. */
  'platform_report',
  /** Typed in by a person who saw the numbers somewhere we do not hold. */
  'manual_entry',
]);
export type OutcomeSource = z.infer<typeof outcomeSource>;

/** A count a platform reported. Never negative, never inferred. */
const reportedCount = z.number().int().min(0).max(1_000_000_000).nullable().default(null);

export const outcomeInput = z
  .object({
    channel: marketingChannel,
    /** Optional: which publication these figures belong to, when it is one. */
    publicationRecordId: uuid.nullable().default(null),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    impressions: reportedCount,
    clicks: reportedCount,
    signups: reportedCount,
    /** What was actually spent, in cents. Absent for organic channels. */
    spendCents: reportedCount,
    source: outcomeSource,
    /** The uploaded platform report. Required when `source` says there is one. */
    reportAssetId: uuid.nullable().default(null),
    noteNl: z.string().max(1_000).nullable().default(null),
  })
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: 'De einddatum van de periode ligt voor de begindatum.',
    path: ['periodEnd'],
  })
  .refine((value) => value.source !== 'platform_report' || value.reportAssetId !== null, {
    message: 'Kies het geëxporteerde rapport waar deze cijfers uit komen.',
    path: ['reportAssetId'],
  })
  .refine(
    (value) =>
      value.impressions !== null ||
      value.clicks !== null ||
      value.signups !== null ||
      value.spendCents !== null,
    {
      // A row with no figure records nothing; the database refuses it too.
      message: 'Vul minstens één gemeten waarde in.',
      path: ['impressions'],
    },
  );
export type OutcomeInput = z.infer<typeof outcomeInput>;

export const outcomeReport = z.object({
  id: uuid,
  campaignId: uuid,
  publicationRecordId: uuid.nullable(),
  channel: marketingChannel,
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  impressions: z.number().int().nullable(),
  clicks: z.number().int().nullable(),
  signups: z.number().int().nullable(),
  spendCents: z.number().int().nullable(),
  source: outcomeSource,
  reportAssetId: uuid.nullable(),
  noteNl: z.string().nullable(),
  recordedByUserId: uuid.nullable(),
  createdAt: isoTimestamp,
});
export type OutcomeReport = z.infer<typeof outcomeReport>;

/**
 * "We published this."
 *
 * Approved is deliberately not published: this system sends nothing and posts
 * nothing, so publication is something a person records afterwards. The record
 * points at the exact content *version* that went out, which is what makes a
 * later figure attachable to something specific rather than to a campaign in
 * general.
 */
export const publicationInput = z.object({
  contentAssetVersionId: uuid,
  publishedAt: isoTimestamp,
  /** Where it went, when there is a public address for it. */
  externalUrl: webUrl.nullable().default(null),
  noteNl: z.string().max(1_000).nullable().default(null),
});
export type PublicationInput = z.infer<typeof publicationInput>;

export const publicationRecord = z.object({
  id: uuid,
  campaignId: uuid,
  contentAssetVersionId: uuid,
  channel: marketingChannel,
  publishedAt: isoTimestamp,
  externalUrl: z.string().nullable(),
  noteNl: z.string().nullable(),
  recordedByUserId: uuid.nullable(),
  createdAt: isoTimestamp,
});
export type PublicationRecord = z.infer<typeof publicationRecord>;
