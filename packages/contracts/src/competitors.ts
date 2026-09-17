import { z } from 'zod';
import { visibilityEntityInput, type VisibilityEntity } from './ai-visibility.js';

const publicHostname = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}\.?$/iu;
const reservedSuffixes = ['localhost', 'local', 'localdomain', 'internal', 'intranet', 'corp', 'home', 'lan', 'private', 'test', 'example', 'invalid', 'onion', 'alt'];

/** Organization sources use public DNS names; IP literals are not organization URLs. */
function publicHost(host: string): boolean {
  const canonical = host.toLowerCase().replace(/\.$/u, '');
  return publicHostname.test(canonical) && !reservedSuffixes.some(suffix => canonical === suffix || canonical.endsWith(`.${suffix}`));
}

function urlHost(value: string): string {
  return value.replace(/^https:\/\//u, '').split(/[/?#]/u)[0]!.replace(/:443$/u, '').replace(/\.$/u, '');
}

/** This is input validation. Fetching still requires safeFetch's DNS/redirect checks. */
export const competitorHttpsUrl = z.string().trim().max(2048)
  .refine(value => /^https:\/\//iu.test(value) && !/[\s\\]/u.test(value), 'Gebruik een geldige openbare HTTPS-link.')
  .pipe(z.url({ protocol: /^https$/u, hostname: publicHostname, normalize: true }))
  .refine(value => {
    const authority = value.replace(/^https:\/\//u, '').split(/[/?#]/u)[0]!;
    return !authority.includes('@') && !authority.includes(':') && publicHost(authority);
  }, 'Gebruik een openbare HTTPS-link zonder inloggegevens of afwijkende poort.')
  .transform(value => value.replace(/^(https:\/\/[^/?#]+?)\.(?=[/?#]|$)/u, '$1'));

const platformUrl = (platform: string) => competitorHttpsUrl.refine(value => {
  const host = urlHost(value);
  return host === platform || host.endsWith(`.${platform}`);
}, `Gebruik een link op ${platform}.`);

const linkedinUrl = platformUrl('linkedin.com').refine(
  value => /^https:\/\/[^/]+\/(?:company|school)\/[^/?#]+(?:[/?#]|$)/u.test(value),
  'Gebruik een LinkedIn-organisatiepagina (/company/ of /school/).',
);

const profileFields = {
  websiteUrl: competitorHttpsUrl.nullable().default(null),
  linkedinUrl: linkedinUrl.nullable().default(null),
  facebookUrl: platformUrl('facebook.com').nullable().default(null),
  instagramUrl: platformUrl('instagram.com').nullable().default(null),
  courseUrls: z.array(competitorHttpsUrl).max(30).default([]),
  /** Empty means all courses under the current label. These are stable course keys. */
  courseKeys: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  active: z.boolean().default(true),
  notes: z.string().trim().max(4000).default(''),
};

export const trackedCompetitorProvenance = z.object({
  runId: z.uuid(),
  sourceUrl: competitorHttpsUrl,
  excerpt: z.string().trim().min(1).max(4000),
});
export type TrackedCompetitorProvenance = z.infer<typeof trackedCompetitorProvenance>;

/** Provenance is deliberately excluded: only verified server-side acceptance supplies it. */
export const trackedCompetitorInput = visibilityEntityInput.extend({
  kind: visibilityEntityInput.shape.kind.default('competitor'),
  aliases: visibilityEntityInput.shape.aliases.default([]),
  domains: visibilityEntityInput.shape.domains.element.refine(publicHost, 'Gebruik een openbaar domein.').array().max(10).default([]),
  ...profileFields,
});
export type TrackedCompetitorInput = z.infer<typeof trackedCompetitorInput>;

export const trackedCompetitorProfile = z.object({
  ...profileFields,
  provenance: trackedCompetitorProvenance.nullable().default(null),
});

export interface TrackedCompetitor extends VisibilityEntity, z.infer<typeof trackedCompetitorProfile> {}
