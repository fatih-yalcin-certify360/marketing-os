import { useEffect, type ReactNode } from 'react';
import { buildLabelTheme, paletteFromBrandColors } from '@c360/ui';
import { useBrand } from '../api/campaign-queries.js';

/**
 * Applies the active label's palette to the document.
 *
 * Mounted once, above the shell. The variables land on `:root` so every
 * screen — including anything rendered in a portal — picks them up without
 * threading a theme object through props.
 *
 * While the brand query is in flight the previously applied palette stays on
 * screen: repainting to the house palette and back would flash.
 */
export function LabelTheme(props: { labelId: string | undefined; children: ReactNode }): ReactNode {
  const brand = useBrand(props.labelId);
  const colors = brand.data?.approved?.colors ?? null;

  useEffect(() => {
    if (brand.isPending) {
      return;
    }
    const { palette } = paletteFromBrandColors(colors);
    const root = document.documentElement;
    const vars = buildLabelTheme(palette);
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
  }, [brand.isPending, colors?.primary, colors?.accent, colors?.onSurface]);

  return props.children;
}

/** Whether this label's colours come from its own approved brand profile. */
export function useLabelPaletteGrounded(labelId: string | undefined): boolean {
  const brand = useBrand(labelId);
  return paletteFromBrandColors(brand.data?.approved?.colors ?? null).grounded;
}
