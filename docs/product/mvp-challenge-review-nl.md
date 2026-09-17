# Certify360 — wat ontbreekt er nog voor dagelijks gebruik?

15 september 2026 · Voorstel naar aanleiding van Thomas’ vraag

De campagneketen bestaat grotendeels. De belangrijkste open punten zitten tussen een voorstel en het dagelijkse werk: wat komt wanneer uit, wie maakt het af, welke versie is gecontroleerd en wat is er daadwerkelijk geplaatst?

Dit overzicht is gebaseerd op inspectie van de huidige code. Aanwezig betekent hier geïmplementeerd, niet opnieuw getest met echte gebruikers of leveranciers. De genoemde MVP-keuzes zijn een advies; er is met deze review geen functionaliteit gewijzigd.

## Wat we al hebben

Merkregels en opleidingsinformatie, herbruikbare persona’s, onderzoek met bronverwijzingen, kansen naar campagnes, briefing, conceptkeuze, kanaalplan, contentgeneratie en een contentbibliotheek zijn aanwezig. Ook beoordelingen, versies, exports en handmatige campagneresultaten bestaan. Deze onderdelen hoeven niet opnieuw gebouwd te worden.

Er is al een **planning binnen een campagne**. Die berekent datums uit het kanaalplan en een startdatum. Een **centrale, bewerkbare contentkalender voor het team** ontbreekt nog. Dat is het relevante verschil bij Thomas’ opmerking.

## Voorgestelde MVP-keuzes

| Onderdeel | Wat ontbreekt of wringt? | Gevolg in het werk | Voorstel |
|---|---|---|---|
| Plan en productie laten overeenkomen | Een plan kan meerdere uitingen per kanaal en fase bevatten. De huidige generator maakt één uiting per combinatie; de kalender telt wel alle geplande uitingen. | Drie geplande posts betekenen nog geen drie verschillende posts. | **Eerst oplossen.** Iedere geplande uiting krijgt een eigen identiteit en productie-/contentkoppeling. Bij een tijdelijk beperkt MVP het aantal eerlijk begrenzen. |
| Centrale kalender en taakverdeling | De afzonderlijke kalenderpagina is nog niet beschikbaar. Een kalenderregel heeft geen inhoudskoppeling, verantwoordelijke of reviewdeadline. | Het team kan niet zien wat deze week verschijnt en wie nog iets moet doen. | **MVP.** Eén weeklijst per label, over campagnes heen, met datum, eigenaar, beoordelaar en actuele status. Campagne-eigenaarschap overdraagbaar maken. |
| Planning kunnen aanpassen aan de marketingagenda | Het ritme wordt met vaste intervallen berekend. Losse publicatiedatums zijn niet bewerkbaar. Bevestigde cursusdatums leveren waarschuwingen op, maar er is geen volwaardige momentenplanning. | Een inschrijfdeadline, open dag of andere campagne kan om een ander ritme vragen. | **MVP, eenvoudig.** Datums per uiting kunnen wijzigen en bewaren; relevante startmomenten/deadlines handmatig vastleggen. Voorstellen vanuit die momenten beoordelen. |
| De gekozen output kunnen afmaken | Sociale content is bewerkbaar. Quiz-/websitepakketten hebben wel preview, beoordeling en download, maar geen vergelijkbare opgeslagen tekstcorrectie. De preview gebruikt bovendien niet exact dezelfde fonts als de download en toont geen Studio-banners. | Een kleine inhoudelijke correctie vraagt extern werk of nieuwe generatie. Een beoordeling dekt niet altijd het uiteindelijke bestand. | **MVP voor de gekozen formats.** Correctie als nieuwe versie bewaren, opnieuw beoordelen en het echte bestand bekijken. Een format waarvoor dit niet lukt blijft een concept of valt buiten de pilot. |
| De belofte en bestemming laten kloppen | Een post kan naar een keuzehulp verwijzen terwijl die nog niet op de cursuspagina staat. Er zijn waarschuwingen; de CTA-exportcontrole controleert alleen of een link is ingevuld. | De bezoeker krijgt niet wat de post belooft. | **MVP.** Bij zo’n belofte de werkende bestemming en geplaatste versie laten bevestigen voordat de uiting publicatieklaar heet. Een conceptdownload blijft mogelijk. |
| Weten welke uitvoering resultaat opleverde | Handmatige publicatie en resultaten bestaan voor contentversies. Een quiz-/bannerpakketversie kan nog niet op dezelfde manier als publicatie worden gekoppeld. | Een campagneresultaat vertelt niet welke quiz of banner eraan voorafging. | **MVP als zo’n pakket meedoet.** Versie, onderdeel, publicatiedatum en bestemming registreren; beschikbare meetcijfers eraan koppelen. Automatische data-inname kan later. |

De kalender en taakverdeling kunnen één kleine uitbreiding zijn. Een aparte projectmanagementomgeving is daarvoor niet nodig. Hetzelfde geldt voor kwaliteit: verbeter eerst de afwerking van de gekozen formats, voordat er nieuwe formats bijkomen.

## Hoe klein kan de eerste kalender zijn?

Een lijstweergave per week is voldoende. Elke regel toont:

- Opleiding, campagne, kanaal en de geplande uiting; ook zichtbaar als die nog gemaakt moet worden.
- Publicatiedatum, verantwoordelijke en deadline voor beoordeling.
- De gekoppelde contentversie en bestaande beoordelingsstatus.
- Na plaatsing: werkelijke publicatiedatum en bestemming.

Filters: **Deze week**, **Nog niet ingepland**, **Wacht op beoordeling** en **Te laat**. Begin met een datumkiezer; slepen, maandweergave en automatische herinneringen kunnen wachten. Een datumwijziging moet bewaard blijven na verversen. Bij een nieuw kanaalplan moet zichtbaar zijn welke bestaande afspraken veranderen. Een conceptplan mag niet ongemerkt de afgesproken planning vervangen.

Dit sluit aan op concrete functies in bestaande marketingsoftware: HubSpot brengt campagnes en marketingtaken samen in een filterbare kalender en laat taken koppelen aan een campagne, verantwoordelijke en deadline. Dat ondersteunt deze beperkte scope; het is geen reden om het hele product na te bouwen. [Marketingkalender](https://knowledge.hubspot.com/campaigns/use-your-marketing-calendar), [campagnetaken](https://knowledge.hubspot.com/campaigns/create-marketing-tasks-with-the-campaigns-tool).

## Bewust later, met reden

| Uitbreiding | Waarom kan dit wachten? | Wanneer opnieuw besluiten? |
|---|---|---|
| Automatisch publiceren naar CMS, social en advertentieplatforms | De eerste campagne kan met goedgekeurde bestanden handmatig worden geplaatst. Eerst moet vaststaan welke versie naar welke bestemming hoort. | Wanneer de handmatige overdracht aantoonbaar tijd kost of fouten veroorzaakt. |
| GA4, Search Console, Ads en SEO-dataleveranciers automatisch inlezen | Voor een kleine pilot kunnen beschikbare rapporten handmatig worden vastgelegd. Een koppeling levert pas bruikbare conclusies op als doelen, identifiers en meetinstellingen kloppen. | Begin met de gegevensbron die de belangrijkste pilotvraag beantwoordt; bijvoorbeeld GA4 voor websitegedrag of Search Console voor organische zoekvragen. |
| Continue concurrentmonitoring, automatische momentenagenda en meldingen | Een gekozen onderzoeksvraag en handmatig vastgelegde momenten volstaan om de eerste campagne te onderbouwen. | Wanneer het team regelmatig dezelfde controles herhaalt. |
| Meer formats, automatische A/B-optimalisatie en modelkeuze per taak | Meer mogelijkheden lossen de huidige overdrachts- en afwerkingsproblemen niet op. Een tweede model bewijst op zichzelf geen betere kwaliteit. | Na vergelijking op geaccepteerde output, correctietijd en totale kosten. |

## Wanneer noemen we de pilot geslaagd?

Kies één opleiding en een beperkt pakket, bijvoorbeeld een blog met twee sociale uitingen. Neem een quiz alleen mee als corrigeren, bekijken en plaatsen ook zijn afgedekt.

Laat een collega die de campagne niet heeft gemaakt de volgende stappen uitvoeren:

1. De bron, persona, boodschap en kanaalkeuze terugvinden en uitleggen.
2. De geplande uitingen in de weeklijst vinden, een datum wijzigen en zien wie aan zet is.
3. Eén inhoudelijke correctie maken en de definitieve versie laten beoordelen.
4. De geleverde bestanden en CTA op de werkelijke bestemming controleren.
5. Publicatie registreren en later de beschikbare resultaten terugvinden bij de gebruikte versie.

Leg daarnaast vast: voorbereidingstijd, correctieminuten, totale kosten en hoeveel uitingen de inhoudelijk verantwoordelijke accepteert. Vergelijk dit met een vergelijkbare handmatig gemaakte campagne. Technische checks en AI-beoordelingen ondersteunen de controle; ze bewijzen geen doelgroeprelevantie of conversiewinst. Spreek de acceptatiecriteria vóór de pilot af. De demo toont de werking en bruikbare bestanden. Tijdwinst onderbouwen we met de vergelijking; marketingresultaten meten we na publicatie.

## Onderbouwing uit de huidige code

- **Aantal versus productie:** [plancontract](../../packages/contracts/src/campaigns.ts), regel 428; [kalender](../../packages/contracts/src/calendar.ts), regel 167; [contentproductie](../../apps/api/src/modules/content-assets/service.ts), regels 220, 360 en 1113. De kalender herhaalt het aantal; de productie bewaart één sleutel per fase en kanaal.
- **Kalender en taken:** [kalenderregel](../../packages/contracts/src/calendar.ts), regel 38; [navigatie](../../apps/web/src/shell/navigation.ts), regels 22 en 42. [Werkruimte](../../apps/api/src/modules/organizations-labels/workspace-service.ts), regel 124: `plannedThisWeek` staat nog vast op nul. Dat getal mag niet als gemeten planning worden gepresenteerd.
- **Datums en planversie:** [startdatum opslaan](../../apps/api/src/modules/campaigns-briefs/service.ts), regel 324; [kalenderopbouw](../../apps/api/src/modules/campaigns-briefs/routes.ts), regels 307 en 333. De route gebruikt het laatste plan, zonder daar op goedkeuring te filteren.
- **Eigenaarschap en bestaande review:** [campagneaanmaak](../../apps/api/src/modules/campaigns-briefs/service.ts), regel 110; [goedkeuringen](../../apps/api/src/modules/reviews-approvals/service.ts), regel 71. De maker wordt eigenaar; in de onderzochte acties ontbreekt overdragen/toewijzen van werk.
- **Pakketcorrectie en preview:** [pakketacties](../../apps/api/src/modules/campaign-packages/routes.ts), regel 43; [preview-opbouw](../../apps/api/src/modules/campaign-packages/service.ts), regel 199; [pakketinterface](../../apps/web/src/components/CampaignPackagePanel.tsx), regel 372.
- **Werkende quizbestemming:** [waarschuwing](../../apps/web/src/components/CampaignPackagePanel.tsx), regel 111; [exportcontrole](../../apps/api/src/modules/exports/service.ts), regel 125.
- **Publicatie en resultaten:** [publicatiecontract](../../packages/contracts/src/outcomes.ts), regel 125; [opslag](../../apps/api/src/modules/outcomes/service.ts), regel 58; [bestaande resultateninterface](../../apps/web/src/components/ResultsStep.tsx).

Deze bevindingen verdienen gerichte acceptatietests bij uitvoering. In deze review zijn geen generatiejobs, betaalde API-aanroepen of nieuwe tests uitgevoerd.
