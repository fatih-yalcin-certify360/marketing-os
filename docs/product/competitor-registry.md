# Concurrenten bewaren en opnieuw onderzoeken

Geïmplementeerd op 15 september 2026.

In **Marktradar → Concurrenten** beheer je de aanbieders die bij een label horen. Deze tab werkt ook vóór de eerste scan. De gegevens worden gedeeld met de merkenlijst van de handmatige AI Visibility-metingen; het zijn dezelfde bedrijfsrecords.

## Werkwijze

1. Kies een label en opleiding en open **Concurrenten**.
2. Voeg een bedrijf toe met naam en website. Optioneel: opleidingspagina’s, LinkedIn-organisatiepagina, Facebook, Instagram, andere namen, domeinen en notities.
3. Kies alle opleidingen van dit label of koppel de huidige opleiding. Koppelingen gebruiken een stabiele opleidingssleutel en blijven daardoor werken na een nieuwe opleidingsversie.
4. Start een scan. Actieve, gekoppelde concurrenten worden automatisch meegenomen, ook als **Ook nieuwe bronnen zoeken** uitstaat en er geen losse bronlinks zijn ingevuld.
5. Nieuwe, met een gelezen passage onderbouwde aanbieders verschijnen als voorstel. **Toevoegen aan concurrenten** bewaart het bedrijf voor deze opleiding, met verwijzing naar de oorspronkelijke scan en passage. Daarna kunnen de bedrijfslinks worden aangevuld.

Een voorstel wordt nooit automatisch opgeslagen. Bestaande bedrijven worden niet opnieuw als nieuw voorgesteld. Uitschakelen stopt het meenemen in volgende Radar-scans; het wist de geschiedenis niet. Een eigen merk wordt niet als concurrent onderzocht. De handmatige AI Visibility-benchmark blijft zijn eigen meetselectie en historische snapshots gebruiken.

## Wat een scan daadwerkelijk leest

Per actieve concurrent krijgt de eerste opgeslagen opleidingspagina voorrang, anders de website of het eerste domein. Als alleen een sociaal organisatieprofiel beschikbaar is, kan dat de primaire bron zijn. De overige opgeslagen links en namen gaan mee als context voor herkenning en aanvullende ontdekking. Dit is geen volledige crawl van alle sociale berichten.

De primaire bronnen van geregistreerde concurrenten komen vóór losse en nieuw gevonden bronnen. Een scan leest maximaal `max(10, aantal gevolgde concurrenten + 5)` unieke pagina’s. Er kunnen maximaal 25 actieve concurrenten met bron voor één opleiding tegelijk worden gescand; grotere selecties leveren vóór het starten een duidelijke melding op. Aanvullende links die buiten de selectie vallen worden geteld in de scannotities.

De rapportage bewaart een momentopname van de gebruikte bedrijfsnamen, IDs en primaire bronlinks. Een mislukte bron blijft als bronprobleem zichtbaar. Nieuwe leveranciersuggesties zijn beperkt tot zes per analyse; een scan is geen volledige marktinventaris. Alleen een echte scan kan een brononderbouwd voorstel in de bedrijfsregistratie omzetten. Demovoorstellen kunnen niet worden overgenomen.

De bestaande advertentieverzameling blijft begrensd: Google gebruikt maximaal twee externe domeinen; Meta en LinkedIn gebruiken de cursusterm. De registry vervangt deze adapters niet. Een LinkedIn-profiel opslaan geeft geen extra toegangsrechten en activeert geen LinkedIn Ad Library API.

## Gegevens en controles

- `visibility_entities.profile` bewaart de extra velden via migration `0027_competitor_profiles.sql`; bestaande bedrijven worden niet gekopieerd.
- Naam-, alias- en domeinconflicten worden labelgebonden gecontroleerd. Beide bewerkingsroutes gebruiken dezelfde controle. Wijzigen via de bestaande AI Visibility-editor behoudt de extra profielvelden en herkomst.
- Alleen gebruikers met schrijfrechten mogen toevoegen, wijzigen en voorstellen overnemen. Bronrun, bedrijf en opleidingskoppelingen worden op hetzelfde label gecontroleerd.
- Bronlinks vereisen publieke HTTPS-adressen. LinkedIn verwacht een organisatiepagina (`/company/` of `/school/`). Het lezen gebruikt daarnaast de bestaande DNS-, redirect- en netwerkcontroles.
- Opgeslagen rapporten en AI Visibility-benchmarks worden niet herschreven wanneer een bedrijfsprofiel verandert.

Belangrijkste tests: `apps/api/tests/integration/competitor-registry.test.ts` voor opslag, rechten, dubbelen, onveilige links, gedeelde gegevens, expliciete acceptatie en hergebruik in een volgende scan. De tests gebruiken een tijdelijke database en gecontroleerde bronantwoorden; ze bewijzen geen live toegang tot sociale netwerken.
