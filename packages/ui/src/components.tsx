import { useId, type ReactNode } from 'react';

/**
 * Accessible UI primitives shared by every screen.
 *
 * Accessibility is built in rather than bolted on: fields always associate a
 * label, hint and error with the control via ids, badges carry a text
 * equivalent instead of relying on colour alone, and progress reports its value
 * to assistive technology.
 *
 * The 2026 pass added the page anatomy every screen now shares — a page
 * header with one primary action, tabs, section headers, empty and loading
 * states, a disclosure for explanatory text, a key–value list, a toolbar and
 * a small stroke-icon set — so a screen is assembled from the same parts and
 * reads the same way as the next one.
 */

export type Tone = 'purple' | 'amber' | 'green' | 'red' | 'neutral';

// ------------------------------------------------------------------ Icons ---

export type IconName =
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'arrow-right'
  | 'arrow-left'
  | 'plus'
  | 'search'
  | 'external'
  | 'copy'
  | 'alert'
  | 'info'
  | 'edit'
  | 'download'
  | 'refresh'
  | 'sparkles'
  | 'close'
  | 'link'
  | 'share'
  | 'clock';

const ICON_PATHS: Readonly<Record<IconName, string>> = Object.freeze({
  check: 'M5 12.5l4.5 4.5L19 7.5',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  external: 'M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  alert: 'M12 3l10 18H2L12 3zM12 10v4M12 17.5v.5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8v.5',
  edit: 'M4 20h4l11-11-4-4L4 16v4zM13.5 6.5l4 4',
  download: 'M12 4v11M7 10l5 5 5-5M4 19h16',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z',
  close: 'M6 6l12 12M18 6L6 18',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v13M8 7l4-4 4 4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
});

/** A 16px stroke icon in the current text colour. Decorative unless a label is given. */
export function Icon(props: { name: IconName; size?: number | undefined; label?: string | undefined }): ReactNode {
  const size = props.size ?? 16;
  return (
    <svg
      className="c360-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props.label === undefined ? true : undefined}
      role={props.label === undefined ? undefined : 'img'}
      aria-label={props.label}
      focusable="false"
    >
      <path d={ICON_PATHS[props.name]} />
    </svg>
  );
}

// ------------------------------------------------------------------- Card ---

export function Card(props: {
  title?: string | undefined;
  /** One line under the title: what the card is for, not how it works. */
  description?: string | undefined;
  action?: ReactNode;
  children: ReactNode;
  /** Renders the card as a labelled region so it appears in a landmark list. */
  ariaLabel?: string | undefined;
  /** `muted`: canvas background, for secondary information; `accent`: a purple hairline for the one thing to do. */
  tone?: 'default' | 'muted' | 'accent' | undefined;
  padding?: 'md' | 'sm' | undefined;
}): ReactNode {
  const classes = [
    'c360-card',
    props.tone === 'muted' ? 'c360-card--muted' : '',
    props.tone === 'accent' ? 'c360-card--accent' : '',
    props.padding === 'sm' ? 'c360-card--sm' : '',
  ]
    .filter((value) => value.length > 0)
    .join(' ');
  return (
    <section className={classes} aria-label={props.ariaLabel ?? props.title}>
      {(props.title !== undefined || props.action !== undefined) && (
        <header className="c360-card__header">
          <div className="c360-card__heading">
            {props.title !== undefined && <h2 className="c360-card__title">{props.title}</h2>}
            {props.description !== undefined && <p className="c360-card__hint">{props.description}</p>}
          </div>
          {props.action !== undefined && <div className="c360-card__action">{props.action}</div>}
        </header>
      )}
      {props.children}
    </section>
  );
}

// ------------------------------------------------------------------ Badge ---

export function Badge(props: { tone: Tone; children: ReactNode; icon?: IconName | undefined }): ReactNode {
  return (
    <span className={`c360-badge c360-badge--${props.tone}`}>
      {props.icon !== undefined && <Icon name={props.icon} size={12} />}
      {props.children}
    </span>
  );
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

// ----------------------------------------------------------------- Button ---

export function Button(props: {
  variant?: 'primary' | 'secondary' | 'ghost' | undefined;
  type?: 'button' | 'submit' | undefined;
  size?: 'md' | 'sm' | undefined;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
  children: ReactNode;
  /** A leading stroke icon; decorative, the text carries the meaning. */
  icon?: IconName | undefined;
  iconAfter?: IconName | undefined;
  /** Explains *why* the control is unavailable, for both mouse and keyboard. */
  title?: string | undefined;
  /** The action is in flight: announced to assistive technology, shown as a progress cursor. */
  busy?: boolean | undefined;
  /**
   * For a button that shows or hides a region. Declared here because JSX does
   * not type-check hyphenated attributes: an `aria-expanded` passed to a
   * component that does not forward it is silently dropped, which is how a
   * disclosure button reached the browser without saying what it disclosed.
   */
  'aria-expanded'?: boolean | undefined;
  'aria-controls'?: string | undefined;
  'aria-label'?: string | undefined;
  /**
   * One extra class, for a button a layout needs to place or hide.
   *
   * Deliberately additive: the component keeps its own classes, so a caller
   * cannot accidentally strip the button's appearance while positioning it.
   */
  className?: string | undefined;
}): ReactNode {
  const variant = props.variant ?? 'secondary';
  return (
    <button
      type={props.type ?? 'button'}
      className={`c360-button c360-button--${variant}${props.size === 'sm' ? ' c360-button--sm' : ''}${props.className === undefined ? '' : ` ${props.className}`}`}
      disabled={props.disabled ?? false}
      onClick={props.onClick}
      title={props.title}
      aria-busy={props.busy === true ? true : undefined}
      aria-expanded={props['aria-expanded']}
      aria-controls={props['aria-controls']}
      aria-label={props['aria-label']}
    >
      {props.icon !== undefined && <Icon name={props.icon} />}
      {props.children}
      {props.iconAfter !== undefined && <Icon name={props.iconAfter} />}
    </button>
  );
}

// ------------------------------------------------------------------ Field ---

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

// ----------------------------------------------------------------- Notice ---

export function Notice(props: {
  tone: 'info' | 'warning' | 'neutral';
  children: ReactNode;
  /** Set for messages that appear in response to an action. */
  live?: boolean | undefined;
}): ReactNode {
  const icon: IconName = props.tone === 'warning' ? 'alert' : props.tone === 'info' ? 'info' : 'check';
  return (
    <div
      className={`c360-notice c360-notice--${props.tone}`}
      role={props.live === true ? 'status' : undefined}
      aria-live={props.live === true ? 'polite' : undefined}
    >
      <span className="c360-notice__icon">
        <Icon name={icon} />
      </span>
      <div className="c360-notice__body">{props.children}</div>
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

// ------------------------------------------------------------ Page header ---

/**
 * The top of every screen: what this is, one line on why, and the one
 * primary action. `meta` holds badges and facts about the object (a
 * campaign's objective, a course's state); `actions` holds at most one primary
 * button and a few secondary ones.
 */
export function PageHeader(props: {
  title: string;
  eyebrow?: string | undefined;
  lead?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** A smaller title for an object page (a campaign), where the name can be long. */
  size?: 'lg' | 'md' | undefined;
}): ReactNode {
  return (
    <header className={`c360-page-header${props.size === 'md' ? ' c360-page-header--md' : ''}`}>
      <div className="c360-page-header__text">
        {props.eyebrow !== undefined && <p className="c360-eyebrow">{props.eyebrow}</p>}
        <h1 className="c360-page-title">{props.title}</h1>
        {props.lead !== undefined && <p className="c360-page-lead">{props.lead}</p>}
        {props.meta !== undefined && <div className="c360-page-header__meta">{props.meta}</div>}
      </div>
      {props.actions !== undefined && <div className="c360-page-header__actions">{props.actions}</div>}
    </header>
  );
}

// -------------------------------------------------------------------- Tabs ---

export interface TabItem {
  id: string;
  label: string;
  /** A count shown after the label; the tab reads "Kansen (4)". */
  count?: number | undefined;
  /** A small marker: something in this tab wants attention. */
  attention?: boolean | undefined;
  panelId?: string | undefined;
}

/**
 * Underline tabs for peers that are not a sequence. Arrow keys move between
 * tabs; the panel is the caller's, marked with `role="tabpanel"`.
 */
export function Tabs(props: {
  label: string;
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  size?: 'md' | 'sm' | undefined;
}): ReactNode {
  const id = useId();
  const { items, value, onChange } = props;
  return (
    <div className={`c360-tabs${props.size === 'sm' ? ' c360-tabs--sm' : ''}`} role="tablist" aria-label={props.label}>
      {items.map((item, index) => {
        const current = item.id === value;
        return (
          <button
            key={item.id}
            id={`${id}-${item.id}`}
            type="button"
            role="tab"
            className={`c360-tab${current ? ' c360-tab--current' : ''}`}
            aria-selected={current}
            aria-controls={item.panelId}
            tabIndex={current ? 0 : -1}
            onClick={() => {
              onChange(item.id);
            }}
            onKeyDown={(event) => {
              const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (offset === 0 && event.key !== 'Home' && event.key !== 'End') return;
              event.preventDefault();
              const next =
                event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + offset + items.length) % items.length;
              const target = items[next];
              if (target !== undefined) {
                onChange(target.id);
                document.getElementById(`${id}-${target.id}`)?.focus();
              }
            }}
          >
            {item.label}
            {item.count !== undefined && <span className="c360-tab__count">{String(item.count)}</span>}
            {item.attention === true && (
              <span className="c360-tab__attention" aria-label="Vraagt aandacht">
                •
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------- Section header ---

export function SectionHeader(props: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  /** `h2` for a page section, `h3` inside a card. */
  level?: 2 | 3 | undefined;
}): ReactNode {
  const Heading = props.level === 3 ? 'h3' : 'h2';
  return (
    <div className="c360-section-header">
      <div className="c360-section-header__text">
        <Heading className={props.level === 3 ? 'c360-section-title c360-section-title--sm' : 'c360-section-title'}>
          {props.title}
        </Heading>
        {props.hint !== undefined && <p className="c360-card__hint">{props.hint}</p>}
      </div>
      {props.action !== undefined && <div className="c360-section-header__action">{props.action}</div>}
    </div>
  );
}

// ------------------------------------------------------------ Empty state ---

/** Nothing here yet: says what would appear, and offers the way to make it. */
export function EmptyState(props: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: IconName | undefined;
  compact?: boolean | undefined;
}): ReactNode {
  return (
    <div className={`c360-empty${props.compact === true ? ' c360-empty--compact' : ''}`}>
      <span className="c360-empty__icon">
        <Icon name={props.icon ?? 'sparkles'} size={20} />
      </span>
      <p className="c360-empty__title">{props.title}</p>
      {props.body !== undefined && <p className="c360-empty__body">{props.body}</p>}
      {props.action !== undefined && <div className="c360-empty__action">{props.action}</div>}
    </div>
  );
}

// --------------------------------------------------------------- Skeleton ---

/** Placeholder lines while data loads; announced once as busy, never read line by line. */
export function Skeleton(props: { lines?: number | undefined; label?: string | undefined }): ReactNode {
  const lines = props.lines ?? 3;
  return (
    <div className="c360-skeleton" role="status" aria-busy="true" aria-label={props.label ?? 'Laden'}>
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className="c360-skeleton__line"
          style={{ width: `${String(index === lines - 1 ? 55 : 100 - (index % 3) * 12)}%` }}
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------- Disclosure ---

/**
 * Explanatory text behind a toggle. The screens used to open with three
 * paragraphs of how-it-works above the first control; that text is still
 * here, one click away, and the control is what a person sees first.
 */
export function Disclosure(props: {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean | undefined;
  /** `help`: the grey question-style toggle for "Hoe werkt dit?"; `plain`: a neutral section toggle. */
  tone?: 'help' | 'plain' | undefined;
}): ReactNode {
  return (
    <details className={`c360-disclosure${props.tone === 'plain' ? ' c360-disclosure--plain' : ''}`} open={props.defaultOpen}>
      <summary className="c360-disclosure__summary">
        <Icon name={props.tone === 'plain' ? 'chevron-right' : 'info'} />
        <span>{props.summary}</span>
      </summary>
      <div className="c360-disclosure__body">{props.children}</div>
    </details>
  );
}

// -------------------------------------------------------------- Key–value ---

export function KeyValue(props: {
  items: readonly { term: string; value: ReactNode; note?: ReactNode }[];
  columns?: 1 | 2 | 3 | undefined;
}): ReactNode {
  return (
    <dl className={`c360-kv c360-kv--${String(props.columns ?? 1)}`}>
      {props.items.map((item) => (
        <div key={item.term} className="c360-kv__item">
          <dt className="c360-kv__term">{item.term}</dt>
          <dd className="c360-kv__value">
            {item.value}
            {item.note !== undefined && <p className="c360-kv__note">{item.note}</p>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------- Toolbar ---

/** A row of filters and controls above a list; wraps on narrow screens. */
export function Toolbar(props: { children: ReactNode; ariaLabel?: string | undefined }): ReactNode {
  return (
    <div className="c360-toolbar" role={props.ariaLabel === undefined ? undefined : 'search'} aria-label={props.ariaLabel}>
      {props.children}
    </div>
  );
}
