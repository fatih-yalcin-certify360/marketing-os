import type { ReactNode } from 'react';
import type { ContentPlan, FitVerdict, FunnelStage, MarketingChannel } from '@c360/contracts';
import {
  CHANNEL_CONFIG,
  CHANNEL_LABEL_NL,
  FIT_VERDICT_LABEL_NL,
  FUNNEL_STAGE_GUIDANCE_NL,
  FUNNEL_STAGE_LABEL_NL,
  PRODUCIBLE_CHANNELS,
  channelFit,
  defaultImageSpec,
} from '@c360/contracts';
import '../pages/campaign-flow.css';

/**
 * The stage × channel grid at the heart of the channel plan.
 *
 * Rows are the campaign's funnel stages, columns every channel this build can
 * produce. A cell carries two things that are deliberately kept apart: the
 * *verdict* (● aanbevolen, ○ mogelijk, — ontraden) and the *choice* (the
 * checkbox). The verdict is advice; the choice is the person's. Ticking a
 * discouraged cell is allowed — the advice stays visible next to it, and
 * "Alle creatives maken" ticks everything at once. Advice, not a lock.
 *
 * The verdict shown is the model's *advised* verdict for this campaign when
 * the plan carries advice for the cell, and the editorial rule otherwise; the
 * panel below the grid shows both layers side by side.
 */

/** The identity of one cell, also used as the selection key. */
export function cellKey(stage: FunnelStage, channel: MarketingChannel): string {
  return `${stage}/${channel}`;
}

export function parseCellKey(key: string): { stage: FunnelStage; channel: MarketingChannel } | null {
  const [stage, channel] = key.split('/');
  if (stage === undefined || channel === undefined) {
    return null;
  }
  return { stage: stage as FunnelStage, channel: channel as MarketingChannel };
}

/**
 * Whether our render layer makes an image for this channel.
 *
 * Read from the channel configuration rather than from a list kept here: a
 * page, a mail and an advert declare no image size, so asking for one would
 * invent a dimension nothing enforces.
 */
export function rendersImage(channel: MarketingChannel): boolean {
  return defaultImageSpec(CHANNEL_CONFIG, channel) !== undefined;
}

export interface CellAdvice {
  rule: FitVerdict;
  advised: FitVerdict;
  /** The campaign-specific reasoning; null when the plan carries none for this cell. */
  reasoningNl: string | null;
  /** The generic editorial reason. */
  ruleReasonNl: string;
}

/** Both layers for one cell: the rule from the contract, the advice from the plan. */
export function adviceFor(plan: ContentPlan, stage: FunnelStage, channel: MarketingChannel): CellAdvice {
  const fit = channelFit(stage, channel);
  const advice = plan.channelAdvice.find((entry) => entry.stage === stage && entry.channel === channel);
  return {
    rule: fit.verdict,
    advised: advice?.advisedVerdict ?? fit.verdict,
    reasoningNl: advice?.reasoningNl ?? null,
    ruleReasonNl: fit.reasonNl,
  };
}

const GLYPH: Readonly<Record<FitVerdict, string>> = {
  recommended: '●',
  possible: '○',
  discouraged: '—',
};

export function ChannelPlanGrid(props: {
  stages: readonly FunnelStage[];
  plan: ContentPlan;
  selection: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (key: string, checked: boolean) => void;
}): ReactNode {
  const { stages, plan, selection, disabled, onToggle } = props;

  return (
    <div className="c360-table-scroll">
      <table className="c360-table plan-grid">
        <caption className="c360-visually-hidden">
          Kanaalplan per funnelfase: aanbevolen, mogelijk of ontraden per kanaal, met je keuze
        </caption>
        <thead>
          <tr>
            <th scope="col">Fase</th>
            {PRODUCIBLE_CHANNELS.map((channel) => (
              <th scope="col" key={channel}>
                {CHANNEL_LABEL_NL[channel]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stages.map((stage) => (
            <tr key={stage}>
              <th scope="row">
                <span className="plan-grid__stage">{FUNNEL_STAGE_LABEL_NL[stage]}</span>
                <span className="c360-stat__caption">{FUNNEL_STAGE_GUIDANCE_NL[stage].audienceNl}</span>
              </th>
              {PRODUCIBLE_CHANNELS.map((channel) => {
                const key = cellKey(stage, channel);
                const advice = adviceFor(plan, stage, channel);
                const checked = selection.has(key);
                const name = `${FUNNEL_STAGE_LABEL_NL[stage]} · ${CHANNEL_LABEL_NL[channel]}`;
                return (
                  <td key={channel}>
                    <label
                      className={`plan-cell plan-cell--${advice.advised}${checked ? ' plan-cell--chosen' : ''}`}
                      title={`${FIT_VERDICT_LABEL_NL[advice.advised]} — ${advice.reasoningNl ?? advice.ruleReasonNl}`}
                    >
                      <input
                        type="checkbox"
                        aria-label={name}
                        checked={checked}
                        disabled={disabled}
                        onChange={(event) => {
                          onToggle(key, event.target.checked);
                        }}
                      />
                      <span className="plan-cell__glyph" aria-hidden="true">
                        {GLYPH[advice.advised]}
                      </span>
                      <span className="c360-visually-hidden">{FIT_VERDICT_LABEL_NL[advice.advised]}</span>
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="c360-stat__caption plan-grid__legend">
        <span>● aanbevolen</span>
        <span>○ mogelijk</span>
        <span>— ontraden</span>
        <span>Aangevinkt = wordt gemaakt. Beweeg over een vakje voor de reden.</span>
      </p>
    </div>
  );
}

/**
 * "Waarom dit advies": the argument per stage, both layers visible.
 *
 * *Regel* is the editorial fit from the contract, the same for every label.
 * *Voor deze campagne* is what the model added after reading the personas and
 * the course card — and where it moved a step from the rule, both verdicts are
 * shown so the person can judge the move. No figure appears anywhere: the
 * advice shape has nowhere to carry one.
 */
export function AdvicePanel(props: { stages: readonly FunnelStage[]; plan: ContentPlan }): ReactNode {
  const { stages, plan } = props;
  if (plan.channelAdvice.length === 0) {
    return (
      <p className="c360-card__hint">
        Dit plan bevat geen kanaaladvies; het is gemaakt voordat advies bestond. De vakjes tonen de
        redactionele regel per fase en kanaal.
      </p>
    );
  }

  return (
    <div className="c360-stack advice-panel">
      <p className="c360-list__title" style={{ fontSize: '14px' }}>
        Waarom dit advies
      </p>
      <p className="c360-card__hint">
        <em>Regel</em> is de vaste redactionele inschatting per fase en kanaal; <em>voor deze campagne</em>{' '}
        is de toespitsing op deze doelgroepen en deze opleiding. Het advies mag één stap van de regel
        afwijken en noemt dan de reden. Er staan geen bereik- of conversiecijfers bij, want die zijn niet
        gemeten.
      </p>
      {stages.map((stage, index) => {
        const entries = plan.channelAdvice.filter((entry) => entry.stage === stage);
        if (entries.length === 0) {
          return null;
        }
        return (
          <details key={stage} open={index === 0}>
            <summary>
              <strong>{FUNNEL_STAGE_LABEL_NL[stage]}</strong>
              <span className="c360-stat__caption"> — {FUNNEL_STAGE_GUIDANCE_NL[stage].messageNl}</span>
            </summary>
            <ul className="c360-list">
              {entries.map((entry) => (
                <li className="c360-list__item" key={entry.channel}>
                  <p className="c360-list__title">
                    {CHANNEL_LABEL_NL[entry.channel]}
                    <span className="c360-stat__caption">
                      {entry.ruleVerdict === entry.advisedVerdict
                        ? ` · regel en advies: ${FIT_VERDICT_LABEL_NL[entry.advisedVerdict]}`
                        : ` · regel: ${FIT_VERDICT_LABEL_NL[entry.ruleVerdict]} · advies: ${FIT_VERDICT_LABEL_NL[entry.advisedVerdict]}`}
                    </span>
                  </p>
                  <p className="c360-list__subtitle">
                    <em>Regel:</em> {channelFit(stage, entry.channel).reasonNl}
                  </p>
                  <p className="c360-list__subtitle">
                    <em>Voor deze campagne:</em> {entry.reasoningNl}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
