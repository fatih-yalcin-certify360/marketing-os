import { useId, useState, type ReactNode } from 'react';
import type { JobStatus, JobSummary, LabelSummary } from '@c360/contracts';
import { Badge, Button, Card, Disclosure, Field, Notice, Progress, type Tone } from '@c360/ui';
import { useJobAction, useJobs, useStartDemoJob } from '../api/queries.js';

/**
 * Background task panel.
 *
 * This is the visible proof that the Phase 0 platform works end to end: a task
 * is queued here, picked up by the worker, reports partial progress, and can be
 * stopped or retried. It intentionally exposes the "fail first N attempts"
 * control so retry and backoff can be observed rather than taken on trust.
 */
export function JobsPanel(props: { label: LabelSummary }): ReactNode {
  const jobs = useJobs(props.label.id);
  const start = useStartDemoJob();
  const cancel = useJobAction('cancel');
  const retry = useJobAction('retry');

  const messageId = useId();
  const stepsId = useId();
  const failId = useId();

  const [message, setMessage] = useState('Testtaak vanuit de werkruimte');
  const [steps, setSteps] = useState(3);
  const [failFirstAttempts, setFailFirstAttempts] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const all = jobs.data?.items ?? [];
  // The last handful is what a person came to check; the rest is history.
  const items = showAll ? all : all.slice(0, 6);

  return (
    <Card
      title="Achtergrondtaken"
      description="Lange bewerkingen lopen door als je de pagina verlaat; een afgebroken taak start je hier opnieuw."
      ariaLabel="Achtergrondtaken"
      action={
        jobs.isFetching ? <span className="c360-stat__caption">Bijwerken…</span> : undefined
      }
    >
      <Disclosure tone="plain" summary="Testtaak starten (ontwikkeling)">
      <form
        className="c360-stack"
        onSubmit={(event) => {
          event.preventDefault();
          start.mutate({ labelId: props.label.id, message, steps, failFirstAttempts });
        }}
        style={{ marginTop: 'var(--c360-space-3)' }}
      >
        <Field
          id={messageId}
          label="Omschrijving"
          hint="Wordt teruggegeven door de testtaak. Maximaal 200 tekens."
        >
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="c360-input"
              type="text"
              maxLength={200}
              required
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
              }}
            />
          )}
        </Field>

        <div className="c360-row">
          <Field id={stepsId} label="Aantal stappen" hint="1 tot 20">
            {(fieldProps) => (
              <input
                {...fieldProps}
                className="c360-input"
                type="number"
                min={1}
                max={20}
                value={steps}
                onChange={(event) => {
                  setSteps(Number(event.target.value));
                }}
                style={{ width: '120px' }}
              />
            )}
          </Field>

          <Field
            id={failId}
            label="Eerste pogingen laten mislukken"
            hint="Om automatische nieuwe pogingen te tonen"
          >
            {(fieldProps) => (
              <input
                {...fieldProps}
                className="c360-input"
                type="number"
                min={0}
                max={5}
                value={failFirstAttempts}
                onChange={(event) => {
                  setFailFirstAttempts(Number(event.target.value));
                }}
                style={{ width: '120px' }}
              />
            )}
          </Field>
        </div>

        <div className="c360-row">
          <Button type="submit" variant="primary" disabled={start.isPending}>
            {start.isPending ? 'Starten…' : 'Start testtaak'}
          </Button>
          {start.isError && (
            <span className="c360-field__error" role="alert">
              {start.error.userMessage}
            </span>
          )}
          {start.isSuccess && !start.isPending && (
            <span className="c360-stat__caption" role="status">
              Taak in de wachtrij geplaatst.
            </span>
          )}
        </div>
      </form>
      </Disclosure>

      {jobs.isError && (
        <Notice tone="warning" live>
          {jobs.error.userMessage}
        </Notice>
      )}

      {items.length === 0 && !jobs.isPending && !jobs.isError && (
        <p className="c360-card__hint" style={{ marginTop: 'var(--c360-space-3)' }}>
          Er zijn nog geen taken voor dit label.
        </p>
      )}

      {items.length > 0 && (
        <div className="c360-table-scroll" style={{ marginTop: 'var(--c360-space-4)' }}>
          <table className="c360-table jobs-table">
            <caption className="c360-visually-hidden">
              Achtergrondtaken voor {props.label.name}
            </caption>
            <thead>
              <tr>
                <th scope="col">Taak</th>
                <th scope="col">Status</th>
                <th scope="col">Voortgang</th>
                <th scope="col">Pogingen</th>
                <th scope="col">Actie</th>
              </tr>
            </thead>
            <tbody>
              {items.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  labelId={props.label.id}
                  onCancel={() => {
                    cancel.mutate({ jobId: job.id, labelId: props.label.id });
                  }}
                  onRetry={() => {
                    retry.mutate({ jobId: job.id, labelId: props.label.id });
                  }}
                  busy={cancel.isPending || retry.isPending}
                />
              ))}
            </tbody>
          </table>
          {all.length > 6 && (
            <div className="c360-row" style={{ marginTop: 'var(--c360-space-3)' }}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowAll(!showAll);
                }}
              >
                {showAll ? 'Minder tonen' : `Alle ${String(all.length)} taken tonen`}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function JobRow(props: {
  job: JobSummary;
  labelId: string;
  onCancel: () => void;
  onRetry: () => void;
  busy: boolean;
}): ReactNode {
  const { job } = props;
  const cancellable = job.status === 'queued' || job.status === 'running';

  return (
    <>
    <tr>
      <td>
        <span style={{ fontWeight: 600 }}>{JOB_TYPE_LABEL_NL[job.type] ?? job.type}</span>
        <br />
        <span className="c360-stat__caption">{formatTime(job.createdAt)}</span>
      </td>
      <td>
        <Badge tone={STATUS_TONE[job.status]}>{STATUS_LABEL_NL[job.status]}</Badge>
      </td>
      <td style={{ minWidth: '160px' }}>
        {job.progress === null ? (
          <span className="c360-stat__caption">—</span>
        ) : (
          <>
            <Progress percent={job.progress.percent} label="Voortgang van de taak" />
            <p className="c360-list__subtitle">{job.progress.message}</p>
          </>
        )}
      </td>
      <td>
        <span className="c360-stat__caption">
          {`${String(job.attempt)} / ${String(job.maxAttempts)}`}
        </span>
      </td>
      <td>
        {cancellable && (
          <Button onClick={props.onCancel} disabled={props.busy}>
            Stoppen
          </Button>
        )}
        {job.retryable && (
          <Button onClick={props.onRetry} disabled={props.busy}>
            Opnieuw proberen
          </Button>
        )}
        {!cancellable && !job.retryable && <span className="c360-stat__caption">—</span>}
      </td>
    </tr>
    {/* Why it failed belongs under the row, not inside the status column: in a
        column of ten characters the sentence broke one word per line. */}
    {job.failureMessage !== null && (
      <tr className="jobs-table__note">
        <td colSpan={5}>{job.failureMessage}</td>
      </tr>
    )}
    </>
  );
}

const STATUS_LABEL_NL: Record<JobStatus, string> = {
  queued: 'In wachtrij',
  running: 'Bezig',
  succeeded: 'Afgerond',
  failed: 'Mislukt',
  dead: 'Gestopt',
  cancelling: 'Wordt gestopt',
  cancelled: 'Gestopt',
};

const STATUS_TONE: Record<JobStatus, Tone> = {
  queued: 'neutral',
  running: 'purple',
  succeeded: 'green',
  failed: 'red',
  dead: 'red',
  cancelling: 'amber',
  cancelled: 'neutral',
};

const JOB_TYPE_LABEL_NL: Record<string, string> = {
  'demo.echo': 'Testtaak',
  'course.extract_from_url': 'Opleidingskaart uit pagina',
  'course.extract_from_documents': 'Opleidingskaart uit document',
  'research.run': 'Bronnenonderzoek',
  'persona.propose': 'Doelgroepen voorstellen',
  'persona.extract_from_text': 'Persona uit tekst',
  'persona.fill_questionnaire': 'Personavragen aanvullen',
  'opportunity.propose': 'Kansen voorstellen',
  'brief.draft': 'Briefing uitwerken',
  'concept.propose': 'Concepten voorstellen',
  'content.plan': 'Kanaalplan voorstellen',
  'content.generate': 'Content maken',
  'content.standalone': 'Losse uiting maken',
  'content.revise': 'Content herzien',
  'campaign.package': 'Campagnepakket maken',
  'campaign.deliverables': 'Contentvormen voorstellen',
  'radar.scan': 'Marktradar scannen',
  'geo.research': 'GEO-onderzoek',
  'visibility.run': 'AI Visibility meten',
};

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('nl-NL', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
