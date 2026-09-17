import { useEffect, type ReactNode } from 'react';
import type { LabelSummary } from '@c360/contracts';
import { buildLabelTheme, paletteFromBrandColors, type LabelPalette } from '@c360/ui';

/**
 * Applies the active label's palette to the document.
 *
 * Mounted once, above the shell. The variables land on `:root`, so every
 * screen — including anything rendered into a portal, and every stylesheet
 * still written against the old `--c360-*` names — picks them up without a
 * theme object being threaded through props.
 *
 * The palette comes from the label list, which carries each label's *approved*
 * brand colours. That matters for the switch: the colours are already in hand
 * when a label is picked, so the interface re-tints in one frame instead of
 * flashing the house palette while a brand query resolves.
 *
 * A label with no approved brand profile keeps the Certify360 house palette,
 * and the switcher says so in words. Nothing here invents a colour.
 */
export function LabelTheme(props: { label: LabelSummary | undefined; children: ReactNode }): ReactNode {
  const colors = props.label?.palette ?? null;

  useEffect(() => {
    const { palette } = paletteFromBrandColors(
      colors === null ? null : { primary: colors.primary, accent: colors.accent, onSurface: colors.ink },
    );
    const root = document.documentElement;
    for (const [name, value] of Object.entries(buildLabelTheme(palette))) {
      root.style.setProperty(name, value);
    }
    // The three values, not the object: `label.palette` is a fresh object on
    // every query result, and depending on it would rewrite the variables on
    // each refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors?.primary, colors?.accent, colors?.ink]);

  return props.children;
}

/** The palette a label actually paints with, for screens that show it. */
export function paletteOfLabel(label: LabelSummary | undefined): {
  palette: LabelPalette;
  /** True when the colours come from this label's own approved brand profile. */
  grounded: boolean;
} {
  const colors = label?.palette ?? null;
  return paletteFromBrandColors(
    colors === null ? null : { primary: colors.primary, accent: colors.accent, onSurface: colors.ink },
  );
}
