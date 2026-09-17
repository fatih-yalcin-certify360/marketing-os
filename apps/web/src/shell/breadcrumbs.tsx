import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * The trail in the top bar: where you are, and every level above it as a link.
 *
 * The default trail follows the route; a page that knows more than the route
 * — a campaign's name, the step a person is on — sets its own trail with
 * `useBreadcrumbs` and the default returns when the page unmounts. The trail
 * is the way back: "Campagnes / <naam> / 3. Briefing" lets a person return to
 * the campaign or to the list in one click, from any depth.
 */
export interface Crumb {
  label: string;
  /** Absent on the current page and on a group that has no page of its own. */
  to?: string | undefined;
}

interface BreadcrumbState {
  override: Crumb[] | null;
  setOverride: (crumbs: Crumb[] | null) => void;
}

const BreadcrumbContext = createContext<BreadcrumbState>({
  override: null,
  setOverride: () => undefined,
});

export function BreadcrumbProvider(props: { children: ReactNode }): ReactNode {
  const [override, setOverride] = useState<Crumb[] | null>(null);
  const value = useMemo(() => ({ override, setOverride }), [override]);
  return <BreadcrumbContext.Provider value={value}>{props.children}</BreadcrumbContext.Provider>;
}

/** The trail to show: the page's own when it set one, else the route's. */
export function useTrail(pathname: string): Crumb[] {
  const { override } = useContext(BreadcrumbContext);
  return override ?? defaultCrumbs(pathname);
}

/**
 * Sets the trail for as long as the calling page is mounted. Compared by
 * content, so a page may call it on every render without churning the top bar.
 */
export function useBreadcrumbs(crumbs: readonly Crumb[]): void {
  const { setOverride } = useContext(BreadcrumbContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    setOverride(JSON.parse(key) as Crumb[]);
    return () => {
      setOverride(null);
    };
  }, [key, setOverride]);
}

const GROUP_KNOWLEDGE: Crumb = { label: 'Kennis & beheer' };

const ROUTE_CRUMBS: Readonly<Record<string, readonly Crumb[]>> = Object.freeze({
  '/werkruimte': [{ label: 'Werkruimte' }],
  '/kansen': [{ label: 'Marktradar', to: '/radar' }, { label: 'Bewaarde kansen' }],
  '/radar': [{ label: 'Marktradar' }],
  '/ai-visibility': [{ label: 'AI Visibility & GEO' }],
  '/campagnes': [{ label: 'Campagnes' }],
  '/content': [{ label: 'Content Studio' }],
  '/kalender': [{ label: 'Kalender & journeys' }],
  '/resultaten': [{ label: 'Resultaten' }],
  '/beheer/labels': [GROUP_KNOWLEDGE, { label: 'Labels & toegang' }],
  '/beheer/opleidingen': [GROUP_KNOWLEDGE, { label: 'Opleidingen' }],
  '/beheer/doelgroepen': [GROUP_KNOWLEDGE, { label: 'Doelgroepen' }],
  '/beheer/merk': [GROUP_KNOWLEDGE, { label: 'Merk & bronnen' }],
});

export function defaultCrumbs(pathname: string): Crumb[] {
  const known = ROUTE_CRUMBS[pathname];
  if (known !== undefined) return [...known];
  if (pathname.startsWith('/campagnes/')) {
    return [{ label: 'Campagnes', to: '/campagnes' }, { label: 'Campagne' }];
  }
  return [{ label: 'Certify360 Marketing OS' }];
}
