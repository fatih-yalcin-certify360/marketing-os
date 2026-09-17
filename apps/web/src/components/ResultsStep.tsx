import { useId, useState, type ReactNode } from 'react';
import type {
  ContentAssetVersion,
  FunnelStage,
  LearningWithEvidence,
  MarketingChannel,
  OutcomeReport,
  OutcomeSource,
  PublicationRecord,
} from '@c360/contracts';
import {
  CHANNEL_LABEL_NL,
  FUNNEL_STAGE_LABEL_NL,
  PRODUCIBLE_CHANNELS,
  funnelStage,
} from '@c360/contracts';
import { Badge, Button, Field, Notice } from '@c360/ui';
import {
  useApproveLearning,
  useCreateLearning,
  useLearnings,
  useOutcomes,
  usePublications,
  useRecordOutcome,
  useRecordPublication,
  useUploadOutcomeReport,
  type CampaignDetail,
} from '../api/campaign-queries.js';
import { MeasurementPlanPanel } from './ChannelPlanGrid.js';
import '../pages/campaign-flow.css';

/**
 * Stap 8: what happened, recorded by a person (P4-1, P4-2), per stage.
 *
 * This system publishes nothing, sends nothing and measures nothing. Three
 * things a person writes down here, in the order they happen:
 *
 *  1. **Publicaties** — "we published this version, there, then". The channel
 *     comes from the content, not from the form.
 *  2. **Gemeten resultaten** — figures read off a platform, with the period,
 *     how they were obtained and, when the report splits by stage, the stage.
 *     No ratio is computed or shown: a click-through rate invites a verdict
 *     the numbers do not support.
 *  3. **Lessen** — observation, hypothesis and the next test, citing the
 *     figures above. A learning is a draft until approved, and an approved one
 *     is *context* for the next campaign's plan and content — never an edit
 *     to a persona or a brand rule.
 *
 * The approved measurement plan sits at the top, so figures are recorded
 * against what was agreed rather than against whatever looks good afterwards.
 */
export function ResultsStep(props: {
  labelId: string;
  campaignId: string;
  detail: CampaignDetail;
  stages: readonly FunnelStage[];
  canWrite: boolean;
}): ReactNode {
  const { labelId, campaignId, detail, stages, canWrite } = props;
  const publications = usePublications(labelId, campaignId);
  const outcomes = useOutcomes(labelId, campaignId);
  const learnings = useLearnings(labelId);

  return (
    <div className="c360-stack">
      {detail.plan !== null && detail.plan.reviewState === 'approved' && (
        <MeasurementPlanPanel stages={stages} plan={detail.plan.plan} />
      )}

      <section aria-labelledby="publications-title">
        <h3 id="publications-title" className="c360-card__title" style={{ marginTop: 'var(--c360-space-4)' }}>
          Publicaties
        </h3>
        <p className="c360-card__hint">
          Goedgekeurd is niet gepubliceerd: dit systeem plaatst niets. Leg hier vast welke versie waar
          is gepubliceerd, zodat een resultaat later aan die versie kan hangen.
        </p>
        {publications.isError && <Notice tone="warning">{publications.error.userMessage}</Notice>}
        {publications.data !== undefined && publications.data.items.length > 0 && (
          <ul className="c360-list" style={{ marginTop: 'var(--c360-space-3)' }}>
            {publications.data.items.map((record) => (
              <PublicationRow key={record.id} record={record} assets={detail.assets} />
            ))}
          </ul>
        )}
        {canWrite && (
          <PublicationForm labelId={labelId} campaignId={campaignId} assets={detail.assets} />
        )}
      </section>

      <section aria-labelledby="outcomes-title">
        <h3 id="outcomes-title" className="c360-card__title" style={{ marginTop: 'var(--c360-space-5)' }}>
          Gemeten resultaten
        </h3>
        <p className="c360-card__hint">
          Cijfers zoals een platform ze rapporteert, met de periode en de herkomst. Een leeg veld
          betekent &quot;niet gerapporteerd&quot;, geen nul. Er wordt geen percentage of verhouding
          berekend: dat is rekenwerk op deze cijfers en leest te snel als oordeel.
        </p>
        {outcomes.isError && <Notice tone="warning">{outcomes.error.userMessage}</Notice>}
        {outcomes.data !== undefined && outcomes.data.items.length > 0 && (
          <OutcomeTable items={outcomes.data.items} />
        )}
        {canWrite && (
          <OutcomeForm
            labelId={labelId}
            campaignId={campaignId}
            stages={stages}
            channels={channelsOf(detail)}
            publications={publications.data?.items ?? []}
          />
        )}
      </section>

      <section aria-labelledby="learnings-title">
        <h3 id="learnings-title" className="c360-card__title" style={{ marginTop: 'var(--c360-space-5)' }}>
          Lessen voor de volgende campagne
        </h3>
        <p className="c360-card__hint">
          Wat je hebt gezien, wat je denkt dat het betekent en hoe je dat zou toetsen — drie velden,
          zodat een waarneming geen bewezen oorzaak wordt. Een goedgekeurde les gaat als context mee
          naar het volgende kanaalplan en de volgende content; ze verandert nooit zelf een doelgroep
          of een merkregel.
        </p>
        {learnings.isError && <Notice tone="warning">{learnings.error.userMessage}</Notice>}
        {learnings.data !== undefined && (
          <LearningList
            labelId={labelId}
            campaignId={campaignId}
            items={learnings.data.items}
            canWrite={canWrite}
          />
        )}
        {canWrite && (
          <LearningForm labelId={labelId} campaignId={campaignId} outcomes={outcomes.data?.items ?? []} />
        )}
      </section>
    </div>
  );
}

/** The channels this campaign actually used: planned or produced. */
function channelsOf(detail: CampaignDetail): MarketingChannel[] {
  const used = new Set<MarketingChannel>();
  for (const item of detail.plan?.plan.items ?? []) {
    used.add(item.channel);
  }
  for (const asset of detail.assets) {
    used.add(asset.channel);
  }
  return used.size === 0 ? [...PRODUCIBLE_CHANNELS] : PRODUCIBLE_CHANNELS.filter((channel) => used.has(channel));
}

function assetLabel(asset: ContentAssetVersion): string {
  const stage = asset.funnelStage === null ? '' : `${FUNNEL_STAGE_LABEL_NL[asset.funnelStage]} · `;
  return `${stage}${CHANNEL_LABEL_NL[asset.channel]} · v${String(asset.version)}`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );
}

// -------------------------------------------------------------- publications ---

function PublicationRow(props: {
  record: PublicationRecord;
  assets: readonly ContentAssetVersion[];
}): ReactNode {
  const { record, assets } = props;
  const asset = assets.find((candidate) => candidate.id === record.contentAssetVersionId);
  return (
    <li className="c360-list__item">
      <div style={{ minWidth: 0 }}>
        <p className="c360-list__title">
          {asset === undefined ? CHANNEL_LABEL_NL[record.channel] : assetLabel(asset)}
        </p>
        <p className="c360-list__subtitle">
          {`Gepubliceerd ${formatDate(record.publishedAt)}`}
          {record.externalUrl !== null && (
            <>
              {' · '}
              <a href={record.externalUrl} target="_blank" rel="noreferrer">
                bekijk
              </a>
            </>
          )}
          {record.noteNl !== null && ` · ${record.noteNl}`}
        </p>
      </div>
    </li>
  );
}

function PublicationForm(props: {
  labelId: string;
  campaignId: string;
  assets: readonly ContentAssetVersion[];
}): ReactNode {
  const ids = { asset: useId(), at: useId(), url: useId(), note: useId() };
  const record = useRecordPublication(props.labelId, props.campaignId);
  const [assetId, setAssetId] = useState('');
  const [publishedAt, setPublishedAt] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  // Approved content first: that is what normally goes out. Drafts are
  // offered too, because a person may publish a draft and must be able to
  // say so rather than being forced to lie about the version.
  const options = [...props.assets].sort((a, b) =>
    a.reviewState === b.reviewState ? 0 : a.reviewState === 'approved' ? -1 : 1,
  );

  if (options.length === 0) {
    return (
      <p className="c360-card__hint" style={{ marginTop: 'var(--c360-space-3)' }}>
        Er is nog geen content om een publicatie voor vast te leggen.
      </p>
    );
  }

  return (
    <form
      className="c360-stack"
      style={{ marginTop: 'var(--c360-space-4)' }}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (assetId.length === 0) {
          setError('Kies welke versie is gepubliceerd.');
          return;
        }
        if (publishedAt.length === 0) {
          setError('Vul in wanneer de publicatie plaatsvond.');
          return;
        }
        setError(undefined);
        record.mutate(
          {
            contentAssetVersionId: assetId,
            publishedAt: new Date(publishedAt).toISOString(),
            externalUrl: url.trim().length === 0 ? null : url.trim(),
            noteNl: note.trim().length === 0 ? null : note.trim(),
          },
          {
            onSuccess: () => {
              setAssetId('');
              setPublishedAt('');
              setUrl('');
              setNote('');
            },
          },
        );
      }}
    >
      <p className="c360-list__title" style={{ fontSize: '13px', margin: 0 }}>
        Publicatie vastleggen
      </p>
      <div className="results-form">
        <Field id={ids.asset} label="Welke versie">
          {(fieldProps) => (
            <select
              {...fieldProps}
              className="c360-select"
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
            >
              <option value="">Kies content…</option>
              {options.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {`${assetLabel(asset)}${asset.reviewState === 'approved' ? '' : ' (niet goedgekeurd)'}`}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id={ids.at} label="Wanneer gepubliceerd">
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="c360-input"
              type="datetime-local"
              value={publishedAt}
              onChange={(event) => setPublishedAt(event.target.value)}
            />
          )}
        </Field>
        <Field id={ids.url} label="Adres (optioneel)" hint="De openbare link naar het bericht of de pagina.">
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="c360-input"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          )}
        </Field>
        <Field id={ids.note} label="Notitie (optioneel)">
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="c360-input"
              value={note}
              maxLength={1_000}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="step-actions">
        <Button type="submit" disabled={record.isPending} busy={record.isPending}>
          Publicatie vastleggen
        </Button>
        {(error !== undefined || record.isError) && (
          <span className="c360-field__error" role="alert">
            {error ?? record.error?.userMessage}
          </span>
        )}
        {record.isSuccess && (
          <Notice tone="neutral" live>
            Publicatie vastgelegd.
          </Notice>
        )}
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ outcomes ---

function formatCount(value: number | null): string {
  return value === null ? '—' : new Intl.NumberFormat('nl-NL').format(value);
}

function formatSpend(cents: number | null): string {
  return cents === null
    ? '—'
    : new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

const SOURCE_NL: Readonly<Record<OutcomeSource, string>> = {
  platform_report: 'platformrapport',
  manual_entry: 'handmatig ingevoerd',
};

function OutcomeTable(props: { items: readonly OutcomeReport[] }): ReactNode {
  return (
    <div className="c360-table-scroll" style={{ marginTop: 'var(--c360-space-3)' }}>
      <table className="c360-table">
        <caption className="c360-visually-hidden">Gemeten resultaten per periode, kanaal en fase</caption>
        <thead>
          <tr>
            <th scope="col">Periode</th>
            <th scope="col">Kanaal</th>
            <th scope="col">Fase</th>
            <th scope="col">Impressies</th>
            <th scope="col">Kliks</th>
            <th scope="col">Aanmeldingen</th>
            <th scope="col">Uitgaven</th>
            <th scope="col">Herkomst</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => (
            <tr key={item.id}>
              <td>{`${item.periodStart} – ${item.periodEnd}`}</td>
              <td>{CHANNEL_LABEL_NL[item.channel]}</td>
              <td>{item.funnelStage === null ? 'niet gesplitst' : FUNNEL_STAGE_LABEL_NL[item.funnelStage]}</td>
              <td>{formatCount(item.impressions)}</td>
              <td>{formatCount(item.clicks)}</td>
              <td>{formatCount(item.signups)}</td>
              <td>{formatSpend(item.spendCents)}</td>
              <td>{SOURCE_NL[item.source]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseCount(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 'invalid';
}

function OutcomeForm(props: {
  labelId: string;
  campaignId: string;
  stages: readonly FunnelStage[];
  channels: readonly MarketingChannel[];
  publications: readonly PublicationRecord[];
}): ReactNode {
  const ids = {
    channel: useId(),
    stage: useId(),
    start: useId(),
    end: useId(),
    impressions: useId(),
    clicks: useId(),
    signups: useId(),
    spend: useId(),
    source: useId(),
    file: useId(),
    note: useId(),
  };
  const record = useRecordOutcome(props.labelId, props.campaignId);
  const upload = useUploadOutcomeReport(props.labelId);
  const [channel, setChannel] = useState<MarketingChannel | ''>(props.channels[0] ?? '');
  const [stage, setStage] = useState<FunnelStage | ''>('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [impressions, setImpressions] = useState('');
  const [clicks, setClicks] = useState('');
  const [signups, setSignups] = useState('');
  const [spend, setSpend] = useState('');
  const [source, setSource] = useState<OutcomeSource>('manual_entry');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const reset = (): void => {
    setStart('');
    setEnd('');
    setImpressions('');
    setClicks('');
    setSignups('');
    setSpend('');
    setFile(null);
    setNote('');
  };

  return (
    <form
      className="c360-stack"
      style={{ marginTop: 'var(--c360-space-4)' }}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const parsedCounts = {
          impressions: parseCount(impressions),
          clicks: parseCount(clicks),
          signups: parseCount(signups),
          spendCents: parseCount(
            spend.trim().length === 0 ? '' : String(Math.round(Number(spend.replace(',', '.')) * 100)),
          ),
        };
        const invalid = Object.values(parsedCounts).includes('invalid');
        const numeric = (value: number | null | 'invalid'): number | null => (value === 'invalid' ? null : value);
        const counts = {
          impressions: numeric(parsedCounts.impressions),
          clicks: numeric(parsedCounts.clicks),
          signups: numeric(parsedCounts.signups),
          spendCents: numeric(parsedCounts.spendCents),
        };
        if (channel === '') {
          setError('Kies een kanaal.');
          return;
        }
        if (start.length === 0 || end.length === 0) {
          setError('Vul de periode in: begin- en einddatum.');
          return;
        }
        if (invalid) {
          setError('Een aantal is een geheel getal van nul of hoger; uitgaven in euro.');
          return;
        }
        if (counts.impressions === null && counts.clicks === null && counts.signups === null && counts.spendCents === null) {
          setError('Vul minstens één gemeten waarde in.');
          return;
        }
        if (source === 'platform_report' && file === null) {
          setError('Kies het geëxporteerde rapport waar deze cijfers uit komen.');
          return;
        }
        setError(undefined);
        const submit = (reportAssetId: string | null): void => {
          record.mutate(
            {
              channel,
              funnelStage: stage === '' ? null : stage,
              periodStart: start,
              periodEnd: end,
              impressions: counts.impressions,
              clicks: counts.clicks,
              signups: counts.signups,
              spendCents: counts.spendCents,
              source,
              reportAssetId,
              noteNl: note.trim().length === 0 ? null : note.trim(),
            },
            { onSuccess: reset },
          );
        };
        if (source === 'platform_report' && file !== null) {
          upload.mutate(file, { onSuccess: (asset) => submit(asset.id) });
        } else {
          submit(null);
        }
      }}
    >
      <p className="c360-list__title" style={{ fontSize: '13px', margin: 0 }}>
        Resultaat vastleggen
      </p>
      <div className="results-form">
        <Field id={ids.channel} label="Kanaal">
          {(fieldProps) => (
            <select
              {...fieldProps}
              className="c360-select"
              value={channel}
              onChange={(event) => setChannel(event.target.value as MarketingChannel | '')}
            >
              {props.channels.map((option) => (
                <option key={option} value={option}>
                  {CHANNEL_LABEL_NL[option]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          id={ids.stage}
          label="Funnelfase"
          hint="Alleen als het rapport per fase splitst; anders leeg laten."
        >
          {(fieldProps) => (
            <select
              {...fieldProps}
              className="c360-select"
              value={stage}
              onChange={(event) => {
                const value = event.target.value;
                setStage(funnelStage.safeParse(value).success ? (value as FunnelStage) : '');
              }}
            >
              <option value="">Niet gesplitst</option>
              {props.stages.map((option) => (
                <option key={option} value={option}>
                  {FUNNEL_STAGE_LABEL_NL[option]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id={ids.start} label="Periode van">
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="c360-input"
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          )}
        </Field>
        <Field id={ids.end} label="Periode tot en met">
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="c360-input"
              type="date"
              value={end}
              min={start.length === 0 ? undefined : start}
              onChange={(event) => setEnd(event.target.value)}
            />
          )}
        </Field>
        <Field id={ids.impressions} label="Impressies" hint="Leeg = niet gerapporteerd.">
          {(fieldProps) => (
            <input {...fieldProps} className="c360-input" inputMode="numeric" value={impressions} onChange={(event) => setImpressions(event.target.value)} />
          )}
        </Field>
        <Field id={ids.clicks} label="Kliks">
          {(fieldProps) => (
            <input {...fieldProps} className="c360-input" inputMode="numeric" value={clicks} onChange={(event) => setClicks(event.target.value)} />
          )}
        </Field>
        <Field id={ids.signups} label="Aanmeldingen">
          {(fieldProps) => (
            <input {...fieldProps} className="c360-input" inputMode="numeric" value={signups} onChange={(event) => setSignups(event.target.value)} />
          )}
        </Field>
        <Field id={ids.spend} label="Uitgaven (€)" hint="Alleen bij betaalde kanalen.">
          {(fieldProps) => (
            <input {...fieldProps} className="c360-input" inputMode="decimal" value={spend} onChange={(event) => setSpend(event.target.value)} />
          )}
        </Field>
        <Field id={ids.source} label="Herkomst van de cijfers">
          {(fieldProps) => (
            <select
              {...fieldProps}
              className="c360-select"
              value={source}
              onChange={(event) => setSource(event.target.value as OutcomeSource)}
            >
              <option value="manual_entry">Handmatig afgelezen</option>
              <option value="platform_report">Uit een geëxporteerd platformrapport</option>
            </select>
          )}
        </Field>
        {source === 'platform_report' && (
          <Field
            id={ids.file}
            label="Het rapport"
            hint="PDF, Word of tekst. Het bestand is bewijs; de cijfers worden niet uit het bestand gelezen."
          >
            {(fieldProps) => (
              <input
                {...fieldProps}
                className="c360-input"
                type="file"
                accept=".pdf,.docx,.txt,.md,.csv"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            )}
          </Field>
        )}
        <div className="results-form__wide">
          <Field id={ids.note} label="Notitie (optioneel)">
            {(fieldProps) => (
              <input {...fieldProps} className="c360-input" value={note} maxLength={1_000} onChange={(event) => setNote(event.target.value)} />
            )}
          </Field>
        </div>
      </div>
      {props.publications.length === 0 && (
        <p className="c360-card__hint">
          Er is nog geen publicatie vastgelegd. Een resultaat kan ook zonder, per kanaal; leg de
          publicatie erbij vast als je later wilt weten bij welke versie een cijfer hoort.
        </p>
      )}
      <div className="step-actions">
        <Button type="submit" disabled={record.isPending || upload.isPending} busy={record.isPending || upload.isPending}>
          Resultaat vastleggen
        </Button>
        {(error !== undefined || record.isError || upload.isError) && (
          <span className="c360-field__error" role="alert">
            {error ?? record.error?.userMessage ?? upload.error?.userMessage}
          </span>
        )}
        {record.isSuccess && (
          <Notice tone="neutral" live>
            Resultaat vastgelegd.
          </Notice>
        )}
      </div>
    </form>
  );
}

// ----------------------------------------------------------------- learnings ---

function LearningList(props: {
  labelId: string;
  campaignId: string;
  items: readonly LearningWithEvidence[];
  canWrite: boolean;
}): ReactNode {
  const approve = useApproveLearning(props.labelId);
  const own = props.items.filter((item) => item.learning.originCampaignId === props.campaignId);
  const others = props.items.filter((item) => item.learning.originCampaignId !== props.campaignId);

  if (props.items.length === 0) {
    return (
      <p className="c360-card__hint" style={{ marginTop: 'var(--c360-space-3)' }}>
        Nog geen lessen voor dit label.
      </p>
    );
  }

  const row = (item: LearningWithEvidence): ReactNode => (
    <li className="c360-list__item" key={item.learning.id}>
      <div style={{ minWidth: 0 }}>
        <p className="c360-list__title">
          {item.learning.hypothesisNl}{' '}
          <Badge tone={item.learning.reviewState === 'approved' ? 'green' : 'neutral'}>
            {item.learning.reviewState === 'approved' ? 'Goedgekeurd' : 'Concept'}
          </Badge>{' '}
          {item.evidence.isThin && <Badge tone="amber">Dun onderbouwd</Badge>}
        </p>
        <p className="c360-list__subtitle">
          <strong>Waargenomen:</strong> {item.learning.observationNl}
        </p>
        <p className="c360-list__subtitle">
          <strong>Volgende test:</strong> {item.learning.nextTestNl}
        </p>
        <p className="c360-stat__caption">
          {item.evidence.isThin
            ? item.evidence.reasonsNl.join(' ')
            : `${String(item.evidence.outcomeCount)} metingen uit ${String(item.evidence.campaignCount)} campagnes over ${String(item.evidence.periodDays)} dagen.`}
        </p>
      </div>
      {props.canWrite && item.learning.reviewState !== 'approved' && (
        <Button
          disabled={approve.isPending}
          onClick={() => {
            approve.mutate({ learningId: item.learning.id });
          }}
        >
          Les goedkeuren
        </Button>
      )}
    </li>
  );

  return (
    <div className="c360-stack" style={{ marginTop: 'var(--c360-space-3)' }}>
      {own.length > 0 && <ul className="c360-list">{own.map(row)}</ul>}
      {others.length > 0 && (
        <details>
          <summary>{`Lessen uit andere campagnes van dit label (${String(others.length)})`}</summary>
          <ul className="c360-list">{others.map(row)}</ul>
        </details>
      )}
      {approve.isError && (
        <span className="c360-field__error" role="alert">
          {approve.error.userMessage}
        </span>
      )}
    </div>
  );
}

function LearningForm(props: {
  labelId: string;
  campaignId: string;
  outcomes: readonly OutcomeReport[];
}): ReactNode {
  const ids = { observation: useId(), hypothesis: useId(), test: useId() };
  const create = useCreateLearning(props.labelId);
  const [observation, setObservation] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [nextTest, setNextTest] = useState('');
  const [evidence, setEvidence] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <form
      className="c360-stack"
      style={{ marginTop: 'var(--c360-space-4)' }}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (observation.trim().length < 20 || hypothesis.trim().length < 20 || nextTest.trim().length < 10) {
          setError(
            'Schrijf een waarneming en een hypothese van minstens twintig tekens, en een volgende test van minstens tien.',
          );
          return;
        }
        setError(undefined);
        create.mutate(
          {
            originCampaignId: props.campaignId,
            observationNl: observation.trim(),
            hypothesisNl: hypothesis.trim(),
            nextTestNl: nextTest.trim(),
            outcomeReportIds: [...evidence],
          },
          {
            onSuccess: () => {
              setObservation('');
              setHypothesis('');
              setNextTest('');
              setEvidence(new Set());
            },
          },
        );
      }}
    >
      <p className="c360-list__title" style={{ fontSize: '13px', margin: 0 }}>
        Les vastleggen
      </p>
      <Field id={ids.observation} label="Wat heb je gezien?" hint="De meting, niet de conclusie.">
        {(fieldProps) => (
          <textarea {...fieldProps} className="c360-textarea" rows={2} maxLength={1_000} value={observation} onChange={(event) => setObservation(event.target.value)} />
        )}
      </Field>
      <Field id={ids.hypothesis} label="Wat denk je dat het betekent?" hint="Nadrukkelijk een hypothese.">
        {(fieldProps) => (
          <textarea {...fieldProps} className="c360-textarea" rows={2} maxLength={1_000} value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} />
        )}
      </Field>
      <Field id={ids.test} label="Hoe zou je dat toetsen?" hint="Een hypothese die niemand kan toetsen is een mening.">
        {(fieldProps) => (
          <textarea {...fieldProps} className="c360-textarea" rows={2} maxLength={600} value={nextTest} onChange={(event) => setNextTest(event.target.value)} />
        )}
      </Field>
      {props.outcomes.length > 0 && (
        <fieldset className="c360-fieldset">
          <legend>Op welke metingen rust dit?</legend>
          <p className="c360-fieldset__help">
            Niet verplicht — een les mag kwalitatief zijn — maar zonder metingen wordt ze als dun
            onderbouwd getoond.
          </p>
          {props.outcomes.map((outcome) => (
            <label key={outcome.id} className="c360-row" style={{ gap: 'var(--c360-space-2)' }}>
              <input
                type="checkbox"
                checked={evidence.has(outcome.id)}
                onChange={(event) => {
                  setEvidence((previous) => {
                    const next = new Set(previous);
                    if (event.target.checked) {
                      next.add(outcome.id);
                    } else {
                      next.delete(outcome.id);
                    }
                    return next;
                  });
                }}
              />
              <span>
                {`${outcome.periodStart} – ${outcome.periodEnd} · ${CHANNEL_LABEL_NL[outcome.channel]}${
                  outcome.funnelStage === null ? '' : ` · ${FUNNEL_STAGE_LABEL_NL[outcome.funnelStage]}`
                }`}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="step-actions">
        <Button type="submit" disabled={create.isPending} busy={create.isPending}>
          Les vastleggen als concept
        </Button>
        {(error !== undefined || create.isError) && (
          <span className="c360-field__error" role="alert">
            {error ?? create.error?.userMessage}
          </span>
        )}
        {create.isSuccess && (
          <Notice tone="neutral" live>
            Les vastgelegd als concept. Keur haar goed om haar mee te laten wegen in volgende voorstellen.
          </Notice>
        )}
      </div>
    </form>
  );
}
