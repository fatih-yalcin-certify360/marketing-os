import type { ReactNode } from 'react';
import type { JobSummary } from '@c360/contracts';
import { Button, Notice, Progress } from '@c360/ui';
import { useJobProgress } from '../api/campaign-queries.js';

/**
 * Shows a queued job as live progress.
 *
 * Every generating action returns a job instead of a result, so this is what
 * the user actually watches. It reports the worker's own progress message, and
 * on failure it shows the server's Dutch explanation plus a retry — a provider
 * outage reads as an outage rather than as silence.
 *
 * It lives here rather than inside one screen because the screens that need it
 * had started to diverge: the campaign chain had this component, the Kansen
 * screen called the same hook with a placeholder campaign id, and the sources
 * panel had grown a second poller of its own. Three behaviours for one concept
 * is how one of them ends up missing the adaptive backoff, or the rule about
 * not polling a hidden tab.
 *
 * `campaignId` is omitted for work that belongs to the label rather than to a
 * campaign — a course card read from a page, a research run.
 */
export function JobWatcher(props: {
  labelId: string;
  campaignId?: string | undefined;
  job: JobSummary | undefined;
  onRetry?: (() => void) | undefined;
  /** Shown instead of "Klaar." when the work has finished. */
  doneLabel?: string | undefined;
}): ReactNode {
  const tracked = useJobProgress(props.labelId, props.campaignId, props.job?.id);
  const job = tracked.data ?? props.job;

  if (job === undefined) {
    return null;
  }

  if (job.status === 'succeeded') {
    return (
      <Notice tone="neutral" live>
        {props.doneLabel ?? 'Klaar.'}
      </Notice>
    );
  }

  if (job.status === 'failed' || job.status === 'dead') {
    return (
      <div className="c360-stack" style={{ marginTop: 'var(--c360-space-3)' }}>
        <Notice tone="warning" live>
          {job.failureMessage ?? 'De taak is niet gelukt. Er is niets opgeslagen.'}
        </Notice>
        {job.retryable && props.onRetry !== undefined && (
          <div>
            <Button onClick={props.onRetry}>Opnieuw proberen</Button>
          </div>
        )}
      </div>
    );
  }

  if (job.status === 'cancelled') {
    return (
      <Notice tone="info" live>
        Gestopt. Al afgerond werk is bewaard.
      </Notice>
    );
  }

  return (
    <div className="c360-stack" style={{ marginTop: 'var(--c360-space-3)' }}>
      <Progress percent={job.progress?.percent ?? 5} label="Voortgang van de generatie" />
      <p className="c360-stat__caption" role="status" aria-live="polite">
        {job.progress?.message ?? (job.status === 'queued' ? 'In de wachtrij…' : 'Bezig…')}
        {job.attempt > 1 && ` · poging ${String(job.attempt)} van ${String(job.maxAttempts)}`}
      </p>
    </div>
  );
}

/**
 * Reads a string field out of a job's structured result.
 *
 * A job result is an open record because its shape depends on the job type;
 * narrowing here keeps that honest instead of casting at the call site. It sits
 * beside `JobWatcher` because it had been copied into two screens, and a copy
 * is where two readings of the same field start to differ.
 */
export function jobResultString(job: JobSummary | undefined, key: string): string | null {
  const value = job?.result?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
