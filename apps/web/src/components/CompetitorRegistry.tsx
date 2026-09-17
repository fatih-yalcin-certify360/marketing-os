import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { RadarRun, TrackedCompetitor } from '@c360/contracts';
import { Badge, Button, Card, Notice } from '@c360/ui';
import { api, type ApiClientError } from '../api/client.js';
import { useCourses } from '../api/campaign-queries.js';
import './competitor-registry.css';

type ProfileInput = Omit<TrackedCompetitor, 'id' | 'provenance'>;
interface RegistryResult { items: TrackedCompetitor[]; courseKey: string | null }
const lines = (value: string): string[] => [...new Set(value.split(/[,\n]/u).map(item => item.trim()).filter(Boolean))];
const host = (value: string): string | null => {
  try { return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./u, ''); }
  catch { return null; }
};
const publicLink = (value: string | null): string | undefined => {
  if (!value) return undefined;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
};
/** What the socials route answers with; see `fillSocialsFromWebsite`. */
interface SocialResult {
  competitor: TrackedCompetitor;
  filledNl: string[];
  skippedNl: string[];
  checkedUrls: string[];
  failuresNl: string[];
}

function coversSource(profile: TrackedCompetitor, sourceUrl: string): boolean {
  const sourceHost = host(sourceUrl);
  if (!sourceHost) return false;
  const urls = [profile.websiteUrl, ...profile.courseUrls, profile.linkedinUrl, profile.facebookUrl, profile.instagramUrl].filter((value): value is string => value !== null);
  if (/(?:^|\.)(?:linkedin\.com|facebook\.com|instagram\.com)$/u.test(sourceHost)) {
    return urls.some(value => {
      try { return host(value) === sourceHost && new URL(value).pathname.replace(/\/$/u, '') === new URL(sourceUrl).pathname.replace(/\/$/u, ''); }
      catch { return false; }
    });
  }
  return [...profile.domains, ...urls].some(value => {
    const domain = host(value);
    return domain !== null && (sourceHost === domain || sourceHost.endsWith(`.${domain}`));
  });
}

function useCompetitors(labelId: string, courseVersionId: string | undefined): UseQueryResult<RegistryResult, ApiClientError> {
  return useQuery<RegistryResult, ApiClientError>({
    queryKey: ['competitors', labelId, courseVersionId ?? 'all'],
    queryFn: ({ signal }) => api.get(`/labels/${labelId}/competitors${courseVersionId ? `?courseVersionId=${encodeURIComponent(courseVersionId)}` : ''}`, signal),
  });
}

/** Shared with the manual AI Visibility benchmark: one label registry, no extra AI call. */
export function CompetitorRegistry(props: {
  labelId: string;
  courseVersionId: string | undefined;
  courseName: string | undefined;
  canEdit: boolean;
}): ReactNode {
  const { labelId, courseVersionId, courseName, canEdit } = props;
  const client = useQueryClient();
  const base = `/labels/${labelId}/competitors`;
  const [editing, setEditing] = useState<TrackedCompetitor | 'new' | null>(null);
  const [message, setMessage] = useState('');
  const registry = useCompetitors(labelId, courseVersionId);
  const courses = useCourses(labelId);
  const refresh = async (): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['competitors', labelId] }),
      client.invalidateQueries({ queryKey: ['visibility', labelId] }),
    ]);
  };
  const save = useMutation<TrackedCompetitor, ApiClientError, { id: string | null; input: ProfileInput }>({
    mutationFn: ({ id, input }) => api.post(id ? `${base}/${id}` : base, input),
    onSuccess: async (profile) => { await refresh(); setEditing(null); setMessage(`${profile.name} is opgeslagen.`); },
  });
  const toggle = useMutation<TrackedCompetitor, ApiClientError, TrackedCompetitor>({
    mutationFn: (profile) => {
      const { id, provenance: _provenance, ...input } = profile;
      return api.post(`${base}/${id}`, { ...input, active: !profile.active });
    },
    onSuccess: async (profile) => { await refresh(); setMessage(`${profile.name} is ${profile.active ? 'geactiveerd' : 'uitgeschakeld'}.`); },
  });
  /*
   * Reads the competitor's own website and fills the social pages it publishes.
   *
   * A fetch, not a question to a model: asked for "the LinkedIn page of X" a
   * model returns a confident URL that may belong to someone else. What comes
   * back names the page every link was found on, and a field somebody typed by
   * hand is never overwritten (2026-09-15).
   */
  const socials = useMutation<SocialResult, ApiClientError, TrackedCompetitor>({
    mutationFn: (profile) => api.post(`${base}/${profile.id}/socials`, {}),
    onSuccess: async (result) => {
      await refresh();
      const parts = [
        result.filledNl.length > 0 ? `Toegevoegd bij ${result.competitor.name} — ${result.filledNl.join(' ')}` : '',
        result.skippedNl.length > 0 ? `Niet overschreven: ${result.skippedNl.join(' ')}` : '',
        result.filledNl.length === 0 && result.skippedNl.length === 0
          ? `Geen sociale kanalen gevonden op ${result.checkedUrls.join(' en ') || 'de website'}.`
          : '',
        result.failuresNl.length > 0 ? `Niet gelezen: ${result.failuresNl.join(' ')}` : '',
      ].filter((part) => part.length > 0);
      setMessage(parts.join(' '));
    },
  });

  const items = registry.data?.items ?? [];
  const pending = save.isPending || toggle.isPending || socials.isPending;
  /* Every course of the label, so a provider's scope can be set from one place
     instead of depending on which course happens to be selected. */
  const labelCourses = (courses.data?.items ?? []).map((entry) => ({
    key: entry.course.courseKey,
    name: entry.course.name,
  }));
  const beginEdit = (profile: TrackedCompetitor | 'new'): void => { save.reset(); setMessage(''); setEditing(profile); };

  return <div className="competitor-registry c360-stack">
    <Card title="Concurrenten beheren" ariaLabel="Concurrenten beheren">
      <p>Bewaar de aanbieders die je wilt volgen. De actieve selectie wordt gebruikt bij volgende scans voor de gekoppelde opleidingen.</p>
      <p className="c360-card__hint">Eén gedeelde lijst met de merken uit de handmatige AI Visibility-metingen. Bestaande scans bewaren hun eigen resultaten; een wijziging herschrijft die niet.</p>
      <p className="c360-card__hint">Links opgeslagen; openbare pagina’s worden onderzocht voor zover toegankelijk. Geen automatische toegang tot afgeschermde profielen.</p>
      <details><summary>Hoe worden de links gebruikt?</summary><p>Per actieve concurrent wordt de eerste opleidingslink gelezen. Zonder opleidingslink gebruiken we de website, een domein of een beschikbare sociallink. Andere links helpen het aanvullende zoeken; niet alle pagina’s of sociale berichten worden gelezen.</p></details>
      {registry.isPending && <p role="status">Concurrenten laden…</p>}
      {registry.error && <Notice tone="warning">{registry.error.userMessage}</Notice>}
      {message && <p role="status" className="competitor-registry__message">{message}</p>}
      {toggle.error && <Notice tone="warning">{toggle.error.userMessage}</Notice>}
      {socials.error && <Notice tone="warning">{socials.error.userMessage}</Notice>}
      {canEdit && editing === null && <Button disabled={pending || !registry.data} onClick={() => beginEdit('new')}>Concurrent toevoegen</Button>}
      {canEdit && editing !== null && registry.data && <ProfileEditor
        key={editing === 'new' ? 'new' : editing.id}
        profile={editing === 'new' ? null : editing}
        courseKey={registry.data.courseKey}
        courses={labelCourses}
        courseName={courseName}
        hasOwn={items.some(profile => profile.kind === 'own')}
        pending={save.isPending}
        error={save.error?.userMessage}
        onCancel={() => { setEditing(null); save.reset(); }}
        onSave={(input) => save.mutate({ id: editing === 'new' ? null : editing.id, input })}
      />}
      {registry.data && items.length === 0 && <p className="c360-card__hint">Nog geen aanbieders bewaard. Voeg een concurrent toe of bewaar een gevonden aanbieder uit een scan.</p>}
      <div className="competitor-registry__list">
        {items.map(profile => {
          const relevant = profile.courseKeys.length === 0 || (registry.data?.courseKey !== null && profile.courseKeys.includes(registry.data?.courseKey ?? ''));
          const links = [
            ['Website', profile.websiteUrl], ['LinkedIn', profile.linkedinUrl],
            ['Facebook', profile.facebookUrl], ['Instagram', profile.instagramUrl],
          ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && publicLink(entry[1]) !== undefined);
          return <article key={profile.id} className="competitor-registry__item" aria-label={profile.name}>
            <div className="competitor-registry__heading">
              <h3>{profile.name}</h3>
              <Badge tone={profile.kind === 'own' ? 'purple' : 'neutral'}>{profile.kind === 'own' ? 'Eigen merk' : 'Concurrent'}</Badge>
              <Badge tone={profile.active ? 'green' : 'neutral'}>{profile.active ? 'Actief' : 'Uitgeschakeld'}</Badge>
            </div>
            <p className="c360-card__hint">{profile.courseKeys.length === 0 ? 'Alle opleidingen in dit label' : courseName && relevant ? `Gekoppeld aan ${courseName}${profile.courseKeys.length > 1 ? ' en andere opleidingen' : ''}` : courseName ? 'Gekoppeld aan andere opleidingen' : `Gekoppeld aan ${String(profile.courseKeys.length)} opleiding(en)`}{profile.kind === 'own' ? ' · wordt niet als concurrent behandeld' : ''}</p>
            {links.length > 0 && <div className="competitor-registry__links">{links.map(([title, url]) => <a key={title} href={publicLink(url)} target="_blank" rel="noreferrer">{title} ↗</a>)}</div>}
            <details>
              <summary>Profiel en bron bekijken</summary>
              {profile.domains.length > 0 && <p>Domeinen: {profile.domains.join(', ')}</p>}
              {profile.aliases.length > 0 && <p>Andere namen: {profile.aliases.join(', ')}</p>}
              {profile.courseUrls.length > 0 && <ul>{profile.courseUrls.map(url => <li key={url}><a href={publicLink(url)} target="_blank" rel="noreferrer">{url}</a></li>)}</ul>}
              {profile.notes && <p>{profile.notes}</p>}
              {profile.provenance && <><p>Toegevoegd vanuit een radarscan: <a href={publicLink(profile.provenance.sourceUrl)} target="_blank" rel="noreferrer">oorspronkelijke opleidingsbron ↗</a></p><blockquote>{profile.provenance.excerpt}</blockquote></>}
              {!profile.domains.length && !profile.aliases.length && !profile.courseUrls.length && !profile.notes && !profile.provenance && <p>Nog geen aanvullende gegevens.</p>}
            </details>
            {canEdit && <div className="competitor-registry__actions">
              <Button disabled={pending || editing !== null} onClick={() => beginEdit(profile)}>Bewerken</Button>
              <Button disabled={pending || editing !== null} onClick={() => { setMessage(''); toggle.mutate(profile); }}>{profile.active ? 'Uitschakelen' : 'Activeren'}</Button>
              <Button
                disabled={pending || editing !== null || profile.websiteUrl === null}
                busy={socials.isPending && socials.variables?.id === profile.id}
                onClick={() => { setMessage(''); socials.reset(); socials.mutate(profile); }}
              >
                Sociale kanalen opzoeken
              </Button>
            </div>}
          </article>;
        })}
      </div>
    </Card>
  </div>;
}

/** Scan evidence stays in Radar; accepting a new supplier updates the shared registry. */
export function CompetitorSuggestions(props: {
  labelId: string;
  courseVersionId: string;
  canEdit: boolean;
  run: RadarRun;
}): ReactNode {
  const { labelId, courseVersionId, canEdit, run } = props;
  const client = useQueryClient();
  const registry = useCompetitors(labelId, courseVersionId);
  const [message, setMessage] = useState('');
  const accept = useMutation<TrackedCompetitor, ApiClientError, string>({
    mutationFn: (sourceUrl) => api.post(`/labels/${labelId}/radar/${run.id}/competitors`, { sourceUrl }),
    onSuccess: async (profile) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['competitors', labelId] }),
        client.invalidateQueries({ queryKey: ['visibility', labelId] }),
      ]);
      setMessage(`${profile.name} is toegevoegd. Je kunt het profiel aanvullen bij Concurrenten beheren.`);
    },
  });
  const scannedProfiles = run.report.trackedCompetitors ?? [];

  /*
   * Every provider this scan actually read, from both places it can come from.
   *
   * The list used to be `audience.competitors` alone — the providers the
   * *audience* analysis happened to name. A scan that discovered four new
   * providers and read their course pages showed them as opportunity cards and
   * offered no way to save any of them, so "nieuwe aanbieder gevonden" was a
   * statement you could not act on (2026-09-16). The cards are the pages we
   * actually fetched, so they belong here too.
   *
   * Deduplicated on the source URL, audience findings first: those carry the
   * reason the analysis gave, which is the more specific of the two.
   */
  const seen = new Set<string>();
  const candidates = [
    ...(run.report.audience?.competitors ?? []).map((candidate) => ({
      organization: candidate.organization,
      sourceUrl: candidate.sourceUrl,
      reason: candidate.reason,
      excerpt: candidate.excerpt,
      fromNl: 'Uit het doelgroeponderzoek',
    })),
    ...run.report.cards
      .filter((card) => card.relationship === 'competitor')
      .map((card) => ({
        organization: card.organization,
        sourceUrl: card.sourceUrl,
        reason: card.relevance,
        excerpt: card.excerpt,
        fromNl: 'Gelezen pagina in deze scan',
      })),
  ].filter((candidate) => {
    const key = candidate.sourceUrl.trim().toLowerCase().replace(/\/+$/u, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return <div className="competitor-registry">
    <Card title="Opleidingsaanbieders in deze scan" ariaLabel="Concurrenten uit onderzoek">
      <p className="c360-card__hint">Brononderbouwde selectie, ook gebruikt voor het advertentieonderzoek. Controleer of de opleiding vergelijkbaar is en de aanbieder bij een ander bedrijf hoort.</p>
      <Link to={`/radar/concurrenten?course=${encodeURIComponent(courseVersionId)}`}>Concurrenten beheren →</Link>
      <details><summary>Meegenomen in deze scan ({String(scannedProfiles.length)})</summary>
        <p className="c360-card__hint">De bewaarde selectie bij deze scan. Dit staat los van je huidige lijst; eventuele leesfouten staan bij Scan & beperkingen.</p>
        {scannedProfiles.length > 0 ? <ul>{scannedProfiles.map(profile => <li key={profile.id}><a href={publicLink(profile.sourceUrl)} target="_blank" rel="noreferrer">{profile.name} ↗</a></li>)}</ul> : <p>Geen momentopname van bewaarde aanbieders in deze scan.</p>}
      </details>
      <p className="c360-card__hint">Een nieuwe aanbieder toevoegen bewaart de bron voor volgende scans; het start geen AI-aanroep. Eigen merken en uitgeschakelde profielen worden niet opnieuw voorgesteld.</p>
      {run.report.isMock && <Notice tone="warning">Deze scan bevat demodata. Gebruik deze aanbieders niet als bewijs van echt onderzoek.</Notice>}
      {registry.isPending && <p role="status">Bewaarde concurrenten controleren…</p>}
      {registry.error && <Notice tone="warning">{registry.error.userMessage}</Notice>}
      {accept.error && <Notice tone="warning">{accept.error.userMessage}</Notice>}
      {message && <p role="status" className="competitor-registry__message">{message}</p>}
      {candidates.length === 0 && <p>Geen controleerbare opleidingsaanbieders gevonden in deze scan.</p>}
      {candidates.length > 0 && <p className="c360-card__hint">{`${String(candidates.length)} aanbieder(s) gevonden in deze scan. Toevoegen bewaart de bron voor volgende scans.`}</p>}
      {candidates.map(candidate => {
        const known = registry.data?.items.find(profile => coversSource(profile, candidate.sourceUrl));
        return <article key={candidate.sourceUrl} className="competitor-registry__item" aria-label={candidate.organization}>
          <div className="competitor-registry__heading"><h3>{candidate.organization}</h3>{known ? <Badge tone="neutral">{known.kind === 'own' ? 'Eigen merk' : known.active ? 'Al bewaard' : 'Bewaard · uitgeschakeld'}</Badge> : registry.data && <Badge tone="purple">Nieuw gevonden</Badge>}<Badge tone="neutral">{candidate.fromNl}</Badge></div>
          <p>{candidate.reason}</p>
          <details><summary>Bron en passage controleren</summary><blockquote>{candidate.excerpt}</blockquote><a href={publicLink(candidate.sourceUrl)} target="_blank" rel="noreferrer">Opleidingsbron bekijken ↗</a></details>
          {canEdit && !known && <Button disabled={accept.isPending || !registry.data || run.report.isMock} onClick={() => { setMessage(''); accept.mutate(candidate.sourceUrl); }}>Toevoegen aan concurrenten</Button>}
        </article>;
      })}
    </Card>
  </div>;
}

function ProfileEditor(props: {
  profile: TrackedCompetitor | null;
  courseKey: string | null;
  courseName: string | undefined;
  /** Every course of this label, so the scope is a choice and not a location. */
  courses: readonly { key: string; name: string }[];
  hasOwn: boolean;
  pending: boolean;
  error: string | undefined;
  onSave: (input: ProfileInput) => void;
  onCancel: () => void;
}): ReactNode {
  const { profile, courseKey, pending } = props;
  const id = useId();
  const courses = props.courses;
  const form = useRef<HTMLFormElement | null>(null);

  /*
   * Bring the editor to the person who opened it.
   *
   * The form mounts above the list, so pressing Bewerken on the fourth provider
   * opened something several screens up and nothing appeared to happen — the
   * same defect the loose-uiting dialog had (2026-09-16). It is keyed by id, so
   * this runs once per opening, for a new provider as well as an existing one.
   *
   * Focus moves with it, and does the real work: it scrolls for a keyboard user
   * too, and it puts the caret in the first field so typing starts where the
   * person is looking. `preventScroll` keeps the browser from jumping first and
   * then being scrolled again.
   */
  useEffect(() => {
    const node = form.current;
    if (node === null) return;
    const gentle = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'center', behavior: gentle ? 'smooth' : 'auto' });
    node.querySelector<HTMLInputElement>('input[name="name"]')?.focus({ preventScroll: true });
  }, []);

  const [allCourses, setAllCourses] = useState(!profile?.courseKeys.length);
  const [linked, setLinked] = useState(profile?.courseKeys ?? (courseKey ? [courseKey] : []));
  const [scopeError, setScopeError] = useState('');
  // Links to courses this label no longer lists; kept rather than silently dropped.
  const known = new Set(courses.map(option => option.key));
  const unknownLinks = linked.filter(key => !known.has(key));
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!allCourses && linked.length === 0) { setScopeError('Koppel een opleiding of kies alle opleidingen.'); return; }
    const values = new FormData(event.currentTarget);
    const value = (key: string): string => { const entry = values.get(key); return typeof entry === 'string' ? entry.trim() : ''; };
    const url = (key: string): string | null => value(key) || null;
    props.onSave({
      name: value('name'), kind: value('kind') === 'own' ? 'own' : 'competitor',
      websiteUrl: url('websiteUrl'), linkedinUrl: url('linkedinUrl'), facebookUrl: url('facebookUrl'), instagramUrl: url('instagramUrl'),
      courseUrls: lines(value('courseUrls')), aliases: lines(value('aliases')), domains: lines(value('domains')),
      courseKeys: allCourses ? [] : linked, active: profile?.active ?? true, notes: value('notes'),
    });
  };
  return <form ref={form} className="competitor-registry__editor" onSubmit={submit}>
    <h3>{profile ? `${profile.name} bewerken` : 'Aanbieder toevoegen'}</h3>
    {props.error && <Notice tone="warning">{props.error}</Notice>}
    <fieldset disabled={pending}>
      <legend className="c360-visually-hidden">Gegevens van de aanbieder</legend>
      <div className="competitor-registry__fields">
        <label htmlFor={`${id}-name`}>Naam<input id={`${id}-name`} className="c360-input" name="name" required minLength={3} maxLength={120} defaultValue={profile?.name ?? ''}/></label>
        <label htmlFor={`${id}-website`}>Website<input id={`${id}-website`} className="c360-input" name="websiteUrl" type="url" maxLength={2000} placeholder="https://voorbeeld.nl" defaultValue={profile?.websiteUrl ?? ''}/></label>
      </div>
      {/* Changeable while editing too. A provider that turns out to be a sister
          brand — or an acquisition — has to stop being treated as a competitor
          without being deleted and retyped (2026-09-16). */}
      <label htmlFor={`${id}-kind`}>Relatie
        <select id={`${id}-kind`} className="c360-select" name="kind" defaultValue={profile?.kind ?? 'competitor'}>
          <option value="competitor">Concurrent</option>
          {/* Only one own brand per label; the one that already is it keeps the option. */}
          {(!props.hasOwn || profile?.kind === 'own') && <option value="own">Eigen merk</option>}
        </select>
        <small>Een eigen merk telt niet als concurrent: het wordt niet gescand en niet in vergelijkingen gezet.</small>
      </label>
      <fieldset className="competitor-registry__scope"><legend>Gebruiken voor</legend>
        <label><input type="radio" name={`${id}-scope`} checked={allCourses} onChange={() => { setAllCourses(true); setScopeError(''); }}/> Alle opleidingen in dit label</label>
        <label><input type="radio" name={`${id}-scope`} checked={!allCourses} onChange={() => { setAllCourses(false); setScopeError(''); if (linked.length === 0 && courseKey) setLinked([courseKey]); }}/> Alleen de opleidingen die ik kies</label>
        {/* Every course of the label, not just the one on screen. Before this you
            had to navigate to a course to be able to link it, which meant the
            scope of a provider depended on where you happened to be. */}
        {!allCourses && <div className="competitor-registry__courses">
          {courses.length === 0 && <p className="c360-card__hint">Er zijn nog geen opleidingskaarten in dit label.</p>}
          {courses.map(option => <label key={option.key}>
            <input type="checkbox" checked={linked.includes(option.key)} onChange={event => {
              setScopeError('');
              setLinked(previous => event.target.checked
                ? [...new Set([...previous, option.key])]
                : previous.filter(key => key !== option.key));
            }}/> {option.name}{option.key === courseKey ? ' · nu in beeld' : ''}
          </label>)}
          {unknownLinks.length > 0 && <p className="c360-card__hint">{`Nog ${String(unknownLinks.length)} koppeling(en) aan een opleiding die hier niet staat; die blijven behouden.`}</p>}
        </div>}
        {scopeError && <p className="c360-field__error" role="alert">{scopeError}</p>}
      </fieldset>
      <label htmlFor={`${id}-courses`}>Relevante opleidingspagina’s <span className="c360-card__hint">— één URL per regel</span><textarea id={`${id}-courses`} className="c360-textarea" name="courseUrls" rows={3} defaultValue={profile?.courseUrls.join('\n') ?? ''} placeholder="https://voorbeeld.nl/opleidingen/…"/></label>
      <details><summary>Sociale bedrijfspagina’s toevoegen</summary><p className="c360-card__hint">Gebruik openbare bedrijfspagina’s, geen persoonlijke profielen.</p><div className="competitor-registry__fields">
        {(['linkedinUrl', 'facebookUrl', 'instagramUrl'] as const).map((key, index) => <label key={key} htmlFor={`${id}-${key}`}>{['LinkedIn', 'Facebook', 'Instagram'][index]}<input id={`${id}-${key}`} className="c360-input" name={key} type="url" maxLength={2000} defaultValue={profile?.[key] ?? ''} placeholder="https://…"/></label>)}
      </div></details>
      <details><summary>Andere namen, domeinen en notities</summary>
        <label htmlFor={`${id}-aliases`}>Andere namen — komma of nieuwe regel<input id={`${id}-aliases`} className="c360-input" name="aliases" defaultValue={profile?.aliases.join(', ') ?? ''}/></label>
        <label htmlFor={`${id}-domains`}>Domeinen — zonder https://, één per regel<textarea id={`${id}-domains`} className="c360-textarea" name="domains" rows={2} defaultValue={profile?.domains.join('\n') ?? ''}/></label>
        <label htmlFor={`${id}-notes`}>Notities<textarea id={`${id}-notes`} className="c360-textarea" name="notes" rows={3} maxLength={2000} defaultValue={profile?.notes ?? ''}/></label>
      </details>
    </fieldset>
    <div className="competitor-registry__actions"><Button type="submit" variant="primary" disabled={pending} busy={pending}>Profiel opslaan</Button><Button disabled={pending} onClick={props.onCancel}>Annuleren</Button></div>
  </form>;
}
