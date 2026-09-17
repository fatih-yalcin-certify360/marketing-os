import type { ReactNode } from 'react';
import type { FunnelStage } from '@c360/contracts';
import { FUNNEL_STAGES, FUNNEL_STAGE_LABEL_NL } from '@c360/contracts';
import '../pages/campaign-flow.css';

/**
 * The three stages as pills, the covered ones filled.
 *
 * One indicator for the whole product — header, campaign list, briefing,
 * calendar — so "which part of the journey is this about" always looks the
 * same. Never reordered: the pills are the journey, Ontdekken first.
 */
export function FunnelPills(props: {
  /** The stages this thing covers; the rest are shown hollow. */
  stages: readonly FunnelStage[];
  /** Compact: for a list row. */
  small?: boolean | undefined;
  /** What the pills describe, for assistive technology. */
  label?: string | undefined;
}): ReactNode {
  const covered = new Set(props.stages);
  const text = FUNNEL_STAGES.filter((stage) => covered.has(stage))
    .map((stage) => FUNNEL_STAGE_LABEL_NL[stage])
    .join(', ');
  return (
    <span
      className={`funnel-pills${props.small === true ? ' funnel-pills--small' : ''}`}
      role="img"
      aria-label={`${props.label ?? 'Funnelfasen'}: ${text.length === 0 ? 'geen' : text}`}
    >
      {FUNNEL_STAGES.map((stage) => (
        <span
          key={stage}
          className={`funnel-pill${covered.has(stage) ? ' funnel-pill--on' : ''}`}
          aria-hidden="true"
        >
          {FUNNEL_STAGE_LABEL_NL[stage]}
        </span>
      ))}
    </span>
  );
}
