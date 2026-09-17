import { useId, useState, type ReactNode } from 'react';
import type { CampaignListItem, ContentAssetVersion } from '@c360/contracts';
import { Button, Notice } from '@c360/ui';
import { useAttachToCampaign } from '../api/campaign-queries.js';

/**
 * Gives a loose piece a campaign, after the fact.
 *
 * Only campaigns about the same course are offered, and the server checks it
 * again: attaching a piece to a campaign about another course would cut the
 * text loose from the card it was grounded in, which is the one thing that
 * makes a piece without a briefing safe (2026-09-15).
 *
 * Unlike HubSpot, where adding an asset to one campaign silently removes it
 * from another, this is a one-way door with a visible consequence: the piece
 * leaves the "zonder campagne" list and joins the campaign's content step.
 */
export function AttachToCampaign(props: {
  labelId: string;
  asset: ContentAssetVersion;
  campaigns: readonly CampaignListItem[];
}): ReactNode {
  const attach = useAttachToCampaign(props.labelId);
  const selectId = useId();
  const [open, setOpen] = useState(false);

  const eligible = props.campaigns.filter(
    (campaign) => campaign.courseVersionId === props.asset.courseVersionId,
  );
  const [campaignId, setCampaignId] = useState('');
  const chosen = campaignId === '' ? (eligible[0]?.id ?? '') : campaignId;

  if (!open) {
    return (
      <Button
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        Koppel aan campagne
      </Button>
    );
  }

  return (
    <div className="c360-stack" style={{ marginTop: 'var(--c360-space-3)' }}>
      {eligible.length === 0 ? (
        <Notice tone="info">
          Er is nog geen campagne over dezelfde opleiding. Een uiting koppelen aan een campagne over
          een andere opleiding zou haar losmaken van de opleidingskaart waarop ze rust.
        </Notice>
      ) : (
        <>
          <label className="c360-label" htmlFor={selectId}>
            Campagne
          </label>
          <select
            id={selectId}
            className="c360-select"
            value={chosen}
            onChange={(event) => {
              setCampaignId(event.target.value);
            }}
          >
            {eligible.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
          <p className="c360-card__hint">
            De uiting verlaat daarmee de lijst zonder campagne en verschijnt bij de content van die
            campagne. Terugdraaien kan alleen door haar daar terug te trekken.
          </p>
        </>
      )}
      {attach.isError && <Notice tone="warning">{attach.error.userMessage}</Notice>}
      <div className="c360-row">
        <Button
          variant="primary"
          disabled={attach.isPending || chosen === ''}
          busy={attach.isPending}
          onClick={() => {
            attach.mutate({ assetId: props.asset.id, campaignId: chosen });
          }}
        >
          Koppelen
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
          }}
          disabled={attach.isPending}
        >
          Annuleren
        </Button>
      </div>
    </div>
  );
}
