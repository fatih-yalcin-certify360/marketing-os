import { useState, type ReactNode } from 'react';
import { api } from '../api/client.js';
import { useCampaignAction } from '../api/campaign-queries.js';

export function VisualReferencesPanel(props: { labelId: string; campaignId: string; assetIds: string[] }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = useCampaignAction<unknown, string[]>(props.labelId, props.campaignId, assetIds => ({
    path: `/labels/${props.labelId}/campaigns/${props.campaignId}/visual-references`,
    method: 'PATCH', body: { assetIds },
  }));
  const upload = async (file: File): Promise<void> => {
    setBusy(true); setError('');
    try {
      if (file.size > 10 * 1_048_576) throw new Error('Maximaal 10 MB per beeld.');
      const asset = await api.upload<{ id: string }>(`/labels/${props.labelId}/uploads/visual_reference`, file);
      await save.mutateAsync([...props.assetIds, asset.id]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Upload mislukt.'); }
    finally { setBusy(false); }
  };
  return <div className="c360-stack" style={{ marginTop: 16, marginBottom: 20 }}>
    <strong>Beeldreferenties (optioneel)</strong>
    <p className="c360-card__hint">Voeg maximaal drie eigen of toegestane beelden toe voor stijl, licht en materiaal. Ze worden bij de volgende beeldgeneratie met de AI-aanbieder gedeeld. Bestaande beelden blijven behouden.</p>
    <div className="c360-row">
      {props.assetIds.map((id, index) => <figure key={id} style={{ margin: 0 }}>
        <img src={`/api/v1/labels/${props.labelId}/uploads/${id}/file`} alt={`Beeldreferentie ${String(index + 1)}`} style={{ width: 110, height: 85, objectFit: 'contain' }} />
        <figcaption><button type="button" disabled={busy || save.isPending} onClick={() => save.mutate(props.assetIds.filter(value => value !== id))}>Verwijderen</button></figcaption>
      </figure>)}
    </div>
    <label>Referentie toevoegen (PNG, JPEG, WebP)
      <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || save.isPending || props.assetIds.length >= 3}
        onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
    </label>
    {busy && <p role="status">Referentie wordt opgeslagen…</p>}
    {(error || save.isError) && <p role="alert" className="c360-field__error">{error || save.error?.message}</p>}
  </div>;
}
