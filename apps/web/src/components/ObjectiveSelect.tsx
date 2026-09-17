import type { ReactNode } from 'react';
import type { CampaignObjective } from '@c360/contracts';
import { OBJECTIVE_HINT_NL, OBJECTIVE_LABEL_NL, campaignObjective } from '@c360/contracts';

/**
 * The objective a person chooses at a hand-off from the radar.
 *
 * A campaign created from a finding used to arrive without the field that
 * decides its funnel stages. The radar now suggests one — from the insight's
 * stage, the question's intent, the kind of finding — and the person confirms
 * or changes it here before the campaign exists. The default is a suggestion,
 * visibly labelled as such, never a silent choice.
 */
export function ObjectiveSelect(props: {
  id: string;
  value: CampaignObjective;
  onChange: (value: CampaignObjective) => void;
  /** Why this objective is suggested, in one short clause. */
  suggestionNl?: string | undefined;
  disabled?: boolean | undefined;
}): ReactNode {
  return (
    <label className="c360-field objective-select" htmlFor={props.id}>
      <span className="c360-label">Doel van de campagne</span>
      <select
        id={props.id}
        className="c360-select"
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => {
          const parsed = campaignObjective.safeParse(event.target.value);
          if (parsed.success) {
            props.onChange(parsed.data);
          }
        }}
      >
        {campaignObjective.options.map((option) => (
          <option key={option} value={option}>
            {`${OBJECTIVE_LABEL_NL[option]} — ${OBJECTIVE_HINT_NL[option]}`}
          </option>
        ))}
      </select>
      {props.suggestionNl !== undefined && (
        <span className="c360-field__hint">{`Voorgesteld: ${props.suggestionNl}`}</span>
      )}
    </label>
  );
}
