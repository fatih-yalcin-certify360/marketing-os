import { describe, expect, it } from 'vitest';
import { THIN_EVIDENCE, learningInput, summariseEvidence } from '../src/index.js';

/**
 * How much is behind a learning, stated rather than implied.
 *
 * The system cannot stop a person writing an overconfident hypothesis, and
 * pretending it could would be the dishonest move. What it can do is put the
 * size of the evidence next to the claim every time the claim is shown or
 * handed to a model — one measurement over four days is a very different thing
 * from twelve over three months, and a reader who sees both numbers will not
 * mistake the first for a trend.
 *
 * Thin is never a refusal. A thin learning is often the only one available and
 * is still worth writing down; it travels with the warning attached.
 */

const outcome = (campaignId: string, periodStart: string, periodEnd: string) => ({
  campaignId,
  periodStart,
  periodEnd,
});

describe('the evidence summary', () => {
  it('calls a single measurement thin, and says why in Dutch', () => {
    const summary = summariseEvidence({
      outcomes: [outcome('c1', '2027-02-01', '2027-02-03')],
    });

    expect(summary.outcomeCount).toBe(1);
    expect(summary.campaignCount).toBe(1);
    expect(summary.periodDays).toBe(2);
    expect(summary.isThin).toBe(true);
    // All three reasons apply here, and each names a different limitation.
    expect(summary.reasonsNl).toHaveLength(3);
    expect(summary.reasonsNl.join(' ')).toMatch(/te weinig om een patroon te noemen/u);
    expect(summary.reasonsNl.join(' ')).toMatch(/één campagne/u);
    expect(summary.reasonsNl.join(' ')).toMatch(/korte periode/u);
  });

  it('says plainly when a learning rests on nothing measured', () => {
    /*
     * Allowed: a learning may be qualitative, and forcing a citation would
     * only teach people to attach an unrelated row. But it must not pass
     * quietly as though it had evidence.
     */
    const summary = summariseEvidence({ outcomes: [] });
    expect(summary.isThin).toBe(true);
    expect(summary.reasonsNl).toEqual([
      'Er zijn geen gemeten resultaten aan deze les gekoppeld.',
    ]);
    expect(summary.periodDays).toBe(0);
  });

  it('stops warning once there is enough behind it', () => {
    const summary = summariseEvidence({
      outcomes: [
        outcome('c1', '2027-01-01', '2027-01-20'),
        outcome('c2', '2027-01-05', '2027-01-25'),
        outcome('c3', '2027-01-10', '2027-02-01'),
      ],
    });

    expect(summary.outcomeCount).toBeGreaterThanOrEqual(THIN_EVIDENCE.minOutcomes);
    expect(summary.campaignCount).toBeGreaterThanOrEqual(THIN_EVIDENCE.minCampaigns);
    expect(summary.periodDays).toBeGreaterThanOrEqual(THIN_EVIDENCE.minPeriodDays);
    expect(summary.isThin).toBe(false);
    expect(summary.reasonsNl).toEqual([]);
  });

  it('measures the period across all the outcomes, not within one', () => {
    // Earliest start to latest end: three short measurements a month apart are
    // still a month of evidence.
    const summary = summariseEvidence({
      outcomes: [
        outcome('c1', '2027-01-01', '2027-01-02'),
        outcome('c2', '2027-02-01', '2027-02-02'),
      ],
    });
    expect(summary.periodDays).toBe(32);
  });

  it('counts three measurements of one campaign as one campaign', () => {
    const summary = summariseEvidence({
      outcomes: [
        outcome('c1', '2027-01-01', '2027-01-20'),
        outcome('c1', '2027-01-05', '2027-01-25'),
        outcome('c1', '2027-01-10', '2027-02-01'),
      ],
    });
    expect(summary.campaignCount).toBe(1);
    expect(summary.isThin).toBe(true);
    expect(summary.reasonsNl).toEqual([
      'Alle metingen komen uit één campagne, dus wat hier speelde kan eenmalig zijn.',
    ]);
  });
});

describe('what a learning must say', () => {
  const valid = {
    observationNl: 'De variant met een vraag als kop kreeg meer doorkliks dan de variant zonder.',
    hypothesisNl: 'Een vraag in de kop spreekt mensen aan die nog aan het oriënteren zijn.',
    nextTestNl: 'Zelfde opzet, één campagne later, met de kopvormen omgedraaid.',
    outcomeReportIds: [],
  };

  it('accepts an observation, a hypothesis and a test', () => {
    expect(learningInput.safeParse(valid).success).toBe(true);
  });

  it('refuses a three-word conclusion', () => {
    /*
     * "Werkte goed" is exactly the learning that misleads the next reader, who
     * no longer remembers the campaign. The length floor is a blunt instrument
     * and it is the honest one available: it cannot judge quality, only that
     * something was actually written.
     */
    expect(learningInput.safeParse({ ...valid, observationNl: 'Werkte goed' }).success).toBe(false);
    expect(learningInput.safeParse({ ...valid, hypothesisNl: 'Beter' }).success).toBe(false);
    expect(learningInput.safeParse({ ...valid, nextTestNl: 'Nog eens' }).success).toBe(false);
  });

  it('has no field that could change a persona or a brand', () => {
    /*
     * The second constraint of this item, held by the shape. An approved
     * learning is context handed to a later proposal — there is deliberately
     * no path from it to stored work.
     */
    const fields = Object.keys(learningInput.shape);
    for (const forbidden of ['personaVersionId', 'personaId', 'brandProfileVersionId', 'brandRule']) {
      expect(fields, forbidden).not.toContain(forbidden);
    }
    expect(fields.sort()).toEqual([
      'hypothesisNl',
      'nextTestNl',
      'observationNl',
      'originCampaignId',
      'outcomeReportIds',
    ]);
  });
});
