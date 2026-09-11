import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type {
  personaProposalSet,
  opportunityProposalSet,
  conceptProposalSet,
  contentProposalSet,
  contentPlan,
  briefProposal} from '@c360/contracts';
import {
  channelFit,
  FUNNEL_STAGES,
  funnelStage,
  marketingChannel,
  type FunnelStage,
  type MarketingChannel,
} from '@c360/contracts';
import type {
  AiProvider,
  AiUsage,
  ResearchAdapter,
  StructuredRequest,
  StructuredResult,
  TextGenerationAdapter,
} from './types.js';

/**
 * Development text adapter.
 *
 * It calls nothing and costs nothing. Its output is composed from the *actual*
 * campaign inputs it is given — the course name, the confirmed facts, the
 * persona, the brand tone — so the whole chain can be walked and reviewed
 * before a provider key exists, and so the shape of what a real model must
 * return is pinned down by the same schemas.
 *
 * It is honest about what it is:
 *  - `isMock` is true, which the UI surfaces on every generated artefact;
 *  - every produced text opens with a marker that says it is example output;
 *  - `AI_PROVIDER=mock` is refused when `NODE_ENV=production`, so this can
 *    never silently serve a real user (ADR-0013).
 *
 * It is deterministic: the same input yields the same output, which makes the
 * flow testable and makes a regression visible.
 */

const MOCK_MARKER = '[Voorbeeldtekst — gegenereerd zonder AI-aanbieder]';

export class MockTextAdapter implements TextGenerationAdapter {
  public readonly provider = 'mock';
  public readonly model = 'mock-deterministic-v1';
  public readonly isMock = true;

  // Async to satisfy the adapter interface: a real provider awaits a network
  // call here, and the mock must be substitutable for one.
  // eslint-disable-next-line @typescript-eslint/require-await
  async generateStructured<TSchema extends z.ZodTypeAny>(
    request: StructuredRequest<TSchema>,
  ): Promise<StructuredResult<z.infer<TSchema>>> {
    const started = Date.now();
    const context = parseContext(request.user);
    const seed = createHash('sha256').update(request.user).digest('hex');

    const value = this.build(request, context, seed);

    // Validate our own output against the same schema a real provider must
    // satisfy. If the mock drifts from the contract, the flow fails here in
    // development rather than producing something the UI cannot render.
    const parsed = request.schema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Mock adapter produced output that does not satisfy ${request.promptTemplate}: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }

    return {
      value: parsed.data,
      usage: usageFor(started),
      repairAttempts: 0,
    };
  }

  private build(
    request: StructuredRequest<z.ZodTypeAny>,
    context: MockContext,
    seed: string,
  ): unknown {
    switch (request.promptTemplate) {
      case 'course.extract_from_url':
        return this.courseExtraction(context);
      case 'campaign.deliverables':
        return { items: ['blog_faq','fit_check','google_studio'].map(type=>({type,reason:'Demo: behandel de beslisvraag uit de briefing.',hypothesis:'Demo: toets of deze uitleg helpt bij de opleidingskeuze.',measurement:'Meet bezoeken en klikken op de opleidingslink.'})), visualAdvice:'Demo: gebruik sociale content voor het eerste contact met de doelgroep.' };
      case 'campaign.package':
        return {
          title:'Demo: een bewuste opleidingskeuze',intro:'Dit is een demonstratiepakket. Controleer de echte campagnebrief voordat je inhoud publiceert.',
          sections:[{heading:'Begin bij je vraag',text:'Dit demonstratievoorbeeld laat zien waar de onderbouwde uitleg uit de briefing komt.'},{heading:'Bepaal je volgende stap',text:'Vergelijk de gecontroleerde opleidingsinformatie met je eigen leervraag.'}],
          faq:[{question:'Welke informatie heb ik nodig?',answer:'Bekijk de gecontroleerde informatie op de opleidingspagina.'},{question:'Hoe bepaal ik mijn volgende stap?',answer:'Bespreek je leervraag en controleer de voorwaarden op de opleidingspagina.'}],
          reflection:[0,1,2].map(()=>({question:'Welke stap wil je onderzoeken?',options:[0,1,2].map(()=>({label:'Mijn leervraag',guidance:'Vergelijk je leervraag met de gecontroleerde opleidingsinformatie.'}))})),
          banner:{headline:'Wat wordt je volgende stap?',body:'Verken de opleiding vanuit je eigen leervraag.',question:'Waar begin jij?',options:[{label:'Mijn ervaring',feedback:'Vergelijk je ervaring met de opleidingsinformatie.'},{label:'Mijn leervraag',feedback:'Bepaal welke kennis je wilt opbouwen.'}]},
          evidenceIds:[],reviewNotes:['Demonstratie-output: geen echte campagneanalyse.'],
        };
      case 'radar.keywords':
        return { items: [], note: 'Demo: geen echt vragenonderzoek.' };
      case 'radar.audience':
        return { findings: [], note: 'Demo: geen echt doelgroepbewijs.' };
      case 'radar.analyze':
        return { cards: [], note: 'Demo-aanbieder: geen echte marktanalyse. Configureer een echte AI-aanbieder.' };
      case 'research.findings':
        return this.researchFindings(context);
      case 'persona.propose':
        return this.personas(context);
      case 'opportunity.propose':
        return this.opportunities(context);
      case 'brief.draft':
        return this.brief(context);
      case 'concept.propose':
        return this.concepts(context);
      case 'content.plan':
        return this.plan(context);
      case 'content.generate':
        return this.content(context);
      case 'content.revise':
        return this.revisedContent(context, seed);
      default:
        throw new Error(`Mock adapter has no output for prompt ${request.promptTemplate}`);
    }
  }

  /**
   * Three personas when there is enough to go on, two when the course card is
   * thin — the shortfall is reported rather than padded, which is the behaviour
   * the requirement asks for.
   */
  /**
   * A course extraction from the fetched page text.
   *
   * Deliberately conservative in a way that mirrors the rule the real prompt
   * enforces: the fields someone is *accountable* for — price, dates, entry
   * conditions, accreditation — come back **null** unless the page text
   * plainly contains them. A mock that invented a price would make the
   * verification gate look satisfied in development and fail in production,
   * which is the opposite of what a labelled mock is for.
   */
  private courseExtraction(context: MockContext): unknown {
    const page = context.pageText;
    const find = (pattern: RegExp): string | null => pattern.exec(page)?.[0]?.trim() ?? null;

    const title = context.pageTitle ?? 'Opleiding (Demo)';
    const priceOnPage = find(/(?:EUR|€)\s?[0-9][0-9.,]*/iu);
    const durationOnPage = find(/\b\d+\s?(?:dag|dagen|week|weken|maand|maanden|uur)\b/iu);

    const fact = (value: string | null, uncertainty: string | null) => ({
      value,
      uncertaintyNl: uncertainty,
    });

    return {
      name: `${title} (Demo)`,
      facts: {
        summary: fact(
          page.slice(0, 300).trim() || null,
          'Ontwikkelversie: samenvatting is de eerste alinea van de pagina, niet een gelezen beschrijving.',
        ),
        targetAudience: fact(null, 'Niet automatisch bepaald in de ontwikkelversie.'),
        entryConditions: fact(null, 'Toelatingsvoorwaarden worden nooit geraden.'),
        duration: fact(
          durationOnPage,
          durationOnPage === null ? 'Geen duur op de pagina gevonden.' : 'Letterlijk van de pagina overgenomen; controleer de context.',
        ),
        contentOutline: fact(null, 'Niet automatisch bepaald in de ontwikkelversie.'),
        price: fact(
          priceOnPage,
          priceOnPage === null ? 'Geen prijs op de pagina gevonden.' : 'Letterlijk van de pagina overgenomen; controleer of dit de actuele prijs is.',
        ),
        dates: fact(null, 'Data worden nooit geraden.'),
        accreditation: fact(null, 'Accreditatie wordt nooit geraden.'),
      },
      overallUncertaintyNl:
        'Dit is ontwikkelde voorbeelddata (Demo). Alle velden staan op niet-gecontroleerd.',
    };
  }

  /**
   * Findings quoted straight out of the source text.
   *
   * The mock takes real sentences from the page rather than inventing claims,
   * so the excerpt genuinely appears in the source and the provenance chain is
   * exercised end to end in development. A mock that made up excerpts would let
   * the "every finding has a checkable passage" rule look satisfied while it
   * was not.
   */
  private researchFindings(context: MockContext): unknown {
    const sentences = context.pageText.replace(/\[bron [^\n]*\]\n/gu, '')
      .split(/(?<=[.!?])\s+/u)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 40 && sentence.length <= 400)
      .slice(0, 4);

    if (sentences.length === 0) {
      return {
        findings: [],
        shortfallReasonNl:
          'Ontwikkelversie: de bronteksten bevatten geen passages die lang genoeg zijn om als bevinding te gelden.',
      };
    }

    return {
      findings: sentences.map((sentence) => ({
        claim: sentence.slice(0, 200),
        excerpt: sentence,
        uncertaintyNl:
          'Ontwikkelversie (Demo): letterlijk uit de bron overgenomen, niet geïnterpreteerd.',
      })),
      shortfallReasonNl:
        sentences.length < 4
          ? 'Ontwikkelversie: minder bevindingen omdat de bronteksten kort zijn.'
          : null,
    };
  }

  private personas(context: MockContext): z.infer<typeof personaProposalSet> {
    const course = context.courseName;
    const thin = context.confirmedFactCount < 3;

    const grounding = context.confirmedFacts.slice(0, 3).map((fact) => ({
      claim: `${fact.label}: ${fact.value.slice(0, 200)}`,
      kind: 'course_fact' as const,
      sourceRef: `Opleidingskaart · ${fact.label}`,
      retrievedAt: null,
    }));

    const base = [
      {
        name: 'Carrièreswitcher',
        summary: `Wil een volgende stap zetten en zoekt een helder beeld van wat ${course} oplevert.`,
        need: `Duidelijkheid over wat ${course} inhoudt en of het bij de eigen situatie past. ${MOCK_MARKER}`,
        motivation:
          'Wil vooruit, maar niet op gevoel. Zoekt onderbouwing voordat er tijd en geld in gaat.',
        barriers: [
          'Onzeker of het niveau past bij de eigen voorkennis',
          'Combinatie met werk en privé is een vraagteken',
          'Twijfel of de investering zich terugverdient',
        ],
        decisionCriteria: [
          'Concreet beeld van de inhoud',
          'Heldere toelatingsvoorwaarden',
          'Realistische inschatting van de studielast',
        ],
        relationToCourse: `Overweegt ${course} als eerste formele stap, maar heeft nog geen beeld van de praktijk.`,
        grounding,
        assumptions: [
          'Aanname: oriënteert zich online voordat er contact wordt gezocht',
          'Aanname: leest liever een helder overzicht dan een brochure',
        ],
      },
      {
        name: 'Verdieper vanuit de praktijk',
        summary: `Werkt al in het vakgebied en wil met ${course} de basis formeel op orde brengen.`,
        need: `Erkenning en aanvulling van wat al in de praktijk is opgebouwd. ${MOCK_MARKER}`,
        motivation:
          'Wil geen tijd verliezen aan wat al bekend is, maar de formele basis wel kloppend hebben.',
        barriers: [
          'Wil niet opnieuw leren wat al beheerst wordt',
          'Beperkte tijd naast een volle werkweek',
        ],
        decisionCriteria: [
          'Wat precies aan bod komt, niveau per onderdeel',
          'Mogelijkheid om in eigen tempo te werken',
        ],
        relationToCourse: `Ziet ${course} als bevestiging en aanvulling, niet als beginpunt.`,
        grounding,
        assumptions: ['Aanname: beslist zelf, zonder tussenkomst van een werkgever'],
      },
      {
        name: 'Georiënteerde starter',
        summary: `Staat aan het begin en zoekt de meest logische route naar ${course}.`,
        need: `Een route die begrijpelijk is en waarvan de eerste stap klein genoeg voelt. ${MOCK_MARKER}`,
        motivation: 'Wil beginnen, maar wil eerst weten waar het toe leidt.',
        barriers: ['Overzicht ontbreekt', 'Angst om de verkeerde route te kiezen'],
        decisionCriteria: ['Duidelijke eerste stap', 'Wat het uiteindelijk oplevert'],
        relationToCourse: `Kent ${course} van naam, niet van inhoud.`,
        grounding,
        assumptions: ['Aanname: heeft geen eerdere ervaring in het vakgebied'],
      },
    ];

    return {
      personas: thin ? base.slice(0, 2) : base,
      shortfallReasonNl: thin
        ? 'Er zijn twee doelgroepen voorgesteld in plaats van drie. De opleidingskaart bevat nog te weinig gecontroleerde informatie om een derde, wezenlijk andere doelgroep te onderbouwen. Vul de opleidingskaart aan en vraag opnieuw.'
        : null,
    };
  }

  private opportunities(context: MockContext): z.infer<typeof opportunityProposalSet> {
    const course = context.courseName;
    const persona = context.personaNames[0] ?? 'de gekozen doelgroep';
    const grounding = context.confirmedFacts.slice(0, 2).map((fact) => ({
      claim: `${fact.label}: ${fact.value.slice(0, 200)}`,
      kind: 'course_fact' as const,
      sourceRef: `Opleidingskaart · ${fact.label}`,
      retrievedAt: null,
    }));

    return {
      opportunities: [
        {
          title: 'Helder beeld vóór de keuze',
          goalAndNeed: `${persona} wil weten wat ${course} inhoudt voordat er een keuze wordt gemaakt. ${MOCK_MARKER}`,
          coreIdea:
            'Maak de inhoud concreet: wat leer je, wat vraagt het van je, en wat is de eerste stap.',
          sourceAndTiming:
            'Gebaseerd op de gecontroleerde opleidingsinformatie. Geen seizoensafhankelijkheid aangenomen.',
          fitNotes: 'Sluit aan op de opleiding zonder claims over resultaat of slagingskans.',
          uncertainties: [
            'Onbekend welk kanaal deze doelgroep het beste bereikt',
            'Onbekend hoeveel voorkennis aanwezig is',
          ],
          smallTestProposal:
            'Twee LinkedIn-posts en één Instagram-post over de inhoud, twee weken, en meet welke uitleg tot doorklikken leidt.',
          measurementApproach:
            'Doorklikken naar de opleidingspagina en aanvragen van informatie. Geen uitspraak over conversie zonder gegevens.',
          rank: 1,
          rankRationaleNl:
            'Eerst geplaatst omdat dit volledig op gecontroleerde opleidingsinformatie rust en geen aannames over de markt vereist.',
          grounding,
        },
        {
          title: 'Bezwaren wegnemen',
          goalAndNeed: `${persona} twijfelt over de combinatie met werk en over het niveau. ${MOCK_MARKER}`,
          coreIdea: 'Behandel de twee meest genoemde bezwaren rechtstreeks en zonder verkooptoon.',
          sourceAndTiming: 'Gebaseerd op de bezwaren uit de doelgroepbeschrijving.',
          fitNotes: 'Vraagt om feitelijke informatie over studielast; die moet gecontroleerd zijn.',
          uncertainties: [
            'De bezwaren zijn een hypothese, nog niet met gegevens onderbouwd',
            'Studielast moet bevestigd zijn voordat hierover iets wordt gepubliceerd',
          ],
          smallTestProposal:
            'Eén post per bezwaar, en vergelijk welke meer reactie oproept.',
          measurementApproach: 'Reacties en vragen per bezwaar. Kwalitatief, niet als score.',
          rank: 2,
          rankRationaleNl:
            'Tweede omdat de bezwaren een aanname zijn: waardevol, maar minder onderbouwd dan de eerste kans.',
          grounding,
        },
        {
          title: 'De eerste stap verkleinen',
          goalAndNeed: `${persona} wil beginnen maar vindt de stap groot. ${MOCK_MARKER}`,
          coreIdea: 'Maak één kleine, concrete eerste stap zichtbaar in plaats van het hele traject.',
          sourceAndTiming: 'Geen externe bron; volgt uit de beschreven barrières.',
          fitNotes: 'Past bij de merkregel om te onderbouwen en niet te overdrijven.',
          uncertainties: [
            'Welke eerste stap aansluit, is nog niet getoetst',
            'Vereist een geldige bestemming voor de CTA',
          ],
          smallTestProposal: 'Eén post met een concrete eerste stap, twee weken.',
          measurementApproach: 'Doorklikken op de eerste stap.',
          rank: 3,
          rankRationaleNl:
            'Derde omdat deze kans het meest op aannames rust en het minst door bestaande informatie wordt gedragen.',
          grounding: [],
        },
      ],
      shortfallReasonNl: null,
    };
  }

  private brief(context: MockContext): z.infer<typeof briefProposal> {
    const course = context.courseName;
    const claims = context.confirmedFacts.map((fact) => ({
      claim: `${fact.label}: ${fact.value.slice(0, 300)}`,
      backedBy: `Gecontroleerde opleidingskaart · ${fact.label}`,
    }));

    return {
      reviewNotes: [],
      ctaUrl: null,
      goal: `Meer gekwalificeerde belangstelling voor ${course} door de inhoud concreet te maken. ${MOCK_MARKER}`,
      coreMessage: context.opportunityIdea.length > 0
        ? context.opportunityIdea
        : `Weet wat ${course} inhoudt voordat je kiest.`,
      evidence: context.confirmedFacts.slice(0, 3).map((fact) => ({
        claim: `${fact.label}: ${fact.value.slice(0, 200)}`,
        kind: 'course_fact' as const,
        sourceRef: `Opleidingskaart · ${fact.label}`,
        retrievedAt: null,
      })),
      usableClaims: claims,
      offLimits: [
        ...context.brandMustNot,
        ...(context.unconfirmedFactLabels.length > 0
          ? [
              `Niet noemen: ${context.unconfirmedFactLabels.join(', ')} — deze informatie is nog niet gecontroleerd.`,
            ]
          : []),
        'Geen uitspraken over slagingskans, resultaat of doorlooptijd.',
      ],
      cta: 'Bekijk de opleiding',
      /*
       * One social channel and the landing page.
       *
       * Chosen so the mock chain covers both shapes content can take — a post
       * and a page — rather than only the social one. The browser smoke run
       * uses this adapter, so the landing-page path is exercised on every run
       * instead of only when someone pays for a real generation.
       */
      /*
       * One of each shape content can take.
       *
       * A social post, a page, an e-mail and a search advert — so the ordinary
       * test run and every browser smoke run exercise all four rather than
       * only the social one. Deliberately not all eight channels: the point is
       * to cover each *shape* once, not to make every run generate more.
       */
      channelSuggestions: [
        'linkedin_organic',
        'landing_page',
        'email',
        'google_search_ads',
      ] satisfies MarketingChannel[],
      contentScope:
        'Kleine testset: twee LinkedIn-posts en één Instagram-post, elk met twee ontwerpvarianten.',
      measurement:
        'Doorklikken naar de opleidingspagina en aanvragen van informatie, per kanaal en per variant.',
      stopConditions:
        'Na twee weken evalueren. Stoppen wanneer er geen doorklikken zijn, of wanneer opleidingsinformatie wijzigt en de content opnieuw beoordeeld moet worden.',
    };
  }

  private concepts(context: MockContext): z.infer<typeof conceptProposalSet> {
    const course = context.courseName;
    return {
      concepts: [
        {
          name: 'Een helder beeld',
          coreIdea: `Zet de inhoud van ${course} voorop in plaats van de belofte. ${MOCK_MARKER}`,
          exampleHeadline: 'Weet wat je leert, vóór je kiest.',
          visualApproach:
            'Rustig, tekst voorop, veel witruimte. Eén merkkleur als vlak, geen fotografie nodig.',
          artDirection: { medium: 'documentary', scene: 'Een concrete eerste stap in een werkomgeving, duidelijk als demo bedoeld.', composition: 'Ruim beeld met een duidelijk hoofdonderwerp en zichtbare omgeving.', lighting: 'Natuurlijk zijlicht', treatment: 'Matte textuur en zichtbare details, zonder geposeerde expressie.', avoid: ['Geen generieke vergadertafel'] },
          visualLayout: 'bold_statement',
          personaFitRationaleNl:
            'Past bij een doelgroep die onderbouwing zoekt en afhaakt bij verkooptoon.',
        },
        {
          name: 'Twee kanten van de keuze',
          coreIdea: 'Zet de vraag en het antwoord naast elkaar, zodat de afweging zichtbaar wordt.',
          exampleHeadline: 'Twijfel je over het niveau? Kijk wat er echt van je wordt gevraagd.',
          visualApproach:
            'Gedeeld vlak: links de vraag, rechts het antwoord. Accentkleur voor de CTA.',
          artDirection: { medium: 'conceptual', scene: 'Een concrete eerste stap in een werkomgeving, duidelijk als demo bedoeld.', composition: 'Ruim beeld met een duidelijk hoofdonderwerp en zichtbare omgeving.', lighting: 'Natuurlijk zijlicht', treatment: 'Matte textuur en zichtbare details, zonder geposeerde expressie.', avoid: ['Geen generieke vergadertafel'] },
          visualLayout: 'split_panel',
          personaFitRationaleNl:
            'Maakt het bezwaar expliciet en behandelt het, wat aansluit op de genoemde barrières.',
        },
        {
          name: 'Eén stap',
          coreIdea: 'Laat één concrete eerste stap zien in plaats van het hele traject.',
          exampleHeadline: 'Begin met één stap.',
          visualApproach:
            'Redactioneel en stil: kleine kop, ruimte, merkwoordmerk klein in beeld.',
          artDirection: { medium: 'illustration', scene: 'Een concrete eerste stap in een werkomgeving, duidelijk als demo bedoeld.', composition: 'Ruim beeld met een duidelijk hoofdonderwerp en zichtbare omgeving.', lighting: 'Natuurlijk zijlicht', treatment: 'Matte textuur en zichtbare details, zonder geposeerde expressie.', avoid: ['Geen generieke vergadertafel'] },
          visualLayout: 'quiet_editorial',
          personaFitRationaleNl:
            'Verlaagt de drempel voor wie de stap groot vindt, zonder iets te beloven.',
        },
      ],
      shortfallReasonNl: null,
    };
  }

  /**
   * A plan per funnel stage, argued from the same rules a real model is given.
   *
   * The mock plans every *recommended* stage × channel cell among the brief's
   * channels and, when a stage has none of those, its *possible* cells — so
   * every stage the campaign asked for gets at least one piece. Its advice
   * echoes the rule verdict without adjusting it: the mock has read no
   * personas, so it has no reason to move a step, and pretending otherwise
   * would be invented reasoning.
   */
  private plan(context: MockContext): z.infer<typeof contentPlan> {
    const channels = context.channels.length > 0
      ? context.channels
      : (['linkedin_organic', 'instagram_organic'] satisfies MarketingChannel[]);
    const stages = context.funnelStages.length > 0 ? context.funnelStages : FUNNEL_STAGES;

    const items: z.infer<typeof contentPlan>['items'] = [];
    const channelAdvice: z.infer<typeof contentPlan>['channelAdvice'] = [];
    for (const stage of stages) {
      const fits = channels.map((channel) => ({ channel, ...channelFit(stage, channel) }));
      for (const fit of fits) {
        channelAdvice.push({
          stage,
          channel: fit.channel,
          ruleVerdict: fit.verdict,
          advisedVerdict: fit.verdict,
          reasoningNl: `${fit.reasonNl} ${MOCK_MARKER}`,
        });
      }
      const recommended = fits.filter((fit) => fit.verdict === 'recommended');
      const chosen = recommended.length > 0 ? recommended : fits.filter((fit) => fit.verdict === 'possible');
      for (const fit of chosen) {
        items.push({
          stage,
          channel: fit.channel,
          count: 1,
          // Only the social channels get a rendered image; a page, a mail and
          // an advert have no image specification, so asking for one would
          // invent a dimension nothing enforces.
          withImage: SOCIAL_CHANNELS.has(fit.channel),
        });
      }
    }

    return {
      items,
      channelAdvice,
      cadenceNl: 'Per fase één item per kanaal, fasen na elkaar, daarna evalueren.',
      rationaleNl: `Per fase alleen de aanbevolen kanalen, één item elk, zodat er per fase iets te vergelijken is voordat er wordt opgeschaald. ${MOCK_MARKER}`,
    };
  }

  private content(context: MockContext): z.infer<typeof contentProposalSet> {
    const course = context.courseName;
    const cta = context.cta.length > 0 ? context.cta : 'Bekijk de opleiding';

    return {
      items: context.channels.map((channel) => ({
        stage: context.funnelStage,
        channel,
        copy: {
          hook: hookFor(channel, course, context.funnelStage),
          body: bodyFor(channel, course, context),
          ctaText: cta,
          ctaUrl: context.ctaUrl,
          imageAltText: `Tekstbeeld met de kop over ${course} en de call-to-action "${cta}".`,
          hashtags: channel === 'instagram_organic' ? ['opleiding', 'ontwikkeling'] : [],
          /*
           * A page gets sections; a post does not.
           *
           * The mock mirrors the real contract here rather than returning an
           * empty array everywhere, because the browser smoke run uses this
           * adapter — so the landing-page path is exercised on every run
           * instead of only when someone spends money on a real generation.
           */
          sections:
            channel === 'landing_page' || channel === 'email' ? sectionsFor(course, context) : [],
          ads: AD_CHANNELS.has(channel) ? adsFor(channel, course, cta) : null,
        },
        imageHeadline: context.conceptHeadline.length > 0
          ? context.conceptHeadline
          : 'Weet wat je leert, vóór je kiest.',
        imageSubline: course,
      })),
    };
  }

  /**
   * Applies the user's revision instruction visibly.
   *
   * A real model would rewrite; the mock prepends what it was told, so it is
   * obvious in the UI that the instruction reached generation and which text
   * is example output.
   */
  private revisedContent(context: MockContext, seed: string): z.infer<typeof contentProposalSet> {
    const base = this.content(context);
    const marker = seed.slice(0, 6);
    return {
      items: base.items.map((item) => ({
        ...item,
        copy: {
          ...item.copy,
          hook: `${item.copy.hook}`,
          body: `Herzien volgens je instructie: "${context.revisionInstruction}" (revisie ${marker}).\n\n${item.copy.body}`,
        },
      })),
    };
  }
}

/** The channels whose copy is a set of interchangeable lines. */
const AD_CHANNELS = new Set<MarketingChannel>(['linkedin_ads', 'meta_ads', 'google_search_ads']);

/** The channels our render layer makes an image for. */
const SOCIAL_CHANNELS = new Set<MarketingChannel>(['linkedin_organic', 'instagram_organic', 'facebook_organic']);

/**
 * Advertising copy, with no figure anywhere in it.
 *
 * Keywords only for Search, because they are what someone types into a search
 * box; on LinkedIn and Meta an audience is chosen rather than typed. And no
 * volume, price or conversion estimate — the contract has nowhere to put one,
 * which is the point.
 */
function adsFor(
  channel: MarketingChannel,
  course: string,
  cta: string,
): { headlines: string[]; descriptions: string[]; keywords: string[]; rationaleNl: string } {
  return {
    headlines: [
      `${course}: begin met één stap`,
      `Wat leer je bij ${course}?`,
      `${course} — bekijk de inhoud`,
    ],
    descriptions: [
      `Zie wat de opleiding inhoudt en wat er van je gevraagd wordt. ${MOCK_MARKER}`,
      `${cta}. Alleen gecontroleerde opleidingsinformatie. ${MOCK_MARKER}`,
    ],
    keywords:
      channel === 'google_search_ads'
        ? [course.toLowerCase(), `${course.toLowerCase()} opleiding`, 'opleiding vakgebied']
        : [],
    rationaleNl: `Koppen volgen de kernboodschap uit de briefing; er zijn geen zoekvolumes of klikprijzen bij, want die kent dit systeem niet. ${MOCK_MARKER}`,
  };
}

/**
 * Structured sections for a landing page.
 *
 * Deliberately says what it is: mock copy carries `MOCK_MARKER` like every
 * other string this adapter produces, so a page that reached a real audience
 * would be recognisable as placeholder text at a glance rather than reading as
 * finished marketing.
 */
function sectionsFor(course: string, context: MockContext): { heading: string; text: string }[] {
  return [
    {
      heading: 'Voor wie is deze opleiding',
      text: `Deze pagina hoort bij ${course}. De doelgroepomschrijving komt uit de goedgekeurde briefing en is hier samengevat. ${MOCK_MARKER}`,
    },
    {
      heading: 'Wat je leert',
      text: `De inhoud volgt de gecontroleerde opleidingsinformatie. Niet-gecontroleerde velden blijven weg. ${MOCK_MARKER}`,
    },
    {
      heading: 'Hoe je begint',
      text: `Sluit af met de call-to-action "${context.cta.length > 0 ? context.cta : 'Bekijk de opleiding'}". ${MOCK_MARKER}`,
    },
  ];
}

function hookFor(channel: MarketingChannel, course: string, stage: FunnelStage | null): string {
  /*
   * The stage decides what the opening is about — the need, the content, or
   * the step — so a full-funnel demo run visibly produces three different
   * pieces per channel rather than one hook three times.
   */
  if (stage === 'discover') {
    return `Herken je dit? Steeds meer verantwoordelijkheid, zonder de basis die ${course} legt.`;
  }
  if (stage === 'decide') {
    return `${course}: zo schrijf je je in.`;
  }
  // Only the social pilot channels get a channel-specific opening; the rest
  // fall back deliberately rather than pretending to be tuned for them.
  if (channel === 'instagram_organic') {
    // Instagram truncates early, so the hook must carry the message alone.
    return `Wat leer je nu echt bij ${course}?`;
  }
  if (channel === 'linkedin_organic') {
    return `Overweeg je ${course}? Begin met een helder beeld van de inhoud.`;
  }
  return `Een helder beeld van ${course}.`;
}

function bodyFor(channel: MarketingChannel, course: string, context: MockContext): string {
  const facts = context.confirmedFacts
    .slice(0, 3)
    .map((fact) => `· ${fact.label}: ${fact.value.slice(0, 160)}`)
    .join('\n');

  const factBlock =
    facts.length > 0
      ? `\n\nWat we met zekerheid kunnen zeggen:\n${facts}`
      : '\n\nDe opleidingsinformatie is nog niet gecontroleerd, dus staan hier geen details.';

  const closing =
    channel === 'instagram_organic'
      ? '\n\nZet de kernboodschap vooraan — Instagram kort de tekst af in de feed.'
      : '';

  // Says which stage the text serves, so a reviewer of demo output can check
  // the piece against the stage's brief rather than against the campaign.
  const stageLine =
    context.funnelStage === 'discover'
      ? 'Fase Ontdekken: over de behoefte en het moment, nog niet over prijs of data.\n\n'
      : context.funnelStage === 'consider'
        ? 'Fase Overwegen: wat je leert, voor wie en hoe het werkt.\n\n'
        : context.funnelStage === 'decide'
          ? 'Fase Beslissen: de praktische stap, alleen met gecontroleerde feiten.\n\n'
          : '';

  return `${MOCK_MARKER}\n\n${stageLine}${context.coreMessage.length > 0 ? context.coreMessage : `Weet wat ${course} inhoudt voordat je kiest.`}${factBlock}${closing}`;
}

function usageFor(started: number): AiUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    latencyMs: Math.max(1, Date.now() - started),
    // Nothing was spent, and an estimate must never be recorded as actual.
    actualCostCents: 0,
  };
}

// ---------------------------------------------------------------------------
// The mock reads the same structured context block that real prompts receive,
// so both providers are driven by identical inputs.
// ---------------------------------------------------------------------------

export interface MockContext {
  courseName: string;
  confirmedFacts: { label: string; value: string }[];
  confirmedFactCount: number;
  unconfirmedFactLabels: string[];
  personaNames: string[];
  brandMustNot: string[];
  opportunityIdea: string;
  coreMessage: string;
  conceptHeadline: string;
  cta: string;
  ctaUrl: string | null;
  channels: MarketingChannel[];
  /** The stages a plan must cover, from `<funnelfasen>`; empty when not planning. */
  funnelStages: FunnelStage[];
  /** The one stage a content call writes for, from `<funnelfase>`. */
  funnelStage: FunnelStage | null;
  revisionInstruction: string;
  /** Text fetched from a course page, for `course.extract_from_url`. */
  pageText: string;
  pageTitle: string | null;
}

function firstLine(text: string): string | null {
  const line = text.split('\n')[0]?.slice(0, 120).trim() ?? '';
  return line.length === 0 ? null : line;
}

/**
 * Extracts the structured block that `buildContextBlock` writes into the user
 * message. Parsing our own format keeps the mock honest: it sees exactly what
 * a real provider sees, and nothing more.
 */
function parseContext(user: string): MockContext {
  const readBlock = (tag: string): string => {
    const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'u').exec(user);
    return match?.[1]?.trim() ?? '';
  };

  const facts = readBlock('gecontroleerde_feiten')
    .split('\n')
    .map((line) => line.replace(/^[-·*]\s*/u, '').trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const idx = line.indexOf(':');
      return idx === -1
        ? { label: 'Informatie', value: line }
        : { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    });

  /*
   * Validated against the contract's own vocabulary, not a list kept here.
   *
   * This was a hardcoded array of five channel names — a fourth copy of "which
   * channels exist", in the one place nobody thinks to update. When the
   * advertising channels were added it silently dropped them, so the mock chain
   * planned three channels instead of four and the missing advert looked like a
   * bug in the plan filter, two modules away. A mock has no business holding an
   * opinion about which channels the product has.
   */
  const channels = readBlock('kanalen')
    .split(/[,\n]/u)
    .map((value) => value.trim())
    .filter((value): value is MarketingChannel => marketingChannel.safeParse(value).success);

  return {
    courseName: readBlock('opleiding') || 'deze opleiding',
    pageText: readBlock('paginatekst'),
    // The first line of extracted text stands in for a title in the mock.
    pageTitle: firstLine(readBlock('paginatekst')),
    confirmedFacts: facts,
    confirmedFactCount: facts.length,
    unconfirmedFactLabels: readBlock('niet_gecontroleerd')
      .split(/[,\n]/u)
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    personaNames: readBlock('doelgroepen')
      .split('\n')
      .map((line) => line.replace(/^[-·*]\s*/u, '').split(':')[0]?.trim() ?? '')
      .filter((value) => value.length > 0),
    brandMustNot: readBlock('merk_verboden')
      .split('\n')
      .map((line) => line.replace(/^[-·*]\s*/u, '').trim())
      .filter((value) => value.length > 0),
    opportunityIdea: readBlock('kans'),
    coreMessage: readBlock('kernboodschap'),
    conceptHeadline: readBlock('concept_kop'),
    cta: readBlock('cta'),
    ctaUrl: readBlock('cta_url') || null,
    channels,
    funnelStages: stageIds(readBlock('funnelfasen')),
    funnelStage: stageIds(readBlock('funnelfase'))[0] ?? null,
    revisionInstruction: readBlock('revisie_instructie'),
  };
}

/**
 * The stage ids in a `<funnelfasen>`/`<funnelfase>` block.
 *
 * Each stage there opens with `discover — Ontdekken` and continues with its
 * guidance lines; only the id before the dash is taken, and only if it is a
 * stage the contract knows — the mock holds no list of its own.
 */
function stageIds(block: string): FunnelStage[] {
  return block
    .split('\n')
    .map((line) => line.split(' — ')[0]?.trim() ?? '')
    .map((value) => funnelStage.safeParse(value))
    .filter((result) => result.success)
    .map((result) => result.data);
}

/** Research is not simulated: pretending to have sources would be worse than
 *  having none, so the mock provider reports the capability as absent. */
export class MockProvider implements AiProvider {
  public readonly name = 'mock';
  public readonly isMock = true;
  private readonly textAdapter = new MockTextAdapter();

  text(): TextGenerationAdapter {
    return this.textAdapter;
  }

  research(): ResearchAdapter | undefined {
    return undefined;
  }

  image(): undefined {
    return undefined;
  }
}
