import { describe, expect, it } from 'vitest';
import { campaignPackageContent } from '@c360/contracts';
import { buildQuizFiles, decideOutcome, quizDestination } from '../../src/modules/campaign-packages/quiz.js';

/**
 * The keuzehulp as a quiz (2026-09-15): the decision rule, the tagged
 * destination and the files — the same algorithm is written into the page's
 * script, so the browser decides as this test does.
 */
describe('decideOutcome', () => {
  it('follows the majority and falls back to explore on a tie', () => {
    expect(decideOutcome(['fit', 'fit', 'explore'])).toBe('fit');
    expect(decideOutcome(['other', 'other', 'fit'])).toBe('other');
    expect(decideOutcome(['fit', 'other', 'explore'])).toBe('explore');
    expect(decideOutcome(['fit', 'other'])).toBe('explore');
    expect(decideOutcome([])).toBe('explore');
    expect(decideOutcome(['explore', 'explore', 'fit', 'fit', 'other'])).toBe('explore');
  });
});

describe('quizDestination', () => {
  it('tags the course page so a visit from the quiz is attributable, without touching a broken URL', () => {
    const url = new URL(quizDestination('https://example.org/opleiding?x=1', 'a66652bd-bf21-4c03-aca1-711d4a958ea3'));
    expect(url.searchParams.get('x')).toBe('1');
    expect(url.searchParams.get('utm_source')).toBe('keuzehulp');
    expect(url.searchParams.get('utm_medium')).toBe('website');
    expect(url.searchParams.get('utm_campaign')).toBe('a66652bd');
    expect(quizDestination('nonsense', 'x')).toBe('nonsense');
  });
});

describe('buildQuizFiles', () => {
  const content = campaignPackageContent.parse({
    title: 'Past regie op verzuim bij jouw overstap?',
    intro: 'Een korte keuzehulp voor wie casemanagement overweegt en wil weten of het vak past.',
    sections: [
      { heading: 'Wat een casemanager doet', text: 'Een casemanager begeleidt verzuimdossiers en houdt overzicht over rechten, plichten en gesprekken.' },
      { heading: 'Wat de opleiding toevoegt', text: 'De opleiding legt het kader onder wat je in de praktijk al doet, met wetgeving en gespreksvoering.' },
    ],
    faq: [
      { question: 'Is dit een toelatingstest?', answer: 'Nee, het is een keuzehulp zonder score of oordeel.' },
      { question: 'Wat gebeurt er met mijn antwoorden?', answer: 'Niets: er wordt niets opgeslagen of verzonden.' },
    ],
    reflection: [
      { question: 'Wat is je uitgangssituatie?', options: [
        { label: 'Ik doe dit werk al', guidance: 'Praktijk is een sterke basis.', signal: 'fit' },
        { label: 'Ik oriënteer me', guidance: 'Lees eerst wat het vak vraagt.', signal: 'explore' },
        { label: 'Ik heb de kwalificatie al', guidance: 'Kijk naar verdieping.', signal: 'other' },
      ] },
      { question: 'Wat speelt er in je werk?', options: [
        { label: 'Vragen zonder antwoord', guidance: 'Precies waarvoor de opleiding is.', signal: 'fit' },
        { label: 'Ik wil weten wat het inhoudt', guidance: 'Begin bij de inhoud.', signal: 'explore' },
        { label: 'Mijn werk gaat een andere kant op', guidance: 'Een andere richting past beter.', signal: 'other' },
      ] },
      { question: 'Hoeveel ruimte heb je?', options: [
        { label: 'Tijd naast mijn werk', guidance: 'Controleer de studielast.', signal: 'fit' },
        { label: 'Weet ik nog niet', guidance: 'Bespreek het eerst.', signal: 'explore' },
        { label: 'Nu even niet', guidance: 'Een later moment is realistischer.', signal: 'other' },
      ] },
    ],
    outcomes: {
      fit: { title: 'Deze opleiding past bij je situatie', text: 'Je antwoorden wijzen op werk waarin de vragen van deze opleiding nu al spelen en op ruimte om ermee aan de slag te gaan. Lees de inhoud en de voorwaarden op de opleidingspagina en leg de start naast je agenda.', nextSteps: ['Lees de opleidingspagina.', 'Bespreek tijd en budget.'] },
      explore: { title: 'Eerst verder oriënteren', text: 'Je antwoorden wijzen op belangstelling, maar nog niet op een duidelijke aanleiding of ruimte. Verken eerst wat het vak in de praktijk vraagt en wat de opleiding daarvan behandelt.', nextSteps: ['Lees de inhoud en de doelgroep.'] },
      other: { title: 'Een andere richting past waarschijnlijk beter', text: 'Je antwoorden wijzen op een situatie waarin deze basisopleiding weinig toevoegt. Kijk naar verdieping in je huidige richting; deze keuzehulp adviseert geen vervolgaanbod.', nextSteps: ['Bespreek verdieping met je leidinggevende.'] },
    },
    banner: { headline: 'Past regie op verzuim bij jou?', body: 'Drie vragen, één eerlijke uitkomst.', question: 'Waar sta jij nu?', options: [{ label: 'Ik doe het al', feedback: 'Dan legt de opleiding het kader onder je praktijk.' }, { label: 'Ik verken', feedback: 'Begin bij de inhoud op de opleidingspagina.' }] },
    evidenceIds: [],
    reviewNotes: [],
  });

  it('writes a self-contained page whose script carries the questions, the outcomes, the rule and the tagged link', () => {
    const files = buildQuizFiles({ content, courseName: 'CROV', courseUrl: 'https://example.org/crov', ctaLabel: 'Bekijk de opleiding', campaignId: 'a66652bd-1', isMock: false });
    expect(files['keuzehulp/index.html']).toContain('<div id="quiz"');
    expect(files['keuzehulp/index.html']).toContain('CONCEPT');
    expect(files['keuzehulp/index.html']).toContain('name="robots" content="noindex"');
    const script = files['keuzehulp/widget.js'];
    expect(script).toContain('"signal":"fit"');
    expect(script).toContain('Deze opleiding past bij je situatie');
    expect(script).toContain('utm_source=keuzehulp');
    expect(script).toContain("if (ranked[0].count === ranked[1].count) return 'explore'");
    // Model JSON cannot close the script tag.
    expect(script).not.toContain('</script');
    expect(files['keuzehulp/src/widget.ts']).toBe(script);
    expect(files['keuzehulp/embed.html']).toContain('<iframe');
    expect(files['keuzehulp/style.css'].length).toBeGreaterThan(200);
  });

  it('escapes model text in the page and marks a demo package as such', () => {
    const files = buildQuizFiles({
      content: { ...content, title: 'Titel <script>alert(1)</script>' },
      courseName: 'CROV',
      courseUrl: 'https://example.org/crov',
      ctaLabel: 'Bekijk',
      campaignId: 'x',
      isMock: true,
    });
    expect(files['keuzehulp/index.html']).toContain('Titel &lt;script&gt;');
    expect(files['keuzehulp/index.html']).not.toContain('<script>alert');
    expect(files['keuzehulp/index.html']).toContain('DEMO');
  });

  it('parses an older report without signals and outcomes, and the page then lists the choices', () => {
    const older = campaignPackageContent.parse({
      ...content,
      reflection: content.reflection.map((question) => ({ question: question.question, options: question.options.map(({ label, guidance }) => ({ label, guidance })) })),
      outcomes: undefined,
    });
    expect(older.reflection[0]?.options[0]?.signal).toBe('explore');
    expect(older.outcomes).toBeNull();
    const files = buildQuizFiles({ content: older, courseName: 'CROV', courseUrl: 'https://example.org/crov', ctaLabel: 'Bekijk', campaignId: 'x', isMock: false });
    expect(files['keuzehulp/widget.js']).toContain('"outcomes":null');
    expect(files['keuzehulp/index.html']).toContain('drie herkenbare situaties');
  });
});
