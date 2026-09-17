import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ModuleAvailability } from '@c360/contracts';
import { Icon } from '@c360/ui';
import { KNOWLEDGE_NAV, PRIMARY_NAV, availabilityFor, type NavItem } from './navigation.js';
import { NavIcon } from './nav-icons.js';

/**
 * Jump to a screen by typing its name.
 *
 * Deliberately a *screen* finder and nothing else. A box labelled "Zoeken" that
 * appears to search campaigns, courses and sources would be a promise the
 * product cannot keep — there is no search endpoint — and a control that looks
 * operational while doing nothing is the exact failure this interface is built
 * to avoid. So it says what it does: "Ga naar een scherm".
 *
 * An unfinished area is listed with its reason and cannot be chosen, the same
 * rule the navigation rail follows.
 */
interface Destination {
  path: string;
  label: string;
  /** The parent screen, for a sub-view like one Marktradar tab. */
  parent?: string;
  available: boolean;
  note: string;
}

function destinations(modules: readonly ModuleAvailability[]): Destination[] {
  const out: Destination[] = [];
  const add = (item: NavItem, parent?: string): void => {
    const { status, note } = availabilityFor(item, modules);
    out.push({
      path: item.path,
      label: item.label,
      ...(parent === undefined ? {} : { parent }),
      available: status === 'available',
      note,
    });
    for (const child of item.children ?? []) {
      add(child, item.label);
    }
  };
  for (const item of PRIMARY_NAV) add(item);
  for (const item of KNOWLEDGE_NAV) add(item);
  return out;
}

/**
 * Mounted only while it is open, so each opening starts on an empty query
 * without an effect that resets state after the first paint.
 */
export function CommandPalette(props: {
  modules: readonly ModuleAvailability[];
  onClose: () => void;
}): ReactNode {
  const navigate = useNavigate();
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Whatever had focus when the palette opened, so closing puts it back.
  const openerRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  const all = useMemo(() => destinations(props.modules), [props.modules]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return all;
    return all.filter((entry) =>
      `${entry.parent ?? ''} ${entry.label}`.toLowerCase().includes(needle),
    );
  }, [all, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const close = (): void => {
    props.onClose();
    openerRef.current?.focus();
  };

  const choose = (entry: Destination | undefined): void => {
    if (entry?.available !== true) return;
    close();
    void navigate(entry.path);
  };

  return (
    <div
      className="os-palette__overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="os-palette" role="dialog" aria-modal="true" aria-labelledby={inputId}>
        <div className="os-palette__field">
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            className="os-palette__input"
            placeholder="Ga naar een scherm"
            aria-label="Ga naar een scherm"
            aria-controls={listId}
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor((index) => Math.min(index + 1, matches.length - 1));
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor((index) => Math.max(index - 1, 0));
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                choose(matches[cursor]);
              }
            }}
          />
          <span className="os-palette__key">esc</span>
        </div>

        <ul className="os-palette__list" id={listId}>
          {matches.length === 0 && (
            <li className="os-palette__empty">Geen scherm met die naam.</li>
          )}
          {matches.map((entry, index) => (
            <li key={entry.path}>
              <button
                type="button"
                className={`os-palette__item${index === cursor ? ' os-palette__item--cursor' : ''}`}
                aria-disabled={entry.available ? undefined : true}
                onMouseEnter={() => {
                  setCursor(index);
                }}
                onClick={() => {
                  choose(entry);
                }}
              >
                <NavIcon path={entry.path.split('?')[0] ?? entry.path} size={15} />
                <span className="os-palette__label">
                  {entry.parent !== undefined && (
                    <span className="os-palette__parent">{entry.parent} · </span>
                  )}
                  {entry.label}
                </span>
                {!entry.available && <span className="os-palette__soon">{entry.note}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
