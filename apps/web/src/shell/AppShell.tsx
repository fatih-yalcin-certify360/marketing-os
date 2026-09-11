import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { CurrentUser, LabelSummary, ModuleAvailability } from '@c360/contracts';
import { Badge } from '@c360/ui';
import { KNOWLEDGE_NAV, PRIMARY_NAV, availabilityFor, type NavItem } from './navigation.js';

/**
 * Application shell.
 *
 * Two honesty rules are enforced here rather than left to each page:
 *  - navigation items whose backing module is not finished are marked
 *    unavailable and carry the reason, instead of looking operational;
 *  - when a local development identity is in use, the top bar says so
 *    unmistakably, so a test session can never be mistaken for a real one.
 */
export function AppShell(props: {
  user: CurrentUser | undefined;
  labels: readonly LabelSummary[];
  activeLabel: LabelSummary | undefined;
  onLabelChange: (labelId: string) => void;
  modules: readonly ModuleAvailability[];
  breadcrumb: string;
  showDemoFlag: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="c360-app">
      <a className="c360-skip-link" href="#hoofdinhoud">
        Naar hoofdinhoud
      </a>

      <SidebarNav
        user={props.user}
        labels={props.labels}
        activeLabel={props.activeLabel}
        onLabelChange={props.onLabelChange}
        modules={props.modules}
      />

      <div className="c360-main">
        <header className="c360-topbar">
          <p className="c360-breadcrumb">{props.breadcrumb}</p>
          <div className="c360-topbar__flags">
            {props.user?.authMode === 'local' && (
              <Badge tone="amber">Lokale testidentiteit</Badge>
            )}
            <Badge tone="purple">Ontwikkelversie · fase 0</Badge>
            {props.showDemoFlag && <span className="c360-stat__caption">Demo-data</span>}
          </div>
        </header>

        <main className="c360-content" id="hoofdinhoud">
          {props.children}
        </main>
      </div>
    </div>
  );
}

function SidebarNav(props: {
  user: CurrentUser | undefined;
  labels: readonly LabelSummary[];
  activeLabel: LabelSummary | undefined;
  onLabelChange: (labelId: string) => void;
  modules: readonly ModuleAvailability[];
}): ReactNode {
  return (
    <nav className="c360-sidebar" aria-label="Hoofdnavigatie">
      <Link to="/werkruimte" className="c360-sidebar__brand">
        certify360
        <span className="c360-sidebar__brand-sub">MARKETING OS</span>
      </Link>

      <div className="c360-label-switch">
        <label className="c360-label-switch__caption" htmlFor="label-switch">
          Label
        </label>
        {props.labels.length === 0 ? (
          <p className="c360-sidebar__user-role" style={{ margin: 0 }}>
            Geen labeltoegang
          </p>
        ) : (
          <select
            id="label-switch"
            className="c360-label-switch__select"
            value={props.activeLabel?.id ?? ''}
            onChange={(event) => {
              props.onLabelChange(event.target.value);
            }}
          >
            {props.labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="c360-nav">
        {PRIMARY_NAV.map((item) => (
          <NavItemLink key={item.path} item={item} modules={props.modules} />
        ))}

        <p className="c360-nav__heading">KENNIS &amp; BEHEER</p>
        {KNOWLEDGE_NAV.map((item) => (
          <NavItemLink key={item.path} item={item} modules={props.modules} showDot={false} />
        ))}
      </div>

      <div className="c360-sidebar__footer">
        <span className="c360-avatar" aria-hidden="true">
          {initials(props.user?.displayName ?? '?')}
        </span>
        <span>
          <span className="c360-sidebar__user-name">{props.user?.displayName ?? 'Onbekend'}</span>
          <br />
          <span className="c360-sidebar__user-role">
            {props.activeLabel === undefined
              ? orgRoleLabel(props.user)
              : `${roleLabel(props.activeLabel.role)} · ${props.activeLabel.name}`}
          </span>
        </span>
      </div>
    </nav>
  );
}

function NavItemLink(props: {
  item: NavItem;
  modules: readonly ModuleAvailability[];
  /** The approved design shows status dots on the primary nav only. */
  showDot?: boolean;
}): ReactNode {
  const location = useLocation();
  const { status, note } = availabilityFor(props.item, props.modules);
  const isAvailable = status === 'available';
  const isActive = location.pathname === props.item.path;

  const className = [
    'c360-nav__item',
    isActive ? 'c360-nav__item--active' : '',
    isAvailable ? '' : 'c360-nav__item--unavailable',
  ]
    .filter((value) => value.length > 0)
    .join(' ');

  return (
    <NavLink
      to={props.item.path}
      className={className}
      // Stays focusable and reachable so a user can read why it is unavailable,
      // but is announced as unavailable rather than looking ready.
      aria-disabled={isAvailable ? undefined : true}
      title={isAvailable ? undefined : note}
    >
      {props.showDot !== false && <span className="c360-nav__dot" aria-hidden="true" />}
      <span className="c360-nav__label">{props.item.label}</span>
      {!isAvailable && (
        <span className="c360-nav__soon">
          NOG NIET
          <span className="c360-visually-hidden"> beschikbaar. {note}</span>
        </span>
      )}
    </NavLink>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter((part) => part.length > 0);
  const first = parts[0]?.[0] ?? '?';
  return first.toUpperCase();
}

const ROLE_LABELS: Record<string, string> = {
  label_manager: 'Labelbeheerder',
  label_editor: 'Redacteur',
  label_approver: 'Beoordelaar',
  label_viewer: 'Meelezer',
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

const ORG_ROLE_LABELS: Record<string, string> = {
  org_owner: 'Organisatiebeheerder',
  org_admin: 'Beheerder',
  org_member: 'Medewerker',
};

function orgRoleLabel(user: CurrentUser | undefined): string {
  if (user === undefined) {
    return '';
  }
  return ORG_ROLE_LABELS[user.orgRole] ?? user.orgRole;
}
