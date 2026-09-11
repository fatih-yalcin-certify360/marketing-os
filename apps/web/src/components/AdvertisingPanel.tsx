import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { RadarRun, Campaign, AdPlatform } from '@c360/contracts';
import { Card, Notice, Badge, Button } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
const platformNames: Record<AdPlatform, string> = {
  google: 'Google',
  meta: 'Meta · Facebook / Instagram',
  linkedin: 'LinkedIn',
};
export function AdvertisingPanel({
  run,
  labelId,
  canEdit,
}: {
  run: RadarRun;
  labelId: string;
  canEdit: boolean;
}): ReactNode {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(false);
  const create = useMutation<Campaign, ApiClientError, string>({
    mutationFn: (adId) =>
      api.post(`/labels/${labelId}/radar/${run.id}/ads/${adId}/campaign`),
    onSuccess: (campaign) => {
      void navigate(`/campagnes/${campaign.id}`);
    },
  });
  const report = run.report.advertising;
  if (!report)
    return (
      <Card title="Advertenties" ariaLabel="Advertenties">
        <p>
          Deze eerdere scan bevat geen advertentieonderzoek. Start een nieuwe
          scan met advertentieonderzoek ingeschakeld.
        </p>
      </Card>
    );
  const groups = (['google', 'meta', 'linkedin'] as const).map((platform) =>
    report.ads
      .filter((ad) => ad.platform === platform)
      .sort(
        (a, b) => Number(b.status === 'active') - Number(a.status === 'active'),
      ),
  );
  const ads = Array.from(
    { length: Math.max(0, ...groups.map((group) => group.length)) },
    (_, index) =>
      groups.flatMap((group) => (group[index] ? [group[index]] : [])),
  )
    .flat()
    .filter((ad) => filter === 'all' || ad.platform === filter);
  const visibleAds = expanded ? ads : ads.slice(0, 4);
  return (
    <section aria-label="Advertenties voor deze opleiding">
      <div className="radar-toolbar">
        <div>
          <h2>Advertenties voor deze opleiding</h2>
          <p>
            Gevonden in advertentiebibliotheken. Eigen advertenties en
            advertenties van andere aanbieders, met een tekstmatch op de
            opleiding.
          </p>
        </div>
        <label>
          Platform{' '}
          <select
            aria-label="Advertentieplatform"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setExpanded(false);
            }}
          >
            <option value="all">Alle platforms</option>
            {Object.entries(platformNames).map(([key, title]) => (
              <option key={key} value={key}>
                {title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ads-coverage">
        {report.coverage.map((coverage, index) => (
          <Card
            key={index}
            title={platformNames[coverage.platform]}
            ariaLabel={`${platformNames[coverage.platform]} controle`}
          >
            <Badge
              tone={
                coverage.status === 'blocked' || coverage.status === 'failed'
                  ? 'amber'
                  : 'neutral'
              }
            >
              {coverage.status === 'blocked'
                ? 'Toegang beperkt'
                : coverage.status === 'unavailable'
                  ? 'Niet beschikbaar'
                  : coverage.status === 'failed'
                    ? 'Controle onderbroken'
                    : 'Steekproef gecontroleerd'}
            </Badge>
            <p>
              <strong>{coverage.matchedCount}</strong> passende advertenties ·{' '}
              {coverage.scannedCount} records bekeken
            </p>
            <p className="c360-card__hint">{coverage.note}</p>
            <p>Zoekopdracht: {coverage.query}</p>
            <a href={coverage.searchUrl} target="_blank" rel="noreferrer">
              Open de advertentiebibliotheek ↗
            </a>
          </Card>
        ))}
      </div>
      {create.error && (
        <Notice tone="warning">{create.error.userMessage}</Notice>
      )}
      {ads.length === 0 && (
        <Notice tone="info">
          Geen bevestigde opleidingsmatches in deze selectie. Dit bewijst niet
          dat er geen advertenties zijn; bekijk de dekking per platform
          hierboven.
        </Notice>
      )}
      <div className="radar-grid">
        {visibleAds.map((ad) => (
          <Card
            key={ad.id}
            title={ad.advertiser}
            ariaLabel={`Advertentie ${ad.libraryId}`}
          >
            <div className="radar-toolbar">
              <Badge tone="neutral">{platformNames[ad.platform]}</Badge>
              <Badge tone={ad.status === 'active' ? 'green' : 'neutral'}>
                {ad.status === 'active'
                  ? 'Actief bij controle'
                  : ad.status === 'inactive'
                    ? 'Niet-actief bij controle'
                    : 'Actuele status niet vastgesteld'}
              </Badge>
            </div>
            {ad.screenshot && (
              <a
                href={`/api/v1/labels/${labelId}/radar/${run.id}/ads/${ad.id}/preview`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  className="ads-screenshot"
                  src={`/api/v1/labels/${labelId}/radar/${run.id}/ads/${ad.id}/preview`}
                  alt={`Vastgelegde advertentie van ${ad.advertiser}`}
                  loading="lazy"
                />
              </a>
            )}
            <p className="c360-card__hint">
              {ad.advertiserScope === 'course_domain'
                ? 'Advertentie verwijst naar het opleidingsdomein'
                : 'Andere of nog te controleren adverteerder'}{' '}
              · Match: {ad.matchedTerms.join(', ')}
            </p>
            <details>
              <summary>Advertentietekst en brongegevens</summary>
              <pre className="ads-copy">{ad.text}</pre>
              {ad.deliveryInfo && (
                <pre className="ads-copy">{ad.deliveryInfo}</pre>
              )}
              <p>
                Vastgelegd: {new Date(ad.observedAt).toLocaleString('nl-NL')}
                <br />
                Bibliotheek-ID: {ad.libraryId}
              </p>
            </details>
            <div className="radar-toolbar">
              <a href={ad.sourceUrl} target="_blank" rel="noreferrer">
                Originele advertentie bekijken ↗
              </a>
              <Button
                disabled={!canEdit || create.isPending}
                onClick={() => {
                  create.mutate(ad.id);
                }}
              >
                Gebruik als campagne-inspiratie
              </Button>
            </div>
            <p className="c360-card__hint">
              Referentiemateriaal; claims en aanbiedingen van deze adverteerder
              zijn geen feiten over onze opleiding.{' '}
              {ad.platform === 'meta' &&
                'Meta is de bibliotheek; individuele plaatsingen zijn hier niet afzonderlijk geverifieerd.'}
            </p>
          </Card>
        ))}
      </div>
      {ads.length > 4 && (
        <div className="radar-toolbar">
          <Button
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded
              ? 'Toon minder advertenties'
              : `Toon alle ${String(ads.length)} advertenties`}
          </Button>
          <span>
            {visibleAds.length} van {ads.length} advertenties getoond
          </span>
        </div>
      )}
    </section>
  );
}
