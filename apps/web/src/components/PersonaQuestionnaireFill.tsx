import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { JobSummary, PersonaVersion } from '@c360/contracts';
import { Button, Notice } from '@c360/ui';
import { isTerminalJobStatus, useFillPersonaQuestionnaire, useJobProgress } from '../api/campaign-queries.js';
import { JobWatcher, jobResultString } from './JobWatcher.js';
import { questionnaireStats } from './PersonaQuestionnaire.js';

/**
 * The button that lets the system complete a persona's questionnaire.
 *
 * Shown only while questions are open, because that is the only case in
 * which it does anything. It starts one job for this persona; the worker
 * answers the open questions from the persona's own course, campaign input
 * and research and stores the next version. Answered questions are never
 * touched — the note the job returns says how many were filled and how many
 * rest on a passage versus an inference. This costs one AI call, and the
 * label says so.
 */
export function PersonaQuestionnaireFill(props: {
  labelId: string;
  campaignId?: string | undefined;
  persona: PersonaVersion;
  /** Called with the id of the new version when the job has finished. */
  onFilled?: ((newVersionId: string) => void) | undefined;
  /** `sm` fits a card's action row; the default fits a list row. */
  size?: 'sm' | 'md' | undefined;
}): ReactNode {
  const { persona } = props;
  const open = questionnaireStats(persona.questionnaire).unknown;
  const fill = useFillPersonaQuestionnaire(props.labelId);
  const tracked = useJobProgress(props.labelId, props.campaignId, fill.data?.id);
  const job: JobSummary | undefined = tracked.data ?? fill.data;
  const busy = fill.isPending || (job !== undefined && !isTerminalJobStatus(job.status));
  const reported = useRef<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (job?.status !== 'succeeded' || reported.current === job.id) return;
    reported.current = job.id;
    const newId = jobResultString(job, 'personaVersionId');
    if (newId !== null) props.onFilled?.(newId);
  }, [job, props]);

  if (open === 0 && job === undefined) return null;
  const note = jobResultString(job, 'noteNl');

  return (
    <div className="persona-fill">
      {open > 0 && (
        <Button
          size={props.size ?? 'sm'}
          variant="secondary"
          icon="sparkles"
          disabled={busy}
          onClick={() => {
            setDismissed(false);
            fill.mutate({ personaVersionId: persona.id });
          }}
        >
          {busy ? 'AI vult de open vragen in…' : `Open vragen door AI laten invullen (${String(open)})`}
        </Button>
      )}
      {fill.error !== null && <Notice tone="warning">{fill.error.userMessage}</Notice>}
      {job !== undefined && !dismissed && (
        <JobWatcher
          labelId={props.labelId}
          campaignId={props.campaignId}
          job={job}
          onRetry={() => {
            fill.mutate({ personaVersionId: persona.id });
          }}
          doneLabel={note ?? 'De vragenlijst is aangevuld; de nieuwe versie staat hierboven.'}
        />
      )}
      {job?.status === 'succeeded' && !dismissed && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDismissed(true);
          }}
        >
          Melding sluiten
        </Button>
      )}
    </div>
  );
}
