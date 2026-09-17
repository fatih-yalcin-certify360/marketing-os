import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { CurrentUser, LabelSummary, ModuleAvailability } from '@c360/contracts';
import { Icon } from '@c360/ui';
import { KNOWLEDGE_NAV, PRIMARY_NAV, availabilityFor, type NavItem } from './navigation.js';
import type { Crumb } from './breadcrumbs.js';
import { NavIcon } from './nav-icons.js';
import { CommandPalette } from './CommandPalette.js';
import { BackgroundWork } from './BackgroundWork.js';
import { paletteOfLabel } from './LabelTheme.js';

/**
 * Application shell, 2026.
 *
 * A 56px icon rail with a click-to-open flyout, and a 48px top bar. The rail
 * is what makes the three-column screens possible: a campaign step, its
 * workspace and its context panel need every pixel the old 268px sidebar was
 * spending on words the user already knows.
 *
 * The colours are the *selected label's*. The rail is painted from that label's
 * ink, every filled control from its primary, and the switcher shows each
 * label's three colours so picking one is a visible choice rather than a
 * surprise.
 *
 * Three honesty rules are enforced here rather than left to each page:
 *  - a navigation item whose backing module is unfinished is marked and carries
 *    its reason, and is never hidden;
 *  - a local development identity is stated in the bar, so a test session
 *    cannot be mistaken for a real one;
 *  - a label with no approved brand profile is said to be using the Certify360
 *    house palette, rather than having a colour invented for it.
 */
export function AppShell(props: {
  user: CurrentUser | undefined;
  labels: readonly LabelSummary[];
  activeLabel: LabelSummary | undefined;
  onLabelChange: (labelId: string) => void;
  modules: readonly ModuleAvailability[];
  breadcrumb: readonly Crumb[];
  showDemoFlag: boolean;
  children: ReactNode;
}): ReactNode {
  const [navOpen, setNavOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ⌘K / Ctrl-K opens the screen finder from anywhere, except while the user is
  // typing into a field — a shortcut that steals a keystroke mid-sentence is
  // worse than no shortcut.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        setNavOpen(false);
        setLabelsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="os-app">
      <a className="c360-skip-link" href="#hoofdinhoud">
        Naar hoofdinhoud
      </a>

      <nav className="os-rail" aria-label="Hoofdnavigatie">
        <Link to="/werkruimte" className="os-rail__logo" title="Certify360 Marketing OS">
          360
          <span className="c360-visually-hidden">Certify360 Marketing OS — naar de werkruimte</span>
        </Link>

        {PRIMARY_NAV.map((item) => (
          <RailItem key={item.path} item={item} modules={props.modules} />
        ))}

        <span className="os-rail__rule" aria-hidden="true" />

        {KNOWLEDGE_NAV.map((item) => (
          <RailItem key={item.path} item={item} modules={props.modules} />
        ))}

        <div className="os-rail__foot">
          <button
            type="button"
            className="os-rail__item"
            aria-label={navOpen ? 'Navigatie inklappen' : 'Navigatie uitklappen'}
            aria-expanded={navOpen}
            title={navOpen ? 'Navigatie inklappen' : 'Navigatie uitklappen'}
            onClick={() => {
              setNavOpen((open) => !open);
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
          <span className="os-avatar" title={userTitle(props.user, props.activeLabel)}>
            {initials(props.user?.displayName ?? '?')}
            <span className="c360-visually-hidden">{userTitle(props.user, props.activeLabel)}</span>
          </span>
        </div>
      </nav>

      {navOpen && (
        <FlyoutNav
          modules={props.modules}
          onClose={() => {
            setNavOpen(false);
          }}
        />
      )}

      <div className="os-main">
        <header className="os-topbar">
          <nav aria-label="Kruimelpad" className="os-crumb-wrap">
            <ol className="os-crumb">
              {props.breadcrumb.map((crumb, index) => {
                const last = index === props.breadcrumb.length - 1;
                return (
                  <li key={`${String(index)}-${crumb.label}`}>
                    {index > 0 && (
                      <span aria-hidden="true" className="os-crumb__sep">
                        /
                      </span>
                    )}
                    {crumb.to !== undefined && !last ? (
                      <Link to={crumb.to}>{crumb.label}</Link>
                    ) : (
                      <span
                        className={last ? 'os-crumb__leaf' : undefined}
                        title={crumb.label}
                        aria-current={last ? 'page' : undefined}
                      >
                        {crumb.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>

          <span className="os-topbar__spacer" />

          <button
            type="button"
            className="os-search"
            title="Ga naar een scherm"
            onClick={() => {
              setPaletteOpen(true);
            }}
          >
            <Icon name="search" size={13} />
            <span>Ga naar…</span>
            <span className="os-search__key">⌘K</span>
          </button>

          <LabelSwitch
            labels={props.labels}
            activeLabel={props.activeLabel}
            open={labelsOpen}
            onToggle={() => {
              setLabelsOpen((open) => !open);
            }}
            onClose={() => {
              setLabelsOpen(false);
            }}
            onChange={props.onLabelChange}
          />

          {props.user?.authMode === 'local' && (
            <span className="os-flag os-flag--warn" title="Lokale testidentiteit · alleen ontwikkeling">
              <span className="os-flag__dot" aria-hidden="true" />
              Testidentiteit
            </span>
          )}
          {props.showDemoFlag && (
            <span className="os-flag" title="Dit label bevat gegevens die als demo zijn gemarkeerd">
              Demo-data
            </span>
          )}
        </header>

        <main className="os-content" id="hoofdinhoud">
          {props.children}
        </main>
      </div>

      {/* Top right, above everything: what finished while you were elsewhere. */}
      <BackgroundWork labelId={props.activeLabel?.id} />

      {paletteOpen && (
        <CommandPalette
          modules={props.modules}
          onClose={() => {
            setPaletteOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** A sub-item matches on its `tab`; a parent matches on the path alone. */
export function matchesLocation(path: string, pathname: string, search: string): boolean {
  const [base, query] = path.split('?');
  if (pathname !== base) return false;
  const wanted = new URLSearchParams(query ?? '').get('tab');
  return wanted === null || new URLSearchParams(search).get('tab') === wanted;
}

function RailItem(props: { item: NavItem; modules: readonly ModuleAvailability[] }): ReactNode {
  const location = useLocation();
  const { status, note } = availabilityFor(props.item, props.modules);
  const available = status === 'available';
  const active = matchesLocation(props.item.path, location.pathname, location.search);

  return (
    <NavLink
      to={props.item.path}
      className={`os-rail__item${available ? '' : ' os-rail__item--unavailable'}`}
      aria-current={active ? 'page' : undefined}
      // Stays reachable so the user can read *why* it is unavailable.
      aria-disabled={available ? undefined : true}
      aria-label={available ? props.item.label : `${props.item.label}, nog niet beschikbaar. ${note}`}
      title={available ? props.item.label : `${props.item.label} — ${note}`}
    >
      <NavIcon path={props.item.path.split('?')[0] ?? props.item.path} />
    </NavLink>
  );
}

function FlyoutNav(props: { modules: readonly ModuleAvailability[]; onClose: () => void }): ReactNode {
  return (
    <div className="os-flyout">
      <div className="os-flyout__head">
        <span className="os-flyout__heading">MARKETING OS</span>
        <button type="button" className="os-flyout__close" aria-label="Navigatie sluiten" onClick={props.onClose}>
          <Icon name="close" size={15} />
        </button>
      </div>

      <p className="os-flyout__heading">WERK</p>
      {PRIMARY_NAV.map((item) => (
        <FlyoutItem key={item.path} item={item} modules={props.modules} onNavigate={props.onClose} />
      ))}

      <p className="os-flyout__heading">KENNIS &amp; BEHEER</p>
      {KNOWLEDGE_NAV.map((item) => (
        <FlyoutItem key={item.path} item={item} modules={props.modules} onNavigate={props.onClose} />
      ))}
    </div>
  );
}

function FlyoutItem(props: {
  item: NavItem;
  modules: readonly ModuleAvailability[];
  onNavigate: () => void;
}): ReactNode {
  const location = useLocation();
  const { status, note } = availabilityFor(props.item, props.modules);
  const available = status === 'available';
  const active = matchesLocation(props.item.path, location.pathname, location.search);

  return (
    <>
      <NavLink
        to={props.item.path}
        className={`os-flyout__item${active ? ' os-flyout__item--active' : ''}`}
        aria-disabled={available ? undefined : true}
        title={available ? undefined : note}
        onClick={props.onNavigate}
      >
        <NavIcon path={props.item.path.split('?')[0] ?? props.item.path} size={15} />
        <span className="os-flyout__label">{props.item.label}</span>
        {!available && (
          <span className="os-flyout__soon">
            NOG NIET
            <span className="c360-visually-hidden"> beschikbaar. {note}</span>
          </span>
        )}
      </NavLink>
      {props.item.children?.map((child) => (
        <FlyoutChild key={child.path} item={child} onNavigate={props.onNavigate} />
      ))}
    </>
  );
}

function FlyoutChild(props: { item: NavItem; onNavigate: () => void }): ReactNode {
  const location = useLocation();
  const active = matchesLocation(props.item.path, location.pathname, location.search);
  return (
    <NavLink
      to={props.item.path}
      className={`os-flyout__item os-flyout__item--sub${active ? ' os-flyout__item--active' : ''}`}
      onClick={props.onNavigate}
    >
      <span className="os-flyout__label">{props.item.label}</span>
    </NavLink>
  );
}

/**
 * The label switch.
 *
 * Each row carries the label's three approved colours, because choosing a label
 * re-tints the whole interface; a switch that hid that would make the change
 * look like a bug. A label with no approved profile says so and shows the
 * Certify360 house colours it will actually use.
 */
function LabelSwitch(props: {
  labels: readonly LabelSummary[];
  activeLabel: LabelSummary | undefined;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (labelId: string) => void;
}): ReactNode {
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    const onDown = (event: MouseEvent): void => {
      if (wrapRef.current !== null && !wrapRef.current.contains(event.target as Node)) {
        props.onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [props.open, props]);

  if (props.labels.length === 0) {
    return <span className="os-flag os-flag--warn">Geen labeltoegang</span>;
  }

  return (
    <div className="os-labelwrap" ref={wrapRef}>
      <button
        type="button"
        className="os-labelchip"
        aria-expanded={props.open}
        aria-controls={menuId}
        aria-haspopup="menu"
        onClick={props.onToggle}
      >
        <span className="os-labelchip__mark" aria-hidden="true">
          {(props.activeLabel?.name ?? '?').slice(0, 2).toUpperCase()}
        </span>
        <span className="os-labelchip__name">{props.activeLabel?.name ?? 'Kies een label'}</span>
        <Icon name="chevron-down" size={13} />
      </button>

      {props.open && (
        <div className="os-labelmenu" id={menuId} role="menu">
          <p className="os-labelmenu__caption">LABEL</p>
          {props.labels.map((label) => {
            const { palette, grounded } = paletteOfLabel(label);
            const current = label.id === props.activeLabel?.id;
            return (
              <button
                key={label.id}
                type="button"
                role="menuitem"
                className={`os-labelmenu__item${current ? ' os-labelmenu__item--current' : ''}`}
                title={
                  grounded
                    ? `${label.name} — kleuren uit het eigen goedgekeurde merkprofiel`
                    : `${label.name} — geen goedgekeurd merkprofiel, dus het Certify360-huispalet`
                }
                onClick={() => {
                  props.onChange(label.id);
                  props.onClose();
                }}
              >
                <span className="os-swatch" aria-hidden="true">
                  <span style={{ background: palette.primary }} />
                  <span style={{ background: palette.accent }} />
                  <span style={{ background: palette.ink }} />
                </span>
                {/* The name and the colours, and nothing else. Where the
                    palette comes from is a fact worth keeping, so it stays in
                    the row's title and for screen readers rather than as a
                    second line of explanation nobody reads twice. */}
                <span className="os-labelmenu__text">
                  <span className="os-labelmenu__name">{label.name}</span>
                </span>
                {current && <Icon name="check" size={15} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter((part) => part.length > 0);
  return (parts[0]?.[0] ?? '?').toUpperCase();
}

const ROLE_LABELS: Record<string, string> = {
  label_manager: 'Labelbeheerder',
  label_editor: 'Redacteur',
  label_approver: 'Beoordelaar',
  label_viewer: 'Meelezer',
};

const ORG_ROLE_LABELS: Record<string, string> = {
  org_owner: 'Organisatiebeheerder',
  org_admin: 'Beheerder',
  org_member: 'Medewerker',
};

function userTitle(user: CurrentUser | undefined, label: LabelSummary | undefined): string {
  const name = user?.displayName ?? 'Onbekend';
  if (label !== undefined) {
    return `${name} · ${ROLE_LABELS[label.role] ?? label.role} bij ${label.name}`;
  }
  if (user === undefined) return name;
  return `${name} · ${ORG_ROLE_LABELS[user.orgRole] ?? user.orgRole}`;
}
