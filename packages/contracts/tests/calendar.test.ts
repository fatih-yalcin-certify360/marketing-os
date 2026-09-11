import { describe, expect, it } from 'vitest';
import { buildCampaignCalendar, campaignCalendar } from '../src/index.js';

/**
 * The campaign calendar, which is arithmetic rather than a proposal.
 *
 * The property that matters most is what it *refuses* to do: it never turns an
 * unconfirmed course date into a scheduling decision. A model asked for dates
 * invents them, and an invented date in a calendar is the kind of detail nobody
 * re-checks — so the schedule is derived from the plan and only ever anchored
 * to dates a person has confirmed.
 */

const PLAN = {
  items: [
    // Stage-less on purpose: the calendar predates stages and must keep
    // reading plans made before they existed.
    { stage: null, channel: 'linkedin_organic' as const, count: 2, withImage: true },
    { stage: null, channel: 'instagram_organic' as const, count: 2, withImage: true },
    { stage: null, channel: 'email' as const, count: 1, withImage: false },
  ],
};

describe('the campaign calendar', () => {
  it('is relative, and says so, until a start date is chosen', () => {
    const calendar = buildCampaignCalendar({
      plan: PLAN,
      startDate: null,
      courseDates: [],
      courseDatesUnconfirmed: false,
    });

    expect(calendar.isDated).toBe(false);
    expect(calendar.slots).toHaveLength(5);
    expect(calendar.slots.every((slot) => slot.date === null)).toBe(true);
    expect(calendar.warnings.map((warning) => warning.kind)).toContain('no_start_date');
    // The offsets exist even without a date: that is what "relative" means.
    expect(calendar.slots.every((slot) => slot.offsetDays >= 0)).toBe(true);
    expect(campaignCalendar.safeParse(calendar).success).toBe(true);
  });

  it('spreads one piece per channel per week, staggered inside the week', () => {
    const calendar = buildCampaignCalendar({
      plan: PLAN,
      startDate: null,
      courseDates: [],
      courseDatesUnconfirmed: false,
    });

    const linkedin = calendar.slots.filter((slot) => slot.channel === 'linkedin_organic');
    expect(linkedin.map((slot) => slot.offsetDays)).toEqual([0, 7]);
    expect(linkedin.map((slot) => slot.week)).toEqual([1, 2]);

    // The second channel sits two days later in the same week, so a week's
    // posts do not all land on one morning.
    const instagram = calendar.slots.filter((slot) => slot.channel === 'instagram_organic');
    expect(instagram.map((slot) => slot.offsetDays)).toEqual([2, 9]);

    expect(calendar.spanDays).toBe(9);
  });

  it('turns offsets into dates when a start date is chosen, and nothing else changes', () => {
    const relative = buildCampaignCalendar({
      plan: PLAN,
      startDate: null,
      courseDates: [],
      courseDatesUnconfirmed: false,
    });
    const dated = buildCampaignCalendar({
      plan: PLAN,
      startDate: '2027-01-04',
      courseDates: [],
      courseDatesUnconfirmed: false,
    });

    expect(dated.isDated).toBe(true);
    // The shape is identical; only `date` is filled in.
    expect(dated.slots.map((slot) => slot.offsetDays)).toEqual(
      relative.slots.map((slot) => slot.offsetDays),
    );
    const linkedin = dated.slots.filter((slot) => slot.channel === 'linkedin_organic');
    expect(linkedin.map((slot) => slot.date)).toEqual(['2027-01-04', '2027-01-11']);
  });

  it('crosses a month and a year boundary correctly', () => {
    /*
     * Guards the date arithmetic, which is done by hand.
     * `new Date('2027-12-28')` is UTC midnight, and formatting it back in a
     * timezone behind UTC returns the previous day — a calendar that shifts by
     * one day depending on where it is read is worse than no calendar.
     */
    const calendar = buildCampaignCalendar({
      plan: { items: [{ stage: null, channel: 'email', count: 2, withImage: false }] },
      startDate: '2027-12-28',
      courseDates: [],
      courseDatesUnconfirmed: false,
    });
    expect(calendar.slots.map((slot) => slot.date)).toEqual(['2027-12-28', '2028-01-04']);
  });

  it('never schedules against a course date nobody has confirmed', () => {
    /*
     * The honesty property. The course card may well contain "12 januari" in
     * prose, but until a person confirms that fact it is not a date — so the
     * calendar says it is ignoring it rather than parsing it.
     */
    const calendar = buildCampaignCalendar({
      plan: PLAN,
      startDate: '2027-01-04',
      courseDates: [],
      courseDatesUnconfirmed: true,
    });

    expect(calendar.warnings.map((warning) => warning.kind)).toContain(
      'course_dates_unconfirmed',
    );
    expect(
      calendar.warnings.find((warning) => warning.kind === 'course_dates_unconfirmed')?.messageNl,
    ).toMatch(/niet gebruikt/u);
    // And no date-based warning was produced, because there is no date.
    expect(calendar.warnings.map((warning) => warning.kind)).not.toContain(
      'runs_past_course_start',
    );
  });

  it('warns when the schedule runs past the first confirmed course date', () => {
    const calendar = buildCampaignCalendar({
      plan: PLAN,
      startDate: '2027-01-04',
      // 8 January: the second week of posts falls after it.
      courseDates: [{ startDate: '2027-01-08', endDate: null, location: null, format: null }],
      courseDatesUnconfirmed: false,
    });

    const warning = calendar.warnings.find((item) => item.kind === 'runs_past_course_start');
    expect(warning).toBeDefined();
    expect(warning?.messageNl).toContain('8 januari 2027');
    // A count, so the user knows whether it is one stray post or the whole plan.
    expect(warning?.messageNl).toMatch(/^3 van de 5/u);
  });

  it('warns when the campaign starts after the course has already begun', () => {
    const calendar = buildCampaignCalendar({
      plan: PLAN,
      startDate: '2027-02-01',
      courseDates: [{ startDate: '2027-01-08', endDate: null, location: null, format: null }],
      courseDatesUnconfirmed: false,
    });

    expect(calendar.warnings.map((warning) => warning.kind)).toContain(
      'starts_after_course_start',
    );
    // Not both: starting late already says everything the other warning would.
    expect(calendar.warnings.map((warning) => warning.kind)).not.toContain(
      'runs_past_course_start',
    );
  });

  it('takes the earliest of several course dates as the deadline', () => {
    const calendar = buildCampaignCalendar({
      plan: { items: [{ stage: null, channel: 'email', count: 1, withImage: false }] },
      startDate: '2027-01-04',
      courseDates: [
        { startDate: '2027-05-04', endDate: null, location: null, format: null },
        { startDate: '2027-01-08', endDate: null, location: null, format: null },
      ],
      courseDatesUnconfirmed: false,
    });
    // The single slot is before 8 January, so nothing is late.
    expect(calendar.warnings.map((warning) => warning.kind)).toEqual([]);
  });

  it('produces an empty calendar rather than failing when there is no plan yet', () => {
    const calendar = buildCampaignCalendar({
      plan: null,
      startDate: null,
      courseDates: [],
      courseDatesUnconfirmed: false,
    });
    expect(calendar.slots).toEqual([]);
    expect(calendar.spanDays).toBe(0);
    expect(calendar.warnings.map((warning) => warning.kind)).toEqual(['no_start_date']);
  });
});
