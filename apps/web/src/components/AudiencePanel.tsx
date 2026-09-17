import { useId, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { AudienceFinding, Campaign, CampaignObjective, RadarRun } from '@c360/contracts';
import { Badge, Card, Notice } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { MakeSomethingOf } from './MakeSomethingOf.js';
import { ObjectiveSelect } from './ObjectiveSelect.js';

/**
 * Roles and audiences as public pages describe them — employer teams,
 * vacancies, alumni stories, course audiences — each with the passage it
 * rests on and what it does not prove. About roles and organisations, never
 * about persons: names and contact details are not collected.
 */
const KIND_NL = {
  employer_team: 'Werkgever / team',
  vacancy: 'Vacature',
  alumni_story: 'Alumniverhaal',
  course_audience: 'Doelgroep van een opleiding',
} as const;

export function AudiencePanel(props: { run: RadarRun; labelId: string; canEdit: boolean }): ReactNode {
  const { run, labelId, canEdit } = props;
  const navigate = useNavigate();
  const create = useMutation<Campaign, ApiClientError, { id: string; objective: CampaignObjective }>({
    mutationFn: (input) =>
      api.post(`/labels/${labelId}/radar/${run.id}/audience/${input.id}/campaign`, { objective: input.objective }),
    onSuccess: (campaign) => {
      void navigate(`/campagnes/${campaign.id}`);
    },
  });
  const report = run.report.audience;
  if (!report) {
    return <Notice tone="info">Start een nieuwe scan voor rol- en doelgroeponderzoek.</Notice>;
  }
  return (
    <section aria-label="Rollen en doelgroepen" className="c360-stack">
      {report.competitors.length > 0 && (
        <Card title="Externe opleidingsaanbieders" ariaLabel="Externe opleidingsaanbieders">
          <p className="c360-card__hint">
            Brononderbouwde selectie, ook gebruikt voor het advertentieonderzoek. Controleer de
            vergelijkbaarheid en een eventuele merkrelatie; het marktbeeld citeert hun eigen woorden.
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

      <Card title="Rollen en doelgroepen" ariaLabel="Rollen en doelgroepen">
        <p className="c360-card__hint">
          {`${String(report.findings.length)} bevindingen uit ${String(report.independentDomains)} verschillende brondomeinen, in een steekproef van ${String(report.checkedSources)} gelezen pagina's. Geen sectorverdeling en geen doelgroepomvang: daarvoor is dit geen bron.`}
        </p>
        <p className="c360-card__hint">
          Een bronrol die de kwalificatie al heeft, is een beroepsreferentie: de campagne onderzoekt
          dan instroom zonder die kwalificatie. Gediplomeerden zijn niet automatisch de doelgroep.
        </p>
        {create.error && <Notice tone="warning">{create.error.userMessage}</Notice>}
        {report.findings.length === 0 && (
          <Notice tone="info">
            Geen controleerbaar rolbewijs gevonden. Er zijn geen sectoren of alumni ingevuld.
          </Notice>
        )}
        <div className="radar-grid">
          {report.findings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              labelId={labelId}
              courseVersionId={run.courseVersionId}
              canEdit={canEdit}
              creating={create.isPending}
              onCreate={(objective) => {
                create.mutate({ id: finding.id, objective });
              }}
              onLooseMade={() => {
                void navigate('/content');
              }}
            />
          ))}
        </div>
        {report.notes.map((note, index) => (
          <p className="c360-card__hint" key={index}>
            {note}
          </p>
        ))}
      </Card>
    </section>
  );
}

function FindingCard(props: {
  finding: AudienceFinding;
  labelId: string;
  courseVersionId: string;
  canEdit: boolean;
  creating: boolean;
  onCreate: (objective: CampaignObjective) => void;
  onLooseMade: () => void;
}): ReactNode {
  const { finding } = props;
  const [objective, setObjective] = useState<CampaignObjective>('consideration');
  const id = useId();
  return (
    <Card title={finding.role} ariaLabel={`Rol ${finding.role}`}>
      <Badge tone="neutral">{KIND_NL[finding.sourceKind]}</Badge>
      <p className="c360-card__hint">{`${finding.organization} · sector: ${finding.sector ?? 'niet vastgesteld'}`}</p>
      <blockquote>{finding.excerpt}</blockquote>
      <p>
        <strong>Doelgroephypothese:</strong> {finding.hypothesis}
      </p>
      <p>
        <strong>Nog te beoordelen:</strong> {finding.uncertainty}
      </p>
      <details>
        <summary>Sector, opleider en bron controleren</summary>
        <p>Sectorpassage: {finding.sectorExcerpt ?? 'geen afzonderlijke onderbouwing.'}</p>
        <p>Opleider in de bron: {finding.educationProvider ?? 'niet vastgesteld'}</p>
        {finding.educationExcerpt && <blockquote>{finding.educationExcerpt}</blockquote>}
        <p className="c360-card__hint">
          Een genoemde kwalificatie bewijst geen specifieke opleider. Controleer bij een alumniverhaal
          of de passage de gevolgde opleiding bevestigt.
        </p>
        <p className="c360-stat__caption">{`Gelezen: ${new Date(finding.retrievedAt).toLocaleString('nl-NL')}`}</p>
        <a href={finding.sourceUrl} target="_blank" rel="noreferrer">
          Bron bekijken ↗
        </a>
      </details>
      {props.canEdit && (
        <>
          <ObjectiveSelect
            id={id}
            value={objective}
            onChange={setObjective}
            suggestionNl="Overweging: een doelgroephypothese vraagt eerst om persona's en een boodschap die vergelijkt."
            disabled={props.creating}
          />
          <MakeSomethingOf
            labelId={props.labelId}
            courseVersionId={props.courseVersionId}
            buttonLabel="Hier iets van maken"
            dialogTitle="Wat maak je van deze doelgroepbevinding?"
            subjectNl={finding.role}
            angleNl={`Schrijf voor de rol "${finding.role}".\n\nGevonden bij: ${finding.organization}\n\nPassage: ${finding.excerpt}`}
            originKind="radar_card"
            busy={props.creating}
            onCampaign={() => {
              props.onCreate(objective);
            }}
            onLooseMade={props.onLooseMade}
          />
        </>
      )}
    </Card>
  );
}
