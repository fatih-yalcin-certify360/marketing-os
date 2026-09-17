import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { CurrentUser, LabelSummary, ModuleAvailability } from '@c360/contracts';
import { Icon } from '@c360/ui';
import { KNOWLEDGE_NAV, PRIMARY_NAV, availabilityFor, type NavItem } from './navigation.js';
import type { Crumb } from './breadcrumbs.js';
import { AreaIcon } from './nav-icons.js';
import './shell-2026.css';

/**
 * Application shell, 2026.
 *
 * Three changes against the previous rail:
 *  - navigation collapses to a 56px icon rail with a click-to-open flyout,
 *    which gives the campaign flow room for three columns;
 *  - the top bar is 48px and every control in it is a fixed-height pill that
 *    may not wrap, so a long label name truncates rather than breaking the row;
 *  - the label switch shows each label's palette, because the interface
 *    colours follow the selected label (see LabelTheme.tsx).
 *
 * The two honesty rules are unchanged: an unfinished area is marked and
 * carries its reason, and a local development identity is stated in the bar.
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

  return (
    <div className="os-app">
      <a className="c360-skip-link" href="#hoofdinhoud">
        Naar hoofdinhoud
      </a>

      <nav className="os-rail" aria-label="Hoofdnavigatie">
        <Link to="/werkruimte" className="os-rail__logo" title="Certify360 Marketing OS">
          360
        </Link>

        {PRIMARY_NAV.map((item) => (
          <RailItem key={item.path} item={item} modules={props.modules} />
        ))}

        <button
          type="button"
          className="os-rail__item"
          aria-label="Kennis en beheer"
          title="Kennis &amp; beheer"
          onClick={() => setNavOpen(true)}
        >
          <AreaIcon area="kennis_beheer" />
        </button>

        <div className="os-rail__foot">
          <button
            type="button"
            className="os-rail__item"
            aria-label={navOpen ? 'Navigatie inklappen' : 'Navigatie uitklappen'}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
          <span className="c360-avatar" title={props.user?.displayName ?? 'Onbekend'}>
            {initials(props.user?.displayName ?? '?')}
          </span>
        </div>
      </nav>

      {navOpen && (
        <div className="os-flyout">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="os-flyout__heading">MARKETING OS</span>
            <button type="button" className="os-flyout__item" style={{ width: 'auto' }} aria-label="Sluiten" onClick={() => setNavOpen(false)}>
              <Icon name="close" size={15} />
            </button>
          </div>

          <p className="os-flyout__heading">WERK</p>
          {PRIMARY_NAV.map((item) => (
            <FlyoutItem key={item.path} item={item} modules={props.modules} onNavigate={() => setNavOpen(false)} />
          ))}

          <p className="os-flyout__heading">KENNIS &amp; BEHEER</p>
          {KNOWLEDGE_NAV.map((item) => (
            <FlyoutItem key={item.path} item={item} modules={props.modules} onNavigate={() => setNavOpen(false)} />
          ))}
        </div>
      )}

      <div className="os-main">
        <header className="os-topbar">
          <nav aria-label="Kruimelpad" style={{ minWidth: 0 }}>
            <ol className="os-crumb">
              {props.breadcrumb.map((crumb, index) => {
                const last = index === props.breadcrumb.length - 1;
                return (
                  <li key={`${String(index)}-${crumb.label}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    {index > 0 && <span aria-hidden="true" style={{ color: 'var(--n-br2)' }}>/</span>}
                    {crumb.to !== undefined && !last ? (
                      <Link to={crumb.to}>{crumb.label}</Link>
                    ) : (
                      <span className={last ? 'os-crumb__leaf' : undefined} aria-current={last ? 'page' : undefined}>
                        {crumb.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>

          <span className="os-topbar__spacer" />

          <button type="button" className="os-search" title="Zoek campagne, opleiding of bron">
            <Icon name="search" size={13} />
            <span>Zoeken</span>
            <span className="os-search__key">⌘K</span>
          </button>

          <div style={{ position: 'relative', flex: 'none' }}>
            <button type="button" className="os-labelchip" aria-expanded={labelsOpen} onClick={() => setLabelsOpen((open) => !open)}>
              <span className="os-labelchip__mark">{(props.activeLabel?.name ?? '?').slice(0, 2).toUpperCase()}</span>
              <span className="os-labelchip__name">{props.activeLabel?.name ?? 'Geen labeltoegang'}</span>
              <Icon name="chevron-down" size={13} />
            </button>

            {labelsOpen && (
              <div className="os-labelmenu" role="menu">
                <p className="c360-kv__term" style={{ margin: '6px 8px' }}>
                  LABEL · KLEUR VOLGT HET MERK
                </p>
                {props.labels.map((label) => (
                  <button
                    key={label.id}
                    type="button"
                    role="menuitem"
                    className="os-flyout__item"
                    style={{ color: 'var(--tx)', background: label.id === props.activeLabel?.id ? 'var(--lp-t1)' : 'transparent' }}
                    onClick={() => {
                      props.onLabelChange(label.id);
                      setLabelsOpen(false);
                    }}
                  >
                    <span className="os-flyout__label">{label.name}</span>
                    {label.id === props.activeLabel?.id && <Icon name="check" size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {props.user?.authMode === 'local' && (
            <span className="c360-badge c360-badge--amber" title="Lokale testidentiteit · ontwikkelversie">
              Testidentiteit
            </span>
          )}
          {props.showDemoFlag && <span className="c360-stat__caption">Demo-data</span>}
        </header>

        <main className="os-content" id="hoofdinhoud">
          {props.children}
        </main>
      </div>
    </div>
  );
}

function RailItem(props: { item: NavItem; modules: readonly ModuleAvailability[] }): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, note } = availabilityFor(props.item, props.modules);
  const available = status === 'available';
  const active = location.pathname === props.item.path.split('?')[0];

  return (
    <button
      type="button"
      className={`os-rail__item${available ? '' : ' os-rail__item--unavailable'}`}
      aria-current={active ? 'page' : undefined}
      aria-disabled={available ? undefined : true}
      aria-label={available ? props.item.label : `${props.item.label}, nog niet beschikbaar. ${note}`}
      title={available ? props.item.label : `${props.item.label} — ${note}`}
      onClick={() => navigate(props.item.path)}
    >
      <AreaIcon area={props.item.area} />
    </button>
  );
}

function FlyoutItem(props: {
  item: NavItem;
  modules: readonly ModuleAvailability[];
  onNavigate: () => void;
}): ReactNode {
  const { status, note } = availabilityFor(props.item, props.modules);
  const available = status === 'available';

  return (
    <>
      <NavLink
        to={props.item.path}
        className={({ isActive }) => `os-flyout__item${isActive ? ' os-flyout__item--active' : ''}`}
        aria-disabled={available ? undefined : true}
        title={available ? undefined : note}
        onClick={props.onNavigate}
      >
        <span className="os-flyout__label">{props.item.label}</span>
        {!available && (
          <span className="os-flyout__soon">
            NOG NIET
            <span className="c360-visually-hidden"> beschikbaar. {note}</span>
          </span>
        )}
      </NavLink>
      {props.item.children?.map((child) => (
        <NavLink
          key={child.path}
          to={child.path}
          className="os-flyout__item"
          style={{ paddingLeft: 22, fontSize: 12.5 }}
          onClick={props.onNavigate}
        >
          <span className="os-flyout__label">{child.label}</span>
        </NavLink>
      ))}
    </>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter((part) => part.length > 0);
  return (parts[0]?.[0] ?? '?').toUpperCase();
}
