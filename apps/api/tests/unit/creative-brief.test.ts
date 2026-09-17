import { describe, expect, it } from 'vitest';
import { contentProposal, creativeResearchSource } from '@c360/contracts';
import { creativeProblems, repeatedCreativeScenes } from '../../src/modules/content-assets/creative.js';

const personaId = '11111111-1111-4111-8111-111111111111';
const proposal = contentProposal.parse({
  channel: 'linkedin_organic', stage: 'discover', imageHeadline: 'Wie maakt hier de keuze?', imageSubline: null,
  copy: { hook: 'Een professionele afweging', body: 'Een herkenbaar dilemma uit de praktijk.', ctaText: 'Bekijk de mogelijkheden', ctaUrl: null, imageAltText: null, hashtags: [] },
  creativeBrief: {
    mechanism: 'visual_question', audienceInsight: 'De gekozen persona twijfelt over een professionele beslissing.',
    conceptRationale: 'De vraag bij de scène maakt een onderbouwde keuze bespreekbaar.',
    scene: 'Twee handen houden elk een dossier naast dezelfde werktafel.', composition: 'De dossiers rechts; rustige ruimte links voor de vraag.',
    textTreatment: 'editorial', textPosition: 'top_left', brandIntegration: 'Een dossier bevat een accent in de merkkleur.', avoid: [],
    campaignAlignment: 'Dezelfde materiaalbehandeling en professionele afweging blijven herkenbaar.',
    channelRationale: 'Deze professionele afweging past bij de inhoudelijke LinkedIn-rol uit de briefing.',
    personaVersionIds: [personaId], evidenceIds: ['known-source'],
    testHypothesis: 'Vraag echte lezers welke professionele afweging zij herkennen in dit beeld.',
  },
});
const research = { personaVersionIds: [personaId], sources: [creativeResearchSource.parse({
  id: 'known-source', kind: 'persona', title: 'Vastgelegde personabron', sourceRef: 'Interviewnotities', retrievedAt: null,
  excerpt: 'Een interne notitie over afwegingen.', interpretation: 'Perspectief van de geïnterviewde.', status: 'recorded', limitation: 'Geen zelfstandig marktonderzoek.',
})] };

describe('creative brief evidence and channel adaptation', () => {
  it('allows only the supplied personas and source ids, independently of plausible prose', () => {
    expect(creativeProblems(proposal, true, research)).toEqual([]);
    const problems = creativeProblems({ ...proposal, creativeBrief: { ...proposal.creativeBrief!, evidenceIds: ['invented-source'], personaVersionIds: ['22222222-2222-4222-8222-222222222222'] } }, true, research);
    expect(problems.join(' ')).toContain('personaVersionIds');
    expect(problems.join(' ')).toContain('evidenceIds');
  });
  it('does not let platform advice stand in for supplied audience evidence', () => {
    const sources = [...research.sources, { ...research.sources[0]!, id: 'guide', kind: 'channel_guidance' as const }];
    expect(creativeProblems({ ...proposal, creativeBrief: { ...proposal.creativeBrief!, evidenceIds: ['guide'] } }, true, { ...research, sources }).join(' ')).toContain('inhoudelijke bron');
  });
  it('does not require sources when none exist, and leaves text-only content outside the image gate', () => {
    const noSources = { ...proposal, creativeBrief: { ...proposal.creativeBrief!, evidenceIds: [] } };
    expect(creativeProblems(noSources, true, { ...research, sources: [] })).toEqual([]);
    expect(creativeProblems({ ...proposal, creativeBrief: null }, false, research)).toEqual([]);
  });
  it('rejects literal recycled scenes across channels even when headlines differ', () => {
    const second = { ...proposal, channel: 'instagram_organic' as const, imageHeadline: 'Een heel andere vraag' };
    expect(repeatedCreativeScenes([proposal, second])).toHaveLength(1);
    expect(repeatedCreativeScenes([proposal, { ...second, creativeBrief: { ...second.creativeBrief!, scene: 'Een gesloten dossier naast een lege stoel, met één zichtbaar los vel.' } }])).toEqual([]);
  });
});
