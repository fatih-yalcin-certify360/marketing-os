import type { FunnelStage } from './funnel.js';

/**
 * Google Ads as Google documents it, read on 2026-09-15.
 *
 * Two things live here. The **text limits** of a responsive search ad, which
 * the copy checks enforce and the channel specification cites; and the
 * **frame per funnel stage** — what the campaign objective is in Google's
 * vocabulary when a stage is served with Google Ads, which campaign type,
 * which conversion actions to configure before the first euro, how bidding
 * grows with data, and what the EEA requires. Every entry names the help
 * page it comes from; `docs/product/google-ads-practice.md` holds the
 * reading. No figure here is ours: where Google publishes no number, none
 * is stated.
 */

export const GOOGLE_ADS_VERIFIED_AT = '2026-09-15T00:00:00.000Z';

export interface GoogleAdsSource {
  titleNl: string;
  url: string;
}

export const GOOGLE_ADS_SOURCES = Object.freeze({
  objectives: { titleNl: 'Een campagnedoel kiezen', url: 'https://support.google.com/google-ads/answer/7450050' },
  campaignTypes: { titleNl: 'Campagnetypen', url: 'https://support.google.com/google-ads/answer/2567043' },
  demandGen: { titleNl: 'Demand Gen-campagnes', url: 'https://support.google.com/google-ads/answer/13695777' },
  leadGen: { titleNl: 'Leadgeneratie met Google Ads', url: 'https://support.google.com/google-ads/answer/13775965' },
  leadGoals: { titleNl: 'Conversiedoelen voor leads', url: 'https://support.google.com/google-ads/answer/13489421' },
  rsa: { titleNl: 'Responsieve zoekadvertenties', url: 'https://support.google.com/google-ads/answer/7684791' },
  rsaEffective: { titleNl: 'Effectieve responsieve zoekadvertenties', url: 'https://support.google.com/google-ads/answer/6167122' },
  adStrength: { titleNl: 'Advertentiesterkte', url: 'https://support.google.com/google-ads/answer/9921843' },
  editorial: { titleNl: 'Redactioneel beleid', url: 'https://support.google.com/adspolicy/answer/6021546' },
  punctuation: { titleNl: 'Leestekens en symbolen', url: 'https://support.google.com/adspolicy/answer/14847994' },
  capitalization: { titleNl: 'Hoofdlettergebruik', url: 'https://support.google.com/adspolicy/answer/14848295' },
  misrepresentation: { titleNl: 'Misleidende voorstelling', url: 'https://support.google.com/adspolicy/answer/6020955' },
  trademarks: { titleNl: 'Handelsmerken', url: 'https://support.google.com/adspolicy/answer/6118' },
  destinations: { titleNl: 'Bestemmingsvereisten', url: 'https://support.google.com/adspolicy/answer/6368661' },
  matchTypes: { titleNl: 'Zoekwoordopties', url: 'https://support.google.com/google-ads/answer/7478529' },
  negatives: { titleNl: 'Uitsluitingszoekwoorden', url: 'https://support.google.com/google-ads/answer/2453972' },
  adGroups: { titleNl: 'Advertentiegroepen', url: 'https://support.google.com/google-ads/answer/6372655' },
  qualityScore: { titleNl: 'Kwaliteitsscore', url: 'https://support.google.com/google-ads/answer/6167118' },
  conversions: { titleNl: 'Conversies bijhouden', url: 'https://support.google.com/google-ads/answer/1722022' },
  enhancedLeads: { titleNl: 'Verbeterde conversies voor leads', url: 'https://support.google.com/google-ads/answer/9888656' },
  consentMode: { titleNl: 'Toestemmingsmodus', url: 'https://support.google.com/google-ads/answer/13695607' },
  consentPolicy: { titleNl: 'EU-beleid inzake toestemming van gebruikers', url: 'https://www.google.com/about/company/user-consent-policy/' },
  attribution: { titleNl: 'Attributiemodellen', url: 'https://support.google.com/google-ads/answer/6259715' },
  bidding: { titleNl: 'Biedstrategieën', url: 'https://support.google.com/google-ads/answer/2979071' },
  maximizeConversions: { titleNl: 'Conversies maximaliseren', url: 'https://support.google.com/google-ads/answer/7381968' },
  targetCpa: { titleNl: 'Doel-CPA', url: 'https://support.google.com/google-ads/answer/6268632' },
  learning: { titleNl: 'Leerperiode van Slim bieden', url: 'https://support.google.com/google-ads/answer/13020501' },
  evaluation: { titleNl: 'Slim bieden evalueren', url: 'https://support.google.com/google-ads/answer/6268633' },
  budgets: { titleNl: 'Budgetten en uitgaven', url: 'https://support.google.com/google-ads/answer/6385083' },
  landingPage: { titleNl: 'Ervaring op de bestemmingspagina', url: 'https://support.google.com/google-ads/answer/14086' },
  verification: { titleNl: 'Adverteerdersverificatie', url: 'https://support.google.com/adspolicy/answer/9703665' },
  transparency: { titleNl: 'Ads Transparency Center', url: 'https://support.google.com/google-ads/answer/9729263' },
} as const satisfies Record<string, GoogleAdsSource>);

/** The text limits of a responsive search ad, as documented on the page named. */
export const GOOGLE_RSA = Object.freeze({
  headlines: { min: 3, max: 15, maxChars: 30 },
  descriptions: { min: 2, max: 4, maxChars: 90 },
  paths: { max: 2, maxChars: 15 },
  /** Google asks for at least two responsive search ads per ad group. */
  adsPerAdGroup: 2,
  source: GOOGLE_ADS_SOURCES.rsa,
  verifiedAt: GOOGLE_ADS_VERIFIED_AT,
});

/**
 * Our house minimums on top of Google's: a proposal with three headlines is
 * valid for Google and useless for Ad Strength, which wants variety. These
 * are ours and say so.
 */
export const GOOGLE_RSA_HOUSE = Object.freeze({
  minHeadlines: 8,
  minDescriptions: 3,
});

export interface GoogleAdsFrame {
  stage: FunnelStage;
  /** Whether Google Ads is a sensible channel for this stage at all. */
  fit: 'search_first' | 'search_scale' | 'not_search';
  /** The objective in Google's own vocabulary. */
  campaignGoalNl: string;
  campaignTypeNl: string;
  whyNl: string;
  keywordsNl: string;
  negativeKeywordsNl: string;
  /** What to configure before the first euro is spent. */
  conversionActionsNl: string[];
  /** The bidding path as data grows. */
  biddingNl: string[];
  budgetNl: string;
  measurementNl: string;
  landingPageNl: string;
  complianceNl: string[];
  sources: GoogleAdsSource[];
}

const COMMON_COMPLIANCE: readonly string[] = [
  'Toestemmingsmodus v2 (ad_storage, analytics_storage, ad_user_data, ad_personalization) en een cookiebanner volgens het EU-toestemmingsbeleid zijn in de EER vereist om te meten en te remarketen.',
  'Adverteerdersverificatie afronden: een niet-geverifieerd account wordt op de deadline gepauzeerd. Advertenties, betaler en (in de EER) targeting verschijnen in het Ads Transparency Center.',
  'Tekstbeleid: gewone spelling, geen herhaalde leestekens of uitroeptekens in koppen, geen opvallend hoofdlettergebruik, geen onwaarschijnlijk resultaat als waarschijnlijk gepresenteerd; aanbod uit de advertentie moet op de bestemmingspagina staan.',
  'Bestemming: het domein van de weergave-URL is dat van de uiteindelijke URL; geen doorverwijzing naar een ander domein.',
];

const COMMON_BIDDING: readonly string[] = [
  'Start met Klikken maximaliseren (of handmatige CPC) zolang er weinig conversiedata is.',
  'Schakel naar Conversies maximaliseren zodra het leaddoel circa 15 conversies in 30 dagen telt.',
  'Voeg een doel-CPA toe bij circa 30 conversies in 30 dagen en beoordeel pas na twee volledige conversiecycli; een te laag doel kost klikken.',
  'De leerperiode duurt tot ongeveer 50 conversies of drie conversiecycli; wijzig in die tijd geen instellingen.',
];

const BUDGET_NL =
  'De maandelijkse uitgavenlimiet is 30,4 keer het gemiddelde dagbudget; op één dag kan tot twee keer het dagbudget worden besteed. Dit systeem kent geen klikprijzen of volumes; het budget staat in de briefing.';

const FRAMES: Readonly<Record<FunnelStage, GoogleAdsFrame>> = Object.freeze({
  discover: {
    stage: 'discover',
    fit: 'not_search',
    campaignGoalNl: 'Websiteverkeer, of YouTube-bereik, -weergaven en -interacties',
    campaignTypeNl: 'Demand Gen (YouTube, Discover, Gmail, Display) — geen zoekcampagne',
    whyNl:
      'In Ontdekken zoekt de doelgroep nog niet naar een opleiding. Een zoekadvertentie toont alleen aan wie al zoekt; Google plaatst bereik onder mensen die nog niet zoeken bij Demand Gen. Kies dit kanaal hier alleen met beeld en video, of wacht tot Overwegen.',
    keywordsNl: 'Niet van toepassing: Demand Gen richt op doelgroepsignalen en interesses, niet op zoektermen. De zoektermen uit de briefing bewaar je voor Overwegen en Beslissen.',
    negativeKeywordsNl: 'Niet van toepassing in deze fase.',
    conversionActionsNl: [
      'Paginabezoek op de opleidingspagina of het artikel als secundaire actie, alleen om bereik te vergelijken.',
      'Geen leaddoel optimaliseren in deze fase: er is nog geen vraag om op te sturen.',
    ],
    biddingNl: ['Klikken maximaliseren, of Conversies maximaliseren op een lichte actie (paginabezoek) als die is ingericht.'],
    budgetNl: BUDGET_NL,
    measurementNl:
      'Weergaven, klikken en bezoek aan de opleidingspagina, afgelezen in Google Ads en de webanalyse. Geen inschrijvingsprognose: deze fase levert herkenning, geen aanmeldingen.',
    landingPageNl: 'Het blogartikel of de opleidingspagina met de vraag van de doelgroep bovenaan; mobielvriendelijk; dezelfde call to action als in de advertentie.',
    complianceNl: [...COMMON_COMPLIANCE],
    sources: [GOOGLE_ADS_SOURCES.objectives, GOOGLE_ADS_SOURCES.demandGen, GOOGLE_ADS_SOURCES.campaignTypes, GOOGLE_ADS_SOURCES.consentMode, GOOGLE_ADS_SOURCES.verification],
  },
  consider: {
    stage: 'consider',
    fit: 'search_first',
    campaignGoalNl: 'Leads (of Websiteverkeer als er nog geen leadactie is ingericht)',
    campaignTypeNl: 'Zoeken (Search) eerst; Performance Max als opschaling zodra het leaddoel data heeft',
    whyNl:
      'Wie vergelijkt, zoekt: op de opleidingsnaam, op "opleiding" plus het vakgebied, op vragen als wat het werk inhoudt of hoe het naast een baan past. Een zoekcampagne met één thema per advertentiegroep vangt die vraag op en houdt de controle bij de zoekterm.',
    keywordsNl:
      'Informatieve en vergelijkende zoektermen uit de briefing als woordgroep-match (phrase), één thema per advertentiegroep; de zoekterm letterlijk in minstens één kop. Breed zoeken (broad) pas met Slim bieden en conversiedata.',
    negativeKeywordsNl:
      'Sluit uit wat geen deelnemer is: vacature, salaris, gratis, examen oefenen, en de namen van andere aanbieders. Uitsluitingen matchen geen spelvarianten; neem die apart op.',
    conversionActionsNl: [
      'Brochure of studiegids gedownload (Submit lead form / Sign-up).',
      'Aanmelding informatiebijeenkomst of terugbelverzoek.',
      'Bezoek aan de opleidingspagina als secundaire actie.',
      'Elke actie via de Google-tag of een GA4-import; gegevensgestuurde attributie is de standaard.',
    ],
    biddingNl: [...COMMON_BIDDING],
    budgetNl: BUDGET_NL,
    measurementNl:
      'Per advertentiegroep: klikken, kosten per lead en Kwaliteitsscore-onderdelen (verwachte CTR, relevantie, bestemmingspagina) als diagnose. Advertentiesterkte Goed of Uitstekend, minstens twee responsieve zoekadvertenties per groep.',
    landingPageNl:
      'De opleidingspagina of het blogartikel dat dezelfde vraag beantwoordt als de zoekterm; de belangrijkste informatie bovenaan; de call to action van de advertentie letterlijk op de pagina.',
    complianceNl: [...COMMON_COMPLIANCE],
    sources: [GOOGLE_ADS_SOURCES.objectives, GOOGLE_ADS_SOURCES.leadGen, GOOGLE_ADS_SOURCES.rsa, GOOGLE_ADS_SOURCES.matchTypes, GOOGLE_ADS_SOURCES.negatives, GOOGLE_ADS_SOURCES.conversions, GOOGLE_ADS_SOURCES.bidding, GOOGLE_ADS_SOURCES.qualityScore, GOOGLE_ADS_SOURCES.landingPage],
  },
  decide: {
    stage: 'decide',
    fit: 'search_first',
    campaignGoalNl: 'Leads',
    campaignTypeNl: 'Zoeken (Search) op de opleidingsnaam en inschrijftermen; Performance Max als opschaling',
    whyNl:
      'Wie op de opleidingsnaam, op inschrijven, kosten of startdata zoekt, staat op het punt te kiezen. Exacte en woordgroep-matches op die termen, met de praktische stap als call to action, zetten die intentie om.',
    keywordsNl:
      'De opleidingsnaam en de afkorting als exact en woordgroep-match; inschrijven, kosten, startdatum en locatie als woordgroep-match; één advertentiegroep voor merk/naam en één voor inschrijftermen.',
    negativeKeywordsNl:
      'Sluit informatieve termen uit die in Overwegen thuishoren (wat is, wat doet), en vacature, salaris, gratis. Namen van andere aanbieders alleen uitsluiten; nooit als zoekterm bieden.',
    conversionActionsNl: [
      'Inschrijving of aanmelding afgerond (Converted lead) als primair doel, met een waarde.',
      'Telefoongesprek vanuit de advertentie of de pagina.',
      'Verbeterde conversies voor leads, zodat een inschrijving die later in het CRM wordt bevestigd aan de klik wordt toegerekend.',
    ],
    biddingNl: [...COMMON_BIDDING],
    budgetNl: BUDGET_NL,
    measurementNl:
      'Kosten per inschrijving, conversiepercentage per advertentiegroep en vertoningsaandeel op de opleidingsnaam, afgelezen in Google Ads. Geen prognose vooraf; de eerste cyclus is de nulmeting.',
    landingPageNl:
      'De opleidingspagina met inschrijfknop, prijs en startdata zichtbaar zonder scrollen op mobiel; wat de advertentie belooft (prijs, datum) staat letterlijk op de pagina.',
    complianceNl: [...COMMON_COMPLIANCE, 'Prijs en data in de advertentie alleen als ze op de goedgekeurde opleidingskaart staan en op de pagina zichtbaar zijn.'],
    sources: [GOOGLE_ADS_SOURCES.leadGen, GOOGLE_ADS_SOURCES.leadGoals, GOOGLE_ADS_SOURCES.rsa, GOOGLE_ADS_SOURCES.enhancedLeads, GOOGLE_ADS_SOURCES.targetCpa, GOOGLE_ADS_SOURCES.learning, GOOGLE_ADS_SOURCES.budgets, GOOGLE_ADS_SOURCES.destinations, GOOGLE_ADS_SOURCES.misrepresentation],
  },
});

/** The Google Ads frame for one funnel stage. Deterministic; no model involved. */
export function googleAdsFrame(stage: FunnelStage): GoogleAdsFrame {
  return FRAMES[stage];
}

/** The frame as plain text for an export or a prompt. */
export function googleAdsFrameText(stage: FunnelStage): string {
  const frame = googleAdsFrame(stage);
  return [
    `Google Ads-kader · fase ${stage}`,
    `Campagnedoel (Google): ${frame.campaignGoalNl}`,
    `Campagnetype: ${frame.campaignTypeNl}`,
    `Waarom: ${frame.whyNl}`,
    `Zoektermen: ${frame.keywordsNl}`,
    `Uitsluitingen: ${frame.negativeKeywordsNl}`,
    'Conversieacties eerst inrichten:',
    ...frame.conversionActionsNl.map((line) => `  - ${line}`),
    'Bieden:',
    ...frame.biddingNl.map((line) => `  - ${line}`),
    `Budget: ${frame.budgetNl}`,
    `Meten: ${frame.measurementNl}`,
    `Bestemmingspagina: ${frame.landingPageNl}`,
    'Vereisten:',
    ...frame.complianceNl.map((line) => `  - ${line}`),
    `Bronnen (gelezen ${GOOGLE_ADS_VERIFIED_AT.slice(0, 10)}): ${frame.sources.map((source) => source.url).join(' · ')}`,
  ].join('\n');
}
