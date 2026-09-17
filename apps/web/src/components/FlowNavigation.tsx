import { useId, type ReactNode } from 'react';
import './flow-navigation.css';

/**
 * The step bar (or tab bar) of a flow.
 *
 * Two modes, one component:
 *
 *  - `steps`: a numbered chain the person walks in order. Every step stays
 *    reachable — a control is enforced by the step's own content, never by
 *    hiding the step — and the current one carries `aria-current="step"`.
 *    Numbering is derived from position here and nowhere else, so a screen
 *    cannot number its cards 1–6 while its tabs say 1–5, which is the
 *    confusion this component replaced.
 *  - tabs: `role="tablist"` with arrow-key movement, for peers that are not a
 *    sequence. With `vertical` they become a rail beside the panel: eight
 *    market-radar views did not fit on one horizontal line and wrapped into a
 *    second row that read as a different bar (2026-09-15). A rail also has
 *    room for the one line that says what each view holds.
 *
 * An item may opt out of numbering (`numbered: false`) to appear as a branch
 * beside the chain — the website package sits next to the eight campaign
 * steps without pretending to be step nine.
 */
export interface FlowItem {
  id: string;
  label: string;
  /** Shows a check mark: the step's artefact exists and is approved or chosen. */
  done?: boolean | undefined;
  /** Rendered without a number, after a small gap: a branch, not a step. */
  numbered?: boolean | undefined;
  /** Something in this step asks for attention (a re-review, a refusal). */
  attention?: boolean | undefined;
  panelId?: string | undefined;
  /** How many items the view holds, shown as a count beside the label. */
  count?: number | undefined;
  /** One line saying what the view holds. Rail only; there is no room in a bar. */
  hintNl?: string | undefined;
}

export function FlowNavigation(props: {
  items: readonly FlowItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  steps?: boolean | undefined;
  /** Lay the tabs out as a rail beside the panel instead of a bar above it. */
  vertical?: boolean | undefined;
}): ReactNode {
  const { items, value, onChange, label, steps = false, vertical = false } = props;
  const id = useId();
  // Position among the numbered items, computed up front rather than by a
  // counter mutated during render.
  const numbers = items.reduce<(number | null)[]>((acc, item) => {
    const numbered = steps && item.numbered !== false;
    const previous = acc.filter((entry) => entry !== null).length;
    acc.push(numbered ? previous + 1 : null);
    return acc;
  }, []);

  return (
    <nav aria-label={label}>
      <div
        className={`flow-navigation ${steps ? 'flow-navigation--steps' : vertical ? 'flow-navigation--rail' : 'flow-navigation--tabs'}`}
        role={steps ? undefined : 'tablist'}
        aria-orientation={steps ? undefined : vertical ? 'vertical' : undefined}
      >
        {items.map((item, index) => {
          const stepNumber = numbers[index] ?? null;
          const numbered = stepNumber !== null;
          const current = value === item.id;
          const className = [
            current ? 'is-current' : '',
            item.done === true ? 'is-done' : '',
            item.numbered === false ? 'is-branch' : '',
            item.attention === true && item.done !== true ? 'has-attention' : '',
          ]
            .filter((value) => value.length > 0)
            .join(' ');
          return (
            <button
              key={item.id}
              id={`${id}-${item.id}`}
              type="button"
              role={steps ? undefined : 'tab'}
              aria-controls={item.panelId}
              aria-selected={steps ? undefined : current}
              aria-current={steps && current ? 'step' : undefined}
              tabIndex={steps || current ? 0 : -1}
              className={className}
              onClick={() => {
                onChange(item.id);
              }}
              onKeyDown={(event) => {
                if (steps) {
                  return;
                }
                const forward = vertical ? 'ArrowDown' : 'ArrowRight';
                const back = vertical ? 'ArrowUp' : 'ArrowLeft';
                const offset = event.key === forward ? 1 : event.key === back ? -1 : 0;
                if (offset === 0 && event.key !== 'Home' && event.key !== 'End') {
                  return;
                }
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : (index + offset + items.length) % items.length;
                event.preventDefault();
                const target = items[next];
                if (target !== undefined) {
                  onChange(target.id);
                  document.getElementById(`${id}-${target.id}`)?.focus();
                }
              }}
            >
              {numbered && (
                <>
                  <span className="flow-step-number" aria-hidden="true">
                    {String(stepNumber)}
                  </span>
                  <span className="c360-visually-hidden">{`${String(stepNumber)}. `}</span>
                </>
              )}
              <span className="flow-rail__text">
                {item.label}
                {item.hintNl !== undefined && <span className="flow-rail__hint">{item.hintNl}</span>}
              </span>
              {item.count !== undefined && (
                <span className="flow-rail__count" aria-hidden="true">
                  {String(item.count)}
                </span>
              )}
              {item.count !== undefined && (
                <span className="c360-visually-hidden">{`, ${String(item.count)} item(s)`}</span>
              )}
              {item.done === true && (
                <span className="flow-check" aria-label="Afgerond">
                  {' ✓'}
                </span>
              )}
              {item.attention === true && item.done !== true && (
                <span className="flow-attention" aria-label="Vraagt aandacht">
                  {' •'}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
