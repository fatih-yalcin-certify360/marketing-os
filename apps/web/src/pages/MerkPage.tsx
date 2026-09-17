import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ApiClientError } from '../api/client.js';
import { useLabelDetail } from '../api/queries.js';
import type { BrandState } from '../api/campaign-queries.js';
import { useId, useState, type ReactNode } from 'react';
import type { BrandProfileInput, LabelSummary } from '@c360/contracts';
import { Badge, Button, Card, Field, Notice } from '@c360/ui';
import {
  uploadFileUrl,
  useApproveBrand,
  useBrand,
  useSaveBrand,
  useUploadBrandLogo,
} from '../api/campaign-queries.js';
import { ErrorState, LoadingState } from '../components/states.js';

/**
 * Brand profile.
 *
 * Brand rules are hard constraints, not styling preferences: the colours drive
 * the image render layer, and the `must_not` rules are copied into every
 * brief's off-limits list. That is why this screen shows the effect of each
 * field rather than presenting them as a settings form.
 */
export function MerkPage(props: { label: LabelSummary | undefined }): ReactNode {
  const brand = useBrand(props.label?.id);

  if (props.label === undefined) {
    return (
      <div className="os-page">
        <Notice tone="warning">Kies eerst een label.</Notice>
      </div>
    );
  }
  if (brand.isPending) {
    return (
      <div className="os-page">
        <LoadingState label="Merkprofiel wordt geladen" />
      </div>
    );
  }
  if (brand.isError) {
    return (
      <div className="os-page">
      <ErrorState
        message={brand.error.userMessage}
        requestId={brand.error.requestId}
        onRetry={() => void brand.refetch()}
      />
      </div>
    );
  }

  const current = brand.data.latest ?? null;
  const approved = brand.data.approved ?? null;

  return (
    <div className="os-page os-page--reading">
      <header className="os-page__head">
        <div className="os-page__head-text">
          <p className="os-eyebrow">Kennis &amp; beheer</p>
          <h1 className="c360-page-title">Merk &amp; bronnen</h1>
          <p className="c360-page-lead">
            Het goedgekeurde merkprofiel is bindend: deze kleuren sturen de beelden, de interface van
            dit label, en de merkregels komen automatisch in het buiten kader van elke briefing.
          </p>
        </div>
        <div className="os-page__actions">
          {approved === null ? (
            <Badge tone="amber">Nog geen goedgekeurd merkprofiel</Badge>
          ) : (
            <>
              <Badge tone="green" icon="check">{`Goedgekeurd · versie ${String(approved.version)}`}</Badge>
              {approved.origin === 'demo' && <Badge tone="amber">Demo</Badge>}
            </>
          )}
        </div>
      </header>

      {/* Two columns where the canvas allows: where the brand comes from on
          the left, what it paints with on the right. */}
      <div className="os-brandgrid">
        <PortalConnection key={props.label.id} label={props.label} state={brand.data} />

      {approved === null ? (
        <Notice tone="warning">
          Er is nog geen goedgekeurd merkprofiel. Zonder goedgekeurd merkprofiel kan er geen
          campagne worden gestart.
        </Notice>
      ) : (
        <Card title={`Goedgekeurd: ${approved.brandName}`} ariaLabel="Goedgekeurd merkprofiel">
          <div className="c360-row">
            {approved.origin === 'demo' && <Badge tone="amber">Demo</Badge>}
            <Badge tone="green">{`Versie ${String(approved.version)}`}</Badge>
          </div>

          <dl className="c360-definition" style={{ marginTop: 'var(--c360-space-4)' }}>
            <div>
              <dt className="c360-definition__term">Kleuren van dit label</dt>
              <dd className="c360-definition__value" style={{ fontWeight: 400 }}>
                <p className="c360-definition__note" style={{ marginBottom: 6 }}>
                  Gebruikt in de beelden én in deze interface. Vlakken met tekst gebruiken een
                  verdonkerde variant, zodat kleine tekst leesbaar blijft.
                </p>
                {(
                  [
                    ['Primair', approved.colors.primary, 'Balken, markers en de gevulde knoppen'],
                    ['Accent', approved.colors.accent, 'Attentiestip en de markering van de huidige stap'],
                    ['Tekstkleur op donker', approved.colors.onSurface, 'De navigatiebalk en het einde van de gradiënt'],
                    ['Tekst op primair', approved.colors.onPrimary, 'Tekst op een gevuld merkvlak in beelden'],
                  ] as const
                ).map(([name, value, use]) => (
                  <span key={name} className="os-swatchrow">
                    <span className="os-swatchrow__chip" aria-hidden="true" style={{ background: value }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{name}</span>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--tx-3)' }}>{use}</span>
                    </span>
                    <span className="os-swatchrow__hex">{value}</span>
                  </span>
                ))}
                <span
                  className="os-gradient"
                  style={{
                    display: 'grid',
                    gap: 6,
                    borderRadius: 'var(--radius-lg)',
                    padding: 14,
                    marginTop: 10,
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', opacity: 0.85 }}>
                    VOORBEELD IN BEELD
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>
                    {approved.exampleContent.slice(0, 120) || 'Zo ziet een merkvlak met tekst eruit.'}
                  </span>
                  <span style={{ fontSize: 11.5, lineHeight: 1.5, opacity: 0.9 }}>
                    Het woordmerk wordt door onze eigen rendering in het beeld gezet, niet door een
                    AI-model getekend.
                  </span>
                </span>
              </dd>
            </div>
            <div>
              <dt className="c360-definition__term">Woordmerk in beelden</dt>
              <dd className="c360-definition__value">
                {approved.logoAssetId ? 'Origineel logo uit Brand Portal' : approved.logoText ?? 'Geen'}
                <p className="c360-definition__note">
                  Het woordmerk wordt door onze eigen rendering in het beeld gezet, niet door een
                  AI-model getekend.
                </p>
              </dd>
            </div>
            <div>
              <dt className="c360-definition__term">Merkstem</dt>
              <dd className="c360-definition__value">
                {approved.tone.traits.join(' · ')}
                <p className="c360-definition__note">{approved.tone.description}</p>
              </dd>
            </div>
            <div>
              <dt className="c360-definition__term">Regels</dt>
              <dd className="c360-definition__value" style={{ fontWeight: 400 }}>
                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                  {approved.rules.map((rule, index) => (
                    <li key={index} className="c360-definition__note">
                      <strong>{rule.kind === 'must' ? 'Moet:' : 'Mag niet:'}</strong> {rule.text}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        </Card>
      )}
      </div>

      {!brand.data.portal?.slug && <BrandEditor
        labelId={props.label.id}
        initial={
          current === null
            ? brand.data.startingPoint
            : {
                brandName: current.brandName,
                colors: current.colors,
                typography: current.typography,
                tone: current.tone,
                rules: current.rules,
                exampleContent: current.exampleContent,
                logoText: current.logoText,
                // Carried forward deliberately: without it, saving any other
                // field would drop the label's logo.
                logoAssetId: current.logoAssetId,
                imageUsageNote: current.imageUsageNote,
              }
        }
        pendingVersionId={
          current !== null && current.reviewState !== 'approved' ? current.id : null
        }
        pendingVersion={current?.version ?? null}
      />}
    </div>
  );
}

function BrandEditor(props: {
  labelId: string;
  initial: BrandProfileInput;
  pendingVersionId: string | null;
  pendingVersion: number | null;
}): ReactNode {
  const nameId = useId();
  const primaryId = useId();
  const accentId = useId();
  const logoId = useId();
  const logoFileId = useId();
  const toneId = useId();

  const [brandName, setBrandName] = useState(props.initial.brandName);
  const [primary, setPrimary] = useState(props.initial.colors.primary);
  const [accent, setAccent] = useState(props.initial.colors.accent);
  const [logoText, setLogoText] = useState(props.initial.logoText ?? '');
  const [logoAssetId, setLogoAssetId] = useState<string | null>(props.initial.logoAssetId);
  const uploadLogo = useUploadBrandLogo(props.labelId);
  const [toneDescription, setToneDescription] = useState(props.initial.tone.description);

  const save = useSaveBrand(props.labelId);
  const approve = useApproveBrand(props.labelId);

  return (
    <Card title="Merkprofiel aanpassen" ariaLabel="Merkprofiel aanpassen">
      <p className="c360-card__hint">
        Opslaan maakt een nieuwe versie. De vorige versie blijft bestaan; goedkeuring hoort altijd
        bij één specifieke versie.
      </p>

      <form
        className="c360-stack"
        style={{ marginTop: 'var(--c360-space-4)' }}
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({
            ...props.initial,
            brandName,
            colors: { ...props.initial.colors, primary, accent },
            tone: { ...props.initial.tone, description: toneDescription },
            logoText: logoText.trim().length === 0 ? null : logoText.trim(),
            logoAssetId,
          });
        }}
      >
        <Field id={nameId} label="Merknaam">
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="c360-input"
              required
              value={brandName}
              onChange={(event) => {
                setBrandName(event.target.value);
              }}
            />
          )}
        </Field>

        <div className="c360-row" style={{ alignItems: 'flex-end' }}>
          <Field id={primaryId} label="Primaire kleur" hint="Achtergrond van beelden">
            {(fieldProps) => (
              <input
                {...fieldProps}
                className="c360-input"
                type="color"
                value={primary}
                onChange={(event) => {
                  setPrimary(event.target.value.toUpperCase());
                }}
                style={{ width: 90, padding: 4 }}
              />
            )}
          </Field>
          <Field id={accentId} label="Accentkleur" hint="CTA en accenten">
            {(fieldProps) => (
              <input
                {...fieldProps}
                className="c360-input"
                type="color"
                value={accent}
                onChange={(event) => {
                  setAccent(event.target.value.toUpperCase());
                }}
                style={{ width: 90, padding: 4 }}
              />
            )}
          </Field>
        </div>

        <Field
          id={logoId}
          label="Woordmerk in beelden"
          hint="Wordt als echte tekst in het beeld gezet. Leeg laten betekent geen woordmerk."
        >
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="c360-input"
              maxLength={60}
              value={logoText}
              onChange={(event) => {
                setLogoText(event.target.value);
              }}
            />
          )}
        </Field>

        {/*
          * The logo file, next to the wordmark it replaces.
          *
          * Uploading does not attach it — the brand profile is versioned, so
          * the id is saved with the next version. That separation is why the
          * hint says the upload alone changes nothing: an upload that turns
          * out to be the wrong file is discarded by simply not saving.
          *
          * The endpoint and its file validation had existed for some time with
          * nothing on the other end: an uploaded logo was stored and then
          * never reached the renderer, because the render path only loaded a
          * logo for labels linked to Brand Portal.
          */}
        <Field
          id={logoFileId}
          label="Logobestand"
          hint="Een PNG-bestand, bij voorkeur met transparante achtergrond. Wordt in beelden gebruikt in plaats van het woordmerk. Uploaden alleen is niet genoeg — sla daarna op."
          error={uploadLogo.isError ? uploadLogo.error.userMessage : undefined}
        >
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="c360-input"
              type="file"
              accept=".png"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) {
                  uploadLogo.mutate(file, {
                    onSuccess: (asset) => {
                      setLogoAssetId(asset.id);
                    },
                  });
                }
              }}
            />
          )}
        </Field>

        {logoAssetId !== null && (
          <div className="c360-row" style={{ alignItems: 'center' }}>
            <img
              src={uploadFileUrl(props.labelId, logoAssetId)}
              alt="Het logo dat in beelden wordt gebruikt"
              style={{ maxHeight: 56, maxWidth: 200, background: '#FFFFFF', padding: 6, borderRadius: 8 }}
            />
            <span className="c360-stat__caption">
              {logoAssetId === props.initial.logoAssetId
                ? 'Opgeslagen logo.'
                : 'Nog niet opgeslagen — sla het merkprofiel op om dit logo te gebruiken.'}
            </span>
            <Button
              onClick={() => {
                setLogoAssetId(null);
              }}
            >
              Logo verwijderen
            </Button>
          </div>
        )}

        <Field id={toneId} label="Merkstem">
          {(fieldProps) => (
            <textarea
              {...fieldProps}
              className="c360-textarea"
              rows={3}
              value={toneDescription}
              onChange={(event) => {
                setToneDescription(event.target.value);
              }}
            />
          )}
        </Field>

        <div className="c360-row">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? 'Opslaan…' : 'Opslaan als nieuwe versie'}
          </Button>
          {props.pendingVersionId !== null && (
            <Button
              disabled={approve.isPending}
              onClick={() => {
                approve.mutate({ versionId: props.pendingVersionId! });
              }}
            >
              {approve.isPending
                ? 'Bezig…'
                : `Versie ${String(props.pendingVersion)} goedkeuren`}
            </Button>
          )}
          {save.isError && (
            <span className="c360-field__error" role="alert">
              {save.error.userMessage}
            </span>
          )}
          {approve.isError && (
            <span className="c360-field__error" role="alert">
              {approve.error.userMessage}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}


function PortalConnection({ label, state }: { label: LabelSummary; state: BrandState }): ReactNode {
  const client = useQueryClient();
  const access = useLabelDetail(label.id);
  const [slug, setSlug] = useState(label.slug);
  const sync = useMutation<unknown, ApiClientError>({
    mutationFn: () => api.post(`/labels/${label.id}/brand/portal/sync`, state.portal?.slug ? {} : { slug }),
    onSuccess: async () => { await client.invalidateQueries(); },
  });
  const portal = state.approved?.portal;
  return <Card title="Brand Portal" ariaLabel="Brand Portal verbinding">
    <p>{state.portal?.slug ? `Gekoppeld aan ${state.portal.slug}. Gepubliceerde releases zijn direct bruikbaar.` : 'Koppel een gepubliceerd merk om de kleuren, logo’s, fonts en beschikbare schrijfrichtlijnen te gebruiken.'}</p>
    {portal && <>
      <Badge tone="green">{`Production · ${portal.release}`}</Badge>
      <p>Font voor koppen: {state.approved?.typography.headingFamily}. Lopende tekst: {state.approved?.typography.bodyFamily}.</p>
      <p>Laatst gecontroleerd: {state.portal?.checkedAt ? new Date(state.portal.checkedAt).toLocaleString('nl-NL') : 'Nog niet'}</p>
      {portal.warnings.map(warning => <Notice key={warning} tone="warning">{warning}</Notice>)}
      {[['Stijlgids', portal.styleGuide], ['Contentregels', portal.contentInstructions], ['Beeldregels', portal.imageInstructions], ['Voorbeelden', portal.approvedExamples]].map(([name, value]) => value && <details key={name}><summary>{name}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{value}</p></details>)}
      <img src={`/api/v1/labels/${label.id}/brand/preview.png?v=${state.approved?.id ?? ''}`} alt="Voorbeeld met de gekoppelde merkkleuren, fonts en het originele logo" style={{ maxWidth: 360, width: '100%', marginBlock: 16, borderRadius: 12 }} />
    </>}
    {!state.portal?.configured && <Notice tone="warning">De serververbinding met Brand Portal is nog niet ingesteld.</Notice>}
    {state.portal?.error && <Notice tone="warning">{state.portal.error}</Notice>}
    {access.data?.permissions.includes('brand:write') && <div className="c360-row">
      {!state.portal?.slug && <label className="c360-field">Merkcode in Brand Portal<input className="c360-input" value={slug} onChange={event => setSlug(event.target.value)} /></label>}
      <Button disabled={!state.portal?.configured || sync.isPending || !slug.trim()} onClick={() => sync.mutate()}>{sync.isPending ? 'Synchroniseren…' : state.portal?.slug ? 'Nu synchroniseren' : 'Koppelen & synchroniseren'}</Button>
    </div>}
    {sync.error && <Notice tone="warning">{sync.error.userMessage}</Notice>}
  </Card>;
}
