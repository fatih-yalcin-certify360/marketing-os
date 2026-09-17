import { describe, expect, it } from 'vitest';
import type { RadarReport } from '@c360/contracts';
import {
  buildDigest,
  competitorClaims,
  evidenceItems,
  redactContactDetails,
  verifyInsights,
} from '../../src/modules/market-radar/synthesis.js';

/**
 * The market picture is only as true as the checks that gate it.
 *
 * The model proposes insights; this module decides which survive: those that
 * cite evidence the run actually holds, quote rather than produce figures,
 * and avoid the words the product refuses. Confidence is arithmetic over the
 * cited domains, so a single-source insight can never wear "robuust".
 */

const card = (id: string, url: string, excerpt: string, relationship: 'competitor' | 'authority' = 'competitor') => ({
  id,
  sourceUrl: url,
  organization: new URL(url).hostname,
  relationship,
  relationshipReason: 'Biedt een vergelijkbare opleiding aan.',
  title: `Kaart ${id}`,
  observation: 'De bron zegt iets.',
  excerpt,
  relevance: 'Relevant voor de opleidingskeuze.',
  publishedDate: null,
  dateExcerpt: null,
  period: null,
  uncertainty: 'Onbekend.',
  approaches: [0, 1, 2].map((i) => ({ title: `Route ${String(i)}`, format: 'LinkedIn-bericht', idea: 'Een idee met genoeg tekst.', audience: 'HR' })),
  retrievedAt: '2026-09-11T10:00:00.000Z',
  contentHash: `hash-${id}`,
  imageUrl: null,
  materialType: 'web_page' as const,
  change: 'first_seen' as const,
});

const report: Pick<RadarReport, 'cards' | 'audience' | 'keywords' | 'advertising'> = {
  cards: [
    card('c1', 'https://aanbieder-a.example/opleiding', 'De opleiding duurt 6 dagen en start in september.'),
    card('c2', 'https://aanbieder-b.example/cursus', 'Deze cursus is bedoeld voor HR-adviseurs met verzuimtaken.'),
    card('c3', 'https://vakblad.example/artikel', 'Casemanagers krijgen steeds vaker regie over het dossier.', 'authority'),
  ],
  audience: {
    competitors: [{ sourceUrl: 'https://aanbieder-c.example/', organization: 'Aanbieder C', excerpt: 'Erkende post-hbo opleiding voor casemanagers.', reason: 'Zelfde kwalificatie.' }],
    findings: [],
    checkedSources: 4,
    independentDomains: 0,
    notes: [],
  },
  keywords: null,
  advertising: null,
};

const proposal = (over: Record<string, unknown> = {}) => ({
  headlineNl: 'Aanbieders positioneren de opleiding als praktijkgerichte regie-opleiding.',
  observationNl: 'Aanbieder A noemt een opleiding van 6 dagen; aanbieder B richt zich op HR-adviseurs met verzuimtaken.',
  meaningNl: 'Voor HR-adviseurs die vergelijken is de praktische invulling het vergelijkingspunt, in de fase Overwegen.',
  nowNl: 'Werk een Overwegen-campagne uit die de inhoud en werkwijze concreet maakt.',
  alternativeNl: 'Beide aanbieders kunnen dezelfde doelgroep om commerciële redenen noemen zonder dat die groep zoekt.',
  notShownNl: 'Geen zoekvolume, geen marktaandeel, geen resultaat van deze aanbieders.',
  stage: 'consider',
  suggestedObjective: 'consideration',
  agreement: 'eens',
  evidence: [{ kind: 'card', id: 'c1' }, { kind: 'card', id: 'c2' }],
  ...over,
});

describe('verifyInsights', () => {
  const items = evidenceItems(report);

  it('keeps an insight whose evidence exists and grades it from the cited domains', () => {
    const { insights, notes } = verifyInsights({ insights: [proposal()], note: '' }, items);
    expect(insights).toHaveLength(1);
    expect(insights[0]?.confidence).toMatchObject({ evidence: 'gemiddeld', independentDomains: 2, agreement: 'eens', kinds: ['card'] });
    expect(notes).toEqual([]);
  });

  it('drops an insight that cites evidence the run does not hold, and says so', () => {
    const { insights, notes } = verifyInsights(
      { insights: [proposal({ evidence: [{ kind: 'card', id: 'invented' }] })], note: '' },
      items,
    );
    expect(insights).toEqual([]);
    expect(notes.join(' ')).toMatch(/geen bewijs uit deze scan/u);
  });

  it('refuses a figure that is not quoted from a cited passage, and any figure outside the observation', () => {
    const unquoted = verifyInsights(
      { insights: [proposal({ observationNl: 'Aanbieder A noemt 12 dagen en aanbieder B richt zich op HR-adviseurs.' })], note: '' },
      items,
    );
    expect(unquoted.insights).toEqual([]);
    expect(unquoted.notes.join(' ')).toMatch(/getal 12/u);

    const inMeaning = verifyInsights(
      { insights: [proposal({ meaningNl: 'Voor de 3 grootste aanbieders is dit het vergelijkingspunt in Overwegen.' })], note: '' },
      items,
    );
    expect(inMeaning.insights).toEqual([]);
    expect(inMeaning.notes.join(' ')).toMatch(/cijfer buiten de waarneming/u);
  });

  it('refuses percentages, trend and significance language', () => {
    for (const meaningNl of [
      'Een groeiende trend onder aanbieders maakt dit het moment om te vergelijken.',
      'Een significant deel van de aanbieders positioneert zo.',
      'Gemiddeld in de markt ligt de nadruk op praktijk.',
    ]) {
      const { insights, notes } = verifyInsights({ insights: [proposal({ meaningNl })], note: '' }, items);
      expect(insights, meaningNl).toEqual([]);
      expect(notes.join(' ')).toMatch(/percentage, trend- of significantieclaim/u);
    }
    expect(verifyInsights({ insights: [proposal({ observationNl: 'Aanbieder A zegt 40% van de cursisten slaagt.' })], note: '' }, items).insights).toEqual([]);
  });

  it('does not let a single source claim agreement', () => {
    const { insights } = verifyInsights(
      { insights: [proposal({ evidence: [{ kind: 'card', id: 'c1' }], observationNl: 'Aanbieder A noemt een opleiding van 6 dagen.' })], note: '' },
      items,
    );
    expect(insights[0]?.confidence).toMatchObject({ evidence: 'beperkt', independentDomains: 1, agreement: 'niet_te_beoordelen' });
  });

  it('grades three independent domains as robuust and mixes evidence kinds', () => {
    const { insights } = verifyInsights(
      {
        insights: [
          proposal({
            evidence: [
              { kind: 'card', id: 'c1' },
              { kind: 'card', id: 'c2' },
              { kind: 'competitor', id: 'https://aanbieder-c.example/' },
            ],
          }),
        ],
        note: '',
      },
      items,
    );
    expect(insights[0]?.confidence).toMatchObject({ evidence: 'robuust', independentDomains: 3 });
    expect(insights[0]?.confidence.kinds.sort()).toEqual(['card', 'competitor']);
  });

  it('reports an unusable answer as no insights rather than failing the scan', () => {
    const { insights, notes } = verifyInsights({ nonsense: true }, items);
    expect(insights).toEqual([]);
    expect(notes[0]).toMatch(/Geen bruikbaar marktbeeld/u);
  });
});

describe('competitorClaims', () => {
  it('quotes competitors from both the audience competitors and the competitor cards, once each', () => {
    const claims = competitorClaims(report);
    expect(claims.map((claim) => claim.organization)).toEqual(['Aanbieder C', 'aanbieder-a.example', 'aanbieder-b.example']);
    // The authority card is not a competitor and is not quoted as one.
    expect(claims.some((claim) => claim.sourceUrl.includes('vakblad'))).toBe(false);
    expect(competitorClaims({ ...report, cards: [...report.cards, ...report.cards] })).toHaveLength(3);
  });
});

describe('buildDigest', () => {
  it('is empty for a first scan and names new, changed and gone sources afterwards', () => {
    expect(buildDigest(report, undefined)).toEqual({ previousRunId: null, previousAt: null, items: [] });

    const previous = {
      id: '11111111-1111-4111-8111-111111111111',
      createdAt: '2026-09-01T09:00:00.000Z',
      report: {
        ...report,
        cards: [
          { ...report.cards[0]!, contentHash: 'older-hash' },
          card('c9', 'https://weg.example/pagina', 'Deze pagina staat niet meer in de scan.'),
        ],
        audience: { ...report.audience!, competitors: [] },
      },
    };
    const digest = buildDigest(report, previous);
    expect(digest.previousRunId).toBe(previous.id);
    const kinds = digest.items.map((item) => item.kind);
    expect(kinds).toContain('card_changed');
    expect(kinds).toContain('card_new');
    expect(kinds).toContain('card_gone');
    expect(kinds).toContain('competitor_new');
    // A changed hash is a text change, never a market movement.
    expect(digest.items.find((item) => item.kind === 'card_changed')?.noteNl).toMatch(/geen marktbeweging/u);
  });
});

describe('redactContactDetails', () => {
  it('removes e-mail addresses and phone numbers and reports that it did', () => {
    const { text, redacted } = redactContactDetails(
      'Neem contact op met info@voorbeeld.nl of bel 06-12345678, of +31 20 123 4567.',
    );
    expect(redacted).toBe(true);
    expect(text).not.toMatch(/@|06-1234|123 4567/u);
    expect(text).toMatch(/\[e-mailadres weggelaten\]/u);
    expect(text).toMatch(/\[telefoonnummer weggelaten\]/u);
  });

  it('leaves ordinary text and course figures alone', () => {
    const { text, redacted } = redactContactDetails('De opleiding duurt 6 dagen en kost € 2.950 exclusief btw.');
    expect(redacted).toBe(false);
    expect(text).toBe('De opleiding duurt 6 dagen en kost € 2.950 exclusief btw.');
  });
});
