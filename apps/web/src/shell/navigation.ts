import type { Availability, ModuleAvailability, ProductArea } from '@c360/contracts';

/**
 * Navigation, in the order and wording of the approved Certify360 design.
 *
 * Availability is *not* declared here — it comes from the server's
 * `moduleAvailability`, so the interface cannot claim an area works when the
 * backend has not shipped it.
 */
export interface NavItem {
  path: string;
  label: string;
  area: ProductArea;
}

export const PRIMARY_NAV: readonly NavItem[] = Object.freeze([
  { path: '/werkruimte', label: 'Werkruimte', area: 'werkruimte' },
  { path: '/radar', label: 'Marktradar', area: 'kansen' },
  { path: '/ai-visibility', label: 'AI Visibility', area: 'kansen' },
  { path: '/campagnes', label: 'Campagnes', area: 'campagnes' },
  { path: '/content', label: 'Content Studio', area: 'content' },
  { path: '/kalender', label: 'Kalender & journeys', area: 'kalender' },
  { path: '/resultaten', label: 'Resultaten', area: 'resultaten' },
]);

export const KNOWLEDGE_NAV: readonly NavItem[] = Object.freeze([
  { path: '/beheer/labels', label: 'Labels & toegang', area: 'kennis_beheer' },
  { path: '/beheer/opleidingen', label: 'Opleidingen', area: 'kennis_beheer' },
  { path: '/beheer/doelgroepen', label: 'Doelgroepen', area: 'kennis_beheer' },
  { path: '/beheer/merk', label: 'Merk & bronnen', area: 'kennis_beheer' },
]);

/**
 * Screens that exist and are backed by working endpoints in Phase 0.
 *
 * This is per *screen*, not per area, because the two do not always agree: the
 * `kennis_beheer` area is only partly built, yet its "Labels & toegang" screen
 * is fully functional. Resolving availability at screen level is what stops the
 * UI from either hiding something that works or offering something that does
 * not.
 */
const IMPLEMENTED_PATHS = new Set([
  '/werkruimte',
  '/kansen',
  '/radar',
  '/ai-visibility',
  '/campagnes',
  '/content',
  '/beheer/labels',
  '/beheer/opleidingen',
  '/beheer/merk',
]);

export function availabilityFor(
  item: NavItem,
  modules: readonly ModuleAvailability[],
): { status: Availability; note: string } {
  const module = modules.find((entry) => entry.area === item.area);

  if (IMPLEMENTED_PATHS.has(item.path)) {
    return { status: 'available', note: module?.note ?? '' };
  }

  // Not built: never report `available`, whatever the area as a whole says.
  const areaStatus = module?.status ?? 'planned';
  return {
    status: areaStatus === 'available' ? 'in_development' : areaStatus,
    note: module?.note ?? 'Dit onderdeel is nog niet beschikbaar.',
  };
}

export const AVAILABILITY_LABEL_NL: Readonly<Record<Availability, string>> = Object.freeze({
  available: 'Beschikbaar',
  in_development: 'In ontwikkeling',
  planned: 'Gepland',
});
