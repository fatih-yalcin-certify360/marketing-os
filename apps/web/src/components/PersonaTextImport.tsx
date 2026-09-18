import { useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { personaInput, type JobSummary, type PersonaProposal, type PersonaVersion } from '@c360/contracts';
import { Button, Notice } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { isTerminalJobStatus, useJobProgress } from '../api/campaign-queries.js';
import { PersonaQuestionnaire } from './PersonaQuestionnaire.js';

/** One proposal as it comes back: the card, why it is its own persona, and what could not be taken over. */
interface Proposal {
  personaDraft: PersonaProposal;
  distinctionNl: string;
  warnings: string[];
}

export function PersonaTextImport({ labelId, courseId, onApply, onSaved }: {
  labelId: string;
  courseId: string;
  onApply: (draft: PersonaProposal) => void;
  /** Called for each persona stored straight from the preview. */
  onSaved?: (saved: PersonaVersion) => void;
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
  /*
   * Every audience the text described, not the first one.
   *
   * A research note usually covers several — an HR adviser, a career changer, a
   * team lead — and the extraction used to take one and drop the rest. Each
   * proposal is parsed on its own, so one malformed card does not hide the
   * others (2026-09-17).
   */
  const rawDrafts = job?.status === 'succeeded' && Array.isArray(job.result?.drafts) ? job.result.drafts : [];
  const proposals: Proposal[] = rawDrafts.flatMap((entry) => {
    const value = entry as { personaDraft?: unknown; distinctionNl?: unknown; warnings?: unknown };
    const parsed = personaInput.safeParse(value.personaDraft);
    if (!parsed.success) return [];
    return [{
      personaDraft: parsed.data,
      distinctionNl: typeof value.distinctionNl === 'string' ? value.distinctionNl : '',
      warnings: Array.isArray(value.warnings)
        ? value.warnings.filter((item): item is string => typeof item === 'string')
        : [],
    }];
  });
  const warningValue = job?.result?.warnings;
  const warnings = Array.isArray(warningValue) ? warningValue.filter((item): item is string => typeof item === 'string') : [];
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [storedCount, setStoredCount] = useState(0);

  /*
   * Saving several at once still stores them one by one, in order, and stops at
   * the first refusal. A partial result is reported rather than hidden: the
   * ones that were stored are stored, and the person can see which.
   */
  const saveAll = useMutation<number, ApiClientError, Proposal[]>({
    mutationFn: async (picked) => {
      let stored = 0;
      for (const proposal of picked) {
        const saved = await api.post<PersonaVersion>(
          `/labels/${labelId}/courses/${courseId}/personas`,
          proposal.personaDraft,
        );
        stored += 1;
        setStoredCount(stored);
        onSaved?.(saved);
      }
      return stored;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['personas', labelId] });
    },
  });
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
    </div>}
    {job?.status === 'succeeded' && proposals.length === 0 && (
      <Notice tone="warning">Het ontvangen concept heeft niet de verwachte vorm. Je formulier is behouden.</Notice>
    )}
    {proposals.length > 0 && <div className="persona-ai-preview">
      <h3>{proposals.length === 1 ? 'AI-concept ter controle' : `${String(proposals.length)} persona's uit deze tekst`}</h3>
      {job?.result?.isMock === true && <Notice tone="warning">Dit is een demoresultaat, geen echte AI-extractie.</Notice>}
      {warnings.length > 0 && <Notice tone="warning"><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></Notice>}
      {!isCurrentText && <Notice tone="warning">Je tekst is gewijzigd nadat dit concept is gestart. Maak een nieuw concept om de gewijzigde tekst te verwerken.</Notice>}

      {proposals.map((proposal, index) => {
        const draft = proposal.personaDraft;
        return <section key={index} className="persona-ai-proposal">
          <label className="persona-ai-proposal__pick">
            <input
              type="checkbox"
              checked={chosen.has(index)}
              disabled={!isCurrentText || saveAll.isPending}
              onChange={(event) => {
                const next = new Set(chosen);
                if (event.target.checked) next.add(index); else next.delete(index);
                setChosen(next);
              }}
            />
            <h4>{draft.name}</h4>
          </label>
          {proposal.distinctionNl !== '' && (
            <p className="persona-ai-proposal__distinction">{`Onderscheidt zich: ${proposal.distinctionNl}`}</p>
          )}
          <p>{draft.summary}</p>
          <dl>
            <dt>Behoefte</dt><dd>{draft.need}</dd>
            <dt>Motivatie</dt><dd>{draft.motivation}</dd>
            <dt>Relatie met de opleiding</dt><dd>{draft.relationToCourse}</dd>
          </dl>
          <p><strong>Drempels:</strong> {draft.barriers.join(' · ')}</p>
          <p><strong>Keuzecriteria:</strong> {draft.decisionCriteria.join(' · ')}</p>
          {draft.assumptions.length > 0 && <p><strong>Aannames:</strong> {draft.assumptions.join(' · ')}</p>}
          {proposal.warnings.length > 0 && (
            <Notice tone="warning"><ul>{proposal.warnings.map((warning, at) => <li key={at}>{warning}</li>)}</ul></Notice>
          )}
          <PersonaQuestionnaire value={draft.questionnaire} />
          <Button
            disabled={!isCurrentText || appliedJob === `${String(job?.id)}-${String(index)}`}
            onClick={() => { onApply(draft); setAppliedJob(`${String(job?.id)}-${String(index)}`); }}
          >
            In formulier overnemen
          </Button>
          {appliedJob === `${String(job?.id)}-${String(index)}` && (
            <Notice tone="info">Concept overgenomen. Controleer het formulier hieronder en kies daarna Persona opslaan.</Notice>
          )}
        </section>;
      })}

      {/*
        Overnemen edits one; opslaan stores the ticked ones as they are. Both
        exist because a text with five audiences is five forms to fill by hand,
        and reviewing them in this list is the same reading either way.
      */}
      <div className="persona-ai-proposal__bulk">
        <Button
          variant="primary"
          disabled={!isCurrentText || chosen.size === 0 || saveAll.isPending}
          busy={saveAll.isPending}
          onClick={() => { saveAll.mutate(proposals.filter((_, index) => chosen.has(index))); }}
        >
          {chosen.size <= 1 ? 'Aangevinkte persona opslaan' : `${String(chosen.size)} persona's opslaan`}
        </Button>
        <span className="c360-stat__caption">
          Opslaan bewaart de aangevinkte concepten ongewijzigd. Wil je er eerst aan sleutelen, gebruik dan
          "In formulier overnemen".
        </span>
      </div>
      {saveAll.isError && (
        <Notice tone="warning">
          {`${saveAll.error.userMessage} ${storedCount > 0 ? `${String(storedCount)} persona('s) zijn wel opgeslagen.` : ''}`}
        </Notice>
      )}
      {saveAll.isSuccess && (
        <Notice tone="info">{`${String(saveAll.data)} persona('s) opgeslagen. Controleer ze in de lijst.`}</Notice>
      )}
    </div>}
  </details>;
}
