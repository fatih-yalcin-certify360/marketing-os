import { describe, expect, it } from 'vitest';
import type { ContentAssetVersion, PersonaVersion } from '@c360/contracts';
import { buildDossier, type DossierBlock } from '../../src/modules/content-assets/dossier.js';

/**
 * What goes into the document, decided once.
 *
 * Two file formats are produced from this model, so a rule that lives in a
 * renderer is a rule the other renderer does not have. These tests are about
 * the model only: the order of the parts, what is said when something is
 * missing, and the fact that nothing is filled in on the reader's behalf.
 */

const persona: PersonaVersion = {
  id: '11111111-1111-4111-8111-111111111111',
  labelId: '99999999-9999-4999-8999-999999999999',
  courseVersionId: '44444444-4444-4444-8444-444444444444',
  version: 2,
  personaKey: 'vastgelopen-casemanager',
  campaignId: null,
  linkedCourseVersionIds: [],
  questionnaire: {
    q01: { answer: 'Casemanager bij een arbodienst.', status: 'provided', sourceQuote: 'casemanager bij een arbodienst' },
    q23: { answer: 'De werkgever betaalt.', status: 'unknown', sourceQuote: null },
  },
  name: 'Vastgelopen casemanager',
  summary: 'Regelt verzuim en loopt vast zodra een dossier juridisch wordt.',
  need: 'Weten welke stap wettelijk moet en wanneer.',
  motivation: 'Wil niet terugkomen op eerder gegeven adviezen.',
  barriers: ['Twijfelt of het naast de caseload past'],
  decisionCriteria: ['Erkenning die de werkgever accepteert'],
  relationToCourse: 'Zoekt precies de regie-rol die deze opleiding beschrijft.',
  grounding: [],
  assumptions: [],
  orientationSources: [],
  reviewState: 'approved',
  origin: 'ai_generated',
  promptVersion: 'persona.extract_from_text@v2',
  createdAt: '2026-09-16T09:30:00.000Z',
  createdByUserId: null,
};

function asset(overrides: Partial<ContentAssetVersion> = {}): ContentAssetVersion {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    campaignId: null,
    ownerScope: 'standalone',
    originKind: 'manual',
    originRefId: null,
    instructionNl: 'Schrijf een mail over het moment waarop een dossier juridisch wordt.',
    assetKey: 'los-email-abc',
    version: 1,
    channel: 'email',
    funnelStage: 'discover',
    format: 'text_only',
    language: 'nl',
    copy: {
      hook: 'Wanneer wordt een verzuimdossier juridisch?',
      body: 'De eerste alinea.\n\nDe tweede alinea.',
      sections: [],
      ads: null,
      ctaText: 'Bekijk de opleiding',
      ctaUrl: 'https://example.org/crov',
      imageAltText: null,
      hashtags: [],
      keywordsUsed: [],
      website: null,
    },
    variants: [],
    briefVersionId: null,
    conceptVersionId: null,
    brandProfileVersionId: '33333333-3333-4333-8333-333333333333',
    courseVersionId: '44444444-4444-4444-8444-444444444444',
    personaVersionIds: [persona.id],
    warnings: [],
    channelConfigVersion: 4,
    reviewState: 'draft',
    origin: 'ai_generated',
    promptVersion: 'content.generate@v7',
    editedByUserId: null,
    createdByUserId: '55555555-5555-4555-8555-555555555555',
    createdAt: '2026-09-17T08:12:00.000Z',
    ...overrides,
  };
}

/** Who wrote the persona, which the dossier has to carry too. */
const author = { userId: '77777777-7777-4777-8777-777777777777', displayName: 'Demo Onderzoeker', email: 'onderzoek@example.org' };

const base = {
  label: { name: 'Certify360 (Demo)' },
  course: { name: 'Casemanager Regie op Verzuim', externalCode: 'CROV', courseUrl: null },
  createdBy: { displayName: 'Demo Gebruiker', email: 'demo@example.org' },
  campaignName: null,
  generatedAt: '2026-09-17T11:00:00.000Z',
};

/** Every piece of text in the document, flattened, for a contains check. */
function flatten(blocks: readonly DossierBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === 'bullets') return block.items.join(' ');
      if (block.kind === 'fields') return block.rows.map((row) => `${row.term}: ${row.value}`).join(' ');
      if (block.kind === 'pageBreak') return '';
      return block.text;
    })
    .join('\n');
}

describe('the dossier of one piece of content', () => {
  it('reads in one order: the facts, the audience, the instruction, the text', () => {
    const dossier = buildDossier({ ...base, asset: asset(), personas: [{ version: persona, createdBy: author }] });
    const headings = dossier.blocks
      .filter((block) => block.kind === 'heading')
      .map((block) => (block.kind === 'heading' ? block.text : ''));

    expect(headings).toEqual([
      '1. Waar dit over gaat',
      '2. Voor wie dit geschreven is',
      '3. Wat er gevraagd is',
      '4. De uiting',
      '5. Aandachtspunten en herkomst',
    ]);
  });

  it('carries the audience with everything that was recorded about it', () => {
    const dossier = buildDossier({ ...base, asset: asset(), personas: [{ version: persona, createdBy: author }] });
    const text = flatten(dossier.blocks);

    expect(text).toContain(persona.name);
    expect(text).toContain(persona.need);
    expect(text).toContain(persona.motivation);
    expect(text).toContain(persona.barriers[0] ?? '');
    expect(text).toContain(persona.decisionCriteria[0] ?? '');
    expect(text).toContain(persona.relationToCourse);
    // Who wrote the persona, not only who asked for the piece.
    expect(text).toContain('Demo Onderzoeker');
    // An answered question travels with the passage it came from; an unknown
    // one is counted, not printed as an empty row.
    expect(text).toContain('Casemanager bij een arbodienst.');
    expect(text).toContain('casemanager bij een arbodienst');
    expect(text).not.toContain('De werkgever betaalt.');
    expect(text).toContain('35 van de 36 vragen zijn niet beantwoord');
  });

  it('says so plainly when no audience was chosen', () => {
    const dossier = buildDossier({ ...base, asset: asset({ personaVersionIds: [] }), personas: [] });
    const text = flatten(dossier.blocks);
    expect(text).toContain('geen doelgroep gekozen');
    expect(text).toContain('voor de opleiding in het algemeen');
  });

  it('does not reconstruct an instruction it does not have', () => {
    const dossier = buildDossier({ ...base, asset: asset({ instructionNl: null }), personas: [] });
    const text = flatten(dossier.blocks);
    expect(text).toContain('niet vastgelegd');
    expect(text).toContain('niet gereconstrueerd');
  });

  it('points a campaign piece at its briefing instead', () => {
    const dossier = buildDossier({
      ...base,
      campaignName: 'Najaarsinstroom (Demo)',
      asset: asset({
        instructionNl: null,
        ownerScope: 'campaign',
        campaignId: '66666666-6666-4666-8666-666666666666',
        originKind: null,
      }),
      personas: [],
    });
    const text = flatten(dossier.blocks);
    expect(text).toContain('goedgekeurde briefing');
    expect(text).toContain('Najaarsinstroom (Demo)');
  });

  it('says a draft is a draft, and who wrote it', () => {
    const dossier = buildDossier({ ...base, asset: asset(), personas: [{ version: persona, createdBy: author }] });
    const text = flatten(dossier.blocks);
    expect(text).toContain('niet goedgekeurd');
    expect(text).toContain('door een taalmodel geschreven');
    expect(text).toContain('demo@example.org');
    expect(text).toContain('Certify360 (Demo)');
    expect(text).toContain('CROV');
  });

  it('counts one attention point as one', () => {
    const dossier = buildDossier({
      ...base,
      personas: [],
      asset: asset({
        warnings: [
          { kind: 'alt_text_missing', messageNl: 'Er is geen alt-tekst.', blocksPublishReady: true },
        ],
      }),
    });
    const text = flatten(dossier.blocks);
    expect(text).toContain('Er is 1 aandachtspunt bij deze versie, en het houdt een publicatieklaar pakket tegen');
    expect(text).not.toContain('(en)');
  });

  it('folds the file name to something a file system accepts', () => {
    const dossier = buildDossier({
      ...base,
      personas: [],
      asset: asset({
        copy: {
          ...asset().copy,
          hook: 'Wanneer wordt “dit” juridisch / echt lastig? Vragen uit de praktijk',
        },
      }),
    });
    expect(dossier.fileName).toMatch(/^dossier-[a-z0-9-]+-v1$/u);
    expect(dossier.fileName).not.toContain('--');
  });
});
