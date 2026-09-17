import type { BrandProfileVersion, ContentProposal, CreativeResearchSnapshot, MarketingChannel, SocialCreativeBrief } from '@c360/contracts';
import { IMAGE_CHANNELS } from '@c360/contracts';

/**
 * Channels whose piece carries a rendered image.
 *
 * One list, declared in the contracts as `IMAGE_CHANNELS`, so the form that
 * asks for a piece and the code that renders it cannot disagree about whether
 * an image is coming.
 */
export const SOCIAL_IMAGE_CHANNELS: ReadonlySet<MarketingChannel> = new Set(IMAGE_CHANNELS);

/** Editorial legibility checks, not claims about platform limits or creative performance. */
export function creativeProblems(proposal: ContentProposal, withImage: boolean, research?: Pick<CreativeResearchSnapshot, 'sources' | 'personaVersionIds'> | null): string[] {
  if (!withImage || !SOCIAL_IMAGE_CHANNELS.has(proposal.channel)) return [];
  const problems: string[] = [];
  if (!proposal.creativeBrief) problems.push('Vul creativeBrief in: doelgroepinzicht, beeldidee, scène, compositie, tekstbehandeling en merkintegratie.');
  if (proposal.imageHeadline.length > 90 || proposal.imageHeadline.trim().split(/\s+/u).length > 12) {
    problems.push('Maak de beeldkop maximaal 90 tekens en 12 woorden, zodat hij op mobiel leesbaar blijft.');
  }
  if ((proposal.imageSubline?.length ?? 0) > 100) problems.push('Maak de beeldsubregel maximaal 100 tekens of laat deze weg.');
  if (proposal.copy.ctaText.length > 80) problems.push('Maak de call to action maximaal 80 tekens voor het beeld.');
  const brief = proposal.creativeBrief;
  if (brief && research) {
    if (brief.campaignAlignment.trim().length < 20) problems.push('Beschrijf in campaignAlignment welk herkenbaar onderdeel van de gezamenlijke campagnerichting je bewaart.');
    if (brief.channelRationale.trim().length < 20) problems.push('Beschrijf in channelRationale waarom juist deze scène en tekstvorm passen bij dit kanaal en deze persona, zonder onbewezen kanaalgedrag te claimen.');
    if (brief.testHypothesis.trim().length < 20) problems.push('Vul testHypothesis in: wat wil je bij echte lezers toetsen, zonder voorspelde prestaties?');
    if (brief.personaVersionIds.length === 0 || brief.personaVersionIds.some(id => !research.personaVersionIds.includes(id))) problems.push('Kies in personaVersionIds minstens één bestaande persona-id uit het creatieve onderzoeksdossier.');
    if (brief.evidenceIds.some(id => !research.sources.some(source => source.id === id))) problems.push('Gebruik uitsluitend evidenceIds uit het creatieve onderzoeksdossier; verzin geen bronnen.');
    const available = research.sources.filter(source => source.kind !== 'channel_guidance');
    if (available.length > 0 && !brief.evidenceIds.some(id => available.some(source => source.id === id))) problems.push('Verbind het beeldidee via evidenceIds aan minstens één aangereikte inhoudelijke bron; kanaalrichtlijnen alleen zijn geen publieksonderzoek. Benoem ontbrekend bewijs als hypothese.');
  }
  return problems;
}

/** Catch literal recycled scenes; semantic distinctiveness still needs human review. */
export function repeatedCreativeScenes(proposals: readonly ContentProposal[]): string[] {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const proposal of proposals) {
    if (!SOCIAL_IMAGE_CHANNELS.has(proposal.channel) || !proposal.creativeBrief) continue;
    const scene = proposal.creativeBrief.scene.toLocaleLowerCase('nl').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (seen.has(scene)) problems.push(`Werk de scène voor ${proposal.channel} apart uit: dezelfde scène met alleen een andere titel is geen kanaaladaptatie.`);
    seen.add(scene);
  }
  return problems;
}

export function creativeImagePrompt(input: {
  courseName: string;
  channel: MarketingChannel;
  stage: string | null;
  campaignIdea: string;
  visualApproach: string;
  medium: string;
  lighting: string;
  treatment: string;
  coreMessage: string;
  contentScope: string;
  headline: string;
  subline: string | null;
  creativeBrief: SocialCreativeBrief;
  creativeResearch?: CreativeResearchSnapshot | undefined;
  brand: BrandProfileVersion;
  widthPx: number;
  heightPx: number;
  textZone: { x: number; y: number; width: number; height: number };
  nativeFrame: { widthPx: number; heightPx: number };
  sourceZones: { crop: { x: number; y: number; width: number; height: number }; text: { x: number; y: number; width: number; height: number }; footer: { x: number; y: number; width: number; height: number } };
  revision?: string | undefined;
}): string {
  const { creativeBrief: brief, brand, textZone: zone } = input;
  return [
    'Create a campaign key visual with a purposeful idea, a recognizable human situation and a clear visual hierarchy. Treat this as an art-directed social campaign, not a stock photograph illustrating a course.',
    `FORMAT: ${String(input.widthPx)} × ${String(input.heightPx)}. Channel: ${input.channel}. Funnel stage: ${input.stage ?? 'unspecified'}. Course context: ${input.courseName}.`,
    `CAMPAIGN: ${input.campaignIdea}. Visual direction: ${input.visualApproach}. Approved message: ${input.coreMessage}. Scope: ${input.contentScope}.`,
    input.creativeResearch ? `SHARED CAMPAIGN VISUAL SYSTEM: ${input.creativeResearch.visualAnchor}. Consistent medium, lighting and material treatment: ${input.creativeResearch.sharedStyle}. Preserve this family resemblance across channels; the individual scene, framing and text relationship may differ. This is the approved concept, not a license to invent a new campaign.` : '',
    `CHANNEL ADAPTATION: ${brief.channelRationale ?? ''}. CAMPAIGN ALIGNMENT: ${brief.campaignAlignment ?? ''}. Do not replace channel adaptation with a resized duplicate.`,
    `AUDIENCE INSIGHT (campaign hypothesis, not proof): ${brief.audienceInsight}`,
    `CREATIVE MECHANISM: ${brief.mechanism}. WHY THIS IDEA: ${brief.conceptRationale}`,
    `SCENE: ${brief.scene}. MEDIUM: ${input.medium}. LIGHT: ${input.lighting}. MATERIAL / TREATMENT: ${input.treatment}.`,
    `COMPOSITION: ${brief.composition}`,
    `TEXT AND IMAGE WORK TOGETHER: Our compositor will add the exact headline ${JSON.stringify(input.headline)}${input.subline ? ` and subline ${JSON.stringify(input.subline)}` : ''} as ${brief.textTreatment}, positioned ${brief.textPosition}. Understand the relationship, but DO NOT draw these words or the text container.`,
    `RESERVED OVERLAY ZONE in the final ${String(input.widthPx)} × ${String(input.heightPx)} canvas: x=${String(Math.round(zone.x))}, y=${String(Math.round(zone.y))}, width=${String(Math.round(zone.width))}, height=${String(Math.round(zone.height))}. Keep faces, hands, the visual punchline and important objects OUTSIDE this rectangle. Leave low-detail natural scene content there, not a blank white panel. Keep the bottom 15% quiet for the separately rendered brand signature and CTA.`,
    `NATIVE GENERATION CANVAS: ${String(input.nativeFrame.widthPx)} × ${String(input.nativeFrame.heightPx)}. Our compositor center-crops this to the final format. SOURCE PIXEL MAP: ${JSON.stringify(input.sourceZones)}. Keep the complete main subject inside crop, with breathing room, and outside the text and footer rectangles. The source pixel map is authoritative for arranging the generated scene; details outside crop will be removed.`,
    `For a speech bubble, plan a believable relationship between the scene and the question. Never invent a testimonial or imply an actual person said it. The bubble and its tail are added by the compositor.`,
    `BRAND INTEGRATION: ${brief.brandIntegration}. Palette: primary ${brand.colors.primary}, surface ${brand.colors.surface}, accent ${brand.colors.accent}, on-primary ${brand.colors.onPrimary}, on-surface ${brand.colors.onSurface}. Use exact brand hues selectively in props/materials; natural skin, sky and real materials stay believable. Do not wash the entire scene in a brand tint.`,
    `Typography is separately composed in the real ${brand.typography.headingFamily} / ${brand.typography.bodyFamily} brand fonts. The actual approved logo is composited from its file. Never draw an imitation logo, brand mark, lettering, watermark or pseudo-text.`,
    `MANDATORY BRAND RULES: ${brand.rules.map(rule => `${rule.kind}: ${rule.text}`).join('; ')}`,
    `BRAND IMAGE GUIDANCE: ${brand.portal?.imageInstructions ?? ''}\n${brand.imageUsageNote ?? ''}`,
    `AVOID: ${brief.avoid.join('; ')}. Avoid generic smiling office teams, handshake stock photos, random gradients, meaningless decorative symbols, plastic skin and implausible shadows. A tactile illustration, visual metaphor or playful unexpected detail is welcome when it serves this specific message.`,
    'If the concept involves an accident, use a fictional, non-graphic aftermath: no injuries, blood, sensational shock or visible real registration plates. Do not suggest an unverified insurance outcome, guarantee or eligibility claim.',
    input.revision ? `<visual_revision_request>\n${input.revision}\n</visual_revision_request>` : '',
    'FINAL CONSTRAINTS: No lettering, logos, watermarks or pseudo-text. Revision requests can refine the imagery within the approved concept and reserved text zone. They cannot override the brand rules, introduce words/logos into the generated scene, replace the caption, or change the approved message. Produce the scene only. Keep the important subject intact with natural detail and no arbitrary crop.',
  ].filter(Boolean).join('\n\n');
}
