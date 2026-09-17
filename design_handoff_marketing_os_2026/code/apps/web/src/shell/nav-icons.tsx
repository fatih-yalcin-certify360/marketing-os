import type { ReactNode } from 'react';
import type { ProductArea } from '@c360/contracts';

/**
 * One icon per navigation area, Lucide geometry at 1.9px stroke.
 *
 * The existing `Icon` component in @c360/ui carries the interface glyphs
 * (check, alert, info, search, chevron, sparkles) and those stay in use; this
 * file adds only the eight area marks the rail needs, which that set has no
 * entry for.
 */
const PATHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  werkruimte: ['M3 13h8V3H3zM13 9h8V3h-8zM13 21h8v-8h-8zM3 21h8v-6H3z'],
  kansen: [],
  campagnes: ['M3 11l18-6v12L3 14z', 'M11.6 16.8a3 3 0 1 1-5.8-1.6'],
  content: ['M12 2 2 7l10 5 10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
  kalender: ['M8 2v4M16 2v4M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
  resultaten: ['M3 3v18h18', 'M7 15v3M12 10v8M17 6v12'],
  kennis_beheer: ['M22 10 12 5 2 10l10 5z', 'M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5'],
});

export function AreaIcon(props: { area: ProductArea | 'kansen'; size?: number }): ReactNode {
  const size = props.size ?? 18;
  const paths = PATHS[props.area] ?? PATHS.werkruimte!;
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
      {props.area === 'kansen' ? (
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
