import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { RadarRun, Campaign } from '@c360/contracts';
import { Card, Notice, Badge, Button } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
const kinds = {
  employer_team: 'Werkgever / team',
  vacancy: 'Vacature',
  alumni_story: 'Alumniverhaal',
  course_audience: 'Doelgroep van een opleiding',
};
export function AudiencePanel({
  run,
  labelId,
  canEdit,
}: {
  run: RadarRun;
  labelId: string;
  canEdit: boolean;
}) {
  const navigate = useNavigate();
  const create = useMutation<Campaign, ApiClientError, string>({
    mutationFn: (id) =>
      api.post(`/labels/${labelId}/radar/${run.id}/audience/${id}/campaign`),
    onSuccess: (campaign) => {
      void navigate(`/campagnes/${campaign.id}`);
    },
  });
  const report = run.report.audience;
  if (!report)
    return (
      <Notice tone="info">
        Start een nieuwe scan voor rol- en doelgroeponderzoek.
      </Notice>
    );
  return (
    <section aria-label="Rollen en doelgroepen">
      <h2>Rollen en doelgroepen</h2>
      {(report.competitors?.length ?? 0) > 0 && (
        <Card
          title="Externe opleidingsaanbieders"
          ariaLabel="Externe opleidingsaanbieders"
        >
          <p>
            Brononderbouwde selectie voor Google-advertentieonderzoek.
            Controleer de vergelijkbaarheid en eventuele merkrelaties.
          </p>
          {report.competitors.map((item) => (
            <details key={item.sourceUrl}>
              <summary>{item.organization}</summary>
              <p>{item.reason}</p>
              <blockquote>{item.excerpt}</blockquote>
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                Opleidingsbron bekijken ↗
              </a>
            </details>
          ))}
        </Card>
      )}

      <p>
        {report.findings.length} bronbevindingen · {report.independentDomains}{' '}
        verschillende brondomeinen · {report.checkedSources} pagina's
        onderzocht. Kies een onderbouwde aanname om campagnepersona's te
        ontwikkelen.
      </p>
      <p className="c360-card__hint">Een bronrol met de opleidingskwalificatie dient als beroepsreferentie. De campagne onderzoekt dan instroom zonder die kwalificatie; bestaande gediplomeerden zijn niet automatisch de doelgroep.</p>
      {create.error && (
        <Notice tone="warning">{create.error.userMessage}</Notice>
      )}
      {!report.findings.length && (
        <Notice tone="info">
          Geen controleerbaar rolbewijs gevonden. Er zijn geen sectoren of
          alumni ingevuld.
        </Notice>
      )}
      <div className="radar-grid">
        {report.findings.map((finding) => (
          <Card
            key={finding.id}
            title={finding.role}
            ariaLabel={`Rol ${finding.role}`}
          >
            <Badge tone="neutral">{kinds[finding.sourceKind]}</Badge>
            <p>
              {finding.organization} · Sector:{' '}
              {finding.sector ?? 'niet vastgesteld'}
            </p>
            <blockquote>{finding.excerpt}</blockquote>
            <p>
              <strong>Doelgroephypothese:</strong> {finding.hypothesis}
            </p>
            <p>
              <strong>Nog te beoordelen:</strong> {finding.uncertainty}
            </p>
            <details>
              <summary>Sector, opleider en bron controleren</summary>
              <p>
                Sectorpassage:{' '}
                {finding.sectorExcerpt ?? 'Geen afzonderlijke onderbouwing.'}
              </p>
              <p>
                Opleider in de bron:{' '}
                {finding.educationProvider ?? 'niet vastgesteld'}
              </p>
              {finding.educationExcerpt && (
                <blockquote>{finding.educationExcerpt}</blockquote>
              )}
              <p>
                Een genoemde kwalificatie bewijst geen specifieke opleider.
                Controleer bij een alumniverhaal of de passage de gevolgde
                opleiding bevestigt.
              </p>
              <p>
                Gelezen: {new Date(finding.retrievedAt).toLocaleString('nl-NL')}
              </p>
            </details>
            <div className="radar-toolbar">
              <a href={finding.sourceUrl} target="_blank" rel="noreferrer">
                Bron bekijken ↗
              </a>
              <Button
                disabled={!canEdit || create.isPending}
                onClick={() => {
                  create.mutate(finding.id);
                }}
              >
                Maak campagne voor deze doelgroep
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {report.notes.map((note, index) => (
        <p className="c360-card__hint" key={index}>
          {note}
        </p>
      ))}
    </section>
  );
}
