import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CourseVersion, JobSummary, ResearchFinding, ResearchRun, RunFreshness, Source } from '@c360/contracts';
import { Button, Notice } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { isTerminalJobStatus, useJobProgress } from '../api/campaign-queries.js';
import { JobWatcher } from './JobWatcher.js';
import { useLabelDetail } from '../api/queries.js';

interface ResearchResult { run: ResearchRun | null; freshness: RunFreshness; findings: ResearchFinding[] }
export function SourcesResearchPanel({ labelId, course }: { labelId: string; course: CourseVersion }): ReactNode {
  const client = useQueryClient();
  const access = useLabelDetail(labelId);
  const permissions = access.data?.permissions ?? [];
  const base = `/labels/${labelId}`;
  const researchPath = `${base}/courses/${course.id}/research`;
  const [url, setUrl] = useState(course.sourceRef?.startsWith('https://') ? course.sourceRef : '');
  const [title, setTitle] = useState(course.name);
  const [file, setFile] = useState<File | null>(null);
  const sources = useQuery<{ items: Source[] }, ApiClientError>({
    queryKey: ['sources', labelId], queryFn: ({ signal }) => api.get(`${base}/sources`, signal),
    enabled: permissions.includes('source:read'),
  });
  const refresh = async (): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['sources', labelId] }),
      client.invalidateQueries({ queryKey: ['research', labelId, course.id] }),
    ]);
  };
  const add = useMutation<unknown, ApiClientError, 'url' | 'document'>({
    mutationFn: async kind => {
      if (kind === 'document' && file) {
        const asset = await api.upload<{ id: string }>(`${base}/uploads/source_document`, file);
        return api.post(`${base}/sources`, { kind: 'user_document', assetId: asset.id, title: file.name, timeSensitivity: 'medium' });
      }
      return api.post(`${base}/sources`, { kind: 'course_page', url, title, timeSensitivity: 'medium' });
    }, onSuccess: refresh,
  });
  const toggle = useMutation<unknown, ApiClientError, Source>({
    mutationFn: source => api.patch(`${base}/sources/${source.id}`, { isActive: !source.isActive }), onSuccess: refresh,
  });
  const start = useMutation<JobSummary | { reused: true; run: ResearchRun }, ApiClientError, boolean>({
    mutationFn: force => api.post(`${researchPath}/run`, { force }),
    onSuccess: refresh,
  });

  /*
   * Starting a run answers either with a job or with "the current run already
   * covers this", so only the first case is something to watch.
   */
  const started: JobSummary | undefined =
    start.data !== undefined && !('reused' in start.data) ? start.data : undefined;

  /*
   * The shared job hook, not a poller of our own.
   *
   * This panel used to fetch `/jobs/:id` on a fixed 1.5-second interval of its
   * own, which polled just as hard in a hidden tab and never backed off — so a
   * research run left open in a background tab kept asking every 1.5 seconds
   * for as long as it took. `useJobProgress` backs off (1.2 s, 3 s, 6 s) and
   * stops entirely when the tab is hidden. Same query key as `JobWatcher`
   * below, so this is one poll shared from one cache entry, not two.
   */
  const tracked = useJobProgress(labelId, undefined, started?.id);
  const job = tracked.data ?? started;
  const busy = job !== undefined && !isTerminalJobStatus(job.status);

  /*
   * `busy` is part of the key on purpose.
   *
   * The run's findings are written by the worker, so they exist only after the
   * job reaches a terminal state. Keying on `busy` means the key changes
   * exactly once — when the job stops — and that change is what refetches the
   * findings. Polling alone cannot be trusted for this: the last poll of a
   * busy run can land before the worker has committed its rows.
   */
  const research = useQuery<ResearchResult, ApiClientError>({
    queryKey: ['research', labelId, course.id, busy],
    queryFn: ({ signal }) => api.get(researchPath, signal), enabled: permissions.includes('research:read'),
    refetchInterval: query => busy || query.state.data?.run?.status === 'running' ? 2_000 : false,
  });

  const errors = [sources.error, research.error, tracked.error, add.error, toggle.error, start.error].filter(Boolean);
  if (!permissions.includes('research:read')) return null;
  return <section aria-label={`Onderzoek voor ${course.name}`} style={{ marginTop: 'var(--c360-space-6)', overflowWrap: 'anywhere' }}>
    <h3>Bronnen & onderzoek</h3>
    <p>De actieve bronnen gelden voor dit label. Onderzoek wordt per opleidingsversie bewaard en helpt bij een volgende persona-generatie. Bevindingen zijn nog geen gecontroleerde opleidingsfeiten.</p>
    {sources.isPending && <p>Bronnen worden geladen…</p>}
    <ul>{sources.data?.items.map(source => <li key={source.id}>
      <strong>{source.title}</strong> — {source.isActive ? 'Actief' : 'Uitgeschakeld'}
      {source.url && <> · <a href={source.url} target="_blank" rel="noreferrer">Bron openen</a></>}
      {permissions.includes('source:write') && <Button disabled={toggle.isPending} onClick={() => toggle.mutate(source)}>{source.isActive ? 'Uitschakelen' : 'Activeren'}</Button>}
      {source.lastFailureNl && <p>{source.lastFailureNl}</p>}
    </li>)}</ul>
    {permissions.includes('source:write') && <>
      <form onSubmit={event => { event.preventDefault(); add.mutate('url'); }}>
        <div className="c360-row" style={{ alignItems: 'end', marginBlock: 'var(--c360-space-4)' }}>
          <label className="c360-field" style={{ flex: 1, minWidth: 220 }}>Naam bron <input className="c360-input" required maxLength={300} value={title} onChange={event => setTitle(event.target.value)} /></label>
          <label className="c360-field" style={{ flex: 2, minWidth: 260 }}>Webadres <input className="c360-input" required type="url" maxLength={2000} value={url} onChange={event => setUrl(event.target.value)} /></label>
          <Button type="submit" disabled={add.isPending}>Webbron toevoegen</Button>
        </div>
      </form>
      <div className="c360-row" style={{ alignItems: 'end', marginBlock: 'var(--c360-space-4)' }}>
        <label className="c360-field" style={{ flex: 1, minWidth: 260 }}>Document (PDF, Word of tekst) <input className="c360-input" type="file" accept=".pdf,.docx,.txt,.md" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
        <Button disabled={!file || add.isPending} onClick={() => add.mutate('document')}>Document toevoegen</Button>
      </div>
    </>}
    {permissions.includes('research:run') && <div className="c360-row" style={{ alignItems: 'end', marginBlock: 'var(--c360-space-4)' }}>
      <Button variant="primary" disabled={busy || start.isPending || !sources.data?.items.some(source => source.isActive)} onClick={() => start.mutate(false)}>
        {busy ? 'Onderzoek loopt…' : research.data?.freshness.isCurrent ? 'Huidig onderzoek gebruiken' : 'Onderzoek uitvoeren'}
      </Button>
      {research.data?.run && <Button disabled={busy || start.isPending} onClick={() => start.mutate(true)}>Opnieuw onderzoeken</Button>}
    </div>}
    {/*
      * One job-progress behaviour, shared with every other screen.
      *
      * This was a single line of text: no progress bar, and no retry after a
      * failure — so a research run that failed on a provider outage left the
      * user with a sentence and no way forward, while the same failure on a
      * campaign step offered a button.
      */}
    <JobWatcher
      labelId={labelId}
      job={started}
      doneLabel="Onderzoek afgerond. De bevindingen staan hieronder."
      onRetry={() => start.mutate(true)}
    />
    {research.data?.run && <>
      <p>Onderzoek v{research.data.run.version} · {research.data.freshness.isCurrent ? 'Actueel' : research.data.run.status === 'running' ? 'Wordt uitgevoerd' : 'Niet actueel'}</p>
      {research.data.run.failureNl && <Notice tone="warning">{research.data.run.failureNl}</Notice>}
      {research.data.freshness.reasons.map((reason, index) => <p key={index}>{reason.detailNl}</p>)}
      {research.data.run.shortfallReasonNl && <Notice tone="warning">{research.data.run.shortfallReasonNl}</Notice>}
      <ul>{research.data.findings.map(finding => <li key={finding.id}>
        <strong>{finding.claim}</strong><blockquote>{finding.excerpt}</blockquote>
        <p>{finding.sourceRef} · {new Date(finding.retrievedAt).toLocaleString('nl-NL')}</p>
        {finding.uncertaintyNl && <p>{finding.uncertaintyNl}</p>}
      </li>)}</ul>
    </>}
    {errors.map((error, index) => <Notice key={index} tone="warning">{error?.userMessage}</Notice>)}
  </section>;
}
