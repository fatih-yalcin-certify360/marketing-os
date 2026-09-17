import { useEffect, useId, useState, type ReactNode } from 'react';
import type { FunnelStage, JobSummary, PlannableChannel } from '@c360/contracts';
import {
  CHANNEL_LABEL_NL,
  FUNNEL_STAGES,
  FUNNEL_STAGE_LABEL_NL,
  PRODUCIBLE_CHANNELS,
  type ContentOriginKind,
} from '@c360/contracts';
import { Button, Card, Field, Icon, Notice } from '@c360/ui';
import { IMAGE_CHANNELS } from '@c360/contracts';
import { useCourses, useCreateStandaloneContent } from '../api/campaign-queries.js';

/**
 * One piece of content, outside any campaign.
 *
 * The form is short on purpose: a course, a channel, optionally a stage, and
 * what the piece should be about in the requester's own words. There is no
 * briefing to lean on, so that sentence *is* the instruction — which is also
 * why it is a textarea and not a one-line field.
 *
 * Everything that makes a campaign piece safe still applies: the course card
 * and the approved brand version ground the text, the same house-style checks
 * run, and the result arrives as a draft that someone has to approve.
 */
export function StandaloneContentForm(props: {
  labelId: string;
  /** Set when the form is the dialog's own heading, so the modal is labelled. */
  headingId?: string | undefined;
  /** Prefills the form when the request came from a finding or a card. */
  seed?:
    | {
        courseVersionId?: string | undefined;
        angleNl?: string | undefined;
        stage?: FunnelStage | null | undefined;
        originKind?: ContentOriginKind | undefined;
        originRefId?: string | null | undefined;
      }
    | undefined;
  /**
   * Called once the request is queued — not once the piece exists.
   *
   * The writing happens on the worker, so the form's job is done the moment the
   * job is accepted. The shell announces the finished piece with a link to it.
   */
  onQueued: (job: JobSummary) => void;
  onCancel: () => void;
}): ReactNode {
  const courses = useCourses(props.labelId);
  const create = useCreateStandaloneContent(props.labelId);
  const ids = { course: useId(), channel: useId(), stage: useId(), angle: useId(), cta: useId() };

  const options = courses.data?.items ?? [];
  const [courseVersionId, setCourseVersionId] = useState(props.seed?.courseVersionId ?? '');
  const [channel, setChannel] = useState<PlannableChannel>('blog_article');
  const [stage, setStage] = useState<FunnelStage | ''>(props.seed?.stage ?? '');
  const [angleNl, setAngleNl] = useState(props.seed?.angleNl ?? '');
  const [ctaUrl, setCtaUrl] = useState('');
  const [queued, setQueued] = useState<JobSummary | null>(null);

  const chosenCourse = courseVersionId === '' ? (options[0]?.course.id ?? '') : courseVersionId;
  const tooShort = angleNl.trim().length < 10;
  const withImage = IMAGE_CHANNELS.includes(channel);

  /*
   * The dialog closes itself after the confirmation has been read.
   *
   * Long enough to take in — the sentence is what tells someone they may walk
   * away — and short enough that it does not become a second thing to dismiss.
   */
  useEffect(() => {
    if (queued === null) return;
    const timer = setTimeout(() => {
      props.onQueued(queued);
    }, 2_600);
    return () => {
      clearTimeout(timer);
    };
  }, [queued, props]);

  if (queued !== null) {
    return (
      <Card ariaLabel="De uiting wordt gemaakt">
        <div className="os-queued" role="status">
          <span className="os-queued__mark" aria-hidden="true">
            <Icon name="check" size={20} />
          </span>
          <h2 className="c360-section-title">De uiting wordt gemaakt</h2>
          <p className="os-queued__body">
            Je kunt doorgaan met je werk. Je krijgt rechtsboven bericht zodra ze klaar is, met een
            link naar het stuk zelf. De taak staat zolang bij Achtergrondtaken in de Werkruimte.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card ariaLabel="Losse uiting maken">
      <h2 className="c360-card__title" id={props.headingId} style={{ fontSize: 19 }}>
        Losse uiting maken
      </h2>
      <p className="c360-card__hint">
        Eén stuk, buiten een campagne om. Het rust op de opleidingskaart en het goedgekeurde
        merkprofiel, doorloopt dezelfde controles, en komt binnen als concept dat jij beoordeelt.
        Het schrijven gebeurt op de achtergrond, dus je kunt meteen verder; je krijgt bericht
        zodra het klaar is. Je kunt het later alsnog aan een campagne koppelen.
      </p>

      {courses.isPending && <p className="c360-card__hint">Opleidingen laden…</p>}
      {options.length === 0 && !courses.isPending && (
        <Notice tone="warning">
          Er is nog geen opleidingskaart voor dit label. Een losse uiting hoort altijd bij een
          opleiding.
        </Notice>
      )}

      <div className="c360-stack" style={{ marginTop: 'var(--c360-space-3)' }}>
      <Field label="Opleiding" id={ids.course}>
        {(fieldProps) => (
        <select
          {...fieldProps}
          className="c360-select"
          value={chosenCourse}
          onChange={(event) => {
            setCourseVersionId(event.target.value);
          }}
        >
          {options.map((item) => (
            <option key={item.course.id} value={item.course.id}>
              {item.course.name}
            </option>
          ))}
        </select>
        )}
      </Field>

      <Field
        label="Soort uiting"
        id={ids.channel}
        hint={
          withImage
            ? 'Dit kanaal krijgt beeld: het systeem maakt één scène en rendert er twee varianten van, in de kleuren van dit label.'
            : 'Dit kanaal is tekst; er wordt geen beeld gemaakt.'
        }
      >
        {(fieldProps) => (
        <select
          {...fieldProps}
          className="c360-select"
          value={channel}
          onChange={(event) => {
            setChannel(event.target.value as PlannableChannel);
          }}
        >
          {PRODUCIBLE_CHANNELS.map((option) => (
            <option key={option} value={option}>
              {CHANNEL_LABEL_NL[option]}
            </option>
          ))}
        </select>
        )}
      </Field>

      <Field
        label="Fase"
        id={ids.stage}
        hint="Laat leeg als het stuk geen bepaalde fase van de reis bedient."
      >
        {(fieldProps) => (
        <select
          {...fieldProps}
          className="c360-select"
          value={stage}
          onChange={(event) => {
            setStage(event.target.value as FunnelStage | '');
          }}
        >
          <option value="">Geen bepaalde fase</option>
          {FUNNEL_STAGES.map((option) => (
            <option key={option} value={option}>
              {FUNNEL_STAGE_LABEL_NL[option]}
            </option>
          ))}
        </select>
        )}
      </Field>

      <Field
        label="Waar gaat het over?"
        id={ids.angle}
        hint="Dit is de hele opdracht: er is geen briefing waarop het stuk kan leunen. Schrijf in je eigen woorden welke vraag het beantwoordt en voor wie."
      >
        {(fieldProps) => (
        <textarea
          {...fieldProps}
          className="c360-textarea"
          rows={4}
          value={angleNl}
          onChange={(event) => {
            setAngleNl(event.target.value);
          }}
        />
        )}
      </Field>

      <Field
        label="Link (optioneel)"
        id={ids.cta}
        hint="Waar de call to action naartoe wijst. Leeg betekent: de opleidingspagina."
      >
        {(fieldProps) => (
        <input
          {...fieldProps}
          className="c360-input"
          type="url"
          value={ctaUrl}
          onChange={(event) => {
            setCtaUrl(event.target.value);
          }}
          placeholder="https://…"
        />
        )}
      </Field>

      </div>

      {create.isError && <Notice tone="warning">{create.error.userMessage}</Notice>}

      <div className="c360-row" style={{ marginTop: 'var(--c360-space-4)' }}>
        <Button
          variant="primary"
          disabled={create.isPending || tooShort || chosenCourse === ''}
          busy={create.isPending}
          onClick={() => {
            create.mutate(
              {
                courseVersionId: chosenCourse,
                channel,
                stage: stage === '' ? null : stage,
                angleNl: angleNl.trim(),
                originKind: props.seed?.originKind ?? 'manual',
                originRefId: props.seed?.originRefId ?? null,
                ctaUrl: ctaUrl.trim().length === 0 ? null : ctaUrl.trim(),
              },
              { onSuccess: setQueued },
            );
          }}
        >
          {create.isPending ? 'Bezig…' : 'Maak deze uiting'}
        </Button>
        <Button variant="ghost" onClick={props.onCancel} disabled={create.isPending}>
          Annuleren
        </Button>
        {tooShort && (
          <span className="c360-stat__caption">Beschrijf eerst kort waar het stuk over gaat.</span>
        )}
      </div>
    </Card>
  );
}
