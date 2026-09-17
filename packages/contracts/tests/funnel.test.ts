import { describe, expect, it } from 'vitest';
import {
  FUNNEL_STAGES,
  MAX_PLAN_ITEMS,
  PRODUCIBLE_CHANNELS,
  FUNNEL_STAGE_GUIDANCE_NL,
  FUNNEL_STAGE_INDICATOR_NL,
  campaignObjective,
  channelAdvice,
  channelFit,
  contentPlan,
  contentPlanItem,
  marketingChannel,
  plannableContentPlan,
  plannableContentPlanItem,
  proposedChannelAdvice,
  stageMeasurement,
  stageMessage,
  stagesForObjective,
  type FitVerdict,
} from '../src/index.js';

/**
 * The funnel vocabulary and the channel-fit rules.
 *
 * Two things are held here. The rule table must be *complete* — every stage ×
 * channel cell has a verdict and a reason a reader can check — and the advice
 * schema must be unable to carry what the product promises never to produce:
 * a performance figure, or an advice that quietly overrides the rule.
 */

const CHANNELS = marketingChannel.options;

describe('the channel-fit rules', () => {
  it('give every stage × channel cell a verdict and a reason', () => {
    for (const stage of FUNNEL_STAGES) {
      for (const channel of CHANNELS) {
        const fit = channelFit(stage, channel);
        expect(['recommended', 'possible', 'discouraged']).toContain(fit.verdict);
        // A reason short enough to be a label is not a reason.
        expect(fit.reasonNl.length, `${stage}/${channel}`).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it('recommend at least one channel per stage, so a plan is always possible', () => {
    for (const stage of FUNNEL_STAGES) {
      const recommended = CHANNELS.filter((channel) => channelFit(stage, channel).verdict === 'recommended');
      expect(recommended.length, stage).toBeGreaterThan(0);
    }
  });

  it('cite fit, never figures', () => {
    /*
     * The rules are editorial; none of them has been measured, so none may
     * read as if it had. Percent signs and digit strings are the cheap tell.
     */
    for (const stage of FUNNEL_STAGES) {
      for (const channel of CHANNELS) {
        expect(channelFit(stage, channel).reasonNl).not.toMatch(/\d|%/u);
      }
    }
    for (const guidance of Object.values(FUNNEL_STAGE_GUIDANCE_NL)) {
      expect(`${guidance.messageNl} ${guidance.proofNl} ${guidance.ctaNl}`).not.toMatch(/\d|%/u);
    }
  });

  it('encode the journey: search is for people who are already looking', () => {
    // The clearest of the rules, asserted so a careless edit to the table fails
    // a named test rather than silently reshaping every plan.
    expect(channelFit('discover', 'google_search_ads').verdict).toBe('discouraged');
    expect(channelFit('consider', 'google_search_ads').verdict).toBe('recommended');
    expect(channelFit('decide', 'google_search_ads').verdict).toBe('recommended');
    // No relationship yet, no mailing.
    expect(channelFit('discover', 'email').verdict).toBe('discouraged');
    expect(channelFit('decide', 'email').verdict).toBe('recommended');
    /*
     * The page is where every stage ends up — and it is one page.
     *
     * It used to be "recommended" in all three stages, which read as sound
     * advice and produced a contradiction: a full-funnel plan asked for the
     * same page three times, and applying all three change sets leaves the page
     * in whichever state was applied last. It is now recommended once, in the
     * stage where the page does the most work, and possible in the other two —
     * what those stages need from the page belongs in that one proposal, as
     * separate changes (2026-09-16).
     */
    expect(channelFit('consider', 'course_page_update').verdict).toBe('recommended');
    expect(channelFit('discover', 'course_page_update').verdict).toBe('possible');
    expect(channelFit('decide', 'course_page_update').verdict).toBe('possible');
    expect(
      FUNNEL_STAGES.filter((stage) => channelFit(stage, 'course_page_update').verdict === 'recommended'),
    ).toHaveLength(1);
  });
});

describe('objectives', () => {
  it('map to stages in journey order, and the full funnel to all three', () => {
    expect(stagesForObjective('awareness')).toEqual(['discover']);
    expect(stagesForObjective('consideration')).toEqual(['consider']);
    expect(stagesForObjective('conversion')).toEqual(['decide']);
    expect(stagesForObjective('full_funnel')).toEqual(['discover', 'consider', 'decide']);
    // Every objective is covered — a new one added to the enum must be mapped.
    for (const objective of campaignObjective.options) {
      expect(stagesForObjective(objective).length).toBeGreaterThan(0);
    }
  });
});

describe('the channel-advice shape', () => {
  const valid = {
    stage: 'discover',
    channel: 'linkedin_organic',
    ruleVerdict: 'recommended',
    advisedVerdict: 'recommended',
    reasoningNl: 'De gekozen doelgroepen werken in functies die zich op LinkedIn oriënteren.',
  } as const;

  it('has no field for any performance figure', () => {
    /*
     * Same control as the advertising proposal: instructing a model not to
     * invent a figure is not the control — having nowhere to put one is.
     */
    const present = Object.keys(proposedChannelAdvice.parse(valid)).sort();
    expect(present).toEqual(['advisedVerdict', 'channel', 'reasoningNl', 'ruleVerdict', 'stage']);
    for (const field of ['reach', 'cpc', 'budget', 'ctr', 'conversions', 'impressions', 'score']) {
      expect(present).not.toContain(field);
    }
  });

  it('accepts a one-step adjustment with a reason', () => {
    expect(proposedChannelAdvice.safeParse({ ...valid, advisedVerdict: 'possible' }).success).toBe(true);
    // Upwards too: possible → recommended.
    expect(
      proposedChannelAdvice.safeParse({
        ...valid,
        channel: 'facebook_organic',
        ruleVerdict: 'possible',
        advisedVerdict: 'recommended',
      }).success,
    ).toBe(true);
  });

  it('refuses to turn a discouraged channel into a recommended one', () => {
    const attempt = proposedChannelAdvice.safeParse({
      ...valid,
      channel: 'google_search_ads',
      ruleVerdict: 'discouraged',
      advisedVerdict: 'recommended',
    });
    expect(attempt.success).toBe(false);
    // And the other way round: the rule is symmetric, one step either way.
    expect(
      proposedChannelAdvice.safeParse({ ...valid, ruleVerdict: 'recommended', advisedVerdict: 'discouraged' }).success,
    ).toBe(false);
  });

  it('refuses a proposal that misquotes its own rule', () => {
    // The model is handed the rule verdicts and must echo them. Search in the
    // discover stage is discouraged; claiming otherwise is a model error.
    const attempt = proposedChannelAdvice.safeParse({
      ...valid,
      channel: 'google_search_ads',
      ruleVerdict: 'recommended' satisfies FitVerdict,
      advisedVerdict: 'recommended',
    });
    expect(attempt.success).toBe(false);
  });

  it('keeps stored advice readable after the rule table changes', () => {
    // The wide form does not re-check the rule, only the one-step limit — so
    // a plan stored under an older table still parses.
    expect(
      channelAdvice.safeParse({
        ...valid,
        channel: 'google_search_ads',
        ruleVerdict: 'recommended',
        advisedVerdict: 'possible',
      }).success,
    ).toBe(true);
  });
});

describe('the stage message shape (slice 2)', () => {
  it('names course-card fields as proof, never values, and only fields that exist', () => {
    const ok = stageMessage.safeParse({
      stage: 'decide',
      coreMessageNl: 'De praktische stap: wanneer, wat het vraagt en hoe je je inschrijft.',
      ctaNl: 'Schrijf je in',
      proofFields: ['price', 'dates'],
    });
    expect(ok.success).toBe(true);
    // A made-up field is refused by the schema; an unconfirmed one is the
    // service's job, because the schema cannot know what is confirmed.
    expect(
      stageMessage.safeParse({ stage: 'decide', coreMessageNl: 'x'.repeat(20), ctaNl: 'Nu', proofFields: ['slagingskans'] })
        .success,
    ).toBe(false);
    // Proof is optional: a stage may cite nothing.
    expect(stageMessage.parse({ stage: 'discover', coreMessageNl: 'x'.repeat(20), ctaNl: 'Lees meer' }).proofFields).toEqual([]);
  });
});

describe('the measurement plan shape (R-7)', () => {
  it('has no field for a target, a baseline or a forecast', () => {
    const present = Object.keys(
      stageMeasurement.parse({
        stage: 'consider',
        indicatorNl: 'Bezoekduur op de opleidingspagina.',
        sourceNl: 'De paginastatistieken van het label.',
        decisionRuleNl: 'Na drie weken: opschalen als de bezoekduur stijgt, stoppen als niemand doorklikt.',
      }),
    ).sort();
    expect(present).toEqual(['decisionRuleNl', 'indicatorNl', 'sourceNl', 'stage']);
    for (const field of ['target', 'baseline', 'expectedCtr', 'expectedCpl', 'forecast', 'kpiValue']) {
      expect(present).not.toContain(field);
    }
  });

  it('reads each stage on its own rung of the ladder, without a figure', () => {
    for (const stage of FUNNEL_STAGES) {
      const guidance = FUNNEL_STAGE_INDICATOR_NL[stage];
      expect(`${guidance.ladderNl} ${guidance.examplesNl} ${guidance.notNl}`).not.toMatch(/\d|%/u);
    }
    // Enrolment is a Beslissen signal and explicitly not a Ontdekken one.
    expect(FUNNEL_STAGE_INDICATOR_NL.decide.examplesNl).toMatch(/inschrijving/iu);
    expect(FUNNEL_STAGE_INDICATOR_NL.discover.notNl).toMatch(/inschrijving/iu);
  });
});

describe('plan items and stages', () => {
  it('require a stage when planning and tolerate its absence when reading', () => {
    const legacy = contentPlanItem.parse({ channel: 'linkedin_organic', count: 1, withImage: true });
    expect(legacy.stage).toBeNull();

    const planning = plannableContentPlanItem.safeParse({
      channel: 'linkedin_organic',
      count: 1,
      withImage: true,
    });
    expect(planning.success).toBe(false);
  });

  it('read a stored plan without advice as an empty advice list', () => {
    const stored = contentPlan.parse({
      items: [{ channel: 'linkedin_organic', count: 1, withImage: true }],
      cadenceNl: 'Eén bericht per week.',
      rationaleNl: 'Klein gehouden om te kunnen vergelijken.',
    });
    expect(stored.channelAdvice).toEqual([]);
    expect(stored.measurementPlan).toEqual([]);
  });

  it('hold every stage × every producible channel, and refuse a retired one', () => {
    const items = FUNNEL_STAGES.flatMap((stage) =>
      PRODUCIBLE_CHANNELS.map((channel) => ({ stage, channel, count: 1, withImage: false })),
    );
    expect(items).toHaveLength(MAX_PLAN_ITEMS);
    expect(
      plannableContentPlan.safeParse({
        items,
        cadenceNl: 'Eén item per combinatie.',
        rationaleNl: 'Alles, op verzoek van de gebruiker.',
        channelAdvice: [],
      }).success,
    ).toBe(true);

    /*
     * The vocabulary is one wider than what can be planned.
     *
     * `landing_page` carried both website deliverables until 2026-09-15 and
     * stays in `marketingChannel` so stored rows keep a label and a
     * specification — but nothing new may be planned on it.
     */
    expect(CHANNELS.length).toBe(PRODUCIBLE_CHANNELS.length + 1);
    expect(
      plannableContentPlan.safeParse({
        items: [{ stage: 'discover', channel: 'landing_page', count: 1, withImage: false }],
        cadenceNl: 'Eén item.',
        rationaleNl: 'Een kanaal dat niet meer gepland mag worden.',
        channelAdvice: [],
      }).success,
    ).toBe(false);
  });
});
