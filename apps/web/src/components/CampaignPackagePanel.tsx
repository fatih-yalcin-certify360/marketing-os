import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  FUNNEL_STAGE_LABEL_NL,
  type CampaignDeliverable,
  type CampaignPackageRun,
  type JobSummary,
  type PackagePreview,
  type PackageReadiness,
} from '@c360/contracts';
import { Badge, Button, Card, Disclosure, Notice, Tabs } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { PackageEvidencePanel } from './PackageEvidencePanel.js';

/**
 * The Website & interactief branch of a campaign (rewritten 2026-09-15).
 *
 * The first version of this panel was one card with a disabled button and,
 * when a gate was closed, one sentence; a person could not tell whether the
 * branch was broken or waiting, and the only way to see the keuzehulp it
 * made was to download a ZIP. This version says which of the four gates is
 * open and what to do about the closed ones, walks the three actions in
 * order (propose forms → choose → make), and shows every produced page in a
 * sandboxed frame on the screen — the quiz can be played here — with the
 * embed snippet for the course page next to it. When the briefing's call to
 * action promises a keuzehulp, the panel says so until one exists.
 */

const LABELS: Record<CampaignDeliverable, string> = {
  blog_faq: 'Blog met FAQ',
  fit_check: 'Keuzehulp (interactieve quiz)',
  google_studio: 'Google Studio-bannerset (rich media, geen Google Ads)',
};
const DESCRIPTIONS: Record<CampaignDeliverable, string> = {
  blog_faq: 'Een artikel dat één vraag van de doelgroep beantwoordt, met veelgestelde vragen en de link naar de opleidingspagina.',
  fit_check: 'Drie tot vijf vragen over de eigen situatie; per antwoord een korte reactie en aan het eind een uitkomst met vervolgstappen en de link naar de opleiding. Geen score, geen toelatingstest.',
  google_studio: 'Interactieve HTML5-banners voor Google Studio (300×250, 336×280, 300×600). Zoekadvertenties voor Google Ads maak je in stap 6 via het kanaalplan.',
};
const TERMINAL = new Set(['succeeded', 'failed', 'dead', 'cancelled']);

type View = 'compose' | 'results';

export function CampaignPackagePanel(props: {
  labelId: string;
  campaignId: string;
  ready: boolean;
  canEdit: boolean;
  canReview: boolean;
  onSocial: () => void;
}): ReactNode {
  const { labelId, campaignId, canEdit, canReview } = props;
  const [view, setView] = useState<View>('compose');
  const base = `/labels/${labelId}/campaigns/${campaignId}/packages`;
  const [interactionStyle, setInteractionStyle] = useState<'scenario' | 'dilemma' | 'priorities'>('scenario');
  const [selected, setSelected] = useState<CampaignDeliverable[]>([]);
  const ids = { compose: useId(), results: useId(), style: useId() };

  const data = useQuery<{ items: CampaignPackageRun[]; latestJob: JobSummary | null; readiness: PackageReadiness }, ApiClientError>({
    queryKey: ['campaign-packages', labelId, campaignId],
    queryFn: ({ signal }) => api.get(base, signal),
    refetchInterval: (query) =>
      query.state.data?.latestJob && !TERMINAL.has(query.state.data.latestJob.status) ? 2000 : false,
  });
  const produce = useMutation<JobSummary, ApiClientError, 'recommend' | 'generate'>({
    mutationFn: (mode) => api.post(base, { mode, interactionStyle, selected: mode === 'recommend' ? [] : selected }),
    onSuccess: (_job, mode) => {
      if (mode === 'recommend') setSelected([]);
      else setView('results');
      void data.refetch();
    },
  });
  const action = useMutation<unknown, ApiClientError, 'retry' | 'cancel'>({
    mutationFn: (kind) => api.post(`/jobs/${String(data.data?.latestJob?.id)}/${kind}`),
    onSuccess: () => {
      void data.refetch();
    },
  });

  const latestJob = data.data?.latestJob ?? null;
  const busy = produce.isPending || (latestJob !== null && !TERMINAL.has(latestJob.status));
  const readiness = data.data?.readiness;
  const ready = readiness?.ok ?? props.ready;
  const recommendations = data.data?.items.find((item) => item.report.recommendations && !item.stale)?.report.recommendations;
  const packages = data.data?.items.filter((item) => item.report.content) ?? [];
  const hasQuiz = packages.some((item) => !item.stale && item.report.selected.includes('fit_check'));
  const error = produce.error ?? data.error ?? action.error;

  return (
    <Card title="Website & interactief" description="Een zijtak van dezelfde campagne: blog, keuzehulp en bannerset lezen dezelfde goedgekeurde briefing, doelgroepen en kanaalplan, en gaan als apart pakket mee." ariaLabel="Campagnepakket">
      <Disclosure summary="Hoe werkt deze tak?">
        <p>
          De website-vormen vullen de kanalen uit het kanaalplan aan; ze zijn geen stap in de keten. Eerst laat je
          het systeem zeggen welke vormen bij deze briefing passen en voor welke funnelfase. Dan kies je, en maakt
          het systeem het pakket in de goedgekeurde huisstijl: kleuren, fonts, logo en copyregels uit de actuele
          merkversie. Je bekijkt het resultaat hier, speelt de keuzehulp door, en zet hem met de embed-code op de
          opleidingspagina. SEO-effect en interactie meet je na plaatsing; het systeem voorspelt niets.
        </p>
      </Disclosure>

      {readiness !== undefined && (
        <section aria-label="Voorwaarden voor deze tak" className="package-readiness">
          <ul className="package-readiness__list">
            {readiness.checks.map((check) => (
              <li key={check.id} className={check.ok ? 'is-ok' : 'is-open'}>
                <Badge tone={check.ok ? 'green' : 'amber'}>{check.ok ? 'Klaar' : 'Nog te doen'}</Badge>{' '}
                <span>{check.labelNl}</span>
                {check.hintNl !== null && <span className="c360-card__hint"> — {check.hintNl}</span>}
              </li>
            ))}
          </ul>
          {readiness.interactivePromised && !hasQuiz && (
            <Notice tone="warning">
              De briefing belooft een keuzehulp of quiz in de call to action. Maak hem hier, anders verwijzen de
              berichten naar iets wat er niet is. De link in de campagne blijft de opleidingspagina, waar je de
              keuzehulp met de embed-code plaatst.
            </Notice>
          )}
          {readiness.interactivePromised && hasQuiz && (
            <Notice tone="neutral">
              De keuzehulp die de briefing belooft, is gemaakt. Plaats hem met de embed-code op de opleidingspagina,
              dan komt elke call to action uit de campagne op de juiste plek uit.
            </Notice>
          )}
        </section>
      )}

      <Tabs
        label="Campagnepakket"
        value={view}
        onChange={(id) => {
          setView(id as View);
        }}
        items={[
          { id: 'compose', label: 'Samenstellen', panelId: ids.compose },
          { id: 'results', label: 'Gemaakte pakketten', count: packages.length, panelId: ids.results },
        ]}
      />

      <div role="tabpanel" id={ids.compose} aria-label="Samenstellen" hidden={view !== 'compose'} className="c360-stack">
        {data.data?.items[0]?.report.brand.portal?.warnings.map((warning, index) => (
          <Notice key={index} tone="warning">
            {warning}
          </Notice>
        ))}

        <div className="package-step">
          <h3 className="package-step__title">1. Welke vormen passen bij deze briefing?</h3>
          <p className="c360-card__hint">
            Het systeem leest de goedgekeurde briefing, de doelgroepen en het kanaalplan en zegt per vorm welke fase
            hij dient, wat er getoetst wordt en hoe je dat meet. Eén AI-aanroep.
          </p>
          <Button
            variant={recommendations ? 'secondary' : 'primary'}
            icon="sparkles"
            disabled={!ready || !canEdit || busy}
            onClick={() => {
              produce.mutate('recommend');
            }}
          >
            {recommendations ? 'Opnieuw laten voorstellen' : 'Welke content past bij deze briefing?'}
          </Button>
          {recommendations && (
            <div className="package-recommendations">
              {recommendations.items.map((item) => (
                <section key={item.type} className="package-recommendation">
                  <h4>
                    {LABELS[item.type]}{' '}
                    {item.stage !== null && <Badge tone="neutral">{FUNNEL_STAGE_LABEL_NL[item.stage]}</Badge>}
                  </h4>
                  <p>{item.reason}</p>
                  <p>
                    <strong>Te toetsen:</strong> {item.hypothesis}
                  </p>
                  <p>
                    <strong>Meten:</strong> {item.measurement}
                  </p>
                </section>
              ))}
              <p className="c360-card__hint">{recommendations.visualAdvice}</p>
            </div>
          )}
        </div>

        <div className="package-step">
          <h3 className="package-step__title">2. Kies de onderdelen</h3>
          {/*
            The proposal is advice; the choice is the person's.
            
            These boxes used to be disabled unless the model had proposed the
            form, and the legend said that wanting something else meant changing
            the briefing first. That inverts who is in charge: a suggestion
            became a lock, and the way round it was to rewrite an approved
            document. The channel plan already settles this the other way — a
            discouraged cell can be ticked with the advice still beside it — and
            this is the same question (2026-09-16).
            
            So every form is selectable, always, and what the model thought is
            shown next to it with its reason. Recommending and permitting are
            different acts.
          */}
          <fieldset className="package-choices" disabled={!ready || !canEdit || busy}>
            <legend className="c360-card__hint">
              {recommendations
                ? 'Wat is voorgesteld staat erbij, met de reden. Je kunt alles kiezen — ook wat niet is voorgesteld.'
                : 'Kies wat je wilt maken. Laat eerst voorstellen als je advies wilt.'}
            </legend>
            {(Object.keys(LABELS) as CampaignDeliverable[]).map((type) => {
              const advice = recommendations?.items.find((item) => item.type === type);
              return (
                <label key={type} className="package-choice">
                  <input
                    type="checkbox"
                    checked={selected.includes(type)}
                    onChange={(event) => {
                      setSelected(event.target.checked ? [...selected, type] : selected.filter((item) => item !== type));
                    }}
                  />
                  <span>
                    <strong>{LABELS[type]}</strong>
                    {recommendations && (
                      <Badge tone={advice ? 'green' : 'neutral'}>
                        {advice ? 'Aanbevolen' : 'Niet voorgesteld'}
                      </Badge>
                    )}
                    <br />
                    <span className="c360-card__hint">{DESCRIPTIONS[type]}</span>
                    {advice?.reason !== undefined && (
                      <>
                        <br />
                        <span className="c360-card__hint"><em>{advice.reason}</em></span>
                      </>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
          {selected.includes('fit_check') && (
            <label className="c360-field" htmlFor={ids.style}>
              Vorm van de keuzehulp
              <select
                id={ids.style}
                className="c360-select"
                value={interactionStyle}
                disabled={busy}
                onChange={(event) => {
                  setInteractionStyle(event.target.value as typeof interactionStyle);
                }}
              >
                <option value="scenario">Praktijkscenario — wat zou jij doen?</option>
                <option value="dilemma">Dilemma — welke afweging herken jij?</option>
                <option value="priorities">Prioriteiten — wat wil je veranderen?</option>
              </select>
              <span className="c360-card__hint">
                Elke vraag heeft drie antwoorden die elk een signaal geven (past nu · eerst verkennen · andere
                richting). De uitkomst volgt uit de meerderheid; bij twijfel adviseert de keuzehulp verder verkennen.
              </span>
            </label>
          )}
        </div>

        <div className="package-step">
          <h3 className="package-step__title">3. Maak het pakket</h3>
          <div className="c360-row">
            <Button
              variant="primary"
              icon="sparkles"
              disabled={
                !ready ||
                !canEdit ||
                busy ||
                selected.length === 0 ||
                !recommendations ||
                selected.some((type) => !recommendations.items.some((item) => item.type === type))
              }
              onClick={() => {
                produce.mutate('generate');
              }}
            >
              Maak gekozen campagnepakket
            </Button>
            <Button variant="ghost" disabled={!ready} onClick={props.onSocial}>
              Naar het kanaalplan (stap 5)
            </Button>
          </div>
          <p className="c360-card__hint">
            Eén AI-aanroep; het pakket wordt in de huisstijl gebouwd en hier getoond. Kleuren, fonts en logo komen uit
            de goedgekeurde merkversie.
          </p>
        </div>

        {busy && latestJob !== null && (
          <Notice tone="info" live>
            {latestJob.progress?.message ?? 'Productie wordt gestart…'}
          </Notice>
        )}
        {error && <Notice tone="warning">{error.userMessage}</Notice>}
        {latestJob?.failureMessage && <Notice tone="warning">{latestJob.failureMessage}</Notice>}
        <div className="c360-row">
          {canEdit && busy && (
            <Button
              size="sm"
              onClick={() => {
                action.mutate('cancel');
              }}
              disabled={action.isPending}
            >
              Annuleren
            </Button>
          )}
          {canEdit && latestJob?.retryable && (
            <Button
              size="sm"
              onClick={() => {
                action.mutate('retry');
              }}
              disabled={action.isPending}
            >
              Opnieuw proberen
            </Button>
          )}
        </div>
      </div>

      <div role="tabpanel" id={ids.results} aria-label="Gemaakte pakketten" hidden={view !== 'results'} className="c360-stack">
        {packages.length === 0 && !busy && (
          <p className="c360-card__hint">
            Nog geen pakket gemaakt. Kies onder Samenstellen de gewenste onderdelen. Gemeten resultaten van de
            website-vormen leg je vast onder 8. Resultaten &amp; lessen.
          </p>
        )}
        {packages.map((item) => (
          <PackageResult key={item.id} run={item} labelId={labelId} campaignId={campaignId} canReview={canReview} base={base} />
        ))}
      </div>
    </Card>
  );
}

function PackageResult(props: {
  run: CampaignPackageRun;
  labelId: string;
  campaignId: string;
  canReview: boolean;
  base: string;
}): ReactNode {
  const { run } = props;
  const content = run.report.content!;
  const [part, setPart] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const preview = useQuery<PackagePreview, ApiClientError>({
    queryKey: ['campaign-package-preview', props.labelId, props.campaignId, run.id],
    queryFn: ({ signal }) => api.get(`${props.base}/${run.id}/preview`, signal),
    staleTime: 5 * 60_000,
  });
  // No effect needed: an unset choice means the first part.
  const current = preview.data?.parts.find((entry) => entry.id === part) ?? preview.data?.parts[0];
  const ids = { frame: useId() };

  return (
    <section className="package-result" aria-label={content.title}>
      <div className="package-result__head">
        <h3>{content.title}</h3>
        <div className="c360-row" style={{ gap: 'var(--c360-space-1)' }}>
          <Badge tone={run.stale ? 'amber' : 'neutral'}>{run.stale ? 'Briefing of merk gewijzigd' : 'Concept · controleren'}</Badge>
          {run.report.isMock && <Badge tone="amber">Demodata</Badge>}
          {run.report.selected.map((type) => (
            <Badge key={type} tone="purple">
              {LABELS[type]}
            </Badge>
          ))}
        </div>
      </div>
      <p className="c360-card__hint">
        Merkversie {run.report.brand.version} · {run.report.brand.portal?.release ?? 'handmatig goedgekeurd'} ·{' '}
        {new Date(run.createdAt).toLocaleString('nl-NL')}
      </p>

      {preview.isPending && <p className="c360-card__hint">Voorvertoning wordt gebouwd…</p>}
      {preview.error && <Notice tone="warning">{preview.error.userMessage}</Notice>}
      {preview.data && preview.data.parts.length > 0 && (
        <div className="package-preview">
          <Tabs
            size="sm"
            label="Voorvertoning"
            value={current?.id ?? ''}
            onChange={setPart}
            items={preview.data.parts.map((entry) => ({ id: entry.id, label: entry.titleNl, panelId: ids.frame }))}
          />
          {current && (
            <iframe
              id={ids.frame}
              className="package-preview__frame"
              title={`Voorvertoning: ${current.titleNl}`}
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              srcDoc={current.html}
            />
          )}
          <p className="c360-card__hint">{preview.data.noteNl}</p>
          {preview.data.embedHtml !== null && (
            <Disclosure summary="Embed-code voor de opleidingspagina">
              <p className="c360-card__hint">
                Host de map <code>keuzehulp/</code> uit het ZIP-pakket op de eigen website en plak dit op de
                opleidingspagina. De link in de keuzehulp draagt utm-parameters (bron keuzehulp), zodat het bezoek
                in de webanalyse herkenbaar is.
              </p>
              <textarea className="c360-textarea package-embed" readOnly rows={4} value={preview.data.embedHtml} aria-label="Embed-code" />
              <Button
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(preview.data?.embedHtml ?? '').then(() => {
                    setCopied(true);
                  });
                }}
              >
                {copied ? 'Gekopieerd' : 'Kopieer embed-code'}
              </Button>
            </Disclosure>
          )}
        </div>
      )}

      <div className="c360-row">
        {!run.stale && (
          <a className="c360-button c360-button--secondary c360-button--sm" href={`/api/v1${props.base}/${run.id}/file`}>
            Download ZIP-pakket
          </a>
        )}
      </div>
      <PackageEvidencePanel run={run} labelId={props.labelId} canReview={props.canReview} />
      <Disclosure summary="Herkomst: bron → briefing → dit pakket">
        <p className="c360-card__hint">
          Radar: {run.report.sourceRadarRunId ?? 'geen radarscan gekoppeld'} · briefing {run.report.briefVersionId.slice(0, 8)} ·
          opleiding {run.report.courseName} · bestemming {run.report.courseUrl}
        </p>
        {content.reviewNotes.length > 0 && (
          <ul className="c360-list">
            {content.reviewNotes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        )}
      </Disclosure>
    </section>
  );
}
