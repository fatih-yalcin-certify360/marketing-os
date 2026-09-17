import { useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { personaInput, type JobSummary, type PersonaProposal } from '@c360/contracts';
import { Button, Notice } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { isTerminalJobStatus, useJobProgress } from '../api/campaign-queries.js';
import { PersonaQuestionnaire } from './PersonaQuestionnaire.js';

export function PersonaTextImport({ labelId, courseId, onApply }: {
  labelId: string;
  courseId: string;
  onApply: (draft: PersonaProposal) => void;
}): ReactNode {
  const [text, setText] = useState('');
  const [appliedJob, setAppliedJob] = useState<string>();
  const request = useRef<{ text: string; requestKey: string } | null>(null);
  const queryClient = useQueryClient();
  const extract = useMutation<JobSummary, ApiClientError, { text: string; requestKey: string }>({
    mutationFn: body => api.post(`/labels/${labelId}/courses/${courseId}/personas/extract-from-text`, body),
  });
  const tracked = useJobProgress(labelId, undefined, extract.data?.id);
  const job = tracked.data ?? extract.data;
  const busy = extract.isPending || (job !== undefined && !isTerminalJobStatus(job.status));
  const isCurrentText = extract.variables?.text === text.trim();
  const parsedDraft = job?.status === 'succeeded' ? personaInput.safeParse(job.result?.personaDraft) : null;
  const draft = parsedDraft?.success ? parsedDraft.data : undefined;
  const warningValue = job?.result?.warnings;
  const warnings = Array.isArray(warningValue) ? warningValue.filter((item): item is string => typeof item === 'string') : [];
  const retry = useMutation<unknown, ApiClientError>({
    mutationFn: () => api.post(`/jobs/${String(job?.id)}/retry`),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['job', job?.id] }); },
  });
  const start = (): void => {
    const trimmed = text.trim();
    if (trimmed.length < 30 || trimmed.length > 20_000 || busy) return;
    // Reuse the request key after a network error so one click cannot queue two paid jobs.
    if (request.current?.text !== trimmed || extract.data !== undefined) request.current = { text: trimmed, requestKey: crypto.randomUUID() };
    setAppliedJob(undefined);
    extract.mutate(request.current);
  };

  return <details className="persona-text-import">
    <summary>Persona uit losse tekst met AI</summary>
    <p>Plak je notities, interview of ingevulde vragenlijst. AI ordent de tekst in de personavelden en de 36 vragen. Ontbrekende informatie blijft onbekend. Deze stap gebruikt AI-credits; handmatig invullen en opslaan niet.</p>
    <label>Tekst over de persona
      <textarea aria-label="Tekst over de persona" rows={8} minLength={30} maxLength={20_000} value={text} onChange={event => setText(event.target.value)}
        placeholder="Bijvoorbeeld: deze doelgroep bestaat uit ervaren adviseurs. Zij zoeken een opleiding omdat…" />
    </label>
    <small>{text.trim().length.toLocaleString('nl-NL')} / 20.000 tekens · minimaal 30 tekens</small>
    <Button disabled={busy || retry.isPending || text.trim().length < 30} onClick={start}>{busy ? 'AI maakt een concept…' : 'AI-concept maken'}</Button>
    <p>Controleer het concept en neem het zelf over in het formulier. Er wordt nog geen persona opgeslagen.</p>
    {(extract.error ?? tracked.error ?? retry.error) && <Notice tone="warning">{(extract.error ?? tracked.error ?? retry.error)?.userMessage}</Notice>}
    {job && <div aria-live="polite">
      {!isTerminalJobStatus(job.status) && <p role="status">{job.progress?.message ?? 'Je tekst wordt verwerkt. Blijf op deze pagina om het concept over te nemen.'}</p>}
      {(job.status === 'failed' || job.status === 'dead') && <Notice tone="warning">{job.failureMessage ?? 'Het concept kon niet worden gemaakt. Je tekst en formulier zijn behouden.'}</Notice>}
      {job.status === 'cancelled' && <Notice tone="info">De verwerking is gestopt. Je formulier is behouden.</Notice>}
      {job.retryable && isCurrentText && <Button disabled={retry.isPending} onClick={() => retry.mutate()}>Opnieuw proberen</Button>}
      {job.status === 'succeeded' && !draft && <Notice tone="warning">Het ontvangen concept heeft niet de verwachte vorm. Je formulier is behouden.</Notice>}
    </div>}
    {draft && <div className="persona-ai-preview">
      <h3>AI-concept ter controle</h3>
      {job?.result?.isMock === true && <Notice tone="warning">Dit is een demoresultaat, geen echte AI-extractie.</Notice>}
      <h4>{draft.name}</h4><p>{draft.summary}</p>
      <dl><dt>Behoefte</dt><dd>{draft.need}</dd><dt>Motivatie</dt><dd>{draft.motivation}</dd><dt>Relatie met de opleiding</dt><dd>{draft.relationToCourse}</dd></dl>
      <p><strong>Drempels:</strong> {draft.barriers.join(' · ')}</p>
      <p><strong>Keuzecriteria:</strong> {draft.decisionCriteria.join(' · ')}</p>
      {warnings.length > 0 && <Notice tone="warning"><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></Notice>}
      {draft.assumptions.length > 0 && <p><strong>Aannames:</strong> {draft.assumptions.join(' · ')}</p>}
      <PersonaQuestionnaire value={draft.questionnaire} />
      {!isCurrentText && <Notice tone="warning">Je tekst is gewijzigd nadat dit concept is gestart. Maak een nieuw concept om de gewijzigde tekst te verwerken.</Notice>}
      {isCurrentText && appliedJob !== job?.id && <p>Overnemen vervangt de huidige inhoud van het formulier. Je kunt die daarna controleren, aanpassen en apart opslaan.</p>}
      <Button disabled={!isCurrentText || appliedJob === job?.id} onClick={() => { onApply(draft); setAppliedJob(job?.id); }}>AI in formulier overnemen</Button>
      {appliedJob === job?.id && <Notice tone="info">Concept overgenomen. Controleer het formulier hieronder en kies daarna Persona opslaan.</Notice>}
    </div>}
  </details>;
}
