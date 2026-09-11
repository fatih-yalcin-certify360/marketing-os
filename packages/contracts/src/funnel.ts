import { z } from 'zod';
import { marketingChannel, type MarketingChannel } from './channels.js';

/**
 * The funnel: what a campaign is for, and which channel fits which stage.
 *
 * A campaign used to know *how it started* (an idea, a briefing, research) and
 * *where it was in the process* (brief approved, concept chosen), but not
 * *what it had to achieve*. Without that, every plan came out the same shape:
 * one message, one call to action, executed on every channel. This module is
 * the vocabulary that lets the rest of the product plan the way a marketer
 * does — objective, then the audience's journey, then a message per stage,
 * then channels per stage, each with a reason.
 *
 * Three fixed stages rather than a configurable list, on purpose. A shared
 * vocabulary is what makes advice, results and learnings comparable across
 * campaigns; everything downstream keys on these three values. The Dutch
 * labels are cheap to change, the number is not.
 *
 * See `docs/product/campaign-flow-design.md`.
 */

export const funnelStage = z.enum(['discover', 'consider', 'decide']);
export type FunnelStage = z.infer<typeof funnelStage>;

/** In journey order. Use this rather than `funnelStage.options` when order matters. */
export const FUNNEL_STAGES: readonly FunnelStage[] = Object.freeze(['discover', 'consider', 'decide']);

export const FUNNEL_STAGE_LABEL_NL: Readonly<Record<FunnelStage, string>> = Object.freeze({
  discover: 'Ontdekken',
  consider: 'Overwegen',
  decide: 'Beslissen',
});

/**
 * What each stage is, as marketing.
 *
 * Given to the model as the brief for a stage and shown to the user next to
 * the content, so both work from the same text. Editorial knowledge, written
 * once; not a model's guess and not a measured claim.
 */
export interface FunnelStageGuidance {
  /** Who the reader is at this point in the journey. */
  audienceNl: string;
  /** What the content is about. */
  messageNl: string;
  /** Which confirmed course facts the stage may use. */
  proofNl: string;
  /** The kind of call to action that fits. */
  ctaNl: string;
}

export const FUNNEL_STAGE_GUIDANCE_NL: Readonly<Record<FunnelStage, FunnelStageGuidance>> =
  Object.freeze({
    discover: {
      audienceNl: 'Ziet de behoefte nog niet, zoekt niet en kent de opleiding niet.',
      messageNl:
        'Het probleem, het moment of de ambitie: waarom dit er nu toe doet. Nog niet de opleiding zelf.',
      proofNl:
        'Alleen gecontroleerde opleidingsinformatie, en in deze fase geen prijs, geen data en geen toelatingseisen — die horen bij Beslissen.',
      ctaNl: 'Laagdrempelig: lees meer, bekijk, herken je dit.',
    },
    consider: {
      audienceNl: 'Kent de behoefte en vergelijkt opties.',
      messageNl:
        'Wat je leert, voor wie het is, hoe het werkt en waarom het past. Inhoud boven belofte.',
      proofNl:
        'Gecontroleerde opleidingsinformatie over inhoud, doelgroep en werkwijze; accreditatie alleen als die gecontroleerd is.',
      ctaNl: 'Verdiepend: bekijk de inhoud, download het programma, plan een gesprek.',
    },
    decide: {
      audienceNl: 'Is klaar om te kiezen en wil weten hoe.',
      messageNl:
        'De praktische kant: wanneer, wat het kost, wat de voorwaarden zijn en hoe je je inschrijft. Wegnemen wat nog in de weg zit.',
      proofNl:
        'Uitsluitend gecontroleerde feiten. Dit is de fase waarin een ongecontroleerde prijs of datum schade doet; ontbreekt een feit, noem het dan niet.',
      ctaNl: 'Direct: schrijf je in, meld je aan.',
    },
  });

// --------------------------------------------------------------- Objective ---

/**
 * What the campaign must achieve. Chosen at creation.
 *
 * Complements the entry mode rather than replacing it: the objective is
 * *what*, the entry mode is *from what* (an idea, a briefing, research).
 */
export const campaignObjective = z.enum(['awareness', 'consideration', 'conversion', 'full_funnel']);
export type CampaignObjective = z.infer<typeof campaignObjective>;

export const OBJECTIVE_LABEL_NL: Readonly<Record<CampaignObjective, string>> = Object.freeze({
  awareness: 'Bekendheid',
  consideration: 'Overweging',
  conversion: 'Inschrijving',
  full_funnel: 'Hele funnel',
});

export const OBJECTIVE_HINT_NL: Readonly<Record<CampaignObjective, string>> = Object.freeze({
  awareness: 'Mensen kennen de opleiding of de behoefte nog niet.',
  consideration: 'Mensen kennen de behoefte en vergelijken opties.',
  conversion: 'Mensen zijn klaar om te kiezen; wegnemen wat nog in de weg zit.',
  full_funnel: 'Alle drie de fasen, na elkaar.',
});

/** The stages a campaign with this objective plans for, in journey order. */
export function stagesForObjective(objective: CampaignObjective): readonly FunnelStage[] {
  switch (objective) {
    case 'awareness':
      return ['discover'];
    case 'consideration':
      return ['consider'];
    case 'conversion':
      return ['decide'];
    case 'full_funnel':
      return FUNNEL_STAGES;
  }
}

// ------------------------------------------------------------- Channel fit ---

export const fitVerdict = z.enum(['recommended', 'possible', 'discouraged']);
export type FitVerdict = z.infer<typeof fitVerdict>;

export const FIT_VERDICT_LABEL_NL: Readonly<Record<FitVerdict, string>> = Object.freeze({
  recommended: 'aanbevolen',
  possible: 'mogelijk',
  discouraged: 'ontraden',
});

export interface ChannelFit {
  verdict: FitVerdict;
  /** The generic reason, in Dutch. About fit, never about figures. */
  reasonNl: string;
}

/**
 * The editorial rules: which channel fits which stage, and why.
 *
 * This is the marketing theory, written down once, in code, so that it is
 * testable, auditable and free of invented numbers. Every reason argues fit —
 * the stage, the moment, the relationship with the reader — and none of them
 * cites reach, cost or conversion, because this product has measured none of
 * those. The model's job downstream is to tailor these arguments to one
 * campaign's personas and course, not to invent the theory.
 *
 * Changing a verdict here is a product decision that should be argued in a
 * diff; `funnel.test.ts` holds the table complete.
 */
const FIT: Readonly<Record<FunnelStage, Readonly<Record<MarketingChannel, ChannelFit>>>> =
  Object.freeze({
    discover: {
      linkedin_organic: {
        verdict: 'recommended',
        reasonNl:
          'Bereikt professionals in hun werkcontext op een moment dat ze nog niet zoeken; geschikt om het probleem of de ambitie herkenbaar te maken.',
      },
      instagram_organic: {
        verdict: 'recommended',
        reasonNl:
          'Visueel en laagdrempelig; geschikt om een herkenbaar moment te tonen aan mensen die nog niet zoeken.',
      },
      facebook_organic: {
        verdict: 'possible',
        reasonNl:
          'Bereikt vooral de bestaande volgers van het label; werkt als er al een community is, anders ondersteunend.',
      },
      landing_page: {
        verdict: 'recommended',
        reasonNl:
          'De bestemming waar elk ontdekkingsbericht naartoe verwijst; zonder pagina landt de nieuwsgierigheid nergens.',
      },
      email: {
        verdict: 'discouraged',
        reasonNl:
          'Er is nog geen relatie: wie de behoefte niet kent, heeft zich niet voor een mailing aangemeld.',
      },
      linkedin_ads: {
        verdict: 'possible',
        reasonNl:
          'Betaald bereik buiten de eigen volgers; zinvol als de doelgroep scherp op functie of sector is af te bakenen.',
      },
      meta_ads: {
        verdict: 'recommended',
        reasonNl:
          'Betaald bereik onder mensen die nog niet zoeken, is precies waar dit kanaal voor is gemaakt.',
      },
      google_search_ads: {
        verdict: 'discouraged',
        reasonNl:
          'Zoekadvertenties bereiken alleen wie al zoekt; in deze fase zoekt de doelgroep nog niet.',
      },
    },
    consider: {
      linkedin_organic: {
        verdict: 'recommended',
        reasonNl:
          'Ruimte voor inhoud — wat je leert, voor wie, hoe het werkt — in de feed waar professionals vergelijken.',
      },
      instagram_organic: {
        verdict: 'discouraged',
        reasonNl:
          'Kort en visueel; te weinig ruimte voor de inhoudelijke vergelijking die deze fase vraagt.',
      },
      facebook_organic: {
        verdict: 'possible',
        reasonNl:
          'Kan inhoud dragen, maar bereikt vooral bestaande volgers; ondersteunend aan de pagina en e-mail.',
      },
      landing_page: {
        verdict: 'recommended',
        reasonNl:
          'De plek waar de vergelijking wordt gemaakt: inhoud, doelgroep en werkwijze op één pagina.',
      },
      email: {
        verdict: 'recommended',
        reasonNl:
          'Wie al interesse toonde, kan per mail stap voor stap door de inhoud worden meegenomen.',
      },
      linkedin_ads: {
        verdict: 'possible',
        reasonNl:
          'Kan de inhoudelijke boodschap bij een afgebakende doelgroep brengen; zonder scherpe afbakening weinig gericht.',
      },
      meta_ads: {
        verdict: 'possible',
        reasonNl:
          'Zinvol als hernieuwd bereik van wie de pagina al bezocht; als koud bereik minder geschikt voor een vergelijking.',
      },
      google_search_ads: {
        verdict: 'recommended',
        reasonNl:
          'De doelgroep zoekt nu actief naar opleidingen en vergelijkingen; zoekadvertenties vangen die vraag op.',
      },
    },
    decide: {
      linkedin_organic: {
        verdict: 'possible',
        reasonNl:
          'Kan data en inschrijving noemen, maar de feed is geen beslismoment; ondersteunend aan e-mail en pagina.',
      },
      instagram_organic: {
        verdict: 'discouraged',
        reasonNl:
          'Geen beslismoment en weinig ruimte voor voorwaarden en data; niet het kanaal voor de laatste stap.',
      },
      facebook_organic: {
        verdict: 'discouraged',
        reasonNl:
          'Bereik onder volgers op een moment dat geen beslismoment is; de laatste stap wordt elders gezet.',
      },
      landing_page: {
        verdict: 'recommended',
        reasonNl:
          'De inschrijving gebeurt hier: data, prijs, voorwaarden en het formulier moeten op één plek kloppen.',
      },
      email: {
        verdict: 'recommended',
        reasonNl:
          'Direct en persoonlijk naar wie al ver is: het moment voor praktische informatie en een concrete stap.',
      },
      linkedin_ads: {
        verdict: 'possible',
        reasonNl:
          'Hernieuwd bereik van bekende bezoekers kan; koud bereik in deze fase treft vooral mensen die nog niet zo ver zijn.',
      },
      meta_ads: {
        verdict: 'possible',
        reasonNl:
          'Alleen als hernieuwd bereik van eerdere bezoekers; anders bereik je vooral mensen die nog niet zo ver zijn.',
      },
      google_search_ads: {
        verdict: 'recommended',
        reasonNl:
          'Wie op de opleidingsnaam of op inschrijven zoekt, staat op het punt te kiezen.',
      },
    },
  });

/** The editorial verdict for one stage × channel cell. Deterministic; no model involved. */
export function channelFit(stage: FunnelStage, channel: MarketingChannel): ChannelFit {
  return FIT[stage][channel];
}

/** Ordered so that a one-step adjustment is a difference of one. */
const VERDICT_RANK: Readonly<Record<FitVerdict, number>> = Object.freeze({
  discouraged: 0,
  possible: 1,
  recommended: 2,
});

// ---------------------------------------------------------- Channel advice ---

/**
 * The model's advice for one stage × channel cell, next to the rule it rests on.
 *
 * Two layers, kept visibly separate: `ruleVerdict` is the editorial fit from
 * `channelFit`, `advisedVerdict` is what the model advises for *this* campaign
 * after reading its personas and course. The model may move one step from the
 * rule with a reason — a persona who is demonstrably not on Instagram is a
 * legitimate reason to call Instagram *possible* rather than *recommended* —
 * and may never turn a discouraged channel into a recommended one. The user
 * sees both verdicts and decides.
 *
 * ## No field for a number
 *
 * `reasoningNl` is the only free text, and there is deliberately no field for
 * reach, cost, click-through or conversion — the same control the advertising
 * proposal has, for the same reason: an argument about fit can be checked
 * against the persona and the course card; a figure cannot, and would be a
 * guess wearing the clothes of data. `funnel.test.ts` holds the shape.
 */
const channelAdviceFields = z.object({
  stage: funnelStage,
  channel: marketingChannel,
  ruleVerdict: fitVerdict,
  advisedVerdict: fitVerdict,
  /** Why, for this campaign: this stage, these personas, this course. */
  reasoningNl: z.string().min(10).max(600),
});

/** Whether the advised verdict is within one step of the rule. */
export function isOneStepAdjustment(rule: FitVerdict, advised: FitVerdict): boolean {
  return Math.abs(VERDICT_RANK[rule] - VERDICT_RANK[advised]) <= 1;
}

/**
 * The stored shape: readable even after the rule table changes.
 *
 * Only the one-step rule is enforced here. A plan stored last year must still
 * parse when an editorial verdict is revised later, so this form does not
 * re-check `ruleVerdict` against today's table — the proposing form below does.
 */
export const channelAdvice = channelAdviceFields.refine(
  (advice) => isOneStepAdjustment(advice.ruleVerdict, advice.advisedVerdict),
  {
    message:
      'Het advies mag hoogstens één stap van de regel afwijken, en nooit van ontraden naar aanbevolen.',
    path: ['advisedVerdict'],
  },
);
export type ChannelAdvice = z.infer<typeof channelAdvice>;

/**
 * The proposing shape: what the model returns, checked against the rule table.
 *
 * `ruleVerdict` must be the verdict `channelFit` gives for the cell — the model
 * is handed those verdicts and must echo them, so a mismatch is a model error
 * and becomes a repair attempt rather than stored advice that misquotes its
 * own rule.
 */
export const proposedChannelAdvice = channelAdviceFields
  .refine((advice) => advice.ruleVerdict === channelFit(advice.stage, advice.channel).verdict, {
    message: 'ruleVerdict moet het oordeel uit <kanaalgeschiktheid> letterlijk overnemen.',
    path: ['ruleVerdict'],
  })
  .refine((advice) => isOneStepAdjustment(advice.ruleVerdict, advice.advisedVerdict), {
    message:
      'Het advies mag hoogstens één stap van de regel afwijken, en nooit van ontraden naar aanbevolen.',
    path: ['advisedVerdict'],
  });
export type ProposedChannelAdvice = z.infer<typeof proposedChannelAdvice>;
