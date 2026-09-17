# Wat zit er niet in, en waarom — featureoverzicht met gemotiveerde keuzes (15 september 2026)

**Aanleiding.** Het verzoek uit het team: laat de huidige opzet door AI
challengen, maak een overzicht van de features die er *niet* in zitten, zodat
we er gemotiveerd van kunnen afwijken — en zet de features die wél in een MVP
horen (genoemd voorbeeld: contentmarketing moet een kalender volgen) op een
lijst, naast wat we zelf al hadden geconstateerd.

**Waarop dit rust.** De inventarisatie van wat er nu is, komt uit de code en
de documentatie van dit systeem zelf (`docs/PLATFORM.md`,
`docs/product/backlog.md`, de contracten en de schermen), niet uit een
demo-indruk. Waar een functie "niet aanwezig" heet, is dat in de code
gecontroleerd. De vergelijking met wat in vergelijkbare tools gangbaar is,
staat apart in §6, met bronnen en leesdatum.

**Wat dit niet is.** Geen productvisie en geen planning met datums. De
omvangsindicaties (S/M/L) zijn dezelfde grove maat als in de backlog en zijn
niet met iemand afgestemd. "Bewust niet" is hier een *voorstel* voor een
afwijking met de reden erbij; het besluit is aan het team.

---

## 1. Wat er nu wél in zit

| Gebied | Wat het doet | Staat |
| --- | --- | --- |
| Labels & toegang | Meerdere labels per organisatie, rollen met deny-by-default, ledenbeheer in het scherm, auditspoor met rol vóór en na | Werkt |
| Opleidingen | Opleidingskaart handmatig, uit een documentupload of uit de opleidingspagina; per feit een expliciete bevestiging door een mens; bronwijziging wordt gesignaleerd | Werkt |
| Merk & bronnen | Merkversie met kleuren, typografie, logo en verboden claims uit de Brand Portal; bronnenonderzoek met vindplaats per bevinding | Werkt |
| Doelgroepen | Persona's met 36 vragen, elk antwoord *uit bron* of *door AI afgeleid* met redenering; bibliotheek, koppeling aan meerdere opleidingen | Werkt |
| Marktradar | Onderzoek naar markt, concurrenten, vragen en advertentiewaarnemingen; marktbeeld met bewijs per inzicht | Werkt |
| AI Visibility & GEO | Handmatige benchmark van wat AI-antwoordmachines over de opleiding zeggen | Werkt |
| Campagne (8 stappen) | Doelgroep → richting → briefing → concept → kanaalplan → content & beelden → export → resultaten, met goedkeuringspoorten per stap | Werkt |
| Website & interactief | Blog met FAQ, keuzehulp als quiz met uitkomsten, Google Studio-bannerset; voorvertoning in het scherm en embed-code | Werkt |
| Content Studio | Bibliotheek van alle gemaakte content over campagnes heen | Werkt |
| Export | Concept- en publicatieklaar pakket als ZIP, met poorten die een pakket weigeren dat niet klopt | Werkt |
| Resultaten per campagne | Publicatie vastleggen, cijfers handmatig of uit een geüpload platformrapport, lessen die latere voorstellen kleuren | Werkt |
| Techniek | Taakwachtrij met budgetreservering, fair use, kostenregistratie per AI-aanroep, herstelronde bij afgekeurde modeloutput | Werkt |

---

## 2. Wat er niet in zit — per onderdeel, met oordeel

Oordeel: **MVP** = hoort erin, op de lijst · **Na MVP** = zinvol, later ·
**Bewust niet** = voorstel om af te wijken, met reden.

### A. Plannen en kalender

| # | Wat ontbreekt | Wat wij nu doen | Oordeel | Reden |
| --- | --- | --- | --- | --- |
| A1 | Redactionele kalender over campagnes en opleidingen heen | Per campagne een *afgeleide* weekplanning uit het goedgekeurde kanaalplan; het scherm "Kalender & journeys" staat op NOG NIET | **MVP** | Zonder één tijdlijn is niet te zien wat er volgende week uitgaat, laat staan of twee campagnes elkaar in de weg zitten |
| A2 | Een datum per uiting die je kunt verzetten | De planning is een pure functie van startdatum en kanaalplan en wordt niet opgeslagen; er is geen datum per uiting die iemand kan aanpassen | **MVP** | Een planning die niemand kan bijstellen is een voorstel, geen planning. Dit is de kern van A1 |
| A3 | Momenten en seizoen: open dagen, inschrijfdeadlines, PE-cyclus, studiejaar, vakanties, **herziening van de opleiding** en **sectormomenten zoals Prinsjesdag** | Alleen *bevestigde* opleidingsdata tellen mee, en dan als waarschuwing ("loopt door na de startdatum") | **MVP** | Voor een opleider bepaalt de intakecyclus wanneer content werkt. Let op: géén gangbare tool modelleert dit (§6); het dichtstbijzijnde is een agenda met vrije dagen. Dit is dus geen inhaalslag maar een eigen keuze die juist hier verschil maakt |
| A4 | Conflictsignalering: twee uitingen zelfde kanaal zelfde dag | Kanalen staan al twee dagen uit elkaar, zodat een week niet op één ochtend landt | Na MVP (klein) | Uit §6: geen leverancier documenteert conflictdetectie; het gangbare alternatief is precies de spreiding die wij al toepassen. Pas zinvol als datums handmatig verzet kunnen worden |
| A5 | Terugkerende of doorlopende content buiten een campagne | Alles hangt aan een campagne; er is geen always-on programma | Na MVP | Het model is campagnegericht; dit is een tweede model, niet een knop |
| A6 | Capaciteit per persoon, slepen in de kalender, ICS-export | Niet aanwezig | Na MVP | Comfort, geen voorwaarde |
| A7 | Startmomenten van de trainingen op de kalender, met de bezetting per groep | `course.dates` bestaat al als gecontroleerde, gestructureerde data (startdatum, einddatum, locatie, vorm) maar levert alleen een waarschuwing op; het aantal deelnemers per groep wordt nergens vastgelegd | **MVP** | Dit is de reden om te publiceren. Een groep die over zes weken start en halfvol is, is het enige signaal dat zegt welke campagne nú nodig is |
| A8 | Wervingsvenster: welke groep heeft geen campagne in de aanloop | Niet aanwezig; campagnes staan los van de groep waarvoor ze werven | **MVP** | Rekenwerk op eigen invoer, geen prognose: startdatum min de doorlooptijd die het label zelf instelt, en dan de vraag of er iets gepland staat |

### B. Publiceren en verzenden

| # | Wat ontbreekt | Wat wij nu doen | Oordeel | Reden |
| --- | --- | --- | --- | --- |
| B1 | Rechtstreeks publiceren of inplannen op social | Niets wordt verzonden of gepubliceerd; de content gaat als ZIP mee en publicatie wordt achteraf vastgelegd | **Bewust niet** | Per platform een eigen app, app-review, tokenbeheer en een ander goedkeuringsregime: "concept" wordt dan "verzonden". Grote scope, weinig extra inzicht zolang de kalender er nog niet is |
| B2 | E-mail versturen | De e-mail komt als HTML uit de export; er is geen verzendcode in het systeem | **Bewust niet**, eerste kandidaat erna | Verstandiger om aan te sluiten op de bestaande verzendtool dan zelf verzender te worden |
| B3 | Publiceren naar het CMS | Wijzigingsvoorstel voor de opleidingspagina en kant-en-klare HTML met embed-code | **Bewust niet** | Het CMS is niet bekend; het voorstel is nu leesbaar voor een mens en dat is de veilige kant |
| B4 | Advertenties aanzetten vanuit de tool | Tekst binnen Google's limieten, zoektermen, uitsluitingen en een overdrachtsblad (CSV), plus het Google Ads-kader per fase | **Bewust niet** | Geld uitgeven vanuit de tool is een andere risicoklasse dan tekst maken |

### C. Meten

| # | Wat ontbreekt | Wat wij nu doen | Oordeel | Reden |
| --- | --- | --- | --- | --- |
| C1 | Eén afspraak voor UTM-parameters per kanaal en campagne | Alleen de link in de keuzehulp draagt utm-parameters | **MVP** (klein) | Zonder dit is zelfs handmatig meten niet per kanaal uit elkaar te trekken; het is een conventie, geen koppeling |
| C2 | Koppeling met webanalyse (GA4, Search Console) | Cijfers worden met de hand ingevoerd of uit een geüpload platformrapport gehaald | Na MVP | Vraagt toegang, consent-afspraken en beheer; de handmatige route werkt en liegt niet |
| C3 | Terugkoppeling van inschrijvingen (CRM of inschrijfsysteem) | Inschrijvingen zijn een handmatig ingevuld getal per periode | Na MVP | Hangt af van hun systeem; dit is een integratieproject |
| C4 | A/B-test met opzet en resultaat per variant | Twee ontwerpvarianten van hetzelfde beeld, zonder testopzet of uitkomst per variant | Na MVP | Kleine tussenstap: bij publicatie vastleggen welke variant is geplaatst |
| C5 | Dashboard over campagnes heen | Per campagne kan het; het scherm "Resultaten" staat op NOG NIET | Na MVP | Volgt logisch op C2; zonder databron is het een invulformulier met een grafiek |

### D. Samenwerken

| # | Wat ontbreekt | Wat wij nu doen | Oordeel | Reden |
| --- | --- | --- | --- | --- |
| D1 | Eigenaar en deadline per uiting of stap | Rollen en goedkeuringen bestaan, maar niemand is ergens eigenaar van | **MVP** (klein) als meer dan één persoon meewerkt | Anders is de kalender uit A1 een tijdlijn zonder verantwoordelijke |
| D2 | Notificaties ("jouw goedkeuring is nodig") | Niets: je moet zelf gaan kijken. Er is geen mail-, Teams- of webhookcode in het systeem | **MVP** (klein) | Een goedkeuringsstap zonder signaal is de plek waar werk stil valt |
| D3 | Opmerkingen of annotaties op een uiting | Beoordelingsnotities per versie, geen gesprek per zin | Na MVP | Kan voorlopig in het bestaande overleg |

### E. Vindbaarheid (SEO en AI-antwoordmachines)

| # | Wat ontbreekt | Wat wij nu doen | Oordeel | Reden |
| --- | --- | --- | --- | --- |
| E1 | Zoekvolumes en concurrentiecijfers per zoekterm | Zoektermen zonder cijfers, met de bron erbij, en expliciet gezegd dat er geen volume bekend is | **Bewust niet** zolang er geen databron is | Een verzonnen getal is erger dan geen getal. Te overwegen: Keyword Planner via het Google Ads-account dat we voor advertenties toch nodig hebben. Prijs van deze keuze: zoektermen worden gekozen zonder vraagcijfer |
| E2 | Positiemonitoring (rankings volgen) | Niet aanwezig | **Bewust niet** | Vraagt een meetperiode en een databron; nu zou het een cijfer zonder betekenis zijn |
| E3 | Structured data (JSON-LD) op het blogartikel | Artikel volgt de inhoudelijke praktijk, maar levert geen schema mee | **MVP** (klein) | Stond al open in de backlog; kleine toevoeging aan de HTML-export |

### F. Content en merk

| # | Wat ontbreekt | Wat wij nu doen | Oordeel | Reden |
| --- | --- | --- | --- | --- |
| F1 | Mediabibliotheek met rechten en licenties | Uploads en gegenereerde beelden horen bij hun campagne; Content Studio toont content, geen losse media | Na MVP | Wordt pas een probleem bij volume |
| F2 | Video | Niet aanwezig | **Bewust niet** | Ander productieproces; buiten de huidige belofte |
| F3 | Meertaligheid met vertaalflow | Er is een taalveld (nl/en); er is geen vertaalstap of tweetalige variant van één uiting | **Bewust niet** | De markt is Nederlandstalig; het veld staat klaar als dat verandert |

### G. Toegankelijkheid en zorgvuldigheid

| # | Wat ontbreekt | Wat wij nu doen | Oordeel | Reden |
| --- | --- | --- | --- | --- |
| G1 | WCAG-controle op de pagina's die wij produceren (blog, keuzehulp) | Alt-tekst is verplicht, beeldcontrast wordt gecontroleerd, de schermen zelf zijn toetsenbordtoegankelijk | **MVP** (klein) | Wij leveren HTML die op hun site komt. Marketingtools doen dit niet (§6: het zit in het CMS of in een apart hulpmiddel), maar hier is het onze uitvoer, dus onze verantwoordelijkheid |
| G2 | Consent/cookiebanner in geproduceerde pagina's | De keuzehulp zet geen cookie, slaat niets op en stuurt niets door | Nu niet nodig | Vastleggen als afspraak: zodra er tracking in een geproduceerde pagina komt, is Consent Mode v2 verplicht in de EER |

### H. Techniek en livegang

| # | Wat ontbreekt | Wat wij nu doen | Oordeel | Reden |
| --- | --- | --- | --- | --- |
| H1 | Geverifieerde authenticatie (SSO) | Identiteit komt van een vertrouwde proxy-header met drie voorwaarden; het echte headercontract is nog niet bevestigd (risico R-01) | **MVP-blokkade voor livegang** | Tot dat contract er is, mag dit geen productieauthenticatie heten |
| H2 | Mobiele navigatie | De zijbalk stapelt onder 860 px, maar klapt niet in | Na MVP | Stond al open |
| H3 | Koppeling met het opleidingssysteem (catalogus, inschrijvingen) | Opleidingskaart handmatig of uit de pagina, met signalering als de bron verandert | Na MVP | Integratieproject; de wijzigingssignalering dekt het grootste risico (verouderde prijs of data) |

---

## 3. De contentkalender in detail

Het genoemde voorbeeld klopt, en preciezer dan het eruitziet.

**Wat er nu is.** Zodra het kanaalplan is goedgekeurd, berekent het systeem
een planning: één uiting per kanaal per week, de funnelfasen in volgorde
(Ontdekken week 1, Overwegen week 2, Beslissen week 3), kanalen twee dagen uit
elkaar zodat niet alles op één ochtend valt. Zonder startdatum is de planning
relatief ("week 2"); met een startdatum krijgt elke uiting een datum. Bevestigde
opleidingsdata worden meegenomen en er komt een waarschuwing als de campagne
doorloopt tot ná de startdatum van de opleiding, of pas erna begint. In het
exportpakket zit bovendien een `publicatieplan.txt`, zodat wie de ZIP krijgt de
bedoelde volgorde en ritme leest in plaats van losse bestanden.

**Wat er ontbreekt.** Die planning wordt **berekend, niet opgeslagen**, en dat
was een bewuste keuze: één waarheid in plaats van vier dingen die uit de pas
gaan lopen. De prijs ervan zien we nu: je kunt geen uiting verzetten, geen
datum vastzetten, geen uitzondering maken, en je ziet maar één campagne
tegelijk. Er is geen weergave over campagnes heen, geen markering van de
momenten die er voor een opleider toe doen, en geen signaal als twee uitingen
op hetzelfde kanaal op dezelfde dag vallen.

**Wat een MVP-kalender zou moeten zijn.** De berekende planning blijft het
voorstel, en krijgt er een laag overheen: per uiting een datum die iemand mag
verzetten (met de reden dat hij afwijkt van het voorstel), een weergave over
alle campagnes van een label, de momenten van de opleider als achtergrond
(intakes, open dagen, PE-cyclus, vakanties), conflictsignalering, en de
publicatie die al bestaat als afvinkmoment op diezelfde kalender. Dat is één
samenhangende toevoeging, geen losse knoppen — omvang **L**.

---

## 4. Voorstel: de MVP-lijst

In volgorde van wat het meest oplevert per eenheid werk.

| Prioriteit | Onderwerp | Omvang | Waarom nu |
| --- | --- | --- | --- |
| 1 | Kalender, stap 1: startmomenten van de trainingen met bezetting per groep, en de berekende contentplanning ernaast (A7, A1 lezend) | M | Laat meteen zien waar het knelt, zonder dat er iets bewerkbaar hoeft te zijn |
| 2 | Kalender, stap 2: verzetbare datum per uiting, eigenaar en beoordelingsdeadline (A2, D1) | M | Maakt er een werkkalender van in plaats van een overzicht |
| 3 | Kalender, stap 3: momenten van de opleider en het wervingsvenster (A3, A8) | M | Zegt welke groep aandacht nodig heeft en wanneer |
| 4 | UTM-conventie per kanaal en campagne, automatisch op elke link (C1) | S | Maakt handmatig meten pas bruikbaar; kost weinig |
| 5 | Notificatie bij een openstaande goedkeuring (D2) | S | Maakt de kalender uit 1 werkbaar met meer dan één persoon |
| 6 | JSON-LD en een basis-toegankelijkheidscontrole op geproduceerde pagina's (E3, G1) | S | Kleine toevoeging aan wat we al uitleveren |
| 7 | Authenticatiecontract bevestigen vóór livegang (H1) | M | Blokkeert livegang, niet de pilot |

Bewuste afwijkingen die we willen vastleggen: publiceren en verzenden vanuit de
tool (B1–B4), zoekvolumes en rankings (E1, E2), video (F2) en meertaligheid
(F3).

---

## 5. Wat we zelf al hadden geconstateerd

Uit de backlog, zodat beide lijsten naast elkaar staan:

- Een echte draai met de AI-aanbieder van de nieuwste prompts (briefing v8,
  pakket v6, content v12) vóór de demo.
- LinkedIn Ads en Meta Ads: tekstlimieten nog niet tegen de eigen documentatie
  van die platforms gecontroleerd, dus die kanalen blijven concept-only.
- Marktradar: beslisspoor per inzicht (opgevolgd/geparkeerd/verworpen),
  Nederlandse publieke marktbronnen en de momentenkalender, getypeerde
  concurrentkenmerken, geplande herhaalscan.
- Persona's: goedkeuren en archiveren; primaire opleiding van een persona
  verplaatsen.
- Content: auteursvermelding en datum op het blogartikel; een serverpoort die
  content weigert die een keuzehulp belooft die niet bestaat.
- Interface: mobiele navigatie; een testrunner voor de webcomponenten.
- Beheer: "Meer laden" bij meer dan honderd labels.

---

## 6. Externe vergelijking

Gelezen op 15 september 2026, uit documentatie van leveranciers (HubSpot,
Optimizely, CoSchedule, Sprout Social, Later, Semrush, Contentful, Adobe,
Salesforce, Google) en openbaar leesbare analistenteksten (Gartner via
secundaire berichtgeving, Forrester). Leveranciersdocumentatie weegt hier
zwaarder dan een productpagina; waar alleen een marketingpagina beschikbaar
was, staat dat erbij in de bronnenlijst van het onderzoek.

**Wat gangbaar is en wij niet hebben.**

| Onderwerp | Wat gangbaar is | Wij |
| --- | --- | --- |
| Kalender over alles heen | Standaard: maand/week/dag/lijst, filterbaar, en je ziet alleen wat je mag zien (HubSpot documenteert precies dit) | Alleen per campagne, berekend, niet verzetbaar |
| Kalenderitem = het geplande object | In social-tools is het item op de kalender de daadwerkelijke inplanning | Bij ons een voorstel; publiceren gebeurt met de hand |
| Slepen om te verzetten | Standaard in social- en contentmarketingtools (maar níét in HubSpots kalenderartikel) | Niet aanwezig |
| UTM-bouwer | Standaard; HubSpot heeft er een aparte tool voor | Alleen de keuzehulplink |
| Herkomst-attributie in één stap | Standaard vanaf de professional-laag | Handmatig |
| Rechtstreeks publiceren en verzenden | Standaard in social suites en e-mailplatforms | Bewust niet |
| Mediabibliotheek met metadata en vervaldatum | Standaard vanaf de contentmarketing-laag | Per campagne |
| Zoekvolume, moeilijkheid, positiemonitoring | Standaard in SEO-tools, niet in marketingplatforms | Bewust niet |

**Wat minder gangbaar is dan het lijkt** — en waar "afwijken" dus weinig kost:

- **Conflictsignalering op de kalender** wordt door geen enkele leverancier
  gedocumenteerd. Het dichtstbijzijnde is automatische spreiding van berichten
  over de dag; die spreiding hebben wij al ingebouwd.
- **Agenda-export (ICS)** is zelfs bij de kalender-eerst leverancier beperkt:
  geen taken, geen kalenderitems, geen herhaling, twee maanden vooruit en niet
  live.
- **Meervoudige attributie** zit bij de grootste speler achter de duurste
  laag; wat daaronder zit is in de praktijk één herkomstbron per contact.
- **Toegankelijkheidscontrole** zit in het CMS of in een apart hulpmiddel, niet
  in het marketingplatform.
- **Intakecycli, open dagen en het studiejaar** worden door geen enkel
  mainstream marketingplatform gemodelleerd. Het dichtstbijzijnde is een agenda
  met werk- en vrije dagen die deadlines realistisch houdt; een
  opleidingscatalogus als marketingobject bestaat alleen in een sector-CRM.

**Waar wij juist vóór lopen.** Relevant voor het gesprek over afwijken, omdat
het laat zien waar de investering tot nu toe heen ging:

- **Herleidbaarheid van AI-uitvoer.** Forrester noemt "grounding met respect
  voor toegangsrechten" een thema van 2025, en in de doorgelezen documentatie
  is geen enkele leverancier te vinden die expliciete waarborgen tegen
  verzinsels als functie beschrijft. Bij ons is dat de kern: een antwoord is
  *uit bron* met de letterlijke passage of *door AI afgeleid* met de redenering,
  claims zijn gebonden aan bevestigde opleidingsfeiten, en er is geen veld waar
  een verzonnen getal in past.
- **Auditspoor** is elders een aparte, dure rechtenmodule; bij ons standaard,
  inclusief rol vóór en na een wijziging.
- **Merkstem** wordt elders getraind op voorbeeldteksten in de duurdere lagen;
  bij ons komen kleuren, typografie, logo en verboden claims uit een
  goedgekeurde merkversie, en een pakket wordt geweigerd als die versie is
  gewijzigd.
- **Zichtbaarheid in AI-antwoordmachines** is bij de grootste SEO-leverancier
  een nieuw, begrensd betaald onderdeel; wij hebben er een eigen benchmark voor.

**Context.** In het meest recente sectoronderzoek dat we konden lezen zegt
maar 8% van de contentmarketeers dat er niets ontbreekt in hun gereedschap, en
26% dat ze de juiste technologie hebben om content te beheren. Een lijst met
gaten is dus de normale toestand, niet een teken dat de opzet verkeerd is.

**Afbakening.** De enige openbare definitie van een *minimale* marketingstack
die we vonden, noemt zes onderdelen: website, contentbeheer, CRM,
e-mailautomatisering, SEO-gereedschap en distributie met meting. Dit systeem
vult het contentdeel — plannen, produceren, onderbouwen, overdragen. CRM en
verzendplatform zijn daarmee expliciet buiten de eigen scope gehouden en niet
"vergeten"; de koppeling ernaartoe is wat later nodig is (C2, C3, B2).

De bronnen staan in §8.

---

## 7. Beperkingen van deze analyse

- De inventarisatie is gecontroleerd in de code; de oordelen zijn een voorstel
  van één AI-analyse en zijn niet met gebruikers getoetst.
- De omvangsindicaties zijn grof en bevatten geen doorlooptijd.
- "Gangbaar in de markt" (§6) zegt wat leveranciers en analisten beschrijven,
  niet wat een opleider daadwerkelijk nodig heeft.
- Wat hier niet staat, is niet automatisch afgewezen — het is niet bekeken.
- Twee bronnen waren niet leesbaar (een Gartner-document en het
  kalenderartikel van Sprout Social gaven 403). Uitspraken die daarop zouden
  rusten, zijn weggelaten in plaats van ingevuld.

---

## 8. Bronnen

Alle pagina's gelezen op 15 september 2026.

**Analisten (openbaar leesbaar deel).** Gartner Magic Quadrant voor
contentmarketingplatforms 2025, via secundaire berichtgeving:
<https://www.cxtoday.com/crm/gartner-magic-quadrant-for-content-marketing-platforms-cmps-2025-the-rundown/> ·
Forrester over The Forrester Wave: Content Platforms Q1 2025:
<https://www.forrester.com/blogs/highlights-from-the-forrester-wave-content-platforms-q1-2025/>

**Kalender en publiceren.** HubSpot marketingkalender:
<https://knowledge.hubspot.com/campaigns/use-your-marketing-calendar> ·
HubSpot campagnesjablonen:
<https://knowledge.hubspot.com/campaigns/campaign-templates> ·
CoSchedule spreiding over de dag:
<https://coschedule.com/support/social-media/social-messages/best-time-scheduling> ·
CoSchedule agenda-synchronisatie en ICS:
<https://coschedule.com/support/integrations/miscellaneous-integrations/sync-your-calendar-with-coschedule> ·
Optimizely CMP (agenda met werk- en vrije dagen, werkstroomvergrendeling,
mediabibliotheek, capaciteit):
<https://support.optimizely.com/hc/en-us/articles/23608664606477-2026-Optimizely-Content-Marketing-Platform-release-notes> ·
Sprout Social goedkeuringswerkstromen:
<https://support.sproutsocial.com/hc/en-us/articles/205974715-Message-Approval-Workflows> ·
Later inplannen en beste tijd:
<https://help.later.com/hc/en-us/articles/360043243793>

**Meten.** HubSpot attributierapportage:
<https://knowledge.hubspot.com/reports/understand-attribution-reporting> ·
Google toestemmingsmodus:
<https://developers.google.com/tag-platform/security/guides/consent>

**Vindbaarheid.** Semrush zoekwoordoverzicht:
<https://www.semrush.com/kb/257-keyword-overview> · Semrush site-audit:
<https://www.semrush.com/kb/31-site-audit> · Semrush schrijfassistent:
<https://www.semrush.com/kb/814-seo-writing-assistant> · Semrush AI Visibility:
<https://www.semrush.com/kb/1493-ai-visibility-toolkit>

**Productie, toegankelijkheid, rechten.** Contentful lokalisatie:
<https://www.contentful.com/help/localization/field-and-entry-localization/> ·
Adobe Experience Manager toegankelijk schrijven (WCAG 2.1):
<https://experienceleague.adobe.com/en/docs/experience-manager-65/content/sites/authoring/siteandpage/creating-accessible-content> ·
Marketo rolrechten en auditspoor:
<https://experienceleague.adobe.com/en/docs/marketo/using/product-docs/administration/users-and-roles/descriptions-of-role-permissions>

**AI-functies.** HubSpot merkstem:
<https://knowledge.hubspot.com/branding/set-up-brand-voice-using-content-samples> ·
HubSpot hergebruik van content:
<https://knowledge.hubspot.com/website-and-landing-pages/use-page-templates-in-content-remix>

**Onderwijssector.** Salesforce Education Cloud, werving en toelating:
<https://help.salesforce.com/s/articleView?id=sfdo.ec_recruitment_and_admissions.htm>

**Context en afbakening.** Content Marketing Institute, B2B-benchmark 2025:
<https://contentmarketinginstitute.com/b2b-research/b2b-content-marketing-trends-research-2025> ·
Considered Content over een minimale martech-stack:
<https://www.consideredcontent.com/blog/the-minimum-viable-martech-stack/>
