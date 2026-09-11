import { useState, type ReactNode } from 'react';
import { jobResultString } from '../components/JobWatcher.js';
import { Link } from 'react-router-dom';
import type { LabelSummary } from '@c360/contracts';
import { Badge, Button, Card, Notice } from '@c360/ui';
import type { JobSummary } from '@c360/contracts';
import {
  useCourses,
  useJobProgress,
  useOpportunitySet,
  usePersonas,
  useProposeOpportunities,
  useProposePersonas,
} from '../api/campaign-queries.js';
import { ErrorState, LoadingState } from '../components/states.js';

/**
 * "Ontdek kansen" as an exploration screen.
 *
 * Deliberately read-only with respect to campaigns: nothing here commits to
 * anything. It exists so a user can look at what the material supports before
 * starting a campaign, which is the entry mode the requirements describe.
 */
export function KansenPage(props: { label: LabelSummary | undefined }): ReactNode {
  const labelId = props.label?.id;
  const courses = useCourses(labelId);
  const [courseVersionId, setCourseVersionId] = useState<string | undefined>(undefined);
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([]);

  const activeCourse = courseVersionId ?? courses.data?.items[0]?.course.id;
  const personas = usePersonas(labelId, activeCourse);
  const proposePersonas = useProposePersonas(labelId ?? '');
  const proposeOpportunities = useProposeOpportunities(labelId ?? '');

  // Both proposals run on the worker, so this screen follows their jobs. There
  // is no campaign here — this screen explores without committing to one — so
  // no campaign key is invalidated. It used to pass the string 'kansen' as a
  // placeholder, which invalidated a cache key that never existed.
  const personaJob = useJobProgress(labelId ?? '', undefined, proposePersonas.data?.id);
  const opportunityJob = useJobProgress(labelId ?? '', undefined, proposeOpportunities.data?.id);
  const setId = jobResultString(opportunityJob.data ?? proposeOpportunities.data, 'proposalSetId');
  const opportunities = useOpportunitySet(labelId ?? '', setId ?? undefined);
  const shortfall = jobResultString(personaJob.data ?? proposePersonas.data, 'shortfallReasonNl');

  if (props.label === undefined) {
    return <Notice tone="warning">Kies eerst een label.</Notice>;
  }
  if (courses.isPending) {
    return <LoadingState label="Opleidingen worden geladen" />;
  }
  if (courses.isError) {
    return (
      <ErrorState
        message={courses.error.userMessage}
        requestId={courses.error.requestId}
        onRetry={() => void courses.refetch()}
      />
    );
  }

  const courseItems = courses.data.items;
  const personaItems = personas.data?.items ?? [];

  return (
    <>
      <header>
        <h1 className="c360-page-title">Kansen</h1>
        <p className="c360-page-lead">
          Verken wat het beschikbare materiaal ondersteunt. Hier wordt niets vastgelegd — een
          campagne start je onder Campagnes.
        </p>
      </header>

      {courseItems.length === 0 ? (
        <Notice tone="warning">
          Er is nog geen opleidingskaart. Leg eerst een opleiding vast onder Kennis &amp; beheer.
        </Notice>
      ) : (
        <>
          <Card title="Opleiding" ariaLabel="Opleiding kiezen">
            <div className="c360-row">
              {courseItems.map((item) => (
                <Button
                  key={item.course.id}
                  variant={activeCourse === item.course.id ? 'primary' : 'secondary'}
                  onClick={() => {
                    setCourseVersionId(item.course.id);
                    setSelectedPersonas([]);
                  }}
                >
                  {item.course.name}
                </Button>
              ))}
            </div>
            {courseItems
              .filter((item) => item.course.id === activeCourse)
              .map((item) => (
                <p className="c360-card__hint" key={item.course.id} style={{ marginTop: 'var(--c360-space-3)' }}>
                  {`Gecontroleerd: ${item.confirmed.join(', ') || 'niets'}.`}
                  {item.unconfirmed.length > 0 &&
                    ` Niet gecontroleerd: ${item.unconfirmed.join(', ')} — dit wordt niet in voorstellen gebruikt.`}
                </p>
              ))}
          </Card>

          <Card title="Doelgroepen" ariaLabel="Doelgroepen">
            <Button
              variant="primary"
              disabled={proposePersonas.isPending || activeCourse === undefined}
              onClick={() => {
                if (activeCourse !== undefined) {
                  proposePersonas.mutate({ courseVersionId: activeCourse });
                }
              }}
            >
              {proposePersonas.isPending ? 'Bezig…' : 'Doelgroepen voorstellen'}
            </Button>
            {proposePersonas.isError && (
              <p className="c360-field__error" role="alert">
                {proposePersonas.error.userMessage}
              </p>
            )}
            <JobProgressNotice job={personaJob.data ?? proposePersonas.data} />

            {/* A short set is always explained — never padded to three. */}
            {shortfall !== null && (
              <Notice tone="warning" live>
                {shortfall}
              </Notice>
            )}

            {personaItems.length > 0 && (
              <ul className="c360-list" style={{ marginTop: 'var(--c360-space-4)' }}>
                {personaItems.map((persona) => (
                  <li className="c360-list__item" key={persona.id}>
                    <div style={{ minWidth: 0 }}>
                      <label className="c360-row" style={{ gap: 'var(--c360-space-2)' }}>
                        <input
                          type="checkbox"
                          checked={selectedPersonas.includes(persona.id)}
                          onChange={() => {
                            setSelectedPersonas((current) =>
                              current.includes(persona.id)
                                ? current.filter((value) => value !== persona.id)
                                : [...current, persona.id].slice(0, 3),
                            );
                          }}
                          aria-label={`Kies ${persona.name}`}
                        />
                        <span className="c360-list__title">{persona.name}</span>
                      </label>
                      <p className="c360-list__subtitle">{persona.summary}</p>
                      <p className="c360-list__subtitle">
                        <strong>Behoefte:</strong> {persona.need}
                      </p>
                      <p className="c360-list__subtitle">
                        <strong>Barrières:</strong> {persona.barriers.join(' · ')}
                      </p>
                      <div className="c360-row">
                        <Badge tone={persona.grounding.length > 0 ? 'green' : 'neutral'}>
                          {`${String(persona.grounding.length)} onderbouwing`}
                        </Badge>
                        <Badge tone="amber">{`${String(persona.assumptions.length)} aanname`}</Badge>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {selectedPersonas.length > 0 && (
            <Card title="Kansen" ariaLabel="Kansen">
              <Button
                variant="primary"
                disabled={proposeOpportunities.isPending}
                onClick={() => {
                  if (activeCourse !== undefined) {
                    proposeOpportunities.mutate({
                      courseVersionId: activeCourse,
                      personaVersionIds: selectedPersonas,
                    });
                  }
                }}
              >
                {proposeOpportunities.isPending ? 'Bezig…' : 'Kansen voorstellen'}
              </Button>
              {proposeOpportunities.isError && (
                <p className="c360-field__error" role="alert">
                  {proposeOpportunities.error.userMessage}
                </p>
              )}

              <JobProgressNotice job={opportunityJob.data ?? proposeOpportunities.data} />

              {opportunities.data !== undefined && (
                <>
                  <ul className="c360-list" style={{ marginTop: 'var(--c360-space-4)' }}>
                    {opportunities.data.items.map((opportunity) => (
                      <li className="c360-list__item" key={opportunity.id}>
                        <div style={{ minWidth: 0 }}>
                          <p className="c360-list__title">
                            {`#${String(opportunity.rank)} ${opportunity.title}`}
                          </p>
                          <p className="c360-list__subtitle">{opportunity.coreIdea}</p>
                          <p className="c360-list__subtitle">
                            <strong>Waarom deze positie:</strong> {opportunity.rankRationaleNl}
                          </p>
                          <p className="c360-list__subtitle">
                            <strong>Onzekerheden:</strong>{' '}
                            {opportunity.uncertainties.join(' · ') || 'geen genoteerd'}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Notice tone="info">
                    Er wordt bewust geen slagingsscore of verkoopvoorspelling gegeven. De volgorde
                    is een beoordeling met opgaaf van reden, geen meting.{' '}
                    <Link to="/campagnes">Start een campagne</Link> om hiermee verder te gaan.
                  </Notice>
                </>
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}

/** Compact progress line for a running generation job. */
function JobProgressNotice(props: { job: JobSummary | undefined }): ReactNode {
  const { job } = props;
  if (job === undefined || job.status === 'succeeded') {
    return null;
  }
  if (job.status === 'failed' || job.status === 'dead') {
    return (
      <Notice tone="warning" live>
        {job.failureMessage ?? 'De taak is niet gelukt. Er is niets opgeslagen.'}
      </Notice>
    );
  }
  return (
    <Notice tone="info" live>
      {job.progress?.message ?? 'In de wachtrij…'}
    </Notice>
  );
}
