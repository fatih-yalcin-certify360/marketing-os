# De interface van 2026 — designsysteem en schermen

De volledige beschrijving van het herontwerp dat op 15 september 2026 is
gebouwd, uit het handoffpakket `design_handoff_marketing_os_2026/`. Eén regel
bepaalt de hele inrichting:

> **De platformkleuren volgen het gekozen label.**

Elk label krijgt zijn palet uit zijn eigen goedgekeurde merkprofiel. Een label
zonder goedgekeurd profiel valt terug op het Certify360-huispalet, en dat wordt
in de interface benoemd in plaats van verzonnen.

Dit document beschrijft wat er staat. Waar het en de code het oneens zijn, is
dit document de fout.

---

## 1. Waar het vandaan komt

Het handoffpakket bevat twee soorten bestanden, en die zijn verschillend
behandeld:

| In het pakket | Behandeling |
| --- | --- |
| `design/Marketing OS 2026.dc.html` | Ontwerpreferentie: een HTML-prototype van alle elf schermen. **Niet gekopieerd.** De schermen zijn nagebouwd in React met de primitives die er al waren. |
| `design/_ds/…/tokens/*.css` | De designsysteemtokens. Overgenomen als `packages/ui/src/design-system.css`, teruggebracht tot wat het product gebruikt. |
| `design/_ds/…/assets/fonts/` | De merkletters. De drie WOFF2-families zijn overgenomen; At Gambit niet (zie §3). |
| `code/` | Drop-in bronnen. Aangepast op de echte typen van de repo en geplaatst. |

Het pakket blijft in de repository staan als de referentie waartegen de
interface wordt gemeten. Het staat in de ESLint-ignores, omdat het in geen
enkele `tsconfig.json` zit.

---

## 2. Tokenlagen

Vier bestanden, in deze volgorde geladen door `apps/web/src/main.tsx`:

| Bestand | Wat erin staat |
| --- | --- |
| `apps/web/src/fonts.css` | De `@font-face`-declaraties. De bestanden staan in `apps/web/public/fonts/` en worden van onze eigen oorsprong geserveerd. |
| `packages/ui/src/design-system.css` | Het huissysteem: lettertypefamilies, gewichten, letterafstand, de spatie- en radiusschaal, schaduwen, bewegingscurves en de focusring. Geen labelkleur. |
| `packages/ui/src/tokens.css` | De `--c360-*`-namen, doorgezet naar de laag hieronder. Plus `body`, de focusring, de skip-link en de mono-hulpklasse. |
| `packages/ui/src/tokens-2026.css` | De `--lp-*`-laag (per label, tijdens het draaien geschreven), de neutralen, de tekstkleuren, de statuskleuren en de maten van de shell. |
| `packages/ui/src/primitives.css` | De componenten, op de maten van 2026. |

### Waarom `tokens.css` doorzet in plaats van verdwijnt

De veertienduizend regels schermcode waren geschreven tegen `--c360-purple-600`
en verwanten. Die namen zijn blijven bestaan en wijzen nu naar de nieuwe laag:

```css
--c360-purple-600: var(--lp-solid);   /* gevulde vlakken met tekst */
--c360-canvas:     var(--n-1);
--c360-radius-lg:  var(--radius-lg);
--c360-font-sans:  var(--font-body);
```

Daardoor volgt élk scherm het label, ook de schermen die nooit zijn aangeraakt.
Het alternatief — elke stylesheet hernoemen — zou dezelfde uitkomst hebben
gehad met een veelvoud aan kans op een gemiste regel.

Twee namen die schermen gebruikten maar die nergens waren gedeclareerd,
`--c360-color-border` en `--c360-danger`, zijn nu echte tokens. Een ontbrekende
custom property maakt de hele declaratie ongeldig, dus die randen waren
onzichtbaar.

---

## 3. Typografie

Drie merkletters, zelf gehost. Geen enkele verbinding met een lettertype-CDN:
zo'n verzoek draagt het IP-adres en de verwijzer van de bezoeker naar een derde
partij bij elke paginalading, en deze applicatie toont labelmateriaal aan
genoemde collega's.

| Rol | Letter | Waar |
| --- | --- | --- |
| Display | **At Gambit** | Uitsluitend externe communicatie. **Niet in de applicatie, en niet meegeleverd** — anders betaalt elke gebruiker een download voor een letter die geen scherm gebruikt. |
| Title | **TT Firs Neue** | De leidende letter *binnen* het product: elke kop, label, eyebrow, knop en tabelkop. |
| Body | **Plus Jakarta Sans** | Alle lopende tekst en lijstinhoud. |
| Mono | **JetBrains Mono** | Cijfers, versies, tijden, bedragen en domeinen, tabulair. De latijnse subset op drie gewichten, OFL-gelicentieerd; geen merkletter. |

De regel die dit afdwingt staat in `tokens.css`:

```css
body { font-family: var(--font-body); }
h1, h2, h3, h4, h5, h6, button, input, select, textarea, label, th {
  font-family: var(--font-title);
}
```

**Schaal in de applicatie.** Lopende tekst 13 · secundair 11,5–12 · meta en mono
10,5–11 · eyebrow 10 (700, +0,12em, hoofdletters, `--lp-deep`) · kaarttitel
13–14 (700) · schermtitel 18 (700, −0,01em) · paginatitel 22 (700, −0,02em) ·
KPI-cijfer 24 mono (600). Regelhoogte 1,45 voor interface, 1,6–1,65 voor
lopende tekst.

De leesmaten van het merk (18px body) horen bij externe communicatie. Dit is
een werkscherm: acht stappen, zevenentwintig stukken content, tabellen met
aangehaalde bronnen.

**Casing.** Sentence case overal. Hoofdletters uitsluitend voor eyebrows en
tabelkoppen.

---

## 4. Het labelthema

`packages/ui/src/label-theme.ts` — palet in, CSS-variabelen uit. Geen React,
geen netwerk, geen verzonnen kleur.

### De twee regels die niet gebroken mogen worden

**1. Een merkkleur is gekozen voor druk, niet voor 12px interfacetekst.**
`#00A894` op wit haalt 2,99:1. Daarom bestaat `--lp-solid` naast `--lp`: dezelfde
kleur, stap voor stap verdonkerd tot kleine tekst erop 4,6:1 haalt. Elk gevuld
vlak dat tekst draagt gebruikt `--lp-solid`; balken, markers en 3px-accentlijnen
gebruiken `--lp`.

**2. De ring om het actieve railitem mag niet uit `--lp` komen.** De rail is
`--lp-shell`, afgeleid van de inkt van het merk. Een merk met één donkere kleur
voor primary én ink — Lindenhaeghe gebruikt `#183B3E` voor beide — zou geen
zichtbare markering hebben. `--lp-active` valt in precies dat geval terug op de
accentkleur, gemeten met `contrast(primary, shell) < 1.5`.

### De tokens

| Token | Afleiding | Gebruik |
| --- | --- | --- |
| `--lp` | merk-primary, onbewerkt | balken, markers, accentlijnen, voortgang |
| `--lp-solid` | primary, verdonkerd tot ≥4,6:1 op wit | **elk gevuld vlak met tekst** |
| `--lp-on` | wit of `#12212b`, op gemeten ratio | tekst op `--lp-solid` |
| `--lp-deep` | idem `--lp-solid` | links, eyebrows, hover van de primaire knop |
| `--lp-accent` | merk-accent | attentiestip, de stip bij de huidige stap |
| `--lp-active` | primary, of accent wanneer die niet van de rail loskomt | de ring om het actieve railitem |
| `--lp-ink` | merk-ink | donkere tekst, eindpunt van de gradiënt |
| `--lp-t1/t2/t3` | primary → wit 94% / 87% / 70% | zachte vlakken, geselecteerde rij, tags |
| `--lp-shell` | ink → zwart 12% | de icoonrail |
| `--lp-shell-2` | ink → wit 10% | de flyout, hover in de rail |
| `--lp-shell-tx` | ink → wit 62% | tekst en iconen in de rail |

### Waar het palet vandaan komt

Het palet reist mee met de labellijst. `labelSummary` heeft een veld `palette`
dat `null` is zolang een label geen goedgekeurd merkprofiel heeft:

| Laag | Bestand | Rol |
| --- | --- | --- |
| Contract | `packages/contracts/src/labels.ts` | `labelPalette` (primary, accent, ink), `palette` op `labelSummary`, nullable |
| Opslag | `apps/api/src/modules/organizations-labels/repository.ts` | `findApprovedColorsByLabelIds` — één query voor de hele schakelaar |
| Afleiding | `apps/api/src/modules/organizations-labels/service.ts` | `paletteOf` leest de opgeslagen JSON en **parseert** hem; een profiel met een andere vorm levert `null`, geen kleur die niemand heeft goedgekeurd |
| Toepassing | `apps/web/src/shell/LabelTheme.tsx` | schrijft de variabelen op `:root`; `paletteOfLabel` geeft dezelfde afleiding aan schermen die het palet tónen |

Omdat het palet al in de lijst zit, hertint de interface bij een labelwissel in
één frame. Er is geen merkquery die eerst moet landen, dus geen flits naar het
huispalet en terug.

---

## 5. De shell

| Bestand | Wat het doet |
| --- | --- |
| `apps/web/src/shell/AppShell.tsx` | De 56px-icoonrail, de 232px-flyout, de 48px-topbalk, de labelschakelaar met kleuren, de identiteitsvlaggen |
| `apps/web/src/shell/nav-icons.tsx` | Eén merk per bestemming, Lucide-geometrie op 1,9px lijn |
| `apps/web/src/shell/CommandPalette.tsx` | ⌘K: spring naar een scherm |
| `apps/web/src/shell/LabelTheme.tsx` | Het palet op `:root` |
| `apps/web/src/shell/shell.css` | De shell, de drie patronen en het gedeelde vocabulaire |

**De rail.** 56 pixels. Dat is wat de driekolomsschermen mogelijk maakt: een
campagnestap, zijn werkvlak en zijn contextpaneel hebben elke pixel nodig die de
vorige 268px-zijbalk aan woorden besteedde die de gebruiker al kent. Het actieve
item is een wit overlayvlak met een 1,5px inset-ring in `--lp-active`. Een
onafgebouwd gebied staat er op 55% dekking, met `aria-disabled` en de reden in
`title` én voor schermlezers — nooit verborgen: verbergen beantwoordt de vraag
"waar is de kalender?" door te doen alsof hij nooit gepland was.

**De iconen zijn per pad, niet per `ProductArea`.** Marktradar en AI Visibility
delen het gebied `kansen`; in een rail zonder tekst zouden twee gelijke glyphs
twee naamloze knoppen zijn die op hetzelfde scherm lijken.

**De topbalk collapst niet.** Elk element is `flex: none; white-space: nowrap`.
Elke kruimel kapt af, niet alleen de laatste: een campagnenaam is een zin, en
een niet-afgekapte middelste kruimel drukte de huidige stap onder het zoekveld
vandaan en printte het ene label over het andere.

**Het zoekveld zoekt schermen, en zegt dat.** "Ga naar…", niet "Zoeken". Er is
geen zoekendpoint, en een veld dat lijkt te zoeken in campagnes, opleidingen en
bronnen is een belofte die het product niet kan waarmaken. Een gebied dat niet
af is, staat in de lijst met zijn reden en is niet te kiezen.

**De labelschakelaar toont per label drie kleuren** en of het palet uit het
eigen merkprofiel komt. Een label kiezen hertint het hele scherm; een
schakelaar die dat verzwijgt, laat de verandering op een bug lijken.

---

## 6. De drie layoutpatronen

Elk scherm gebruikt er één. Nieuwe schermen kiezen er ook één; er is geen
vierde — een scherm dat er een nodig heeft, is een scherm dat niet heeft
besloten waar het voor is.

### A — Overzicht

`.os-page`: 20px padding, grid met 16px gap. Paginakop, KPI-strip
(`repeat(auto-fit, minmax(186px, 1fr))`), dan inhoud. Elke KPI-tegel heeft een
3px verticale balk links in zijn statuskleur; een neutrale tegel houdt zijn
cijfer op `--tx-3`, want de bleke balkkleur haalt 4,5:1 niet.

*Werkruimte, Resultaten, Merk & bronnen, Labels & toegang, Campagnes, en elk
niet-gebouwd gebied.*

### B — Lijst + detail

`.os-split`: `minmax(300px, 364px) minmax(0, 1fr)`. De lijst is sticky onder de
topbalk met eigen scroll: kop met teller, zoekveld, filterpills met aantallen.
Elke rij heeft een 3px marker links die alleen bij selectie kleurt. De teller
zegt altijd hoeveel van hoeveel — een gefilterde lijst met een kaal getal leest
als de hele verzameling. Onder 900px één kolom.

*Content Studio, Opleidingen, Doelgroepen.*

### C — Rail + werkvlak + context

`.os-flow`: `232px minmax(0, 1fr) 264px`. Links een verticale rail van stappen
of subweergaven, midden één onderwerp, rechts een contextpaneel. Onder 1180px
valt de contextkolom weg en verschijnt er een **Context**-knop in de stapkop;
het werkvlak mag niet onder 460px zakken.

Een subweergave-rail toont **altijd** per item eigen inhoud. Een item dat
selecteert maar de inhoud van een ander item laat staan, is een bug — dan hoort
het item niet in de rail.

*Campagne, Marktradar, AI Visibility (die laatste zonder derde kolom).*

---

## 7. Het gedeelde vocabulaire

In `shell.css`, zodat een rij op het ene scherm en een rij op het andere
hetzelfde object zijn in plaats van twee bijna-treffers.

| Klasse | Wat het is |
| --- | --- |
| `.os-panel` | Wit, haarlijn, 16px hoeken. De werkpaardcontainer, met `__head`, `__body`, `__foot`. |
| `.os-rowcard` | De rijvorm die de lijstweergaven delen: eyebrow, titel, badge, body, mono-meta. |
| `.os-kpi` | Eén cijfer, één bijschrift dat zegt waar het vandaan komt, één statusbalk. |
| `.os-pill` | Een status. Draagt nooit een actie. |
| `.os-filter` | Een filtersegment met zijn eigen aantal. |
| `.os-progressline` | "7 VAN 8 velden gecontroleerd", met de balk rechts. Nooit een balk alleen: een balk zonder zin is een getal dat niemand kan narekenen. |
| `.os-note` | Een inline voorbehoud. Toon is nooit alleen kleur: elk blok opent met het woord dat zegt wat het is. |
| `.os-limit` | De slotregel van een weergave: wat deze weergave *niet* bewijst. |
| `.os-step` | Een stap in de campagneketen of een subweergave in een radarrail. |
| `.os-swatch` | Drie merkkleuren als één staal, in de volgorde waarin de interface ze gebruikt. |
| `.os-gradient` | `linear-gradient(150deg, var(--lp-solid), var(--lp-ink))` — dezelfde ramp die de renderlaag gebruikt. |

---

## 8. De elf schermen

| Scherm | Patroon | Wat het doet |
| --- | --- | --- |
| **Werkruimte** | A | De dag beginnen. KPI-strip van vier, wachtrij gesorteerd op wat een besluit blokkeert (niet op datum), zijkolom met fundament, AI-budget en achtergrondtaken. De wachtrij heeft een segmentfilter Alles / Review / Problemen; alleen een probleemrij krijgt een reden in een amberblok. Leeftijd in mono. |
| **Campagne** | C | Stappenrail met acht genummerde stappen, funnelpills en de tak *Website & interactief* achter een scheidingslijn met stippellijnrand — die doet niet mee aan de nummering. Werkvlak met het stapnummer, "Nu aan zet" en één zin die zegt wat deze stap beslist. Contextpaneel: buiten kader, merkregels, merkkleuren, bronnen onder deze stap, versies. |
| **Content Studio** | B | Alle content van het label als één geordende lijst: campagnestukken per kanaal, dan losse uitingen, dan websitepakketten. Detail met metastrip (status, versie, fase, aandachtspunten), de volledige kaart en — voor een losse uiting — koppelen aan een campagne. |
| **Marktradar** | C | Acht subweergaven, elk met eigen inhoud en een aantal dat de lengte van zijn array is. Derde kolom: de aanbieders die deze scan citeerde, naast onze eigen gecontroleerde feiten, met de zin dat er geen rangorde en geen prijsvergelijking is. |
| **AI Visibility & GEO** | C, twee kolommen | Zeven subweergaven: zoekvragen, genoemde bronnen, vergelijking, paginavoorstellen, onderzoeksnotities, nieuw onderzoek, bewaarde onderzoeken, plus de handmatige metingen die eerder achter een disclosure stonden. |
| **Resultaten** | A | KPI-strip van vier en twee tabbladen. Eerlijke leegstand: het systeem meet niets zelf, dus staat er een uitleg met doorstap naar campagnes in plaats van een leeg raster. |
| **Opleidingen** | B | Lijst van kaarten, detail met een voortgangsregel en per veld een rij: veldnaam, waarde met eventueel een rode kanttekening, statuspill. Het lege veld **Data** blijft leeg en zegt "wordt niet geraden". |
| **Doelgroepen** | B | Lijst met herkomstpill, detail met drie cijfers (onderbouwing, aannames, personavragen) en daarna de facetten. Een aanname reist als aanname mee in de briefing, niet als feit. |
| **Merk & bronnen** | A | Twee kolommen: waar het merk vandaan komt naast waarmee het schildert. Per kleur waar die wordt gebruikt en zijn hex, plus een gradiëntvoorbeeld in de eigen kleuren van het label. |
| **Labels & toegang** | A | Tabel met een **PALET**-kolom: de drie kleuren waarmee dat label de interface schildert, met in de `title` of ze uit het eigen merkprofiel komen of uit het huispalet. |
| **Kalender & journeys** | A | Niet gebouwd, en dat staat er. Verwijst naar de planning per campagne bij Kanaalplan. |

---

## 8b. Werk dat doorloopt

Lang werk draait op de worker en de persoon gaat verder. Drie stukken maken dat
waar:

| Onderdeel | Waar | Wat het doet |
| --- | --- | --- |
| De bevestiging | `apps/web/src/components/StandaloneContentForm.tsx` | Een vinkje, de zin dat je verder kunt en bericht krijgt, en het venster sluit zichzelf na 2,6 seconde — lang genoeg om te lezen, kort genoeg om geen tweede ding te zijn dat je moet wegklikken |
| De melding | `apps/web/src/shell/BackgroundWork.tsx` | Rechtsboven, met een link naar het resultaat. Verdwijnt **niet** vanzelf: een melding die vervaagt is er een die iemand mist, en het hele punt is dat de persoon weg was |
| De taak zelf | `apps/web/src/pages/JobsPanel.tsx` | Zolang ze loopt staat ze bij Achtergrondtaken in de Werkruimte, met voortgang en de mogelijkheid te annuleren |

Alleen *overgangen* worden gemeld. De eerste geslaagde ophaling vult de
verzameling taken die al zijn verwerkt; anders zou het openen van de applicatie
een melding geven voor alles wat vorige week klaar kwam.

Een link verschijnt alleen waar het resultaat van de taak zelf zegt waar de
uitkomst is beland. Een geraden bestemming is erger dan geen: die stuurt iemand
naar een scherm dat het beloofde ding niet bevat.

## 8c. Een beeld en wat je ermee doet

Bij aanwijzen — en bij toetsenbordfocus — komt er een donkere laag over een
gerenderde variant met drie acties (`AssetImage.tsx`). De bewoording houdt twee
dingen uit elkaar: **Downloaden** geeft het bestand, **Delen** stuurt een link
naar het stuk in Marketing OS die alleen een collega met toegang tot dit label
kan openen. Teams en Outlook openen met het bericht klaar; versturen doet de
persoon zelf.

Twee regels die daaronder liggen:

- De acties zijn echte links en knoppen in de tabvolgorde. De laag is een
  onthulling, niet de enige weg erheen.
- Op een aanraakscherm is er geen hover, dus staat de laag permanent onderaan
  het beeld.

**Geen call to action in een beeld dat niemand kan aanklikken.** Op een
organische post is de afbeelding geen link; de bestemming staat in het
bijschrift. De renderlaag tekent de call to action en zijn pijl daarom alleen op
kanalen waar het beeld het klikdoel is — vandaag `linkedin_ads` en `meta_ads`,
uit `CLICKABLE_IMAGE_CHANNELS`.

---

## 9. Interactie en gedrag

- **Railitem** — klik navigeert. Actief: wit overlayvlak (`rgb(255 255 255 / 12%)`)
  met 1,5px inset-ring in `--lp-active`. Niet beschikbaar: 55% dekking,
  `aria-disabled`, reden in `title` én voor schermlezers. Nooit verbergen.
- **Flyout** — opent via het onderste railitem. 160ms `cubic-bezier(.32,.72,0,1)`,
  x −6px → 0.
- **Labelwissel** — het menu toont per label drie stalen en of het palet uit het
  eigen merkprofiel komt. Bij keuze hertint alles in één frame, zonder remount.
- **Filters** — clientside over wat de server al gaf; de teller zegt hoeveel er
  worden getoond van hoeveel.
- **Afgekapte tekst** — elke `text-overflow: ellipsis` krijgt een `title` met de
  volledige tekst.
- **Een formulier dat elders op de pagina opengaat, haalt de persoon erheen.**
  Twee keer dezelfde fout gemaakt: de losse-uitingvorm rende in een smalle
  kolom ver boven de vouw, en de concurrenteneditor opent bóven de lijst, dus
  *Bewerken* op de vijfde aanbieder leek niets te doen. Wie een formulier elders
  opent, scrolt het in beeld (`block: 'center'`, zacht tenzij
  `prefers-reduced-motion`) en zet de focus in het eerste veld — dat scrolt ook
  voor een toetsenbordgebruiker en zet de cursor waar de persoon kijkt.
- **Focus** — 2px `--lp-solid` outline met 2px offset, plus de zachte violette
  ring op formuliervelden. Nooit verwijderd.
- **Responsief** — ≤1180px valt het contextpaneel weg; ≤900px wordt lijst+detail
  één kolom.
- `prefers-reduced-motion` — de bestaande regel in `tokens.css` dekt dit.

---

## 10. Wat bewust niet is overgenomen

| Uit het ontwerp | Waarom niet |
| --- | --- |
| At Gambit in de applicatie | Het merk reserveert de displayletter voor externe communicatie. Meeleveren zou elke gebruiker laten betalen voor een letter die geen scherm gebruikt. |
| Een zoekveld dat campagnes en bronnen doorzoekt | Er is geen zoekendpoint. Het veld zoekt schermen en zegt dat: "Ga naar…". |
| Vaste aantallen in de ontwerpteksten (19 klaar voor review, 11 bronnen) | Elk aantal in de interface is een `length` over rijen die bestaan. Een getal dat niemand kan narekenen hoort niet op een scherm dat over bewijs gaat. |

---

*Gebouwd op 15 september 2026, uit `design_handoff_marketing_os_2026/`.*
