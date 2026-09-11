import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { radarReport, type RadarRun } from '@c360/contracts';
import { verifyKeywords } from '../../src/modules/market-radar/keywords.js';
import { buildMarketPackage } from '../../src/modules/market-radar/package.js';
const url = 'https://example.org/course';
const excerpt = 'Wat doet een casemanager? Lees hier over deze beroepsrichting.';
const proposal = { phrase: 'Wat doet een casemanager?', kind: 'page_question', sourceUrl: url, excerpt, intent: 'informational', rationale: 'Een concrete vraag over de beroepsrichting.' };
const pages = [{ url, text: excerpt, retrievedAt: '2026-09-10T12:00:00Z' }];
function run(): RadarRun {
  const keywords = verifyKeywords({ items: [proposal], note: '' }, pages);
  return { id: randomUUID(), courseVersionId: randomUUID(), createdAt: pages[0]!.retrievedAt, report: radarReport.parse({
    cards: [], notes: [], failures: [], isMock: false, keywords,
    package: { status: 'draft', selected: ['blog_faq', 'fit_check', 'site_banner'], courseUrl: url, notes: [], content: {
      title: '<script>alert("x")</script>', intro: 'Een introductie over een opleidingskeuze voor professionals.',
      sections: [0, 1].map(() => ({ heading: 'Een beroepskeuze', text: 'Bespreek je opleidingskeuze en vergelijk de gecontroleerde informatie.' })),
      faq: [0, 1].map(() => ({ question: 'Wat kan ik vergelijken?', answer: 'Bekijk de gecontroleerde opleidingsinformatie.' })),
      reflection: [0, 1, 2].map(() => ({ question: 'Wat wil je verder onderzoeken?', options: [0, 1, 2].map(() => ({ label: 'Mijn huidige ervaring', guidance: 'Vergelijk je ervaring met de opleidingsinformatie.' })) })),
      banner: { headline: 'Onderzoek je volgende stap', body: 'Bekijk de opleidingsinformatie voor je volgende stap.' },
      evidenceIds: [keywords.items[0]!.id], reviewNotes: ['Controleer de claims.'],
    } },
  }) };
}
describe('source-backed questions and draft packages', () => {
  it('does not promote invented questions or unsourced queries to evidence', () => {
    const report = verifyKeywords({ items: [proposal,
      { ...proposal, phrase: 'Hoeveel verdien ik gegarandeerd?' },
      { ...proposal, kind: 'suggested_query', phrase: 'CROV 7 versus 10 lesdagen' },
      { ...proposal, kind: 'suggested_query', phrase: 'crov opleiding vergelijken', sourceUrl: 'https://unread.example' },
      { ...proposal, kind: 'suggested_query', phrase: 'crov opleiding vergelijken' },
    ], note: '' }, pages);
    expect(report.items.map((i) => i.kind)).toEqual(['page_question', 'suggested_query']);
    expect(report.items.every((i) => i.monthlyVolume === null)).toBe(true);
  });
  it('exports only selected deliverables with escaped HTML and an evidence dossier', async () => {
    const zip = await JSZip.loadAsync(await buildMarketPackage(run(), ['blog_faq']));
    expect(zip.file('keuzehulp/index.html')).toBeNull();
    expect(zip.file('site-banner/index.html')).toBeNull();
    expect(await zip.file('blog/index.html')!.async('string')).toContain('&lt;script&gt;');
    expect(await zip.file('blog/index.html')!.async('string')).not.toContain('<script>alert');
    expect(zip.file('onderzoek/vragen.json')).not.toBeNull();
    expect(await zip.file('LEESMIJ.txt')!.async('string')).toContain('CONCEPT');
  });
  it('ships local executable JS and TypeScript, and rejects unavailable parts', async () => {
    const report = run();
    const zip = await JSZip.loadAsync(await buildMarketPackage(report, ['fit_check']));
    const js = await zip.file('keuzehulp/widget.js')!.async('string');
    expect(js).toBe(await zip.file('keuzehulp/src/widget.ts')!.async('string'));
    expect(js).toContain('textContent');
    expect(js).not.toContain('innerHTML');
    report.report.package!.selected = ['blog_faq'];
    await expect(buildMarketPackage(report, ['fit_check'])).rejects.toMatchObject({ code: 'conflict' });
    const research = await JSZip.loadAsync(await buildMarketPackage(report, []));
    expect(research.file('blog/index.html')).toBeNull();
  });
});
