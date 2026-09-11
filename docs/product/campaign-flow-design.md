# Campaign flow redesign: objective, funnel stages and channel advice

**Status:** decided and **slice 1 built**, 2026-09-11. The three decisions
marked **[decision]** below were taken as recommended (see *Decisions taken*),
and the build record at the end says what slice 1 delivered and where it
deviates from this text. Slices 2 and 3 are open items F-2 and F-3 in
`backlog.md`.

## Why

Creating a campaign today produces the same shape of output every time, and the
cause is not a weak model. It is three structural facts about the current flow:

| What the code does | What a marketer sees |
| --- | --- |
| A campaign has an *entry mode* (idea / briefing / discover) and a *process stage*, but **no objective**. | "It doesn't know whether I'm introducing the course or closing enrolments." |
| The content prompt says *"Boodschap en CTA zijn voor alle kanalen gelijk"* — one thesis, one call to action, for every channel. | "Every channel says the same thing." |
| Channels are a list on the brief; the plan spreads one piece per channel per week; the only reasoning field explains the *size* of the set. | "It never tells me why these channels, and I can't ask for all of them." |

A senior marketer plans the other way round: **objective → audience journey →
message per stage → channel per stage → creative**. Channels come last, and each
one comes with a reason.

## Principles

1. **Objective first, channels last.** A campaign starts with what it must
   achieve, the funnel follows from that, channels follow from the funnel.
2. **Three funnel stages, one fixed vocabulary.** `discover` (Ontdekken),
   `consider` (Overwegen), `decide` (Beslissen). Fixed rather than configurable,
   because a shared vocabulary is what makes reasoning, results and learnings
   comparable across campaigns. **[decision 1]**
3. **Each stage has its own message, proof and call to action.** Not one message
   executed six ways.
4. **Recommend, never dictate.** The system proposes channels per stage with an
   argument. The user can add any producible channel — including all of them —
   and the system says what it thinks of that choice.
5. **Reasoning is visible, checkable and honest.** Fit arguments (stage ×
   channel × audience × course facts), never invented reach, cost or conversion
   figures. Same rule the advertising proposals already live under.
6. **The simple path stays simple.** Pick an objective, accept the
   recommendation, go. The power path is one toggle away.

## The funnel stages, as marketing

| Stage | The audience | The message | Proof allowed | Call to action | Channels that fit | Channels that fit less |
| --- | --- | --- | --- | --- | --- | --- |
| **Ontdekken** | Does not yet see the need | The problem, the moment, the ambition. Why this matters now. | Confirmed course facts only; **no price or dates** here | Low commitment: *lees meer*, *bekijk* | LinkedIn / Instagram / Facebook organic, Meta Ads for reach, landing page as the destination | Google Search (nobody is searching yet), e-mail (no relationship yet) |
| **Overwegen** | Knows the need, is comparing | What you learn, for whom, how it works, what makes it the right fit | Confirmed facts, accreditation **if confirmed** | *Bekijk de inhoud*, *plan een gesprek* | Landing page, e-mail nurture, LinkedIn, Google Search Ads (they are searching now), Meta retargeting | Instagram organic (weak for comparison) |
| **Beslissen** | Ready to act | Practicalities: dates, price, entry conditions, how to enrol | **Only confirmed facts** — this is the stage where an unverified price does damage | Direct: *schrijf je in* | E-mail, Google Search Ads (high intent), landing page enrolment section | Social organic (low intent, wrong moment) |

The fit column is **editorial knowledge**, encoded as rules with reasons — not a
model's guess. That is deliberate: the skeleton of the argument is the same for
every label, and putting it in code makes it testable, auditable and free of
invented numbers. The model's job is to tailor the argument to *this* campaign
(these personas, this course), not to invent the marketing theory.

## Objective → stages

| Objective (chosen at creation) | Stages | Calendar shape |
| --- | --- | --- |
| Bekendheid (awareness) | discover | Weeks 1–2 |
| Overweging (consideration) | consider | Weeks 1–2 |
| Inschrijving (conversion) | decide | Weeks 1–2, aligned to the confirmed course start |
| **Hele funnel** | discover → consider → decide | Sequenced: weeks 1–2, 2–3, 3–4. The calendar (P3-3) finally has a reason for its order |

Objective **complements** the existing entry mode rather than replacing it: the
objective is *what*, the entry mode is *from what* (an idea, a briefing, or
research). **[decision 3]**

## The flow, screen by screen

### Stap 0 — Doel (new, at creation)

*"Wat moet deze campagne bereiken?"* Four cards, one line each:

- **Bekendheid** — mensen kennen de opleiding of de behoefte nog niet.
- **Overweging** — mensen kennen de behoefte en vergelijken opties.
- **Inschrijving** — mensen zijn klaar om te kiezen; wegnemen wat nog in de weg zit.
- **Hele funnel** — alle drie, na elkaar.

Below it, the existing *"Hoe wil je beginnen?"* stays as the secondary choice.

### Stap 1–2 — Doelgroepen, Kansen

Unchanged. Personas and opportunities are stage-independent.

### Stap 3 — Briefing

Gains a **per-stage block**. For each selected stage:

- kernboodschap voor deze fase
- call to action voor deze fase
- **bewijs**: which confirmed course facts this stage may use (checkboxes over
  the card's fields; unconfirmed fields are shown but not selectable, with the
  reason)
- buiten kader for this stage

The single `coreMessage` becomes the **campaign thesis** — the sentence that
holds the stages together — and the stages carry their own message beneath it.

### Stap 4 — Concepten & beeldrichting

Unchanged. Creative direction spans the stages; it is the *look*, not the
message.

### Stap 5 — Kanaalplan (today: Contentpakket)

The heart of the change. A **stage × channel grid**:

```
                 LinkedIn  Instagram  Facebook  Landing  E-mail  LinkedIn Ads  Meta Ads  Search Ads
 Ontdekken        [●]        [●]        [○]      [●]      [ ]        [○]        [●]        [—]
 Overwegen        [●]        [—]        [ ]      [●]      [●]        [○]        [○]        [●]
 Beslissen        [ ]        [—]        [ ]      [●]      [●]        [ ]        [ ]        [●]

 ●  aanbevolen (gevuld, standaard aan)      ○  mogelijk (open, standaard uit)
 —  ontraden (grijs, met reden bij hover)   [ ] niet van toepassing / niet geproduceerd
```

- Default selection = the recommended cells. One click generates the standard,
  well-argued plan.
- Toggle **"Alle creatives maken"** fills every producible cell. The advice
  panel does not disappear — it now reads *"Je hebt 14 items gekozen; voor
  Beslissen op Instagram raden we het af omdat …"*. Advice, not a lock.
- Before generating, an **estimate**: calls, images, and the budget reservation
  the job system already computes — labelled as an estimate, booked per task.
- Right-hand panel **"Waarom dit advies"**: the argument per stage, citing the
  persona insights and course facts it rests on. Two layers, kept visibly
  separate: *Regel:* (the editorial fit) and *Voor deze campagne:* (the model's
  tailoring).

Below the grid: the calendar, now sequenced by stage.

### Stap 6 — Content & beelden

Grouped **by stage, then by channel**. Every card carries a stage badge and the
stage message it serves, so a reader can check a LinkedIn post against
*Ontdekken*'s message rather than against a campaign-wide thesis. The export
package mirrors this: `CONCEPT_ontdekken/linkedin_organic/…`.

### Resultaten & Lessen

Outcomes are recorded per **stage + channel**, so a learning can say
*"e-mail in Overwegen"* rather than *"the campaign"*. Nothing else about P4-1
and P4-2 changes.

## Reasoning: two layers, and where the honesty lives

**Layer 1 — rules, in `packages/contracts`.** `channelFit(stage, channel)`
returns `recommended | possible | discouraged` with a generic Dutch reason.
Deterministic, unit-tested, no model involved. This is the marketing theory,
written down once.

**Layer 2 — the model, tailoring.** Given the personas, the confirmed course
facts, the brief thesis and the rule verdicts *as input*, it writes the
campaign-specific argument. **[decision 2]** — may it also *adjust* a verdict?
Recommended answer: yes, one step, with a reason — a persona who is
demonstrably not on Instagram is a legitimate reason to downgrade Instagram from
recommended to possible. The UI shows both (*Regel: aanbevolen · Advies:
mogelijk — waarom: …*) and the person decides. It may never upgrade a
*discouraged* channel to *recommended*.

**What the model may never do**, enforced the same way the advertising
proposals enforce it: cite reach, click-through, cost or conversion figures.
The advice schema has no field for a number, and the prompt says so. A reason
has to be about fit, audience and stage — things a reader can check against the
persona and the course card.

## Data model

Migration `0020_funnel`:

| Change | Table | Notes |
| --- | --- | --- |
| `objective` | `campaigns` | `awareness \| consideration \| conversion \| full_funnel`, nullable. Old campaigns read as *"geen doel vastgelegd"*, honestly, rather than being back-filled with a guess |
| `stage_messages` jsonb | `brief_versions` | `[{ stage, coreMessageNl, ctaText, proofFactFields[], offLimitsNl[] }]` |
| `stage` | `content_plans.items[]` | Which stage each planned piece serves |
| `channel_advice` jsonb | `content_plans` | `[{ stage, channel, ruleVerdict, advisedVerdict, reasoningNl }]` |
| `funnel_stage` | `content_asset_versions` | Nullable for content made before this existed |
| `funnel_stage` | `outcome_reports` | Nullable; a platform report may not split by stage |

Contracts: `funnelStage` enum, `campaignObjective` enum, `channelFit()`,
`channelAdvice` schema (no numeric fields — asserted by a test, like
`adProposal`).

Prompts: `brief.draft` gains the per-stage block; `content.plan` becomes the
channel-advice step and receives the rule verdicts; `content.generate` receives
the stage and its message and loses the *"boodschap is voor alle kanalen
gelijk"* rule. All three bump their version.

## Slices

| Slice | Contents | Size |
| --- | --- | --- |
| **1. Objective and channel advice** | `funnelStage`, `campaignObjective`, migration, Stap 0 card picker, `channelFit` rules + tests, plan items with stage, the grid with recommended defaults, "Alle creatives maken" with the estimate, content generation receiving the stage | L |
| 2. Per-stage briefing | The stage block in Stap 3, proof selection over confirmed facts, prompt changes, content grouped by stage in Stap 6 and in the export | M |
| 3. Results by stage | Stage on outcomes and learnings, the calendar sequenced by stage | S |

Slice 1 alone changes what a user sees: a campaign that knows what it is for,
a plan that says why these channels, and the option to make everything anyway.

## Decisions taken (2026-09-11)

1. **Stage vocabulary.** Ontdekken / Overwegen / Beslissen, three fixed stages
   (`discover | consider | decide`). The labels are cheap to change; the
   *number* of stages is not, because everything downstream keys on it.
2. **The model may adjust a rule verdict one step** with a reason, shown side
   by side with the rule; never from *ontraden* to *aanbevolen*. Enforced as a
   schema refinement, not only asked for in the prompt.
3. **Objective alongside entry mode.** *What* the campaign is for and *from
   what* it starts are different questions and both are real.

## Build record — slice 1 (2026-09-11)

Delivered as designed: `funnelStage`, `campaignObjective`, `channelFit` with
its reasons, `channelAdvice` without a numeric field, Stap 0 objective cards
(no default), the stage × channel grid with recommended defaults and *Alle
creatives maken*, the size estimate, the advice panel with both layers, content
per stage with a stage badge, the mock adapter planning from the same rule
table, and the browser smoke exercising the full funnel. Tests:
`packages/contracts/tests/funnel.test.ts` and
`apps/api/tests/integration/funnel-plan.test.ts`. The full account is in
`docs/PLATFORM.md`, section *Campaign flow: objective, funnel stages and
channel advice*.

Where the build deviates from the text above:

- The migration is `0021_funnel`, not `0020` — that number was taken meanwhile.
- Content generation makes **one provider call per stage**, each carrying
  `<funnelfase>` with the stage's guidance, rather than one call for all
  stages. Three sets of instructions in one call would drift back to the single
  message this change exists to remove, and per-stage calls keep each answer
  inside the output limit.
- Content is already grouped by stage in Stap 6 and filed under stage folders
  in the export (`CONCEPT_ontdekken/linkedin_organic/…`), with the advice
  printed in `publicatieplan.txt` — items this document placed in slice 2. The
  export change was not optional: two pieces on one channel at the same version
  would otherwise have overwritten each other in the package.
- The estimate before generating states items and images, not money. The
  reservation is computed per job at enqueue and a client-side figure would
  have been a second, possibly disagreeing, number.
- Campaigns created before this change read as *geen doel vastgelegd*, plan as
  a full funnel until an objective is set (`PATCH …/objective`, once), and keep
  their stage-less content under the historical asset keys.

## What this does not change

The gates. An unverified course fact still never reaches content, a
publish-ready export is still refused while anything is unconfirmed, and
*Beslissen* — the stage that wants to say the price — is exactly where those
gates earn their keep. The funnel makes the product more capable; it does not
make it looser.
