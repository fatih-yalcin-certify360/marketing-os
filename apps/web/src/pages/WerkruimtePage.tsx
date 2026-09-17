import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  AttentionItem,
  AttentionKind,
  CampaignImpact,
  ImpactSeverity,
  LabelSummary,
  SourceImpactReport,
  WorkspaceOverview,
} from '@c360/contracts';
import { Badge, EmptyState, Icon, Notice } from '@c360/ui';
import { useBudget, useSourceImpact, useWorkspace } from '../api/queries.js';
import { JobsPanel } from './JobsPanel.js';
import { ErrorState, LoadingState } from '../components/states.js';

/**
 * Werkruimte — pattern A.
 *
 * The start of a working day on a label, in the order the questions actually
 * arrive: what is waiting on a decision from me, where does this label stand,
 * and what is running in the background.
 *
 * The queue is sorted by what blocks a decision rather than by date, because a
 * date tells you when something happened and not whether anyone can move. Every
 * figure comes from the server; where a module has not landed the tile says
 * what is missing instead of showing a number that would read as a measurement.
 */
export function WerkruimtePage(props: { label: LabelSummary | undefined }): ReactNode {
  const workspace = useWorkspace(props.label?.id);
  const budget = useBudget(props.label?.id);
  const impact = useSourceImpact(props.label?.id);
  const [filter, setFilter] = useState<QueueFilter>('all');

  if (props.label === undefined) {
    return (
      <div className="os-page">
        <Notice tone="warning">
          Je hebt nog geen toegang tot een label. Vraag een labelbeheerder om je toe te voegen.
        </Notice>
      </div>
    );
  }

  if (workspace.isPending) {
    return (
      <div className="os-page">
        <LoadingState label="Werkruimte wordt geladen" />
      </div>
    );
  }
  if (workspace.isError) {
    return (
      <div className="os-page">
        <ErrorState
          message={workspace.error.userMessage}
          requestId={workspace.error.requestId}
          onRetry={() => void workspace.refetch()}
        />
      </div>
    );
  }

  const overview: WorkspaceOverview = workspace.data;
  const canEdit = props.label.role !== 'label_viewer';
  const { readiness } = overview;
  const queue = overview.attention.filter((item) => matchesFilter(item, filter));

  return (
    <div className="os-page">
      <header className="os-page__head">
        <div className="os-page__head-text">
          <p className="os-eyebrow">{`Werkruimte · ${overview.labelName}`}</p>
          <h1 className="c360-page-title">{`${salutation()}, ${overview.greetingName}.`}</h1>
          <p className="c360-page-lead">{leadFor(overview.attention.length)}</p>
        </div>
        {canEdit && (
          <div className="os-page__actions">
            <Link className="c360-button c360-button--secondary" to="/radar">
              <Icon name="search" size={14} />
              Marktradar scannen
            </Link>
            <Link className="c360-button c360-button--primary" to="/campagnes">
              Nieuwe campagne
            </Link>
          </div>
        )}
      </header>

      <div className="os-kpis">
        <Kpi
          label="Klaar voor review"
          value={overview.counters.readyForReview}
          caption="Content wacht op beoordeling"
          to="/content"
          linkNl="Naar Content Studio"
        />
        <Kpi
          label="Actie nodig"
          value={overview.counters.actionRequired}
          caption="Broncontrole of afgebroken taken"
          tone={overview.counters.actionRequired > 0 ? 'warn' : 'neutral'}
          to="/beheer/opleidingen"
          linkNl="Naar Opleidingen"
        />
        <Kpi
          label="Actieve campagnes"
          value={readiness.activeCampaignCount}
          caption="Campagnes die nog niet zijn afgerond"
          tone="ok"
          to="/campagnes"
          linkNl="Naar campagnes"
        />
        <Kpi
          label="Gepland deze week"
          value={overview.counters.plannedThisWeek}
          caption="Planningsmodule nog niet gebouwd; de planning per campagne staat bij Kanaalplan"
          tone="neutral"
          to="/kalender"
          linkNl="Wat er wel is"
        />
      </div>

      <div className="c360-grid-main">
        <div className="c360-stack">
          <section className="os-panel" aria-label="Wachtrij">
            <div className="os-panel__head">
              <div>
                <h2 className="os-panel__title">Wachtrij</h2>
                <p className="os-panel__sub">Op volgorde van wat een besluit blokkeert.</p>
              </div>
              <div className="os-filters">
                {QUEUE_FILTERS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="os-filter"
                    aria-pressed={filter === entry.id}
                    onClick={() => {
                      setFilter(entry.id);
                    }}
                  >
                    {entry.labelNl}
                    <span className="os-filter__count">
                      {overview.attention.filter((item) => matchesFilter(item, entry.id)).length}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {queue.length === 0 ? (
              <div style={{ padding: 14 }}>
                <EmptyState
                  compact
                  icon="check"
                  title={filter === 'all' ? 'Er staat niets open' : 'Niets in dit filter'}
                  body={
                    filter === 'all'
                      ? 'Zodra content klaar is voor beoordeling of een bron is gewijzigd, verschijnt het hier met een directe link naar de campagne.'
                      : 'Er is op dit moment niets van deze soort. Zet het filter op Alles om de rest te zien.'
                  }
                />
              </div>
            ) : (
              <ul className="os-queue">
                {queue.map((item, index) => (
                  <QueueRow key={`${item.kind}-${String(index)}`} item={item} />
                ))}
              </ul>
            )}

            <div className="os-panel__foot">
              <Link to="/content">Alles in Content Studio openen</Link>
            </div>
          </section>

          <SourceImpactCard report={impact.data} />

          <JobsPanel label={props.label} />
        </div>

        <div className="c360-stack">
          <section className="os-panel os-panel--pad" aria-label="Fundament van dit label">
            <h2 className="os-panel__title">Fundament van dit label</h2>
            <p className="os-panel__sub" style={{ marginBottom: 10 }}>
              Wat elke campagne nodig heeft voordat ze kan starten.
            </p>
            <FoundationRow
              term="Merkprofiel"
              note={<Link to="/beheer/merk">Merk &amp; bronnen</Link>}
              value={
                readiness.hasApprovedBrandProfile ? (
                  <Badge tone="green" icon="check">
                    Goedgekeurd
                  </Badge>
                ) : (
                  <Badge tone="amber">Nog niet vastgelegd</Badge>
                )
              }
            />
            <FoundationRow
              term="Opleidingen"
              note={
                readiness.unconfirmedCourseCount > 0 ? (
                  <>
                    {`${String(readiness.unconfirmedCourseCount)} nog te controleren · `}
                    <Link to="/beheer/opleidingen">Opleidingen</Link>
                  </>
                ) : (
                  <Link to="/beheer/opleidingen">Opleidingen</Link>
                )
              }
              value={
                <Badge tone={readiness.confirmedCourseCount > 0 ? 'green' : 'amber'}>
                  {`${String(readiness.confirmedCourseCount)} gecontroleerd`}
                </Badge>
              }
            />
            <FoundationRow
              term="Doelgroepen"
              note={<Link to="/beheer/doelgroepen">Doelgroepen</Link>}
              value={
                <Badge tone={readiness.approvedPersonaCount > 0 ? 'green' : 'amber'}>
                  {`${String(readiness.approvedPersonaCount)} goedgekeurd`}
                </Badge>
              }
            />
          </section>

          <section className="os-panel os-panel--pad" aria-label="AI-budget">
            <div className="c360-row" style={{ justifyContent: 'space-between' }}>
              <h2 className="os-panel__title">AI-budget</h2>
              <span className="os-num" style={{ fontSize: 11, color: 'var(--tx-3)' }}>
                deze maand
              </span>
            </div>
            {budget.isSuccess ? (
              <>
                <div
                  style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8 }}
                >
                  <span className="os-num" style={{ fontSize: 22, fontWeight: 600 }}>
                    {formatEuro(budget.data.availableCents)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>
                    {`van ${formatEuro(budget.data.budgetCents)}`}
                  </span>
                </div>
                <div className="c360-progress" style={{ margin: '9px 0 6px' }}>
                  <div
                    className="c360-progress__bar"
                    style={{ width: `${String(spentPercent(budget.data))}%` }}
                  />
                </div>
                <p className="os-panel__sub">
                  {`${formatEuro(budget.data.reservedCents)} gereserveerd voor taken die nu draaien`}
                </p>
              </>
            ) : (
              <p className="os-panel__sub" style={{ marginTop: 8 }}>
                {budget.isError ? 'Budget is niet op te halen.' : 'Budget wordt geladen.'}
              </p>
            )}
          </section>

          <section className="os-panel os-panel--tint os-panel--pad" aria-label="Zo werkt de controle">
            <h2 className="os-panel__title" style={{ color: 'var(--lp-ink)' }}>
              Automatisering met controle
            </h2>
            <p
              style={{
                margin: '5px 0 0',
                fontSize: 11.5,
                color: 'var(--lp-ink)',
                lineHeight: 1.55,
              }}
            >
              Het systeem onderzoekt, stelt voor en schrijft; een persoon keurt elke stap goed. Er
              wordt niets automatisch gepubliceerd en geen opleidingsfeit gebruikt dat niet is
              gecontroleerd.
            </p>
          </section>

          {overview.containsDemoData && (
            <Notice tone="warning">
              Dit label bevat gemarkeerde demo-data. Merk-, opleidings- en prijsinformatie is nog niet
              aangeleverd en wordt niet door het systeem verzonnen.
            </Notice>
          )}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- queue ---

type QueueFilter = 'all' | 'review' | 'problem';

const QUEUE_FILTERS: readonly { id: QueueFilter; labelNl: string }[] = Object.freeze([
  { id: 'all', labelNl: 'Alles' },
  { id: 'review', labelNl: 'Review' },
  { id: 'problem', labelNl: 'Problemen' },
]);

/** Which kinds count as a problem rather than as ordinary review work. */
const PROBLEM_KINDS: ReadonlySet<AttentionKind> = new Set<AttentionKind>([
  'needs_source_check',
  'job_failed',
  'budget_low',
]);

function matchesFilter(item: AttentionItem, filter: QueueFilter): boolean {
  if (filter === 'all') return true;
  return filter === 'problem' ? PROBLEM_KINDS.has(item.kind) : !PROBLEM_KINDS.has(item.kind);
}

const KIND_ICON: Readonly<Record<AttentionKind, 'check' | 'info' | 'alert'>> = Object.freeze({
  ready_for_review: 'check',
  needs_rereview: 'check',
  needs_source_check: 'info',
  job_failed: 'alert',
  budget_low: 'alert',
});

function QueueRow(props: { item: AttentionItem }): ReactNode {
  const { item } = props;
  const icon = KIND_ICON[item.kind];
  const problem = PROBLEM_KINDS.has(item.kind);

  return (
    <li className="os-queue__row">
      <span className={`os-queue__mark os-queue__mark--${icon}`} aria-hidden="true">
        <Icon name={icon} size={13} />
      </span>
      <div className="os-queue__text">
        <p className="os-queue__title">
          {item.campaignId === null ? (
            item.title
          ) : (
            <Link to={`/campagnes/${item.campaignId}?fase=content`}>{item.title}</Link>
          )}
        </p>
        <p className="os-queue__sub">{item.subtitle}</p>
        {problem && <p className="os-note os-note--warn">{reasonFor(item)}</p>}
      </div>
      <div className="os-queue__side">
        <span className="os-num os-queue__age" title={`Bijgewerkt op ${formatMoment(item.updatedAt)}`}>
          {age(item.updatedAt)}
        </span>
        <Badge tone={item.badgeTone}>{item.badge}</Badge>
      </div>
    </li>
  );
}

/**
 * Why this row blocks a decision, in the user's words.
 *
 * Only for the kinds that are a problem: a piece waiting for review needs no
 * explanation, and a sentence under every row would turn the queue into prose.
 */
function reasonFor(item: AttentionItem): string {
  switch (item.kind) {
    case 'needs_source_check':
      return 'Een bron onder dit werk is veranderd. Controleer of wat erop rust nog klopt voordat je het goedkeurt.';
    case 'job_failed':
      return 'Een achtergrondtaak is gestopt. Er is niets opgeslagen; je kunt hem opnieuw starten.';
    case 'budget_low':
      return 'Het AI-budget van deze maand is bijna op. Nieuwe taken worden geweigerd zodra het op is.';
    case 'ready_for_review':
    case 'needs_rereview':
      // Not a problem: a piece waiting for review needs no explanation, and a
      // sentence under every row would turn the queue into prose.
      return item.subtitle;
  }
}

/** Compact age in the user's timezone: 4u, 3d, 2w. */
function age(iso: string, now = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60_000));
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}u`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${String(days)}d`;
  return `${String(Math.round(days / 7))}w`;
}

function formatMoment(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('nl-NL');
}

// ---------------------------------------------------------------- bits ---

function Kpi(props: {
  label: string;
  value: number;
  caption: string;
  tone?: 'ok' | 'warn' | 'neutral';
  to: string;
  linkNl: string;
}): ReactNode {
  return (
    <div className={`os-kpi${props.tone === undefined ? '' : ` os-kpi--${props.tone}`}`}>
      <div className="os-kpi__top">
        <span className="os-kpi__label">{props.label}</span>
        {/* Two digits, so a strip of tiles keeps one baseline whatever the counts. */}
        <span className="os-kpi__value">{String(props.value).padStart(2, '0')}</span>
      </div>
      <span className="os-kpi__caption">{props.caption}</span>
      <Link to={props.to} style={{ fontSize: 11.5 }}>
        {props.linkNl}
      </Link>
    </div>
  );
}

function FoundationRow(props: { term: string; value: ReactNode; note: ReactNode }): ReactNode {
  return (
    <div className="os-foundation">
      <span className="os-foundation__text">
        <span className="os-foundation__term">{props.term}</span>
        <span className="os-foundation__note">{props.note}</span>
      </span>
      <span className="os-foundation__value">{props.value}</span>
    </div>
  );
}

/**
 * Time-of-day greeting, computed from the viewer's own clock rather than the
 * server's, so it matches what the user sees out of the window.
 */
function salutation(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) {
    return 'Goedemorgen';
  }
  if (hour < 18) {
    return 'Goedemiddag';
  }
  return 'Goedenavond';
}

function leadFor(open: number): string {
  if (open === 0) {
    return 'Er wacht niets op een besluit. De rest loopt op de achtergrond.';
  }
  return `${String(open)} ${open === 1 ? 'ding wacht' : 'dingen wachten'} op een besluit. De rest loopt.`;
}

function formatEuro(cents: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

/** How much of the month's budget is gone, for the bar. */
function spentPercent(budget: { budgetCents: number; availableCents: number }): number {
  if (budget.budgetCents <= 0) return 0;
  const spent = budget.budgetCents - budget.availableCents;
  return Math.min(100, Math.max(0, Math.round((spent / budget.budgetCents) * 100)));
}

const SEVERITY_TONE: Readonly<Record<ImpactSeverity, 'red' | 'amber' | 'neutral'>> = Object.freeze({
  high: 'red',
  medium: 'amber',
  low: 'neutral',
});
const SEVERITY_LABEL_NL: Readonly<Record<ImpactSeverity, string>> = Object.freeze({
  high: 'Hoog',
  medium: 'Midden',
  low: 'Laag',
});
const EXPOSURE_LABEL_NL: Readonly<Record<CampaignImpact['exposure'], string>> = Object.freeze({
  draft: 'nog niets de deur uit',
  approved: 'goedgekeurd, niet geëxporteerd',
  exported: 'publicatieklaar pakket bestaat',
  published: 'gepubliceerd',
});

/**
 * Which campaigns a changed source touches.
 *
 * Rendered only when something actually changed: a card that always says
 * "niets aan de hand" is a card nobody reads.
 *
 * A read, not an action. What to do about a changed source depends on what
 * changed, so the row links to the campaign and stops there.
 */
function SourceImpactCard(props: { report: SourceImpactReport | undefined }): ReactNode {
  const report = props.report;
  if (report === undefined || report.changedSources.length === 0) {
    return null;
  }
  return (
    <section className="os-panel" aria-label="Gewijzigde bronnen">
      <div className="os-panel__head">
        <div>
          <h2 className="os-panel__title">Gewijzigde bronnen</h2>
          <p className="os-panel__sub">Wat er veranderde in een bron, en welke campagnes erop rusten.</p>
        </div>
      </div>

      <ul className="os-queue">
        {report.changedSources.map((source) => (
          <li className="os-queue__row" key={source.sourceId}>
            <span className="os-queue__mark os-queue__mark--info" aria-hidden="true">
              <Icon name="info" size={13} />
            </span>
            <div className="os-queue__text">
              <p className="os-queue__title">{source.title}</p>
              <p className="os-queue__sub">{source.detailNl}</p>
            </div>
          </li>
        ))}

        {report.campaigns.map((campaign) => (
          <li className="os-queue__row" key={campaign.campaignId}>
            <span className="os-queue__mark os-queue__mark--alert" aria-hidden="true">
              <Icon name="alert" size={13} />
            </span>
            <div className="os-queue__text">
              <p className="os-queue__title">
                <Link to={`/campagnes/${campaign.campaignId}?fase=content`}>
                  {campaign.campaignName}
                </Link>
              </p>
              <p className="os-queue__sub">
                {campaign.reasonsNl.join(' · ')}
                {` — ${EXPOSURE_LABEL_NL[campaign.exposure]}`}
              </p>
              {campaign.affectedFindings.length > 0 && (
                <p className="os-queue__sub">
                  {`${String(campaign.affectedFindings.length)} bevinding(en) uit een gewijzigde bron`}
                </p>
              )}
            </div>
            <div className="os-queue__side">
              <Badge tone={SEVERITY_TONE[campaign.severity]}>
                {SEVERITY_LABEL_NL[campaign.severity]}
              </Badge>
            </div>
          </li>
        ))}
      </ul>

      <div className="os-panel__foot">
        <p className="os-limit">
          Dit is een signaal, geen oordeel: of de wijziging ertoe doet, beoordeel je per campagne.
          Staat een campagne op een oudere opleidingskaart, dan kun je hem in de campagne zelf op de
          nieuwste kaart zetten.
        </p>
      </div>
    </section>
  );
}
