import { randomUUID } from 'node:crypto';
import {
  audienceAnalysis,
  type AudienceReport,
  type RadarRun,
} from '@c360/contracts';
export interface AudiencePage {
  url: string;
  text: string;
  retrievedAt: string;
}
const normal = (s: string): string =>
  s
    .replace(/[\s\u200b]+/gu, ' ')
    .trim()
    .toLowerCase();
export function verifyAudience(
  value: unknown,
  pages: AudiencePage[],
  ownUrl?: string | null,
  ownUrls: readonly string[] = [],
): AudienceReport {
  const report: AudienceReport = {
    competitors: [],
    findings: [],
    checkedSources: pages.length,
    independentDomains: 0,
    notes: [],
  };
  const parsed = audienceAnalysis.safeParse(value);
  if (!parsed.success) {
    report.notes.push(
      'Geen bruikbaar doelgroepantwoord ontvangen. Er zijn geen bevindingen ingevuld.',
    );
    return report;
  }
  if (parsed.data.note) report.notes.push(parsed.data.note);
  const host = (url: string): string =>
    new URL(url).hostname.replace(/^www\./u, '');
  let ownHost: string | null = null;
  try {
    if (ownUrl) ownHost = host(ownUrl);
  } catch {
    /* A document reference is not a domain. */
  }
  const competitorHosts = new Set<string>();
  const ownHosts = [ownHost, ...ownUrls.flatMap(url => {
    try { return [host(url)]; } catch { return []; }
  })].filter((value): value is string => value !== null);
  for (const item of parsed.data.competitors) {
    const page = pages.find((p) => p.url === item.sourceUrl);
    if (!page || !normal(page.text).includes(normal(item.excerpt))) continue;
    const domain = host(item.sourceUrl);
    if (
      ownHosts.some(own => domain === own || domain.endsWith(`.${own}`)) ||
      competitorHosts.has(domain)
    )
      continue;
    competitorHosts.add(domain);
    report.competitors.push(item);
  }

  const seen = new Set<string>();
  for (const proposal of parsed.data.findings) {
    const page = pages.find((p) => p.url === proposal.sourceUrl);
    if (
      !page ||
      !normal(page.text).includes(normal(proposal.excerpt)) ||
      !normal(proposal.excerpt).includes(normal(proposal.role))
    ) {
      report.notes.push(
        'Bevinding weggelaten: rol of bronpassage niet teruggevonden.',
      );
      continue;
    }
    const key =
      new URL(page.url).hostname.replace(/^www\./u, '') +
      ':' +
      normal(proposal.role);
    if (seen.has(key)) continue;
    seen.add(key);
    const backed = (term: string | null, excerpt: string | null): boolean =>
      Boolean(
        term &&
        excerpt &&
        normal(page.text).includes(normal(excerpt)) &&
        normal(excerpt).includes(normal(term)),
      );
    const sector = backed(proposal.sector, proposal.sectorExcerpt);
    const education =
      proposal.sourceKind === 'alumni_story' &&
      backed(proposal.educationProvider, proposal.educationExcerpt);
    report.findings.push({
      ...proposal,
      id: randomUUID(),
      retrievedAt: page.retrievedAt,
      sector: sector ? proposal.sector : null,
      sectorExcerpt: sector ? proposal.sectorExcerpt : null,
      educationProvider: education ? proposal.educationProvider : null,
      educationExcerpt: education ? proposal.educationExcerpt : null,
    });
  }
  report.independentDomains = new Set(
    report.findings.map((f) =>
      new URL(f.sourceUrl).hostname.replace(/^www\./u, ''),
    ),
  ).size;
  report.notes.push(
    'Openbare steekproef, geen representatieve sectorverdeling. Teruggevonden passages bewijzen niet alle interpretaties. Een titel bewijst geen opleider of loopbaaneffect; controleer de onderbouwing.',
  );
  return report;
}
/** Freeze the chosen run's evidence inside the campaign brief; later scans cannot replace it. */
export function audienceBrief(run: RadarRun): string {
  if (!run.report.audience?.findings.length) return '';
  const parts = [
    'Doelgroeponderzoek uit radar-run ' +
      run.id +
      '. Gebruik dit voor persona-hypothesen; geen bewezen koopintentie, doelgroepomvang of eigen opleidingsclaims.',
    ...run.report.audience.findings
      .slice(0, 3)
      .map(
        (f) =>
          `Rol: ${f.role}. Organisatie (te controleren): ${f.organization}. Brontype: ${f.sourceKind}.\nBron: ${f.sourceUrl} (bekeken ${f.retrievedAt}).\nLetterlijke passage: ${f.excerpt}\nSector: ${f.sector ?? 'niet vastgesteld'}. Onderbouwing: ${f.sectorExcerpt ?? 'ontbreekt'}.\nOpleider: ${f.educationProvider ?? 'niet vastgesteld'}. Onderbouwing: ${f.educationExcerpt ?? 'ontbreekt'}.\nDoelgroephypothese: ${f.hypothesis}\nBeperking: ${f.uncertainty}`,
      ),
  ];
  const selected: string[] = [];
  let length = 0;
  for (const part of parts) {
    if (length + part.length > 8500) break;
    selected.push(part);
    length += part.length + 2;
  }
  selected.push(
    `Bewijssnapshot: ${String(selected.length - 1)} van ${String(run.report.audience.findings.length)} bevindingen uit deze scan opgenomen.`,
  );
  return selected.join('\n\n');
}
