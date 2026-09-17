import type { TrackedCompetitor } from '@c360/contracts';

/** A saved course page takes priority over the company home page. */
export function competitorSource(profile: TrackedCompetitor): string | null {
  return profile.courseUrls[0] ?? profile.websiteUrl ??
    (profile.domains[0] ? `https://${profile.domains[0]}/` : null) ??
    profile.linkedinUrl ?? profile.facebookUrl ?? profile.instagramUrl;
}

export function competitorsForCourse(profiles: readonly TrackedCompetitor[], courseKey: string): TrackedCompetitor[] {
  return profiles.filter(profile => profile.kind === 'competitor' && profile.active &&
    (profile.courseKeys.length === 0 || profile.courseKeys.includes(courseKey)));
}

export function registryContext(profiles: readonly TrackedCompetitor[]) {
  return profiles.map(profile => ({
    name: profile.name,
    relationship: profile.kind,
    aliases: profile.aliases,
    domains: profile.domains,
    websiteUrl: profile.websiteUrl,
    courseUrls: profile.courseUrls,
    linkedinUrl: profile.linkedinUrl,
    facebookUrl: profile.facebookUrl,
    instagramUrl: profile.instagramUrl,
  }));
}

export function matchesRegisteredSource(profile: TrackedCompetitor, sourceUrl: string): boolean {
  const source = new URL(sourceUrl);
  const host = source.hostname.replace(/^www\./u, '');
  const social = /(?:^|\.)(?:linkedin\.com|facebook\.com|instagram\.com)$/u.test(host);
  const urls = [profile.websiteUrl, ...profile.courseUrls, profile.linkedinUrl, profile.facebookUrl, profile.instagramUrl]
    .filter((url): url is string => Boolean(url));
  if (social) return urls.some(value => {
    const saved = new URL(value);
    return saved.hostname.replace(/^www\./u, '') === host &&
      source.pathname.replace(/\/$/u, '') === saved.pathname.replace(/\/$/u, '');
  });
  const domains = [...profile.domains, ...urls.map(value => new URL(value).hostname.replace(/^www\./u, ''))];
  return domains.some(domain => host === domain || host.endsWith(`.${domain}`));
}
