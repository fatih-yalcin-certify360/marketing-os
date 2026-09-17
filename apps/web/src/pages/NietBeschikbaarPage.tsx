import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ModuleAvailability, ProductArea } from '@c360/contracts';
import { AVAILABILITY_LABEL_NL } from '../shell/navigation.js';

/**
 * Honest placeholder for an area that is not built yet — pattern A.
 *
 * No widgets, no empty charts and no zeroes: only what the area will do, which
 * phase delivers it, and what already works today. An empty grid that looks
 * finished is worse than a page that says what is missing.
 */
export function NietBeschikbaarPage(props: {
  title: string;
  area: ProductArea;
  modules: readonly ModuleAvailability[];
}): ReactNode {
  const module = props.modules.find((entry) => entry.area === props.area);
  const status = module?.status ?? 'planned';

  return (
    <div className="os-page" style={{ maxWidth: 860 }}>
      <header className="os-page__head">
        <div className="os-page__head-text">
          <p className="os-eyebrow os-eyebrow--muted">Nog niet beschikbaar</p>
          <h1 className="c360-page-title">{props.title}</h1>
          <p className="c360-page-lead">
            {`${AVAILABILITY_LABEL_NL[status]}${module === undefined ? '' : ` · fase ${String(module.plannedPhase)}`}. Dit onderdeel staat in de navigatie omdat het gepland is, niet omdat het werkt.`}
          </p>
        </div>
      </header>

      <section className="os-panel os-panel--pad" aria-label={`${props.title} is nog niet beschikbaar`}>
        <h2 className="os-panel__title">Wat er wel is</h2>
        <p className="os-rowcard__body" style={{ marginTop: 6 }}>
          {module?.note ?? 'Dit onderdeel is nog niet beschikbaar in deze versie.'}
        </p>
        <p className="os-rowcard__body" style={{ marginTop: 8 }}>
          {props.area === 'kalender'
            ? 'Per campagne bestaat er een planning die rekent vanaf een startdatum die jij kiest — die is te vinden in de campagne zelf, bij Kanaalplan. Die schema’s zijn rekenwerk, geen voorspelling, en er wordt geen opleidingsdatum gelezen die niemand heeft bevestigd.'
            : 'Er wordt hier bewust geen voorbeeldinhoud getoond, zodat niets de indruk geeft dat het al werkt. Wat nu wel werkt, staat in de Werkruimte: de wachtrij, het fundament van dit label, het AI-budget en de achtergrondtaken.'}
        </p>
        <div className="c360-row" style={{ marginTop: 12 }}>
          <Link className="c360-button c360-button--primary" to="/campagnes">
            {props.area === 'kalender' ? 'Naar een campagneplanning' : 'Naar campagnes'}
          </Link>
          <Link className="c360-button c360-button--secondary" to="/werkruimte">
            Terug naar werkruimte
          </Link>
        </div>
      </section>
    </div>
  );
}
