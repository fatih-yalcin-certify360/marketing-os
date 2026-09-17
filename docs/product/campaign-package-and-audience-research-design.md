# Campaign package, audience research and channel advice — redesign

**Status:** decided and partly built, 2026-09-11. The product owner accepted
the recommended answer to all six decisions ("do everything") and Codex was
idle, so the Codex-owned files were edited directly. R-1, R-2, R-3 and R-6 are
built; R-4, R-5 and R-7 in part — the slice table says which part, and
`docs/product/backlog.md` carries the remainder.

**How this document was produced, honestly.** Three code readers mapped the
package, persona and funnel code with `file:line` evidence, and six web
researchers gathered best practice with the URLs they actually opened (682
tool calls). The planned design panel, judges and adversarial verifiers could
**not** run — the subagent spend limit was reached — so the synthesis below was
written by one author from that material. Every practice cited here carries
its source; claims the researchers could not verify are listed as such rather
than asserted. Treat the recommendations as argued, not as independently
judged.

## Why

The product owner's concerns, and what in the code causes each:

| Concern (paraphrased) | Structural cause |
| --- | --- |
| "The package output has nothing for e-mail or the other channels." | The package is a closed enum of three *forms* — `campaignDeliverable = ['blog_faq','fit_check','google_studio']` (`packages/contracts/src/campaign-package.ts:5`) — sent to the provider as strict schema, so the model cannot propose anything else. Channels live in a different flow (`content.plan` / `content.generate`, eight channels) with a bare button as the only hand-off. |
| "Banner and fit check are produced automatically; I want it to think and propose." | `campaign.deliverables` names the three forms in prose and the generation schema is fixed-shape (2–4 sections, 2–4 FAQ, exactly 3 questions × 3 options, one banner with 2 options), so every run generates all parts whether selected or not, and unselected copy ships inside the ZIP (`campaign-packages/render.ts:92`). The recommendation prompt receives no personas, no objective, no funnel stage and no channel plan (`campaign-packages/service.ts:65-68`). |
| "Is the doelgroep taken into account in channel choice?" | Partly. `content.plan` receives the personas and may move a rule verdict one step "if these personas give a concrete reason" — but a persona carries **no channel or media-habit field** (`packages/contracts/src/personas.ts:48-70`), so the model can only infer from need/barrier prose and a reviewer has nothing to check the reasoning against. The mock adapter never moves a verdict; the panel then prints the rule twice. |
| "The questions must mean something; answers might help us find new personas." | The fit-check widget keeps answers in an in-memory array and posts nothing (`market-radar/package.ts:36`); the Studio banner only fires `Enabler.counter`. No answer distribution ever reaches the product, and the contract for learnings states they cannot touch personas (`packages/contracts/src/learnings.ts:27-32`) — correctly, but it means there is no research loop at all. |
| "Not on the right path yet." | The screen says so too: two numbering systems (tabs 1–5, cards 1–6), "Contentpakket" meaning three different things, five competing purple buttons, the chain ending at Export with no results step. |

## What the evidence says

Only practices with an opened source are listed. Confidence is the
researcher's: *primary* (the author or body itself), *secondary* (reputable
summary), *weak* (vendor or tertiary).

### Funnel and message

| Practice | Source | Confidence |
| --- | --- | --- |
| Model stages as **intent clusters** people enter at any point, not a linear pipeline; judge each stage's content only on that stage's job; uniform sales messaging to a discover audience alienates it. | Kaushik, *See, Think, Do, Care* (2013, 2015) — https://www.kaushik.net/avinash/see-think-do-content-marketing-measurement-business-framework/ | primary |
| Different message **and** CTA per stage: See = useful content, soft CTA; Think = value content earning a micro-conversion (signup, download, quiz); Do = product copy, hard CTA. Stage-specific KPIs; never judge See/Think on conversion ("a fish by its ability to climb a tree"). | same | primary |
| ~95% of a B2B category is out of market at any time; advertising to them builds memory links to **buying situations**; search-only reach never builds mental availability; the 95% figure is a heuristic, not a rule. | Dawes / Ehrenberg-Bass, *95:5* (2021) — https://marketingscience.info/news-and-insights/advertising-effectiveness-and-the-95-5-rule-most-b2b-buyers-are-not-in-the-market-right-now ; LinkedIn B2B Institute — https://business.linkedin.com/marketing-solutions/b2b-institute/b2b-research/trends/95-5-rule | primary |
| Brand building (emotional, broad, repeated) vs activation (an offer, a date, a performance claim; tightly targeted). Roughly half/half in B2B as a starting point, not a law — Binet says it varies; Sharp disputes the data basis. | Binet & Field, *5 Principles of Growth in B2B* (2019, PDF) | primary |
| In the consideration loop buyers pick the option they are **most certain is good**; social proof, category heuristics and authority reduce uncertainty; use these "responsibly", never as sludge; ad copy and landing page must agree. | Google / Behavioural Architects, *Decoding Decisions* (2020, PDF) — https://www.thinkwithgoogle.com/_qs/documents/9998/Decoding_Decisions_The_Messy_Middle_of_Purchase_Behavior.pdf | primary |
| Regulatory labels have a dated trigger: the Wft PE cycle (2025–2028) and loss of advisory authority; candidates bunch exam attempts toward the cycle end. | CDFD, *Tien jaar Wft-examens* (2024) — https://cdfd.nl/nieuws/tien-jaar-wft-examens/ | primary |

### Channels and audience evidence

| Practice | Source | Confidence |
| --- | --- | --- |
| Public NL figures a system may cite: CBS StatLine 84888NED (CC BY 4.0, attribution required) — social-network participation 2025: 45–55 y 82.0%, 55–65 y 74.3%; the education gap is small for social networks but large for e-mail and information search. Cite with year and group; never for a specific platform. | CBS OData 84888NED — https://opendata.cbs.nl/ODataApi/odata/84888NED/TypedDataSet | primary |
| Newcom *Nationale Social Media Onderzoek 2026* (n=6,685, 15+): 14.6M Dutch users; cite headline figures only from the free report with "bron: Newcom NSMO 2026"; the paid dashboard's splits may not be republished. | https://www.newcom.nl/nationale-sociale-media-onderzoek-2026/ | primary |
| Reuters Digital News Report is about **news** use only (Facebook for news declining in NL); state the limitation when citing. | https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2025/netherlands | primary |
| Personas need a mandatory **information-sources** field (where and when the audience orients: search, provider site, employer/HR, colleagues, LinkedIn, trade media, reviews); channels derive from it. | Content Marketing Institute (2025) — https://contentmarketinginstitute.com/audience-building/build-b2b-marketing-personas | secondary |
| Proto personas without research are an echo chamber; qualitative personas (5–30 interviews) for most teams; statistical personas need 100–500+ respondents. Label generated personas honestly as proto-personas. | Nielsen Norman Group (2020) — https://www.nngroup.com/articles/persona-types/ | secondary |
| LinkedIn Ads: target Job Function + Seniority + Skills, not a few job titles; 300-member minimum; only Campaign Manager's forecast is a legitimate size estimate. Retargeting per platform is defined by its documentation (Meta 1–180 days; LinkedIn 30–365 days, 300 min; Google data segments). Search reaches people "actively searching" — a poor Ontdekken channel by Google's own wording. | LinkedIn Help — https://www.linkedin.com/help/lms/answer/a424655 ; Meta developers; Google Ads Help — https://support.google.com/google-ads/answer/2567043?hl=en | primary |
| Mid-career professionals have a second decision-maker: the employer/L&D budget holder (~53% of NL workers took a work course in two years; ~30% wanted to but did not, citing workload or cost). | ROA 2024 via ArbeidsmarktInZicht — https://arbeidsmarktinzicht.nl/roa-leren-en-ontwikkelen-in-nederland | secondary |

### Questions as an instrument

| Practice | Source | Confidence |
| --- | --- | --- |
| One concept per question; options mutually exclusive and exhaustive (add "weet ik nog niet" where three cannot cover everyone); no leading wording; general before specific; pretest with cognitive interviews; rotate option order. | AAPOR, *Best Practices* (2022, PDF) — https://aapor.org/wp-content/uploads/2022/11/AAPOR-Standards-best-practices_March-2022.pdf | primary |
| Forced choice between concrete situations beats agree/disagree (acquiescence); pilot open questions first and build closed options from real answers. | Pew Research Center — https://www.pewresearch.org/writing-survey-questions/ | primary |
| One question per screen reduces satisficing (straightlining, first-option picking). | Roßmann, Gummer & Silber, JSSAM 2018 — https://academic.oup.com/jssam/article/6/3/376/4349665 | primary |
| Dutch institutions run a **two-tier** pattern: a short orientation quiz that deliberately outputs no programme, and a longer test returning a ranked shortlist with a reason each; items are forced choices about activities, not traits. | HZ — https://hz.nl/studiekeuze-test-jezelf ; Hogeschool Rotterdam; Studiekeuze123 | primary |
| A check must be non-recruiting and never read as selection; a bare negative outcome is ignored and resented — pair it with an alternative route and a conversation. | ResearchNed for OCW, *De studiekeuzecheck* (2017) | primary |
| No scores, percentages, "slaagkans" or competence judgements from a marketing quiz: instruments that make statements about persons need validity, reliability and norms (COTAN, ITC). For Wft the required module is a **legal role mapping** (CDFD vakbekwaamheidsbouwwerk), not a personality outcome. | NIP/COTAN; ITC *Guidelines on Test Use* — https://www.intestcom.org/files/guideline_test_use.pdf | primary |
| Consumer law: influence may not steer people to a choice they would not otherwise make; fake personalisation ("je komt in aanmerking" for everyone) is misleading; explain how the outcome was derived; commercial nature recognisable; scarcity only when true; measure whether people would have chosen the same without the technique. | ACM, *Leidraad Bescherming Online Consument* (2024) — https://www.acm.nl/system/files/documents/leidraad-bescherming-online-consument-2024.pdf | primary |
| Minimum n before reading segments: 100+ per segment for anything acted on, 30–50 indicative in B2B; quiz-takers are a self-selected opt-in sample and must be reported as such. | NN/g; AAPOR; Conjointly/aytm | secondary |

### Privacy and claims (NL/EU)

| Practice | Source | Confidence |
| --- | --- | --- |
| Legitimate interest is not a default basis for marketing analytics; write the three-step test and tell participants at the point of the quiz. | EDPB Guidelines 1/2024 (consultation version) | primary |
| Tracker-free by default: storing/reading on the terminal needs consent unless strictly necessary (Telecommunicatiewet 11.7a); cookiewalls and "door verder te gaan" are invalid consent (AP). | https://wetten.overheid.nl/BWBR0009950/2025-07-01 ; Autoriteit Persoonsgegevens | primary |
| Aggregate classification without individual evaluation is **not** profiling; labelling a lead with a persona **is**, and in NL requires a prior DPIA. | AP, *AVG-regels voor profilering* (2025) ; WP29 WP251 | primary |
| Statistical purpose: results are aggregate data not used for decisions about a person (GDPR Rec. 162); pseudonymised data remains personal data (EDPB 01/2025; WP29 05/2014). | EDPB 01/2025 — https://www.edpb.europa.eu/system/files/2025-01/edpb_guidelines_202501_pseudonymisation_en.pdf | primary |
| Small-cell practice in NL statistics: at least **10 unweighted units** per cell, no cell above 90% of its row/column, show unweighted n next to every percentage. These are CBS release rules, not a statutory marketing threshold. | CBS, *Guidelines for output from the microdata environment* (Oct 2025) | primary |
| Claims: "erkend" only where a named body recognises that exact thing (CDFD recognises **exam institutes**, not trainers; diplomas via DUO); no self-created titles as graden; no unsubstantiated results or pass rates (NRC art. 7–8; NRTO code). One total price incl. mandatory costs; "van/voor" on the lowest price of the previous 30 days; scarcity only when literally true. | Stichting Reclame Code 2022/00301; NRTO gedragscode; ACM Leidraad 2024 | primary |
| Fit-check participants are **not customers**: marketing e-mail needs a separate, demonstrable opt-in (Code E-mail 2025). | https://www.reclamecode.nl/nederlandse-reclame-code/bijzondere-reclamecodes/ | primary |

### Recommendations and measurement

| Practice | Source | Confidence |
| --- | --- | --- |
| Phrase every recommendation as a hypothesis with a pre-agreed signal: "Because we saw [insight] we believe [assumption]; we will know when we see [metric]." | Pip Decks, *Hypothesis Statement* | secondary |
| Measurement ladder inputs → outputs → outtakes → outcomes; establish a baseline; stage-appropriate metrics even for no-cost campaigns. | UK GCS, *Evaluation Cycle* — https://www.communications.gov.uk/publication/evaluate-and-learn-the-evaluation-cycle/ | primary |
| Paid tests as platform-native experiments: one variable, 50/50 split, ≥7 days (Meta), 2–3 weeks (Google), no mid-test edits; report intervals; "no lift detected" is a result. Lift studies are not available to small accounts — name proxies as proxies. | Google Ads Help — https://support.google.com/google-ads/answer/6261395?hl=en ; Meta Business Help | primary |
| Format selection is a bounded, purpose-first catalogue ("if your purpose is X, use type Y", with preconditions), chosen **after** message and stage; anchor on one core asset and atomise; interactive and banner formats only with a distribution channel and a metric; banners suffer banner blindness. | GOV.UK *Choose a content type*; Cognism; NN/g *Banner Blindness* (2007); CMI B2B Benchmarks 2025; Demand Gen Report 2024 | primary/secondary |
| Treat generative AI as a junior team member: every statistic or claim traced to an opened source or marked "assumption"; the marketer who authorised it owns the result; NL government handreiking: generative AI is "geoptimaliseerd voor plausibiliteit, niet voor nauwkeurigheid". | CIM (2026); ASA/CAP; Rijksoverheid handreiking (2025) — https://open.overheid.nl/documenten/9c273b71-cebb-4e11-b06f-fa20f7b4b90e/file | primary |

### Could not verify (kept out of the design)

The researchers flagged, among others: Google-owned pages for See-Think-Do
(only Kaushik's blog); the full text of *The Long and the Short of It* (60:40
and "double the profit" come from Thinkbox's summary); Gartner and McKinsey
buyer-journey figures (403); Newcom per-platform splits by age or profession
(paid dashboard); any NL study of how Wft/VCA candidates orient; every quiz
completion or opt-in benchmark (vendor pages only — Interact's 65% completion
and 40% start-to-lead are vendor observations, not controlled findings); an AP
or EDPB numeric small-cell threshold (none exists; the k ≥ 10 rule is CBS
practice); and any published case of quiz answers being validly converted into
marketing personas. Nothing below rests on these.

## The redesign

### 1. Deliverables proposed by the model, from a catalogue

**Today:** three forms, always all three generated. **Target:** the model
chooses from a **purpose-first catalogue** (GOV.UK pattern) and argues each
pick; it cannot invent a form, and a new form enters the catalogue only as a
human-edited entry — the same control `PRODUCIBLE_CHANNELS` gives channels.

Catalogue entry shape (contract, `packages/contracts/src/deliverables.ts`, new):

```
deliverableForm: {
  id, labelNl, purposeNl,
  stageFit: { discover, consider, decide } → recommended | possible | discouraged, with reasonNl,
  channels: marketingChannel[]          // where it runs
  producible: boolean                    // this build can make it (else shown, not selectable)
  effort: 'S'|'M'|'L', measureNl, whenNotNl, complianceNl
}
```

Initial catalogue (producible today marked ●): ● social post (LinkedIn /
Instagram / Facebook), ● landing page sections, ● e-mail, ● search ad set,
● LinkedIn Ads copy, ● Meta Ads copy, ● blog/FAQ (package), ● fit check
(package), ● Studio banner (package); ○ comparison guide, ○ alumni case study,
○ short video / carousel, ○ checklist, ○ webinar Q&A, ○ cost/time calculator.
Stage fit follows the evidence: assessments and calculators late-stage
(Demand Gen Report 2024), banner only with a paid placement and an interaction
metric (NN/g banner blindness), search ads not in Ontdekken (Google's own
wording), e-mail not in Ontdekken (no relationship).

The proposal schema (`deliverableRecommendations` v2) returns per pick: form,
stage, channel, `hypothesisNl` ("omdat … verwachten we … we zien dat aan …"),
`measureNl` (a leading indicator for that stage, never a forecast),
`rationaleNl`; plus `notChosen: [{ form, reasonNl }]` so the person sees why
the rest was left out. Bounded: at most one form per stage × channel cell,
`MAX_PLAN_ITEMS` total; unselected forms are **not generated**.

**Where it joins the funnel [decision 1].** Recommended: fold the package into
the **Kanaalplan** — one plan of stage × channel × form — so e-mail, social
and ads and the website forms are proposed and argued in one place with one
vocabulary. The package's own generation and renderer stay as they are for
the three website forms (Codex-owned); the plan simply *asks for them* the
way it asks for a LinkedIn post. The alternative is two flows sharing inputs,
which keeps the "nothing for e-mail" complaint alive in the package tab.

**Honesty controls.** Catalogue enum as strict schema (no fourth form
invented); `measureNl` and `hypothesisNl` carry no numbers except a client
baseline flagged as such (schema test like `ad-proposal.test.ts`); claim lint
on generated copy for *erkend / geaccrediteerd / officieel / titel /
gegarandeerd / slagingspercentage / internationaal gecertificeerd* requiring a
register URL or rewriting to "certificaat van [label]" (NRC 8.2, NRTO, CDFD).

### 2. Questions as a research instrument

**Design rules, encoded in the contract** (`fitCheckQuestion`): 3–5 questions,
one concept each (stem may not join two ideas with *en/of*), three to four
options that are **first-person situations** ("Ik adviseer al klanten maar heb
nog geen Wft Schade"), never *ja/nee* or *eens/oneens*, an "anders / weet ik
nog niet" option where the set cannot be exhaustive, one question per screen,
option order rotated. Each option carries `feedbackNl` (two sentences, B1
Dutch, states a **route** and a prerequisite, never a verdict or a score) and
`routesTo` (a catalogue deliverable or the enrol page). Per stage: Ontdekken =
recognise the situation, result names the need; Overwegen = comparison
criteria, result is a shortlist with a reason each and one deliberate
alternative (the HZ two-tier pattern); Beslissen = practical readiness,
result links to inschrijven or a gesprek. A fixed purpose line above question
1 — "Drie vragen om je eigen situatie te toetsen — geen test, geen selectie" —
and the label's branding (ACM: reclame herkenbaar). At least one question must
change the outcome, or the personalisation is fake (ACM §12).

**Collection, aggregate-only [decision 2].** Recommended: the widget stays
tracker-free (it already promises "geen persoonsgegevens, cookies of
tracking"); counts are read from the host's own analytics or Studio's
`Enabler.counter` totals and a person **enters the aggregates** — per package
version × stage × question × option, with the period and the traffic source —
exactly as outcomes are entered today (`outcomes.ts` pattern: `platform_report`
with the export attached, or `manual_entry`). Our system never holds a
per-response row, so there is nothing to pseudonymise, no legal-basis question
for research, and no DPIA trigger. The alternative — a self-hosted counting
endpoint — is possible but needs a consent design and contradicts the shipped
promise; it is not recommended for the first version.

**Thresholds [decision 4].** Display a cell only at n ≥ 10 (CBS practice),
suppress smaller cells and totals that would reveal them, show unweighted n
beside every percentage, never show the full cross-tabulation while any
combination is below 10. Persona-hypothesis status only at n ≥ 100 per label
(NN/g); 30–99 shown as *indicatief*; always with the footnote "antwoorden van
zelfgeselecteerde bezoekers uit [kanaal], geen representatief beeld".

**From aggregates to personas — hypotheses a person reviews.** The loop that
exists is learnings: observation → hypothesis → next test, approved, then
handed to the next proposal as context. Extend it rather than bypass it: a
learning may cite `interactionSignalIds` as evidence (beside outcome reports),
`summariseEvidence` counts responders, and an approved learning reaches
`persona.propose` as it already does. `persona.propose` v4 rule: signals may
populate `assumptions`, or `grounding` of kind `observed_outcome` above the
threshold — never a diagnostic claim, never a demographic inference; the
result is a **new draft version** of the persona (`personaKey` reused), which
someone approves or discards. The contract sentence "a learning cannot change
a persona" stays literally true. Missing today and required: a brief pinned
to a persona version must move to `needs_rereview` when that persona gets a
new version (the transition exists only for content).

### 3. Audience-aware channel advice

**Give personas a grounded channel field.** `orientationSources`: up to eight
statements of where and when this audience orients (search, provider site,
employer/HR, colleagues, LinkedIn, vakmedia, reviews; work hours vs private),
each with `grounding` (claim, kind, sourceRef, retrievedAt) — the CMI
"watering hole" questions, made evidence-bound. The prompt rule mirrors the
demographics rule: *only channel behaviour you can trace to a source;
otherwise leave it empty*. Persona grounding is then **verified server-side**
the way research and radar excerpts are: entries whose `sourceRef` matches no
supplied finding move to `assumptions`.

**Which evidence may be cited [decision 3].** Recommended: register public
sources per label as `reference_page` sources — CBS 84888NED (CC BY 4.0, with
attribution), Newcom's free report page, platform documentation, association
and community pages — so `research.findings` can quote them and the figure
carries its year and licence. Not recommended: hard-coding figures in the
contract; they change yearly and Newcom's paid splits may not be republished.
The `research.findings` task rule gains: a finding may be a **channel-presence
claim** ("members of role X discuss Y on platform Z", quoted).

**The advice layer, tightened.** `content.plan` v3: verdicts for every
producible cell (today only the brief's channels get advice while the grid
lets the person tick all eight); the brief's channels are marked
`<kanalen_uit_briefing>`; a one-step move must cite an `orientationSources`
statement or a course fact, and **without such evidence the model keeps the
rule and says so** ("geen doelgroepbewijs over dit kanaal"). The panel already
prints "geen toespitsing" when the reasoning merely repeats the rule (applied
today). Approved learnings are passed to `content.plan` and `content.generate`
(the field exists in `PromptContext`; nothing sets it).

**Second persona.** For mid-career professionals propose an *opdrachtgever*
persona (HR / leidinggevende) with its own Overwegen content and a LinkedIn
Ads route (Job Function HR, seniority Manager+), grounded in ROA 2024.

### 4. Channel coverage and one vocabulary

*Kanaalplan* = the stage × channel (× form) plan, its gate and its stage
(renamed today: `GATE_LABEL_NL`, `APPROVABLE_LABEL_NL`, service messages,
screens). *Campagnepakket* = the three website forms until they join the plan.
*Exportpakket* = the ZIP. The package prompts receive `<campagnedoel>`,
`<funnelfasen>`, personas and the plan's channels, and each deliverable
carries a `funnelStage` and a stage badge (coordination item, Codex-owned
service).

### 5. UX and information architecture

One numbering source. Tabs mirror the chain — **1 Doelgroep · 2 Richting ·
3 Briefing · 4 Concept · 5 Kanaalplan · 6 Content & beelden · 7 Export ·
8 Resultaten & lessen** — and StepCards take their number from the tab. The
package panel becomes an unnumbered branch tab *Website & interactief* until
its forms join the plan (its inner tab *Resultaten (n)* renames to *Gemaakte
pakketten (n)*, freeing "Resultaten" for measured outcomes). One primary
action per screen, derived from gate state; a purple-050 notice at the top
says *Volgende stap: …* and jumps there; the step is written to `?fase=` so
reload and deep links work. Advice reachable without hover: a focused-cell
panel under the grid, cells where advice differs from the rule marked, header
labels readable. A reusable three-pill funnel indicator (Ontdekken · Overwegen ·
Beslissen, covered stages in purple) in the header, the list, the brief's
*Kanalen* row and the calendar. The step navigation's raw hex colours move to
tokens (Codex-owned `flow-navigation.css`). The objective is shown as fixed,
with the reason, or becomes widenable to *Hele funnel*.

```
┌ 1 Doelgroep ─ 2 Richting ─ 3 Briefing ─ 4 Concept ─ 5 Kanaalplan ─ 6 Content ─ 7 Export ─ 8 Resultaten ┐  · Website & interactief
│ Volgende stap: Kanaalplan goedkeuren →                                                                    │
│ Ontdekken ● Overwegen ● Beslissen ●   Doel: Hele funnel · Startpunt: eigen idee                            │
│ ┌ 5 Kanaalplan ────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ [grid: stages × channels × form]   [Alle creatives maken]   Omvang: 9 items                          │ │
│ │ Gekozen vakje: Overwegen · E-mail — Regel: aanbevolen · Voor deze campagne: aanbevolen (bron: …)      │ │
│ │ Meetplan per fase: Ontdekken bereik/frequentie · Overwegen fit-check voltooiingen, e-mail clicks ·   │ │
│ │                    Beslissen inschrijvingen (geregistreerd, geen prognose)                            │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 6. Measurement without forecasts

Every deliverable carries a **hypothesis block** (insight → belief → signal →
review date) and the plan carries a **measurement plan**: one primary leading
indicator per stage on the GCS ladder — Ontdekken: outputs (reach, frequency,
video views) and outtakes (branded search trend); Overwegen: engagement and
intent (landing-page depth, fit-check completions and answer distribution,
e-mail clicks); Beslissen: outcomes (enrolment starts, cost per enrolment) —
plus a decision rule ("na 3 weken: opschalen / aanpassen / stoppen als …").
Paid channels get an **experiment spec** (one variable, 50/50, ≥7 days, no
mid-test edits, minimum audience check) instead of a projection. Results are
recorded as intervals with n and the platform's confidence level; *no lift
detected* is a result. `outcome_reports.funnel_stage` (F-3) and a per-form
metric field make "e-mail in Overwegen" sayable. The UI never offers an
expected-CTR/CPL/enrolments field.

## Data, contracts, prompts, files

| Change | Where | Owner |
| --- | --- | --- |
| `deliverableForm` catalogue, `deliverableRecommendations` v2 with `hypothesisNl`, `measureNl`, `notChosen` | `packages/contracts/src/deliverables.ts` (new), `campaign-package.ts` | mine (contract) / **Codex** (service, render) |
| `fitCheckQuestion` design rules, `feedbackNl`, `routesTo`, purpose line | `packages/contracts/src/campaign-package.ts`, `market-package.ts` | mine (contract) / **Codex** (widget) |
| `interaction_signals` table (aggregates only: package version, stage, question, option, count, period, source, `reportAssetId`) — migration `0022` | `apps/api/db/migrations/`, new module `apps/api/src/modules/interaction-signals/` | mine |
| `learnings.interactionSignalIds`, `summariseEvidence` counts responders | `packages/contracts/src/learnings.ts`, `apps/api/src/modules/learnings/service.ts` | mine |
| `persona.orientationSources` + grounding verification; brief `needs_rereview` on persona revision | `packages/contracts/src/personas.ts`, `apps/api/src/modules/personas/service.ts`, `campaigns-briefs/service.ts` | mine |
| `research.findings` channel-presence rule; public sources per label | `apps/api/src/core/ai/prompts.ts`, `sources-research/service.ts` | mine |
| `content.plan` v3 (every producible cell, brief channels marked, evidence-or-rule), learnings into plan/generate | `apps/api/src/core/ai/prompts.ts`, `concepts/service.ts`, `content-assets/service.ts` | mine |
| Package prompts receive objective, stages, personas, channels; `funnelStage` on deliverables | `campaign-packages/service.ts`, prompts `campaign.deliverables` v3 / `campaign.package` v4 | **Codex** |
| Tabs, numbering, next-step notice, `?fase=`, funnel pills, tokenised navigation | `CampagneDetailPage.tsx` (shared scaffold), `FlowNavigation.tsx`, `flow-navigation.css` | shared / **Codex** |
| Measurement plan + experiment spec deliverable; `outcome_reports.funnel_stage` | `packages/contracts/src/outcomes.ts`, `outcomes/service.ts` | mine |

Prompt versions bump with every template change; the mock adapter follows
each (it must propose the smallest useful set from the catalogue, not all
forms).

## Slices

| # | Slice | Size | Status |
| --- | --- | --- | --- |
| R-1 | One vocabulary (*kanaalplan*), Dutch channel labels in the brief and in job progress, honest advice panel when reasoning repeats the rule | S | **done 2026-09-11** |
| R-2 | `content.plan` v3: advice for every producible cell, brief channels marked, evidence-or-rule, approved learnings into plan and generate | M | **done 2026-09-11** |
| R-3 | Persona `orientationSources` with server-verified grounding; persona evidence visible in full in the persona step | M | **done 2026-09-11** — public sources per label and channel-presence findings still open |
| R-4 | Package prompts receive objective, stages, personas, stage messages and the approved plan; each recommended form names its stage; mock proposes one form per stage | L | **partly 2026-09-11** — the `deliverableForm` catalogue and *niet gekozen omdat* still open |
| R-5 | Brief `needs_rereview` on persona revision, with the gate explaining why | M | **partly 2026-09-11** — question rules, interaction signals and persona hypotheses still open |
| R-6 | Information architecture: eight numbered steps from one list, package as branch, one primary action, `?fase=`, funnel pills, tokens, advice without hover | M | **done 2026-09-11** |
| R-7 | Measurement plan per stage on the content plan (no target, no forecast), ladder guidance, `outcome_reports.funnel_stage`, results step with F-3 | M | **partly 2026-09-11** — experiment spec and intervals with n still open |

## Decisions — taken 2026-09-11

All six were answered with the recommended option by the product owner. Kept
below as the record of what was decided and why.

1. **Fold the campaign package into the Kanaalplan** as forms on stage × channel cells (recommended), or keep two flows that share inputs?
2. **Interaction signals aggregate-only, entered by a person from the host's analytics or Studio counters** (recommended; keeps the widget tracker-free and our system free of per-response data), or a self-hosted counting endpoint with a consent design?
3. **Public audience evidence as registered sources per label** (recommended; figures carry year and licence, CBS CC BY, Newcom free report only), or figures hard-coded in the contract?
4. **Thresholds:** n ≥ 10 per displayed cell, 30–99 indicative, ≥ 100 for persona-hypothesis status (recommended, from CBS practice and NN/g).
5. **A second, employer persona** proposed by default for mid-career labels (recommended, grounded in ROA 2024), or only on request?
6. **Information architecture** — tabs mirror the chain, package as an unnumbered branch: requires Codex to agree, since the tab scaffold and navigation are theirs.

## What this does not change

The gates. Only confirmed course facts reach content; a publish-ready export
is still refused while anything is unconfirmed; brand rules stay hard
constraints; the model still decides no approval or access. Every new
proposal here — a deliverable, a question set, a persona hypothesis — is a
draft a person approves, and every figure shown is one that was recorded, with
its n, never one that was predicted.
