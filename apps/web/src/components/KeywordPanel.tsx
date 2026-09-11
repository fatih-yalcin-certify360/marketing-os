import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { RadarRun, Campaign } from '@c360/contracts';
import { Button, Card, Notice, Badge } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
export function KeywordPanel({ run, labelId, canEdit }: { run: RadarRun; labelId: string; canEdit: boolean }): ReactNode {
  const navigate = useNavigate();
  const create = useMutation<Campaign, ApiClientError, string>({
    mutationFn: (id) => api.post(`/labels/${labelId}/radar/${run.id}/keywords/${id}/campaign`),
    onSuccess: (campaign) => { void navigate(`/campagnes/${campaign.id}`); },
  });
  const research = run.report.keywords;
  if (!research && !run.report.package) return <Notice tone="info">Deze eerdere scan bevat nog geen vragenonderzoek. Start een nieuwe scan om vragen en een conceptpakket te krijgen.</Notice>;
  return <Card title="Vragen en zoekvoorstellen" ariaLabel="Vragenonderzoek en pakket">
    <p>Maak content rond concrete opleidingsvragen. Een vraag op een pagina bewijst geen zoekvolume; een zoekvoorstel blijft een te toetsen idee.</p>
    {research?.notes.map((note, i) => <p className="c360-card__hint" key={i}>{note}</p>)}
    {!research?.items.length && <p>Geen onderbouwde vragen gevonden. Voeg relevante FAQ-bronnen toe aan een nieuwe scan.</p>}
    <div className="radar-grid">{research?.items.map((item) => <section className="radar-approach" key={item.id}>
      <Badge tone="neutral">{item.kind === 'page_question' ? 'Vraag op bronpagina' : 'Zoekvoorstel · hypothese'}</Badge>
      <h3>{item.phrase}</h3><p>{item.rationale}</p>
      <p className="c360-card__hint">{({ informational: 'Informatie', comparison: 'Vergelijken', course_choice: 'Opleidingskeuze' })[item.intent]} · Zoekvolume onbekend</p>
      <details><summary>Onderbouwing</summary><blockquote>{item.excerpt}</blockquote><a href={item.sourceUrl} target="_blank" rel="noreferrer">Bekijk bron ↗</a><p>Gelezen: {new Date(item.retrievedAt).toLocaleString('nl-NL')}</p></details>
      <Button disabled={!canEdit || create.isPending} onClick={() => { create.mutate(item.id); }}>Maak campagne rond deze vraag</Button>
    </section>)}</div>
    {create.error && <Notice tone="warning">{create.error.userMessage}</Notice>}
    {canEdit && <p><a href={`/api/v1/labels/${labelId}/radar/${run.id}/package`} download>Download onderzoeksdossier (ZIP)</a></p>}
    <p>Maak vanuit een bronvraag een campagne. Na de briefing kies je daar het contentpakket volgens de actuele merkregels.</p>
    <p className="c360-card__hint">Het onderzoeksdossier bevat bronverwijzingen, vragen, doelgroepen, kansen en advertentiemetadata. Advertentiebeelden worden niet als eigen campagnemateriaal geleverd. Dit pakket is concept; controleer claims en merkstijl vóór gebruik.</p>
  </Card>;
}
