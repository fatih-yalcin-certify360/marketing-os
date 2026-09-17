# Handoff: Certify360 Marketing OS — UI/UX herontwerp 2026

Volledig herontwerp van de interface, alle elf schermen, met één regel die de
hele inrichting bepaalt: **de platformkleuren volgen het gekozen label.**

Elk label krijgt zijn palet uit zijn eigen goedgekeurde merkprofiel
(\`brandProfileVersions.colors\`, dat de Brand Portal vult uit
\`tokens.palette.primary|accent|ink\`). Een label zonder goedgekeurd profiel
valt terug op het Certify360-huispalet, en dat wordt in de interface benoemd in
plaats van verzonnen.

---

## Lees dit eerst: twee soorten bestanden

**\`design/\`** — ontwerpreferentie, gemaakt in HTML. Een prototype dat het
bedoelde beeld en gedrag toont. **Niet kopiëren naar de repo.** Bouw deze
schermen na in de bestaande omgeving (React 19 + react-router +
TanStack Query + plain CSS met \`c360-\` tokens), met de primitives die er al
zijn.

**\`code/\`** — wél bedoeld als drop-in, geschreven tegen de echte typen en
conventies van de repo. Niet gecompileerd in de repo: typecheck en lint na
plaatsing.

**Fideliteit: high-fidelity.** Kleuren, typografie, maten en interacties zijn
definitief. Bouw op de pixel na, met \`@c360/ui\` waar een primitive bestaat
(Card, Badge, Button, Icon, KeyValue, Progress, Notice).

---

## Designsysteem

Het Certify360-designsysteem is bindend. Drie merkfaces, zelf gehost:

| Rol | Face | Waar |
| --- | --- | --- |
| Display | **At Gambit** | uitsluitend externe communicatie, H1–H4 op groot formaat. **Niet in de applicatie.** |
| Title | **TT Firs Neue** | de leidende face *binnen* het product: elke heading, label, eyebrow, knop, tabelkop |
| Body | **Plus Jakarta Sans** | alle lopende tekst en lijstinhoud |
| Mono | **JetBrains Mono** | cijfers, versies, tijden, bedragen, domeinen (tabular) |

In CSS: \`--font-display\`, \`--font-title\`, \`--font-body\`, \`--font-mono\`.
De regel in de shell-stylesheet die dit afdwingt:

\`\`\`css
body { font-family: var(--font-body); }
h1, h2, h3, h4, h5, h6, button, input, label, th { font-family: var(--font-title); }
\`\`\`

Radii komen uit het systeem (\`--radius-md\` 12px inputs/knoppen,
\`--radius-lg\` 16px kaarten, \`--radius-pill\` 999px badges/pills) — de
generously rounded echo van de "360"-pill in het logo. Iconen: Lucide,
2px stroke, 13–20px inline. Geen emoji.

**Casing:** sentence case overal. ALL-CAPS uitsluitend voor eyebrows en
tabelkoppen (10px, 700, +0.08em–0.12em).

**Taal:** de interface is Nederlands. Copy is zakelijk en concreet; bij elk
cijfer staat hoe iemand eraan kwam.

---

## Bestandsplan

| Nieuw bestand | Plaats in de repo | Wat het doet |
| --- | --- | --- |
| \`label-theme.ts\` | \`packages/ui/src/label-theme.ts\` | Palet in, CSS-variabelen uit. Contrastberekening. Geen React. |
| \`tokens-2026.css\` | \`packages/ui/src/tokens-2026.css\` | Nieuwe tokenlaag. Importeer ná \`tokens.css\`. |
| \`LabelTheme.tsx\` | \`apps/web/src/shell/LabelTheme.tsx\` | Leest \`useBrand(labelId)\`, zet de variabelen op \`:root\`. |
| \`nav-icons.tsx\` | \`apps/web/src/shell/nav-icons.tsx\` | Eén icoon per \`ProductArea\` voor de rail. |
| \`AppShell.tsx\` | \`apps/web/src/shell/AppShell.tsx\` | Vervangt de huidige shell. |
| \`shell-2026.css\` | \`apps/web/src/shell/shell-2026.css\` | Rail, flyout, topbar, driekolommen, lijst+detail. |

Aan te passen:

1. \`packages/ui/src/index.ts\` — exporteer \`buildLabelTheme\`,
   \`paletteFromBrandColors\`, \`readableOnWhite\`, \`contrast\`,
   \`HOUSE_PALETTE\`, \`type LabelPalette\`; laad \`tokens-2026.css\` ná
   \`tokens.css\`.
2. \`apps/web/src/App.tsx\` — wikkel de shell:
   \`<LabelTheme labelId={activeLabel?.id}><AppShell …/></LabelTheme>\`.
3. \`apps/web/src/shell/navigation.ts\` — **ongewijzigd.** De rail leest
   \`PRIMARY_NAV\`, \`KNOWLEDGE_NAV\` en \`availabilityFor\` zoals ze zijn.

---

## Design tokens

### Labelafhankelijk (runtime gezet door \`LabelTheme\`)

| Token | Afleiding | Gebruik |
| --- | --- | --- |
| \`--lp\` | merk-primary, onbewerkt | balken, markers, 3px accentlijnen, progress |
| \`--lp-solid\` | primary verdonkerd tot ≥4.6:1 op wit | **elk gevuld vlak met tekst**: knoppen, badges, pills, avatar, stapnummer |
| \`--lp-on\` | wit of \`#12212b\`, op gemeten ratio | tekst op \`--lp-solid\` |
| \`--lp-deep\` | idem \`--lp-solid\` | links, eyebrows, hover van de primaire knop |
| \`--lp-accent\` | merk-accent | attentiestip in de rail, stip bij de huidige stap |
| \`--lp-active\` | primary, of accent als \`contrast(primary, shell) < 1.5\` | ring om het actieve railitem |
| \`--lp-ink\` | merk-ink | donkere tekst, eindpunt van de gradiënt |
| \`--lp-t1/t2/t3\` | primary → wit 94% / 87% / 70% | zachte vlakken, geselecteerde rij, tags |
| \`--lp-shell\` | ink → zwart 12% | icoonrail |
| \`--lp-shell-2\` | ink → wit 10% | flyout, hover in de rail |
| \`--lp-shell-tx\` | ink → wit 62% | tekst en iconen in de rail |

**De twee regels die niet gebroken mogen worden.**

1. Een merk-primary is gekozen voor druk en grote vlakken, niet voor 12px
   interfacetekst. \`#00A894\` op wit is 2.99:1. Daarom bestaat
   \`--lp-solid\` naast \`--lp\`; wie een gevulde knop \`background: var(--lp)\`
   geeft, zakt onder 4.5:1.
2. De ring om het actieve railitem mag **niet** uit \`--lp\` komen. De rail is
   \`--lp-shell\`, dat uit ink komt; een merk met één donkere kleur voor
   primary én ink (Lindenhaeghe, \`#183B3E\` voor beide) zou geen zichtbare
   markering hebben. \`--lp-active\` valt in precies dat geval terug op de
   accentkleur.

### Vaste tokens
Neutralen \`--n-0 #ffffff\` · \`--n-1 #f7f8f9\` · \`--n-2 #eef0f2\`;
randen \`--n-br #e3e7ea\` / \`--n-br2 #cfd6db\`.
Tekst \`--tx #182430\` · \`--tx-2 #5d6b78\` · \`--tx-3 #65737f\` (kleinste
leesbare grijs, 4.87:1) · \`--tx-4 #8695a1\` (**alleen scheidingslijnen, nooit
tekst**).
Status \`--ok #1f7a5c\` / \`--ok-t #ecf6f1\` · \`--wa #9a6412\` / \`--wa-t #fdf5e8\` ·
\`--er #a32f22\` / \`--er-t #fbeeec\`.
Maten: rail 56 · flyout 232 · topbar 48 · stappenrail 232 · contextpaneel 264 ·
lijstkolom 300–364.

### Typografische schaal in de applicatie
Body 13 · secundair 11.5–12 · meta/mono 10.5–11 · eyebrow 10 (700, +0.12em,
uppercase, \`--lp-deep\`) · kaarttitel 13–14 (700) · schermtitel 18 (700,
−0.01em) · paginatitel 22 (700, −0.02em) · KPI-cijfer 24 mono (600).
Regelhoogte 1.45 voor UI, 1.6–1.65 voor lopende tekst.

---

## De drie layoutpatronen

Elk scherm gebruikt er één. Nieuwe schermen kiezen er ook één; er is geen
vierde.

**A. Overzicht** — \`padding: 20px; display: grid; gap: 14–16px\`, paginakop,
KPI-strip (\`repeat(auto-fit, minmax(186px, 1fr))\`), dan inhoud. Voor
Werkruimte en Resultaten.

**B. Lijst + detail** — \`minmax(300px, 364px) minmax(0, 1fr)\`. De lijst is
\`position: sticky; top: 48px; height: calc(100vh - 48px)\` met eigen scroll:
kop met teller, zoekveld, filterpills met aantallen. Elke rij heeft een 3px
marker links die alleen bij selectie kleurt. Voor Content Studio, Opleidingen
en Doelgroepen. Onder 900px één kolom.

**C. Drie kolommen (rail + werkvlak + context)** —
\`232px minmax(0, 1fr) 264px\`. Links een verticale rail van stappen of
subweergaven, midden één onderwerp, rechts een inklapbaar contextpaneel.
Voor Campagne, Marktradar en AI Visibility (die laatste zonder derde kolom).
**Onder 1180px valt de contextkolom weg** en komt er een "Context"-knop in de
kop: het werkvlak mag niet onder 460px zakken.

Een subweergave-rail hoort **altijd** per item eigen inhoud te tonen. Een item
dat selecteert maar de inhoud van een ander item laat staan, is een bug — dan
hoort het item niet in de rail.

---

## De elf schermen

### 1. Werkruimte — patroon A
De dag beginnen: wat wacht op een besluit, waar staat het label, wat loopt.

Paginakop met begroeting naar het uur. KPI-strip van vier: Klaar voor review
(19), Actie nodig (06), Actieve campagnes (05), Gepland deze week (00 —
"Planningsmodule nog niet gebouwd"). Elke tegel heeft een 3px verticale balk
links in de statuskleur.

Daaronder \`minmax(0,1.9fr) minmax(260px,1fr)\`:
- **Wachtrij** — gesorteerd op wat een besluit blokkeert, niet op datum. Rij =
  \`22px 1fr auto\`: statusvlak met icoon (check / info / alert), titel als
  link, subregel, bij een probleem een reden in een amberblok, rechts de
  leeftijd in mono en één knop. Segmented filter Alles/Review/Problemen.
- **Zijkolom** — Fundament (merkprofiel, opleidingen, doelgroepen,
  kanaalspecs, elk met statuspill), AI-budget (bedrag in mono, dunne balk),
  Achtergrondtaken (vijf regels met statusstip), en een tintkaart
  "Automatisering met controle".

### 2. Campagne, stap 6 van 8 — patroon C
Per stap één besluit nemen zonder de context kwijt te raken.

**Stappenrail:** campagnenaam, funnelpills (Ontdekken/Overwegen/Beslissen,
\`flex-wrap: wrap\`, actieve in \`--lp-solid\`), acht stappen met rond nummer
(20px, mono), statusregel, en rechts een vinkje als de stap af is of een
accentstip bij de huidige. Onder de keten, achter een scheidingslijn, de
branch "Website & interactief" met stippellijnrand — die doet niet mee aan de
nummering.

**Werkvlak:** stapkop met "Nu aan zet", voortgangsregel "2 VAN 2 items",
itemkiezer per kanaal (geselecteerde met \`--lp\` rand en 3px \`--lp-t2\` ring),
dan het item: kop met "Tekst aanpassen" en "Goedkeuren", waarschuwingsblok,
hook, genummerde secties, en een balk met instructieveld + "Herzien met AI".

**Contextpaneel:** Buiten kader (rood, de \`must_not\`-regels plus onbevestigde
velden), Merkregels, Merkkleuren van dit label met hex, Bronnen onder deze
stap (met controledatum, expliciet "onverifieerd" waar dat zo is), Versies.

### 3. Content Studio — patroon B
27 stukken beoordelen zonder te zoeken. Lijst met teller ("8 stuks", bij een
filter "5 van 8"), zoekveld, filterpills met aantallen (Alles / Review /
Goedgekeurd / Aandacht). Detail: eyebrow met kanaal, titel, metastrip (Status,
Versie, Fase, Export), dan de tekst (hook + body + tags) en rechts de
beeldvarianten (A als merkgradiënt
\`linear-gradient(150deg, var(--lp-solid), var(--lp-ink))\`, B als tintvlak met
stippellijn, 4:5) plus Aandachtspunten.

### 4. Marktradar — patroon C
**Acht subweergaven, elk met eigen inhoud.** Badge = array-lengte, geen
literal.

| Weergave | Inhoud |
| --- | --- |
| Marktbeeld (5) | "Sinds de vorige scan"-diff + vijf selecteerbare inzichten met fase, bewijskracht en bronovereenstemming, plus het campagnedoel-voorstel |
| Kansen (4) | voorstel per stuk met fase, bewijskracht en het inzicht waaruit het komt |
| Bewaard (1) | shortlist, met de scan waaraan de kans gekoppeld blijft |
| Concurrenten (3) | aanbiederscitaten, zonder rangorde of prijsvergelijking |
| Doelgroepen (3) | rolbeschrijvingen uit de bronnen, met de persona waarvoor ze de basis zijn |
| Advertenties (15) | per adverteerder gegroepeerd (6+5+3+1), zonder budget of bereik |
| Zoekvragen (8) | 3 bevraagd in AI Visibility, 5 niet |
| Scannotities (5) | wat is gelezen, wat is geweigerd, wat buiten beeld bleef |

De rijen van de zeven niet-Marktbeeld-weergaven delen één rijtemplate:
eyebrow, titel, badge, body, mono-meta. Elke weergave sluit af met een
eigen voetregel over wat de weergave *niet* bewijst.

### 5. AI Visibility & GEO — patroon C, vier subweergaven
Zoekvragen (3) met per vraag het antwoord en het oordeel "genoemd /
verouderd / niet genoemd" · Genoemde bronnen (11 bronnen, 26 vermeldingen,
6 met link) als tabel met kolommen BRON / IN VRAGEN / GENOEMD / SOORT /
KOPPELING · Paginavoorstellen (3) met doorstap naar Content Studio ·
Onderzoeksnotities (5). De knoppen in een vraagkaart springen naar de
bijbehorende weergave. **Aantallen worden uit de data gerekend, nooit
ingetypt.**

### 6. Resultaten — patroon A
KPI-strip (lessen 00, campagnes met resultaat 00, publicaties 00, gewijzigde
bronnen 01) en twee tabs. Eerlijke leegstand: het systeem meet niets zelf, dus
staat er een uitleg met doorstap naar campagnes in plaats van een leeg raster.

### 7. Opleidingen — patroon B
Lijst met één kaart (CROV v2, 7 van 8 velden). Detail: voortgangsregel
"7 VAN 8 velden gecontroleerd", dan per veld een rij
\`150px minmax(0,1fr) 116px\`: veldnaam, waarde met eventueel een rode
kanttekening, statuspill. Het lege veld **Data** blijft leeg en zegt "wordt
niet gebruikt" — er wordt geen datum uit prozatekst geraden.

### 8. Doelgroepen — patroon B
Vier persona's, lijst met herkomstpill (Handmatig / Voorstel). Detail:
drie statistieken (onderbouwing, aannames, personavragen), bij open vragen een
amberbalk met "Open vragen laten invullen", dan de facetten (wat deze persoon
wil / waar het vastloopt / aannames / uit welke bronnen). Een aanname reist
als aanname mee in de briefing, niet als feit.

### 9. Merk & bronnen — patroon A
Brand Portal-status (Production 0.4.0, laatst gecontroleerd), de labelkleuren
met per kleur waar die wordt gebruikt, een gradiëntvoorbeeld, en de merkregels
als grid. Een "niet doen"-regel komt in het buiten kader en blokkeert content
die hem overtreedt.

### 10. Labels & toegang — patroon A
Tabel \`minmax(0,1.6fr) minmax(0,1fr) 120px 92px\`: label, jouw rol, herkomst,
en een **PALET**-kolom met de drie merkkleuren als swatches. Daaronder Jouw
account en Leden van dit label. Een label waarvoor je geen rol hebt, staat
niet grijs — het wordt niet teruggegeven.

### 11. Kalender & journeys — patroon A
Niet gebouwd, en dat staat er. Verwijst naar de planning per campagne bij
Kanaalplan. Liever benoemen wat ontbreekt dan een leeg raster dat af lijkt.

---

## Interacties & gedrag
- **Railitem:** klik navigeert. Actief = wit overlayvlak
  (\`rgb(255 255 255 / 12%)\`) met 1.5px inset ring in \`--lp-active\`.
  Niet-beschikbaar: 55% opacity, \`aria-disabled\`, reden in \`title\` én voor
  schermlezers. Nooit verbergen.
- **Flyout:** opent via het onderste railitem of een gebiedsicoon zonder eigen
  scherm. 160ms \`cubic-bezier(.32,.72,0,1)\`, x −6px → 0.
- **Labelwissel:** het menu toont per label drie swatches en of het palet uit
  het eigen merkprofiel komt. Bij keuze herschrijft \`LabelTheme\` de
  variabelen op \`:root\`; alles hertint in één frame, zonder remount. Tijdens
  het laden van het merkprofiel blijft het vorige palet staan — geen flits
  naar het huispalet en terug.
- **Filters:** clientside over wat de server al gaf; de teller in de kop zegt
  hoeveel er getoond worden van hoeveel.
- **Afgekapte tekst:** elke \`text-overflow: ellipsis\` krijgt een \`title\` met
  de volledige string.
- **Focus:** 3px zachte violette ring (\`--ring\`) plus violette border, of
  2px \`--lp-solid\` outline met 2px offset. Nooit verwijderd.
- **Hover:** knoppen verdonkeren één stap (\`--lp-deep\`) en liften 1px; rijen
  krijgen \`--lp-t1\`. Geen beweging in lijsten.
- **Responsief:** ≤1180px valt het contextpaneel weg; ≤900px wordt lijst+detail
  één kolom. De topbar collapst niet: elk element is
  \`flex: none; white-space: nowrap\` en de labelnaam kapt op 15ch.
- \`prefers-reduced-motion\`: de bestaande regel in \`tokens.css\` dekt dit.

## State
Nieuw in de shell: \`navOpen\`, \`labelsOpen\` (lokaal).
Per scherm: actief filter, geselecteerd item, actieve stap, actieve
subweergave.
Serverstate ongewijzigd — \`useWorkspace\`, \`useBudget\`, \`useJobs\`,
\`useSourceImpact\`, \`useCampaign\`, \`useBrand\`. Het thema hangt aan
\`useBrand(labelId)\`: die query bestaat al en wordt hiermee door de shell
gebruikt in plaats van alleen door Merk & bronnen.

## Assets
Geen nieuwe afbeeldingen. Iconen: de bestaande \`Icon\`-set uit
\`packages/ui/src/components.tsx\` (check, alert, info, search, chevron-down,
close, sparkles, refresh, clock) plus acht gebiedsiconen in \`nav-icons.tsx\`,
Lucide-geometrie op 1.9px lijn. Geen emoji. Het logo in de rail is de
"360"-tegel in type, geen icoon.

## Bestanden in deze bundel
- \`design/Marketing OS 2026.dc.html\` — het interactieve ontwerp, alle elf
  schermen, labelwissel, filters, stap- en subweergavenavigatie. Open in een
  browser; \`support.js\` en \`_ds/\` staan ernaast.
- \`design/Huidig - Werkruimte.dc.html\` — de huidige Werkruimte, nagebouwd uit
  \`shell.css\`, \`tokens.css\`, \`primitives.css\` en \`WerkruimtePage.tsx\`, als
  vergelijkingspunt.
- \`code/\` — de drop-in bestanden uit het bestandsplan.
