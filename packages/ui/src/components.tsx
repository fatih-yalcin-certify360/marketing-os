import type { ReactNode } from 'react';

/**
 * Accessible UI primitives shared by every screen.
 *
 * Accessibility is built in rather than bolted on: fields always associate a
 * label, hint and error with the control via ids, badges carry a text
 * equivalent instead of relying on colour alone, and progress reports its value
 * to assistive technology.
 */

export type Tone = 'purple' | 'amber' | 'green' | 'red' | 'neutral';

export function Card(props: {
  title?: string | undefined;
  action?: ReactNode;
  children: ReactNode;
  /** Renders the card as a labelled region so it appears in a landmark list. */
  ariaLabel?: string | undefined;
}): ReactNode {
  return (
    <section className="c360-card" aria-label={props.ariaLabel ?? props.title}>
      {(props.title !== undefined || props.action !== undefined) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--c360-space-3)',
            marginBottom: 'var(--c360-space-3)',
          }}
        >
          {props.title !== undefined && <h2 className="c360-card__title">{props.title}</h2>}
          {props.action}
        </header>
      )}
      {props.children}
    </section>
  );
}

export function Badge(props: { tone: Tone; children: ReactNode }): ReactNode {
  return <span className={`c360-badge c360-badge--${props.tone}`}>{props.children}</span>;
}

export function StatTile(props: {
  value: number | string;
  caption: string;
  tone: Tone;
  label: string;
}): ReactNode {
  const toneClass = props.tone === 'red' ? 'amber' : props.tone;
  return (
    <div className="c360-stat">
      <span className={`c360-stat__value c360-stat__value--${toneClass}`} aria-hidden="true">
        {typeof props.value === 'number' ? String(props.value).padStart(2, '0') : props.value}
      </span>
      {/* The number alone is meaningless to a screen reader out of context. */}
      <span className="c360-visually-hidden">{`${props.label}: ${String(props.value)}`}</span>
      <span className="c360-stat__caption">{props.caption}</span>
    </div>
  );
}

export function Button(props: {
  variant?: 'primary' | 'secondary' | 'ghost' | undefined;
  type?: 'button' | 'submit' | undefined;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
  children: ReactNode;
  /** Explains *why* the control is unavailable, for both mouse and keyboard. */
  title?: string | undefined;
  /** The action is in flight: announced to assistive technology, shown as a progress cursor. */
  busy?: boolean | undefined;
}): ReactNode {
  const variant = props.variant ?? 'secondary';
  return (
    <button
      type={props.type ?? 'button'}
      className={`c360-button c360-button--${variant}`}
      disabled={props.disabled ?? false}
      onClick={props.onClick}
      title={props.title}
      aria-busy={props.busy === true ? true : undefined}
    >
      {props.children}
    </button>
  );
}

export function Field(props: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (fieldProps: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean;
  }) => ReactNode;
}): ReactNode {
  const hintId = props.hint === undefined ? undefined : `${props.id}-hint`;
  const errorId = props.error === undefined ? undefined : `${props.id}-error`;
  const describedBy = [hintId, errorId].filter((value) => value !== undefined).join(' ');

  return (
    <div className="c360-field">
      <label className="c360-label" htmlFor={props.id}>
        {props.label}
      </label>
      {props.children({
        id: props.id,
        'aria-describedby': describedBy.length === 0 ? undefined : describedBy,
        'aria-invalid': props.error !== undefined,
      })}
      {props.hint !== undefined && (
        <p className="c360-field__hint" id={hintId}>
          {props.hint}
        </p>
      )}
      {props.error !== undefined && (
        <p className="c360-field__error" id={errorId} role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
}

export function Notice(props: {
  tone: 'info' | 'warning' | 'neutral';
  children: ReactNode;
  /** Set for messages that appear in response to an action. */
  live?: boolean | undefined;
}): ReactNode {
  return (
    <div
      className={`c360-notice c360-notice--${props.tone}`}
      role={props.live === true ? 'status' : undefined}
      aria-live={props.live === true ? 'polite' : undefined}
    >
      {props.children}
    </div>
  );
}

export function Progress(props: { percent: number; label: string }): ReactNode {
  const clamped = Math.min(100, Math.max(0, Math.round(props.percent)));
  return (
    <div
      className="c360-progress"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={props.label}
    >
      <div className="c360-progress__bar" style={{ width: `${String(clamped)}%` }} />
    </div>
  );
}
