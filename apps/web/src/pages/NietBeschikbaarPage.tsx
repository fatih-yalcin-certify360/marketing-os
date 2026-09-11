import type { ReactNode } from 'react';
import type { ModuleAvailability, ProductArea } from '@c360/contracts';
import { Card, Notice } from '@c360/ui';
import { AVAILABILITY_LABEL_NL } from '../shell/navigation.js';

/**
 * Honest placeholder for an area that is not built yet.
 *
 * It deliberately shows no widgets, no empty charts and no zeroes — only what
 * the area will do, which phase delivers it, and what already works today.
 * Requirement 4: an unfinished area must not be presented as working.
 */
export function NietBeschikbaarPage(props: {
  title: string;
  area: ProductArea;
  modules: readonly ModuleAvailability[];
}): ReactNode {
  const module = props.modules.find((entry) => entry.area === props.area);
  const status = module?.status ?? 'planned';

  return (
    <>
      <header>
        <h1 className="c360-page-title">{props.title}</h1>
        <p className="c360-page-lead">
          {`${AVAILABILITY_LABEL_NL[status]}${module === undefined ? '' : ` · fase ${String(module.plannedPhase)}`}`}
        </p>
      </header>

      <Card ariaLabel={`${props.title} is nog niet beschikbaar`}>
        <Notice tone="info">
          {module?.note ?? 'Dit onderdeel is nog niet beschikbaar in deze versie.'}
        </Notice>
        <p className="c360-card__hint" style={{ marginTop: 'var(--c360-space-4)' }}>
          Dit onderdeel is nog niet gebouwd. Er wordt hier bewust geen voorbeeldinhoud getoond, zodat
          niets de indruk geeft dat het al werkt. Wat nu wel werkt, vind je in de Werkruimte:
          labeltoegang, budget en achtergrondtaken.
        </p>
      </Card>
    </>
  );
}
