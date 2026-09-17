import { describe, it, expect } from 'vitest';
import {
  verifyAudience,
  audienceBrief,
} from '../../src/modules/market-radar/audience.js';
const page = {
  url: 'https://employer.example/team',
  text: 'Wij bieden arbodienstverlening. Ons team werkt als casemanager CROV voor werkgevers.',
  retrievedAt: '2026-09-10T12:00:00Z',
};
const finding = {
  sourceUrl: page.url,
  sourceKind: 'employer_team',
  organization: 'Voorbeeld',
  role: 'casemanager CROV',
  excerpt: 'Ons team werkt als casemanager CROV voor werkgevers.',
  sector: 'arbodienstverlening',
  sectorExcerpt: 'Wij bieden arbodienstverlening.',
  educationProvider: 'Capabel',
  educationExcerpt: 'Capabel heeft onze medewerkers opgeleid.',
  hypothesis: 'Test de behoefte aan beroepsontwikkeling bij deze rol.',
  uncertainty: 'Geen bewijs van opleider of koopintentie.',
};
describe('audience evidence', () => {
  it('selects independently quoted competitors, excluding the own brand and unvisited sources', () => {
    const competitor = {
      sourceUrl: page.url,
      organization: 'Voorbeeld',
      excerpt: page.text,
      reason: 'Vergelijkbaarheid moet worden beoordeeld.',
    };
    const own = { ...page, url: 'https://cs.example/course' };
    const r = verifyAudience(
      {
        findings: [],
        note: '',
        competitors: [competitor, { ...competitor, sourceUrl: own.url }],
      },
      [page, own],
      'https://www.cs.example/course',
    );
    expect(r.competitors.map((c) => c.sourceUrl)).toEqual([page.url]);
    expect(
      verifyAudience(
        {
          findings: [],
          note: '',
          competitors: [
            { ...competitor, sourceUrl: 'https://unvisited.example/course' },
          ],
        },
        [page],
      ).competitors,
    ).toEqual([]);
  });

  it('keeps quoted roles, independently verifies sectors, and does not infer a diploma provider', () => {
    const r = verifyAudience({ findings: [finding], note: '' }, [page]);
    expect(r.findings[0]?.sector).toBe('arbodienstverlening');
    expect(r.findings[0]?.educationProvider).toBeNull();
    expect(r.independentDomains).toBe(1);
  });
  it('drops invented passages, roles and unvisited sources', () => {
    const r = verifyAudience(
      {
        findings: [
          { ...finding, sourceUrl: 'https://elsewhere.example' },
          { ...finding, role: 'directeur' },
          { ...finding, excerpt: 'Dit is een verzonnen lange bronpassage.' },
        ],
        note: '',
      },
      [page],
    );
    expect(r.findings).toEqual([]);
  });
  it('deduplicates a role within one domain and leaves unsupported sectors empty', () => {
    const f = { ...finding, sector: 'verzekeringen' };
    const r = verifyAudience({ findings: [f, f], note: '' }, [page]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.sector).toBeNull();
  });
  it('copies actual excerpts and qualifications of evidence to the frozen campaign brief', () => {
    const audience = verifyAudience({ findings: [finding], note: '' }, [page]);
    const text = audienceBrief({
      id: 'run',
      courseVersionId: 'course',
      createdAt: page.retrievedAt,
      report: {
        keywords: null, package: null,
        audience,
        advertising: null,
        cards: [],
        notes: [],
        failures: [],
        isMock: false,
        insights: [],
        digest: null,
        claims: [],
      },
    });
    expect(text).toContain(page.url);
    expect(text).toContain(finding.excerpt);
    expect(text).toContain('Opleider: niet vastgesteld');
  });
});
