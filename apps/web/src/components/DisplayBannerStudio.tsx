import { useId, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  BANNER_PLATFORM_RULES,
  BANNER_SIZES,
  BANNER_SIZE_ORDER,
  FRAME_LABEL_NL,
  MOTION_LABEL_NL,
  bannerMotion,
  type BannerFrameKind,
  type BannerMotion,
  type BannerPlatform,
  type BannerProposal,
  type BannerProvenance,
  type BannerSetReport,
  type BannerSize,
} from '@c360/contracts';
import { Badge, Button, Disclosure, Field, Notice } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';

/**
 * Making a set of display banners from a campaign.
 *
 * The screen starts by asking the campaign, not the person: the brief, the
 * audiences chosen in step 1 and the direction chosen in step 4 are already
 * approved, and retyping them into an empty form is both work and a chance to
 * drift away from what was agreed. What comes back is a proposal — filled-in
 * fields somebody reads and edits — because a banner runs unattended on other
 * people's pages for weeks.
 *
 * Two things the screen refuses to hide. **What did not fit**, per size, in the
 * builder's words rather than as a silently shorter banner; and **what the
 * checks do and do not mean** — they measure the files against rules read off
 * the destination's own documentation, which is not the destination accepting
 * them.
 *
 * The preview is the real thing: the same bytes the download contains, folded
 * into one document only because a sandboxed frame has no origin to resolve
 * `style.css` against.
 */

interface PreviewResponse {
  report: BannerSetReport;
  previews: Record<string, string>;
}

interface ProposeResponse {
  proposal: BannerProposal;
  provenance: BannerProvenance;
  isMock: boolean;
}

/** One editable screen. Lines are kept as text, one per row, as people write them. */
interface FrameDraft {
  kind: BannerFrameKind;
  lines: string;
}

const EMPTY: FrameDraft[] = [
  { kind: 'hook', lines: '' },
  { kind: 'proof', lines: '' },
  { kind: 'usp', lines: '' },
];

export function DisplayBannerStudio(props: {
  labelId: string;
  campaignId: string;
  canEdit: boolean;
}): ReactNode {
  const ids = {
    cta: useId(),
    sticker: useId(),
    legal: useId(),
    url: useId(),
    platform: useId(),
    motion: useId(),
  };

  const [frames, setFrames] = useState<FrameDraft[]>(EMPTY);
  const [ctaText, setCtaText] = useState('');
  const [stickerNl, setStickerNl] = useState('');
  const [legalNl, setLegalNl] = useState('');
  const [clickUrl, setClickUrl] = useState('');
  const [platform, setPlatform] = useState<BannerPlatform>('self_hosted');
  const [sizes, setSizes] = useState<BannerSize[]>([...BANNER_SIZE_ORDER]);
  const [motion, setMotion] = useState<BannerMotion>('reveal');
  const [shown, setShown] = useState<BannerSize | null>(null);
  const [rationaleNl, setRationaleNl] = useState<string | null>(null);

  const screenplay = {
    frames: frames
      .map((frame) => ({
        kind: frame.kind,
        lines: frame.lines
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      }))
      .filter((frame) => frame.lines.length > 0),
    ctaText: ctaText.trim(),
    stickerNl: stickerNl.trim().length > 0 ? stickerNl.trim() : null,
    legalNl: legalNl.trim().length > 0 ? legalNl.trim() : null,
    backgroundBriefEn: null,
  };

  const body = {
    platform,
    sizes,
    motion,
    clickUrl: clickUrl.trim().length > 0 ? clickUrl.trim() : null,
    screenplay,
  };

  const base = `/labels/${props.labelId}/display-banners`;

  const propose = useMutation<ProposeResponse, ApiClientError, void>({
    mutationFn: () =>
      api.post<ProposeResponse>(
        `/labels/${props.labelId}/campaigns/${props.campaignId}/display-banners/propose`,
      ),
    onSuccess: (data) => {
      const play = data.proposal.screenplay;
      setFrames(
        EMPTY.map((empty) => {
          const proposed = play.frames.find((frame) => frame.kind === empty.kind);
          return { kind: empty.kind, lines: proposed?.lines.join('\n') ?? '' };
        }),
      );
      setCtaText(play.ctaText);
      setStickerNl(play.stickerNl ?? '');
      setLegalNl(play.legalNl ?? '');
      setRationaleNl(data.proposal.rationaleNl);
    },
  });

  const preview = useMutation<PreviewResponse, ApiClientError, void>({
    mutationFn: () => api.post<PreviewResponse>(`${base}/preview`, body),
    onSuccess: (data) => {
      setShown(data.report.builds[0]?.size ?? null);
    },
  });

  const download = useMutation<void, ApiClientError, void>({
    mutationFn: async () => {
      const blob = await api.postFile(`${base}/zip`, body);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'display-banners.zip';
      link.click();
      URL.revokeObjectURL(url);
    },
  });

  const ready = screenplay.frames.length > 0 && screenplay.ctaText.length > 0 && sizes.length > 0;
  const rules = BANNER_PLATFORM_RULES[platform];
  const report = preview.data?.report;
  const current = shown === null ? undefined : report?.builds.find((b) => b.size === shown);

  return (
    <section className="os-panel os-panel--pad" aria-label="Display banners">
      <div className="c360-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: '1 1 28rem' }}>
          <h2 className="os-panel__title">Display banners</h2>
          <p className="os-panel__sub" style={{ marginTop: 4 }}>
            Een korte reeks: eerst een loader, dan één of twee schermen die elk één ding zeggen, en
            een stilstaand eindbeeld met de knop. Elk formaat wordt een eigen map met{' '}
            <code>index.html</code>, <code>style.css</code>, <code>main.js</code> en de bestanden die
            daarbij horen.
          </p>
        </div>
        <Button
          variant="primary"
          disabled={!props.canEdit || propose.isPending}
          busy={propose.isPending}
          onClick={() => {
            propose.mutate();
          }}
        >
          Uit deze campagne schrijven
        </Button>
      </div>

      {propose.error && <Notice tone="warning">{propose.error.userMessage}</Notice>}
      {propose.data?.isMock === true && (
        <Notice tone="warning">
          Demomodus: deze tekst is verzonnen en zegt niets over deze campagne.
        </Notice>
      )}
      {rationaleNl !== null && propose.data?.isMock !== true && (
        <Notice tone="info">
          {rationaleNl}
          <span className="c360-stat__caption" style={{ display: 'block', marginTop: 4 }}>
            Geschreven uit de goedgekeurde briefing, de gekozen doelgroepen en de gekozen richting.
            Lees het na en pas het aan — een banner draait weken zonder toezicht.
          </span>
        </Notice>
      )}

      <div className="c360-stack" style={{ marginTop: 'var(--c360-space-4)' }}>
        {frames.map((frame, index) => (
          <FrameField
            key={frame.kind}
            frame={frame}
            onChange={(lines) => {
              setFrames(frames.map((item, at) => (at === index ? { ...item, lines } : item)));
            }}
          />
        ))}

        <div className="c360-row" style={{ gap: 'var(--c360-space-3)', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 16rem' }}>
            <Field label="Knoptekst" id={ids.cta} hint="Een werkwoord. &quot;Klik hier&quot; is geen call to action.">
              {(fieldProps) => (
                <input {...fieldProps} className="c360-input" value={ctaText} maxLength={24}
                  onChange={(event) => { setCtaText(event.target.value); }} />
              )}
            </Field>
          </div>
          <div style={{ flex: '1 1 14rem' }}>
            <Field label="Hoekje" id={ids.sticker} hint="Kort, rond, rechtsboven. Alleen op staande formaten.">
              {(fieldProps) => (
                <input {...fieldProps} className="c360-input" value={stickerNl} maxLength={28}
                  onChange={(event) => { setStickerNl(event.target.value); }} />
              )}
            </Field>
          </div>
        </div>

        <div className="c360-row" style={{ gap: 'var(--c360-space-3)', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 20rem' }}>
            <Field
              label="Klikdoel"
              id={ids.url}
              hint={
                rules.clickThrough === 'final_url'
                  ? 'Google Ads neemt het doel uit de campagne (Final URL); een adres in het bestand wordt genegeerd.'
                  : 'Komt als clickTag in de banner, zoals de netwerken vragen.'
              }
            >
              {(fieldProps) => (
                <input {...fieldProps} className="c360-input" value={clickUrl} inputMode="url"
                  disabled={rules.clickThrough === 'final_url'}
                  onChange={(event) => { setClickUrl(event.target.value); }} />
              )}
            </Field>
          </div>
          <div style={{ flex: '1 1 18rem' }}>
            <Field label="Kleine lettertjes" id={ids.legal} hint="Past niet op de smalle formaten.">
              {(fieldProps) => (
                <input {...fieldProps} className="c360-input" value={legalNl} maxLength={120}
                  onChange={(event) => { setLegalNl(event.target.value); }} />
              )}
            </Field>
          </div>
        </div>

        <div className="c360-row" style={{ gap: 'var(--c360-space-3)', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 18rem' }}>
            <Field label="Waar gaat het heen?" id={ids.platform}>
              {(fieldProps) => (
                <select {...fieldProps} className="c360-input" value={platform}
                  onChange={(event) => { setPlatform(event.target.value as BannerPlatform); }}>
                  {(Object.keys(BANNER_PLATFORM_RULES) as BannerPlatform[]).map((option) => (
                    <option key={option} value={option}>{BANNER_PLATFORM_RULES[option].labelNl}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <div style={{ flex: '1 1 22rem' }}>
            <Field label="Beweging" id={ids.motion}>
              {(fieldProps) => (
                <select {...fieldProps} className="c360-input" value={motion}
                  onChange={(event) => { setMotion(event.target.value as BannerMotion); }}>
                  {bannerMotion.options.map((option) => (
                    <option key={option} value={option}>{MOTION_LABEL_NL[option]}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="c360-label" style={{ padding: 0 }}>Formaten</legend>
          <div className="c360-row" style={{ flexWrap: 'wrap', gap: 'var(--c360-space-2)', marginTop: 6 }}>
            {BANNER_SIZE_ORDER.map((size) => (
              <label key={size} className="os-pill" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={sizes.includes(size)}
                  onChange={(event) => {
                    setSizes(
                      event.target.checked
                        ? BANNER_SIZE_ORDER.filter((s) => s === size || sizes.includes(s))
                        : sizes.filter((s) => s !== size),
                    );
                  }}
                />
                <span>{size}</span>
                <span className="c360-stat__caption">
                  {`${(BANNER_SIZES[size].initialLoadGzipBytes / 1024).toFixed(0)} kB`}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="c360-row" style={{ marginTop: 'var(--c360-space-4)', gap: 'var(--c360-space-2)' }}>
        <Button
          disabled={!props.canEdit || !ready || preview.isPending}
          busy={preview.isPending}
          onClick={() => { preview.mutate(); }}
        >
          Voorbeeld maken
        </Button>
        <Button
          disabled={!props.canEdit || !ready || download.isPending}
          busy={download.isPending}
          onClick={() => { download.mutate(); }}
        >
          Pakket downloaden
        </Button>
      </div>

      {preview.error && <Notice tone="warning">{preview.error.userMessage}</Notice>}
      {download.error && <Notice tone="warning">{download.error.userMessage}</Notice>}

      {report !== undefined && (
        <div style={{ marginTop: 'var(--c360-space-4)' }}>
          {report.refusedNl.length > 0 && (
            <Notice tone="warning">
              <strong>Niet gemaakt:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: '1.1rem' }}>
                {report.refusedNl.map((item) => (
                  <li key={item.size}>{`${item.size} — ${item.reasonNl}`}</li>
                ))}
              </ul>
            </Notice>
          )}

          <div className="c360-row" style={{ flexWrap: 'wrap', gap: 'var(--c360-space-2)', marginTop: 'var(--c360-space-3)' }}>
            {report.builds.map((build) => (
              <button
                key={build.size}
                type="button"
                className={`os-filter${shown === build.size ? ' os-filter--on' : ''}`}
                aria-pressed={shown === build.size}
                onClick={() => { setShown(build.size); }}
              >
                {build.size}
                <span className="c360-stat__caption" style={{ marginLeft: 6 }}>
                  {`${String(build.frameCount)} scherm · ${(build.gzipBytes / 1024).toFixed(1)} kB`}
                </span>
              </button>
            ))}
          </div>

          {current !== undefined && (
            <div style={{ marginTop: 'var(--c360-space-3)' }}>
              <div className="c360-row" style={{ gap: 'var(--c360-space-2)', flexWrap: 'wrap' }}>
                <Badge tone="neutral">{`Animatie: ${current.engine === 'gsap' ? 'GSAP + SplitText' : 'CSS'}`}</Badge>
                <Badge tone={current.gzipBytes <= current.budgetGzipBytes ? 'green' : 'amber'}>
                  {`${(current.gzipBytes / 1024).toFixed(1)} van ${(current.budgetGzipBytes / 1024).toFixed(0)} kB`}
                </Badge>
                <Badge tone={current.fontStrategy === 'system_stack' ? 'amber' : 'neutral'}>
                  {current.fontStrategy === 'google_font'
                    ? 'Merkletter via Google Fonts'
                    : current.fontStrategy === 'system_stack'
                      ? 'Systeemletter, niet de merkletter'
                      : current.fontStrategy}
                </Badge>
              </div>

              {current.droppedNl.length > 0 && (
                <ul className="os-limit" style={{ margin: '8px 0 0', paddingLeft: '1.1rem' }}>
                  {current.droppedNl.map((line) => <li key={line}>{line}</li>)}
                </ul>
              )}

              {/*
                Scripts so the animation runs, and nothing else: no same-origin,
                so the banner cannot reach this app, read its storage or see who
                is signed in.
              */}
              <div style={{ marginTop: 'var(--c360-space-3)', overflowX: 'auto', padding: 4 }}>
                <iframe
                  key={`${current.size}-${String(preview.submittedAt)}`}
                  title={`Voorbeeld ${current.size}`}
                  sandbox="allow-scripts"
                  srcDoc={preview.data?.previews[current.size] ?? ''}
                  width={BANNER_SIZES[current.size].widthPx}
                  height={BANNER_SIZES[current.size].heightPx}
                  style={{ border: '1px solid var(--n-br)', display: 'block' }}
                />
              </div>

              <Disclosure summary={`Bestanden en controles voor ${current.size}`}>
                <ul style={{ margin: '0 0 8px', paddingLeft: '1.1rem' }}>
                  {current.files.map((file) => (
                    <li key={file.name}>
                      <code>{file.name}</code>
                      {` — ${(file.gzipBytes / 1024).toFixed(1)} kB gzip`}
                    </li>
                  ))}
                </ul>
                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                  {current.checks.map((check) => (
                    <li key={check.id}>
                      <strong>{check.passed ? '✓' : '✗'}</strong>
                      {` ${check.titleNl} — ${check.detailNl}`}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            </div>
          )}

          <ul className="os-limit" style={{ marginTop: 'var(--c360-space-3)', paddingLeft: '1.1rem' }}>
            {report.notesNl.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

const FRAME_HINT_NL: Readonly<Record<BannerFrameKind, string>> = Object.freeze({
  hook: 'De aanleiding, in de woorden van de doelgroep. Eén regel.',
  proof: 'Wat je aanbiedt, als stellende zin. Dit is de regel die op het eindbeeld blijft staan.',
  usp: 'Pluspunten, één per regel. Ze rouleren; wat niet past valt weg.',
  cta: 'Het eindbeeld.',
});

function FrameField(props: {
  frame: FrameDraft;
  onChange: (lines: string) => void;
}): ReactNode {
  const id = useId();
  const single = props.frame.kind !== 'usp';
  return (
    <Field label={FRAME_LABEL_NL[props.frame.kind]} id={id} hint={FRAME_HINT_NL[props.frame.kind]}>
      {(fieldProps) =>
        single ? (
          <input
            {...fieldProps}
            className="c360-input"
            value={props.frame.lines}
            maxLength={90}
            onChange={(event) => {
              props.onChange(event.target.value);
            }}
          />
        ) : (
          <textarea
            {...fieldProps}
            className="c360-input"
            rows={3}
            value={props.frame.lines}
            onChange={(event) => {
              props.onChange(event.target.value);
            }}
          />
        )
      }
    </Field>
  );
}
