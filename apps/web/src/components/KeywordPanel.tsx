import { useId, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { Campaign, CampaignObjective, RadarRun } from '@c360/contracts';
import { Badge, Card, Notice } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { MakeSomethingOf } from './MakeSomethingOf.js';
import { ObjectiveSelect } from './ObjectiveSelect.js';

/**
 * Questions people ask, as found on pages — and search suggestions derived
 * from them, which are hypotheses. A question on a page proves that someone
 * wrote it down, not that anyone searches for it: there is no volume, no
 * click price and no competition score here, by shape.
 */
const INTENT_NL = {
  informational: 'Informatie',
  comparison: 'Vergelijken',
  course_choice: 'Opleidingskeuze',
} as const;

/** The stage a question's intent points at; the person confirms or changes it. */
const OBJECTIVE_FOR_INTENT: Record<keyof typeof INTENT_NL, { objective: CampaignObjective; whyNl: string }> = {
  informational: { objective: 'awareness', whyNl: 'Bekendheid: een informatievraag hoort bij wie het onderwerp nog verkent.' },
  comparison: { objective: 'consideration', whyNl: 'Overweging: een vergelijkingsvraag hoort bij wie opties naast elkaar zet.' },
  course_choice: { objective: 'consideration', whyNl: 'Overweging: een keuzevraag hoort bij wie de inhoud en werkwijze weegt.' },
};

export function KeywordPanel(props: { run: RadarRun; labelId: string; canEdit: boolean }): ReactNode {
  const { run, labelId, canEdit } = props;
  const navigate = useNavigate();
  const create = useMutation<Campaign, ApiClientError, { id: string; objective: CampaignObjective }>({
    mutationFn: (input) =>
      api.post(`/labels/${labelId}/radar/${run.id}/keywords/${input.id}/campaign`, { objective: input.objective }),
    onSuccess: (campaign) => {
      void navigate(`/campagnes/${campaign.id}`);
    },
  });
  const research = run.report.keywords;
  if (!research) {
    return (
      <Notice tone="info">
        Deze scan bevat geen vragenonderzoek. Zet het aan bij een nieuwe scan om vragen en
        zoekvoorstellen te krijgen.
      </Notice>
    );
  }
  return (
    <Card title="Vragen en zoekvoorstellen" ariaLabel="Vragenonderzoek">
      <p>
        Vragen die letterlijk op een bronpagina staan, en zoekvoorstellen die daaruit zijn afgeleid.
        Een vraag op een pagina bewijst geen zoekvolume; een zoekvoorstel is een te toetsen idee.
        Zoekvolume, klikprijs en concurrentiescore ontbreken hier bewust: er is geen bron voor.
      </p>
      {research.notes.map((note, index) => (
        <p className="c360-card__hint" key={index}>
          {note}
        </p>
      ))}
      {research.items.length === 0 && (
        <p>Geen onderbouwde vragen gevonden. Voeg relevante FAQ-bronnen toe aan een nieuwe scan.</p>
      )}
      <div className="radar-grid">
        {research.items.map((item) => (
          <KeywordCard
            key={item.id}
            item={item}
            labelId={labelId}
            courseVersionId={run.courseVersionId}
            canEdit={canEdit}
            creating={create.isPending}
            onCreate={(objective) => {
              create.mutate({ id: item.id, objective });
            }}
            onLooseMade={() => {
              void navigate('/content');
            }}
          />
        ))}
      </div>
      {create.error && <Notice tone="warning">{create.error.userMessage}</Notice>}
      {canEdit && (
        <p>
          <a href={`/api/v1/labels/${labelId}/radar/${run.id}/package`} download>
            Download het onderzoeksdossier (ZIP)
          </a>
        </p>
      )}
      <p className="c360-card__hint">
        Het onderzoeksdossier bevat bronverwijzingen, vragen, doelgroepbevindingen, kansen en
        advertentiemetadata — het onderzoek, geen content. Content maak je vanuit de campagne, na de
        goedgekeurde briefing.
      </p>
    </Card>
  );
}

function KeywordCard(props: {
  item: NonNullable<RadarRun['report']['keywords']>['items'][number];
  labelId: string;
  courseVersionId: string;
  canEdit: boolean;
  creating: boolean;
  onCreate: (objective: CampaignObjective) => void;
  onLooseMade: () => void;
}): ReactNode {
  const { item } = props;
  const suggestion = OBJECTIVE_FOR_INTENT[item.intent];
  const [objective, setObjective] = useState<CampaignObjective>(suggestion.objective);
  const id = useId();
  return (
    <section className="radar-approach">
      <Badge tone="neutral">{item.kind === 'page_question' ? 'Vraag op bronpagina' : 'Zoekvoorstel · hypothese'}</Badge>
      <h3 className="c360-card__title">{item.phrase}</h3>
      <p>{item.rationale}</p>
      <p className="c360-card__hint">{`${INTENT_NL[item.intent]} · zoekvolume onbekend`}</p>
      <details>
        <summary>Onderbouwing</summary>
        <blockquote>{item.excerpt}</blockquote>
        <a href={item.sourceUrl} target="_blank" rel="noreferrer">
          Bekijk bron ↗
        </a>
        <p className="c360-stat__caption">{`Gelezen: ${new Date(item.retrievedAt).toLocaleString('nl-NL')}`}</p>
      </details>
      {props.canEdit && (
        <>
          <ObjectiveSelect id={id} value={objective} onChange={setObjective} suggestionNl={suggestion.whyNl} disabled={props.creating} />
          <MakeSomethingOf
            labelId={props.labelId}
            courseVersionId={props.courseVersionId}
            buttonLabel="Hier iets van maken"
            dialogTitle="Wat maak je van deze zoekvraag?"
            subjectNl={item.phrase}
            angleNl={`Beantwoord de vraag "${item.phrase}" voor wie die stelt.\n\nWaarom deze vraag speelt: ${item.rationale}\n\nGevonden passage: ${item.excerpt}`}
            originKind="radar_card"
            busy={props.creating}
            onCampaign={() => {
              props.onCreate(objective);
            }}
            onLooseMade={props.onLooseMade}
          />
        </>
      )}
    </section>
  );
}
