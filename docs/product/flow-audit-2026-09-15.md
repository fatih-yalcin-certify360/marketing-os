# Is de campagnemaker klaar? — audit van 15 september 2026

Vijf onderzoekers parallel: drie op onze eigen code, één op de gepubliceerde
eisen van de platforms, één op de markt. De zwaarste bevindingen zijn daarna met
de hand in de code nagelopen; wat hieronder staat als geverifieerd, is door mij
zelf in het bestand gelezen of in de draaiende stack gemeten.

Dit stuk is de diagnose. Het plan staat in `backlog.md`.

## Het korte antwoord

Nee. Een marketeer kan stap 1 tot 8 doorlopen en een ZIP downloaden, maar niet
één die ongewijzigd gepubliceerd kan worden. Drie van de acht stappen zijn
echt afgedwongen en geversioneerd; vier zijn versiering rond de randen. Van de
acht kanalen is er één die vandaag zonder handwerk de deur uit kan.

## De acht stappen

| # | Stap | Wat er wordt opgeslagen | Oordeel |
| --- | --- | --- | --- |
| 1 | Doelgroep | geen rij; de selectie is schermtoestand tot stap 3 hem meeschrijft | dun |
| 2 | Richting | `opportunities.selected` | dun |
| 3 | Briefing | `brief_versions`, geversioneerd en goedgekeurd | vast |
| 4 | Concept | `concept_versions.selected` | vast |
| 5 | Kanaalplan | `content_plans`, goedgekeurd | vast |
| 6 | Content | `content_asset_versions` plus beeldrijen | dun |
| 7 | Export | `exports` met poorten en weigeringsredenen | vast |
| 8 | Resultaten | publicaties, cijfers, lessen | vast |

De ketting 3 → 4 → 5 → 6 is niet over te slaan: elke stap eist het artefact van
de vorige, en die controle staat zowel op de route als in de taakafhandeling.
Stap 1, 2, 7 en 8 kennen geen volgordecontrole.

## Geverifieerde defecten, zwaarste eerst

**1. Het kanaalplan belooft aantallen die nooit worden gemaakt.**
De kalender zet één publicatiemoment per `item.count` (`packages/contracts/src/calendar.ts:167`).
De contentgeneratie kent `count` niet: ze schrijft precies één stuk per
combinatie van fase en kanaal. Keur een plan goed met LinkedIn ×4 en Instagram
×3, en je krijgt een kalender met zeven momenten en een export met twee
bestanden.

**2. Een briefing van campagne B kan campagne A terugzetten.**
`approveBrief` zoekt de briefing op `(id, labelId)` en nooit op `campaignId`
(`apps/api/src/modules/campaigns-briefs/service.ts:973`), en archiveert daarna
de goedgekeurde briefing van de *genoemde* campagne. Dezelfde fout zit in de
conceptselectie. Gevolg: campagne A verliest stil haar goedkeuring en valt
terug naar stap 3.

**3. Instagram-beeld kan niet worden geüpload.**
Onze eigen kanaalregistratie zegt `imageFormats: ['jpeg']`
(`packages/contracts/src/channels.ts:320`); de renderer schrijft onvoorwaardelijk
PNG (`apps/api/src/core/render/renderer.ts:76`). De Instagram-publicatie-API
accepteert alleen JPEG. Het commentaar in de renderer noemt zelfs een latere
JPEG-conversie die nooit is gebouwd.

**4. De harde kanaalgrenzen zijn dode code.**
`imageFormats`, `maxImagePixels`, `maxImageBytes` en `altTextMaxChars` staan in
`channels.ts` en worden **nergens in `apps/` gelezen**. De publicatiepoort
controleert alleen óf een specificatie is geverifieerd, nooit of het bestand
zich eraan houdt.

**5. Beide advertentiekanalen leveren geen beeld.**
`linkedin_ads` en `meta_ads` krijgen koppen en beschrijvingen en verder niets
(`adChannel` met `images: []`). Een Meta-advertentie zonder beeld kan niet
draaien.

**6. Er is geen manier om content te verwijderen.**
Er bestaat geen enkele DELETE-route voor contentitems. Drie produceerbare
kanalen zijn permanent onpublicabel omdat hun specificatie niet tegen een
primaire bron is gecontroleerd. Eén gegenereerde e-mail blokkeert daarmee voor
altijd elke publicatieklare export van die campagne.

**7. Het systeem bestelt een artikel dat het daarna weigert.**
De prompt vraagt 4 tot 7 secties van 60 tot 320 woorden
(`apps/api/src/core/ai/prompts.ts:544`), het schema staat er 7 toe
(`packages/contracts/src/content.ts:217`), en de kwaliteitspoort blokkeert boven
6 secties of onder 120 woorden per sectie met `blocksPublishReady: true`
(`apps/api/src/modules/content-assets/quality.ts:232`).

**8. Vijf poorten in de exportchecklist kunnen nooit groen worden.**
Het scherm toont tien poortlabels; `evaluateGates` vult er maar vijf. Op een
afgeronde campagne staan *Doelgroepen gekozen*, *Kans gekozen*, *Briefing
goedgekeurd*, *Concept gekozen* en *Kanaalplan goedgekeurd* nog open.

**9. Stap 8 vinkt nooit af op het detailscherm.** `hasOutcomes` staat daar hard
op `false`, terwijl de lijstroute de echte waarde doorgeeft. Twee schermen
spreken elkaar tegen over dezelfde campagne.

**10. De demo-etikettering ontbreekt in het bestand dat het pand verlaat.**
Productie is veilig: `AI_PROVIDER=mock` wordt tweemaal geweigerd bij
`NODE_ENV=production`, in `packages/config/src/env.ts:295` en nogmaals in
`apps/api/src/core/ai/index.ts`. Maar in ontwikkeling schrijft een
publicatieklaar pakket *"Alle controles en goedkeuringen voor dit pakket zijn
afgerond"* zonder enige vermelding van demodata, terwijl het scherm wel een
demobadge toont. Dat is geen productierisico, wel een overtreding van onze eigen
regel om ontwikkelmateriaal als demo te labelen.

## Wat er feitelijk uit komt

Gemeten aan een echt conceptpakket, 15 september 2026, 6.136.890 bytes:

| Bestandssoort | Aantal |
| --- | --- |
| platte `.txt` | 6 |
| PNG | 4 |
| HTML, Markdown, CSV, docx | 0 |

Beeld: 1080 × 1350 PNG van ongeveer 1,5 MB, alleen voor LinkedIn en Instagram
organisch. Van dertien opgevraagde contentitems misten er vier een CTA-link;
de export schrijft dan letterlijk `(link ontbreekt)` in het bestand.

De publicatieklare export kent wel een CSV voor Google Ads en HTML voor e-mail,
maar het websitestuk komt er alleen als platte tekst uit. De
Markdown-weergave bestaat, maar alleen als kopieerknop in het scherm.

## Wat de platforms eisen

Opgehaald op 15 september 2026, met bron per getal.

| Platform | Eis | Bron |
| --- | --- | --- |
| Instagram feed | uitsluitend JPEG, maximaal 8 MB, verhouding 4:5 tot 1,91:1, breedte 320 tot 1440 px, bijschrift 2.200 tekens, alt-tekst 1.000 | developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/ |
| LinkedIn organiek | minimaal 552 × 276, aanbevolen breedte 1080, verhouding 3:1 tot 4:5, maximaal 5 MB, JPEG boven PNG, tekst 3.000 tekens | linkedin.com/help/lms/answer/a527229 |
| LinkedIn enkele-beeldadvertentie | bestemmings-URL verplicht, beeld verplicht, kop 70 voor afkapping en 200 maximaal | linkedin.com/help/lms/answer/a426534 |
| Meta-advertentie | JPG of PNG, 4:5, 1440 × 1800, kop 27 tekens op Facebook en 40 op Instagram | facebook.com/business/ads-guide/image/facebook-feed/ |
| Facebook-paginafoto | PNG bij voorkeur niet boven 1 MB | developers.facebook.com/docs/graph-api/reference/page/photos/ |
| Google responsive search ad | 3 tot 15 koppen van 30, 2 tot 4 beschrijvingen van 90, domein van weergave-URL moet overeenkomen met eind-URL | support.google.com/google-ads/answer/7684791 en adspolicy/answer/6368661 |

Drie veelgeciteerde getallen bleken **niet te verifiëren** op een officiële
pagina en zijn dus nergens in onze code thuis: de knipgrens van ongeveer 102 KB
in Gmail, het tekenlimiet van 63.206 voor een Facebook-bericht, en de bewering
dat UTM-parameters verplicht zijn. LinkedIn beschrijft trackingparameters
uitdrukkelijk als optioneel. UTM is dus een attributiekeuze van ons, geen eis.

## Het websitekanaal moet gesplitst

Het zijn al twee verschillende dingen die één kanaal delen. Ze lopen uiteen in
prompt, schema, kwaliteitscontrole, export en scherm. Het wijzigingsvoorstel is
vrijgesteld van de lengtepoorten en wordt tegen de live pagina gecontroleerd;
het artikel heeft een eigen module van 348 regels met zes soorten waarschuwing
die het wijzigingsvoorstel nooit ziet.

Gemeten in de ontwikkeldatabase, 41 contentitems in totaal:

| Kanaal en vorm | Aantal |
| --- | --- |
| `landing_page` met `course_page_update` | 3 |
| `landing_page` zonder vorm | 3 |
| `landing_page` met `blog_article` | 0 |

Twee conclusies. De blogkant van dit kanaal is in deze data nooit geproduceerd.
En de helft van de bestaande websiterijen draagt geen vorm, dus een migratie kan
die niet automatisch indelen: `landing_page` moet als waarde blijven bestaan.

De verhuizing raakt ongeveer 30 bronbestanden en 11 testbestanden, plus één
migratie. Het volgende vrije nummer is `0028`.

## Losse assets zijn vandaag onmogelijk

Er bestaat geen route die content aanmaakt buiten een campagne om. Op
labelniveau kan alleen worden bewerkt, herzien en goedgekeurd.

Drie kolommen in `apps/api/db/migrations/0006_content_approvals_exports.sql`
blokkeren het: `campaign_id` op regel 46, `brief_version_id` op regel 60 en
`concept_version_id` op regel 61, alle drie `NOT NULL`. De unieke sleutel
`content_key_version_unique` op regel 89 staat bovendien op `campaign_id`, dus
die stopt met werken zodra de kolom leeg mag zijn en moet worden vervangen door
twee partiële indexen.

Wat al wel klaarstaat:

- **Beeldgeneratie** accepteert al een ontbrekende campagne. De campagne wordt
  alleen gebruikt om maximaal drie referentiebeelden te laden.
- **De AI Visibility-onderzoeker schrijft al een blogvoorstel en een
  paginawijziging.** Die blijven een veld in een JSON-rapport: geen versie, geen
  beoordeling, geen export. De enige brug naar een campagne eist een campagne.
- **De radar-overdracht** kent vijf routes die allemaal een campagne maken en
  verder niets.

Wat er niet is: video of animatie bestaat nergens in de repository. `video` komt
alleen voor als waarde in een lijst, en een test legt vast dat die nooit
publicabel is.

## Wat er stil kan breken

Als `campaign_id` leeg mag zijn, verschijnen losse assets meteen in de tellers
van de Werkruimte, die alleen op label filteren, terwijl er nog geen scherm is
om ze te openen. Een merkuitgave zet ze mee op *opnieuw beoordelen*. Export en
publicatieregistratie eisen nog steeds een campagne, dus produceren zonder
kunnen exporteren is een halve oplossing.

## Hoe de markt het doet

Zeven producten bekeken op 15 september 2026, met bron per rij in het
onderzoeksrapport. De patronen die ertoe doen:

**Niemand eist een campagne vooraf.** Adobe GenStudio opent met de vraag "wat
wil je vandaag maken" en verdeelt dat in eigen media, betaalde media en content;
een campagne is een optioneel veld in de details, achteraf toe te kennen.
Optimizely is de enige die het begrip benoemt: je maakt een zelfstandige taak,
of een taak vanuit een campagne. HubSpot heeft twee deuren, waarvan er één,
de Campagne-assistent, zonder campagne werkt. Sprout maakt de campagnetag
optioneel, tenzij een beheerder hem afdwingt.

**Twee valkuilen zijn overal zichtbaar.** HubSpot koppelt exclusief: zet je een
item in campagne B, dan verdwijnt het uit campagne A, en er is geen enkel scherm
dat items zonder campagne toont. Canva, Semrush en Sprout leunen volledig op
mappen en labels, zonder opleidingskoppeling, zonder vervaldatum en zonder
herkomst. GenStudie spreekt zichzelf zelfs tegen: de ene pagina zegt dat een
campagnenaam verplicht is bij uploaden, de andere noemt het veld optioneel.

**Niemand bewaart de herkomst van een onderzoeksbevinding in de tekst.**
Semrush' AI Visibility-gereedschap is puur rapportage; het gedocumenteerde
vervolg is dat je zelf naar het contentgereedschap gaat. Surfer's AI Tracker is
alleen analyse. Profound bindt een briefknooppunt aan een artikelknooppunt in
een pijplijn, maar bewaart geen rij. In de hele markt is een zoekterm de
volledige lading die de overgang haalt. Dat is voor hen overleefbaar en voor
ons fataal, want herleidbaarheid is precies waar wij voorop lopen.

## Video en animatie: wat er echt te koop is

**Script erin, afgerond filmpje eruit** bestaat alleen voor avatarvideo.
Synthesia levert 1920 × 1080 MP4 zonder watermerk vanaf het instapabonnement;
HeyGen's gratis laag draagt een watermerk en de voorwaarden verbieden commercieel
gebruik daarvan. Al het andere is clipgeneratie waarbij je zelf storyboardt:
Veo 3.1 doet clips van 4, 6 of 8 seconden in 16:9 of 9:16 met een SynthID-watermerk,
Runway rekent per vijf seconden, Adobe Firefly doet clips van 8 seconden en
waarschuwt dat de commerciële bruikbaarheid per model verschilt. OpenAI Sora
wordt uitgefaseerd en is geen fundament om op te bouwen.

**De openbaarmakingsplicht geldt al.** Artikel 50 van de EU-AI-verordening is
sinds 2 augustus 2026 van toepassing, en de Digital Omnibus van juli 2026 heeft
wel de hoogrisicoplichten uitgesteld maar artikel 50 niet. Als gebruiker moeten
wij synthetische beeld-, audio- en videobeelden van personen duidelijk en
onderscheidbaar kenmerken, uiterlijk bij de eerste blootstelling.
AI-gegenereerde *tekst* valt onder de uitzondering waar een mens redactionele
controle houdt, wat onze blogartikelen dekt maar synthetische video van een
persoon niet. C2PA is nog geen ISO-norm; LinkedIn toont Content Credentials en
Meta plaatst een AI-label, maar of de metadata een upload overleeft is op geen
enkele primaire bron te bevestigen. Een zichtbare Nederlandse regel blijft dus
nodig; ingebedde metadata is geen nalevingsmechanisme.

**Eerlijke grens.** Voor een opleider is de enige realistische aankoop in 2026
een avatar die een goedgekeurd script voorleest. Een gefilmde collega als avatar
vraagt gedocumenteerde, geïnformeerde en intrekbare toestemming, wegens
portretrecht en de AVG.

## Het ontwerp dat hieruit volgt

**Eén keuzescherm, twee deuren.** De knop "maak campagne van deze kans" wordt
een keuze: **Volledige campagne**, die de acht stappen start, of **Losse
uiting**, die één kanaal, één opleiding en één stuk oplevert. Dezelfde keuze
komt onder een AI Visibility-bevinding, waar vandaag alleen een blogvoorstel in
een rapport blijft staan.

**Een losse uiting is een echte rij, geen nepcampagne van één item.**
`campaign_id`, `brief_version_id` en `concept_version_id` worden nullable, met
`owner_scope` en een CHECK die de twee aan elkaar bindt, zodat de afspraak in de
database staat en niet in elke query. `brand_profile_version_id` en
`course_version_id` blijven verplicht: een losse uiting hoort bij een opleiding
en een merk, en juist die verankering maakt haar veilig zonder briefing.

**De herkomst gaat mee.** `origin_kind` en `origin_ref_id` op de rij, zodat een
blogartikel uit AI Visibility terugwijst naar het rapport en de passage ernaast
getoond kan worden. Bij een nieuwe scan kan de tekst opnieuw tegen de bevinding
worden gehouden. Dat is het ene ding dat de hele markt laat vallen.

**Koppelen mag later en is niet exclusief.** Vanuit het item zelf, met een
vervolgkeuzelijst, zoals GenStudio het doet. Nooit zoals HubSpot, waar
koppelen aan de ene campagne het item uit de andere haalt.

**En in dezelfde oplevering een filter "Zonder campagne" in de Content Studio.**
Geen enkele leverancier documenteert zo'n weergave, en dat is precies hoe een
los item de dag erna onvindbaar is.
