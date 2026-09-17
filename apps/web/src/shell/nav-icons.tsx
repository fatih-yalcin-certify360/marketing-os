import type { ReactNode } from 'react';

/**
 * One mark per navigation destination, Lucide geometry at 1.9px stroke.
 *
 * Keyed by *path*, not by `ProductArea`: Marktradar and AI Visibility share the
 * area `kansen`, and in a 56px icon rail two identical glyphs would be two
 * unlabelled buttons that look like the same screen. The area is the fallback
 * for anything the map does not name, so a new nav entry gets a mark rather
 * than a blank square.
 *
 * The interface glyphs (check, alert, info, search, chevron, sparkles) stay in
 * `Icon` from @c360/ui; this file adds only the destination marks that set has
 * no entry for. No emoji anywhere.
 */
const PATHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '/werkruimte': ['M3 13h8V3H3zM13 9h8V3h-8zM13 21h8v-8h-8zM3 21h8v-6H3z'],
  '/ai-visibility': [
    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z',
    'M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z',
  ],
  '/campagnes': ['M3 11l18-6v12L3 14z', 'M11.6 16.8a3 3 0 1 1-5.8-1.6'],
  '/content': ['M12 2 2 7l10 5 10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
  '/kalender': [
    'M8 2v4M16 2v4M3 10h18',
    'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  ],
  '/resultaten': ['M3 3v18h18', 'M7 15v3M12 10v8M17 6v12'],
  '/beheer/labels': ['M3 7h7l4 5-4 5H3z', 'M14 7h7v10h-7'],
  '/beheer/opleidingen': ['M22 10 12 5 2 10l10 5z', 'M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5'],
  '/beheer/doelgroepen': [
    'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    'M22 20v-2a4 4 0 0 0-3-3.9',
    'M16 3.2a3.5 3.5 0 0 1 0 6.6',
  ],
  '/beheer/merk': [
    'M12 3a9 9 0 0 0 0 18 2.2 2.2 0 0 0 1.7-3.6 2.2 2.2 0 0 1 1.7-3.6H18a3 3 0 0 0 3-3 9 9 0 0 0-9-7.8z',
    'M7.5 11.5v.01M10 7.5v.01M14.5 7.5v.01',
  ],
  kennis_beheer: ['M22 10 12 5 2 10l10 5z', 'M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5'],
});

/** The radar mark, drawn from circles rather than a path. */
const RADAR_KEYS = new Set(['/radar', '/kansen', 'kansen']);

export function NavIcon(props: { path: string; size?: number }): ReactNode {
  const size = props.size ?? 18;
  const paths = PATHS[props.path];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {RADAR_KEYS.has(props.path) || paths === undefined ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.4" />
        </>
      ) : (
        paths.map((d) => <path key={d} d={d} />)
      )}
    </svg>
  );
}
