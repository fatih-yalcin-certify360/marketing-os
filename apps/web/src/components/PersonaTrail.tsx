import type { ReactNode } from 'react';
import type { ActorRef } from '@c360/contracts';
import { Badge, Disclosure, Notice, Skeleton } from '@c360/ui';
import { usePersonaHistory } from '../api/campaign-queries.js';

/**
 * Where a persona came from, and everybody who touched it.
 *
 * ## Why it is here
 *
 * A persona decides what every campaign, every piece of content and every
 * channel choice is aimed at. When one says something surprising, the question
 * is always the same — who wrote this, and on what? Until now the screen
 * answered neither: it showed the newest version and nothing behind it, even
 * though every edit, every AI fill and every approval had been written down
 * with an author and a date since the first version of the product.
 *
 * ## What it shows first
 *
 * The three answers people actually come for — made by, last changed by,
 * approved by — and only then the full list. A trail that opens as twelve rows
 * makes the reader do the summarising.
 */
export function PersonaTrail(props: { labelId: string; personaVersionId: string }): ReactNode {
  const history = usePersonaHistory(props.labelId, props.personaVersionId);

  if (history.isLoading) {
    return (
      <section className="os-panel os-panel--pad">
        <Skeleton lines={3} />
      </section>
    );
  }
  if (history.error !== null) {
    return (
      <Notice tone="warning">
        {`De herkomst van deze doelgroep kon niet worden geladen: ${history.error.userMessage}`}
      </Notice>
    );
  }

  const items = history.data?.items ?? [];
  // Newest first from the server, so the first entry is the current version and
  // the last is how this persona started.
  const newest = items[0];
  const oldest = items[items.length - 1];
  if (newest === undefined || oldest === undefined) return null;
  const approved = items.find((entry) => entry.approvedAt !== null);

  return (
    <section className="os-panel">
      <div className="os-panel__head">
        <div>
          <h2 className="os-panel__title">Herkomst</h2>
          <p className="os-panel__sub">Wie deze doelgroep heeft gemaakt, gewijzigd en goedgekeurd</p>
        </div>
      </div>
      <div className="os-panel__body">
        <div className="os-metagrid">
          <Meta
            term="Aangemaakt"
            value={nameOf(oldest.by)}
            note={`${dateTimeNl(oldest.createdAt)} · ${oldest.actionNl}`}
          />
          <Meta
            term="Laatst gewijzigd"
            /*
             * A persona that has never been changed says that, rather than
             * "Niet vastgelegd" — which would read as a missing record instead
             * of as nothing having happened yet.
             */
            value={items.length === 1 ? 'Nog niet gewijzigd' : nameOf(newest.by)}
            note={
              items.length === 1
                ? 'Dit is nog de eerste versie'
                : `${dateTimeNl(newest.createdAt)} · ${newest.actionNl} · v${String(newest.version)}`
            }
          />
          <Meta
            term="Goedgekeurd"
            value={approved === undefined ? 'Nog niet goedgekeurd' : nameOf(approved.approvedBy)}
            note={
              approved?.approvedAt == null
                ? 'Een niet-goedgekeurde doelgroep blijft een concept'
                : `${dateTimeNl(approved.approvedAt)} · bij versie v${String(approved.version)}`
            }
          />
        </div>

        <Disclosure summary={`Alle versies (${String(items.length)})`} tone="plain">
          <ol className="persona-trail">
            {items.map((entry) => (
              <li key={entry.versionId} className="persona-trail__item">
                <div className="persona-trail__head">
                  <span className="persona-trail__version">{`v${String(entry.version)}`}</span>
                  <span className="persona-trail__action">{entry.actionNl}</span>
                  {entry.approvedAt !== null && <Badge tone="green">Goedgekeurd</Badge>}
                  {entry.origin === 'ai_generated' && <Badge tone="neutral">AI</Badge>}
                </div>
                <p className="persona-trail__by">
                  {`${dateTimeNl(entry.createdAt)} · ${nameOf(entry.by)}`}
                </p>
                {entry.changedFieldsNl.length > 0 && (
                  <p className="persona-trail__changed">
                    {`Gewijzigd: ${entry.changedFieldsNl.join(', ')}`}
                  </p>
                )}
                {entry.promptVersion !== null && (
                  <p className="persona-trail__prompt">{`Prompt: ${entry.promptVersion}`}</p>
                )}
                {entry.approvedAt !== null && (
                  <p className="persona-trail__by">
                    {`Goedgekeurd op ${dateTimeNl(entry.approvedAt)} door ${nameOf(entry.approvedBy)}`}
                    {entry.approvalNoteNl === null ? '' : ` — "${entry.approvalNoteNl}"`}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <p className="c360-text-muted">
            Elke wijziging is een nieuwe versie; eerdere versies blijven staan, ook wanneer een
            campagne eraan vastzit. &quot;Gewijzigd&quot; noemt de velden die verschillen van de
            versie ervoor — niet of de wijziging een verbetering was.
          </p>
        </Disclosure>
      </div>
    </section>
  );
}

function Meta(props: { term: string; value: string; note: string }): ReactNode {
  return (
    <div className="os-metatile">
      <p className="os-metatile__term">{props.term}</p>
      <p className="os-metatile__value">{props.value}</p>
      <p className="os-metatile__note">{props.note}</p>
    </div>
  );
}

/**
 * The name, or the plain truth that there is none.
 *
 * A version written before authors were recorded, or by a colleague whose
 * account has since been removed, is not hidden: that a change was made by
 * somebody we can no longer name is part of what a trail has to say.
 */
function nameOf(actor: ActorRef | null): string {
  if (actor === null) return 'Niet vastgelegd';
  return actor.email === null ? actor.displayName : `${actor.displayName} (${actor.email})`;
}

function dateTimeNl(iso: string): string {
  const stamp = new Date(iso);
  if (Number.isNaN(stamp.getTime())) return iso;
  return new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(stamp);
}
