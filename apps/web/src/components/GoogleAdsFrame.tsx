import type { ReactNode } from 'react';
import { FUNNEL_STAGE_LABEL_NL, GOOGLE_ADS_VERIFIED_AT, googleAdsFrame, type FunnelStage } from '@c360/contracts';
import { Badge, Disclosure } from '@c360/ui';

/**
 * The Google Ads frame for one funnel stage, as Google documents it
 * (google-ads-practice.md, read 2026-09-15): the objective in Google's
 * vocabulary, the campaign type, why, the keyword approach, the conversion
 * actions to configure first, the bidding path, budget, measurement, the
 * landing page and the EEA requirements — with the source pages. Shown
 * wherever Google Ads is advised or produced, so the person who builds the
 * campaign in Google Ads is guided by the tool instead of guessing.
 */
export function GoogleAdsFrameView(props: { stage: FunnelStage; open?: boolean | undefined }): ReactNode {
  const frame = googleAdsFrame(props.stage);
  const fitLabel =
    frame.fit === 'not_search'
      ? 'Geen zoekcampagne in deze fase'
      : frame.fit === 'search_first'
        ? 'Zoekcampagne eerst'
        : 'Zoekcampagne, dan opschalen';
  return (
    <Disclosure summary={`Google Ads-kader voor ${FUNNEL_STAGE_LABEL_NL[props.stage]}`} defaultOpen={props.open === true}>
      <div className="google-ads-frame">
        <p>
          <Badge tone={frame.fit === 'not_search' ? 'amber' : 'green'}>{fitLabel}</Badge>
        </p>
        <dl className="c360-definition">
          <div>
            <dt className="c360-definition__term">Campagnedoel in Google Ads</dt>
            <dd className="c360-definition__value">{frame.campaignGoalNl}</dd>
          </div>
          <div>
            <dt className="c360-definition__term">Campagnetype</dt>
            <dd className="c360-definition__value">{frame.campaignTypeNl}</dd>
          </div>
          <div>
            <dt className="c360-definition__term">Waarom</dt>
            <dd className="c360-definition__value" style={{ fontWeight: 400 }}>{frame.whyNl}</dd>
          </div>
          <div>
            <dt className="c360-definition__term">Zoektermen</dt>
            <dd className="c360-definition__value" style={{ fontWeight: 400 }}>{frame.keywordsNl}</dd>
          </div>
          <div>
            <dt className="c360-definition__term">Uitsluitingen</dt>
            <dd className="c360-definition__value" style={{ fontWeight: 400 }}>{frame.negativeKeywordsNl}</dd>
          </div>
        </dl>
        <p className="c360-list__title" style={{ fontSize: '13px' }}>Conversieacties eerst inrichten</p>
        <ul className="c360-list">
          {frame.conversionActionsNl.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
        <p className="c360-list__title" style={{ fontSize: '13px' }}>Bieden, met de data mee</p>
        <ol className="c360-list">
          {frame.biddingNl.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ol>
        <dl className="c360-definition">
          <div>
            <dt className="c360-definition__term">Budget</dt>
            <dd className="c360-definition__value" style={{ fontWeight: 400 }}>{frame.budgetNl}</dd>
          </div>
          <div>
            <dt className="c360-definition__term">Meten</dt>
            <dd className="c360-definition__value" style={{ fontWeight: 400 }}>{frame.measurementNl}</dd>
          </div>
          <div>
            <dt className="c360-definition__term">Bestemmingspagina</dt>
            <dd className="c360-definition__value" style={{ fontWeight: 400 }}>{frame.landingPageNl}</dd>
          </div>
        </dl>
        <p className="c360-list__title" style={{ fontSize: '13px' }}>Vereisten (EER en Google-beleid)</p>
        <ul className="c360-list">
          {frame.complianceNl.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
        <p className="c360-stat__caption">
          Bronnen, gelezen op {GOOGLE_ADS_VERIFIED_AT.slice(0, 10)}:{' '}
          {frame.sources.map((source, index) => (
            <span key={source.url}>
              {index > 0 && ' · '}
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.titleNl}
              </a>
            </span>
          ))}
          . Dit systeem kent geen zoekvolumes, klikprijzen of conversiecijfers; die komen uit het advertentieaccount.
        </p>
      </div>
    </Disclosure>
  );
}
