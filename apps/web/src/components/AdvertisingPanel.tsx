import { useId, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { AdPlatform, Advertisement, Campaign, CampaignObjective, RadarRun } from '@c360/contracts';
import { Badge, Button, Card, Notice } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { MakeSomethingOf } from './MakeSomethingOf.js';
import { ObjectiveSelect } from './ObjectiveSelect.js';

/**
 * Advertisements observed in public ad libraries.
 *
 * Everything here is a bounded sample with its coverage stated: how many
 * records were looked at, how many matched the course terms, and whether the
 * library let us look at all. "Blocked" or "limited" is never read as "no
 * advertisements" — the coverage card says so in the same breath as the count.
 */
const PLATFORM_NL: Record<AdPlatform, string> = {
  google: 'Google',
  meta: 'Meta · Facebook / Instagram',
  linkedin: 'LinkedIn',
};

const COVERAGE_NL = {
  checked: 'Steekproef gecontroleerd',
  limited: 'Beperkt gecontroleerd',
  blocked: 'Toegang geblokkeerd',
  unavailable: 'Niet beschikbaar',
  failed: 'Controle onderbroken',
} as const;

export function AdvertisingPanel(props: { run: RadarRun; labelId: string; canEdit: boolean }): ReactNode {
  const { run, labelId, canEdit } = props;
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(false);
  const create = useMutation<Campaign, ApiClientError, { adId: string; objective: CampaignObjective }>({
    mutationFn: (input) =>
      api.post(`/labels/${labelId}/radar/${run.id}/ads/${input.adId}/campaign`, { objective: input.objective }),
    onSuccess: (campaign) => {
      void navigate(`/campagnes/${campaign.id}`);
    },
  });
  const report = run.report.advertising;
  if (!report) {
    return (
      <Card title="Advertenties" ariaLabel="Advertenties">
        <p className="c360-card__hint">
          Deze scan bevat geen advertentieonderzoek. Zet het aan bij een nieuwe scan.
        </p>
      </Card>
    );
  }
  const groups = (['google', 'meta', 'linkedin'] as const).map((platform) =>
    report.ads
      .filter((ad) => ad.platform === platform)
      .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active')),
  );
  const ads = Array.from({ length: Math.max(0, ...groups.map((group) => group.length)) }, (_, index) =>
    groups.flatMap((group) => (group[index] ? [group[index]] : [])),
  )
    .flat()
    .filter((ad) => filter === 'all' || ad.platform === filter);
  const visibleAds = expanded ? ads : ads.slice(0, 4);
  const scanned = report.coverage.reduce((sum, coverage) => sum + coverage.scannedCount, 0);

  return (
    <section aria-label="Advertenties voor deze opleiding" className="c360-stack">
      <div className="radar-toolbar">
        <div>
          <h2 className="c360-section-title" style={{ margin: 0 }}>
            Advertenties waargenomen in bibliotheken
          </h2>
          <p className="c360-card__hint">
            {`${String(report.ads.length)} advertenties met een tekstmatch op de opleiding, in een steekproef van ${String(scanned)} bekeken records. Een steekproef, geen marktbeeld van alle advertenties.`}
          </p>
        </div>
        <label>
          Platform{' '}
          <select
            className="c360-select"
            aria-label="Advertentieplatform"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setExpanded(false);
            }}
          >
            <option value="all">Alle platforms</option>
            {Object.entries(PLATFORM_NL).map(([key, title]) => (
              <option key={key} value={key}>
                {title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ads-coverage">
        {report.coverage.map((coverage, index) => (
          <Card key={index} title={PLATFORM_NL[coverage.platform]} ariaLabel={`${PLATFORM_NL[coverage.platform]} controle`}>
            <Badge tone={coverage.status === 'blocked' || coverage.status === 'failed' ? 'amber' : 'neutral'}>
              {COVERAGE_NL[coverage.status]}
            </Badge>
            <p>{`${String(coverage.matchedCount)} van ${String(coverage.scannedCount)} bekeken records passen bij de opleiding.`}</p>
            <p className="c360-card__hint">{coverage.note}</p>
            <p className="c360-stat__caption">{`Zoekopdracht: ${coverage.query}`}</p>
            <a href={coverage.searchUrl} target="_blank" rel="noreferrer">
              Open de advertentiebibliotheek ↗
            </a>
          </Card>
        ))}
      </div>
      {create.error && <Notice tone="warning">{create.error.userMessage}</Notice>}
      {ads.length === 0 && (
        <Notice tone="info">
          Geen bevestigde opleidingsmatches in deze selectie. Dat bewijst niet dat er geen
          advertenties zijn; bekijk de dekking per platform hierboven.
        </Notice>
      )}
      <div className="radar-grid">
        {visibleAds.map((ad) => (
          <AdCard
            key={ad.id}
            ad={ad}
            labelId={labelId}
            courseVersionId={run.courseVersionId}
            runId={run.id}
            canEdit={canEdit}
            creating={create.isPending}
            onCreate={(objective) => {
              create.mutate({ adId: ad.id, objective });
            }}
            onLooseMade={() => {
              void navigate('/content');
            }}
          />
        ))}
      </div>
      {ads.length > 4 && (
        <div className="radar-toolbar">
          <Button
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded ? 'Toon minder advertenties' : `Toon alle ${String(ads.length)} advertenties`}
          </Button>
          <span className="c360-stat__caption">{`${String(visibleAds.length)} van ${String(ads.length)} advertenties getoond`}</span>
        </div>
      )}
    </section>
  );
}

function AdCard(props: {
  ad: Advertisement;
  labelId: string;
  courseVersionId: string;
  runId: string;
  canEdit: boolean;
  creating: boolean;
  onCreate: (objective: CampaignObjective) => void;
  onLooseMade: () => void;
}): ReactNode {
  const { ad, labelId, runId } = props;
  const [objective, setObjective] = useState<CampaignObjective>('awareness');
  const id = useId();
  return (
    <Card title={ad.advertiser} ariaLabel={`Advertentie ${ad.libraryId}`}>
      <div className="radar-toolbar">
        <Badge tone="neutral">{PLATFORM_NL[ad.platform]}</Badge>
        <Badge tone={ad.status === 'active' ? 'green' : 'neutral'}>
          {ad.status === 'active'
            ? 'Actief bij controle'
            : ad.status === 'inactive'
              ? 'Niet-actief bij controle'
              : 'Actuele status niet vastgesteld'}
        </Badge>
      </div>
      {ad.screenshot && (
        <a href={`/api/v1/labels/${labelId}/radar/${runId}/ads/${ad.id}/preview`} target="_blank" rel="noreferrer">
          <img
            className="ads-screenshot"
            src={`/api/v1/labels/${labelId}/radar/${runId}/ads/${ad.id}/preview`}
            alt={`Vastgelegde advertentie van ${ad.advertiser}`}
            loading="lazy"
          />
        </a>
      )}
      <p className="c360-card__hint">
        {ad.advertiserScope === 'course_domain'
          ? 'Advertentie verwijst naar het opleidingsdomein'
          : 'Andere of nog te controleren adverteerder'}
        {` · match: ${ad.matchedTerms.join(', ')}`}
      </p>
      <details>
        <summary>Advertentietekst en brongegevens</summary>
        <pre className="ads-copy">{ad.text}</pre>
        {ad.deliveryInfo && <pre className="ads-copy">{ad.deliveryInfo}</pre>}
        <p className="c360-stat__caption">
          {`Vastgelegd: ${new Date(ad.observedAt).toLocaleString('nl-NL')} · bibliotheek-ID: ${ad.libraryId}`}
        </p>
        <a href={ad.sourceUrl} target="_blank" rel="noreferrer">
          Originele advertentie bekijken ↗
        </a>
      </details>
      {props.canEdit && (
        <>
          <ObjectiveSelect
            id={id}
            value={objective}
            onChange={setObjective}
            suggestionNl="Bekendheid: een advertentie als referentie is meestal een aanleiding voor bereik onder wie nog niet zoekt."
            disabled={props.creating}
          />
          <MakeSomethingOf
            labelId={labelId}
            courseVersionId={props.courseVersionId}
            buttonLabel="Hier iets van maken"
            dialogTitle="Wat maak je van deze advertentie?"
            subjectNl={`${ad.advertiser} · ${PLATFORM_NL[ad.platform]}`}
            angleNl={`Als inspiratie, niet om over te nemen: ${ad.advertiser} adverteert met deze tekst.\n\n"${ad.text.slice(0, 600)}"\n\nSchrijf iets eigens over hetzelfde onderwerp, vanuit onze eigen gecontroleerde informatie.`}
            originKind="radar_card"
            busy={props.creating}
            onCampaign={() => {
              props.onCreate(objective);
            }}
            onLooseMade={props.onLooseMade}
          />
        </>
      )}
      <p className="c360-card__hint">
        Referentiemateriaal: claims en aanbiedingen van deze adverteerder zijn geen feiten over onze
        opleiding.
        {ad.platform === 'meta' && ' Meta is de bibliotheek; individuele plaatsingen zijn niet afzonderlijk geverifieerd.'}
      </p>
    </Card>
  );
}
