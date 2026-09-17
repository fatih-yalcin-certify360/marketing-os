import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  competitorHttpsUrl,
  trackedCompetitorInput,
  trackedCompetitorProfile,
  trackedCompetitorProvenance,
  visibilityEntityInput,
  type CurrentUser,
  type TrackedCompetitor,
  type TrackedCompetitorProvenance,
  type VisibilityEntity,
} from '@c360/contracts';
import type { DbOrTx } from '../../core/db/types.js';
import { discoverSocialLinks, type SocialFinding } from './social-discovery.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import { AppError } from '../../core/errors/app-error.js';

type Row = Record<string, unknown>;
const identity = (value: string): string => value.normalize('NFKC').toLocaleLowerCase('nl-NL').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const domain = (value: string): string => value.toLowerCase().replace(/\.$/u, '').replace(/^www\./u, '');

function fromRow(row: Row): TrackedCompetitor {
  const base = visibilityEntityInput.parse(row);
  const raw = row.profile && typeof row.profile === 'object' && !Array.isArray(row.profile) ? row.profile as Record<string, unknown> : {};
  const profile = trackedCompetitorProfile.parse(raw);
  if (!Object.hasOwn(raw, 'websiteUrl')) {
    // Old records are available immediately, but never turn an unsafe old domain into a URL.
    profile.websiteUrl = base.domains.map(host => competitorHttpsUrl.safeParse(`https://${host}`)).find(result => result.success)?.data ?? null;
  }
  return { id: String(row.id), ...base, ...profile };
}

/** Caller enforces research:read; internal research jobs can reuse the same label-scoped data. */
export async function listCompetitors(db: DbOrTx, labelId: string): Promise<TrackedCompetitor[]> {
  z.uuid().parse(labelId);
  const result = await db.execute(sql`SELECT * FROM visibility_entities WHERE label_id=${labelId} ORDER BY kind DESC,name,id`);
  return result.rows.map(fromRow);
}

type EntityIdentity = Pick<VisibilityEntity, 'name' | 'kind' | 'aliases' | 'domains'> & { websiteUrl?: string | null };

function terms(entity: EntityIdentity): string[] {
  const domains = [...entity.domains];
  if (entity.websiteUrl) domains.push(new URL(entity.websiteUrl).hostname);
  return [...entity.aliases, entity.name].map(identity).concat([...new Set(domains.map(domain))].map(identity));
}

/** Both editors use this while holding the label row lock, so concurrent saves cannot duplicate identities. */
export function assertCompetitorIdentityAvailable(existing: readonly TrackedCompetitor[], input: EntityIdentity, id?: string): void {
  const requested = terms(input);
  if (new Set(requested).size !== requested.length || existing.some(entity => entity.id !== id && (
    (entity.kind === 'own' && input.kind === 'own') || terms(entity).some(term => requested.includes(term))
  ))) {
    throw new AppError('conflict', { publicMessage: 'Deze naam, alias of dit domein bestaat al, of er is al een eigen merk. Gebruik ondubbelzinnige namen.' });
  }
}

/**
 * The optional provenance is a trusted argument, never taken from request bodies.
 * The radar acceptance route must first verify its source and excerpt against the saved run.
 */
export async function saveCompetitor(
  db: DbOrTx,
  user: CurrentUser,
  labelId: string,
  body: unknown,
  id?: string,
  provenance?: TrackedCompetitorProvenance,
): Promise<TrackedCompetitor> {
  requireLabelPermission(user, labelId, 'research:read');
  requireLabelPermission(user, labelId, 'campaign:write');
  z.uuid().parse(labelId);
  if (id !== undefined) z.uuid().parse(id);
  const input = trackedCompetitorInput.parse(body);
  input.domains = [...new Set([...input.domains, ...(input.websiteUrl ? [domain(new URL(input.websiteUrl).hostname)] : [])])];
  if (input.domains.length > 10) throw new AppError('validation_failed', { publicMessage: 'Gebruik maximaal tien domeinen, inclusief het websitedomein.' });
  input.courseKeys = [...new Set(input.courseKeys)];
  input.courseUrls = [...new Set(input.courseUrls)];
  const trustedProvenance = provenance === undefined ? undefined : trackedCompetitorProvenance.parse(provenance);

  return db.transaction(async tx => {
    const label = await tx.execute(sql`SELECT id FROM labels WHERE id=${labelId} FOR UPDATE`);
    if (!label.rows.length) throw AppError.notFoundOrForbidden('label', labelId);
    const existing = await listCompetitors(tx, labelId);
    const previous = id === undefined ? undefined : existing.find(entity => entity.id === id);
    if (id !== undefined && !previous) throw AppError.notFoundOrForbidden('competitor', id);
    assertCompetitorIdentityAvailable(existing, input, id);

    if (input.courseKeys.length) {
      const courses = await tx.execute(sql`SELECT DISTINCT course_key FROM course_versions WHERE label_id=${labelId} AND course_key IN (${sql.join(input.courseKeys.map(key => sql`${key}`), sql`,`)})`);
      if (courses.rows.length !== input.courseKeys.length) {
        throw new AppError('validation_failed', { publicMessage: 'Een van de gekoppelde opleidingen bestaat niet in dit label.' });
      }
    }
    if (trustedProvenance) {
      const run = await tx.execute(sql`SELECT id FROM radar_runs WHERE label_id=${labelId} AND id=${trustedProvenance.runId}`);
      if (!run.rows.length) throw AppError.notFoundOrForbidden('radar_run', trustedProvenance.runId);
    }
    const profile = trackedCompetitorProfile.parse({ ...input, provenance: trustedProvenance ?? previous?.provenance ?? null });
    const saved = await tx.execute(sql`
      INSERT INTO visibility_entities(id,label_id,name,kind,aliases,domains,profile)
      VALUES(${id ?? randomUUID()},${labelId},${input.name},${input.kind},
        ARRAY[${sql.join(input.aliases.map(alias => sql`${alias}`), sql`, `)}]::text[],
        ARRAY[${sql.join(input.domains.map(host => sql`${host}`), sql`, `)}]::text[],${JSON.stringify(profile)}::jsonb)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,kind=EXCLUDED.kind,aliases=EXCLUDED.aliases,domains=EXCLUDED.domains,
        profile=visibility_entities.profile || EXCLUDED.profile
      RETURNING *`);
    return fromRow(saved.rows[0]!);
  });
}

/**
 * Fills a competitor's social pages from what its own website publishes.
 *
 * **Never overwrites what a person typed.** Only fields that are still empty
 * are filled; a link someone entered by hand stays, and the finding that was
 * skipped is reported so the difference is visible rather than silent.
 *
 * The evidence is the page the link was published on, which is returned with
 * every finding. Asking a model for "the LinkedIn page of X" would be quicker
 * and would produce a confident URL belonging to someone else.
 */
export async function fillSocialsFromWebsite(
  db: DbOrTx,
  user: CurrentUser,
  labelId: string,
  id: string,
  env: Parameters<typeof discoverSocialLinks>[1],
): Promise<{
  competitor: TrackedCompetitor;
  findings: SocialFinding[];
  filledNl: string[];
  skippedNl: string[];
  checkedUrls: string[];
  failuresNl: string[];
}> {
  requireLabelPermission(user, labelId, 'research:read');
  requireLabelPermission(user, labelId, 'campaign:write');
  z.uuid().parse(labelId);
  z.uuid().parse(id);

  const existing = (await listCompetitors(db, labelId)).find(entity => entity.id === id);
  if (!existing) throw AppError.notFoundOrForbidden('competitor', id);
  if (!existing.websiteUrl) {
    throw new AppError('validation_failed', {
      publicMessage: 'Deze concurrent heeft nog geen website. Zonder website is er geen pagina om de sociale kanalen op te lezen.',
    });
  }

  const discovery = await discoverSocialLinks(existing.websiteUrl, env);
  const fields = { linkedin: 'linkedinUrl', facebook: 'facebookUrl', instagram: 'instagramUrl' } as const;
  const labels = { linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram' } as const;

  const patch: Record<string, string> = {};
  const filledNl: string[] = [];
  const skippedNl: string[] = [];
  for (const platform of ['linkedin', 'facebook', 'instagram'] as const) {
    const finding = discovery.findings.find(item => item.platform === platform);
    if (finding === undefined) continue;
    const current = existing[fields[platform]];
    if (current !== null && current.length > 0) {
      if (current !== finding.url) {
        skippedNl.push(`${labels[platform]}: ${finding.url} gevonden op ${finding.foundOnUrl}, maar er staat al ${current}. Niet overschreven.`);
      }
      continue;
    }
    patch[fields[platform]] = finding.url;
    filledNl.push(`${labels[platform]}: ${finding.url}, gevonden op ${finding.foundOnUrl}.`);
  }

  const competitor = Object.keys(patch).length === 0
    ? existing
    : await saveCompetitor(db, user, labelId, {
        name: existing.name,
        kind: existing.kind,
        aliases: existing.aliases,
        domains: existing.domains,
        websiteUrl: existing.websiteUrl,
        linkedinUrl: existing.linkedinUrl,
        facebookUrl: existing.facebookUrl,
        instagramUrl: existing.instagramUrl,
        courseUrls: existing.courseUrls,
        courseKeys: existing.courseKeys,
        active: existing.active,
        notes: existing.notes,
        ...patch,
      }, id);

  return {
    competitor,
    findings: discovery.findings,
    filledNl,
    skippedNl,
    checkedUrls: discovery.checkedUrls,
    failuresNl: discovery.failuresNl,
  };
}
