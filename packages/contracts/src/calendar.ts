import { z } from 'zod';
import { marketingChannel } from './channels.js';
import type { ContentPlan } from './campaigns.js';
import type { CourseDate } from './courses.js';

/**
 * The campaign calendar (P3-3).
 *
 * ## Relative until someone chooses a start date
 *
 * A plan says *what* and *how many*, in words: "one post per channel per week,
 * two weeks". It deliberately does not say *when* — a model asked for dates
 * invents them, and an invented date in a marketing calendar is the kind of
 * detail nobody re-checks. So the schedule is **derived here**, arithmetically,
 * from the approved plan: every piece gets an offset in days from an unnamed
 * day zero. Choosing a start date turns those offsets into dates and nothing
 * else changes.
 *
 * ## Derived, never stored
 *
 * A calendar is a pure function of the plan, the start date and the course's
 * confirmed dates. Storing it would create a fourth thing to keep in step with
 * three others, and the first edit to any of them would make it a lie. It is
 * computed on read instead, which is why this lives in the contract package
 * where both the server and the interface can call it and cannot disagree.
 *
 * ## Only confirmed course dates count
 *
 * `course.facts.dates` is prose until a person confirms it, and only then is
 * `course.dates` populated with structured dates. This function is given the
 * structured list and told whether an *unconfirmed* date fact exists — and in
 * that case it warns rather than reading the prose. Guessing "12 januari" out
 * of an unverified sentence and scheduling against it would be exactly the
 * invention the product refuses everywhere else.
 */

export const calendarSlot = z.object({
  channel: marketingChannel,
  /** 1-based, per channel: the second LinkedIn post is `sequence: 2`. */
  sequence: z.number().int().min(1),
  /** Days from day zero. Stable whether or not a start date exists. */
  offsetDays: z.number().int().min(0),
  /** 1-based week the slot falls in, for the relative view. */
  week: z.number().int().min(1),
  /** ISO date, once a start date has been chosen. */
  date: z.iso.date().nullable(),
});
export type CalendarSlot = z.infer<typeof calendarSlot>;

export const calendarWarning = z.object({
  kind: z.enum([
    'no_start_date',
    'course_dates_unconfirmed',
    'runs_past_course_start',
    'starts_after_course_start',
  ]),
  messageNl: z.string(),
});
export type CalendarWarning = z.infer<typeof calendarWarning>;

export const campaignCalendar = z.object({
  slots: z.array(calendarSlot),
  warnings: z.array(calendarWarning),
  /** False while the calendar is still relative. */
  isDated: z.boolean(),
  /** Total span in days, so the interface can say "over three weeks". */
  spanDays: z.number().int().min(0),
});
export type CampaignCalendar = z.infer<typeof campaignCalendar>;

/**
 * Days between pieces for the same channel, and between channels in a week.
 *
 * One piece per channel per week, and channels staggered two days apart so a
 * week's posts do not all land on one morning. Both numbers are house rhythm,
 * not a platform rule — which is why they are constants with a comment rather
 * than a configurable nobody would ever tune.
 */
const DAYS_PER_WEEK = 7;
const DAYS_BETWEEN_CHANNELS = 2;
/** Keeps a week's stagger inside the week however many channels there are. */
const MAX_STAGGER_DAYS = 6;

function addDays(isoDate: string, days: number): string {
  /*
   * Parsed by hand rather than with `new Date(isoDate)`.
   *
   * `new Date('2027-01-12')` is parsed as UTC midnight, and formatting it back
   * in a local timezone behind UTC returns the *previous* day. A calendar that
   * shifts by one day depending on where it is read is worse than no calendar,
   * and this arithmetic is simple enough not to need a library.
   */
  const [year, month, day] = isoDate.split('-').map((part) => Number.parseInt(part, 10));
  const base = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  const shifted = new Date(base + days * 86_400_000);
  const yyyy = String(shifted.getUTCFullYear()).padStart(4, '0');
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Dutch, for a message a user reads. */
function formatDutch(isoDate: string): string {
  const months = [
    'januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december',
  ];
  const [year, month, day] = isoDate.split('-');
  const index = Number.parseInt(month ?? '1', 10) - 1;
  return `${String(Number.parseInt(day ?? '1', 10))} ${months[index] ?? ''} ${String(year)}`;
}

export function buildCampaignCalendar(input: {
  plan: Pick<ContentPlan, 'items'> | null;
  /** ISO date, or null while the campaign has no chosen start. */
  startDate: string | null;
  /** Structured course dates. Only ever the **confirmed** ones. */
  courseDates: readonly CourseDate[];
  /**
   * True when the course card has a date *value* that nobody has confirmed.
   *
   * The prose is deliberately not parsed. This flag exists so the calendar can
   * say "there are dates on the card and I am ignoring them", which is honest,
   * instead of silently scheduling as though the course had no dates at all.
   */
  courseDatesUnconfirmed: boolean;
}): CampaignCalendar {
  const warnings: CalendarWarning[] = [];
  const slots: CalendarSlot[] = [];

  if (input.plan !== null) {
    /*
     * Numbered per channel across the whole plan, not per item.
     *
     * A staged plan holds one item per stage × channel, so the same channel
     * appears up to three times. Numbering each item from one gave three
     * "first" e-mails on the same day — the same identity three times, which
     * the interface duly rendered as duplicate rows. The second piece for a
     * channel is the second, whichever stage it serves. Sequencing the stages
     * themselves is slice 3 of the campaign-flow redesign.
     */
    const perChannel = new Map<string, number>();
    for (const [channelIndex, item] of input.plan.items.entries()) {
      const stagger = Math.min(channelIndex * DAYS_BETWEEN_CHANNELS, MAX_STAGGER_DAYS);
      for (let piece = 0; piece < item.count; piece += 1) {
        const offsetDays = piece * DAYS_PER_WEEK + stagger;
        const sequence = (perChannel.get(item.channel) ?? 0) + 1;
        perChannel.set(item.channel, sequence);
        slots.push({
          channel: item.channel,
          sequence,
          offsetDays,
          week: piece + 1,
          date: input.startDate === null ? null : addDays(input.startDate, offsetDays),
        });
      }
    }
  }

  slots.sort((a, b) => a.offsetDays - b.offsetDays || a.channel.localeCompare(b.channel));

  if (input.startDate === null) {
    warnings.push({
      kind: 'no_start_date',
      messageNl:
        'Er is nog geen startdatum gekozen, dus de planning is relatief: week 1, week 2, enzovoort. Kies een startdatum om er echte data van te maken.',
    });
  }

  if (input.courseDatesUnconfirmed) {
    warnings.push({
      kind: 'course_dates_unconfirmed',
      messageNl:
        'Op de opleidingskaart staan data die nog niet zijn gecontroleerd. Die worden hier niet gebruikt: de planning houdt er geen rekening mee tot iemand ze bevestigt.',
    });
  }

  /*
   * The first confirmed course start is the deadline, not a target.
   *
   * Promotion that continues after the course has begun is the mistake worth
   * catching — it is easy to make by adding a week to the plan and never
   * looking at the calendar again. Reported as a warning, never as a refusal:
   * a second run of the same course, or a rolling intake, are both legitimate
   * and the system does not know which it is looking at.
   */
  const earliest = [...input.courseDates]
    .map((date) => date.startDate)
    .sort()
    .at(0);

  if (earliest !== undefined && input.startDate !== null) {
    if (input.startDate >= earliest) {
      warnings.push({
        kind: 'starts_after_course_start',
        messageNl: `De campagne start op of na de eerste opleidingsdatum (${formatDutch(earliest)}). Controleer of dat de bedoeling is.`,
      });
    } else {
      const late = slots.filter((slot) => slot.date !== null && slot.date >= earliest);
      if (late.length > 0) {
        warnings.push({
          kind: 'runs_past_course_start',
          messageNl: `${String(late.length)} van de ${String(slots.length)} momenten valt op of na de eerste opleidingsdatum (${formatDutch(earliest)}).`,
        });
      }
    }
  }

  const spanDays = slots.length === 0 ? 0 : Math.max(...slots.map((slot) => slot.offsetDays));

  return { slots, warnings, isDated: input.startDate !== null, spanDays };
}
