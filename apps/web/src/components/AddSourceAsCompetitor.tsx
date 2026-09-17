import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TrackedCompetitor } from '@c360/contracts';
import { Button, Field, Notice } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { Modal } from './Modal.js';

/**
 * Adds a source an AI assistant cited to the competitor registry.
 *
 * The sources under an engine answer are the pages an assistant leaned on when
 * it answered a question about this course. Several of them are providers of
 * the same course, which is the most direct competitor evidence the product
 * has — and until now it was a list of links with no way to act on it
 * (2026-09-15).
 *
 * The name is proposed, never assumed: a page title is not an organisation
 * name, so it is a prefilled field a person corrects. The website is the
 * source's own origin, which is a fact rather than a guess.
 */
export function AddSourceAsCompetitor(props: {
  labelId: string;
  /** The cited page. Its origin becomes the competitor's website. */
  sourceUrl: string;
  /** The page title, as the collector reported it. A starting point for the name. */
  sourceTitle: string;
  /** Names already in the registry, so an obvious duplicate is caught before the request. */
  known: readonly TrackedCompetitor[];
  /**
   * Hosts that are ours.
   *
   * An assistant answering about our own course cites our own pages, and
   * offering to file those as a competitor is simply wrong (2026-09-15). The
   * researched course page is the reliable signal on this screen; the registry's
   * own-brand entry adds to it where one exists.
   */
  ownHosts: readonly string[];
}): ReactNode {
  const client = useQueryClient();
  const headingId = useId();
  const nameId = useId();
  const socialId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => proposeName(props.sourceTitle, props.sourceUrl));
  const [withSocials, setWithSocials] = useState(true);
  const [doneNl, setDoneNl] = useState('');

  const origin = originOf(props.sourceUrl);
  const host = origin === null ? null : origin.replace(/^https:\/\//u, '');
  // On the host, and on a dot boundary. A plain `endsWith` would call
  // `notcs-opleidingen.nl` a match for `cs-opleidingen.nl` and hide the button
  // for an organisation that is not in the list at all.
  const matches = (candidate: string): boolean =>
    host !== null && (host === candidate || host.endsWith(`.${candidate}`));
  const isOwn =
    props.ownHosts.some(matches) ||
    props.known.some((entity) => entity.kind === 'own' && entity.domains.some(matches));
  const already = props.known.find(
    (entity) => entity.kind !== 'own' && entity.domains.some(matches),
  );

  const add = useMutation<TrackedCompetitor, ApiClientError, void>({
    mutationFn: async () => {
      const created = await api.post<TrackedCompetitor>(`/labels/${props.labelId}/competitors`, {
        name: name.trim(),
        kind: 'competitor',
        aliases: [],
        domains: [],
        websiteUrl: origin,
        courseUrls: [props.sourceUrl],
      });
      if (!withSocials) return created;
      // Best effort: the competitor is saved either way, and a website that
      // cannot be read is a reported outcome rather than a failed save.
      const result = await api
        .post<{ competitor: TrackedCompetitor; filledNl: string[] }>(
          `/labels/${props.labelId}/competitors/${created.id}/socials`,
          {},
        )
        .catch(() => null);
      if (result !== null) {
        setDoneNl(
          result.filledNl.length > 0
            ? `Sociale kanalen gevonden: ${result.filledNl.join(' ')}`
            : 'Geen sociale kanalen gevonden op hun website.',
        );
        return result.competitor;
      }
      setDoneNl('De website kon niet worden gelezen; de concurrent is wel toegevoegd.');
      return created;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['competitors', props.labelId] }),
        client.invalidateQueries({ queryKey: ['visibility', props.labelId] }),
      ]);
    },
  });

  if (origin === null) {
    return null;
  }

  if (isOwn) {
    return <span className="c360-stat__caption">Jullie eigen website</span>;
  }

  if (already !== undefined) {
    return <span className="c360-stat__caption">{`Al in de concurrentenlijst als ${already.name}`}</span>;
  }

  if (add.isSuccess) {
    return (
      <span className="c360-stat__caption">
        {`Toegevoegd als concurrent. ${doneNl}`}
      </span>
    );
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        Toevoegen als concurrent
      </Button>

      {open && (
        <Modal
          labelledBy={headingId}
          busy={add.isPending}
          onClose={() => {
            setOpen(false);
          }}
        >
          <h2 className="c360-section-title" id={headingId} style={{ margin: 0 }}>
            Toevoegen als concurrent
          </h2>
          <p className="c360-card__hint">
            {`Deze bron werd aangehaald toen een AI-assistent een vraag over deze opleiding beantwoordde: ${props.sourceUrl}`}
          </p>

          <Field
            label="Naam van de organisatie"
            id={nameId}
            hint="Voorgesteld uit de paginatitel en het domein. Een titel is geen organisatienaam, dus controleer hem."
          >
            {(fieldProps) => (
              <input
                {...fieldProps}
                className="c360-input"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </Field>

          <p className="c360-card__hint">{`Website: ${origin}`}</p>

          <label htmlFor={socialId} className="c360-row" style={{ marginTop: 'var(--c360-space-3)' }}>
            <input
              id={socialId}
              type="checkbox"
              checked={withSocials}
              onChange={(event) => {
                setWithSocials(event.target.checked);
              }}
            />
            <span>
              Ook hun sociale kanalen opzoeken. Wij lezen hun eigen website en nemen de
              LinkedIn-, Facebook- en Instagrampagina over die zij daar publiceren. Er wordt niets
              geraden.
            </span>
          </label>

          {add.isError && <Notice tone="warning">{add.error.userMessage}</Notice>}

          <div className="c360-row" style={{ marginTop: 'var(--c360-space-4)' }}>
            <Button
              variant="primary"
              disabled={add.isPending || name.trim().length < 3}
              busy={add.isPending}
              onClick={() => {
                add.mutate();
              }}
            >
              Toevoegen
            </Button>
            <Button
              variant="ghost"
              disabled={add.isPending}
              onClick={() => {
                setOpen(false);
              }}
            >
              Annuleren
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** The https origin of a source, which is the organisation's website. */
function originOf(url: string): string | null {
  const match = /^https:\/\/([^/?#]+)/iu.exec(url.trim());
  const host = match?.[1]?.toLowerCase().replace(/\.$/u, '');
  return host === undefined || host.includes('@') || host.includes(':') ? null : `https://${host}`;
}

/**
 * A first guess at the organisation's name.
 *
 * Page titles are written for readers, not for registries: "Opleiding X |
 * Hogeschool Y" names the organisation after the separator. When there is no
 * separator the host is a duller but safer start than the whole title.
 */
function proposeName(title: string, url: string): string {
  const parts = title.split(/\s[|·—–-]\s/u).map((part) => part.trim()).filter((part) => part.length >= 3);
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  if (last !== undefined && last.length <= 120) return last;
  const host = originOf(url)?.replace(/^https:\/\/(?:www\.)?/iu, '') ?? '';
  return host.split('.')[0] ?? title.slice(0, 120);
}
