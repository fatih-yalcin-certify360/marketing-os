import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CampaignListItem, LabelSummary } from '@c360/contracts';
import { Badge, Card, Disclosure, EmptyState, Notice, Skeleton, Tabs } from '@c360/ui';
import { useCampaigns, useLearnings } from '../api/campaign-queries.js';

/**
 * Resultaten: what this label has learned, across campaigns.
 *
 * The area sat in the navigation as "nog niet beschikbaar" while step 8 of
 * every campaign recorded publications, figures and lessons, and while
 * approved lessons already coloured the prompts of every later campaign
 * (audit 2026-09-15). The knowledge existed and was only readable by opening
 * one campaign at a time — so the one thing the product accumulates was
 * invisible to the person meant to apply it.
 *
 * Deliberately modest. It reads two endpoints that already exist and adds no
 * figure of its own: there is no cross-campaign total, because the numbers are
 * typed in by hand per campaign and adding them up would suggest a measurement
 * nobody made. Once Search Console and the website figures are connected, this
 * is where they belong.
 */
export function ResultatenPage(props: { label: LabelSummary | undefined }): ReactNode {
  return props.label ? (
    <Results key={props.label.id} label={props.label} />
  ) : (
    <div className="os-page">
      <Notice tone="warning">Kies eerst een label.</Notice>
    </div>
  );
}

type Shelf = 'lessen' | 'campagnes';

function Results({ label }: { label: LabelSummary }): ReactNode {
  const learnings = useLearnings(label.id);
  const campaigns = useCampaigns(label.id);
  const [shelf, setShelf] = useState<Shelf>('lessen');

  const items = learnings.data?.items ?? [];
  const approved = items.filter((item) => item.learning.reviewState === 'approved');
  const open = items.filter((item) => item.learning.reviewState !== 'approved');
  const withResults = (campaigns.data?.items ?? []).filter(
    (campaign) => campaign.progress.state === 'finished' || campaign.progress.doneStepIds.includes('results'),
  );

  const loading = learnings.isPending || campaigns.isPending;
  const error = learnings.error ?? campaigns.error;

  const publications = withResults.length;

  return (
    <div className="os-page os-page--reading">
      <header className="os-page__head">
        <div className="os-page__head-text">
          <p className="os-eyebrow">Resultaten</p>
          <h1 className="c360-page-title">Wat we hebben geleerd</h1>
          <p className="c360-page-lead">
            De lessen die dit label heeft vastgelegd, en de campagnes waarvan resultaten zijn
            genoteerd. Het systeem meet niets zelf: bij elk cijfer staat hoe iemand eraan kwam.
          </p>
        </div>
      </header>

      {/* Four counts, each one a `length` over rows that exist. There is
          deliberately no cross-campaign total: every figure behind these was
          typed in by hand or read from an uploaded platform report, and adding
          them up would suggest a measurement nobody made. */}
      <div className="os-kpis">
        <div className={`os-kpi ${approved.length > 0 ? 'os-kpi--ok' : 'os-kpi--neutral'}`}>
          <div className="os-kpi__top">
            <span className="os-kpi__label">Goedgekeurde lessen</span>
            <span className="os-kpi__value">{String(approved.length).padStart(2, '0')}</span>
          </div>
          <span className="os-kpi__caption">Kleuren elk volgend voorstel van dit label</span>
        </div>
        <div className={`os-kpi ${open.length > 0 ? 'os-kpi--warn' : 'os-kpi--neutral'}`}>
          <div className="os-kpi__top">
            <span className="os-kpi__label">Lessen in concept</span>
            <span className="os-kpi__value">{String(open.length).padStart(2, '0')}</span>
          </div>
          <span className="os-kpi__caption">Nog niet goedgekeurd, dus nog niet meegegeven</span>
        </div>
        <div className="os-kpi os-kpi--neutral">
          <div className="os-kpi__top">
            <span className="os-kpi__label">Campagnes met resultaat</span>
            <span className="os-kpi__value">{String(publications).padStart(2, '0')}</span>
          </div>
          <span className="os-kpi__caption">Stap 8 ingevuld</span>
        </div>
        <div className="os-kpi os-kpi--neutral">
          <div className="os-kpi__top">
            <span className="os-kpi__label">Automatische metingen</span>
            <span className="os-kpi__value">00</span>
          </div>
          <span className="os-kpi__caption">
            Niet gebouwd: er is nog geen koppeling met Search Console of de website
          </span>
        </div>
      </div>

      <Disclosure summary="Hoe werkt dit?">
        <p>
          Aan het eind van een campagne leg je vast wat er is gepubliceerd en welke cijfers je hebt
          gezien. Daar schrijf je een les bij: wat je zag, wat je daaruit afleidt, en wat je de
          volgende keer zou toetsen. Een <strong>goedgekeurde</strong> les wordt meegegeven aan
          latere voorstellen voor dit label; een les in concept niet.
        </p>
        <p>
          Er staat hier bewust geen totaal over campagnes heen. Elk cijfer is met de hand ingevoerd
          of uit een geüpload platformrapport gehaald, en optellen zou een meting suggereren die
          niemand heeft gedaan.
        </p>
      </Disclosure>

      {error && <Notice tone="warning">{error.userMessage}</Notice>}

      <Tabs
        label="Resultaten"
        value={shelf}
        onChange={(id) => {
          setShelf(id as Shelf);
        }}
        items={[
          { id: 'lessen', label: 'Lessen', count: items.length, panelId: 'resultaten-lessen' },
          { id: 'campagnes', label: 'Campagnes met resultaten', count: withResults.length, panelId: 'resultaten-campagnes' },
        ]}
      />

      {loading && (
        <Card>
          <Skeleton lines={4} label="Resultaten laden" />
        </Card>
      )}

      {!loading && shelf === 'lessen' && (
        <section id="resultaten-lessen" role="tabpanel" aria-label="Lessen" className="c360-stack">
          {items.length === 0 ? (
            <EmptyState
              title="Nog geen lessen vastgelegd"
              body="Leg aan het eind van een campagne vast wat je zag en wat je daaruit afleidt. Goedgekeurde lessen kleuren daarna elk volgend voorstel."
              action={
                <Link className="c360-button c360-button--primary" to="/campagnes">
                  Naar campagnes
                </Link>
              }
            />
          ) : (
            <>
              {approved.length > 0 && <LearningList title="Meegegeven aan nieuwe voorstellen" items={approved} />}
              {open.length > 0 && <LearningList title="Nog niet goedgekeurd" items={open} />}
            </>
          )}
        </section>
      )}

      {!loading && shelf === 'campagnes' && (
        <section id="resultaten-campagnes" role="tabpanel" aria-label="Campagnes met resultaten" className="c360-stack">
          {withResults.length === 0 ? (
            <EmptyState
              title="Nog geen campagne met vastgelegde resultaten"
              body="Zodra je in stap 8 van een campagne een publicatie of cijfers vastlegt, verschijnt die campagne hier."
            />
          ) : (
            <Card ariaLabel="Campagnes met resultaten">
              <ul className="c360-list">
                {withResults.map((campaign) => (
                  <CampaignRow key={campaign.id} campaign={campaign} />
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}

function LearningList(props: {
  title: string;
  items: readonly { learning: { id: string; observationNl: string; hypothesisNl: string; nextTestNl: string; originCampaignId: string | null; reviewState: string }; evidence: { isThin: boolean; reasonsNl: readonly string[] } }[];
}): ReactNode {
  return (
    <Card title={props.title} ariaLabel={props.title}>
      <ul className="c360-list">
        {props.items.map(({ learning, evidence }) => (
          <li className="c360-list__item" key={learning.id}>
            <div style={{ minWidth: 0 }}>
              <p className="c360-list__title">{learning.observationNl}</p>
              <p className="c360-list__subtitle">
                <strong>Wat we eruit afleiden:</strong> {learning.hypothesisNl}
              </p>
              <p className="c360-list__subtitle">
                <strong>Volgende toets:</strong> {learning.nextTestNl}
              </p>
              {learning.originCampaignId !== null && (
                <p className="c360-stat__caption">
                  <Link to={`/campagnes/${learning.originCampaignId}?fase=results`}>
                    Naar de campagne waar deze les vandaan komt
                  </Link>
                </p>
              )}
              {evidence.isThin && (
                <p className="c360-stat__caption">
                  Dun bewijs: {evidence.reasonsNl.join(' · ')}
                </p>
              )}
            </div>
            <Badge tone={learning.reviewState === 'approved' ? 'green' : 'neutral'}>
              {learning.reviewState === 'approved' ? 'Goedgekeurd' : 'Concept'}
            </Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CampaignRow({ campaign }: { campaign: CampaignListItem }): ReactNode {
  return (
    <li className="c360-list__item">
      <div style={{ minWidth: 0 }}>
        <p className="c360-list__title">
          <Link to={`/campagnes/${campaign.id}?fase=results`}>{campaign.name}</Link>
        </p>
        <p className="c360-list__subtitle">{campaign.courseName}</p>
      </div>
      <Badge tone={campaign.progress.attention ? 'amber' : 'green'}>
        {campaign.progress.attention ? 'Vraagt aandacht' : 'Resultaten vastgelegd'}
      </Badge>
    </li>
  );
}
