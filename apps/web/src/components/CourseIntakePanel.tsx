import { useState, type ReactNode } from 'react';
import { Button, Card, Field, Notice } from '@c360/ui';
import type { JobSummary } from '@c360/contracts';
import {
  useExtractCourseFromDocument,
  useExtractCourseFromUrl,
  useJobProgress,
} from '../api/campaign-queries.js';
import { JobWatcher, jobResultString } from './JobWatcher.js';

/**
 * Creates a course card, from a course page or from a document.
 *
 * Both capabilities and their controls had existed for a while — the SSRF
 * guard, the file validation, the queued jobs — but no screen called either, so
 * the only way to get a course card was the demo seed. This is that screen.
 *
 * Two things it is careful about, because both are ways this could mislead:
 *
 *  - **Nothing here is confirmed.** Every field the extractor proposes arrives
 *    `unverified` with its source attached and the extractor's own doubt next
 *    to it. A person still confirms each fact in the table below, and an
 *    unconfirmed fact is never used in content. The panel says so before
 *    anything is submitted, not after.
 *  - **A refusal is explained.** A URL's shape is judged before any work is
 *    queued, and a document is validated before the extraction is queued, so a
 *    refusal is specific and nothing is charged for it. The URL's *address* is
 *    re-checked inside the job on every redirect hop, because DNS can answer
 *    differently a second later.
 *
 * The two routes deliberately share one progress area: they produce the same
 * artefact, and a screen that watched them separately would invite starting
 * both.
 */
export function CourseIntakePanel(props: { labelId: string }): ReactNode {
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const fromUrl = useExtractCourseFromUrl(props.labelId);
  const fromDocument = useExtractCourseFromDocument(props.labelId);

  /*
   * Whichever route was used last is the one being watched.
   *
   * Both mutations keep their own last result, so the job to follow is the more
   * recent of the two rather than the first one found.
   */
  const started: JobSummary | undefined =
    fromDocument.submittedAt > fromUrl.submittedAt ? fromDocument.data : fromUrl.data;

  /*
   * The same query key as the watcher below, so this is one poll shared from
   * one cache entry. Read here because the panel shows something the watcher
   * does not: what the extractor itself was unsure about.
   */
  const tracked = useJobProgress(props.labelId, undefined, started?.id);
  const job = tracked.data ?? started;
  const uncertainty = jobResultString(job, 'overallUncertaintyNl');
  /*
   * The two routes name their source differently — a URL job reports
   * `sourceUrl`, a document job reports `sourceRef`, which is the filename.
   * Reading only the first left a document extraction saying "nothing is
   * confirmed" without saying what had been read.
   */
  const source = jobResultString(job, 'sourceUrl') ?? jobResultString(job, 'sourceRef');
  const busy = fromUrl.isPending || fromDocument.isPending;

  const submitUrl = (): void => {
    const trimmed = url.trim();
    if (trimmed.length > 0) {
      fromUrl.mutate({ url: trimmed });
    }
  };
  const submitDocument = (): void => {
    if (file !== null) {
      fromDocument.mutate(file);
    }
  };

  return (
    <Card title="Opleidingskaart aanmaken" ariaLabel="Opleidingskaart aanmaken">
      <p className="c360-card__hint">
        Lees een opleidingspagina of een eigen document in. Er wordt een
        <strong> conceptkaart </strong>
        voorgesteld: elk veld krijgt de bron mee en blijft ongecontroleerd tot je het hieronder
        zelf bevestigt. Wat de bron niet vermeldt, blijft leeg — er wordt niets aangevuld.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitUrl();
        }}
      >
        <Field
          id="course-url"
          label="URL van de opleidingspagina"
          hint="Alleen https. De pagina wordt opgehaald door de server, niet door je browser."
          error={fromUrl.isError ? fromUrl.error.userMessage : undefined}
        >
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="c360-input"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          )}
        </Field>

        <div className="c360-row" style={{ marginTop: 'var(--c360-space-3)' }}>
          <Button variant="primary" type="submit" disabled={busy || url.trim().length === 0}>
            {fromUrl.isPending ? 'Bezig…' : 'Pagina lezen en kaart voorstellen'}
          </Button>
        </div>
      </form>

      <div style={{ marginTop: 'var(--c360-space-5)' }}>
        <Field
          id="course-document"
          label="Of een document (PDF, Word, tekst of Markdown)"
          hint="Een gescande PDF zonder tekstlaag levert niets op: er is geen tekstherkenning."
          error={fromDocument.isError ? fromDocument.error.userMessage : undefined}
        >
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="c360-input"
              type="file"
              accept=".pdf,.docx,.txt,.md"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          )}
        </Field>

        <div className="c360-row" style={{ marginTop: 'var(--c360-space-3)' }}>
          <Button disabled={busy || file === null} onClick={submitDocument}>
            {fromDocument.isPending ? 'Bezig…' : 'Document lezen en kaart voorstellen'}
          </Button>
        </div>
      </div>

      <JobWatcher
        labelId={props.labelId}
        job={started}
        doneLabel="De conceptkaart staat hieronder. Controleer elk veld voordat je de kaart goedkeurt."
        onRetry={file !== null && fromDocument.data !== undefined ? submitDocument : submitUrl}
      />

      {job?.status === 'succeeded' && (
        <Notice tone="warning">
          <strong>Niets is gecontroleerd.</strong>
          {source !== null && ` Gelezen van ${source}.`}
          {uncertainty !== null && ` De extractie meldt zelf: ${uncertainty}`}
        </Notice>
      )}
    </Card>
  );
}
