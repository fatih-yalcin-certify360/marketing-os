# Marktradar as a senior marketing-intelligence practice — design and slice 1

**Status:** designed and slice 1 built, 2026-09-11. Slices 2–5 are open and
listed in `docs/product/backlog.md`.

**How this document was produced, honestly.** Two code readers mapped the
radar's backend and screen with `file:line` evidence, and one researcher
gathered research-reporting practice from sources it opened (GOV.UK, NN/g,
UK Analysis Function, ONS, CBS, GCS, IPCC, ICD 203 as quoted, Admiralty
code). Three further researchers (intelligence practice, evidence and privacy
law, Dutch market data), three designers and the judge **could not run** —
the subagent spend limit was reached, for the second time today. The design
below was therefore written by one author from the two maps, the one opened
research angle, the earlier design's opened sources (see
`campaign-package-and-audience-research-design.md`: Ehrenberg-Bass 95:5,
Kaushik STDC, ACM Leidraad 2024, EDPB and AP guidance, CBS disclosure
practice, Reclame Code / NRTO / CDFD claim rules) and professional judgement
labelled as such. Where a practice rests on a source nobody opened in this
session it is listed under *Not verified* and the design does not depend on it.

## Why

The product owner's ask: turn Marktradar into what a senior marketer would
recognise as market intelligence. The code maps name what stood between the
pilot and that:

| What a senior marketer expects | What the pilot did | Evidence |
| --- | --- | --- |
| A **market picture**: what several sources, taken together, mean for this course | One card per page and per excerpt; no synthesis across sources, competitors or runs | `radarProposal` has one `sourceUrl`, one `excerpt` (`packages/contracts/src/radar.ts`); dedupe by URL+excerpt (`market-radar/service.ts`) |
| Insight **before** creative | Three creative approaches generated for every card at scan time, one click below a model-written "kans voor ons" | `approaches: z.array(radarApproach).length(3)` on every card |
| **Graded evidence**: how many independent sources, do they agree, what does this not prove | Every kept item is "excerpt found in page" and nothing more; no confidence, no corroboration count | no confidence field on cards, findings or keywords |
| A hand-off that lands in the funnel with an **objective and a stage** | Campaign created with `objective: null` ("Geen doel vastgelegd"), channel guessed by a regex on the approach format | `createLinkedCampaign` and the `Kanaal: …` line in `service.ts` |
| **What changed since last time**, as change notes | A per-card hash badge; the run selector swaps the whole view | `change: first_seen \| changed \| unchanged` per card only |
| Competitors' **claims** next to what we may say | No positioning or claims view | `competitorEvidence = {sourceUrl, organization, excerpt, reason}` only |
| Counts as **sample counts**, never market figures | Bold "16 passende advertenties" without the denominator | `AdvertisingPanel.tsx` |
| **No personal data** in what is stored | Prompt-level instruction only; verbatim vacancy and alumni passages stored, exported and copied into briefs | `radar.audience` prompt; no redaction step |
| The design tokens the rest of the product uses | Seventeen raw hex values in `radar.css` | `radar.css` |

What the pilot got right and this design keeps: SSRF-guarded fetching,
excerpt-in-page provenance for every kept item, `blocked` and `limited` never
read as "no advertisements", keyword volume typed as `null`, immutable scan
reports, the model proposing and a person approving.

## What the evidence says

Only practices with an opened source. Confidence is the researcher's:
*primary* (the body itself), *secondary* (reputable summary).

| Practice | Source | Confidence | Where it lands |
| --- | --- | --- | --- |
| Three-tier report: headlines a manager reads in thirty seconds → themes → evidence; a reader who stops at any layer must not be misled | NN/g, *Creating Engaging Reports* — https://www.nngroup.com/articles/engaging-reports-presentations/ ; GOV.UK Service Manual, *Sharing user research findings* — https://www.gov.uk/service-manual/user-research/sharing-user-research-findings | primary | Marktbeeld tab: insights (headline, Wat / En dus / Nu) → evidence drawer → source page |
| Inverted pyramid; main messages as at most six one-sentence bullets; caveats in the sentence, not in a footnote | UK Analysis Function, *Writing about statistics* — https://analysisfunction.civilservice.gov.uk/policy-store/writing-about-statistics-2/ ; GOV.UK *Clear structure* — https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-structure/ | primary | `headlineNl` is a claim, at most five insights, `notShownNl` on every insight |
| "What we can and cannot conclude" up front; quality messages first | Analysis Function, *Communicating quality, uncertainty and change* — https://analysisfunction.civilservice.gov.uk/policy-store/communicating-quality-uncertainty-and-change/ | primary | `notShownNl` ("Wat dit niet laat zien") required on every insight |
| Show the two inputs behind a confidence label — evidence and agreement — rather than one label; no likelihood words | IPCC, *AR5 Guidance Note on Uncertainties* — https://www.ipcc.ch/site/assets/uploads/2017/08/AR5_Uncertainty_Guidance_Note.pdf | primary | `confidence.evidence` computed from independent domains; `confidence.agreement` stated by the model |
| Separate observation, interpretation, assumption and at least one alternative explanation | ICD 203 as quoted in Mandel et al. (PMC6330287) — primary PDF not reachable | secondary | `observationNl` / `meaningNl` / `alternativeNl` as separate fields |
| Grade source and information separately; a new domain is "untested" until corroborated | Admiralty code — https://en.wikipedia.org/wiki/Admiralty_code | secondary | Evidence strength from distinct domains: one = beperkt, two = gemiddeld, three or more = robuust |
| Do not borrow statistical vocabulary without estimates: no "significant", no "trend" | ONS, *Uncertainty and how we measure it* — https://www.ons.gov.uk/methodology/methodologytopicsandstatisticalconcepts/uncertaintyandhowwemeasureit | primary | `verifyInsights` refuses percentages, *significant*, *trend*, *gemiddeld in de markt* |
| Show the denominator next to every count; small samples must not generalise to "the market" | NN/g, *Present research results responsibly* — https://www.nngroup.com/videos/present-research-responsively/ | primary | "3 van 40 bekeken records"; "steekproef, geen marktinventaris" |
| Store attributes of offerings and organisations, never of persons; strip names and contact details at ingestion | CBS, statistical disclosure control (2024 guide) — https://www.cbs.nl/en-gb/corporate/2024/42/statistics-netherlands-updates-its-statistical-disclosure-control-guide | secondary | `redactReport` removes e-mail addresses and phone numbers after verification; names refused at the prompt |
| Change notes: one full sentence per substantive change, most important first, the new value included | GOV.UK, *Write change notes* — https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/change-notes/ ; Inside GOV.UK, *When to add change notes* — https://insidegovuk.blog.gov.uk/2013/09/09/when-should-you-add-change-notes/ | primary | `digest.items[].noteNl`, computed in code |
| What → So what → Now what | Liberating Structures, *W³* — http://www.liberatingstructures.com/what-so-what-now-what | primary | The order of every insight |
| One primary call to action per page | GOV.UK Design System, *Button* — https://design-system.service.gov.uk/components/button/ | primary | The chosen insight's hand-off is the only purple button once a run exists |
| Details component named by what it holds; two disclosure levels at most | GOV.UK Design System, *Details* — https://design-system.service.gov.uk/components/details/ ; NN/g, *Progressive disclosure* — https://www.nngroup.com/articles/progressive-disclosure/ | primary | "Bekijk 3 bron(nen) en de letterlijke tekst"; drawer → source page, no third level |
| Evaluation ladder vocabulary shared with the Kanaalplan; competitor *activity* is an output, never their result | GCS, *Evaluation Cycle* — https://www.communications.gov.uk/publication/evaluate-and-learn-the-evaluation-cycle/ | primary | `notShownNl` names "geen resultaat van de concurrent"; measurement stays in the Kanaalplan |
| Tags are adjectives; two families at most | GOV.UK Design System, *Tag* — https://design-system.service.gov.uk/components/tag/ | primary | Evidence badge and agreement badge |
| Narrative bias: forbid generated causal language unless a source states the cause | NN/g, *Narrative biases* — https://www.nngroup.com/articles/narrative-biases/ | primary | Prompt rule: no *omdat* unless a source says so; `alternativeNl` required |

### Not verified in this session (the design does not rest on these)

SCIP code of ethics for competitive intelligence; Autoriteit Persoonsgegevens
guidance on web scraping (2024); Auteurswet *citaatrecht* limits for excerpt
length; ad-library terms of use for automated access; Ehrenberg-Bass
*category entry points*; Binet's *share of search*; Dunford's positioning
method; Dutch market data sources (CBS StatLine lifelong learning, DUO open
data, CDFD exam statistics, NRTO, ROA) beyond those opened for the earlier
design. Each is a candidate for the next research pass; until opened, the
radar makes no claim that depends on it.

## The redesign

### 1. Marktbeeld: insights across sources, verified in code

After the extraction calls (cards, audience, keywords, advertisements) one
more model call — `radar.synthesize` v1 — reads **only the run's verified
items** (id, organisation, domain, URL, passage) and proposes at most five
insights, each: `headlineNl` (a claim), `observationNl` (Wat we zagen),
`meaningNl` (En dus, for a named audience in one stage), `nowNl` (Nu, the
action), `alternativeNl`, `notShownNl`, `stage`, `suggestedObjective`,
`agreement`, `evidence[]` (ids of cited items).

`verifyInsights` (`apps/api/src/modules/market-radar/synthesis.ts`) then:

- drops an insight whose cited ids are not in this run, with a note;
- refuses percentages, *procent*, *significant*, *trend*, *gemiddeld in de
  markt* anywhere in the text;
- refuses any digit in headline, meaning or action, and any number in the
  observation that does not occur in a cited passage — a figure may be
  quoted, never produced;
- computes `confidence.evidence` from the count of distinct domains behind
  the cited items (one *beperkt*, two *gemiddeld*, three or more *robuust*)
  and refuses `agreement: eens` for a single source.

A model failure leaves the rest of the report intact with a note, as the
other extraction steps do. The report's `insights`, `digest` and `claims`
fields default to empty, so every historical report still parses and reads as
"gemaakt vóór het marktbeeld".

### 2. Sinds de vorige scan — change notes, computed

`buildDigest` compares the new report with the previous run of the same
course: new, changed (by content hash) and gone source pages, new competitors
(by domain), new questions (by normalised phrase), new advertisements (by
platform and library id) and changed coverage status. Every item is one Dutch
sentence; a changed hash is written as *a changed text, not a market
movement*; a source that dropped out is written as *not in this scan*, not as
gone from the web.

### 3. Positioning: what competitors say, quoted

`competitorClaims` lists the verified passages of competitor pages and
audience competitors, once each, next to our confirmed course facts in the
screen. Reported, never paraphrased, never ranked; a price appears only when
both sides state one.

### 4. The hand-off carries the objective

Every campaign created from the radar — from an insight, a card approach, a
doelgroep finding, a question or an advertisement — takes an `objective` the
person confirms (`ObjectiveSelect`), suggested from the finding: the
insight's stage, the question's intent, *Overweging* for a finding,
*Bekendheid* for an advertisement. `campaignFromInsight` freezes the insight
in the brief in its own order, with every cited passage and URL, the
confidence and the stage, so the campaign lands in the eight-step screen with
its funnel stages decided and its evidence readable in Stap 3.

### 5. Privacy: contact details out, names refused

`redactReport` removes e-mail addresses and phone numbers from every stored
passage (cards, findings, competitors, questions, advertisement text) after
the excerpt-in-page verification, and the report notes how many passages were
affected. Names cannot be redacted reliably; the prompts refuse them and the
residual risk is stated in the screen's *Scan & beperkingen* text and in
`docs/security/data-inventory.md`.

### 6. The screen

Tabs in reading order: **Marktbeeld** (digest, insights with radio selection,
one primary hand-off, positioning) · Kansen · Bewaarde kansen · Doelgroepen &
concurrenten · Advertenties · Zoekvragen · Scan & beperkingen. Course, tab and
run live in the URL. The scan button is primary only while there is nothing
to read. Counts carry denominators. `radar.css` uses tokens only. The
KeywordPanel no longer promises a *conceptpakket* the server refuses.

### What the mock does

`radar.analyze` in the mock now quotes one real sentence per fetched page as a
card marked *uncertain* and *demo*, and `radar.synthesize` writes one insight
per distinct domain citing those cards — so a development scan of a supplied
URL exercises the whole path, including the service's checks, without a
provider.

## Slices

| # | Slice | Size | Status |
| --- | --- | --- | --- |
| MR-1 | Marktbeeld (synthesis, verification, confidence), digest, competitor claims, objective on every hand-off, insight hand-off, redaction, screen in reading order, tokens, mock | L | **built 2026-09-11** |
| MR-2 | Decision trail per insight and card: *opgevolgd / geparkeerd / verworpen* with a reason and owner, shown on later scans; table `radar_decisions` (migration ≥ 0023) | M | open |
| MR-3 | Public, citable Dutch market sources per label (CBS StatLine, DUO, CDFD, NRTO, ROA) as registered `reference_page` sources the synthesis may cite with year and licence; the *moments* calendar (PE cycle, exam periods, budget cycles) | M | open — needs the research pass that did not run |
| MR-4 | Competitor claims extracted as typed attributes (format, duration, price, accreditation *as stated*) with the passage per attribute, for a positioning table; our side from confirmed facts only | M | open |
| MR-5 | Scheduled re-scan with the digest as the deliverable; alerting only on substantive change notes | M | open |

## What this does not change

The gates: a campaign from the radar still starts at Stap 1 and passes persona,
briefing, concept, plan and content approval. Only confirmed course facts reach
content. The radar measures nothing — no volume, share, reach or result — and
says so on every screen.
