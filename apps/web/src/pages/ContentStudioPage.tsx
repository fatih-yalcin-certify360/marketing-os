import { useId, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Campaign, CampaignPackageRun, ContentAssetVersion, LabelSummary } from '@c360/contracts';
import { CHANNEL_LABEL_NL, FUNNEL_STAGE_LABEL_NL } from '@c360/contracts';
import { Button, Disclosure, EmptyState, Notice, Skeleton } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { useCampaigns, useStandaloneContent, type CampaignDetail } from '../api/campaign-queries.js';
import { AttachToCampaign } from '../components/AttachToCampaign.js';
import { ContentAssetCard } from '../components/ContentAssetCard.js';
import { PackageEvidencePanel } from '../components/PackageEvidencePanel.js';
import { StandaloneContentForm } from '../components/StandaloneContentForm.js';
import { Modal } from '../components/Modal.js';
import './radar.css';

/**
 * Content Studio: every piece of content of the label, across campaigns.
 *
 * A reading surface, not a production one: a person finds a piece here,
 * checks its status and opens the campaign to work on it. Two kinds of
 * content share the grid — the social pieces and website copy produced in a
 * campaign's content step, and the website packages (blog with FAQ, the
 * interactive story, the Studio banners) — each with the same header, the
 * same status vocabulary and the same way out to its campaign.
 */
const REVIEW_NL = {
  draft: 'Concept',
  in_review: 'Ter beoordeling',
  changes_requested: 'Wijziging gevraagd',
  approved: 'Goedgekeurd',
  needs_rereview: 'Opnieuw beoordelen',
  archived: 'Gearchiveerd',
} as const;

const REVIEW_TONE = {
  draft: 'neutral',
  in_review: 'purple',
  changes_requested: 'amber',
  approved: 'green',
  needs_rereview: 'amber',
  archived: 'neutral',
} as const;

const PACKAGE_TYPES = {
  blog_faq: 'Blog & FAQ',
  fit_check: 'Interactief verhaal',
  google_studio: 'Google Studio banners',
} as const;
type PackageType = keyof typeof PACKAGE_TYPES;

/** Where a loose piece came from, for the badge on its row. */
const ORIGIN_NL = {
  manual: 'Met de hand gevraagd',
  geo_report: 'Uit AI Visibility',
  radar_card: 'Uit een kans',
  radar_insight: 'Uit een inzicht',
} as const;

interface Collection {
  campaign: Campaign;
  detail: CampaignDetail | null;
  packages: CampaignPackageRun[];
  errors: string[];
}

/**
 * The order the channels are shown in, taken from the label map so a new
 * channel cannot silently fall out of the grouping.
 */
const CHANNEL_ORDER = Object.keys(CHANNEL_LABEL_NL) as (keyof typeof CHANNEL_LABEL_NL)[];

interface Piece {
  row: Collection;
  asset: ContentAssetVersion;
}

/**
 * Split the pieces per channel.
 *
 * One grid of 27 mixed cards was unreadable — a LinkedIn post sat next to a
 * web page proposal next to an e-mail, all in the same shape (2026-09-15). The
 * channel is the first thing a person looks for, so it is the heading.
 */
function byChannel(pieces: readonly Piece[]): { key: string; title: string; items: Piece[] }[] {
  const groups = new Map<string, Piece[]>();
  for (const piece of pieces) {
    const bucket = groups.get(piece.asset.channel);
    if (bucket === undefined) groups.set(piece.asset.channel, [piece]);
    else bucket.push(piece);
  }
  return CHANNEL_ORDER.filter((channel) => groups.has(channel)).map((channel) => ({
    key: channel,
    title: CHANNEL_LABEL_NL[channel],
    items: groups.get(channel) ?? [],
  }));
}

export function ContentStudioPage(props: { label: LabelSummary | undefined }): ReactNode {
  return props.label ? (
    <Studio key={props.label.id} label={props.label} />
  ) : (
    <div className="os-page">
      <Notice tone="warning">Kies eerst een label.</Notice>
    </div>
  );
}

/** One row in the library, whichever of the three kinds it is. */
type StudioItem =
  | { kind: 'piece'; id: string; campaign: Campaign; asset: ContentAssetVersion }
  | { kind: 'loose'; id: string; asset: ContentAssetVersion }
  | { kind: 'package'; id: string; campaign: Campaign; run: CampaignPackageRun; type: PackageType };

/** The status filter, which is what a person actually scans this list for. */
type StatusFilter = 'all' | 'review' | 'approved' | 'attention';

/**
 * How the library is ordered.
 *
 * Newest first is the default, because the piece you just asked for is the one
 * you came back to look at. Channel order is the old arrangement and stays
 * available: when you are working through a batch, a LinkedIn post next to the
 * other LinkedIn posts is what you want.
 */
type SortOrder = 'newest' | 'oldest' | 'channel';

const SORT_LABEL_NL: Readonly<Record<SortOrder, string>> = Object.freeze({
  newest: 'Nieuwste eerst',
  oldest: 'Oudste eerst',
  channel: 'Per kanaal',
});

/** When the row was made, for ordering. A package carries the run's time. */
function itemMoment(item: StudioItem): number {
  const iso = item.kind === 'package' ? item.run.createdAt : item.asset.createdAt;
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? 0 : value;
}

const STATUS_FILTERS: readonly { id: StatusFilter; labelNl: string }[] = Object.freeze([
  { id: 'all', labelNl: 'Alles' },
  { id: 'review', labelNl: 'Review' },
  { id: 'approved', labelNl: 'Goedgekeurd' },
  { id: 'attention', labelNl: 'Aandacht' },
]);

function itemTitle(item: StudioItem): string {
  if (item.kind === 'package') {
    const content = item.run.report.content;
    if (content === null) return PACKAGE_TYPES[item.type];
    return item.type === 'google_studio' ? content.banner.headline : content.title;
  }
  return item.asset.copy.hook;
}

function itemEyebrow(item: StudioItem): string {
  if (item.kind === 'package') return PACKAGE_TYPES[item.type];
  return CHANNEL_LABEL_NL[item.asset.channel];
}

function itemStatus(item: StudioItem): { labelNl: string; tone: 'neutral' | 'purple' | 'amber' | 'green' } {
  if (item.kind === 'package') {
    return item.run.stale
      ? { labelNl: 'Verouderd', tone: 'amber' }
      : { labelNl: 'Concept', tone: 'neutral' };
  }
  return { labelNl: REVIEW_NL[item.asset.reviewState], tone: REVIEW_TONE[item.asset.reviewState] };
}

/** How many blocking warnings a row carries; a package reports none of its own. */
function itemFlags(item: StudioItem): number {
  if (item.kind === 'package') return item.run.stale ? 1 : 0;
  return item.asset.warnings.filter((warning) => warning.blocksPublishReady).length;
}

function matchesStatus(item: StudioItem, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'attention') return itemFlags(item) > 0;
  if (item.kind === 'package') return false;
  return filter === 'approved'
    ? item.asset.reviewState === 'approved'
    : item.asset.reviewState === 'in_review' || item.asset.reviewState === 'needs_rereview';
}

function Studio(props: { label: LabelSummary }): ReactNode {
  const { label } = props;
  const campaigns = useCampaigns(label.id);
  const standalone = useStandaloneContent(label.id);
  const [params, setParams] = useSearchParams();
  const [campaignId, setCampaignId] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [order, setOrder] = useState<SortOrder>('newest');
  const [history, setHistory] = useState(false);
  const [making, setMaking] = useState(false);
  const [search, setSearch] = useState('');
  const ids = { campaign: useId(), search: useId(), history: useId(), order: useId() };

  const collection = useQuery<Collection[], ApiClientError>({
    queryKey: ['studio', label.id, campaigns.data?.items.map((campaign) => campaign.id)],
    enabled: Boolean(campaigns.data),
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const result: Collection[] = [];
      const all = campaigns.data?.items ?? [];
      // Bound concurrent requests; a failed campaign must not hide the others' content.
      for (let index = 0; index < all.length; index += 3) {
        signal.throwIfAborted();
        const batch = await Promise.all(
          all.slice(index, index + 3).map(async (campaign) => {
            const base = `/labels/${label.id}/campaigns/${campaign.id}`;
            const [detail, packages] = await Promise.allSettled([
              api.get<CampaignDetail>(base, signal),
              api.get<{ items: CampaignPackageRun[] }>(`${base}/packages`, signal),
            ]);
            return {
              campaign,
              detail: detail.status === 'fulfilled' ? detail.value : null,
              packages: packages.status === 'fulfilled' ? packages.value.items : [],
              errors: [detail, packages].flatMap((entry) =>
                entry.status === 'rejected' ? ['Een deel van de content kon niet worden geladen.'] : [],
              ),
            };
          }),
        );
        result.push(...batch);
      }
      return result;
    },
  });

  const rows = (collection.data ?? []).filter(
    (row) => campaignId === 'all' || row.campaign.id === campaignId,
  );

  /*
   * The library, as one ordered list.
   *
   * Campaign pieces first, grouped by channel — the channel is the first thing
   * a person looks for — then the loose pieces, then the website packages.
   */
  const items: StudioItem[] = [
    ...byChannel(rows.flatMap((row) => (row.detail?.assets ?? []).map((asset) => ({ row, asset })))).flatMap(
      (group) =>
        group.items.map(
          ({ row, asset }): StudioItem => ({
            kind: 'piece',
            id: `piece:${asset.id}`,
            campaign: row.campaign,
            asset,
          }),
        ),
    ),
    ...(standalone.data?.items ?? []).map(
      (asset): StudioItem => ({ kind: 'loose', id: `loose:${asset.id}`, asset }),
    ),
    ...rows.flatMap((row) => {
      const seen = new Set<string>();
      return row.packages.flatMap((run) =>
        run.report.content
          ? run.report.selected.flatMap((type): StudioItem[] => {
              const duplicate = seen.has(type);
              seen.add(type);
              if (!history && duplicate) return [];
              return [{ kind: 'package', id: `pkg:${run.id}:${type}`, campaign: row.campaign, run, type }];
            })
          : [],
      );
    }),
  ];

  /*
   * The order the list is read in.
   *
   * `items` is built grouped by kind and channel, which is the `channel`
   * ordering; the two date orders sort a copy, so switching back is free.
   */
  const ordered =
    order === 'channel'
      ? items
      : [...items].sort((a, b) =>
          order === 'newest' ? itemMoment(b) - itemMoment(a) : itemMoment(a) - itemMoment(b),
        );

  const needle = search.trim().toLowerCase();
  const searched = ordered.filter((item) => {
    if (needle.length === 0) return true;
    const campaignName = item.kind === 'loose' ? '' : item.campaign.name;
    const body = item.kind === 'package' ? (item.run.report.content?.intro ?? '') : item.asset.copy.body;
    return `${campaignName} ${itemTitle(item)} ${body}`.toLowerCase().includes(needle);
  });
  const visible = searched.filter((item) => matchesStatus(item, status));

  const selectedId = params.get('item');
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0];
  const select = (id: string): void => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('item', id);
        return next;
      },
      { replace: true },
    );
  };

  const loading = campaigns.isPending || (Boolean(campaigns.data) && collection.isPending);
  const canEdit = label.role !== 'label_viewer';
  const canDownload = label.role !== 'label_viewer';

  return (
    <div className="os-split">
      <section className="os-split__list" aria-label="Contentbibliotheek">
        <div className="os-split__head">
          <div className="os-split__title">
            <h1>Content Studio</h1>
            {/* Always "how many of how many": a filtered list that reported a
                bare number would read as the whole library. */}
            <span className="os-split__count">
              {visible.length === items.length
                ? `${String(items.length)} stuks`
                : `${String(visible.length)} van ${String(items.length)}`}
            </span>
          </div>

          <label className="c360-visually-hidden" htmlFor={ids.search}>
            Zoeken in titel, tekst of campagne
          </label>
          <input
            id={ids.search}
            className="c360-input"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Titel, tekst of campagne"
          />

          <label className="c360-visually-hidden" htmlFor={ids.campaign}>
            Campagne
          </label>
          <select
            id={ids.campaign}
            className="c360-select"
            value={campaignId}
            onChange={(event) => {
              setCampaignId(event.target.value);
            }}
          >
            <option value="all">Alle campagnes</option>
            {campaigns.data?.items.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>

          <label className="c360-visually-hidden" htmlFor={ids.order}>
            Volgorde
          </label>
          <select
            id={ids.order}
            className="c360-select"
            value={order}
            onChange={(event) => {
              setOrder(event.target.value as SortOrder);
            }}
          >
            {(Object.keys(SORT_LABEL_NL) as SortOrder[]).map((option) => (
              <option key={option} value={option}>
                {SORT_LABEL_NL[option]}
              </option>
            ))}
          </select>

          <div className="os-filters">
            {STATUS_FILTERS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="os-filter"
                aria-pressed={status === entry.id}
                onClick={() => {
                  setStatus(entry.id);
                }}
              >
                {entry.labelNl}
                <span className="os-filter__count">
                  {searched.filter((item) => matchesStatus(item, entry.id)).length}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="os-split__scroll">
          {loading && (
            <div style={{ padding: 12 }}>
              <Skeleton lines={6} label="Content verzamelen" />
            </div>
          )}
          {!loading && visible.length === 0 && (
            <p className="os-split__foot">
              {needle.length > 0
                ? 'Geen content past bij deze zoekopdracht.'
                : 'Nog geen content in deze selectie. Content ontstaat in stap 6 van een campagne; een losse uiting maak je hiernaast.'}
            </p>
          )}
          {visible.map((item) => {
            const state = itemStatus(item);
            const flags = itemFlags(item);
            return (
              <button
                key={item.id}
                type="button"
                className="os-split__row"
                aria-current={selected?.id === item.id}
                onClick={() => {
                  select(item.id);
                }}
              >
                <span className="os-split__marker" />
                <span className="os-split__body">
                  <span className="os-split__line">
                    <span className="os-split__eyebrow">{itemEyebrow(item)}</span>
                    <span style={{ flex: 1 }} />
                    <span className={`os-pill os-pill--${toneClass(state.tone)}`}>{state.labelNl}</span>
                  </span>
                  <span className="os-split__name">{itemTitle(item)}</span>
                  <span className="os-split__sub">
                    {item.kind === 'loose'
                      ? `Zonder campagne · ${ORIGIN_NL[item.asset.originKind ?? 'manual']}`
                      : item.campaign.name}
                  </span>
                  <span className="os-split__meta">
                    {item.kind === 'package'
                      ? `Pakket · ${new Date(item.run.createdAt).toLocaleDateString('nl-NL')}`
                      : `v${String(item.asset.version)} · ${new Date(item.asset.createdAt).toLocaleDateString('nl-NL')}${
                          item.asset.funnelStage === null
                            ? ''
                            : ` · ${FUNNEL_STAGE_LABEL_NL[item.asset.funnelStage]}`
                        }${flags > 0 ? ` · ${String(flags)} aandachtspunt(en)` : ''}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="os-split__foot">
          <label htmlFor={ids.history} className="c360-row" style={{ gap: 6 }}>
            <input
              id={ids.history}
              type="checkbox"
              checked={history}
              onChange={(event) => {
                setHistory(event.target.checked);
              }}
            />
            <span>Ook eerdere pakketversies tonen</span>
          </label>
        </div>
      </section>

      <section className="os-detail">
        <div className="os-page__head">
          <div className="os-page__head-text">
            <p className="os-eyebrow">{`Content · ${label.name}`}</p>
            <h1>{selected === undefined ? 'Content Studio' : itemTitle(selected)}</h1>
            <p className="c360-page-lead">
              {selected === undefined
                ? 'Alle gemaakte content van dit label, over de campagnes heen. Beoordelen en aanpassen gebeurt hier of in de campagne zelf.'
                : selected.kind === 'loose'
                  ? 'Een losse uiting: één stuk buiten een campagne om, gegrond op de opleidingskaart en het merkprofiel.'
                  : `${selected.campaign.name} — beoordelen en aanpassen kan hier of in de campagne.`}
            </p>
          </div>
          <div className="os-page__actions">
            {canEdit && (
              <Button
                variant="primary"
                icon="plus"
                onClick={() => {
                  setMaking(true);
                }}
              >
                Losse uiting maken
              </Button>
            )}
            <Link className="c360-button c360-button--secondary" to="/campagnes">
              Naar campagnes
            </Link>
          </div>
        </div>

        {making && (
          <Modal
            labelledBy="studio-make"
            onClose={() => {
              setMaking(false);
            }}
          >
            <StandaloneContentForm
              labelId={label.id}
              headingId="studio-make"
              onQueued={() => {
                setMaking(false);
              }}
              onCancel={() => {
                setMaking(false);
              }}
            />
          </Modal>
        )}

        {(campaigns.error ?? collection.error) && (
          <Notice tone="warning">{(campaigns.error ?? collection.error)?.userMessage}</Notice>
        )}
        {collection.data
          ?.filter((row) => row.errors.length > 0)
          .map((row) => (
            <Notice key={row.campaign.id} tone="warning">
              {`${row.campaign.name}: een deel van de content ontbreekt door een laadfout. Vernieuw om opnieuw te proberen.`}
            </Notice>
          ))}

        {selected === undefined ? (
          <EmptyState
            title="Nog geen content in deze selectie"
            body="Content ontstaat in stap 6 van een campagne; websitepakketten in de tak Website & interactief. Een losse uiting maak je met de knop hierboven."
            action={
              <Link className="c360-button c360-button--primary" to="/campagnes">
                Naar campagnes
              </Link>
            }
          />
        ) : selected.kind === 'package' ? (
          <PackageDetail
            campaign={selected.campaign}
            run={selected.run}
            kind={selected.type}
            label={label}
            canDownload={canDownload}
          />
        ) : (
          <>
            <div className="os-metagrid">
              <Meta term="Status" value={itemStatus(selected).labelNl} />
              <Meta term="Versie" value={`v${String(selected.asset.version)}`} />
              <Meta
                term="Fase"
                value={
                  selected.asset.funnelStage === null
                    ? 'Geen fase'
                    : FUNNEL_STAGE_LABEL_NL[selected.asset.funnelStage]
                }
              />
              <Meta
                term="Aandachtspunten"
                value={
                  itemFlags(selected) === 0 ? 'Geen' : `${String(itemFlags(selected))} blokkerend`
                }
              />
            </div>

            <ContentAssetCard
              labelId={label.id}
              campaignId={selected.kind === 'piece' ? selected.campaign.id : null}
              asset={selected.asset}
            />

            {/*
              The whole piece as one file, to keep or to hand over.

              A plain link and not a fetch: the document is a GET with an id in
              its path, the browser can do the download itself, and it then
              also works when the tab is restored. The server builds it per
              request, so there is nothing to wait for and nothing to refresh.
            */}
            <section className="os-panel">
              <div className="os-panel__head">
                <div>
                  <h2 className="os-panel__title">Dit stuk meenemen</h2>
                  <p className="os-panel__sub">Als één document, met alles eromheen</p>
                </div>
              </div>
              <div className="os-panel__body">
                <p className="c360-text-muted">
                  De doelgroep waarvoor het geschreven is, de opdracht die je gaf en de tekst zelf —
                  plus voor welk label en welke opleiding, door wie en wanneer. Word om in door te
                  werken, PDF om te versturen.
                </p>
                <div className="c360-row">
                  <a
                    className="c360-button c360-button--secondary"
                    href={`/api/v1/labels/${label.id}/content/${selected.asset.id}/dossier.docx`}
                    download
                  >
                    Download als Word
                  </a>
                  <a
                    className="c360-button c360-button--ghost"
                    href={`/api/v1/labels/${label.id}/content/${selected.asset.id}/dossier.pdf`}
                    download
                  >
                    Download als PDF
                  </a>
                </div>
              </div>
            </section>

            {selected.kind === 'loose' && canEdit && (
              <AttachToCampaign
                labelId={label.id}
                asset={selected.asset}
                campaigns={campaigns.data?.items ?? []}
              />
            )}

            {selected.kind === 'piece' && (
              <div>
                <Link
                  className="c360-button c360-button--secondary"
                  to={`/campagnes/${selected.campaign.id}?fase=content`}
                >
                  Open deze stap in de campagne
                </Link>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** A badge tone, as the pill class that carries it. */
function toneClass(tone: 'neutral' | 'purple' | 'amber' | 'green'): string {
  return tone === 'purple' ? 'brand' : tone === 'amber' ? 'warn' : tone === 'green' ? 'ok' : 'outline';
}

function Meta(props: { term: string; value: string }): ReactNode {
  return (
    <div className="os-metatile">
      <p className="os-metatile__term">{props.term}</p>
      <p className="os-metatile__value">{props.value}</p>
    </div>
  );
}

/**
 * One website package, read in full.
 *
 * The package is the only kind of content in the library that is not a
 * versioned asset: it is the output of a production run, with its own evidence
 * trail. It is shown with the same header and the same status vocabulary as
 * the rest, and the way out is the campaign that produced it.
 */
function PackageDetail(props: {
  campaign: Campaign;
  run: CampaignPackageRun;
  kind: PackageType;
  label: LabelSummary;
  canDownload: boolean;
}): ReactNode {
  const { campaign, run, kind, label } = props;
  const content = run.report.content;
  if (content === null) {
    return <Notice tone="warning">Dit pakket heeft geen inhoud opgeleverd.</Notice>;
  }
  const excerpt = kind === 'google_studio' ? content.banner.body : content.intro;

  return (
    <>
      <div className="os-metagrid">
        <Meta term="Soort" value={PACKAGE_TYPES[kind]} />
        <Meta term="Status" value={run.stale ? 'Verouderd · opnieuw maken' : 'Concept · controleren'} />
        <Meta term="Merkversie" value={`v${String(run.report.brand.version)}`} />
        <Meta term="Gemaakt" value={new Date(run.createdAt).toLocaleDateString('nl-NL')} />
      </div>

      {run.report.isMock && <Notice tone="warning">Demodata — geen echte productie.</Notice>}

      <article className="os-panel os-panel--pad">
        <p className="os-rowcard__body">{excerpt}</p>
      </article>

      <PackageEvidencePanel
        run={run}
        labelId={label.id}
        canReview={label.role === 'label_manager' || label.role === 'label_approver'}
      />

      <Disclosure summary="Tekstinhoud bekijken" tone="plain">
        {kind === 'blog_faq' && (
          <>
            {content.sections.map((section, index) => (
              <section key={index}>
                <h4>{section.heading}</h4>
                <p>{section.text}</p>
              </section>
            ))}
            {content.faq.map((item, index) => (
              <section key={index}>
                <h4>{item.question}</h4>
                <p>{item.answer}</p>
              </section>
            ))}
          </>
        )}
        {kind === 'fit_check' &&
          content.reflection.map((question, index) => (
            <section key={index}>
              <h4>{question.question}</h4>
              {question.options.map((option, position) => (
                <p key={position}>
                  <strong>{option.label}</strong> — {option.guidance}
                </p>
              ))}
            </section>
          ))}
        {kind === 'google_studio' && (
          <>
            <h4>{content.banner.question}</h4>
            {content.banner.options.map((option, index) => (
              <p key={index}>
                {option.label} — {option.feedback}
              </p>
            ))}
            <p className="c360-card__hint">
              300×250 · 336×280 · 300×600. De werkende visuele previews staan in het ZIP-pakket; deze
              kaart toont de copy.
            </p>
          </>
        )}
      </Disclosure>

      <Disclosure summary="Bronnen en controlepunten" tone="plain">
        <p className="c360-card__hint">{`Briefing: ${run.report.briefVersionId}`}</p>
        <p className="c360-card__hint">
          {run.report.sourceRadarRunId
            ? `Gekoppelde radar: ${run.report.sourceRadarRunId}`
            : 'Geen radarscan gekoppeld'}
        </p>
        {run.report.sourceSnapshot?.keywords?.items
          .filter((keyword) => content.evidenceIds.includes(keyword.id))
          .map((keyword) => (
            <p key={keyword.id}>
              <a href={keyword.sourceUrl} target="_blank" rel="noreferrer">
                {keyword.phrase}
              </a>
            </p>
          ))}
        {[...(run.report.brand.portal?.warnings ?? []), ...content.reviewNotes].map((note, index) => (
          <p key={index} className="c360-card__hint">
            {note}
          </p>
        ))}
      </Disclosure>

      <div className="c360-row">
        <Link
          className="c360-button c360-button--secondary"
          to={`/campagnes/${campaign.id}?fase=website`}
        >
          Open campagne en productie
        </Link>
        {!run.stale && props.canDownload && (
          <a
            className="c360-button c360-button--ghost"
            href={`/api/v1/labels/${label.id}/campaigns/${campaign.id}/packages/${run.id}/file`}
            download
          >
            Download pakket (ZIP)
          </a>
        )}
      </div>
    </>
  );
}
