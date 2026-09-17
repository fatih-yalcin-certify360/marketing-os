import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type {
  personaProposalSet,
  opportunityProposalSet,
  conceptProposalSet,
  contentProposalSet,
  personaOrientationProposal,
  contentPlan,
  briefProposal} from '@c360/contracts';
import type { BannerProposal } from '@c360/contracts';
import {
  creativeResearchSnapshot,
  channelFit,
  courseFactField,
  FUNNEL_STAGES,
  funnelStage,
  marketingChannel,
  FUNNEL_STAGE_LABEL_NL,
  PRODUCIBLE_CHANNELS,
  type CourseFactField,
  type FunnelStage,
  type MarketingChannel,
} from '@c360/contracts';
import type { contentCopy } from '@c360/contracts';
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
      case 'campaign.deliverables': {
        /*
         * One form per stage the campaign asked for, not every form for every
         * campaign: the banner serves Ontdekken, the blog with FAQ Overwegen,
         * the fit check Beslissen. A single-stage campaign therefore gets one
         * form and a full-funnel one three, each naming the stage it serves —
         * so "the system proposes" stays distinguishable from "the system
         * generates everything".
         */
        const stages = context.funnelStages.length > 0 ? context.funnelStages : FUNNEL_STAGES;
        const forms: Record<FunnelStage, { type: string; reason: string; hypothesis: string; measurement: string }> = {
          discover: { type: 'google_studio', reason: 'Demo: maakt het moment herkenbaar voor wie nog niet zoekt, op een betaalde plaatsing.', hypothesis: 'Demo: toets of de microvraag in de banner tot doorklikken leidt.', measurement: 'Meet de interacties met de banner per plaatsing, per periode geregistreerd.' },
          consider: { type: 'blog_faq', reason: 'Demo: beantwoordt de beslisvraag uit de briefing waar de doelgroep vergelijkt.', hypothesis: 'Demo: toets of deze uitleg helpt bij de opleidingskeuze.', measurement: 'Meet bezoeken en klikken op de opleidingslink, per periode geregistreerd.' },
          decide: { type: 'fit_check', reason: 'Demo: laat de lezer de eigen situatie toetsen vóór de inschrijving.', hypothesis: 'Demo: toets of de keuzehulp tot een gesprek of aanvraag leidt.', measurement: 'Meet voltooide keuzehulpen en de verdeling van de antwoorden.' },
        };
        return {
          items: stages.map((stage) => ({ ...forms[stage], stage })),
          visualAdvice: 'Demo: gebruik de sociale content uit het kanaalplan voor het eerste contact; de website-vormen vangen de verdieping op.',
        };
      }
      case 'campaign.package':
        return {
          title:'Demo: een bewuste opleidingskeuze',intro:'Dit is een demonstratiepakket. Controleer de echte campagnebrief voordat je inhoud publiceert.',
          sections:[{heading:'Begin bij je vraag',text:'Dit demonstratievoorbeeld laat zien waar de onderbouwde uitleg uit de briefing komt.'},{heading:'Bepaal je volgende stap',text:'Vergelijk de gecontroleerde opleidingsinformatie met je eigen leervraag.'}],
          faq:[{question:'Welke informatie heb ik nodig?',answer:'Bekijk de gecontroleerde informatie op de opleidingspagina.'},{question:'Hoe bepaal ik mijn volgende stap?',answer:'Bespreek je leervraag en controleer de voorwaarden op de opleidingspagina.'}],
          reflection:[
            {question:'Wat is je uitgangssituatie?',options:[
              {label:'Ik doe dit werk al, zonder de opleiding',signal:'fit',guidance:'Demo: je praktijkervaring is een sterke basis; de opleiding zet er het kader onder.'},
              {label:'Ik oriënteer me op deze richting',signal:'explore',guidance:'Demo: lees eerst wat de opleiding vraagt en oplevert voordat je kiest.'},
              {label:'Ik heb deze kwalificatie al',signal:'other',guidance:'Demo: dezelfde basisopleiding voegt dan weinig toe; kijk naar verdieping.'}]},
            {question:'Wat speelt er nu in je werk?',options:[
              {label:'Ik krijg vragen waar ik geen antwoord op heb',signal:'fit',guidance:'Demo: precies de situatie waarvoor deze opleiding is bedoeld.'},
              {label:'Ik wil weten wat het vak inhoudt',signal:'explore',guidance:'Demo: begin bij de inhoud en de voorwaarden op de opleidingspagina.'},
              {label:'Mijn werk verandert een andere kant op',signal:'other',guidance:'Demo: dan past een andere richting waarschijnlijk beter.'}]},
            {question:'Hoeveel ruimte heb je de komende maanden?',options:[
              {label:'Ik kan tijd naast mijn werk vrijmaken',signal:'fit',guidance:'Demo: controleer de studielast op de opleidingskaart.'},
              {label:'Dat weet ik nog niet',signal:'explore',guidance:'Demo: bespreek het met je leidinggevende voordat je kiest.'},
              {label:'Nu even niet',signal:'other',guidance:'Demo: dan is een later moment realistischer dan nu starten.'}]},
          ],
          outcomes:{
            fit:{title:'Demo: deze opleiding past bij je situatie',text:'Demo-uitkomst: je antwoorden wijzen op werk waarin de vragen van deze opleiding nu al spelen en op ruimte om ermee aan de slag te gaan. Lees op de opleidingspagina de inhoud, de voorwaarden en de studielast, en leg de start naast je agenda. Dit is een keuzehulp, geen toelatingsoordeel.',nextSteps:['Lees de opleidingspagina: inhoud, voorwaarden, studielast.','Bespreek tijd en budget met je leidinggevende.','Noteer twee vragen uit je werk die je met de opleiding wilt beantwoorden.']},
            explore:{title:'Demo: eerst verder oriënteren',text:'Demo-uitkomst: je antwoorden wijzen op belangstelling, maar nog niet op een duidelijke aanleiding of ruimte. Verken eerst wat het vak in de praktijk vraagt en wat de opleiding daarvan behandelt; de opleidingspagina is daarvoor de eerste plek. Dit is een keuzehulp, geen toelatingsoordeel.',nextSteps:['Lees de inhoud en de doelgroep op de opleidingspagina.','Praat met iemand die dit werk doet.']},
            other:{title:'Demo: een andere richting past waarschijnlijk beter',text:'Demo-uitkomst: je antwoorden wijzen op een situatie waarin deze basisopleiding weinig toevoegt, bijvoorbeeld omdat je de kwalificatie al hebt of omdat je werk een andere kant op gaat. Kijk naar verdieping in je huidige richting; deze keuzehulp adviseert geen vervolgaanbod. Dit is een keuzehulp, geen toelatingsoordeel.',nextSteps:['Bespreek verdieping in je huidige richting met je leidinggevende.']},
          },
          banner:{headline:'Wat wordt je volgende stap?',body:'Verken de opleiding vanuit je eigen leervraag.',question:'Waar begin jij?',options:[{label:'Mijn ervaring',feedback:'Vergelijk je ervaring met de opleidingsinformatie.'},{label:'Mijn leervraag',feedback:'Bepaal welke kennis je wilt opbouwen.'}]},
          evidenceIds:[],reviewNotes:['Demonstratie-output: geen echte campagneanalyse.'],
        };
      case 'radar.keywords':
        return { items: [], note: 'Demo: geen echt vragenonderzoek.' };
      case 'radar.synthesize':
        return this.marketPicture(context);
      case 'radar.audience':
        return { findings: [], note: 'Demo: geen echt doelgroepbewijs.' };
      case 'radar.analyze':
        return this.radarCards(context);
      case 'research.findings':
        return this.researchFindings(context);
      case 'persona.extract_from_text':
        return {answers:[]};
      case 'persona.questionnaire':
        return this.questionnaire(context);
      case 'persona.orientation':
        return this.orientation(context);
      case 'banner.screenplay':
        return this.bannerScreenplay();
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
   * One demo card per fetched page, quoting a real sentence from it.
   *
   * The pages arrive as JSON in the page-text block. Taking an actual sentence
   * as the excerpt is what lets the service's excerpt-in-page check pass, so a
   * development scan of a supplied URL produces a card — clearly marked demo
   * — instead of an empty radar. Relationship is always *uncertain*: the mock
   * has not read the market and says so.
   */
  private radarCards(context: MockContext): unknown {
    let pages: { url: string; text: string }[] = [];
    try {
      const parsed: unknown = JSON.parse(context.pageText);
      if (Array.isArray(parsed)) {
        pages = parsed.filter(
          (item): item is { url: string; text: string } =>
            typeof item === 'object' && item !== null && typeof (item as { url?: unknown }).url === 'string' && typeof (item as { text?: unknown }).text === 'string',
        );
      }
    } catch {
      pages = [];
    }
    const cards = pages.slice(0, 4).flatMap((page) => {
      const sentence = page.text
        .split(/(?<=[.!?])\s+/u)
        .map((part) => part.trim())
        .find((part) => part.length >= 40 && part.length <= 600);
      if (sentence === undefined) return [];
      let organization = 'Bron';
      try {
        organization = new URL(page.url).hostname.replace(/^www\./u, '');
      } catch {
        /* keep the placeholder */
      }
      return [
        {
          sourceUrl: page.url,
          organization,
          relationship: 'uncertain',
          relationshipReason: `Demo: de relatie met onze opleiding is niet beoordeeld; controleer of ${organization} een aanbieder, werkgever of vakbron is. ${MOCK_MARKER}`,
          title: `Wat ${organization} over dit onderwerp zegt`,
          observation: `De pagina van ${organization} bevat een passage over dit onderwerp; de mock leest geen betekenis. ${MOCK_MARKER}`,
          excerpt: sentence,
          relevance: 'Demo: mogelijk relevant als aanleiding voor een campagne; de inhoudelijke beoordeling is aan de lezer.',
          publishedDate: null,
          dateExcerpt: null,
          period: null,
          uncertainty: 'Demo-output: de relatie, de actualiteit en de betekenis van de bron zijn niet beoordeeld.',
          approaches: [
            { title: 'Herkenbare situatie', format: 'LinkedIn-bericht', idea: `Open met een concrete werksituatie die aansluit op de passage van ${organization} en verwijs naar de opleiding. ${MOCK_MARKER}`, audience: 'Professionals die zich oriënteren' },
            { title: 'Keuzehulp', format: 'LinkedIn-bericht', idea: 'Zet twee routes naast elkaar en laat de lezer kiezen welke past.', audience: 'Vergelijkers' },
            { title: 'Praktijkvraag', format: 'Facebook-bericht', idea: 'Stel de vraag die de bron oproept en beantwoord haar met gecontroleerde opleidingsinformatie.', audience: 'Werkenden met deze taak' },
          ],
        },
      ];
    });
    return {
      cards,
      note: cards.length === 0 ? 'Demo-aanbieder: geen leesbare passage gevonden om een kaart op te baseren.' : 'Demo-aanbieder: kaarten citeren een zin van de pagina; relatie en betekenis zijn niet beoordeeld.',
    };
  }

  /**
   * A market picture from whatever verified evidence the run handed over.
   *
   * The evidence arrives as JSON in the page-text block. The mock reads it and
   * writes one insight per distinct domain, up to three, each citing the
   * items from that domain — so the service's checks (cited ids exist, no
   * invented figures) are exercised on the mock exactly as on a real model.
   * No evidence, no insights: the note says so rather than inventing a market.
   */
  private marketPicture(context: MockContext): unknown {
    let evidence: { kind: string; id: string; organization: string; domain: string }[] = [];
    try {
      const parsed: unknown = JSON.parse(context.pageText);
      if (Array.isArray(parsed)) {
        evidence = parsed.filter(
          (item): item is { kind: string; id: string; organization: string; domain: string } =>
            typeof item === 'object' && item !== null && 'kind' in item && 'id' in item,
        );
      }
    } catch {
      evidence = [];
    }
    if (evidence.length === 0) {
      return { insights: [], note: 'Demo: geen geverifieerde onderdelen om samen te lezen.' };
    }
    const byDomain = new Map<string, typeof evidence>();
    for (const item of evidence) {
      const list = byDomain.get(item.domain) ?? [];
      list.push(item);
      byDomain.set(item.domain, list);
    }
    const stages = ['discover', 'consider', 'decide'] as const;
    const objectives = ['awareness', 'consideration', 'conversion'] as const;
    return {
      insights: [...byDomain.entries()].slice(0, 3).map(([domain, items], index) => ({
        headlineNl: `Bronnen van ${domain} spreken over de opleidingskeuze in dezelfde termen als onze doelgroep.`,
        observationNl: `Demo: ${String(items.length)} onderdeel/onderdelen van ${items[0]?.organization ?? domain} beschrijven de context waarin deze opleiding wordt gekozen. ${MOCK_MARKER}`,
        meaningNl: 'Voor wie zich oriënteert op deze opleiding is dit een herkenbaar moment om op aan te sluiten, in de fase die hieronder staat.',
        nowNl: 'Werk een campagne uit die dit moment als aanleiding neemt en verwijst naar de gecontroleerde opleidingsinformatie.',
        alternativeNl: 'De bron kan een eigen commercieel belang hebben; het patroon kan beperkt zijn tot deze aanbieder.',
        notShownNl: 'Geen zoekvolume, geen marktaandeel en geen resultaat van de bron zelf.',
        stage: stages[index % 3],
        suggestedObjective: objectives[index % 3],
        agreement: items.length > 1 ? 'eens' : 'niet_te_beoordelen',
        evidence: items.slice(0, 8).map((item) => ({ kind: item.kind, id: item.id })),
      })),
      note: 'Demo-marktbeeld: leest alleen de meegegeven onderdelen, geen echte marktanalyse.',
    };
  }

  /**
   * The questionnaire, from the confirmed facts alone.
   *
   * The mock answers only what a confirmed course fact literally supports,
   * quoting the fact and naming its reference exactly as the service expects
   * (`Opleidingskaart · <label>`), plus one assumption without a quote and the
   * meta-question. Everything else is left out — unknown is the honest answer
   * — so a development run shows what the real rule produces: a handful of
   * sourced answers, not a plausibly complete profile.
   */
  /**
   * Every one of the 36 questions answered, the way the v2 prompt asks:
   * quoted from a confirmed course fact where one answers the question,
   * otherwise a reasoned assumption that says what it was inferred from. The
   * demo path therefore shows the same shape a real run does — no open
   * question, every cell labelled — and the verification in
   * `verifyQuestionnaire` sees both kinds of answer.
   */
  private questionnaire(context: MockContext): unknown {
    const fact = (label: string): { label: string; value: string } | undefined =>
      context.confirmedFacts.find((entry) => entry.label.toLowerCase() === label.toLowerCase());
    interface Answer {
      questionId: string;
      answer: string;
      status: 'provided' | 'assumption';
      quote: string | null;
      sourceRef: string | null;
      reasoningNl: string | null;
    }
    const answers: Answer[] = [];
    const done = new Set<string>();
    const who = context.personaProfileName ?? 'deze doelgroep';
    const course = context.courseName;

    const fromFact = (questionId: string, label: string, answer: string): void => {
      const found = fact(label);
      if (found === undefined || done.has(questionId)) return;
      done.add(questionId);
      answers.push({
        questionId,
        answer: `${answer} ${MOCK_MARKER}`,
        status: 'provided',
        quote: found.value.slice(0, 120),
        sourceRef: `Opleidingskaart · ${found.label}`,
        reasoningNl: null,
      });
    };
    fromFact('q01', 'Voor wie', `${who} werkt in de doelgroep die de opleidingskaart noemt.`);
    fromFact('q13', 'Korte omschrijving', 'Wil de kennis en vaardigheden ontwikkelen die de opleiding beschrijft.');
    fromFact('q22', 'Toelatingsvoorwaarden', 'De toelatingsvoorwaarden van de opleidingskaart gelden.');
    fromFact('q20', 'Duur en studielast', 'De tijd die de opleidingskaart als duur en studielast noemt moet naast het werk beschikbaar zijn.');
    fromFact('q23', 'Prijs', 'Het bedrag op de opleidingskaart is het budget dat beschikbaar moet zijn; wie betaalt staat er niet bij.');
    fromFact('q16', 'Inhoud', 'Wil na afloop zelfstandig kunnen wat de inhoud van de opleidingskaart beschrijft.');

    const inferred: Record<string, string> = {
      q01: `${who} werkt in de rol die het doelgroepprofiel beschrijft.`,
      q02: `Werkt bij een organisatie waar het onderwerp van ${course} tot het dagelijkse werk hoort; de sector is niet vastgesteld.`,
      q03: 'Dagelijkse taken volgen uit de rol in het profiel: dossiers, gesprekken en afstemming met collega’s over het onderwerp van de opleiding.',
      q04: 'Enkele jaren ervaring in de rol; genoeg om de lacune te voelen die het profiel als behoefte noemt.',
      q05: 'Een werk- of denkniveau dat bij de rol past; formele kennis van het onderwerp is beperkt tot wat het werk leerde.',
      q06: 'Middenfase van de loopbaan: gevestigd in de rol, met groeiende verantwoordelijkheid.',
      q07: 'Leeftijd is voor deze keuze niet bepalend: de leerbehoefte volgt uit de rol en de nieuwe verantwoordelijkheid, niet uit leeftijd.',
      q08: 'Regio is niet bepalend; reistijd moet naast een werkweek passen, dus lesvorm en planning wegen zwaarder dan afstand.',
      q09: 'Deelname moet naast een volledige baan passen; avond- of dagdelen naast het werk zijn de realistische ruimte.',
      q10: 'Wil de rol met meer zekerheid en gezag vervullen en daarop aanspreekbaar zijn.',
      q11: 'De uitdaging uit het profiel: situaties waarin kennis van het onderwerp tekortschiet en beslissingen op gevoel worden genomen.',
      q12: 'Zoekt het nu op, vraagt collega’s of leert van fouten; wat ontbreekt is een samenhangend kader.',
      q13: `Wil de kennis en vaardigheden ontwikkelen die ${course} beschrijft.`,
      q14: 'Een nieuwe taak of verantwoordelijkheid in de rol is de aanleiding om een opleiding te zoeken.',
      q15: 'Nu, omdat de nieuwe verantwoordelijkheid er al ligt en uitstel elke week zichtbaar is.',
      q16: 'Wil na afloop zelfstandig beslissingen kunnen nemen en onderbouwen op het onderwerp van de opleiding.',
      q17: 'Merkt het aan minder twijfel in het werk en aan collega’s die de adviezen overnemen.',
      q18: 'Het werk beter doen en erkend worden in de rol motiveert het meest.',
      q19: 'Twijfelt of de opleiding naast het werk vol te houden is en of het niveau past.',
      q20: 'Enkele uren per week naast het werk; meer alleen in een rustige periode.',
      q21: 'Voorkeur voor een planning die naast het werk past en voor begeleiding bij praktijkvragen; de lesvorm zelf is minder bepalend.',
      q22: 'Nederlandse werktaal en werkervaring in de rol zijn de relevante voorkennis.',
      q23: 'De werkgever betaalt waarschijnlijk uit een opleidingsbudget; wie betaalt is niet vastgesteld.',
      q24: 'De leidinggevende beslist mee over tijd en budget; de deelnemer kiest de opleiding.',
      q25: 'Collega’s in dezelfde rol en de leidinggevende beïnvloeden de keuze.',
      q26: 'Inpasbaar naast het werk, praktijkgericht en aantoonbaar niveau wegen het zwaarst.',
      q27: 'Alternatieven: zelfstudie, leren van een ervaren collega of uitstel tot een rustiger moment.',
      q28: 'Wil zien wie de docenten zijn, wat deelnemers ervan vonden en hoe de opleiding in de praktijk landt.',
      q29: 'Een te vol programma naast het werk, onduidelijk niveau of geen toestemming van de leidinggevende kan tot uitstel leiden.',
      q30: 'Oriënteert zich waarschijnlijk eerst online, op de opleidingspagina en via zoekmachines.',
      q31: `Zoekt op de naam van de opleiding, op "opleiding" plus het vakgebied en op vragen uit het werk.`,
      q32: 'Vakmedia, LinkedIn en de websites van opleiders; netwerken van collega’s in dezelfde rol.',
      q33: 'Luistert naar collega’s die de opleiding volgden en naar de leidinggevende.',
      q34: 'Past het naast mijn werk, is het niveau goed en wat levert het mijn werk direct op?',
      q35: '“Ik doe dit werk al, maar ik wil het met meer zekerheid doen en weten waarom ik iets beslis.”',
    };
    for (const [questionId, answer] of Object.entries(inferred)) {
      if (done.has(questionId)) continue;
      done.add(questionId);
      answers.push({
        questionId,
        answer,
        status: 'assumption',
        quote: null,
        sourceRef: null,
        reasoningNl: `Demo: door AI afgeleid uit het doelgroepprofiel "${who}" en de opleidingskaart van ${course}; geen letterlijke passage. ${MOCK_MARKER}`,
      });
    }
    const sourced = answers.filter((answer) => answer.status === 'provided').map((answer) => answer.questionId);
    answers.push({
      questionId: 'q36',
      answer: `Demo: ${sourced.length > 0 ? `${sourced.join(', ')} rusten op de gecontroleerde opleidingskaart` : 'geen antwoord rust op een passage'}; alle overige antwoorden zijn door AI afgeleid uit het doelgroepprofiel en staan als aanname. ${MOCK_MARKER}`,
      status: 'provided',
      quote: null,
      sourceRef: null,
      reasoningNl: null,
    });
    answers.sort((a, b) => a.questionId.localeCompare(b.questionId));
    return {
      answers,
      noteNl: 'Demo: de antwoorden met een passage komen van de gecontroleerde opleidingskaart; de aannames zijn afgeleid uit het profiel, niet uit gelezen onderzoek. Het meest onzeker zijn budget, beslisser en kanalen.',
    };
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
    /*
     * Names vary with how many personas already exist in scope.
     *
     * The real rule tells the model to propose only audiences that differ from
     * `<bestaande_doelgroepen>`; a mock that returned the same three names on
     * every run would have every second run skipped by the service's duplicate
     * guard, and the demo path would never show a list that grows. Three name
     * sets, chosen by the count: the first run gets the first set, the next
     * the second, and so on. After the pool is exhausted the names repeat and
     * the guard skips them — which is the honest outcome when nothing new can
     * be grounded, and it exercises the "no new audiences" path.
     */
    const nameSets: readonly [string, string, string][] = [
      ['Carrièreswitcher', 'Verdieper vanuit de praktijk', 'Georiënteerde starter'],
      ['Leidinggevende met opleidingsbudget', 'Herintreder na een loopbaanpauze', 'Zij-instromer uit een aangrenzend vak'],
      ['Zelfstandige die zelf investeert', 'Teamlid dat door de werkgever wordt aangemeld', 'Doorstromer naar een vervolgopleiding'],
    ];
    const taken = new Set(context.existingPersonaNames.map((name) => name.toLowerCase()));
    const unused = nameSets.find((set) => !set.some((name) => taken.has(name.toLowerCase())));
    // Every hand-written set is in use: a numbered round keeps the demo path
    // appending, so a long test session never runs dry. The "nothing new"
    // outcome is exercised through a spied provider instead.
    const round = String(Math.floor(context.existingPersonaNames.length / 3) + 1);
    const names: readonly [string, string, string] =
      unused ?? [
        `Carrièreswitcher · ronde ${round}`,
        `Verdieper vanuit de praktijk · ronde ${round}`,
        `Georiënteerde starter · ronde ${round}`,
      ];

    const grounding = context.confirmedFacts.slice(0, 3).map((fact) => ({
      claim: `${fact.label}: ${fact.value.slice(0, 200)}`,
      kind: 'course_fact' as const,
      sourceRef: `Opleidingskaart · ${fact.label}`,
      retrievedAt: null,
    }));
    /*
     * One grounded statement and one assumption, deliberately.
     *
     * The grounded one cites a confirmed fact the service can trace; the
     * second cites nothing, so the screen shows *aanname* and the channel plan
     * may not move a verdict on it. A third statement cites a source the mock
     * invents, which the service must strip — that is the check the test
     * makes, and it needs a case to make it on.
     */
    const firstFact = context.confirmedFacts[0];
    const orientationSources = [
      ...(firstFact === undefined
        ? []
        : [
            {
              statementNl: `Oriënteert zich op de opleidingspagina en leest daar eerst "${firstFact.label.toLowerCase()}".`,
              channel: 'course_page_update' as const,
              grounding: {
                claim: `${firstFact.label}: ${firstFact.value.slice(0, 200)}`,
                kind: 'course_fact' as const,
                sourceRef: `Opleidingskaart · ${firstFact.label}`,
                retrievedAt: null,
              },
            },
          ]),
      {
        statementNl: `Volgt vakgenoten op LinkedIn tijdens werktijd; oriënteert zich niet via Instagram. ${MOCK_MARKER}`,
        channel: 'linkedin_organic' as const,
        grounding: null,
      },
      {
        statementNl: `Krijgt bijscholing via de werkgever aangereikt. ${MOCK_MARKER}`,
        channel: 'email' as const,
        grounding: {
          claim: 'Werkgevers bieden bijscholing aan (demo-bron, niet aangeleverd).',
          kind: 'external_source' as const,
          sourceRef: 'https://example.invalid/demo-bron-niet-aangeleverd',
          retrievedAt: null,
        },
      },
    ];

    const base = [
      {
        name: names[0],
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
        orientationSources,
      },
      {
        name: names[1],
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
        orientationSources,
      },
      {
        name: names[2],
        summary: `Staat aan het begin en zoekt de meest logische route naar ${course}.`,
        need: `Een route die begrijpelijk is en waarvan de eerste stap klein genoeg voelt. ${MOCK_MARKER}`,
        motivation: 'Wil beginnen, maar wil eerst weten waar het toe leidt.',
        barriers: ['Overzicht ontbreekt', 'Angst om de verkeerde route te kiezen'],
        decisionCriteria: ['Duidelijke eerste stap', 'Wat het uiteindelijk oplevert'],
        relationToCourse: `Kent ${course} van naam, niet van inhoud.`,
        grounding,
        assumptions: ['Aanname: heeft geen eerdere ervaring in het vakgebied'],
        orientationSources: orientationSources.slice(0, 1),
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

    /*
     * One message per stage the prompt asked for, from the same guidance a real
     * model reads. Proof fields are the confirmed ones the stage may use: the
     * summary and audience for Ontdekken and Overwegen, the practical facts for
     * Beslissen — and only fields that are actually confirmed, because the
     * service removes the rest and would otherwise note the removal.
     */
    const confirmed = new Set(context.confirmedFactFields);
    const proofFor = (stage: FunnelStage): CourseFactField[] => {
      const wanted: CourseFactField[] =
        stage === 'discover'
          ? ['summary', 'targetAudience']
          : stage === 'consider'
            ? ['summary', 'targetAudience', 'contentOutline', 'duration']
            : ['price', 'dates', 'entryConditions', 'duration'];
      return wanted.filter((field) => confirmed.has(field));
    };
    const stageMessages = context.funnelStages.map((stage) => ({
      stage,
      coreMessageNl:
        stage === 'discover'
          ? `Steeds meer verantwoordelijkheid vraagt om een stevige basis — herken je dat moment? ${MOCK_MARKER}`
          : stage === 'consider'
            ? `Wat ${course} inhoudt, voor wie het is en hoe het werkt, zodat je kunt vergelijken. ${MOCK_MARKER}`
            : `De praktische stap naar ${course}: wanneer, wat het vraagt en hoe je je inschrijft. ${MOCK_MARKER}`,
      ctaNl: stage === 'discover' ? 'Lees meer' : stage === 'consider' ? 'Bekijk de inhoud' : 'Schrijf je in',
      proofFields: proofFor(stage),
    }));

    /*
     * One of each shape content can take.
     *
     * A social post, a page, an e-mail and a search advert — so the ordinary
     * test run and every browser smoke run exercise all four rather than
     * only the social one. Deliberately not all eight channels: the point is
     * to cover each *shape* once, not to make every run generate more.
     */
    const channelSuggestions = [
      'linkedin_organic',
      'course_page_update',
      'blog_article',
      'email',
      'google_search_ads',
    ] satisfies MarketingChannel[];
    const roleFor: Record<(typeof channelSuggestions)[number], string> = {
      linkedin_organic:
        'LinkedIn opent het gesprek in de fase Ontdekken: het bericht spreekt de werksituatie van de doelgroep aan en brengt haar naar de website. Het hoeft niet te overtuigen of te verkopen; het herkent en nodigt uit.',
      course_page_update:
        'De opleidingspagina draagt de fase Overwegen: hier staat wat de opleiding inhoudt, voor wie zij is en hoe zij werkt, zodat een lezer kan vergelijken. Wat op de bestaande pagina ontbreekt, komt als wijzigingsvoorstel met de huidige passage ernaast.',
      blog_article:
        'Het blogartikel draagt de fase Ontdekken: het beantwoordt de vraag waarmee iemand zoekt, nog voordat een opleiding in beeld is, en leidt vandaar naar de opleidingspagina.',
      email:
        'De e-mail begeleidt wie al interesse toonde van Overwegen naar Beslissen: zij beantwoordt de drie meest gestelde vragen en zet de praktische stap klaar. Zij verzendt niets zelf; dit is een concept voor de mailomgeving.',
      google_search_ads:
        'De zoekadvertentie vangt wie zelf al zoekt en hoort bij de fase Beslissen. Zij verwijst direct naar de opleidingspagina en maakt geen beloftes over resultaat.',
    };
    const personas = context.personaNames.length > 0 ? context.personaNames : ['de gekozen doelgroep'];
    const personaLine = personas.join(', ');
    const facts = context.confirmedFacts.slice(0, 3).map((fact) => `${fact.label.toLowerCase()} (${fact.value.split(/\s+/u).slice(0, 8).join(' ')})`);
    const factsLine = facts.length > 0 ? facts.join('; ') : 'nog geen gecontroleerde opleidingsinformatie';
    const tone = context.brandTone.length > 0 ? context.brandTone : 'helder, concreet en zonder overdrijving';
    const stagesLine = context.funnelStages.map((stage) => FUNNEL_STAGE_LABEL_NL[stage]).join(', ') || 'alle fasen';

    return {
      reviewNotes: [],
      // The phrases the campaign writes for, from the pool the service supplied
      // and nowhere else — the service drops anything outside it.
      keywords: context.keywords.slice(0, 5).map((keyword) => ({
        phrase: keyword.phrase,
        sourceRef: keyword.sourceRef,
        kind: keyword.kind,
      })),
      ctaUrl: null,
      contextNl: `${MOCK_MARKER} ${course} is een opleiding waarvan de belangrijkste feiten op de opleidingskaart zijn gecontroleerd: ${factsLine}. De doelgroepen die voor deze campagne zijn gekozen, ${personaLine}, delen één situatie: zij dragen in hun werk meer verantwoordelijkheid dan hun formele basis dekt, en merken dat op het moment dat een dossier, een collega of een leidinggevende meer van hen vraagt dan zij kunnen onderbouwen. Er is op dit moment geen lopende campagne voor deze opleiding, de opleidingspagina beschrijft de inhoud maar niet het moment waarop iemand deze stap overweegt, en het onderzoek onder de doelgroepen laat zien dat de eerste oriëntatie via het eigen netwerk en via zoeken begint. Daarom wordt nu een campagne opgezet die de fasen ${stagesLine} achter elkaar bedient: eerst herkenning van het moment, dan een eerlijke vergelijking van de inhoud, dan de praktische stap. Alles wat in deze briefing over de opleiding wordt beweerd, komt uit de gecontroleerde kaart; wat daar niet staat, wordt niet genoemd.`,
      goal: `${MOCK_MARKER} De campagne moet ${personaLine} laten herkennen dat de eigen werksituatie om een steviger basis vraagt, hen in staat stellen de inhoud van ${course} te vergelijken met wat zij nu al kunnen, en de praktische stap naar inschrijving zo klein en duidelijk maken dat zij die zonder tussenkomst kunnen zetten. Per fase telt ander gedrag: doorlezen en delen in Ontdekken, de opleidingspagina en het artikel bekijken in Overwegen, een informatieaanvraag of inschrijving in Beslissen. Er wordt geen aantal of percentage beloofd: dit is de eerste meting.`,
      audienceInsightNl: `${MOCK_MARKER} ${personas.slice(0, 2).map((name, index) => `${name} staat op het moment waarop ervaring niet meer volstaat: er wordt een onderbouwing gevraagd die de praktijk alleen niet levert. De belangrijkste drempel is niet twijfel over het nut, maar over de inpasbaarheid naast het werk en over de vraag of de inhoud aansluit bij wat men al doet. Het inzicht dat de campagne benut, is dat deze doelgroep pas vergelijkt als zij het eigen moment herkent — daarom opent elke uiting bij de situatie en niet bij de opleiding.${index === 0 ? ' Wat zij moet horen: dat de opleiding de basis onder bestaande ervaring legt, welke onderwerpen daarbij horen en wat er praktisch van haar wordt gevraagd.' : ' Wat zij moet horen: dezelfde kern, met nadruk op de eigen rol en op de manier waarop de opleiding zich laat combineren met werk.'}`).join(' ')} Wat hier over de doelgroepen staat, komt uit de gekozen persona's; wat daarin een aanname is, blijft een aanname en wordt in de campagne getoetst.`,
      propositionNl: `${MOCK_MARKER} ${course} legt de formele basis onder wat ${personaLine} in de praktijk al doen, met een programma waarvan de inhoud en de opzet op de opleidingskaart zijn gecontroleerd. De belofte is niet een resultaat, maar duidelijkheid: je weet vooraf wat je leert, voor wie de opleiding bedoeld is en wat zij van je vraagt. Die belofte is geloofwaardig omdat elke claim in deze briefing herleidbaar is naar een gecontroleerd feit en omdat niets wordt beweerd over slagingskans of doorlooptijd.`,
      coreMessage: context.opportunityIdea.length > 0
        ? context.opportunityIdea
        : `Weet wat ${course} inhoudt voordat je kiest: de basis onder wat je al doet, helder uitgelegd. ${MOCK_MARKER}`,
      stageMessages,
      toneOfVoiceNl: `${MOCK_MARKER} De toon volgt het merk: ${tone}. Voor deze doelgroep betekent dat schrijven als een ervaren collega die uitlegt, niet als een verkoper die overtuigt. Twee aanwijzingen: begin elke tekst bij de werksituatie van de lezer en noem de opleiding pas daarna; gebruik exacte waarden uit de opleidingskaart en geen bijvoeglijke naamwoorden die iets beloven.`,
      mandatories: [
        ...context.brandMustNot.length > 0 ? [] : [],
        `Elke uiting eindigt met de call to action van de fase en verwijst naar de opleidingspagina.`,
        `Elk opleidingsfeit is herleidbaar naar de gecontroleerde opleidingskaart; niet-gecontroleerde velden worden niet genoemd.`,
        `Voorbeeldteksten uit de demo-omgeving dragen de markering "Voorbeeldtekst" en gaan niet live.`,
        `De merknaam en de opleidingsnaam worden voluit en consequent geschreven.`,
      ],
      channelRoles: channelSuggestions.map((channel) => ({ channel, roleNl: `${roleFor[channel]} ${MOCK_MARKER}` })),
      timingNl: `${MOCK_MARKER} De fasen volgen elkaar op: de eerste twee weken staan in het teken van Ontdekken op LinkedIn, daarna schuift het zwaartepunt naar Overwegen met de website en het artikel, en de e-mail en zoekadvertentie lopen vanaf de derde week door tot het evaluatiemoment. Startdata van de opleiding worden alleen genoemd als zij op de opleidingskaart zijn gecontroleerd; zolang dat niet zo is, blijft de planning relatief.`,
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
      channelSuggestions,
      contentScope: `${MOCK_MARKER} Per kanaal één stuk per fase uit het kanaalplan: voor LinkedIn een bericht met beeld in twee ontwerpvarianten die dezelfde boodschap en call to action dragen; voor de website een wijzigingsvoorstel voor de bestaande opleidingspagina of een blogartikel van minimaal zevenhonderd woorden met veelgestelde vragen; voor e-mail een concept met onderwerpregel, inleiding en drie titelblokken; voor Google Search Ads koppen en beschrijvingen met zoektermen uit de briefing. De creatieve richting is redactioneel: een herkenbaar werkmoment als beeld, geen stockfoto-glimlach, tekst die uitlegt in plaats van aanprijst, en in elke uiting dezelfde kernboodschap in een andere uitvoering.`,
      measurement: `${MOCK_MARKER} Per fase één leidende indicator, afgelezen in de bron die haar registreert: in Ontdekken het aantal doorklikken vanaf LinkedIn naar de website, afgelezen in het platformrapport; in Overwegen het aantal bezoekers dat het artikel of de opleidingspagina tot het einde leest, afgelezen in de webanalyse; in Beslissen het aantal informatieaanvragen en inschrijvingen, afgelezen in het inschrijfregister. Er wordt vooraf geen streefwaarde genoemd: na de eerste periode wordt gemeten en pas dan beoordeeld.`,
      stopConditions: `${MOCK_MARKER} Na twee weken wordt per fase geëvalueerd. Bijsturen wanneer een kanaal geen doorklikken oplevert terwijl de andere dat wel doen; stoppen wanneer opleidingsinformatie wijzigt en de content opnieuw beoordeeld moet worden, of wanneer een uiting een niet-gecontroleerd feit blijkt te noemen.`,
      risks: [
        `De doelgroepomschrijvingen rusten deels op aannames; als het eerste contact uitblijft, is de aanname over het oriëntatiemoment het eerste om te toetsen. ${MOCK_MARKER}`,
        `Niet-gecontroleerde opleidingsfeiten (${context.unconfirmedFactLabels.length > 0 ? context.unconfirmedFactLabels.join(', ') : 'geen op dit moment'}) kunnen niet worden genoemd, wat de fase Beslissen dunner maakt dan gewenst.`,
        `De e-mail en de advertenties zijn niet publicatieklaar zolang hun platformlimieten niet zijn gecontroleerd; zij blijven concepten.`,
      ],
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
      /*
       * Advice for every producible cell, items for the brief's channels only
       * — the same split the prompt asks of a real model. The mock has read no
       * audience evidence, so it keeps the rule everywhere and says so, in the
       * words the prompt prescribes for that case.
       */
      for (const channel of PRODUCIBLE_CHANNELS) {
        const fit = channelFit(stage, channel);
        channelAdvice.push({
          stage,
          channel,
          ruleVerdict: fit.verdict,
          advisedVerdict: fit.verdict,
          reasoningNl: `${fit.reasonNl} Geen doelgroepbewijs over dit kanaal. ${MOCK_MARKER}`,
        });
      }
      const fits = channels.map((channel) => ({ channel, ...channelFit(stage, channel) }));
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

    const measurementPlan = stages.map((stage) => ({
      stage,
      indicatorNl:
        stage === 'discover'
          ? 'Bereik en frequentie per kanaal, en bewaarde of gedeelde berichten.'
          : stage === 'consider'
            ? 'Bezoekduur op de opleidingspagina en kliks in de e-mail.'
            : 'Gestarte inschrijvingen via de opleidingspagina.',
      sourceNl:
        stage === 'decide'
          ? 'Het inschrijfregister van het label, per periode afgelezen.'
          : 'De platformrapporten en de paginastatistieken van het label.',
      decisionRuleNl: `Na het evaluatiemoment: opschalen als de indicator stijgt ten opzichte van de vorige periode, aanpassen als hij gelijk blijft, stoppen als niemand reageert. ${MOCK_MARKER}`,
    }));

    return {
      items,
      channelAdvice,
      measurementPlan,
      cadenceNl: 'Per fase één item per kanaal, fasen na elkaar, daarna evalueren.',
      rationaleNl: `Per fase alleen de aanbevolen kanalen, één item elk, zodat er per fase iets te vergelijken is voordat er wordt opgeschaald. ${MOCK_MARKER}`,
    };
  }

  /**
   * Where one stored audience orients, for the free provider.
   *
   * The same three shapes the persona proposal produces: one statement quoting
   * a confirmed course fact, one honest assumption, and one citing a source the
   * mock invents — which the service must strip to an assumption. A mock that
   * only produced well-grounded statements would let that check pass by luck.
   */
  /**
   * A banner screenplay, clearly fabricated.
   *
   * Short lines on purpose: the mock is what the smoke test and every local
   * run see, and a mock that returns comfortable copy would hide exactly the
   * failure this feature has to handle — text that does not fit the smallest
   * format. Everything here is inside the tightest budget, so a size that is
   * refused in a mock run is refused for a reason in the code, not in the copy.
   */
  private bannerScreenplay(): BannerProposal {
    return {
      screenplay: {
        frames: [
          { kind: 'hook', lines: ['Demo: vastgelopen?'] },
          { kind: 'proof', lines: ['Demo: word casemanager'] },
          { kind: 'usp', lines: ['Demo: examen', 'Demo: praktijk'] },
        ],
        ctaText: 'Bekijk data',
        stickerNl: 'Demo',
        legalNl: null,
        backgroundBriefEn: null,
      },
      rationaleNl:
        'Gefabriceerd voorbeeld uit de demomodus. Er is geen briefing of doelgroep gelezen; deze tekst zegt niets over deze campagne.',
    };
  }

  private orientation(context: MockContext): z.infer<typeof personaOrientationProposal> {
    const firstFact = context.confirmedFacts[0];
    return {
      orientationSources: [
        ...(firstFact === undefined
          ? []
          : [
              {
                statementNl: `Leest bij oriëntatie eerst de opleidingspagina, met name "${firstFact.label.toLowerCase()}". ${MOCK_MARKER}`,
                channel: 'course_page_update' as const,
                grounding: {
                  claim: `${firstFact.label}: ${firstFact.value.slice(0, 200)}`,
                  kind: 'course_fact' as const,
                  sourceRef: `Opleidingskaart · ${firstFact.label}`,
                  retrievedAt: null,
                },
              },
            ]),
        {
          statementNl: `Stuit op vakinhoud via collega's en vakgenoten op LinkedIn, tijdens werktijd. ${MOCK_MARKER}`,
          channel: 'linkedin_organic' as const,
          grounding: null,
        },
        {
          statementNl: `Vraagt de leidinggevende om akkoord voordat een opleiding wordt aangevraagd. ${MOCK_MARKER}`,
          channel: null,
          grounding: {
            claim: 'Demo-bron die niet in het materiaal zit; de dienst hoort deze onderbouwing te verwijderen.',
            kind: 'external_source' as const,
            sourceRef: 'https://demo.invalid/niet-in-materiaal',
            retrievedAt: null,
          },
        },
      ],
      noteNl: `Demodata: dit is geen onderzocht oriëntatiegedrag. ${MOCK_MARKER}`,
    };
  }

  private content(context: MockContext): z.infer<typeof contentProposalSet> {
    const course = context.courseName;
    const cta = context.cta.length > 0 ? context.cta : 'Bekijk de opleiding';

    return {
      items: context.channels.map((channel) => {
        const piece = mockPiece(channel, course, cta, context);
        return {
          stage: context.funnelStage,
          channel,
          copy: {
            hook: piece.hook,
            body: piece.body,
            ctaText: cta,
            ctaUrl: context.ctaUrl,
            imageAltText: `Tekstbeeld met de kop over ${course} en de call-to-action "${cta}".`,
            hashtags: piece.hashtags,
            sections: piece.sections,
            ads: AD_CHANNELS.has(channel) ? adsFor(channel, course, cta, context.keywords.map((k) => k.phrase), context.ctaUrl) : null,
            keywordsUsed: piece.keywordsUsed,
            website: piece.website,
          },
          imageHeadline: context.conceptHeadline.length > 0
            ? context.conceptHeadline
            : 'Weet wat je leert, vóór je kiest.',
          imageSubline: course,
          creativeBrief: SOCIAL_CHANNELS.has(channel) ? {
            campaignAlignment: `De gekozen campagnegedachte en hetzelfde materiaalgebruik blijven herkenbaar. ${MOCK_MARKER}`,
            channelRationale: `De scène voor ${channel} krijgt een eigen kijkrichting en tekstbehandeling; dit is een te toetsen demo, geen gemeten kanaalvoorkeur.`,
            personaVersionIds: context.creativeResearch?.personaVersionIds.slice(0, 1) ?? [],
            evidenceIds: context.creativeResearch?.sources.filter(source => source.kind !== 'channel_guidance').slice(0, 1).map(source => source.id) ?? [],
            testHypothesis: 'Vraag echte lezers welke beslissing zij herkennen en welk merk zij onthouden; vergelijk dat binnen hetzelfde kanaal met de vorige uiting.',
            mechanism: channel === 'instagram_organic' ? 'visual_question' as const : 'human_moment' as const,
            audienceInsight: 'Een herkenbare praktijksituatie maakt de leerbehoefte concreet. Dit is demo-invoer.',
            conceptRationale: `De scène bij ${channel} nodigt uit om de professionele beslissing te overwegen. ${MOCK_MARKER}`,
            scene: `Een duidelijk fictieve professional legt twee verschillende dossiermappen naast elkaar en pauzeert voor een beslissing. Demo voor ${course}, ${channel}, fase ${context.funnelStage ?? 'algemeen'}.`,
            composition: 'De handen en dossiers staan rechts in beeld; linksboven blijft rustige ruimte voor de vraag. De onderste rand is vrij voor merk en CTA.',
            textTreatment: channel === 'instagram_organic' ? 'speech_bubble' as const : channel === 'facebook_organic' ? 'image_led' as const : 'editorial' as const,
            textPosition: 'top_left' as const,
            brandIntegration: 'Een dossierdetail draagt de merkaccentkleur. De echte fonts en het logo worden door de renderer geplaatst.',
            avoid: ['Geen generieke vergadertafel', 'Geen tekst of logo in de gegenereerde scène'],
          } : null,
        };
      }),
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
  pool: readonly string[] = [],
  ctaUrl: string | null = null,
): {
  headlines: string[];
  descriptions: string[];
  keywords: string[];
  paths: string[];
  negativeKeywords: string[];
  matchTypeAdviceNl: string;
  finalUrl: string | null;
  rationaleNl: string;
} {
  if (channel !== 'google_search_ads') {
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
      keywords: [],
      paths: [],
      negativeKeywords: [],
      matchTypeAdviceNl: '',
      finalUrl: ctaUrl,
      rationaleNl: `Koppen volgen de kernboodschap uit de briefing; er zijn geen zoekvolumes of klikprijzen bij, want die kent dit systeem niet. ${MOCK_MARKER}`,
    };
  }
  /*
   * A responsive search ad within Google's limits (30 · 90 · 15), the way
   * `checkGoogleAdsShape` demands it: ten headlines with different angles,
   * one of them a search phrase verbatim, four descriptions, two paths,
   * negatives, and no figure anywhere. The course's short name — the
   * abbreviation in brackets when there is one — keeps the headlines short.
   */
  const short = /\(([^)]{2,12})\)/u.exec(course)?.[1] ?? course.split(' ').slice(0, 3).join(' ').slice(0, 24);
  const keywords = [
    ...new Set([
      ...pool.map((phrase) => phrase.toLowerCase()).filter((phrase) => phrase.length <= 28 && !phrase.includes('(')),
      `opleiding ${short.toLowerCase()}`,
      short.toLowerCase(),
    ]),
  ].slice(0, 8);
  const first = keywords[0] ?? `opleiding ${short.toLowerCase()}`;
  const capitalised = first.charAt(0).toUpperCase() + first.slice(1);
  const fit = (line: string, max: number): string => ([...line].length <= max ? line : [...line].slice(0, max).join('').trimEnd());
  return {
    headlines: [
      fit(capitalised, 30),
      fit(`${short}: inhoud en opzet`, 30),
      fit(`Opleiding ${short}`, 30),
      fit(`Wat leer je bij ${short}?`, 30),
      'Voor wie het werk al doet',
      'Bekijk inhoud en voorwaarden',
      'Leer het kader onder je werk',
      'Vergelijk en kies bewust',
      'Gecontroleerde informatie',
      'Start met de opleidingspagina',
    ],
    descriptions: [
      'Zie wat de opleiding inhoudt en wat er van je gevraagd wordt, op de opleidingspagina.',
      'Bekijk de inhoud, de voorwaarden en de studielast voordat je kiest.',
      'Voor wie het werk al doet en het kader onder de praktijk wil leggen.',
      'Alleen gecontroleerde informatie van de opleider, zonder verkooppraat.',
    ],
    keywords,
    paths: ['opleiding', fit(short.toLowerCase().replace(/[^a-z0-9-]/gu, ''), 15) || 'inhoud'],
    negativeKeywords: ['vacature', 'salaris', 'gratis', 'examen oefenen'],
    matchTypeAdviceNl: `Demo: woordgroep-match per thema, exact op de opleidingsnaam; breed zoeken pas met conversiedata. ${MOCK_MARKER}`,
    finalUrl: ctaUrl,
    rationaleNl: `Koppen volgen de kernboodschap uit de briefing en het Google Ads-kader voor deze fase; er zijn geen zoekvolumes of klikprijzen bij, want die kent dit systeem niet. ${MOCK_MARKER}`,
  };
}

/**
 * One mock piece per channel, long enough to pass the house-style checks and
 * different enough from every other piece to pass the repetition check.
 *
 * The browser smoke run and the integration tests generate with this adapter,
 * so it has to satisfy the same rules a real model is held to: minimum words,
 * sections on a page and a mail, hashtags on a post, a website form, search
 * phrases used literally, no ten-word run copied from a fact, and no two
 * pieces alike. The text is built from sentence banks chosen by channel and
 * by stage, so any two pieces share little; every string carries the demo
 * marker so it can never be mistaken for finished copy.
 */
interface MockPiece {
  hook: string;
  body: string;
  sections: { heading: string; text: string }[];
  hashtags: string[];
  keywordsUsed: string[];
  website: z.infer<typeof contentCopy>['website'];
}

const STAGE_INDEX: Record<FunnelStage, number> = { discover: 0, consider: 1, decide: 2 };

/** The first words of a fact: usable as a fact, too short to count as recitation. */
function factPhrases(context: MockContext): string[] {
  return context.confirmedFacts.slice(0, 3).map((fact) => {
    const words = fact.value.split(/\s+/u).filter((word) => word.length > 0).slice(0, 7).join(' ');
    return `${fact.label.toLowerCase()}: ${words}`;
  });
}

/** The stage's own message when the briefing has one, else the generic line. */
function stageLine(context: MockContext, course: string): string {
  if (context.stageMessage.length > 0) return context.stageMessage.replace(MOCK_MARKER, '').trim();
  return context.funnelStage === 'discover'
    ? `Steeds meer verantwoordelijkheid vraagt om een stevige basis, en ${course} legt die.`
    : context.funnelStage === 'decide'
      ? `De praktische stap naar ${course}: wat het vraagt en hoe je begint.`
      : `Wat ${course} inhoudt, voor wie het is en hoe het werkt.`;
}

/** Sentences about the stage, phrased for a reader in it. Six per stage. */
function stageSentences(stage: FunnelStage | null, course: string): string[] {
  switch (stage) {
    case 'discover':
      return [
        `Je merkt het aan de vragen die op je bureau landen: verzuim, regie, samenwerking, en steeds vaker jij als aanspreekpunt.`,
        `Dat moment, waarop de verantwoordelijkheid groter is dan de basis waarop je die draagt, herkennen veel professionals pas achteraf.`,
        `Een opleiding is dan geen ambitie maar een antwoord op iets dat al speelt in je werk.`,
        `In deze fase gaat het niet over prijzen of data, maar over de vraag of dit jouw situatie is.`,
        `Wie de eigen rol serieus neemt, wil weten waar de grens ligt tussen ervaring en onderbouwde kennis.`,
        `Lees waarom collega's in vergelijkbare rollen deze stap zetten, en herken wat voor jou geldt.`,
      ];
    case 'decide':
      return [
        `De vraag is nu praktisch: wanneer begin je, wat vraagt het van je agenda en hoe schrijf je je in.`,
        `Een studiebelasting is pas te plannen als je weet hoe de weken eruitzien; daarom staat hier hoe de opleiding is opgebouwd.`,
        `Toelating, afronding en startmomenten zijn de feiten die een keuze definitief maken.`,
        `Twijfel je nog, dan is een gesprek over jouw situatie de kortste weg naar zekerheid.`,
        `Alles wat hier staat komt uit de gecontroleerde opleidingsinformatie; wat niet is gecontroleerd, staat er niet.`,
        `Inschrijven is één stap, en je kunt die vandaag zetten met de knop onder deze tekst.`,
      ];
    case 'consider':
    case null:
    default:
      return [
        `Vergelijken begint met weten wat je precies leert, in welke volgorde en met welke praktijkopdrachten.`,
        `De opbouw van ${course} volgt de vragen die je in je werk tegenkomt, niet de hoofdstukken van een boek.`,
        `Voor wie de opleiding bedoeld is zegt veel over het niveau en het tempo dat je kunt verwachten.`,
        `Blended leren betekent hier dat je lesdagen en zelfstudie afwisselt, met een examen dat op de praktijk is geënt.`,
        `Zet de inhoud naast je eigen werkweek en je ziet snel waar de opleiding aansluit en waar niet.`,
        `Een goede vergelijking eindigt niet bij de brochure maar bij de vraag welke taken je straks anders doet.`,
      ];
  }
}

/** Three sentences in the channel's own voice; what makes a post a post and a mail a mail. */
function channelSentences(channel: MarketingChannel, course: string): string[] {
  switch (channel) {
    case 'linkedin_organic':
      return [
        `Op LinkedIn lees je dit waarschijnlijk tussen twee vergaderingen door, dus hier de kern zonder omhaal.`,
        `Deel gerust je eigen ervaring in de reacties: welke vraag over verzuim kwam deze week op je bureau?`,
        `Voor wie de opleiding overweegt staat de volledige opbouw op de opleidingspagina, zonder verkooppraat.`,
      ];
    case 'instagram_organic':
      return [
        `Swipe niet weg: dit is de korte versie van wat ${course} voor je werk betekent.`,
        `Bewaar dit bericht als je later rustig wilt vergelijken.`,
        `De link in bio brengt je naar de opleidingspagina met alle gecontroleerde informatie.`,
      ];
    case 'facebook_organic':
      return [
        `Ken je iemand die deze stap overweegt, tag die persoon dan in de reacties.`,
        `Op Facebook houden we het kort; de uitgebreide toelichting staat op de opleidingspagina.`,
        `Vragen over de opleiding kun je hieronder stellen, we antwoorden binnen kantooruren.`,
      ];
    case 'landing_page':
    case 'course_page_update':
      return [
        `Deze pagina zet op een rij wat je moet weten om een goede keuze te maken, zonder dingen mooier te maken dan ze zijn.`,
        `Elke sectie beantwoordt één vraag die lezers ons stellen, in de volgorde waarin die vragen meestal komen.`,
        `Onderaan vind je de volgende stap; tot die tijd lees je alleen gecontroleerde informatie.`,
      ];
    case 'blog_article':
      return [
        `Dit artikel behandelt één vraag uit de praktijk en werkt die uit tot een antwoord waar je iets mee kunt.`,
        `Elke alinea staat op zichzelf, zodat je kunt scannen en alsnog begrijpt wat er staat.`,
        `Onderaan staat waar je verder leest als je na dit artikel een opleiding overweegt.`,
      ];
    case 'email':
      return [
        `Je krijgt deze mail omdat je eerder informatie over de opleiding hebt bekeken.`,
        `Hieronder de drie dingen die lezers ons het vaakst vragen, elk kort beantwoord.`,
        `Wil je deze mails niet meer ontvangen, dan kun je dat onderaan aangeven.`,
      ];
    case 'linkedin_ads':
      return [
        `Deze advertentie op LinkedIn richt zich op professionals met een verzuimrol.`,
        `De koppen wisselen af; elke kop is los leesbaar.`,
        `Er staan geen resultaatverwachtingen bij, want die kennen we niet.`,
      ];
    case 'meta_ads':
      return [
        `Deze advertentie via Meta bereikt een gekozen doelgroep, niet een zoekterm.`,
        `De beschrijvingen zijn los van elkaar te lezen.`,
        `Bereik en kosten volgen uit het advertentieaccount, niet uit deze tekst.`,
      ];
    case 'google_search_ads':
    default:
      return [
        `Deze zoekadvertentie verschijnt bij wie zelf zoekt naar de opleiding.`,
        `De zoektermen zijn suggesties, zonder volume of klikprijs.`,
        `Controleer de tekstlimieten in Google Ads voordat je iets aanzet.`,
      ];
  }
}

/** A sentence that uses the first search phrases literally, so `keywordsUsed` is true. */
function keywordSentence(keywords: readonly string[]): { sentence: string; used: string[] } {
  const used = keywords.slice(0, 2);
  if (used.length === 0) return { sentence: '', used: [] };
  return {
    sentence:
      used.length === 1
        ? `Zoek je op "${used[0] ?? ''}", dan is dit de pagina waar je het antwoord vindt.`
        : `Zoek je op "${used[0] ?? ''}" of "${used[1] ?? ''}", dan is dit de tekst waar je het antwoord vindt.`,
    used,
  };
}

/** `#CamelCase` tags from the course, the field and the search phrases; count per channel. */
function hashtagsFor(channel: MarketingChannel, course: string, keywords: readonly string[]): string[] {
  const count = channel === 'linkedin_organic' ? 4 : channel === 'instagram_organic' ? 6 : channel === 'facebook_organic' ? 2 : 0;
  if (count === 0) return [];
  const camel = (phrase: string): string =>
    phrase
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 0)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  const candidates = [camel(course), ...keywords.map(camel), 'Opleiding', 'Ontwikkeling', 'Vakkennis', 'Loopbaan', 'Bijscholing', 'Praktijk'];
  const tags: string[] = [];
  for (const candidate of candidates) {
    const tag = candidate.replace(/[^\p{L}\p{N}_]/gu, '');
    if (tag.length >= 2 && tag.length <= 40 && /\p{L}/u.test(tag) && !tags.includes(`#${tag}`)) tags.push(`#${tag}`);
    if (tags.length === count) break;
  }
  return tags;
}

/** A hook in the channel's shape, about the stage; never the same across channels. */
function hookFor(channel: MarketingChannel, course: string, context: MockContext): string {
  const stage = context.funnelStage;
  // A second piece of the same cell needs its own hook. The LinkedIn hook was
  // the stage line verbatim, so two pieces scored a perfect match on the hook
  // and the repeat check refused the second one before the body mattered.
  const message = context.pieceNumber <= 1 ? stageLine(context, course) : repeatHook(course, context.pieceNumber);
  switch (channel) {
    case 'linkedin_organic':
      return message;
    case 'instagram_organic':
      return stage === 'discover' ? `Herken je dit moment?` : stage === 'decide' ? `${course}: zo begin je.` : `Wat leer je nu echt bij ${course}?`;
    case 'facebook_organic':
      return stage === 'discover'
        ? `Voor wie steeds vaker het aanspreekpunt is bij verzuim`
        : stage === 'decide'
          ? `Inschrijven voor ${course}: de praktische stap`
          : `${course} in het kort, om rustig te vergelijken`;
    case 'landing_page':
    case 'course_page_update':
      return stage === 'discover'
        ? `Wanneer is ${course} de logische volgende stap?`
        : stage === 'decide'
          ? `${course}: opbouw, toelating en inschrijving`
          : `${course}: inhoud, doelgroep en werkwijze om te vergelijken`;
    case 'blog_article':
      return stage === 'discover'
        ? `Wat komt er kijken bij regie op verzuim?`
        : stage === 'decide'
          ? `Van oriënteren naar inschrijven: wat je vooraf wilt weten`
          : `Waar let je op als je opleidingen naast elkaar legt?`;
    case 'email':
      return stage === 'discover'
        ? `Herkenbaar? Meer regie, minder houvast`
        : stage === 'decide'
          ? `Je inschrijving voor ${course} in drie stappen`
          : `Drie vragen over ${course}, kort beantwoord`;
    case 'linkedin_ads':
      return stage === 'discover'
        ? `Herken je het moment waarop ervaring niet meer genoeg is?`
        : stage === 'decide'
          ? `${course}: start, opbouw en inschrijving`
          : `${course} voor professionals die willen vergelijken`;
    case 'meta_ads':
      return stage === 'discover'
        ? `Meer regie op je werk begint bij een stevige basis`
        : stage === 'decide'
          ? `Vandaag inschrijven voor ${course}`
          : `Wat ${course} je in de praktijk oplevert`;
    case 'google_search_ads':
    default:
      return stage === 'discover'
        ? `Opleiding voor wie regie op verzuim wil`
        : stage === 'decide'
          ? `Inschrijven ${course}`
          : `Opleiding ${course}: inhoud en opzet`;
  }
}

/**
 * A body from the banks: the channel's three sentences, two of the stage's six
 * (which two depends on the channel), the keyword sentence, a fact phrased for
 * the stage, and the stage message. Two pieces of one stage share at most the
 * fact; two stages of one channel share only the channel's voice.
 */
function bodyFor(channel: MarketingChannel, course: string, context: MockContext, keywords: readonly string[]): { body: string; used: string[] } {
  const channelIndex = marketingChannel.options.indexOf(channel);
  const stageBank = stageSentences(context.funnelStage, course);
  // The piece shifts the pick by an odd stride, so piece two of a cell draws
  // different sentences than piece one. A stride of 2 or 6 lands back on the
  // same pair in a bank of six, which is exactly how the first attempt at this
  // produced two identical posts (2026-09-15).
  const base = channelIndex * 2 + (context.pieceNumber - 1) * 3;
  const picked = [stageBank[base % stageBank.length], stageBank[(base + 1) % stageBank.length]].filter(
    (sentence): sentence is string => sentence !== undefined,
  );
  const facts = factPhrases(context);
  const stageIndex = context.funnelStage === null ? 0 : STAGE_INDEX[context.funnelStage];
  const factPhrasings = [
    `Wat vaststaat: ${facts.join('; ')}.`,
    `Gecontroleerd op de opleidingskaart: ${facts.join(' · ')}.`,
    `Deze feiten zijn bevestigd: ${facts.join(', ')}.`,
  ];
  const factSentence =
    facts.length === 0
      ? 'De opleidingsinformatie is nog niet gecontroleerd, dus staan hier geen details.'
      : factPhrasings[(stageIndex + context.pieceNumber - 1 + channelIndex) % factPhrasings.length] ?? '';
  const keyword = keywordSentence(keywords);
  // Piece one speaks in the channel's own voice; later pieces of the same cell
  // use a second bank, because rotating the same three sentences still reads as
  // the same post to the house-style repeat check — and to a reader.
  const voice =
    context.pieceNumber <= 1
      ? channelSentences(channel, course)
      : repeatVoice(channel, course, context.pieceNumber);
  // A second piece for the same cell opens on a different question, or the
  // house-style repeat check refuses it — correctly, since the two would be the
  // same post twice.
  const opener =
    channel === 'blog_article'
      ? `Deze vraag komt in de praktijk vaker terug dan je zou denken, en het antwoord raakt meer onderwerpen tegelijk.`
      : pieceOpener(context, course);
  const sentences =
    channel === 'instagram_organic'
      ? [opener, picked[0] ?? '', voice[0] ?? '', keyword.sentence, voice[2] ?? '']
      : channel === 'facebook_organic'
        ? [opener, picked[0] ?? '', voice[0] ?? '', keyword.sentence, factSentence, voice[1] ?? '']
        : AD_CHANNELS.has(channel)
          ? [opener, voice[0] ?? '', factSentence]
          : channel === 'blog_article'
            // An article answers the reader's question; reciting the course
            // facts is what `copied_fact_sentence` warns about, and it made the
            // article read as the page change with another opening.
            ? [opener, ...picked, voice[0] ?? '', keyword.sentence, voice[1] ?? '', voice[2] ?? '']
            : [opener, ...picked, voice[0] ?? '', keyword.sentence, factSentence, voice[1] ?? '', voice[2] ?? ''];
  const body = `${MOCK_MARKER}\n\n${sentences.filter((sentence) => sentence.length > 0).join(' ')}`;
  return { body, used: keyword.used };
}

/** The hook of a second or later piece: another entry into the same message. */
function repeatHook(course: string, piece: number): string {
  const hooks = [
    `Wat komt er na de herkenning? De volgende vraag rond ${course}.`,
    `Een dossier, drie partijen, één regie: hoe houd je overzicht?`,
    `De stap van meedenken naar verantwoordelijk zijn, bij ${course}.`,
  ];
  return hooks[(piece - 2) % hooks.length] ?? `${course}: nog een invalshoek.`;
}

/**
 * The channel voice for a second or later piece of the same cell.
 *
 * Differently worded rather than reordered: a person writing four LinkedIn
 * posts for one stage writes four different posts, and the house-style repeat
 * check measures words, not order.
 */
function repeatVoice(channel: MarketingChannel, course: string, piece: number): string[] {
  const banks = [
    [
      `Waar het vorige bericht bij herkenning bleef, gaat dit over wat er daarna nodig is.`,
      `Collega's in dezelfde rol lopen tegen andere dingen aan; daarom hier een tweede invalshoek.`,
      `Wie wil doorlezen vindt de opbouw en toelating bij ${course} op de opleidingspagina.`,
    ],
    [
      `Een dossier ziet er op papier anders uit dan in een gesprek, en dat verschil zit in dit bericht.`,
      `Denk even terug aan de laatste keer dat een vraag over verzuim bij jou terechtkwam.`,
      `De volledige inhoud van ${course} staat online, met alleen gecontroleerde informatie.`,
    ],
    [
      `Dit stuk kijkt naar de samenwerking rond een dossier in plaats van naar de inhoud ervan.`,
      `Kort en praktisch, want de details lezen zich beter op een rustig moment.`,
      `Bekijk daarvoor de pagina van ${course}, waar alles op een rij staat.`,
    ],
  ];
  return banks[(piece - 2) % banks.length] ?? channelSentences(channel, course);
}

/**
 * The opening sentence of one piece of a cell.
 *
 * Piece one keeps the stage message as its opening; every later piece takes a
 * different angle on the same message, which is what a person writing four
 * posts for one stage would do, and what the repeat check demands.
 */
function pieceOpener(context: MockContext, course: string): string {
  const line = stageLine(context, course);
  if (context.pieceNumber <= 1) return line;
  const angles = [
    `Nog een kant van ${course}: waar loopt iemand in de praktijk tegenaan voordat deze vraag speelt?`,
    `Vanuit de dagelijkse praktijk bekeken roept ${course} een andere vraag op dan de vorige keer.`,
    `Waar het eerder ging om herkenning, gaat het hier om de stap die daarna volgt bij ${course}.`,
    `Een derde ingang op hetzelfde onderwerp: wat verandert er concreet in het werk rond ${course}?`,
  ];
  return angles[(context.pieceNumber - 2) % angles.length] ?? line;
}

/** A ~130-word explanatory section on one topic, from templates the topic fills. */
function sectionText(topic: string, course: string, facts: readonly string[], seed: number): string {
  const fact = facts[seed % Math.max(1, facts.length)] ?? 'de gecontroleerde opleidingsinformatie';
  const templates = [
    `${topic} is een van de eerste dingen die lezers willen weten voordat zij ${course} serieus overwegen.`,
    `Wij beantwoorden die vraag met wat vaststaat, namelijk ${fact}, en laten weg wat nog niet is gecontroleerd.`,
    `In de praktijk betekent dit dat je van tevoren weet waar je aan begint en wat de opleiding van je vraagt.`,
    `Veel deelnemers combineren de opleiding met een volledige baan, en juist dan telt een heldere verwachting.`,
    `Neem de tijd om dit onderdeel naast je eigen werkweek te leggen en te kijken waar het aansluit.`,
    `Heb je na het lezen nog een vraag over ${topic.toLowerCase()}, dan staat het antwoord meestal op de opleidingspagina of krijg je het in een gesprek.`,
    `Wat hier staat is geschreven voor de lezer die wil vergelijken, niet voor een zoekmachine, en toch vind je de belangrijkste termen terug.`,
    `Zo bouw je stap voor stap een beeld op dat klopt met de werkelijkheid van de opleiding en met jouw situatie.`,
    `De volgende sectie gaat verder waar deze ophoudt, zodat de pagina als één verhaal leest.`,
    `Alles wat je hier leest is voorbeeldtekst van de demo-omgeving en wordt bij een echte generatie vervangen.`,
  ];
  const ordered = [...templates.slice(seed % templates.length), ...templates.slice(0, seed % templates.length)];
  return `${ordered.join(' ')} ${MOCK_MARKER}`;
}

/**
 * A blog article that passes the article checks (article-quality.ts).
 *
 * The demo path has to hold to the same practice a real model is held to:
 * the reader's question as the title, a quotable direct answer, an intro
 * without the course, question headings whose text stands alone, one
 * scenario, the course only in the bridge sentence and the path section,
 * three follow-up questions, a benefit-led close, no exclamation marks, no
 * superlatives, no number that is not on the course card. Every sentence is
 * short, so a reviewer reads demo output that looks like the real thing —
 * marked as demo text throughout.
 */
function mockArticle(
  course: string,
  cta: string,
  keywords: readonly string[],
  facts: readonly string[],
  context: MockContext,
  base: { hook: string; body: string; used: string[] },
): MockPiece {
  const first = keywords[0] ?? 'regie op verzuim';
  const factLine = facts.length > 0 ? `Wat vaststaat over de opleiding: ${facts.join('; ')}.` : 'De opleidingsinformatie is nog niet gecontroleerd, dus noemt dit stuk geen details.';

  /*
   * A different article per stage. The reader of Ontdekken asks whether this
   * is about them; of Overwegen how it is done; of Beslissen what it takes to
   * start. Three openings, so a full-funnel campaign gets three articles
   * rather than one article three times — which the repetition check would
   * refuse, as it should.
   */
  const stage = context.funnelStage ?? 'consider';
  const opening = {
    discover: {
      title: 'Wanneer wordt regie op verzuim een taak voor jou?',
      answer: [
        'Regie op verzuim wordt jouw taak op het moment dat leidinggevenden en collega’s bij jou komen met vragen die zij zelf niet meer kunnen beantwoorden.',
        'Herkenbaar is het als je merkt dat je afspraken bewaakt, gesprekken plant en verslagen leest die niemand anders leest.',
        'Vanaf dat moment ben je de regisseur, ook zonder de titel.',
      ],
      intro: [
        'Veel professionals groeien in de rol zonder dat iemand die rol benoemt.',
        'Eerst help je een leidinggevende met één dossier, later vragen ze je bij elk dossier.',
        'De verantwoordelijkheid groeit sneller dan de basis waarop je haar draagt.',
        'Dit artikel helpt je dat moment te herkennen en te beoordelen wat het van je vraagt.',
      ],
    },
    consider: {
      title: 'Hoe houd je regie op een verzuimdossier naast je gewone werk?',
      answer: [
        'Regie op een verzuimdossier betekent dat één persoon het overzicht houdt, de afspraken bewaakt en de betrokkenen op tijd bij elkaar brengt.',
        'Dat lukt naast het gewone werk als de stappen vastliggen, de rollen duidelijk zijn en je weet welke wet welke termijn stelt.',
        'De rest is planning en communicatie.',
      ],
      intro: [
        'Het begint vaak klein: een collega meldt zich ziek en jij krijgt het dossier erbij.',
        'Na een paar weken komen de vragen: wie doet wat, wanneer moet welk stuk klaar zijn, en wie beslist over het vervolg.',
        'Wie dan geen structuur heeft, loopt achter de feiten aan.',
        'Dit artikel zet op een rij wat regie in de praktijk vraagt en waar het het vaakst misgaat.',
      ],
    },
    decide: {
      title: 'Wat heb je nodig om regie op verzuim goed te gaan doen?',
      answer: [
        'Om regie op verzuim goed te doen heb je drie dingen nodig: kennis van de regels en termijnen, een vaste werkwijze per dossier en de vaardigheid om lastige gesprekken te voeren.',
        'De kennis is te leren; de werkwijze en de gesprekken vragen oefening met mensen die het werk kennen.',
      ],
      intro: [
        'Je weet inmiddels wat regie vraagt en waar het misgaat.',
        'De vraag is nu praktisch: wat moet je zelf kunnen, wat regel je in je organisatie en waar begin je.',
        'Dit artikel zet de stappen op een rij die je zet voordat je een dossier volledig onder je hoede neemt.',
        'Het eindigt met wat een opleiding daarin wel en niet oplost.',
      ],
    },
  }[stage];

  const title = opening.title;
  const metaBase = `${first}: wat regie in de praktijk vraagt, waar het misgaat en wat je nodig hebt om het goed te doen. Zonder verkooppraat.`;
  const metaDescription = metaBase.length >= 120 ? metaBase.slice(0, 155) : `${metaBase} Geschreven voor wie de vraag zelf in het werk tegenkomt.`.slice(0, 155);
  const directAnswerNl = [...opening.answer, MOCK_MARKER].join(' ');
  const intro = [...opening.intro, MOCK_MARKER].join(' ');

  const sectionsSpec: readonly [string, string, string][] = [
    ['Wat betekent regie op een verzuimdossier precies?', 'regie', 'het overzicht houden en de afspraken bewaken'],
    ['Waarom loopt een verzuimdossier zo vaak vast?', 'stagnatie', 'onduidelijke rollen en gemiste termijnen'],
    ['Welke stappen horen bij goede verzuimbegeleiding?', 'de stappen', 'een vaste volgorde van gesprekken en verslagen'],
    ['Hoe werk je samen met de bedrijfsarts en de leidinggevende?', 'samenwerking', 'ieder zijn eigen rol en één gedeeld doel'],
    ['Wat moet je zelf kunnen om regie te voeren?', 'de competenties', 'kennis van de regels en het gesprek durven voeren'],
  ];
  const stageSeed = stage === 'discover' ? 0 : stage === 'consider' ? 2 : 4;
  const sections = sectionsSpec.map(([heading, topic, gist], index) => ({
    heading,
    text: articleSection(topic, gist, index + stageSeed),
  }));

  const scenarioNl = [
    'Een casemanager bij een middelgrote zorgorganisatie krijgt een dossier van een medewerker die al enkele weken thuis zit.',
    'De leidinggevende heeft twee gesprekken gevoerd, maar niets vastgelegd.',
    'De bedrijfsarts heeft advies gegeven dat niemand heeft gelezen.',
    'De casemanager plant één overleg, legt de afspraken vast en verdeelt de taken.',
    'Binnen een week weet iedereen weer wat er van hem wordt verwacht.',
    MOCK_MARKER,
  ].join(' ');

  const midCtaNl = `Hoe je die structuur zelf opbouwt en volhoudt, is precies wat ${course} behandelt. ${MOCK_MARKER}`;

  const coursePathNl = [
    'Wie regie wil voeren, heeft drie dingen nodig: kennis van de regels, een vaste werkwijze en het vermogen om lastige gesprekken te voeren.',
    'De kennis leer je uit boeken en wetten; de werkwijze en de gesprekken leer je door te oefenen met mensen die het werk kennen.',
    `${course} is bedoeld voor wie die combinatie in de praktijk nodig heeft.`,
    factLine,
    'Wat de opleiding niet is: een garantie op een uitkomst. Wat zij wel is: een gestructureerde manier om het werk dat je al doet, te onderbouwen.',
    'Twijfel je over de combinatie met je baan, kijk dan naar de opzet op de opleidingspagina en leg die naast je eigen werkweek.',
    MOCK_MARKER,
  ].join(' ').replace('garantie op een uitkomst', 'belofte over een uitkomst');

  const faq = [
    {
      question: 'Mag een leidinggevende zelf de regie op een verzuimdossier houden?',
      answer: `Dat mag, zolang de leidinggevende de termijnen kent en de gesprekken vastlegt. In de praktijk gaat het mis als niemand het overzicht bewaakt. Een casemanager neemt die rol dan over of ondersteunt de leidinggevende erbij. ${MOCK_MARKER}`,
    },
    {
      question: 'Hoeveel tijd kost regie op een dossier per week?',
      answer: `Dat hangt af van de fase van het dossier en van hoeveel partijen betrokken zijn. Een dossier met heldere afspraken kost vooral tijd rond de gesprekken en de verslagen. Zonder structuur kost het elke week tijd aan uitzoeken wie wat moet doen. ${MOCK_MARKER}`,
    },
    {
      question: 'Wat doe je als het advies van de bedrijfsarts niet wordt opgevolgd?',
      answer: `Leg vast wat het advies was, wie het heeft ontvangen en wat er wel en niet mee is gedaan. Bespreek het verschil in het eerstvolgende overleg met de betrokkenen. Zo blijft het dossier controleerbaar en blijft de verantwoordelijkheid waar zij hoort. ${MOCK_MARKER}`,
    },
  ];

  const closingCtaNl = `Bekijk het programma en de opzet van ${course} en zie of het aansluit op mijn praktijk.`;

  const groundingRefs = context.groundingRefs.slice(0, 1);
  const externalFacts = groundingRefs.map((sourceRef) => ({
    statementNl: `Een openbare bron over deze doelgroep beschrijft regie op verzuim als een taak die overzicht en vastlegging vraagt. ${MOCK_MARKER}`,
    sourceRef,
  }));

  return {
    hook: base.hook,
    body: intro,
    sections,
    hashtags: [],
    // Only the phrases that literally occur in the article; the checker verifies each.
    keywordsUsed: keywords
      .filter((phrase) =>
        [metaDescription, title, directAnswerNl, intro, coursePathNl, ...sections.map((section) => section.text)]
          .join('\n')
          .toLowerCase()
          .includes(phrase.toLowerCase()),
      )
      .slice(0, 5),
    website: {
      form: 'blog_article',
      title,
      metaDescription,
      directAnswerNl,
      intro,
      sections,
      scenarioNl,
      externalFacts,
      midCtaNl,
      midCtaAfterSection: 1,
      coursePathNl,
      faq,
      closingCtaNl,
      internalLinkText: `${cta}: ${course}`,
    },
  };
}

/**
 * One article section of about a hundred and thirty words, in short
 * sentences, on one topic, without the course and without a number. The
 * first sentence answers the heading on its own.
 */
function articleSection(topic: string, gist: string, seed: number): string {
  const opening = [
    `Het antwoord is ${gist}.`,
    `In de kern gaat ${topic} over ${gist}.`,
    `Goed geregeld betekent ${topic}: ${gist}.`,
    `Bij ${topic} draait alles om ${gist}.`,
    `Wie ${topic} serieus neemt, begint bij ${gist}.`,
  ][seed % 5] ?? `Het antwoord is ${gist}.`;
  const body = [
    'Wie het werk kent, herkent het moment waarop het misgaat: niemand heeft het laatste gesprek vastgelegd.',
    'De oplossing is zelden meer overleg, maar duidelijker overleg met een vaste agenda.',
    'Elke betrokkene weet dan wat er van hem wordt verwacht en wanneer.',
    'De leidinggevende houdt het contact met de medewerker; de casemanager houdt het overzicht.',
    'De bedrijfsarts adviseert, en het advies krijgt een plek in het dossier.',
    'Termijnen uit de wet zijn geen administratie, maar het ritme van het dossier.',
    'Wie ze kent, plant de gesprekken op tijd en voorkomt dat een stap vergeten wordt.',
    'Vastleggen is geen wantrouwen; het is de manier om later te kunnen laten zien wat er is gedaan.',
    'Een goed verslag is kort, feitelijk en voor iedereen leesbaar.',
    'Zo wordt regie een gewoonte in plaats van een reddingsactie.',
  ];
  const ordered = [...body.slice(seed % body.length), ...body.slice(0, seed % body.length)];
  return `${opening} ${ordered.join(' ')} ${MOCK_MARKER}`;
}

/**
 * The whole piece for a channel. A page becomes a change proposal when the
 * course page could be read (quoting its first words literally), otherwise an
 * article; a mail gets three titled parts; a post gets its hashtags.
 */
function mockPiece(channel: MarketingChannel, course: string, cta: string, context: MockContext): MockPiece {
  const keywords = context.keywords.map((keyword) => keyword.phrase);
  const hook = hookFor(channel, course, context);
  const { body, used } = bodyFor(channel, course, context, keywords);
  const facts = factPhrases(context);
  const stageIndex = context.funnelStage === null ? 0 : STAGE_INDEX[context.funnelStage];

  if (channel === 'blog_article') {
    return mockArticle(course, cta, keywords, facts, context, { hook, body, used });
  }

  if (channel === 'course_page_update' || channel === 'landing_page') {
    if (context.coursePageText.length > 0 && context.coursePageUrl !== null) {
      // The first words of the page, literally: the one passage certain to be there.
      const excerpt = context.coursePageText.split(/\s+/u).filter((word) => word.length > 0).slice(0, 18).join(' ');
      const changes = [
        {
          placement: 'Boven de eerste kop, als inleiding voor deze fase',
          reason: `De pagina opent met feiten, maar de lezer in deze fase heeft eerst een antwoord nodig op de vraag of dit zijn situatie is. ${MOCK_MARKER}`,
          currentExcerpt: excerpt,
          proposedText: sectionText('De opening voor deze lezer', course, facts, stageIndex),
        },
        {
          placement: 'Onder de sectie over de inhoud, als nieuwe alinea',
          reason: `De inhoud staat op de pagina, maar niet wat de lezer er in de praktijk anders mee doet; dat is wat deze fase vraagt. ${MOCK_MARKER}`,
          currentExcerpt: excerpt,
          proposedText: sectionText('Wat je hierna anders doet', course, facts, stageIndex + 1),
        },
      ];
      return {
        hook,
        body,
        sections: changes.map((change) => ({ heading: change.placement, text: change.proposedText })),
        hashtags: [],
        keywordsUsed: used,
        website: { form: 'course_page_update', pageUrl: context.coursePageUrl, changes },
      };
    }
    /*
     * The page could not be read, and the answer is no longer an article.
     *
     * Falling back to `mockArticle` here was the mock's version of the silent
     * substitution the split removed: the channel asked for a change proposal
     * and got a blog, which then read as a duplicate of the real blog in the
     * same stage (2026-09-15). It now returns the proposal it was asked for,
     * with a passage that is plainly not from the page — which is what
     * `page_unavailable` and `page_excerpt_not_found` exist to flag.
     */
    const blindChanges = [
      {
        placement: 'Boven de eerste kop, als inleiding voor deze fase',
        reason: `De opleidingspagina kon niet worden gelezen, dus is niet vast te stellen wat er nu staat. ${MOCK_MARKER}`,
        currentExcerpt: 'De opleidingspagina kon niet worden gelezen.',
        proposedText: sectionText('De opening voor deze lezer', course, facts, stageIndex),
      },
    ];
    return {
      hook,
      body,
      sections: blindChanges.map((change) => ({ heading: change.placement, text: change.proposedText })),
      hashtags: [],
      keywordsUsed: used,
      website: {
        form: 'course_page_update',
        pageUrl: context.coursePageUrl ?? 'https://voorbeeld.nl/opleiding',
        changes: blindChanges,
      },
    };
  }

  if (channel === 'email') {
    const topics = ['Voor wie de opleiding is', 'Wat je leert', 'Hoe je begint'];
    return {
      hook,
      body,
      sections: topics.map((topic, index) => ({
        heading: topic,
        text: sectionText(topic, course, facts, stageIndex + index).split(' ').slice(0, 60).join(' '),
      })),
      hashtags: [],
      keywordsUsed: used,
      website: null,
    };
  }

  return {
    hook,
    body,
    sections: [],
    hashtags: hashtagsFor(channel, course, keywords),
    keywordsUsed: used,
    website: null,
  };
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
  creativeResearch?: z.infer<typeof creativeResearchSnapshot> | undefined;
  /**
   * Which piece of its cell this call writes, from `<welk_stuk>`.
   *
   * A plan may ask for four LinkedIn posts in one stage, each written in its
   * own call. Without this the mock returned the same sentences every time and
   * the house-style repeat check refused the second piece (2026-09-15).
   */
  pieceNumber: number;
  courseName: string;
  confirmedFacts: { label: string; value: string }[];
  /** The confirmed fields by id, from `<bewijsvelden>`; empty when the prompt has no stages. */
  confirmedFactFields: CourseFactField[];
  confirmedFactCount: number;
  unconfirmedFactLabels: string[];
  personaNames: string[];
  /** Personas that already exist in the proposal's scope, from `<bestaande_doelgroepen>`. */
  existingPersonaNames: string[];
  /** The persona a questionnaire is filled for, from `<doelgroepprofiel>` ("Naam: samenvatting"). */
  personaProfileName: string | null;
  brandMustNot: string[];
  /** The brand's tone traits and description, from `<merk_toon>`. */
  brandTone: string;
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
  /** The briefing's message for that stage, from `<fase_boodschap>`; empty when the brief has none. */
  stageMessage: string;
  revisionInstruction: string;
  /** Text fetched from a course page, for `course.extract_from_url`. */
  pageText: string;
  pageTitle: string | null;
  /** The briefing's search phrases (or the pool), from `<zoektermen>`. */
  keywords: { phrase: string; sourceRef: string; kind: 'radar' | 'afgeleid' }[];
  /** Source references the personas' groundings carry, from `<doelgroepen>` ("[bron: …]"). */
  groundingRefs: string[];
  /** The live course page for the website piece, from `<opleidingspagina_*>`; empty when unreadable. */
  coursePageUrl: string | null;
  coursePageText: string;
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

  const pieceNumber = Number(/^Dit is stuk (\d+)/u.exec(readBlock('welk_stuk'))?.[1] ?? '1');

  let creativeResearch: z.infer<typeof creativeResearchSnapshot> | undefined;
  try { creativeResearch = creativeResearchSnapshot.parse(JSON.parse(readBlock('creatief_onderzoek'))); } catch { /* Older prompts have no dossier. */ }
  return {
    creativeResearch,
    courseName: readBlock('opleiding') || 'deze opleiding',
    pageText: readBlock('paginatekst'),
    // The first line of extracted text stands in for a title in the mock.
    pageTitle: firstLine(readBlock('paginatekst')),
    confirmedFacts: facts,
    confirmedFactFields: readBlock('bewijsvelden')
      .split('\n')
      .filter((line) => line.endsWith(': gecontroleerd'))
      .map((line) => line.split(' — ')[0]?.trim() ?? '')
      .map((value) => courseFactField.safeParse(value))
      .filter((result) => result.success)
      .map((result) => result.data),
    confirmedFactCount: facts.length,
    unconfirmedFactLabels: readBlock('niet_gecontroleerd')
      .split(/[,\n]/u)
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    // Only the header line of each persona ("- Naam: samenvatting"); the
    // indented detail lines ("  Behoefte: …") are not names.
    personaNames: readBlock('doelgroepen')
      .split('\n')
      .filter((line) => /^[-·*]\s/u.test(line))
      .map((line) => line.replace(/^[-·*]\s*/u, '').split(':')[0]?.trim() ?? '')
      .filter((value) => value.length > 0),
    existingPersonaNames: readBlock('bestaande_doelgroepen')
      .split('\n')
      .map((line) => line.replace(/^[-·*]\s*/u, '').split(' — ')[0]?.trim() ?? '')
      .filter((value) => value.length > 0),
    personaProfileName: (() => {
      const name = firstLine(readBlock('doelgroepprofiel'))?.split(':')[0]?.trim() ?? '';
      return name.length === 0 ? null : name;
    })(),
    brandTone: readBlock('merk_toon').replace(/\s+/gu, ' ').trim(),
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
    pieceNumber,
    funnelStages: stageIds(readBlock('funnelfasen')),
    funnelStage: stageIds(readBlock('funnelfase'))[0] ?? null,
    stageMessage: readBlock('fase_boodschap')
      .split('\n')
      .find((line) => line.startsWith('Boodschap: '))
      ?.slice('Boodschap: '.length)
      .trim() ?? '',
    revisionInstruction: readBlock('revisie_instructie'),
    keywords: readBlock('zoektermen')
      .split('\n')
      .map((line) => line.replace(/^[-·*]\s*/u, '').trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const match = /^(.*?)\s*\[(onderzoek|afgeleid):\s*(.*)\]$/u.exec(line);
        return {
          phrase: (match?.[1] ?? line).trim(),
          sourceRef: (match?.[3] ?? 'onbekend').trim(),
          kind: match?.[2] === 'onderzoek' ? ('radar' as const) : ('afgeleid' as const),
        };
      })
      .filter((keyword) => keyword.phrase.length >= 2),
    groundingRefs: [...readBlock('doelgroepen').matchAll(/\[bron: ([^\]]+)\]/gu)]
      .map((match) => (match[1] ?? '').trim())
      .filter((value) => value.length > 0),
    coursePageUrl: readBlock('opleidingspagina_url') || null,
    coursePageText: readBlock('opleidingspagina_tekst').startsWith('Niet beschikbaar:')
      ? ''
      : readBlock('opleidingspagina_tekst'),
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
