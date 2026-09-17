import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { JobSummary, JobType } from '@c360/contracts';
import { Icon } from '@c360/ui';
import { useJobs } from '../api/queries.js';

/**
 * Tells you when background work has landed.
 *
 * Long work runs on the worker — writing a loose piece, scanning the market,
 * producing a campaign's content — and the person who started it is expected to
 * carry on. That only works if something tells them when it is done, and where
 * to look. Without this, "je krijgt bericht" was a promise nothing kept.
 *
 * It reads the label's job list, which is already polled for the background-task
 * panel, so this adds no request of its own.
 *
 * **Only transitions are announced.** The first successful load seeds the set of
 * jobs already accounted for; otherwise opening the app would raise a toast for
 * every job that finished last week. A job is announced once, and the toast
 * stays until it is dismissed — a notification that disappears on its own is a
 * notification somebody missed.
 */
interface Landed {
  job: JobSummary;
  /** Where the result is, when the job's own result says where. */
  to: string | null;
  titleNl: string;
  bodyNl: string;
  ok: boolean;
}

const TERMINAL = new Set(['succeeded', 'failed', 'dead', 'cancelled']);

/** What each kind of work is called, in the words of the screen that started it. */
const WORK_NL: Readonly<Partial<Record<JobType, string>>> = Object.freeze({
  'demo.echo': 'Testtaak',
  'content.standalone': 'Losse uiting',
  'content.generate': 'Content & beelden',
  'content.revise': 'Herziening',
  'content.plan': 'Kanaalplan',
  'radar.scan': 'Marktradar-scan',
  'geo.research': 'AI Visibility-onderzoek',
  'campaign.package': 'Websitepakket',
  'persona.propose': 'Doelgroepvoorstel',
  'persona.fill_questionnaire': 'Persona aanvullen',
  'opportunity.propose': 'Kansen',
  'brief.draft': 'Briefing',
  'concept.propose': 'Concepten',
  'course.extract_from_url': 'Opleidingskaart',
  'course.extract_from_documents': 'Opleidingskaart',
  'research.run': 'Bronnenonderzoek',
});

/**
 * The link that takes you straight to what the job produced.
 *
 * Only where the job's own result says where it landed. A guessed destination
 * is worse than none: it sends someone to a screen that does not hold the thing
 * they were promised.
 */
function destinationFor(job: JobSummary): string | null {
  const text = (key: string): string | null => {
    const value = job.result?.[key];
    return typeof value === 'string' ? value : null;
  };
  const assetId = text('assetId');

  if (job.type === 'content.standalone' && assetId !== null) {
    return `/content?item=loose:${assetId}`;
  }
  if (job.type === 'content.revise' && assetId !== null) {
    return `/content?item=piece:${assetId}`;
  }
  const campaignId = text('campaignId');
  if (job.type === 'content.generate' && campaignId !== null) {
    return `/campagnes/${campaignId}?fase=content`;
  }
  if (job.type === 'radar.scan') {
    const runId = text('runId');
    return runId === null ? '/radar' : `/radar?run=${runId}`;
  }
  if (job.type === 'geo.research') {
    return '/ai-visibility';
  }
  return null;
}

function describe(job: JobSummary): Landed {
  const what = WORK_NL[job.type] ?? 'Achtergrondtaak';
  if (job.status === 'succeeded') {
    const summary = job.result?.hook;
    const hook = typeof summary === 'string' ? summary : null;
    return {
      job,
      to: destinationFor(job),
      titleNl: `${what} is klaar`,
      bodyNl: hook ?? job.progress?.message ?? 'De taak is afgerond.',
      ok: true,
    };
  }
  if (job.status === 'cancelled') {
    return {
      job,
      to: null,
      titleNl: `${what} is geannuleerd`,
      bodyNl: 'Wat al af was, is bewaard.',
      ok: false,
    };
  }
  return {
    job,
    to: null,
    titleNl: `${what} is gestopt`,
    bodyNl: job.failureMessage ?? 'De taak is na meerdere pogingen gestopt. Er is niets opgeslagen.',
    ok: false,
  };
}

export function BackgroundWork(props: { labelId: string | undefined }): ReactNode {
  const jobs = useJobs(props.labelId);
  const client = useQueryClient();
  const [landed, setLanded] = useState<Landed[]>([]);
  // Jobs already accounted for. Seeded on the first load, so history is silent.
  const seen = useRef<Set<string> | null>(null);
  const label = useRef(props.labelId);

  useEffect(() => {
    if (label.current !== props.labelId) {
      label.current = props.labelId;
      seen.current = null;
      setLanded([]);
    }
  }, [props.labelId]);

  useEffect(() => {
    const items = jobs.data?.items;
    if (items === undefined) return;

    if (seen.current === null) {
      seen.current = new Set(items.filter((job) => TERMINAL.has(job.status)).map((job) => job.id));
      return;
    }

    const fresh = items.filter((job) => TERMINAL.has(job.status) && !seen.current?.has(job.id));
    if (fresh.length === 0) return;
    for (const job of fresh) seen.current.add(job.id);

    /*
     * Finished work means the caches holding its output are stale.
     *
     * This is where it is known, and it is the only place: a screen that was
     * open while the job ran has no other reason to refetch, so the link in the
     * notice would otherwise lead to a list that does not contain the piece yet.
     * Deliberately broad — invalidating a query that did not change costs one
     * request, missing one costs the user their result.
     */
    if (fresh.some((job) => job.status === 'succeeded')) {
      void client.invalidateQueries({
        predicate: (query) => {
          const first = query.queryKey[0];
          return typeof first === 'string' && first !== 'jobs';
        },
      });
    }

    setLanded((current) => [...fresh.map(describe), ...current].slice(0, 4));
  }, [jobs.data, client]);

  if (landed.length === 0) {
    return null;
  }

  return (
    <div className="os-toasts" role="status" aria-live="polite">
      {landed.map((entry) => (
        <div key={entry.job.id} className={`os-toast${entry.ok ? '' : ' os-toast--warn'}`}>
          <span className="os-toast__mark" aria-hidden="true">
            <Icon name={entry.ok ? 'check' : 'alert'} size={14} />
          </span>
          <div className="os-toast__text">
            <p className="os-toast__title">{entry.titleNl}</p>
            <p className="os-toast__body">{entry.bodyNl}</p>
            {entry.to !== null && (
              <Link
                className="os-toast__link"
                to={entry.to}
                onClick={() => {
                  setLanded((current) => current.filter((item) => item.job.id !== entry.job.id));
                }}
              >
                Naar het resultaat
              </Link>
            )}
          </div>
          <button
            type="button"
            className="os-toast__close"
            aria-label={`${entry.titleNl} sluiten`}
            onClick={() => {
              setLanded((current) => current.filter((item) => item.job.id !== entry.job.id));
            }}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
