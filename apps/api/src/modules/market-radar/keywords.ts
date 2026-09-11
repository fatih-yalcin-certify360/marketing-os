import { randomUUID } from 'node:crypto';
import { keywordAnalysis, type KeywordReport } from '@c360/contracts';
import type { AudiencePage } from './audience.js';
const normalize = (s: string): string => s.replace(/[\s\u200b]+/gu, ' ').trim().toLowerCase();
export function verifyKeywords(value: unknown, pages: AudiencePage[]): KeywordReport {
  const report: KeywordReport = { items: [], notes: [] };
  const parsed = keywordAnalysis.safeParse(value);
  if (!parsed.success) {
    report.notes.push('Geen bruikbaar vragenonderzoek ontvangen; er zijn geen zoekcijfers ingevuld.');
    return report;
  }
  if (parsed.data.note) report.notes.push(parsed.data.note);
  const seen = new Set<string>();
  for (const item of parsed.data.items) {
    const page = pages.find((p) => p.url === item.sourceUrl);
    if (!page || !normalize(page.text).includes(normalize(item.excerpt))) continue;
    // A proposed query must never acquire the status of an observed FAQ question.
    if (item.kind === 'page_question' && (!item.phrase.includes('?') || !normalize(item.excerpt).includes(normalize(item.phrase)))) continue;
    // Numeric comparisons need support in the same cited passage as well.
    if ((item.phrase.match(/\d+(?:[.,]\d+)?/gu) ?? []).some((number) => !item.excerpt.includes(number))) continue;
    const key = normalize(item.phrase);
    if (seen.has(key)) continue;
    seen.add(key);
    report.items.push({ ...item, id: randomUUID(), retrievedAt: page.retrievedAt, monthlyVolume: null, cpc: null, difficulty: null });
  }
  report.notes.push('Pagina-vragen zijn letterlijk teruggevonden. Zoekvoorstellen zijn hypothesen op basis van brononderwerpen, geen gemeten Google-zoekopdrachten. Zoekvolume, CPC en concurrentiescore zijn niet beschikbaar.');
  return report;
}
