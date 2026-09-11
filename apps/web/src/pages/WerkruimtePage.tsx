import type { ReactNode } from 'react';
import type { LabelSummary, WorkspaceOverview } from '@c360/contracts';
import { Badge, Card, Notice, StatTile } from '@c360/ui';
import { useBudget, useWorkspace } from '../api/queries.js';
import { JobsPanel } from './JobsPanel.js';
import { ErrorState, LoadingState } from '../components/states.js';

/**
 * Werkruimte.
 *
 * Every figure comes from the server. Where a Phase 1 module has not landed,
 * the card says what is missing instead of showing a number that would look
 * like a measurement.
 */
export function WerkruimtePage(props: { label: LabelSummary | undefined }): ReactNode {
  const workspace = useWorkspace(props.label?.id);
  const budget = useBudget(props.label?.id);

  if (props.label === undefined) {
    return (
      <Notice tone="warning">
        Je hebt nog geen toegang tot een label. Vraag een labelbeheerder om je toe te voegen.
      </Notice>
    );
  }

  if (workspace.isPending) {
    return <LoadingState label="Werkruimte wordt geladen" />;
  }
  if (workspace.isError) {
    return (
      <ErrorState
        message={workspace.error.userMessage}
        requestId={workspace.error.requestId}
        onRetry={() => void workspace.refetch()}
      />
    );
  }

  const overview: WorkspaceOverview = workspace.data;

  return (
    <>
      <header>
        <h1 className="c360-page-title">{`${salutation()}, ${overview.greetingName}.`}</h1>
        <p className="c360-page-lead">
          Dit is de stand van zaken voor {overview.labelName}. Onderdelen die nog niet klaar zijn,
          staan als zodanig aangegeven.
        </p>
      </header>

      <div className="c360-grid-3">
        <Card ariaLabel="Klaar voor review">
          <p className="c360-card__title">Klaar voor review</p>
          <StatTile
            value={overview.counters.readyForReview}
            caption="Content wacht op beoordeling"
            tone="purple"
            label="Klaar voor review"
          />
        </Card>
        <Card ariaLabel="Actie nodig">
          <p className="c360-card__title">Actie nodig</p>
          <StatTile
            value={overview.counters.actionRequired}
            caption="Broncontrole of afgebroken taken"
            tone="amber"
            label="Actie nodig"
          />
        </Card>
        <Card ariaLabel="Gepland deze week">
          <p className="c360-card__title">Gepland deze week</p>
          <StatTile
            value={overview.counters.plannedThisWeek}
            caption="Planning volgt in fase 3"
            tone="green"
            label="Gepland deze week"
          />
        </Card>
      </div>

      <div className="c360-grid-main">
        <div className="c360-stack">
          <h2 className="c360-section-title">Beslissingen &amp; voortgang</h2>
          <Card ariaLabel="Beslissingen en voortgang">
            {overview.attention.length === 0 ? (
              <Notice tone="neutral">
                Er staat niets open. Zodra campagnes en content live gaan (fase 1 en 2), verschijnen
                hier de items die je aandacht nodig hebben.
              </Notice>
            ) : (
              <ul className="c360-list">
                {overview.attention.map((item, index) => (
                  <li className="c360-list__item" key={`${item.kind}-${String(index)}`}>
                    <div>
                      <p className="c360-list__title">{item.title}</p>
                      <p className="c360-list__subtitle">{item.subtitle}</p>
                    </div>
                    <Badge tone={item.badgeTone}>{item.badge}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <JobsPanel label={props.label} />
        </div>

        <div className="c360-stack">
          <Card title="Fundament van dit label" ariaLabel="Fundament van dit label">
            <dl className="c360-definition">
              <div>
                <dt className="c360-definition__term">Merkprofiel</dt>
                <dd className="c360-definition__value">
                  {overview.readiness.hasApprovedBrandProfile
                    ? 'Goedgekeurd'
                    : 'Nog niet vastgelegd'}
                  <p className="c360-definition__note">
                    Merkprofiel vastleggen komt in fase 1.
                  </p>
                </dd>
              </div>
              <div>
                <dt className="c360-definition__term">Opleidingen</dt>
                <dd className="c360-definition__value">
                  {`${String(overview.readiness.confirmedCourseCount)} gecontroleerd`}
                  <p className="c360-definition__note">
                    {`${String(overview.readiness.unconfirmedCourseCount)} nog te controleren. Opleidingskaart komt in fase 1.`}
                  </p>
                </dd>
              </div>
              <div>
                <dt className="c360-definition__term">Doelgroepen</dt>
                <dd className="c360-definition__value">
                  {`${String(overview.readiness.approvedPersonaCount)} goedgekeurd`}
                  <p className="c360-definition__note">Doelgroeponderzoek komt in fase 1.</p>
                </dd>
              </div>
              <div>
                <dt className="c360-definition__term">AI-budget deze maand</dt>
                <dd className="c360-definition__value">
                  {budget.isSuccess
                    ? formatEuro(budget.data.availableCents)
                    : budget.isError
                      ? 'Niet beschikbaar'
                      : '—'}
                  <p className="c360-definition__note">
                    {budget.isSuccess
                      ? `Van ${formatEuro(budget.data.budgetCents)} · ${formatEuro(budget.data.reservedCents)} gereserveerd`
                      : 'Beschikbaar budget wordt geladen.'}
                  </p>
                </dd>
              </div>
            </dl>
          </Card>

          <Card title="Automatisering met controle" ariaLabel="Automatisering met controle">
            <p className="c360-card__hint">
              In deze versie werken labeltoegang, budgetreservering en achtergrondtaken. Onderzoek,
              concepten en publicatie volgen in latere fases. Er wordt niets automatisch
              gepubliceerd.
            </p>
          </Card>

          {overview.containsDemoData && (
            <Notice tone="warning">
              Dit label bevat gemarkeerde demo-data. Merk-, opleidings- en prijsinformatie is nog
              niet aangeleverd en wordt niet door het systeem verzonnen.
            </Notice>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Time-of-day greeting, computed from the viewer's own clock rather than the
 * server's, so it matches what the user sees out of the window.
 */
function salutation(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) {
    return 'Goedemorgen';
  }
  if (hour < 18) {
    return 'Goedemiddag';
  }
  return 'Goedenavond';
}

function formatEuro(cents: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(
    cents / 100,
  );
}
