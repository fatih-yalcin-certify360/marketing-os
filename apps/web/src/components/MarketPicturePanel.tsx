import { useId, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type {
  Campaign,
  CampaignObjective,
  RadarEvidenceRef,
  RadarInsight,
  RadarRun,
} from '@c360/contracts';
import {
  EVIDENCE_STRENGTH_NL,
  FUNNEL_STAGE_LABEL_NL,
  OBJECTIVE_LABEL_NL,
  SOURCE_AGREEMENT_NL,
} from '@c360/contracts';
import { Badge, Card, Disclosure, Notice } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { MakeSomethingOf } from './MakeSomethingOf.js';
import { FunnelPills } from './FunnelPills.js';
import { ObjectiveSelect } from './ObjectiveSelect.js';
import '../pages/radar.css';

/**
 * Marktbeeld: what the scan's verified evidence, taken together, means.
 *
 * Reading order follows the research-reporting practice the design rests on
 * (GOV.UK sharing findings, NN/g engaging reports, Analysis Function
 * "writing about statistics"): what changed since last time first, then the
 * insights as headlines a manager can read in half a minute, each in the
 * What → So what → Now what order with its confidence stated as two inputs
 * (evidence, agreement) and a "wat dit niet laat zien" line; the sources one
 * level down, in a details element that names what it holds. The competitors'
 * own words come last, quoted and unranked.
 *
 * One primary action: choose an insight, confirm the objective the insight
 * suggests, make the campaign. Per-insight buttons would be five competing
 * calls to action.
 */
export function MarketPicturePanel(props: {
  run: RadarRun;
  labelId: string;
  canEdit: boolean;
  /** Our confirmed course facts, for the positioning view next to competitors' quotes. */
  ownFacts: readonly { label: string; value: string }[];
}): ReactNode {
  const { run, labelId, canEdit, ownFacts } = props;
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(run.report.insights[0]?.id ?? null);
  const chosen = run.report.insights.find((insight) => insight.id === selected) ?? null;
  const [objective, setObjective] = useState<CampaignObjective>(chosen?.suggestedObjective ?? 'consideration');
  const objectiveId = useId();
  const create = useMutation<Campaign, ApiClientError, { insightId: string; objective: CampaignObjective }>({
    mutationFn: (input) =>
      api.post(`/labels/${labelId}/radar/${run.id}/insights/${input.insightId}/campaign`, {
        objective: input.objective,
      }),
    onSuccess: (campaign) => {
      void navigate(`/campagnes/${campaign.id}`);
    },
  });

  const digest = run.report.digest;
  const insights = run.report.insights;

  return (
    <section aria-label="Marktbeeld" className="c360-stack">
      {digest?.previousRunId != null && (
        <Card
          title={`Sinds de vorige scan (${String(digest.items.length)})`}
          ariaLabel="Sinds de vorige scan"
        >
          <p className="c360-card__hint">
            {`Vergeleken met de scan van ${digest.previousAt === null ? 'eerder' : new Date(digest.previousAt).toLocaleString('nl-NL')}. Een gewijzigde bron is een gewijzigde tekst, geen marktbeweging.`}
          </p>
          {digest.items.length === 0 ? (
            <p>Geen verschillen met de vorige scan.</p>
          ) : (
            <>
              {/* The counts first: eighteen one-line notes read as noise, while
                  "vier nieuwe advertenties" is the thing a person acts on. */}
              <div className="radar-digest-counts">
                {digestCounts(digest.items).map((entry) => (
                  <span className="radar-digest-count" key={entry.kind}>
                    <strong>{entry.count}</strong> {(entry.count === 1 ? DIGEST_KIND_NL : DIGEST_KIND_PLURAL_NL)[entry.kind].toLowerCase()}
                  </span>
                ))}
              </div>
              <Disclosure summary={`Alle ${String(digest.items.length)} verschillen tonen`} tone="plain">
                <ul className="radar-digest">
                  {digest.items.map((item, index) => (
                    <li key={index}>
                      <Badge tone={item.kind === 'card_changed' || item.kind === 'ad_coverage_changed' ? 'amber' : 'neutral'}>
                        {DIGEST_KIND_NL[item.kind]}
                      </Badge>{' '}
                      {item.noteNl}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            </>
          )}
        </Card>
      )}

      <Card title="Inzichten" ariaLabel="Inzichten">
        <p className="c360-card__hint">
          Wat de gecontroleerde bevindingen samen betekenen voor deze opleiding. Elk inzicht noemt
          zijn bewijs, zijn zekerheid als twee gegevens — hoeveel onafhankelijke bronnen, en of die
          het eens zijn — en wat het bewijs níet laat zien. Kies een inzicht om er een campagne van
          te maken; het doel staat voorgesteld en is aan te passen.
        </p>
        {run.report.isMock && <Notice tone="warning">Demodata — geen echte marktanalyse.</Notice>}
        {insights.length === 0 ? (
          <Notice tone="info">
            Geen inzichten in deze scan. Dat betekent dat er te weinig geverifieerd bewijs was om een
            patroon te benoemen, of dat de scan van vóór het marktbeeld is. Bekijk de kansen en de
            scannotities, of scan opnieuw.
          </Notice>
        ) : (
          <ul className="radar-insights" role="radiogroup" aria-label="Kies een inzicht">
            {insights.map((insight) => (
              <InsightCard
                key={insight.id}
                run={run}
                insight={insight}
                selected={selected === insight.id}
                onSelect={() => {
                  setSelected(insight.id);
                  setObjective(insight.suggestedObjective);
                }}
              />
            ))}
          </ul>
        )}
        {chosen !== null && canEdit && (
          <div className="radar-handoff">
            <ObjectiveSelect
              id={objectiveId}
              value={objective}
              onChange={setObjective}
              suggestionNl={`${OBJECTIVE_LABEL_NL[chosen.suggestedObjective]}, omdat het inzicht in de fase ${FUNNEL_STAGE_LABEL_NL[chosen.stage]} speelt.`}
              disabled={create.isPending}
            />
            <MakeSomethingOf
              labelId={labelId}
              courseVersionId={run.courseVersionId}
              buttonLabel="Iets maken van dit inzicht"
              dialogTitle="Wat maak je van dit inzicht?"
              subjectNl={chosen.headlineNl}
              angleNl={`${chosen.headlineNl}\n\nWat we zagen: ${chosen.observationNl}\n\nWat dit betekent: ${chosen.meaningNl}`}
              stage={chosen.stage}
              originKind="radar_insight"
              busy={create.isPending}
              onCampaign={() => {
                create.mutate({ insightId: chosen.id, objective });
              }}
              onLooseMade={() => {
                void navigate('/content');
              }}
            />
            <span className="c360-stat__caption">
              Je kiest zelf of dit een volledige campagne wordt of één losse uiting. De campagne
              start in stap 1 met dit inzicht, zijn bewijs en zijn zekerheid als briefing.
            </span>
            {create.isError && (
              <span className="c360-field__error" role="alert">
                {create.error.userMessage}
              </span>
            )}
          </div>
        )}
      </Card>

      {(run.report.claims.length > 0 || ownFacts.length > 0) && (
        <Card title="Wat aanbieders zeggen — en wat wij gecontroleerd kunnen zeggen" ariaLabel="Positionering">
          <p className="c360-card__hint">
            Letterlijke passages van aanbieders uit deze scan, gerapporteerd en niet beoordeeld, naast
            de gecontroleerde feiten van onze eigen opleidingskaart. Geen rangorde, geen vergelijking
            van prijzen die niet in beide bronnen staan.
          </p>
          <div className="radar-positioning">
            <div>
              <h3 className="c360-card__title">Aanbieders (geciteerd)</h3>
              {run.report.claims.length === 0 ? (
                <p className="c360-card__hint">Geen geverifieerde passages van aanbieders in deze scan.</p>
              ) : (
                <ul className="radar-claims">
                  {run.report.claims.map((claim, index) => (
                    <li key={index}>
                      <strong>{claim.organization}</strong>
                      <blockquote>{claim.excerpt}</blockquote>
                      <a href={claim.sourceUrl} target="_blank" rel="noreferrer">
                        Bron bekijken ↗
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="c360-card__title">Onze opleiding (gecontroleerd)</h3>
              {ownFacts.length === 0 ? (
                <p className="c360-card__hint">
                  Nog geen gecontroleerde feiten op de opleidingskaart; er is dus niets dat we hier
                  tegenover kunnen zetten.
                </p>
              ) : (
                <dl className="c360-definition">
                  {ownFacts.map((fact) => (
                    <div key={fact.label}>
                      <dt className="c360-definition__term">{fact.label}</dt>
                      <dd className="c360-definition__value" style={{ fontWeight: 400 }}>
                        {fact.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        </Card>
      )}
    </section>
  );
}

/** How many differences of each kind, in the order the kinds are declared. */
function digestCounts(
  items: readonly { kind: keyof typeof DIGEST_KIND_NL }[],
): { kind: keyof typeof DIGEST_KIND_NL; count: number }[] {
  const counts = new Map<keyof typeof DIGEST_KIND_NL, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  return (Object.keys(DIGEST_KIND_NL) as (keyof typeof DIGEST_KIND_NL)[])
    .filter((kind) => counts.has(kind))
    .map((kind) => ({ kind, count: counts.get(kind) ?? 0 }));
}

const DIGEST_KIND_NL = {
  card_new: 'Nieuwe bron',
  card_changed: 'Bron gewijzigd',
  card_gone: 'Niet meer in scan',
  competitor_new: 'Nieuwe aanbieder',
  keyword_new: 'Nieuwe vraag',
  ad_new: 'Nieuwe advertentie',
  ad_coverage_changed: 'Controle gewijzigd',
} as const;

/** The same kinds, counted. Dutch plurals are irregular enough to write out. */
const DIGEST_KIND_PLURAL_NL: Record<keyof typeof DIGEST_KIND_NL, string> = {
  card_new: 'Nieuwe bronnen',
  card_changed: 'Bronnen gewijzigd',
  card_gone: 'Niet meer in scan',
  competitor_new: 'Nieuwe aanbieders',
  keyword_new: 'Nieuwe vragen',
  ad_new: 'Nieuwe advertenties',
  ad_coverage_changed: 'Controles gewijzigd',
};

function InsightCard(props: {
  run: RadarRun;
  insight: RadarInsight;
  selected: boolean;
  onSelect: () => void;
}): ReactNode {
  const { run, insight, selected } = props;
  const inputId = `insight-${insight.id}`;
  return (
    <li className={`radar-insight${selected ? ' radar-insight--selected' : ''}`}>
      <label className="radar-insight__head" htmlFor={inputId}>
        <input
          id={inputId}
          type="radio"
          name={`insight-${run.id}`}
          checked={selected}
          onChange={props.onSelect}
          aria-label={`Kies inzicht: ${insight.headlineNl}`}
        />
        <span className="radar-insight__headline">{insight.headlineNl}</span>
      </label>
      <div className="radar-insight__meta">
        <FunnelPills stages={[insight.stage]} small label="Fase van dit inzicht" />
        <Badge tone={insight.confidence.evidence === 'robuust' ? 'green' : insight.confidence.evidence === 'gemiddeld' ? 'neutral' : 'amber'}>
          {`Bewijs: ${insight.confidence.evidence} · ${String(insight.confidence.independentDomains)} domein(en)`}
        </Badge>
        <Badge tone={insight.confidence.agreement === 'tegenstrijdig' ? 'amber' : 'neutral'}>
          {SOURCE_AGREEMENT_NL[insight.confidence.agreement]}
        </Badge>
      </div>
      {/* Five insights each spelling out five rows made one screen of 4500
          pixels that nobody read (2026-09-15). The chosen insight is the one
          being worked on, so that is the one that opens; the others stay a
          headline with the observation under it. */}
      {selected ? (
        <>
          <p className="radar-insight__row">
            <strong>Wat we zagen:</strong> {insight.observationNl}
          </p>
          <p className="radar-insight__row">
            <strong>En dus:</strong> {insight.meaningNl}
          </p>
          <p className="radar-insight__row">
            <strong>Nu:</strong> {insight.nowNl}
          </p>
          <p className="radar-insight__row c360-stat__caption">
            <strong>Andere lezing:</strong> {insight.alternativeNl}
          </p>
          <p className="radar-insight__row c360-stat__caption">
            <strong>Wat dit niet laat zien:</strong> {insight.notShownNl}
          </p>
          <details>
            <summary>{`Bekijk ${String(insight.evidence.length)} bron(nen) en de letterlijke tekst`}</summary>
            <p className="c360-card__hint">{EVIDENCE_STRENGTH_NL[insight.confidence.evidence]}</p>
            <ul className="radar-evidence">
              {insight.evidence.map((evidence) => (
                <EvidenceRow key={`${evidence.kind}:${evidence.id}`} run={run} evidence={evidence} />
              ))}
            </ul>
          </details>
        </>
      ) : (
        <p className="radar-insight__row radar-insight__row--clamped">{insight.observationNl}</p>
      )}
    </li>
  );
}

const KIND_NL: Record<RadarEvidenceRef['kind'], string> = {
  card: 'Kans',
  audience: 'Doelgroepbevinding',
  competitor: 'Aanbieder',
  keyword: 'Zoekvraag',
  advertisement: 'Advertentie',
};

/** Resolves one evidence reference to the run item it points at, so the reader can open it. */
function EvidenceRow(props: { run: RadarRun; evidence: RadarEvidenceRef }): ReactNode {
  const { run, evidence } = props;
  const item = resolveEvidence(run, evidence);
  if (item === null) {
    return (
      <li>
        <Badge tone="amber">{KIND_NL[evidence.kind]}</Badge> Bron niet meer in dit rapport.
      </li>
    );
  }
  return (
    <li>
      <Badge tone="neutral">{KIND_NL[evidence.kind]}</Badge> <strong>{item.organization}</strong>
      <blockquote>{item.excerpt}</blockquote>
      <a href={item.sourceUrl} target="_blank" rel="noreferrer">
        Bron bekijken ↗
      </a>
      {item.retrievedAt !== null && (
        <span className="c360-stat__caption">{` · gelezen ${new Date(item.retrievedAt).toLocaleString('nl-NL')}`}</span>
      )}
    </li>
  );
}

function resolveEvidence(
  run: RadarRun,
  evidence: RadarEvidenceRef,
): { organization: string; excerpt: string; sourceUrl: string; retrievedAt: string | null } | null {
  const { report } = run;
  switch (evidence.kind) {
    case 'card': {
      const card = report.cards.find((entry) => entry.id === evidence.id);
      return card ? { organization: card.organization, excerpt: card.excerpt, sourceUrl: card.sourceUrl, retrievedAt: card.retrievedAt } : null;
    }
    case 'audience': {
      const finding = report.audience?.findings.find((entry) => entry.id === evidence.id);
      return finding ? { organization: finding.organization, excerpt: finding.excerpt, sourceUrl: finding.sourceUrl, retrievedAt: finding.retrievedAt } : null;
    }
    case 'competitor': {
      const competitor = report.audience?.competitors.find((entry) => entry.sourceUrl === evidence.id);
      return competitor ? { organization: competitor.organization, excerpt: competitor.excerpt, sourceUrl: competitor.sourceUrl, retrievedAt: null } : null;
    }
    case 'keyword': {
      const keyword = report.keywords?.items.find((entry) => entry.id === evidence.id);
      return keyword ? { organization: keyword.phrase, excerpt: keyword.excerpt, sourceUrl: keyword.sourceUrl, retrievedAt: keyword.retrievedAt } : null;
    }
    case 'advertisement': {
      const ad = report.advertising?.ads.find((entry) => entry.id === evidence.id);
      return ad ? { organization: ad.advertiser, excerpt: ad.text.slice(0, 400), sourceUrl: ad.sourceUrl, retrievedAt: ad.observedAt } : null;
    }
  }
}
