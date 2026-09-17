import { useState, type ReactNode } from 'react';
import type { AdProposal, ContentAssetVersion, ContentCopy, CreativeResearchSnapshot, FunnelStage, JobSummary, MarketingChannel, RenderSpec, SocialCreativeBrief } from '@c360/contracts';
import { CHANNEL_LABEL_NL, FUNNEL_STAGE_LABEL_NL, GOOGLE_RSA, contentMarkdown, hashtagText, lengthGuidanceFor } from '@c360/contracts';
import { GoogleAdsFrameView } from './GoogleAdsFrame.js';
import { Badge, Button, Card, Field, Notice } from '@c360/ui';
import { useCampaignAction, useEditContent, useWithdrawContent } from '../api/campaign-queries.js';
import { AssetImage } from './AssetImage.js';

/**
 * One piece of content, as a person reviews it.
 *
 * What changed from the card it replaces (2026-09-12): the piece is measured
 * against its channel's minimum in words, warnings from the quality checks
 * show inline, hashtags and alt text are shown as text, every part has a copy
 * action and the whole piece can be copied as Markdown, the website form is
 * shown in full, and the editor covers sections and hashtags — the fields
 * that used to be read-only were exactly the ones a reviewer wanted to fix.
 */
const REVIEW_NL: Record<ContentAssetVersion['reviewState'], string> = {
  draft: 'Concept',
  in_review: 'In beoordeling',
  changes_requested: 'Wijzigingen gevraagd',
  approved: 'Goedgekeurd',
  needs_rereview: 'Opnieuw beoordelen',
  archived: 'Gearchiveerd',
};

const REVIEW_TONE: Record<ContentAssetVersion['reviewState'], 'purple' | 'green' | 'amber' | 'neutral'> = {
  draft: 'neutral',
  in_review: 'purple',
  changes_requested: 'amber',
  approved: 'green',
  needs_rereview: 'amber',
  archived: 'neutral',
};

const WEBSITE_FORM_NL = {
  course_page_update: 'Wijzigingsvoorstel opleidingspagina',
  blog_article: 'Blogartikel',
} as const;

function wordCount(text: string): number {
  return text.trim().split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Words a reader gets: the body plus the sections, the unit the minimum is stated in. */
function pieceWords(copy: ContentCopy): number {
  return wordCount(copy.body) + copy.sections.reduce((sum, section) => sum + wordCount(section.text), 0);
}

/** A copy-to-clipboard button that says what it copied for a moment. */
function CopyButton(props: { text: string; label: string }): ReactNode {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <Button
      variant="ghost"
      onClick={() => {
        void navigator.clipboard
          .writeText(props.text)
          .then(() => {
            setState('done');
          })
          .catch(() => {
            setState('failed');
          })
          .finally(() => {
            setTimeout(() => {
              setState('idle');
            }, 1_800);
          });
      }}
      aria-label={`${props.label} kopiëren`}
    >
      {state === 'done' ? 'Gekopieerd' : state === 'failed' ? 'Kopiëren mislukt' : props.label}
    </Button>
  );
}

const CREATIVE_MECHANISM_NL: Record<SocialCreativeBrief['mechanism'], string> = {
  visual_question: 'Herkenbare vraag',
  metaphor: 'Visuele metafoor',
  unexpected_detail: 'Verrassend detail',
  contrast: 'Visueel contrast',
  human_moment: 'Menselijk moment',
};
const TEXT_TREATMENT_NL: Record<SocialCreativeBrief['textTreatment'], string> = {
  speech_bubble: 'Tekstballon',
  editorial: 'Redactionele tekst',
  image_led: 'Beeld centraal',
};
const TEXT_POSITION_NL: Record<SocialCreativeBrief['textPosition'], string> = {
  top_left: 'Linksboven',
  top_right: 'Rechtsboven',
  bottom_left: 'Linksonder',
};

const RESEARCH_KIND_NL: Record<CreativeResearchSnapshot['sources'][number]['kind'], string> = {
  persona: 'Personabron', course: 'Opleidingsinformatie', research: 'Eerder onderzoek',
  radar: 'Marktradarsignaal', advertisement: 'Advertentiewaarneming', channel_guidance: 'Kanaalrichtlijn', reference_page: 'Gelezen webpagina',
};

function CreativeResearchDetails({ spec, asset }: { spec: RenderSpec; asset: ContentAssetVersion }): ReactNode {
  const research = spec.creativeResearch;
  const brief = spec.creativeBrief;
  if (!research || !brief) return null;
  const used = research.sources.filter(source => brief.evidenceIds.includes(source.id));
  const channelDirection = research.channels.find(item => item.channel === asset.channel);
  const historicalContext = research.brandProfileVersionId !== asset.brandProfileVersionId ||
    research.briefVersionId !== asset.briefVersionId || research.conceptVersionId !== asset.conceptVersionId ||
    research.courseVersionId !== asset.courseVersionId ||
    [...research.personaVersionIds].sort().join(',') !== [...asset.personaVersionIds].sort().join(',');
  const sourceList = (sources: CreativeResearchSnapshot['sources']): ReactNode => (
    <ul className="c360-stack" style={{ paddingLeft: '1.2em', gap: 'var(--c360-space-3)' }}>
      {sources.map(source => (
        <li key={source.id}>
          <strong>{source.title}</strong> <span className="c360-stat__caption">· {RESEARCH_KIND_NL[source.kind]}</span>
          <p style={{ margin: '4px 0' }}>{source.interpretation}</p>
          {source.excerpt && <blockquote style={{ margin: '4px 0', paddingLeft: 12, borderLeft: '2px solid var(--c360-border)', whiteSpace: 'pre-wrap' }}>{source.excerpt}</blockquote>}
          <p className="c360-card__hint" style={{ margin: '4px 0' }}>
            {source.status === 'retrieved' ? 'Pagina gelezen' : source.status === 'editorial_guidance' ? 'Vastgelegde redactionele richtlijn' : 'Eerder vastgelegde bron'}
            {source.retrievedAt ? ` · ${new Date(source.retrievedAt).toLocaleDateString('nl-NL')}` : ' · Geen brondatum'}
            {' · '}{/^https?:\/\//iu.test(source.sourceRef) ? <a href={source.sourceRef} target="_blank" rel="noreferrer">Open bron</a> : source.sourceRef}
          </p>
          {source.limitation && <p className="c360-card__hint" style={{ margin: 0 }}>{source.limitation}</p>}
        </li>
      ))}
    </ul>
  );
  const researchText = [
    ...(historicalContext ? ['Historische onderzoeksbasis: de bronbundel hoort bij een eerdere versie van de invoer. De huidige merktoepassing staat in de creatieve beeldbrief. Kies Tekst en beeld om de onderbouwing opnieuw af te stemmen.'] : []),
    `Campagnegedachte: ${research.campaignIdea}`, `Vaste beeldrichting: ${research.visualAnchor}`, `Stijl: ${research.sharedStyle}`,
    `Kanaalkeuze: ${brief.channelRationale}`, `Campagnesamenhang: ${brief.campaignAlignment}`, `Te toetsen: ${brief.testHypothesis}`,
    ...used.map(source => `${source.title}\n${source.interpretation}\n${source.excerpt}\n${source.sourceRef}\n${source.retrievedAt ?? 'Geen brondatum'}\n${source.limitation}`),
    `Beperkingen: ${research.gaps.join('\n')}`,
  ].join('\n\n');
  return (
    <details style={{ marginTop: 'var(--c360-space-3)' }}>
      <summary>Onderbouwing &amp; kanaalkeuze · {used.length} gebruikte bronnen</summary>
      <div className="c360-stack" style={{ marginTop: 'var(--c360-space-3)' }}>
        {historicalContext && <Notice tone="warning">Deze onderzoeksbasis is behouden uit de eerdere uiting. De briefing, merkversie of andere invoer is inmiddels gewijzigd; de onderbouwing is nog niet opnieuw afgestemd. De creatieve beeldbrief toont de gebruikte kleuren en fonts. Kies ‘Tekst en beeld’ om ook de onderbouwing te vernieuwen.</Notice>}
        <p className="c360-card__hint">Gedeeld campagnedossier van {new Date(research.createdAt).toLocaleDateString('nl-NL')}. {research.mode === 'refreshed_pages' ? 'Met gelezen webpagina’s.' : research.mode === 'recorded_sources' ? 'Gebaseerd op eerder vastgelegde bronnen.' : 'Gebaseerd op briefing en redactionele richtlijnen; geen zelfstandig marktonderzoek.'}</p>
        <dl className="c360-stack" style={{ margin: 0 }}>
          {[
            ['Gezamenlijke campagnegedachte', research.campaignIdea],
            ['Herkenbare beeldrichting', research.visualAnchor],
            ['Vaste stijl over kanalen', research.sharedStyle],
            ['Voor wie?', research.personas.filter(persona => brief.personaVersionIds.includes(persona.id)).map(persona => `${persona.name}: ${persona.need}`).join('\n')],
            ['Waarom deze kanaaluitwerking?', brief.channelRationale],
            ['Wat blijft herkenbaar?', brief.campaignAlignment],
            ['Te toetsen met echte lezers', brief.testHypothesis],
          ].map(([label, value]) => <div key={label}><dt className="c360-stat__caption">{label}</dt><dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{value}</dd></div>)}
        </dl>
        {channelDirection && <p className="c360-card__hint">Redactioneel vertrekpunt: {channelDirection.adaptation}</p>}
        <p className="c360-card__hint">De onderstaande bronnen inspireerden het idee. De creatieve interpretatie en verwachte reactie zijn hypotheses, geen bewezen campagneprestaties.</p>
        {sourceList(used)}
        {research.gaps.length > 0 && <div><strong>Wat nog niet onderbouwd is</strong><ul>{research.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
        <details><summary>Alle geraadpleegde bronnen ({research.sources.length})</summary>{sourceList(research.sources)}</details>
        <CopyButton text={researchText} label="Onderbouwing kopiëren" />
      </div>
    </details>
  );
}

/** The stored direction and the actual composition choices, alongside the image they produced. */
function CreativeBriefDetails({ spec }: { spec: RenderSpec }): ReactNode {
  const brief = spec.creativeBrief;
  if (brief == null) return null;
  const fields = [
    ['Creatieve aanpak', CREATIVE_MECHANISM_NL[brief.mechanism]],
    ['Inzicht in de doelgroep', brief.audienceInsight],
    ['Waarom dit idee?', brief.conceptRationale],
    ['Scène', brief.scene],
    ['Beeldopbouw', brief.composition],
    ['Tekstvorm', TEXT_TREATMENT_NL[brief.textTreatment]],
    ['Tekstplaatsing', TEXT_POSITION_NL[brief.textPosition]],
    ['Merk in het beeld', brief.brandIntegration],
    ['Kop in het beeld', spec.headline],
    ['Onderregel in het beeld', spec.subline?.trim() ? spec.subline : 'Geen onderregel'],
  ] as const;
  const colors = [
    { label: 'Achtergrond', color: spec.colors.background },
    { label: 'Tekst', color: spec.colors.foreground },
    { label: 'Accent', color: spec.colors.accent },
    ...(spec.colors.surface ? [{ label: 'Tekstvlak', color: spec.colors.surface }] : []),
    ...(spec.colors.onSurface ? [{ label: 'Tekst op tekstvlak', color: spec.colors.onSurface }] : []),
  ];
  const copiedBrief = [
    `Creatieve beeldbrief · variant ${spec.variant}`,
    ...fields.map(([label, text]) => `${label}\n${text}`),
    `Vermijden\n${brief.avoid.length > 0 ? brief.avoid.map(item => `- ${item}`).join('\n') : 'Geen extra aandachtspunten opgegeven.'}`,
    `Huisstijlkleuren\n${colors.map(({ label, color }) => `${label}: ${color}`).join('\n')}`,
    `Lettertype kop: ${spec.headingFamily}\nLettertype overige tekst: ${spec.bodyFamily}`,
    `Fontbestanden: ${spec.fontSource === 'brand_files' ? 'Merkbestanden geladen' : spec.fontSource === 'system_fallback' ? 'Systeemfallback — merkfonts controleren' : 'Niet vastgelegd'}`,
  ].join('\n\n');

  return (
    <details style={{ marginTop: 'var(--c360-space-3)' }}>
      <summary>Creatieve beeldbrief</summary>
      <div className="c360-stack" style={{ marginTop: 'var(--c360-space-3)', gap: 'var(--c360-space-3)' }}>
        <p className="c360-card__hint" style={{ margin: 0 }}>
          {`Ontwerpkeuzes en beeldtekst voor variant ${spec.variant}. De tekst wordt apart opgemaakt met de hieronder vastgelegde huisstijllettertypen. Controleer in het beeld of de boodschap bij de doelgroep past en goed leesbaar is.`}
        </p>
        {spec.fontSource === 'system_fallback' && <Notice tone="warning">Voor dit ontwerp zijn geen merkfontbestanden geladen. Er is een systeemfont gebruikt als het opgegeven lettertype ontbreekt. Controleer de typografie voordat je dit gebruikt; koppel de merkfonts via het Brand Portal voor een vaste huisstijl.</Notice>}
        {spec.colorResolution && <p className="c360-card__hint">Leesbare merkcombinatie: tekstvlak {spec.colorResolution.panel.background} met tekst {spec.colorResolution.panel.foreground} ({spec.colorResolution.panel.contrastRatio.toFixed(2)}:1). Merkstrook {spec.colorResolution.footer.background} met tekst {spec.colorResolution.footer.foreground} ({spec.colorResolution.footer.contrastRatio.toFixed(2)}:1).{[spec.colorResolution.panel, spec.colorResolution.footer].some(pair => pair.mode === 'brand_alternative') ? ' Er is automatisch een beter leesbare combinatie binnen het merkpalet gekozen.' : ''}</p>}
        <dl className="c360-stack" style={{ margin: 0, gap: 'var(--c360-space-2)' }}>
          {fields.map(([label, text]) => (
            <div key={label}>
              <dt className="c360-stat__caption">{label}</dt>
              <dd className="c360-list__subtitle" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{text}</dd>
            </div>
          ))}
        </dl>
        {brief.avoid.length > 0 && (
          <div>
            <p className="c360-stat__caption" style={{ margin: 0 }}>Vermijden</p>
            <ul className="c360-list__subtitle" style={{ margin: 0, paddingLeft: '1.2em' }}>
              {brief.avoid.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
          </div>
        )}
        <div>
          <p className="c360-stat__caption">Huisstijlkleuren in dit ontwerp</p>
          <div className="c360-row" style={{ flexWrap: 'wrap', gap: 'var(--c360-space-3)' }}>
            {colors.map(({ label, color }) => (
              <span key={label} className="c360-row">
                <span aria-hidden="true" style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 4, border: '1px solid var(--c360-border)', backgroundColor: color }} />
                <span className="c360-stat__caption">{label}: {color}</span>
              </span>
            ))}
          </div>
          <p className="c360-stat__caption">{`Lettertype kop: ${spec.headingFamily} · overige tekst: ${spec.bodyFamily}`}</p>
        </div>
        <div className="c360-row"><CopyButton text={copiedBrief} label="Beeldbrief" /></div>
      </div>
    </details>
  );
}

/**
 * One produced piece, as a tile in a grid.
 *
 * The content step used to render every piece as a full, expanded card in one
 * column: twelve pieces made a page of five thousand pixels in which nothing
 * could be found and nothing compared. The tiles answer "what did we make and
 * what still needs me" at a glance; the full card opens underneath for the one
 * you pick. Every card stays mounted behind it, so a half-typed edit and a
 * loaded e-mail preview survive switching.
 */
export function AssetTile(props: {
  asset: ContentAssetVersion;
  selected: boolean;
  onSelect: () => void;
}): ReactNode {
  const { asset } = props;
  const blocking = asset.warnings.filter((warning) => warning.blocksPublishReady).length;
  const images = asset.variants.length;
  return (
    <button
      type="button"
      className={`asset-tile${props.selected ? ' asset-tile--selected' : ''}`}
      aria-pressed={props.selected}
      onClick={props.onSelect}
    >
      <span className="asset-tile__head">
        <span className="asset-tile__channel">{CHANNEL_LABEL_NL[asset.channel]}</span>
        <Badge tone={REVIEW_TONE[asset.reviewState]}>{REVIEW_NL[asset.reviewState]}</Badge>
      </span>
      <span className="asset-tile__hook">{asset.copy.hook}</span>
      <span className="asset-tile__meta">
        <span>{`v${String(asset.version)}`}</span>
        <span>{`${String(pieceWords(asset.copy))} woorden`}</span>
        {images > 0 && <span>{`${String(images)} beeld`}</span>}
        {blocking > 0 && <span className="asset-tile__warn">{`${String(blocking)} punt${blocking === 1 ? '' : 'en'}`}</span>}
      </span>
    </button>
  );
}

export function ContentAssetCard(props: {
  labelId: string;
  /**
   * Null for a standalone piece.
   *
   * Editing and approving are label-level routes, so the campaign is only a
   * cache key here — which is why the same card reads a loose piece and a
   * campaign piece (2026-09-15). The e-mail preview is the exception: its
   * route is nested under the campaign, so it is hidden without one.
   */
  campaignId: string | null;
  asset: ContentAssetVersion;
}): ReactNode {
  const { labelId, campaignId, asset } = props;
  const [editing, setEditing] = useState(false);
  const [hook, setHook] = useState(asset.copy.hook);
  const [body, setBody] = useState(asset.copy.body);
  const [ctaUrl, setCtaUrl] = useState(asset.copy.ctaUrl ?? '');
  const [sections, setSections] = useState(asset.copy.sections.map((section) => ({ ...section })));
  const [hashtags, setHashtags] = useState(asset.copy.hashtags.map(hashtagText).join(' '));
  const [instruction, setInstruction] = useState('');
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const edit = useEditContent(labelId, campaignId);
  // Campaign pieces only: a loose piece has no campaign to leave.
  const withdraw = useWithdrawContent(labelId, campaignId ?? '');
  const approve = useCampaignAction<unknown, void>(labelId, campaignId, () => ({
    path: `/labels/${labelId}/content/${asset.id}/approve`,
    body: {},
  }));
  const [revisionScope, setRevisionScope] = useState<'copy' | 'images' | 'both'>('copy');
  const revise = useCampaignAction<JobSummary, { instructionNl: string; acceptOverwritingUserEdit: boolean }>(
    labelId,
    campaignId,
    (input) => ({
      path: `/labels/${labelId}/content/${asset.id}/revise`,
      body: { ...input, expectedVersion: asset.version, scope: revisionScope },
    }),
  );

  const rules = lengthGuidanceFor(asset.channel);
  const words = rules.minTotalWords !== null ? pieceWords(asset.copy) : wordCount(asset.copy.body);
  const minimum = rules.minTotalWords ?? rules.minBodyWords;
  const tooShort = minimum !== null && words < minimum;
  const blocking = asset.warnings.filter((warning) => warning.blocksPublishReady);
  const advisory = asset.warnings.filter((warning) => !warning.blocksPublishReady);
  const website = asset.copy.website;

  return (
    <Card ariaLabel={`${CHANNEL_LABEL_NL[asset.channel]} versie ${String(asset.version)}`}>
      <div className="c360-row" style={{ justifyContent: 'space-between' }}>
        <span className="c360-list__title">
          {`${CHANNEL_LABEL_NL[asset.channel]} · v${String(asset.version)}`}
        </span>
        <span className="c360-row">
          {asset.funnelStage !== null && <Badge tone="neutral">{FUNNEL_STAGE_LABEL_NL[asset.funnelStage]}</Badge>}
          {website !== null && <Badge tone="purple">{WEBSITE_FORM_NL[website.form]}</Badge>}
          {asset.variants.some((variant) => variant.spec.backgroundAssetId) && (
            <Badge tone="neutral">AI-beeld + huisstijl</Badge>
          )}
          {asset.editedByUserId !== null && <Badge tone="neutral">Met de hand aangepast</Badge>}
          <Badge tone={REVIEW_TONE[asset.reviewState]}>{REVIEW_NL[asset.reviewState]}</Badge>
        </span>
      </div>

      <p className="c360-stat__caption" aria-live="polite">
        {minimum === null
          ? `${String(words)} woorden.`
          : `${String(words)} woorden · minimaal ${String(minimum)} voor dit kanaal${tooShort ? ' — te kort' : ''}.`}
        {rules.maxHashtags > 0 &&
          ` ${String(asset.copy.hashtags.length)} hashtags · ${String(rules.minHashtags)} tot ${String(rules.maxHashtags)} passend.`}
      </p>

      {(blocking.length > 0 || advisory.length > 0) && (
        <div className="c360-stack" style={{ marginTop: 'var(--c360-space-3)' }}>
          {blocking.map((warning, index) => (
            <Notice key={`b${String(index)}`} tone="warning">
              {warning.messageNl}
            </Notice>
          ))}
          {advisory.map((warning, index) => (
            <Notice key={`a${String(index)}`} tone="info">
              {warning.messageNl}
            </Notice>
          ))}
        </div>
      )}

      {asset.variants.some((variant) => variant.spec.backgroundAssetId) && (
        <p className="c360-card__hint">
          Beeldcontrole vóór goedkeuring: bekijk de grote versie en controleer gezichten/handen,
          materiaal en licht, leesbaarheid en uitsnede. Bij een onnatuurlijk beeld: kies “Alleen
          beeld” en beschrijf de gewenste verbetering.
        </p>
      )}
      <div className="c360-row" style={{ marginTop: 'var(--c360-space-4)', alignItems: 'flex-start' }}>
        {asset.variants.map((variant) =>
          variant.imageAssetId === null ? null : (
            <AssetImage
              key={variant.variant}
              labelId={labelId}
              imageAssetId={variant.imageAssetId}
              altText={asset.copy.imageAltText ?? `Ontwerpvariant ${variant.variant}`}
              captionNl={`Variant ${variant.variant} · ${variant.spec.layout} · ${String(variant.spec.widthPx)}×${String(variant.spec.heightPx)}`}
              titleNl={`${CHANNEL_LABEL_NL[asset.channel]} ${variant.variant} — ${asset.copy.hook}`}
              appPath={
                props.campaignId === null
                  ? `/content?item=loose:${asset.id}`
                  : `/campagnes/${props.campaignId}?fase=content`
              }
              widthPx={variant.spec.widthPx}
              heightPx={variant.spec.heightPx}
            />
          ),
        )}
      </div>

      {asset.variants[0] && <CreativeBriefDetails spec={asset.variants[0].spec} />}
      {asset.variants[0] && <CreativeResearchDetails spec={asset.variants[0].spec} asset={asset} />}

      {!editing ? (
        <div style={{ marginTop: 'var(--c360-space-4)' }}>
          <div className="c360-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <p className="c360-list__title" style={{ fontSize: '14px', margin: 0 }}>
              {asset.copy.hook}
            </p>
            <CopyButton text={asset.copy.hook} label="Hook" />
          </div>
          <p className="c360-list__subtitle" style={{ whiteSpace: 'pre-wrap' }}>
            {asset.copy.body}
          </p>
          <div className="c360-row">
            <CopyButton text={asset.copy.body} label="Tekst" />
            <CopyButton text={contentMarkdown(asset)} label="Hele stuk als Markdown" />
          </div>

          {asset.channel === 'email' && campaignId !== null && (
            <div style={{ marginTop: 'var(--c360-space-3)' }}>
              <p className="c360-stat__caption">
                Voorbeeldweergave. De werkelijke weergave verschilt per e-mailclient; dit systeem
                verzendt niets.
              </p>
              <iframe
                title={`Voorbeeld van de e-mail, versie ${String(asset.version)}`}
                src={`/api/v1/labels/${labelId}/campaigns/${campaignId}/content/${asset.id}/email.html`}
                sandbox=""
                style={{
                  width: '100%',
                  height: 420,
                  border: '1px solid var(--c360-border)',
                  borderRadius: 8,
                  background: '#FFFFFF',
                }}
              />
            </div>
          )}

          {website?.form === 'course_page_update' && (
            <div className="c360-stack" style={{ marginTop: 'var(--c360-space-3)' }}>
              <p className="c360-card__hint">
                {`Wijzigingen voor de bestaande opleidingspagina: `}
                <a href={website.pageUrl} target="_blank" rel="noreferrer">
                  {website.pageUrl}
                </a>
                {`. Elke geciteerde passage is gecontroleerd tegen de pagina zoals die bij het maken gelezen is.`}
              </p>
              {/*
                What to write comes first, and says so.
                
                The first version led with the passage that is on the page now
                and put the new text underneath, unlabelled and in the same
                style — so the proposal read as a continuation of the quote
                rather than as a replacement for it. Somebody who has to make
                the change wants the sentence to paste; the old passage is how
                they find the spot, and the reason is why they should bother
                (2026-09-16).
              */}
              {website.changes.map((change, index) => (
                <div key={index} className="page-change">
                  <p className="page-change__where">
                    {`Wijziging ${String(index + 1)} · ${change.placement}`}
                  </p>
                  <p className="page-change__label">Schrijf dit</p>
                  <p className="page-change__text">{change.proposedText}</p>
                  <div className="c360-row">
                    <CopyButton text={change.proposedText} label={`Wijziging ${String(index + 1)}`} />
                  </div>
                  <p className="page-change__label">In plaats van wat er nu staat</p>
                  <blockquote className="page-change__current">{change.currentExcerpt}</blockquote>
                  <p className="page-change__why">{`Waarom: ${change.reason}`}</p>
                </div>
              ))}
            </div>
          )}

          {website?.form === 'blog_article' && (
            <div className="c360-stack article-preview" style={{ marginTop: 'var(--c360-space-3)' }}>
              <p className="c360-list__title" style={{ fontSize: '15px', margin: 0 }}>
                {website.title}
              </p>
              <p className="c360-stat__caption">{`Zoekfragment (${String(website.metaDescription.length)} tekens): ${website.metaDescription}`}</p>
              {website.directAnswerNl.length > 0 && (
                <p className="article-preview__answer">{website.directAnswerNl}</p>
              )}
              <p className="c360-list__subtitle" style={{ whiteSpace: 'pre-wrap' }}>
                {website.intro}
              </p>
              {website.sections.map((section, index) => (
                <div key={index} className="c360-stack" style={{ gap: 'var(--c360-space-2)' }}>
                  <p className="c360-list__title" style={{ fontSize: '13px', margin: 0 }}>
                    {section.heading}
                  </p>
                  <p className="c360-list__subtitle" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                    {section.text}
                  </p>
                  {index === 1 && website.scenarioNl.length > 0 && (
                    <blockquote className="article-preview__scenario">
                      <span className="c360-stat__caption">Praktijkscenario</span>
                      <br />
                      {website.scenarioNl}
                    </blockquote>
                  )}
                  {index === website.midCtaAfterSection && website.midCtaNl.length > 0 && (
                    <p className="article-preview__bridge">
                      <span className="c360-stat__caption">Brug naar de opleiding · eerste link</span>
                      <br />
                      {website.midCtaNl}
                    </p>
                  )}
                </div>
              ))}
              {website.externalFacts.length > 0 && (
                <div>
                  <p className="c360-list__title" style={{ fontSize: '13px' }}>
                    Aangehaalde bronnen
                  </p>
                  <ul className="c360-list__subtitle" style={{ margin: 0, paddingLeft: '1.1em' }}>
                    {website.externalFacts.map((fact, index) => (
                      <li key={index}>
                        {fact.statementNl} <span className="c360-stat__caption">— {fact.sourceRef}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {website.coursePathNl.length > 0 && (
                <div>
                  <p className="c360-list__title" style={{ fontSize: '13px' }}>
                    Wat dit van je vraagt, en de opleiding
                  </p>
                  <p className="c360-list__subtitle" style={{ whiteSpace: 'pre-wrap' }}>
                    {website.coursePathNl}
                  </p>
                </div>
              )}
              <p className="c360-list__title" style={{ fontSize: '13px' }}>
                Veelgestelde vragen
              </p>
              {website.faq.map((item, index) => (
                <p key={index} className="c360-list__subtitle">
                  <strong>{item.question}</strong> {item.answer}
                </p>
              ))}
              {website.closingCtaNl.length > 0 && (
                <p className="article-preview__bridge">
                  <span className="c360-stat__caption">Afsluitende call to action · tweede link</span>
                  <br />
                  {website.closingCtaNl}
                </p>
              )}
              <p className="c360-stat__caption">{`Linktekst naar de opleidingspagina: “${website.internalLinkText}”`}</p>
            </div>
          )}

          {website === null && asset.copy.sections.length > 0 && (
            <ol className="c360-stack" style={{ marginTop: 'var(--c360-space-3)', paddingLeft: '1.2em' }}>
              {asset.copy.sections.map((section, index) => (
                <li key={index}>
                  <div className="c360-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <p className="c360-list__title" style={{ fontSize: '13px', margin: 0 }}>
                      {section.heading}
                    </p>
                    <CopyButton text={`${section.heading}\n\n${section.text}`} label="Sectie" />
                  </div>
                  <p className="c360-list__subtitle" style={{ whiteSpace: 'pre-wrap' }}>
                    {section.text}
                  </p>
                </li>
              ))}
            </ol>
          )}

          {asset.copy.ads !== null && (
            <AdCopyBlock ads={asset.copy.ads} channel={asset.channel} stage={asset.funnelStage} />
          )}

          <p className="c360-list__subtitle">
            <strong>{asset.copy.ctaText}</strong>{' '}
            {asset.copy.ctaUrl ?? <em>(link ontbreekt — verplicht voor een publicatieklaar pakket)</em>}
          </p>

          {asset.copy.hashtags.length > 0 && (
            <div className="c360-row" style={{ alignItems: 'center' }}>
              <span className="c360-list__subtitle">{asset.copy.hashtags.map(hashtagText).join(' ')}</span>
              <CopyButton text={asset.copy.hashtags.map(hashtagText).join(' ')} label="Hashtags" />
            </div>
          )}
          {asset.copy.keywordsUsed.length > 0 && (
            <p className="c360-stat__caption">
              {`Zoektermen in de tekst: ${asset.copy.keywordsUsed.join(' · ')} — geen volume, geen positie: er is niets gemeten.`}
            </p>
          )}
          {asset.copy.imageAltText !== null && (
            <p className="c360-stat__caption">{`Alt-tekst: ${asset.copy.imageAltText}`}</p>
          )}
        </div>
      ) : (
        <div className="c360-stack" style={{ marginTop: 'var(--c360-space-4)' }}>
          <Field id={`hook-${asset.id}`} label={asset.channel === 'email' ? 'Onderwerpregel' : 'Hook'}>
            {(fieldProps) => (
              <input
                {...fieldProps}
                className="c360-input"
                value={hook}
                onChange={(event) => {
                  setHook(event.target.value);
                }}
              />
            )}
          </Field>
          <Field
            id={`body-${asset.id}`}
            label={asset.copy.sections.length > 0 ? 'Inleiding' : 'Tekst'}
            hint={
              minimum === null
                ? undefined
                : `${String(wordCount(body) + sections.reduce((sum, section) => sum + wordCount(section.text), 0))} woorden · minimaal ${String(minimum)}.`
            }
          >
            {(fieldProps) => (
              <textarea
                {...fieldProps}
                className="c360-textarea"
                rows={7}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                }}
              />
            )}
          </Field>
          {(asset.copy.sections.length > 0 || rules.minSections !== null) && (
            <fieldset className="c360-fieldset">
              <legend className="c360-label">Secties</legend>
              <div className="c360-stack">
                {sections.map((section, index) => (
                  <div key={index} className="c360-stack" style={{ gap: 'var(--c360-space-2)' }}>
                    <input
                      className="c360-input"
                      aria-label={`Kop van sectie ${String(index + 1)}`}
                      value={section.heading}
                      onChange={(event) => {
                        setSections(sections.map((entry, position) => (position === index ? { ...entry, heading: event.target.value } : entry)));
                      }}
                    />
                    <textarea
                      className="c360-textarea"
                      aria-label={`Tekst van sectie ${String(index + 1)}`}
                      rows={5}
                      value={section.text}
                      onChange={(event) => {
                        setSections(sections.map((entry, position) => (position === index ? { ...entry, text: event.target.value } : entry)));
                      }}
                    />
                    <div className="c360-row">
                      <span className="c360-stat__caption">
                        {`${String(wordCount(section.text))} woorden${rules.minSectionWords === null ? '' : ` · minimaal ${String(rules.minSectionWords)}`}`}
                      </span>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setSections(sections.filter((_, position) => position !== index));
                        }}
                      >
                        Sectie verwijderen
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  disabled={sections.length >= 8}
                  onClick={() => {
                    setSections([...sections, { heading: '', text: '' }]);
                  }}
                >
                  Sectie toevoegen
                </Button>
              </div>
            </fieldset>
          )}
          {rules.maxHashtags > 0 && (
            <Field
              id={`hashtags-${asset.id}`}
              label="Hashtags"
              hint={`${String(rules.minHashtags)} tot ${String(rules.maxHashtags)}, gescheiden door spaties; één woord per hashtag.`}
            >
              {(fieldProps) => (
                <input
                  {...fieldProps}
                  className="c360-input"
                  value={hashtags}
                  onChange={(event) => {
                    setHashtags(event.target.value);
                  }}
                />
              )}
            </Field>
          )}
          <Field id={`cta-${asset.id}`} label="CTA-link" hint="Verplicht voor een publicatieklaar pakket; een concept mag zonder.">
            {(fieldProps) => (
              <input
                {...fieldProps}
                className="c360-input"
                type="url"
                value={ctaUrl}
                onChange={(event) => {
                  setCtaUrl(event.target.value);
                }}
              />
            )}
          </Field>
          <div className="c360-row">
            <Button
              variant="primary"
              disabled={edit.isPending}
              busy={edit.isPending}
              onClick={() => {
                edit.mutate(
                  {
                    assetId: asset.id,
                    expectedVersion: asset.version,
                    copy: {
                      hook,
                      body,
                      ctaUrl: ctaUrl.trim().length === 0 ? null : ctaUrl.trim(),
                      sections: sections.filter((section) => section.heading.trim().length > 0 || section.text.trim().length > 0),
                      hashtags: hashtags
                        .split(/[\s,]+/u)
                        .map((tag) => tag.trim())
                        .filter((tag) => tag.length > 0)
                        .map(hashtagText),
                    },
                  },
                  { onSuccess: () => setEditing(false) },
                );
              }}
            >
              Opslaan als nieuwe versie
            </Button>
            <Button
              onClick={() => {
                setEditing(false);
              }}
            >
              Annuleren
            </Button>
            {edit.isError && (
              <span className="c360-field__error" role="alert">
                {edit.error.userMessage}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="c360-row" style={{ marginTop: 'var(--c360-space-4)' }}>
        {!editing && (
          <Button
            onClick={() => {
              setEditing(true);
            }}
          >
            Tekst aanpassen
          </Button>
        )}
        {asset.reviewState !== 'approved' && (
          <Button
            variant="primary"
            disabled={approve.isPending}
            busy={approve.isPending}
            onClick={() => {
              approve.mutate();
            }}
          >
            Goedkeuren
          </Button>
        )}
        {campaignId !== null && (
          <Button
            variant="ghost"
            disabled={withdraw.isPending}
            busy={withdraw.isPending}
            onClick={() => {
              setConfirmWithdraw(true);
            }}
          >
            Terugtrekken
          </Button>
        )}
        {approve.isError && (
          <span className="c360-field__error" role="alert">
            {approve.error.userMessage}
          </span>
        )}
        {withdraw.isError && (
          <span className="c360-field__error" role="alert">
            {withdraw.error.userMessage}
          </span>
        )}
      </div>

      {confirmWithdraw && campaignId !== null && (
        <Notice tone="warning">
          {/* Said before it happens, because a withdrawn piece leaves the
              campaign and its export. Nothing is deleted: every version is
              archived and the approvals keep pointing at something real. */}
          <p style={{ margin: 0 }}>
            Dit stuk verdwijnt uit de campagne en uit haar export. De versies en goedkeuringen
            blijven bewaard; je kunt hetzelfde kanaal opnieuw laten maken.
          </p>
          <div className="c360-row" style={{ marginTop: 'var(--c360-space-3)' }}>
            <Button
              variant="primary"
              disabled={withdraw.isPending}
              busy={withdraw.isPending}
              onClick={() => {
                withdraw.mutate({ assetId: asset.id });
                setConfirmWithdraw(false);
              }}
            >
              Ja, terugtrekken
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmWithdraw(false);
              }}
            >
              Annuleren
            </Button>
          </div>
        </Notice>
      )}
      <details style={{ marginTop: 'var(--c360-space-3)' }}>
        <summary>Met een instructie laten herzien</summary>
        <div className="c360-stack" style={{ marginTop: 'var(--c360-space-3)' }}>
          <Field
            id={`revise-${asset.id}`}
            label="Instructie"
            hint="In je eigen woorden. Alleen dit item wordt herzien; de boodschap en de call to action blijven gelijk tenzij je daar iets over zegt."
          >
            {(fieldProps) => (
              <textarea
                {...fieldProps}
                className="c360-textarea"
                rows={3}
                value={instruction}
                onChange={(event) => {
                  setInstruction(event.target.value);
                }}
              />
            )}
          </Field>
          <label className="c360-label">
            Wat herzien?{' '}
            <select
              className="c360-select"
              value={revisionScope}
              onChange={(event) => {
                setRevisionScope(event.target.value as 'copy' | 'images' | 'both');
              }}
            >
              <option value="copy">Alleen tekst</option>
              <option value="images">Alleen beeld</option>
              <option value="both">Tekst en beeld</option>
            </select>
          </label>
          <div className="c360-row">
            <Button
              disabled={instruction.trim().length < 3 || revise.isPending}
              busy={revise.isPending}
              onClick={() => {
                revise.mutate({
                  instructionNl: instruction.trim(),
                  acceptOverwritingUserEdit: asset.editedByUserId !== null,
                });
              }}
            >
              Herzien
            </Button>
            {asset.editedByUserId !== null && (
              <span className="c360-stat__caption">
                Let op: dit item is met de hand aangepast; een herziening overschrijft die tekst.
              </span>
            )}
            {revise.isError && (
              <span className="c360-field__error" role="alert">
                {revise.error.userMessage}
              </span>
            )}
          </div>
        </div>
      </details>
    </Card>
  );
}

export type { MarketingChannel as ContentAssetChannel };

/**
 * Advertising copy as separate lines, because a platform rotates between
 * them. For Google Search Ads every line shows its length against Google's
 * documented limit (30 for a headline, 90 for a description, 15 for a path,
 * read 2026-09-15), and the frame for the stage sits underneath, so the
 * person who builds the campaign sees the objective, the conversion actions
 * and the bidding path next to the text they paste.
 */
function AdCopyBlock(props: { ads: AdProposal; channel: MarketingChannel; stage: FunnelStage | null }): ReactNode {
  const { ads } = props;
  const google = props.channel === 'google_search_ads';
  const count = (text: string): number => [...text].length;
  const Line = (line: { text: string; max: number | null }): ReactNode => {
    const over = line.max !== null && count(line.text) > line.max;
    return (
      <li className={`rsa-line${over ? ' is-over' : ''}`}>
        <span>{line.text}</span>
        {line.max !== null && (
          <span className="rsa-line__count" aria-label={`${String(count(line.text))} van ${String(line.max)} tekens`}>
            {count(line.text)}/{line.max}
          </span>
        )}
      </li>
    );
  };
  return (
    <div className="c360-stack" style={{ marginTop: 'var(--c360-space-3)' }}>
      {google && (
        <p className="c360-stat__caption">
          Responsieve zoekadvertentie: {GOOGLE_RSA.headlines.min}–{GOOGLE_RSA.headlines.max} koppen van maximaal{' '}
          {GOOGLE_RSA.headlines.maxChars} tekens, {GOOGLE_RSA.descriptions.min}–{GOOGLE_RSA.descriptions.max} beschrijvingen van maximaal{' '}
          {GOOGLE_RSA.descriptions.maxChars}. Google toont er per vertoning een combinatie van; elke regel moet los leesbaar zijn.
        </p>
      )}
      <div>
        <p className="c360-list__title" style={{ fontSize: '13px' }}>
          Koppen ({ads.headlines.length})
        </p>
        <ol className="rsa-lines">
          {ads.headlines.map((headline, index) => (
            <Line key={index} text={headline} max={google ? GOOGLE_RSA.headlines.maxChars : null} />
          ))}
        </ol>
      </div>
      <div>
        <p className="c360-list__title" style={{ fontSize: '13px' }}>
          Beschrijvingen ({ads.descriptions.length})
        </p>
        <ol className="rsa-lines">
          {ads.descriptions.map((description, index) => (
            <Line key={index} text={description} max={google ? GOOGLE_RSA.descriptions.maxChars : null} />
          ))}
        </ol>
      </div>
      {google && ads.paths.length > 0 && (
        <div>
          <p className="c360-list__title" style={{ fontSize: '13px' }}>Weergavepaden</p>
          <ol className="rsa-lines">
            {ads.paths.map((path, index) => (
              <Line key={index} text={path} max={GOOGLE_RSA.paths.maxChars} />
            ))}
          </ol>
        </div>
      )}
      {ads.keywords.length > 0 && (
        <div>
          <p className="c360-list__title" style={{ fontSize: '13px' }}>Zoektermen</p>
          <p className="c360-list__subtitle">{ads.keywords.join(' · ')}</p>
          {ads.negativeKeywords.length > 0 && (
            <p className="c360-list__subtitle">
              <em>Uitsluiten:</em> {ads.negativeKeywords.join(' · ')}
            </p>
          )}
          {ads.matchTypeAdviceNl.length > 0 && <p className="c360-list__subtitle">{ads.matchTypeAdviceNl}</p>}
          <p className="c360-stat__caption">
            Suggesties. Er staan geen zoekvolumes, klikprijzen of conversieverwachtingen bij: daarvoor is een advertentieaccount en een meetperiode nodig.
          </p>
        </div>
      )}
      {ads.finalUrl !== null && (
        <p className="c360-list__subtitle">
          <em>Bestemming:</em> {ads.finalUrl}
        </p>
      )}
      <p className="c360-stat__caption">
        <strong>Onderbouwing:</strong> {ads.rationaleNl}
      </p>
      <div className="c360-row">
        <CopyButton text={[...ads.headlines, ...ads.descriptions].join('\n')} label="Advertentieregels" />
      </div>
      {google && props.stage !== null && <GoogleAdsFrameView stage={props.stage} />}
    </div>
  );
}
