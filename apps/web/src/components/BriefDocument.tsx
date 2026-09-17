import { useState, type ReactNode } from 'react';
import type { BriefVersion, FunnelStage, PersonaVersion } from '@c360/contracts';
import { promisesInteractiveForm, CHANNEL_LABEL_NL, FUNNEL_STAGE_LABEL_NL } from '@c360/contracts';
import type { BriefEditInput } from '@c360/contracts';
import { Badge, Button, Notice } from '@c360/ui';

/**
 * The briefing as a document: the sections a professional campaign brief
 * has, in reading order, numbered, with a word count and a Markdown copy.
 *
 * Briefs written before 2026-09-14 lack the newer sections; those are shown
 * as "niet uitgewerkt" rather than hidden, so a reader sees that the briefing
 * predates the format and can have it drafted again.
 */
export function briefWords(text: string): number {
  return text.trim().split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export function briefTotalWords(brief: BriefVersion): number {
  return [
    brief.contextNl,
    brief.goal,
    brief.audienceInsightNl,
    brief.propositionNl,
    brief.coreMessage,
    brief.toneOfVoiceNl,
    brief.contentScope,
    brief.timingNl,
    brief.measurement,
    brief.stopConditions,
    ...brief.stageMessages.map((message) => message.coreMessageNl),
    ...brief.channelRoles.map((role) => role.roleNl),
    ...brief.risks,
    ...brief.mandatories,
  ].reduce((sum, text) => sum + briefWords(text), 0);
}

const NOT_WRITTEN = 'Niet uitgewerkt in deze versie van de briefing. Werk de briefing opnieuw uit voor dit onderdeel.';

/** The whole briefing as Markdown, for a document or an agency mail. */
export function briefMarkdown(input: {
  brief: BriefVersion;
  campaignName: string;
  courseName: string;
  personas: readonly PersonaVersion[];
  stages: readonly FunnelStage[];
}): string {
  const { brief, personas, stages } = input;
  const section = (title: string, body: string): string[] => [`## ${title}`, '', body.trim().length === 0 ? `_${NOT_WRITTEN}_` : body, ''];
  const list = (items: readonly string[]): string => (items.length === 0 ? `_${NOT_WRITTEN}_` : items.map((item) => `- ${item}`).join('\n'));
  const lines: string[] = [
    `# Campagnebriefing — ${input.campaignName}`,
    '',
    `Opleiding: ${input.courseName} · Versie ${String(brief.version)} · ${brief.reviewState === 'approved' ? 'Goedgekeurd' : 'Concept'} · ${new Date(brief.createdAt).toLocaleDateString('nl-NL')}`,
    '',
    ...section('1. Aanleiding en context', brief.contextNl),
    ...section('2. Doelstelling', brief.goal),
    ...section(
      '3. Doelgroep en inzicht',
      [
        personas.length === 0 ? '' : `Gekozen doelgroepen: ${personas.map((persona) => `${persona.name} (v${String(persona.version)})`).join(', ')}.`,
        brief.audienceInsightNl,
      ]
        .filter((part) => part.length > 0)
        .join('\n\n'),
    ),
    ...section('4. Propositie en belofte', brief.propositionNl),
    ...section('5. Kernboodschap', brief.coreMessage),
    ...section(
      '6. Boodschap per funnelfase',
      brief.stageMessages.length === 0
        ? ''
        : stages
            .map((stage) => brief.stageMessages.find((message) => message.stage === stage))
            .filter((message): message is NonNullable<typeof message> => message !== undefined)
            .map(
              (message) =>
                `**${FUNNEL_STAGE_LABEL_NL[message.stage]}** — ${message.coreMessageNl}\n  Call to action: ${message.ctaNl}\n  Bewijs: ${message.proofFields.length === 0 ? 'geen opleidingsfeit voor deze fase' : message.proofFields.join(', ')}`,
            )
            .join('\n\n'),
    ),
    ...section('7. Toon en stijl', brief.toneOfVoiceNl),
    ...section('8. Verplichte elementen', list(brief.mandatories)),
    ...section(
      '9. Kanalen en hun rol',
      brief.channelSuggestions
        .map((channel) => {
          const role = brief.channelRoles.find((entry) => entry.channel === channel);
          return `- **${CHANNEL_LABEL_NL[channel]}** — ${role?.roleNl ?? 'rol niet uitgewerkt'}`;
        })
        .join('\n'),
    ),
    ...section('10. Deliverables en creatieve richting', brief.contentScope),
    ...section('11. Timing en fasering', brief.timingNl),
    ...section('12. Meten en bijsturen', `${brief.measurement}\n\n**Stop- en bijstuurcriteria:** ${brief.stopConditions}`),
    ...section('13. Risico’s en aannames', list(brief.risks)),
    ...section('14. Call to action', `${brief.cta}${brief.ctaUrl === null ? '' : ` — ${brief.ctaUrl}`}`),
    ...section(
      '15. Toegestane claims',
      brief.usableClaims.length === 0 ? 'Geen — er is niets gecontroleerd om te claimen.' : brief.usableClaims.map((claim) => `- ${claim.claim} _(${claim.backedBy})_`).join('\n'),
    ),
    ...section('16. Buiten kader', list(brief.offLimits)),
    ...section(
      '17. Zoektermen',
      brief.keywords.length === 0 ? 'Geen zoektermen in deze versie.' : brief.keywords.map((keyword) => `- ${keyword.phrase} _(${keyword.kind === 'radar' ? 'onderzoek' : 'afgeleid'}: ${keyword.sourceRef})_`).join('\n'),
    ),
  ];
  if (brief.reviewNotes.length > 0) {
    lines.push(...section('Controlepunten', list(brief.reviewNotes)));
  }
  lines.push(`_${String(briefTotalWords(brief))} woorden. Elk opleidingsfeit is herleidbaar naar de gecontroleerde opleidingskaart; er staan geen prognoses in._`);
  return lines.join('\n');
}

/** What a section may hand to the editor: which field to patch, and its current text. */
export type BriefEditableField = keyof Pick<
  BriefEditInput,
  | 'contextNl'
  | 'goal'
  | 'audienceInsightNl'
  | 'propositionNl'
  | 'coreMessage'
  | 'toneOfVoiceNl'
  | 'contentScope'
  | 'timingNl'
  | 'measurement'
  | 'stopConditions'
  | 'cta'
>;

export interface BriefEditing {
  /** Saves one field and returns when the new version is stored. */
  save: (patch: BriefEditInput) => Promise<unknown>;
  busy: boolean;
}

/**
 * The seventeen parts of a briefing, in reading order.
 *
 * One list, used both by the jump index and by the sections themselves, so the
 * index cannot name a section that is not there (2026-09-15).
 */
const BRIEF_SECTIONS: readonly { number: number; title: string }[] = Object.freeze([
  { number: 1, title: 'Aanleiding en context' },
  { number: 2, title: 'Doelstelling' },
  { number: 3, title: 'Doelgroep en inzicht' },
  { number: 4, title: 'Propositie en belofte' },
  { number: 5, title: 'Kernboodschap — de rode draad' },
  { number: 6, title: 'Boodschap per funnelfase' },
  { number: 7, title: 'Toon en stijl' },
  { number: 8, title: 'Verplichte elementen' },
  { number: 9, title: 'Kanalen en hun rol' },
  { number: 10, title: 'Deliverables en creatieve richting' },
  { number: 11, title: 'Timing en fasering' },
  { number: 12, title: 'Meten en bijsturen' },
  { number: 13, title: 'Risico’s en aannames' },
  { number: 14, title: 'Call to action' },
  { number: 15, title: 'Toegestane claims' },
  { number: 16, title: 'Buiten kader' },
  { number: 17, title: 'Zoektermen' },
]);

/** The number and title of one section, by its number. */
function briefSection(number: number): { number: number; title: string } {
  const found = BRIEF_SECTIONS.find((section) => section.number === number);
  if (found === undefined) throw new Error(`onbekende briefingsectie ${String(number)}`);
  return found;
}

function Section(props: {
  number: number;
  title: string;
  children: ReactNode;
  empty?: boolean;
  /** Present when this section holds one free-text field a person may rewrite. */
  edit?: { field: BriefEditableField; value: string; editing?: BriefEditing | undefined };
}): ReactNode {
  const edit = props.edit;
  return (
    <section className="brief-doc__section" aria-labelledby={`brief-section-${String(props.number)}`}>
      <h3 className="brief-doc__title" id={`brief-section-${String(props.number)}`}>
        <span className="brief-doc__number">{String(props.number)}</span>
        {props.title}
      </h3>
      {edit?.editing === undefined ? (
        props.empty === true ? <p className="brief-doc__empty">{NOT_WRITTEN}</p> : props.children
      ) : (
        <EditableSection
          field={edit.field}
          value={edit.value}
          editing={edit.editing}
          title={props.title}
          empty={props.empty === true}
        >
          {props.children}
        </EditableSection>
      )}
    </section>
  );
}

/**
 * One section of the briefing, rewritable by hand.
 *
 * Until 2026-09-15 the briefing was read-only in the interface while the PATCH
 * route existed and had no caller (audit): changing one sentence meant
 * regenerating the whole document and losing every other correction. Saving
 * here creates the next version through the same endpoint the API already
 * validated, so the versioning, the review state and the re-review rules are
 * unchanged — this only gives the person who knows the market a way in.
 */
function EditableSection(props: {
  field: BriefEditableField;
  value: string;
  editing: BriefEditing;
  title: string;
  empty: boolean;
  children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(props.value);
  const [error, setError] = useState('');

  if (!open) {
    return (
      <>
        {props.empty ? <p className="brief-doc__empty">{NOT_WRITTEN}</p> : props.children}
        <p className="brief-doc__edit-row">
          <Button
            size="sm"
            variant="ghost"
            icon="edit"
            onClick={() => {
              setDraft(props.value);
              setError('');
              setOpen(true);
            }}
          >
            Bijschrijven
          </Button>
        </p>
      </>
    );
  }

  return (
    <div className="brief-doc__edit">
      <label className="c360-field">
        <span className="c360-visually-hidden">{props.title}</span>
        <textarea
          className="c360-textarea"
          aria-label={props.title}
          rows={Math.min(16, Math.max(4, Math.ceil(draft.length / 90) + 2))}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
      </label>
      {error !== '' && <Notice tone="warning">{error}</Notice>}
      <div className="c360-row">
        <Button
          size="sm"
          variant="primary"
          disabled={props.editing.busy || draft.trim() === props.value.trim()}
          onClick={() => {
            void (async () => {
              try {
                await props.editing.save({ [props.field]: draft });
                setOpen(false);
              } catch (cause) {
                setError(
                  cause instanceof Error && 'userMessage' in cause
                    ? String((cause as { userMessage?: string }).userMessage ?? cause.message)
                    : 'Opslaan is niet gelukt. Je tekst staat er nog.',
                );
              }
            })();
          }}
        >
          Opslaan als nieuwe versie
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={props.editing.busy}
          onClick={() => {
            setOpen(false);
          }}
        >
          Annuleren
        </Button>
      </div>
      <p className="c360-stat__caption">
        Opslaan maakt versie {'n+1'} van de briefing. Een goedgekeurde briefing vraagt daarna opnieuw
        om goedkeuring, en content die op de oude versie rust wordt gemarkeerd.
      </p>
    </div>
  );
}

function Prose(props: { text: string }): ReactNode {
  return (
    <div className="brief-doc__prose">
      {props.text
        .split(/\n{2,}/u)
        .filter((paragraph) => paragraph.trim().length > 0)
        .map((paragraph, index) => (
          <p key={index}>{paragraph.trim()}</p>
        ))}
    </div>
  );
}

export function BriefDocument(props: {
  brief: BriefVersion;
  campaignName: string;
  courseName: string;
  personas: readonly PersonaVersion[];
  stages: readonly FunnelStage[];
  /** The stage-message block the campaign screen already renders, placed as section 6. */
  stageMessages: ReactNode;
  /** Present when the reader may rewrite a section by hand (2026-09-15). */
  editing?: BriefEditing | undefined;
}): ReactNode {
  const { brief, personas, stages } = props;
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const words = briefTotalWords(brief);
  const legacy = brief.contextNl.length === 0 && brief.audienceInsightNl.length === 0;

  return (
    <article className="brief-doc" aria-label={`Campagnebriefing versie ${String(brief.version)}`}>
      <header className="brief-doc__header">
        <div>
          <p className="brief-doc__kicker">Campagnebriefing</p>
          <p className="c360-card__hint" style={{ margin: 0 }}>
            {`${props.courseName} · versie ${String(brief.version)} · ${String(words)} woorden · ${new Date(brief.createdAt).toLocaleDateString('nl-NL')}`}
          </p>
        </div>
        <div className="c360-row">
          {legacy && <Badge tone="amber">Oud formaat: nog niet alle onderdelen</Badge>}
          <Button
            variant="ghost"
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  briefMarkdown({
                    brief,
                    campaignName: props.campaignName,
                    courseName: props.courseName,
                    personas,
                    stages,
                  }),
                )
                .then(() => {
                  setCopied('done');
                })
                .catch(() => {
                  setCopied('failed');
                })
                .finally(() => {
                  setTimeout(() => {
                    setCopied('idle');
                  }, 1_800);
                });
            }}
          >
            {copied === 'done' ? 'Gekopieerd' : copied === 'failed' ? 'Kopiëren mislukt' : 'Kopieer als Markdown'}
          </Button>
        </div>
      </header>

      <div className="brief-doc__layout">
        {/* A briefing runs to six screens; without an index a reader scrolls
            past the part they came for (2026-09-15). */}
        <nav className="brief-doc__index" aria-label="Onderdelen van de briefing">
          <p className="brief-doc__index-title">Onderdelen</p>
          <ol className="brief-doc__index-list">
            {BRIEF_SECTIONS.map((section) => (
              <li key={section.number}>
                <a href={`#brief-section-${String(section.number)}`}>
                  <span className="brief-doc__index-number">{section.number}</span>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="brief-doc__body">
      <Section {...briefSection(1)} empty={brief.contextNl.length === 0} edit={{ field: 'contextNl', value: brief.contextNl, editing: props.editing }}>
        <Prose text={brief.contextNl} />
      </Section>
      <Section {...briefSection(2)} edit={{ field: 'goal', value: brief.goal, editing: props.editing }}>
        <Prose text={brief.goal} />
      </Section>
      <Section {...briefSection(3)} empty={brief.audienceInsightNl.length === 0 && personas.length === 0} edit={{ field: 'audienceInsightNl', value: brief.audienceInsightNl, editing: props.editing }}>
        {personas.length > 0 && (
          <p className="brief-doc__meta">
            {`Gekozen doelgroepen: ${personas.map((persona) => `${persona.name} (v${String(persona.version)})`).join(', ')}.`}
          </p>
        )}
        {brief.audienceInsightNl.length === 0 ? <p className="brief-doc__empty">{NOT_WRITTEN}</p> : <Prose text={brief.audienceInsightNl} />}
      </Section>
      <Section {...briefSection(4)} empty={brief.propositionNl.length === 0} edit={{ field: 'propositionNl', value: brief.propositionNl, editing: props.editing }}>
        <Prose text={brief.propositionNl} />
      </Section>
      <Section {...briefSection(5)} edit={{ field: 'coreMessage', value: brief.coreMessage, editing: props.editing }}>
        <p className="brief-doc__core">{brief.coreMessage}</p>
      </Section>
      <Section {...briefSection(6)}>{props.stageMessages}</Section>
      <Section {...briefSection(7)} empty={brief.toneOfVoiceNl.length === 0} edit={{ field: 'toneOfVoiceNl', value: brief.toneOfVoiceNl, editing: props.editing }}>
        <Prose text={brief.toneOfVoiceNl} />
      </Section>
      <Section {...briefSection(8)} empty={brief.mandatories.length === 0}>
        <ul className="brief-doc__list">
          {brief.mandatories.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </Section>
      <Section {...briefSection(9)}>
        <ul className="brief-doc__list">
          {brief.channelSuggestions.map((channel) => {
            const role = brief.channelRoles.find((entry) => entry.channel === channel);
            return (
              <li key={channel}>
                <strong>{CHANNEL_LABEL_NL[channel]}</strong>
                {' — '}
                {role?.roleNl ?? <span className="brief-doc__empty">rol niet uitgewerkt in deze versie</span>}
              </li>
            );
          })}
        </ul>
        <p className="c360-definition__note">
          Het kanaalplan in stap 5 verdeelt deze kanalen over de fasen en adviseert ook over de andere kanalen.
        </p>
      </Section>
      <Section {...briefSection(10)} edit={{ field: 'contentScope', value: brief.contentScope, editing: props.editing }}>
        <Prose text={brief.contentScope} />
      </Section>
      <Section {...briefSection(11)} empty={brief.timingNl.length === 0} edit={{ field: 'timingNl', value: brief.timingNl, editing: props.editing }}>
        <Prose text={brief.timingNl} />
      </Section>
      <Section {...briefSection(12)} edit={{ field: 'measurement', value: brief.measurement, editing: props.editing }}>
        <Prose text={brief.measurement} />
        <p className="brief-doc__meta">
          <strong>Stop- en bijstuurcriteria.</strong> {brief.stopConditions}
        </p>
      </Section>
      <Section {...briefSection(13)} empty={brief.risks.length === 0}>
        <ul className="brief-doc__list">
          {brief.risks.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </Section>
      <Section {...briefSection(14)}>
        <p className="brief-doc__meta">
          <strong>{brief.cta}</strong>
          {brief.ctaUrl === null ? (
            <span className="c360-definition__note"> — link ontbreekt; verplicht voor een publicatieklaar pakket</span>
          ) : (
            ` — ${brief.ctaUrl}`
          )}
        </p>
        {promisesInteractiveForm([brief.cta, ...brief.stageMessages.map((message) => message.ctaNl)]) && (
          <p className="c360-definition__note">
            Deze call to action belooft een keuzehulp of quiz. Maak die in de tak <strong>Website &amp; interactief</strong>{' '}
            en plaats hem op de opleidingspagina; de link hierboven blijft die pagina.
          </p>
        )}
      </Section>
      <Section {...briefSection(15)}>
        {brief.usableClaims.length === 0 ? (
          <p className="c360-definition__note">Geen — er is niets gecontroleerd om te claimen.</p>
        ) : (
          <ul className="brief-doc__list">
            {brief.usableClaims.map((claim, index) => (
              <li key={index}>
                {claim.claim} <em className="c360-definition__note">({claim.backedBy})</em>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section {...briefSection(16)}>
        <ul className="brief-doc__list">
          {brief.offLimits.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </Section>
      <Section {...briefSection(17)}>
        {brief.keywords.length === 0 ? (
          <p className="c360-definition__note">Geen zoektermen in deze versie.</p>
        ) : (
          <>
            <ul className="brief-doc__list">
              {brief.keywords.map((keyword, index) => (
                <li key={index}>
                  {keyword.phrase}{' '}
                  <em className="c360-definition__note">
                    ({keyword.kind === 'radar' ? 'uit onderzoek' : 'afgeleid uit de opleidingskaart'}: {keyword.sourceRef})
                  </em>
                </li>
              ))}
            </ul>
            <p className="c360-definition__note">Geen zoekvolume, geen positie: er is niets gemeten.</p>
          </>
        )}
      </Section>
        </div>
      </div>
    </article>
  );
}
