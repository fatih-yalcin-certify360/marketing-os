# The platform, in detail

The single reference for how this codebase is put together: what every
directory and significant file is for, how a request travels through it, what
the security controls are and where each one lives, and what is deliberately
not built yet.

Two rules govern this document:

1. **It describes what the code does, not what it should do.** Anything not yet
   built is in [What is not built](#12-what-is-not-built), stated plainly. It
   carries no line counts or test counts in the file tables: a number is stale
   the moment anyone edits the file, and a stale number makes the whole document
   suspect. `platform-doc.test.ts` asserts that every path named here exists.
2. **It is updated in the same change as the code.** A new module, route,
   table, control or dependency is not finished until its row here exists. The
   [Keeping this current](#14-keeping-this-current) section says what to touch.

Last reviewed: **2026-09-11**, after slice 1 of the campaign-flow redesign
(objective, funnel stages, channel advice) and the Phase 4 security review.

---

## Contents

1. [What this is](#1-what-this-is)
2. [Running it](#2-running-it)
3. [Repository layout](#3-repository-layout)
4. [`apps/api` — the modular monolith](#4-appsapi--the-modular-monolith)
5. [`apps/worker` — background jobs](#5-appsworker--background-jobs)
6. [`apps/web` — the Dutch interface](#6-appsweb--the-dutch-interface)
7. [`packages/*` — shared code](#7-packages--shared-code)
8. [`tools/*` — development and measurement](#8-tools--development-and-measurement)
9. [The data model](#9-the-data-model)
10. [The life of a request](#10-the-life-of-a-request)
11. [Security controls, one by one](#11-security-controls-one-by-one)
12. [What is not built](#12-what-is-not-built)
13. [Documentation map](#13-documentation-map)
14. [Keeping this current](#14-keeping-this-current)

---

## 1. What this is

An AI-native marketing operating system for Certify360. A user picks a **label**
(a training brand) and a **course**, and the system walks a chain:

```
label + approved course / brand
  -> Market Radar: public sources, audience and ad evidence, query hypotheses
  -> saved opportunity (or a supplied idea/brief)
  -> campaign: personas, creative direction, approved brief
  -> recommended formats -> user selection -> draft package
  -> Content Studio: cross-campaign library and evidence/review workspace
  -> recorded human assessment -> limited pilot (not publication approval)
  -> measured results / feedback loop: not integrated yet
```

Social copy/images also retain their concept, content-plan, review and gated
export branch. Website/interactive/Studio packages remain draft exports; the
new human pilot review does not grant the social publish-ready gate or Google
approval. CS Opleidingen / CROV is the current live pilot; demo fixtures remain
marked as mock. Some historical implementation notes below describe earlier
phases; the dated updates at the end record subsequent additions.

Three properties are worth stating up front, because they shaped most of the
design:

- **Nothing is published on the user's behalf.** There is no social API
  connection and no ad account integration. An export is a package a person
  then acts on. "Approved" and "published" are separate states.
- **No number appears that was not measured or entered.** No success scores, no
  forecast conversions, no invented CPC or search volume.
- **A model never decides authority.** Approval, access and label scope are all
  server-side decisions; the model produces content and nothing else.

## 2. Running it

```bash
npm install
cp .env.example .env

# Terminal 1 — PostgreSQL. Docker, or the Docker-free wrapper:
docker compose up -d postgres     # or: npm run dev:db
npm run db:migrate && npm run db:seed

# Terminal 2 — everything else
npm run dev                       # api :4000, worker :4001, web :5173
```

`npm run dev:stack` runs the Docker-free database plus all three processes in
one command.

For real AI output, set `AI_PROVIDER=openai` and `OPENAI_API_KEY`. A ChatGPT
subscription is **not** API access — requirement 12 forbids using one that way,
and so do the provider's terms.

`npm run verify` is what CI runs: typecheck, lint, test, build. The exact test
count is deliberately not quoted here — it changes several times a day, and a
stale number makes a reader distrust the rows that are still correct. Run it.

`npm run smoke` is the other gate: it boots a throwaway stack with the mock
provider and drives the whole campaign chain through a real browser, then
asserts what the campaign contains (§8). It needs no API key and costs nothing,
and it is the only check that exercises the interface. Screenshots land in
`var/ui-shots`. To run the same chain against the real provider — which costs
roughly one campaign — start your own stack and use
`npx tsx tools/ui-smoke/index.ts`.

## 3. Repository layout

```
apps/
  api/      HTTP service and every domain module
  worker/   background job runner; imports api modules, never the reverse
  web/      React SPA
packages/
  contracts/  Zod schemas + domain enums, shared by client and server
  config/     server-only environment contract
  ui/         design tokens and accessible primitives
  testing/    in-process PostgreSQL and env factories for tests
tools/
  dev-db/     PostgreSQL over TCP without Docker
  load-test/  HTTP load driver
docs/
  architecture/  overview, modules, load assumptions, extension roadmap
  decisions/     ADR-0001 .. ADR-0016
  security/      threat model, risk register, access matrix, runbooks
  product/       scope, backlog, requirements traceability, testing strategy
infra/docker/    container images
```

The dependency direction is enforced by lint rules, not convention:
`web -> contracts`, `api -> contracts + config`, `worker -> api + contracts +
config`. Nothing shared imports server code, and `config` is server-only so a
secret cannot reach the browser bundle.

## 4. `apps/api` — the modular monolith

One process, many modules. A module owns its rules **and** its tables; it never
writes another module's rows. Cross-module needs go through a service method,
which is why `ConceptService` asks `CampaignService.requireApprovedBrief()`
rather than querying `brief_versions` itself.

### 4.1 `src/core/` — the shared machinery

| File | What it does |
| --- | --- |
| `ai/types.ts` | The three task-scoped adapter interfaces (text, research, image) plus the error types. A provider that lacks a capability does not register it. |
| `ai/index.ts` | Provider factory from `AI_PROVIDER`. |
| `ai/generation.ts` | The wrapper every model call goes through: budget reservation, schema validation, bounded repair, usage recording split into estimated and actual cost. |
| `ai/prompts.ts` | Prompt templates with versions; the version is recorded on every usage row. Rules are split three ways: `UNIVERSAL_RULES` on every task, then either `CONTENT_RULES` ("use only what is in `<gecontroleerde_feiten>`") or `EXTRACTION_RULES` ("`<gecontroleerde_feiten>` is context, not a filter"), chosen by whether the template is in the exported `EXTRACTION_TEMPLATES`. Getting that classification wrong is harmful in **both** directions: the confirmed-facts rule on an extraction task produced a research run with zero findings, and the same rule missing from a content task would let a model write something nobody had confirmed. `prompt-rules.test.ts` keeps its own hand-written classification and asserts the two agree — deliberately not derived from this file, because a derived list agrees with a misclassification too. |
| `ai/strict-schema.ts` | Converts a Zod-derived JSON Schema into OpenAI's strict subset. **OpenAI enforces the shape, Zod enforces the rules.** |
| `ai/openai-adapter.ts` | The real provider. Responses API, `text.format` strict JSON Schema, `store: false`, model/price table, failure classification. |
| `ai/anthropic-adapter.ts` | Alternative text provider. Written, unexercised. |
| `ai/mock-adapter.ts` | Clearly-labelled fake output for development. Refused when `NODE_ENV=production`. |
| `auth/types.ts` | `AuthAdapter`. The subject type deliberately carries **no role and no label** — those come from the database. |
| `auth/create-adapter.ts` | Picks the adapter from `AUTH_MODE`. |
| `auth/local-adapter.ts` | Fixed development identity. Refused in production by env validation. |
| `auth/trusted-header-adapter.ts` | Production identity from proxy headers. Three conditions must all hold; see §11.2. |
| `auth/net.ts` | CIDR matching for `TRUSTED_PROXY_IPS`, IPv4 and IPv6. |
| `authz/policy.ts` | `requireOrgPermission` / `requireLabelPermission`. Deny-by-default. |
| `db/pool.ts` | `node-postgres` pool; sets `statement_timeout` per connection. |
| `db/restore-verify.ts` | The eight checks that decide whether a restore worked. In the application rather than in a test, and taking a query function rather than opening its own connection, because two callers need it: `restore-drill.test.ts` rehearses the whole cycle on a throwaway database on every commit, and `cli/verify-restore.ts` points the same checks at a **real** restored PostgreSQL — without which the drill would prove something about PGlite and nothing about production. The check that matters most is `filesForAssetsExist`: restoring the database and forgetting `STORAGE_ROOT` is the likeliest real mistake and it fails *silently*, since every row is present and only the images are gone. |
| `db/cli/verify-restore.ts` | `npm run db:verify-restore` against a restored **scratch** database. Without a baseline it says row counts are reported and not verified, because "12 labels" is a number rather than a verification; `--write-baseline` records one while the system is healthy. |
| `db/schema.ts` | Drizzle table definitions. **Not** the source of truth — the SQL migrations are; a parity test compares them. |
| `db/migrate.ts` | Forward-only runner with checksum verification. A changed applied migration is a startup failure. |
| `db/seed.ts` / `seed-campaign-data.ts` | 188 / 169 | Demo data, refused when `NODE_ENV=production`. |
| `db/executor.ts`, `db/types.ts` | 33 / 19 | The `Db`/`DbOrTx` distinction, so a service can be called inside a transaction. |
| `errors/app-error.ts` | The only error type handlers throw. Separates `publicMessage` (Dutch, safe) from `internalDetail` (logged, never sent). |
| `errors/handler.ts` | Maps to the single error envelope with a request id. **Every** non-2xx answer goes through it, without exception: a route that answers a refusal with its own success-shaped body leaves the client no message to render, and the client's fallback — "Er is een onverwachte fout opgetreden" — turns a precise refusal into an unknown failure. That is what a refused publish-ready export used to do, with six named reasons available. |
| `files/allowed-types.ts` | The upload allow-list with magic-byte signatures and per-type ceilings. |
| `files/validate.ts` | The single validation contract for file input. |
| `files/svg-guard.ts` | Rejects SVG with active content. Rejection, not sanitisation. |
| `files/zip-guard.ts` | Inspects a zip's central directory **without extracting**. |
| `files/filename.ts` | Refuses traversal, NUL, RTL overrides, reserved names; builds a safe `Content-Disposition`. |
| `files/storage.ts` | Quarantine, content-addressed promotion, path containment, sweep. |
| `files/document-text.ts` | The single entry point for reading an uploaded document. Dispatches on the **stored** MIME type — settled from the bytes at upload, so it is the one piece of metadata the client did not supply. Returns text, never markup. |
| `files/docx-text.ts` | Reads `word/document.xml` out of a docx. Locates and inflates **one** member under a hard cap, after the zip guard has already judged the directory — so an embedded macro or image is never touched. Tracked deletions are dropped: reading them back would put removed wording into a course card. |
| `files/pdf-text.ts` | Reads a PDF's text layer with `pdfjs-dist`, in a `worker_threads` worker so the parent can terminate a page that never yields. Fonts, XFA, worker fetch, base/font/CMap URLs and image decoding are all off; page, character and wall-clock ceilings apply. A scan is reported as a scan, not as empty. |
| `http/context.ts` | `AppContext`: everything a handler may reach. Injected, not imported as singletons. |
| `http/authenticate.ts` | Resolves identity. An `onRequest` hook on the authenticated scope. |
| `http/fair-use.ts` | Per-user and per-label pacing, applied after authentication. |
| `http/security.ts` | helmet, CORS, multipart limits, the pre-auth rate limit, the origin check. |
| `net/ip-guard.ts` | Which resolved addresses we refuse to connect to: loopback, RFC 1918, link-local (so every cloud metadata endpoint), CGNAT, documentation ranges, multicast, and the NAT64/Teredo/6to4 prefixes that embed an IPv4 address. Two block lists, one per family — a single list containing `::/96` matches **every** IPv4 address and silently refuses the public internet. |
| `net/url-guard.ts` | What counts as fetchable: https only (http opt-in), no credentials, ports 80/443 only, no single-label or special-use hostname, IP literals classified before DNS. Pure, so it runs at the route as well as in the job. |
| `net/safe-fetch.ts` | The fetcher. Validates **every redirect hop**, resolves once and connects to the address it classified (closing DNS rebinding), and shares one timeout and byte budget across the whole chain. |
| `net/html-text.ts` | Reduces fetched HTML to prose. Produces text, never HTML, so nothing downstream can render it. |
| `render/renderer.ts` | SVG to PNG via `@resvg/resvg-js`; content-hash addressed. |
| `render/markup.ts` | The one escaper for markup this system generates. There were **four**, in four modules, differing in which characters they covered; the SVG layer and the e-mail builder now share this one, which is the strict version — escaping too much never breaks the output. It is **not** a sanitiser: it assumes the surrounding markup is ours and only the interpolated values are foreign. |
| `render/email-html.ts` | Builds an e-mail from structured copy. Safe by construction rather than by sanitisation: the model returns plain text and this is the only thing that writes tags, so there is no untrusted HTML to clean. No `<script>` and no code path that could write one; **no remote resources at all** — no images, no web fonts, no tracking pixel — so the mail cannot report when it was opened and renders identically with images blocked. Table-based with inline styles because that is what mail clients honour. Colours are re-checked as hex and font names matched against a font-name character set **at the line where they become CSS**: a font family is a free string in the brand contract, and `Inter; background:url(…)` needs no tag or quote to add a remote background. |
| `render/brand-resources.ts` | Loads the files the renderer composites: brand fonts and the real logo. Two sources, and the split is not cosmetic — a **Portal-linked** label gets logo *and* licensed fonts from its published release and refuses to render if any of it is missing or changed; a label with **no** link may still have uploaded a logo, and local editing is refused for Portal-managed labels so the cases cannot both apply. It exists because the Portal loader returns early for any label without a `portal` block, which meant an uploaded logo was validated, stored, referenced by the profile — and never drawn. The asset is re-read label-scoped and its **content hash re-checked** before the bytes are composited: this is the last point at which content is verified before it becomes an image the product exports. |
| `render/layouts.ts` | The brand-correct layouts. **Logos and legible text are composited here, never drawn by a model.** Text fitting is the fragile part: the headline was always wrapped, the call to action was not, and the first real OpenAI run put an 80-character CTA off the right edge of an exportable PNG. Now wrapped and hard-broken, with the logo placed above the CTA block rather than on its baseline, and the arrow drawn as a shape so no font fallback can change its weight. Held by `render-layout.test.ts` (11 tests). |

### 4.2 `src/modules/` — the domain

| Module | Files | Owns | Notes |
| --- | --- | --- | --- |
| `identity-access` | service, repository, routes, members-service, members-routes | `users`, `memberships` | JIT provisioning; a new user gets **no** memberships. `resolveById` lets a job rebuild authority from fresh memberships. `members-service` administers who works on which label: reading the team is label-scoped (`member:read`), changing it is organisation-scoped (`member:manage`), so a label manager can see access and not widen it. Removing the last `label_manager` is refused — nobody would be left who can confirm a course fact. |
| `organizations-labels` | service, repository, routes, workspace-service, availability | `organizations`, `labels` | `availability.ts` is what stops the UI advertising an unbuilt area. |
| `brand` | service, routes | `brand_profile_versions` | Extracted fields are a proposal; approval is explicit; versions are immutable. A `logoAssetId` supplied by a client is a request, not an authorisation: the asset must be in this label, and the **stored mime type** must be `image/png`. That check carries more weight than it looks — every upload is stored with `kind: 'upload'` whatever purpose it was sent for, and `kind: 'logo'` belongs to a Portal release, so a check for kind `logo` reads as correct and rejects every uploaded logo. The purpose is not recorded on the asset row at all. |
| `courses` | service, routes | `course_versions` | **Per-field** verification. An `unverified` field is excluded from prompts and blocks publish-ready export. |
| `personas` | service | `persona_versions` | Fewer than three with a stated reason when grounding is thin. |
| `opportunities` | service | `opportunities` | Ranking rationale, no numeric success score. |
| `campaigns-briefs` | service, routes | `campaigns`, `brief_versions` | `requireApprovedBrief` is the gate for concepts. The campaign detail assembles the whole chain view in one response, including the **derived calendar** — computed there from the plan, the campaign's start date and the course's confirmed dates rather than stored (`contracts/src/calendar.ts`). `setStartDate` accepts a date or `null`, so a date chosen too early can be taken back off. A campaign carries an **objective** — `awareness`, `consideration`, `conversion` or `full_funnel`; null for campaigns from before objectives existed — which decides the funnel stages the plan covers. `setObjective` (`PATCH …/objective`) sets it once on an older campaign and it is not clearable: the plan and the content that follow are argued from it. |
| `concepts` | service | `concept_versions`, `content_plans` | `requireSelectedConcept`, `requireApprovedPlan`. The plan is the **channel plan**: `proposePlan` derives the stages from the objective (`stagesForObjective`; a campaign without one plans as a full funnel and the prompt is told so), hands the model the editorial verdict per stage × channel as `<kanaalgeschiktheid>`, and stores the model's `channelAdvice` on the plan version beside the items, each of which carries a `stage`. `planProblems` is the check the schema cannot make — a stage the objective does not cover, a channel the caller does not allow, a doubled cell — and serves both the model's proposal (a provider error) and a person's edit (a bad request). An edited plan may pick any producible cell for the campaign's stages, including every one of them; the advice travels along unchanged so the approval binds to what the person saw. |
| `content-assets` | service, routes | `content_asset_versions` | The largest service: per-channel copy, two image variants, editing, revision. A **landing page** is the exception to "copy plus a picture": it carries structured `sections` and no image, so the stored `format` follows what was actually produced (`text_only` when nothing rendered) rather than being assumed. That was hardcoded to `single_image`, which blocked every publish-ready export containing a page — the channel was refused for lacking a specification it should never have been asked for — and left the `text_only` LinkedIn spec unreachable. Content is generated **one provider call per funnel stage** (`groupByStage`): each call carries `<funnelfase>` with that stage's message, allowed proof and kind of CTA, the answer must be exactly that stage's channels once each and all for that stage, and the asset key is `${stage}-${channel}-1` so the same channel holds a different piece per stage. Items from a plan made before stages existed form a stage-less group and keep the historical `${channel}-1` key. A revision stays in its piece's stage. |
| `reviews-approvals` | service | `approvals` | An approval binds to `(artefact_type, artefact_id, artefact_version)`. |
| `exports` | service | `exports`, `publication_records` | A landing page's sections travel as a numbered `SECTIES` block in plain text, deliberately not HTML: the package is what a person pastes into their own CMS, and markup the user cannot read first is not something this product emits. Draft vs publish-ready; refusal lists every reason in Dutch, and the refusal is **recorded** rather than only reported. A draft package names itself a draft in its own `LEESMIJ.txt` and prefixes each channel folder `CONCEPT_`, so a file that leaves the system cannot be mistaken for approved material. Staged content is filed under its stage — `CONCEPT_ontdekken/linkedin_organic/…` — because two pieces on one channel at the same version would otherwise overwrite each other in the zip; `publicatieplan.txt` lists the plan per stage and the channel advice with rule and tailored verdict side by side. Covered by `exports.test.ts`. |
| `source-impact` | service, routes | reads only | *A source changed — what does that touch?* Per-campaign staleness already gated a publish-ready export; this is the inverse and wider question, across a label's campaigns at once. It reports **exposure, not wrongness**: a changed page may have had a typo fixed, so no message it can produce asserts a claim is false — a test pins that. `assessExposure` lives in the contract so the judgement is testable and changing it is visible: a recorded publication or a *produced* publish-ready package is high (this system hands over a file and cannot know what happened to it), approved content is medium, a draft is low. The link to the evidence is a **foreign key** — `research_findings.source_id` — so the report lists the actual claims that rest on the change rather than matching text. Campaigns with nothing stale are omitted; the emptiness is the finding. No "fix it" action, deliberately: what to do depends on what changed. |
| `learnings` | service, routes | `learnings`, `learning_evidence` | A person's conclusion, approved before it influences anything, handed to later proposals as **context**. Three fields rather than one — observation, hypothesis, next test — because a single "what we learned" box invites a sentence that reads as a proven cause from a fortnight of data, and a hypothesis nobody could test is an opinion. The system writes no conclusions: it has four data points, not a data set. What it does is **state the size of the evidence** beside the claim (`summariseEvidence`: how many measurements, how many campaigns, how many days, and each reason it is thin) so a reader judges thinness themselves. Thin is never a refusal; the warning travels with the claim into the prompt. The module imports neither the persona nor the brand schema and writes to neither — approving a learning changes exactly one row, its own review state. |
| `outcomes` | service, routes | `publication_records`, `outcome_reports` | What happened after the product's part was over: that a person **published** a specific content version, and what the platform then **reported**. The system measures nothing — no advertising account, no analytics access, no measurement period — so every figure carries `source`, which says whether it was read off an attached export or typed in. A row claiming an export must have the export: that is the one shape that would let a typed guess pass as evidence. Every metric is nullable, because `null` is "not reported" and `0` is "reported as none". **No derived metric is stored** — a ratio would go stale against a corrected input and invites being read as a verdict. The channel comes from the content row, never from the caller. |
| `uploads` | service, routes | `assets` (kind `upload`) | Untrusted file input. Purpose decides the required permission. |
| `sources-research` | service, routes | `sources`, `research_runs`, `research_findings` | A label registers what it wants read — a page **or** an uploaded document; a run reads it and produces findings, each with the source, the retrieval date and the passage it rests on. Staleness is computed from a snapshot of what was read, so the reason a run is out of date can be named. This module reads registered sources; live discovery is handled by `market-radar`. |
| `courses` (URL path) | service | `course_versions` | `extractFromUrl` fetches a course page through the SSRF guard, reduces it to prose, and proposes a card in which **every field is `unverified`** with the URL as its `sourceRef` and the extractor's own doubt in `uncertaintyNl`. A field the page does not mention stays empty. |
| `jobs-usage` | queue, service, budget, usage, generation-jobs, routes | `jobs`, `usage_records`, `label_budgets` | The queue is transactional with the data it guards. |
| `audit` | service | `audit_events` | Security records, **separate from content logging**. Client addresses are hashed with a salt, never stored raw. |

## 5. `apps/worker` — background jobs

**No route calls a model** (ADR-0016). A generating endpoint validates, checks
its gates, reserves budget, writes a job row and returns in milliseconds.

| File | What it does |
| --- | --- |
| `worker/src/index.ts` | Process entry. One loop per concurrency slot, the reaper, two-stage shutdown, the probe server. |
| `runner.ts` | Claim, execute, settle. Heartbeat, cancellation, budget settlement, and `APP_ERROR_FAILURE_KIND` — the mapping that stops a business rule being reported as a crash. |
| `health.ts` | `/health`, `/ready`, `/metrics` on `WORKER_HEALTH_PORT`. |
| `handlers/types.ts` | `JobHandler`, `JobFailure`, `JobCancelled`, `JobContext`. |
| `handlers/generation.ts` | The seven generation handlers. Each re-resolves its actor, so a revoked membership takes effect. |
| `handlers/demo-echo.ts` | A deterministic job for exercising the queue. |

Guarantees the runner exists to hold: no double work (atomic claim,
ownership-guarded write-backs), no lost work (progress committed as it happens),
no phantom success (a provider failure is a recorded failure), and budget
settles exactly once.

## 6. `apps/web` — the Dutch interface

React 19, Vite 8, TanStack Query 5. Interface language is Dutch; content
language defaults to Dutch and is per-campaign.

| File | What it does |
| --- | --- |
| `api/client.ts` | One fetch wrapper. Turns the error envelope into `ApiClientError` carrying the Dutch message and the request id. It depends on the API's rule above: no envelope means no message, and the generic fallback is all the user sees. |
| `api/queries.ts` | Identity, labels, workspace. |
| `api/campaign-queries.ts` | The chain, plus `useJobProgress` with adaptive polling (1.2 s, then 3 s, then 6 s; never in a hidden tab) and `isTerminalJobStatus`, exported so a screen can decide what to disable while work is in flight without keeping its own status list — there were two such lists, and a third would have been the one that forgot `cancelled`. Its campaign id is **optional**: a course card read from a page and a research run belong to the label, not to a campaign. It was once required, so a screen with no campaign passed the literal string `'kansen'` and invalidated a cache key that never existed — a placeholder meaning "nothing" is worse than an absent value, because the next reader cannot tell it from a real id. |
| `shell/AppShell.tsx` | Layout, label switcher, keyboard navigation. |
| `shell/navigation.ts` | The seven areas. An unbuilt area routes to `NietBeschikbaarPage`. |
| `pages/WerkruimtePage.tsx` | Overview. |
| `pages/KansenPage.tsx` | "Ontdek kansen" — exploration, commits nothing. |
| `pages/CampagnesPage.tsx` | The form in the order a marketer thinks: Opleiding (pre-filled when there is one, a placeholder when there are several), *Wat moet deze campagne bereiken?* (four objective cards, **no default**, each naming the stage(s) it plans for from `stagesForObjective`), *Wat heb je al?* (three stacked cards — *Ik heb nog geen idee* / *Ik heb een idee* / *Ik heb al een briefing* — each saying what you supply, what the system does and what you get back; the safe input-free option is the visible default), the idea/briefing textarea revealed directly under that group with a character count from three quarters of the limit, and a **suggested, editable name** from course + objective + month. One summary sentence restates the choices before the button. The button is never disabled for missing input: submit validates and an error summary at the top links to each problem (GOV.UK error-summary pattern); a server refusal lands in the same place. The list shows each campaign's objective and starting point. |
| `pages/CampagneDetailPage.tsx` | The whole chain with per-step job watching. The persona selection is held by `CampaignChain` and passed down, so steps 2 and 3 both read it and the chain runs in the order its headings claim. Every step action reports its own error — a mutation whose failure is not rendered looks exactly like a success. Stap 5 is the **channel plan** (`PlanEditor`): the stage × channel grid, *Alle creatives maken*, a size estimate (items and images — no money figure, the reservation is made per job), the advice panel, and an approval that sends an edited plan only when the selection differs from the proposal. Stap 6 groups content by stage under the stage's message; every card carries a stage badge. A campaign without an objective gets `ObjectiveSetter` in its header. **Due a split.** |
| `pages/MerkPage.tsx` | Brand profile and approval. |
| `pages/OpleidingenPage.tsx` | Course cards with per-field verification, and the panel that creates one from a course page. |
| `pages/JobsPanel.tsx` | Queue, progress, retry, cancel. |
| `pages/NietBeschikbaarPage.tsx` | Says plainly that an area is not built. Not a fake screen. |
| `components/JobWatcher.tsx` | One job-progress behaviour for every screen: the worker's own message, the server's Dutch failure text, a retry when the job says it is retryable. It was a private function inside `CampagneDetailPage` while the Kansen screen called the hook with a placeholder campaign id and the sources panel grew a second poller — three behaviours for one concept, which is how one of them ends up without the adaptive backoff. Also exports `jobResultString`, which had been copied into two screens. |
| `components/CourseIntakePanel.tsx` | Creates a course card from a course **page** or from an uploaded **document** (PDF, Word, text, Markdown). States before anything is submitted that the result is a **concept** — every field `unverified`, its source recorded, nothing filled in that the source does not say — and afterwards names what was read plus the extractor's own reservation. A refusal is specific and costs nothing: a URL's shape is judged before a job is queued, and a document is validated before one is. The two routes share one progress area, because they produce the same artefact and separate ones would invite starting both. |
| `components/SourcesResearchPanel.tsx` | Sources and research runs for a course version: register a page or upload a document, activate or disable a source, start a run, read the findings with their passages. Uses the shared `JobWatcher`. Its findings query keys on whether the job is still busy, because the worker writes the findings — so the key changing once, when the job stops, is what refetches them; the last poll of a busy run can land before the worker has committed. |
| `components/VisualReferencesPanel.tsx` | Up to three of the label's own images as references for image generation. |
| `components/ChannelPlanGrid.tsx` | The grid and the *Waarom dit advies* panel. A cell shows a verdict (● aanbevolen, ○ mogelijk, — ontraden) and a checkbox, kept apart on purpose: the verdict is advice, the choice is the person's, and a discouraged cell can be ticked with the advice still beside it. The verdict shown is the model's advised one when the plan has advice for the cell, else the editorial rule; the panel shows both layers, *Regel* and *Voor deze campagne*, and where they differ, both verdicts. `rendersImage` reads the channel configuration rather than keeping a list of social channels. |
| `pages/campaign-flow.css` | The objective cards and the plan grid, design tokens only. |
| `components/states.tsx` | Loading, empty and error states, including the request id. |

## 7. `packages/*` — shared code

**`contracts`** — the single validation contract. Zod schemas, domain enums and
the access matrix, imported by both client and server so a field cannot drift.
`access.ts` holds the role-to-permission matrix; `channels.ts` holds
channel specifications with a source URL and verification date each, and
separates **hard** constraints (which gate publishability) from **guidance**
(which only warns).

**`funnel.ts`** is the vocabulary that lets the product plan the way a
marketer does — objective, then the audience's journey, then a message per
stage, then channels per stage with a reason. `funnelStage` has three fixed
values (`discover | consider | decide`; `FUNNEL_STAGES` in journey order),
because a shared vocabulary is what makes advice, results and learnings
comparable across campaigns. `campaignObjective` maps to stages through
`stagesForObjective`. `FUNNEL_STAGE_GUIDANCE_NL` states per stage who the reader
is, what the message is about, which confirmed facts may be used and what kind
of call to action fits — one text, given to the model and shown to the reviewer.
`channelFit(stage, channel)` is the editorial verdict per cell with a Dutch
reason: the marketing theory written down once, deterministic and unit-tested,
and free of figures (`funnel.test.ts` asserts that no digit or percent sign
appears in any reason or guidance). `channelAdvice` is the model's layer on top
— rule verdict, advised verdict, reasoning — with **no field for a number**, the
same control the advertising proposal has. It comes in two forms:
`proposedChannelAdvice`, what the provider returns, refines that the rule
verdict matches the table and that the advice moves at most one step from it,
never from *ontraden* to *aanbevolen*; `channelAdvice`, the stored form, keeps
only the one-step rule so a plan stored under an older table still parses.
Refinements are not part of the JSON schema the provider receives, so a
violation surfaces as the normal validate → one repair → recorded failure path.

Three lists in `channels.ts` are easy to confuse and mean quite different
things:

| List | Meaning |
| --- | --- |
| `marketingChannel` | The **vocabulary** — every channel the product will ever address, including ones only designed so far. Stored rows use this, so history stays readable when the producible set changes. |
| `PRODUCIBLE_CHANNELS` | The **capability** — what this build can really produce and export. `plannableChannel` is built from it, and because that enum is what the provider receives, a model *cannot* pick an undeliverable channel rather than being asked not to. |
| `SOCIAL_PILOT_CHANNELS` | The three pilot channels, kept for the assertions that are genuinely about them. |

With Phase 3 complete the first two lists hold the same eight members, and the
distinction still does work: a *proposal* is bounded by the capability, a
*stored row* only by the vocabulary, so the next designed-but-unbuilt channel is
refused the day it is added to `marketingChannel`. The tests assert that wiring
rather than comparing data — they used to feed a proposal an undeliverable
channel, which stopped being possible and failed, correctly.

**Producible is not publishable.** Five of the eight refuse a publish-ready
export: Facebook, e-mail and the three advertising channels, each because its
specifications have not been read against a primary source. Content is still
generated, previewed and exported as a draft; only the publish-ready gate
refuses, and each note names what to check and where.

A widening has to reach both the schema **and** the code that filters against
it. When the landing page became producible, the plan was still intersecting the
brief's suggestions with the *pilot* list, so the schema allowed a page and the
plan filtered it straight back out.

`channelVerification` has a fourth value that is worth knowing about:
**`not_platform_constrained`**, which is deliberately *not* how the advertising
channels or e-mail are marked — they have real limits nobody has verified,
whereas a landing page has none to verify. A landing page is served from the label's own
site, so no platform publishes limits for it and "verified against official
documentation" cannot be true — claiming it would be a fabricated citation, and
`unverified` would block a publish-ready export for ever on a check that can
never pass. The value says the question does not apply; `isPublishable` accepts
it because there is no external limit left to violate, and
`checkAgainstChannel` does not warn about it, because warning would send the
user looking for a document that does not exist. It is **not** a synonym for
verified: a `stale` or `unverified` channel still blocks.

`content.ts` holds `adProposal`, which is worth reading for what it does **not**
contain: no field for search volume, cost per click, budget, reach,
click-through rate or conversions. Those come from an advertising account and a
measurement period, and there is neither — so any figure would be a guess
wearing the clothes of data, on exactly the kind of decision (a media budget)
people make from a number without re-checking it. Instructing a model not to
invent one is not the control; a schema with nowhere to put one cannot carry it,
whatever a later edit to the prompt forgets. `ad-proposal.test.ts` names every
forbidden field so adding one fails and has to be argued for. The string bounds
in that shape are deliberately looser than any real platform limit, so they
cannot be mistaken for one.

`calendar.ts` derives the campaign calendar and is worth reading as an example
of where a decision belongs. A plan says *what* and *how many*, in words; the
**schedule is arithmetic**, computed from the approved plan rather than asked of
a model, because a model asked for dates invents them and an invented date in a
calendar is the kind of detail nobody re-checks. It is derived on read and never
stored: a calendar is a pure function of the plan, the chosen start date and the
course's *confirmed* dates, so storing it would add a fourth thing to keep in
step with three others. And it will not read an unconfirmed course date —
`course.dates` is only populated once a person has confirmed the date fact, and
the prose on the card is deliberately not parsed; when such a value exists the
calendar reports that it is ignoring it. Date arithmetic is done by hand on the
ISO string, because `new Date('2027-12-28')` is UTC midnight and formatting it
back in a timezone behind UTC returns the previous day.

`primitives.ts` holds `webUrl`, which exists because **`z.url()` is not a safe
URL**: it validates syntax, and `javascript:alert(1)`, `data:text/html,…` and
`vbscript:…` are all syntactically valid URLs that it accepts. Several fields
carrying untrusted URLs were declared that way while the interface rendered
them as links — a call to action comes from a brief, a source URL comes from a
model that read a fetched page. `webUrl` allows http and https only, and the
check lives at the contract boundary so every consumer is protected by
construction rather than by each one remembering. `web-url.test.ts` asserts it
per field, because the defect was never that the primitive was wrong — it was
that a field used the wrong one.

**`config`** — `env.ts` is the boot-time safety net. Every server variable
with its type, default and reasoning. `superRefine` refuses: `AUTH_MODE=local`
in production, `AI_PROVIDER=mock` in production, `trusted-header` without
`TRUSTED_PROXY_IPS`, production without `AUTH_PROXY_SHARED_SECRET`, `openai`
without a key, and image generation without OpenAI.

**`ui`** — `tokens.css` is the Certify360 design language; `primitives.css` and `components.tsx` are the accessible primitives.

**`testing`** — `pglite.ts` gives every test a real in-process PostgreSQL.

## 8. `tools/*` — development and measurement

**`dev-db/index.ts`** wraps PGlite in the PostgreSQL wire protocol so the
whole stack runs without Docker. `maxConnections` is 12, because the default of
1 silently starved the worker.

**`ui-smoke/index.ts`** drives the whole campaign chain through the *interface*
in a real browser, screenshotting each stage, and then **asserts what the
campaign contains**. It exists because exercising the API end to end turned out
not to be the same thing, and it has found four defects the API tests could not:
a brief step that started its job and never followed it; a chain that ran
1 → 3 → 2 while its headings said 1 → 2 → 3; every draft export answering 500;
and a refused publish-ready export reaching the user as "an unexpected error".

Reaching every step only proves every button was clickable — each of those
defects was visible in the *state* afterwards, not in the clicking. So the run
ends by reading the finished campaign back through the API and reporting, per
claim, whether it holds:

| Check | Why it is there |
| --- | --- |
| The response has the expected shape | Runs **first**. Every other check reads this object; if the shape changed they would quietly read `undefined` and report something plausible. |
| A briefing exists, is approved, rests on chosen doelgroepen | The brief was once written on the worker and never displayed. |
| Three concepts, one chosen | The product promises three art directions. |
| The content package is approved | |
| Content exists with two image variants | A/B is a promise, not an accident. |
| **A draft package was produced and has bytes** | Nothing checked this, and every draft export answered 500 for several migrations while the button returned quietly to normal. |
| **A publicatieklaar package is refused, with reasons** | Demo facts are unverified, so a *pass* here would mean the gates had stopped working — a worse outcome than a failing step. |
| No script errors | Exceptions and React errors. Deliberately not HTTP statuses: a browser logs "Failed to load resource" for the refusal the run wants to see. |
| No failed request except that refusal | This is how "there is a 500 somewhere" became a named bug. |

**`ui-smoke/with-stack.ts`** boots a throwaway stack — its own PGlite data
directory, its own ports, its own storage root — runs the smoke against it and
tears it down. `npm run smoke`. Three properties are deliberate:

- **`AI_PROVIDER=mock`**, so it costs nothing, needs no key and is
  deterministic: it exercises the product rather than a model. A real-provider
  run stays possible and separate (`npx tsx tools/ui-smoke/index.ts`), because
  that costs roughly one campaign.
- **It shares nothing.** A smoke run that can disturb the database someone is
  working in will not be run, and a failure in a shared database is ambiguous.
- **It always tears down**, and dumps the tail of each server's log when the
  run fails. A 403 the API had already explained in its own log once surfaced
  as a bare locator timeout.

Two things the stack has to be told, both of which are real controls rather
than configuration noise:

- **Its own origin.** `CORS_ALLOWED_ORIGINS` must contain the smoke's web
  origin, because every state-changing request carrying an `Origin` header is
  refused unless it matches. That is a CSRF control; `curl` sends no origin,
  which is why the same POST succeeded from a shell while the browser got 403.
- **Its connection budget.** `tools/dev-db` allows twelve connections;
  `DATABASE_POOL_MAX` defaults to twenty *per process* and the stack runs two.
  The defaults ask for forty and the database resets connections mid-query. The
  fitting values live in the uncommitted developer `.env`, so any fresh machine
  would have hit this — they are set explicitly here with the arithmetic.

**`audit-gate/`** is the dependency-vulnerability gate CI runs
(`npm run audit:gate`). `evaluate.ts` holds the policy as a pure function —
which advisories block, which are accepted, which acceptances have lapsed —
and `index.ts` is the thin part that shells out to `npm audit --json`. It
exists because `npm audit` exits non-zero for *any* finding, so the raw command
was wrapped in `|| true` and stopped being a gate; here the exit code comes
from the policy. `acknowledged.json` records accepted advisories, each with a
reason and an **expiry date**: an exception that cannot lapse is a permanent
silence wearing a note. It also fails on an acceptance that no longer matches
anything (prune it) and on a report format it does not recognise (a gate that
understood nothing must not announce a clean build). Policy:
`docs/security/vulnerability-management.md`; behaviour:
`tools/audit-gate/tests/evaluate.test.ts`.

**`load-test/index.ts`** drives the running API over HTTP with one
distinct identity per virtual user and reports latency percentiles, throughput,
an error breakdown and queue drain time. It **measures**; it asserts nothing.
Results and their conditions: `docs/architecture/load-assumptions.md`.

## 9. The data model

Forward-only migrations under `apps/api/db/migrations/`. Hand-written SQL is
authoritative; the Drizzle schema is checked against it by
`schema-parity.test.ts`.

| Migration | Tables |
| --- | --- |
| `0001_core_identity` | `organizations`, `labels`, `users`, `memberships` |
| `0002_audit` | `audit_events` |
| `0003_jobs_usage` | `jobs`, `usage_records`, `label_budgets` |
| `0004_brand_courses` | `assets`, `brand_profile_versions`, `course_versions` |
| `0005_personas_campaigns` | `persona_versions`, `opportunities`, `campaigns`, `brief_versions`, `concept_versions` |
| `0006_content_approvals_exports` | `content_plans`, `content_asset_versions`, `approvals`, `exports`, `publication_records` |
| `0007_sources_research` | `sources`, `research_runs`, `research_findings` |
| `0008_content_channel_config_version` | adds `channel_config_version` to `content_asset_versions` |
| `0008_research_label_integrity` | Composite label/organization references between research resources, uploads and course versions |
| `0009_brand_portal` | Label-to-Portal links, sync status, immutable release provenance and font assets |
| `0010_generated_visuals` | `generated_image` assets; narrows the unique index on `assets` to `(label_id, sha256, kind) WHERE kind <> 'generated_image'`, because a generated original is not deduplicated by content |
| `0011_campaign_context` | Campaign-specific starting context |
| `0012_art_direction` | Art direction on `concept_versions` |
| `0013_market_radar` | Market Radar capture and analysis |
| `0018_outcomes` | `outcome_reports`. Every figure's provenance is a column, the period is `NOT NULL` and ordered by a check, counts cannot be negative, a row must hold at least one figure, and a `platform_report` row must have the report attached. `publication_records` came earlier (0006) and had no reader or writer until now |
| `0021_funnel` | `campaigns.objective` (checked against the four objectives), `content_plans.channel_advice` (jsonb, default `[]`), `content_asset_versions.funnel_stage` (checked against the three stages). All nullable or defaulted, so nothing existing is back-filled with a guess; the stage vocabulary is checked in the database as well as in the contract. `0020` was already taken by `0020_geo_engine_captures` |
| `0019_learnings` | `learnings`, `learning_evidence`. Length floors on all three prose fields (a three-word "worked well" is the learning that misleads the next reader), an approval-completeness check, and evidence as a real foreign key rather than an array column — so a deleted outcome visibly leaves the learning resting on less than it claimed |

Two migrations share the number `0008`. They were written independently and both
have run everywhere, so renumbering one would mean rewriting applied history;
the runner orders by filename, which is stable. New migrations take the next
free number.

The `0010` change is the one to know about when writing an insert against
`assets`: because the unique index is now **partial**, PostgreSQL refuses to
infer it from `ON CONFLICT (label_id, sha256, kind)` and fails the statement at
plan time with `42P10`. That invalidated the export writer and made *every*
draft export answer 500 until `exports/service.ts` was changed to state only
that a conflict is acceptable and then look the existing row up. Repeating the
index predicate in application code would have worked and would have broken
again at the next index change, so the predicate lives in the migration alone.

Three patterns run through all of it:

**Tenant isolation in the schema, not only in queries.** `users` and `labels`
each carry `UNIQUE (id, organization_id)`, and every dependent table's foreign
key is **composite**:

```sql
CONSTRAINT memberships_label_fk
  FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id)
```

A cross-organisation row is not merely refused by application code — the
database cannot represent it.

**Immutable versions.** A revision inserts version *n+1*; nothing is updated in
place. This is why optimistic concurrency compares against `max(version)` for
the asset key rather than the row's own version — comparing the row to itself
was a real bug, found by a test that returned 200 where it expected 409.

**A stored verdict never outlives its config.** A content asset records the
`channel_config_version` it was judged against, and the *operative* channel
warnings are recomputed from the current config on every read. Storing the
verdict alone was not enough: when Facebook's limits were sourced, existing
assets kept returning "cannot be exported publish-ready" while the export, which
reads the current config, no longer blocked on it — the interface and the gate
disagreed, and a user would have believed the interface.

**Approval binds to a version.** `approvals` references
`(artefact_type, artefact_id, artefact_version)`, with partial unique indexes
for "one approved per X". A new version is unapproved without any flag needing
to be cleared.

**Provenance is a constraint, not a convention.** On `research_findings`,
`source_ref`, `retrieved_at` and `excerpt` are all `NOT NULL` with check
constraints requiring non-blank text. A claim with no passage behind it cannot
be checked by a reviewer, so the database refuses to hold one — asserted by a
test that tries to insert exactly that.

Variable provider payloads live in controlled JSON columns; the relations that
matter are normalised. Nothing is buried in a single JSON blob or in prompt
text.

## 10. The life of a request

```
socket
  -> helmet, CORS                          transport headers
  -> pre-auth rate limit                   per socket address; deployment ceiling
  -> origin check                          state-changing methods only
  -> [ /api/v1 scope ]
       onRequest:  authenticate            adapter -> subject -> CurrentUser from the DB
       preHandler: enforceFairUse          per-user budget; knows the actor
  -> route handler
       Zod parse of params and body        the same contract the file path uses
       requireLabelPermission              deny-by-default
       service method
         gate checks                       assertCan* -> 409 before any work
         budget reservation                single conditional UPDATE
         enqueue job  OR  read/write
  -> reply
       error handler                       Dutch message + request id; no internals
```

Authentication is an `onRequest` hook on the `/api/v1` scope, so a new route
cannot forget it — and so the fair-use limiter that follows in `preHandler`
knows who is asking. That ordering was a defect: the limiter read the
authenticated subject in `onRequest`, where it is always `undefined`, and fell
back to the socket address. Behind the Entra ID proxy that address is the
*proxy's*, so all users shared one bucket.

## 11. Security controls, one by one

Each row says where the control lives and which test holds it. No claim of
"zero vulnerabilities" is made anywhere, and no ISO control numbers are cited —
the certification scope has not been supplied.

### 11.1 Boot-time refusals

| Refusal | Where |
| --- | --- |
| Development identity in production | `env.ts` `superRefine`; `env-guards.test.ts` |
| Mock AI provider in production | same |
| `trusted-header` without `TRUSTED_PROXY_IPS` | same |
| Production without a proxy shared secret (min 32 chars) | same |
| `openai` without a key | same |
| A changed migration checksum | `db/migrate.ts` |

An empty string counts as absent (`optionalString`), because a `.env` file and
a container platform both use `KEY=` to mean "not set" — without that, anyone
copying `.env.example` was blocked.

### 11.2 Identity

Presence of a header is **not** evidence of trust. Three conditions must all
hold before a header is read at all:

1. the socket peer address is in `TRUSTED_PROXY_IPS` (`request.socket.remoteAddress`, never `request.ip` — `trustProxy` is off);
2. the proxy shared secret matches, compared in constant time;
3. the subject and e-mail headers are **single-valued** and well-formed.

Condition 3 matters more than it looks: a duplicated header arrives as an array,
which is the classic way to smuggle a second value past a proxy that overwrote
only the first. Any array is refused. Roles and memberships come from the
database on every request; the subject type has no field for them.

Held by `trusted-header-auth.test.ts` (183 lines). **Not yet verified:** the
real header contract — names, whether the proxy strips inbound copies, whether
it signs its assertions. Risk R-01; `docs/security/trusted-header-contract.md`.
Production authentication must not be called complete before that arrives.

### 11.3 Authorisation

Deny-by-default. `requireLabelPermission` fails unless the user holds an
explicit membership with the permission. Non-member access returns
**`not_found`, not `forbidden`** — confirming an id exists elsewhere is the
enumeration channel that closes. Held by `label-isolation.test.ts` and
`access-matrix.test.ts`.

**Granting access is deliberately not a label-level power.** `member:manage` is
held by `org_owner` and `org_admin`; a `label_manager` holds `member:read`. So a
manager sees exactly who works on their label and has no way to widen it —
otherwise a manager could grant themselves a second label and the label
boundary would be self-serve. Held by `member-administration.test.ts`.

**A membership change takes effect on the actor's next request.** Nothing is
cached: `resolveCurrentUser` reads memberships from the database on every
request. That is why revoking access needs no invalidation step and no session
to expire, and it is asserted in both directions — a grant is visible to the
next `/me`, a revocation makes the next label read return 404.

Every membership change is audited with the role **before and after**, because
"who could do what, when" has to be answerable afterwards.

### 11.4 Workflow gates

Checked **twice**, deliberately: before enqueueing so an unapproved brief is a
409 the user can act on, and again in the handler because state can change in
between. Moving generation to the worker had moved the gates with it, so asking
for concepts without an approved brief returned `202 Accepted` — the control
still held, but a minute later and as a failure message. Held by
`generation-gates.test.ts`, which asserts the status *and* that no job row was
created.

### 11.5 Untrusted files

Order: authorise, receive to quarantine, validate, promote or discard, record.
A file exists on disk only in quarantine until it has passed, and nothing in the
product reads from quarantine.

| Control | Where |
| --- | --- |
| The **bytes** decide the type; declared MIME and extension are hints | `validate.ts` |
| Global and per-type size ceilings, applied by the parser | `security.ts` multipart limits, `validate.ts` |
| Archives and executables refused with a specific reason | `allowed-types.ts` |
| HTML refused outright | `validate.ts` |
| SVG rejected if it carries script, handlers, `foreignObject`, entities, DOCTYPE or external references | `svg-guard.ts` |
| SVG **never served inline**, even when clean | `uploads/routes.ts` |
| Zip inspected via its central directory, **never extracted** | `zip-guard.ts` |
| Filename: traversal, NUL, RTL override, reserved names, length | `filename.ts` |
| `Content-Disposition` that cannot break out of the header | `filename.ts` |
| Content-addressed storage, so a hostile name never reaches the filesystem | `storage.ts` |
| Path containment on every read and write | `storage.ts` `absolutePathFor` |
| Authorised, label-scoped download; no public or guessable URL | `uploads/service.ts` |
| `nosniff`, `default-src 'none'; sandbox`, `no-store` on every download | `uploads/routes.ts` |
| Quarantine swept at startup and on a timer | `api/src/index.ts`, `storage.ts` |
| Refusals audited with what was detected, never the payload | `uploads/service.ts` |
| The **purpose** decides the required permission, and travels in the path so it is known before the body is read | `uploads/routes.ts` |
| Reading a document opens **one** archive member, after the directory has been judged | `docx-text.ts`; asserted by a test that puts a macro in the archive |
| A PDF is parsed in a separate thread the parent can terminate | `pdf-text.ts` |
| Every extractor is bounded, and **says** when it truncated | `document-text.ts`; a silently cut extract reads as complete, and someone confirming a course fact from it would be confirming half a sentence |
| A caller's character cap is clamped, not trusted | `docx-text.ts` |

Held by `file-safety.test.ts` (41 tests) and `upload-surface.test.ts`.

**The five purposes, and what reaches them.** A purpose decides the permission
and whether an image or a document is expected; it is **not** recorded on the
stored asset row, which matters more than it sounds.

| Purpose | Permission | Screen | Consumer |
| --- | --- | --- | --- |
| `visual_reference` | `content:write` | Campaign detail | Image generation references |
| `source_document` | `source:write` | Opleidingen | Research runs |
| `course_document` | `course:write` | Opleidingen | `course.extract_from_documents` |
| `brand_logo` | `brand:write` | Merk & bronnen | The render layer, via `logoAssetId` |
| `outcome_report` | `outcome:write` | (API) | An outcome row's `reportAssetId` — the figures somebody read off it |

`outcome_report` has no screen yet — it is reachable through the API only, and
that is recorded here rather than glossed over. It differs from the purpose that
was *removed* for having no consumer: this one has one (an outcome row
references the report it was read from), which is why it exists at all.

Every purpose has a consumer, and that is enforced rather than intended:
`upload-surface.test.ts` pins this exact set, so adding one fails until the list
is updated and whoever updates it has to answer "what reads this?". A fifth
purpose, `brand_document`, existed for a while with no job, no service, no
screen and no test — a live authenticated endpoint storing documents no code
path would ever read. It was removed on 2026-09-10 rather than given a screen,
because the honest alternative was a whole feature (brand rules extracted from a
guidelines document) and features arrive with their endpoints, not after them.

Because the purpose is not stored, an asset id is not self-describing: the id of
a course document and the id of a logo are indistinguishable on the row apart
from the type its bytes turned out to be. Every consumer therefore re-checks
what it needs — the brand profile requires `image/png`, and each check is
label-scoped. A check on `kind` cannot do this work: **all** uploads are stored
as `kind: 'upload'`, and `kind: 'logo'` is reserved for a Brand Portal release.

### 11.6 Outbound URL fetching

The attack: a user supplies a URL, we fetch it from inside the deployment
network, and either the response or the mere fact that the connection succeeded
tells them about hosts they could never reach. Metadata services are the prize.

| Control | Where |
| --- | --- |
| The **resolved address** decides, not the hostname | `ip-guard.ts` |
| Loopback, private, link-local, CGNAT, documentation, multicast, reserved | `ip-guard.ts` |
| Every known cloud metadata endpoint, named | `ip-guard.ts` |
| NAT64 / Teredo / 6to4 prefixes refused whole, rather than decoding the embedded IPv4 | `ip-guard.ts` |
| IPv4-mapped IPv6 caught in both dotted and hex notation | `normaliseAddress` plus the `::ffff:0:0/96` range |
| https only; http is opt-in per deployment | `url-guard.ts` |
| `file:`, `gopher:`, `data:`, `dict:`, `jar:`, … refused | `url-guard.ts` |
| Credentials in the URL refused | `url-guard.ts` |
| Ports 80 and 443 only, so a *public* host on 6379 is still unreachable | `url-guard.ts` |
| Single-label and special-use hostnames refused | `url-guard.ts` |
| **Every redirect hop re-validated**, not followed on trust | `safe-fetch.ts` |
| DNS resolved once, and the connection made to the address that was checked | `safe-fetch.ts` `pinnedLookup` |
| One timeout and byte budget for the whole chain | `safe-fetch.ts` |
| Byte cap enforced while streaming, not only from `content-length` | `safe-fetch.ts` |
| No cookies, no authorization header — nothing replayable | `safe-fetch.ts` |
| Refused at the route too, for everything decidable without DNS | `courses/routes.ts` |
| Fetched text is task data, never an instruction | `<paginatekst>` in the user message; `prompts.ts` |

Held by `ssrf-guard.test.ts` (23 tests) and `safe-fetch.test.ts`. The
test-only escape hatch that lets a test reach a loopback server is narrowed to
loopback alone, refused outright when `NODE_ENV=production`, and a test asserts
it appears nowhere in production code.

**This is now reachable from the interface.** `CourseFromUrlPanel` on the
Opleidingen screen and the source registration in `SourcesResearchPanel` both
hand a user-supplied URL to the server, so the guard is no longer only behind an
API a developer would have to call deliberately. Nothing about the controls
changed — that was the point of building them first — but the exposure did, so
it is written down: the reachable entry points are
`POST /labels/:labelId/courses/extract-from-url` and the source registration in
`sources-research/routes.ts`, both authorised, both label-scoped, both refusing
at the route for everything decidable without DNS.

`RESEARCH_ALLOWED_HOST_SUFFIXES` is empty by default, which means *any* public
https host is permitted. That is deliberate for course pages, which live on
whatever domain the provider uses, and it is the loosest the guard gets — the
address rules above are what carry the weight. A deployment that wants a
narrower surface sets that variable.

### 11.7 AI

Rule **E** of the content rules covers approved learnings: they are hypotheses
from earlier campaigns, never facts. The model may let them shape its approach,
must never name them in the content or present them as a result, must never say
something is proven, and must weigh a learning lightly when its own evidence
line says the support is thin. The evidence sentence is generated by one shared
function so the three proposal steps cannot describe the same hypothesis with
different weights.

Worth stating because it was a defect: the universal prompt rules used to say
"use only what is in `<gecontroleerde_feiten>`". That is right for producing
content which gets published, and wrong for a task whose job is to read a source
and propose facts that are *not* confirmed yet. Applied to research it produced
a run with zero findings and the explanation "the page contains no facts that
also appear in the confirmed facts" — the model obeying us correctly, on a rule
that should not have applied to it. The rules are now split by task kind, and
`prompt-rules.test.ts` pins the split in both directions: a content task must
carry the restriction, an extraction task must not.

| Control | Where |
| --- | --- |
| Our rules in `instructions`, task data in `input` — the injection boundary | `openai-adapter.ts`; asserted by test |
| Fetched page text, research findings and user revision instructions all travel in the user message only | `prompts.ts`; `prompt-rules.test.ts` asserts the system message never contains them |
| The confirmed-facts restriction applies to content tasks, **not** to extraction tasks | `systemPromptFor` splits universal / content / extraction rules; `prompt-rules.test.ts` |
| Runtime schema validation of every response | `generation.ts` |
| One bounded repair, then a recorded failure | `generation.ts` |
| A provider failure is never a fake success | `runner.ts`; `job-queue.test.ts` |
| Truncation is a failure, not a partial result | `openai-adapter.ts` |
| Missing capability reported, never simulated | `research()` returns undefined -> 501 |
| Estimated and actual cost in **separate** columns | `usage_records` |
| Budget reserved before the call, including for queued jobs | `budget.ts`, `generation-jobs.ts` |
| Secrets backend-only | `config` is server-only; no key in any bundle |
| `store: false`; data minimised | `openai-adapter.ts` |
| The model decides no authority, approval or access | by construction — no tool surface |
| Channel advice cannot carry a reach, cost, click or conversion figure — the shape has no field for one | `contracts/src/funnel.ts`; `funnel.test.ts` |
| The model must quote the editorial rule verdict per cell and may move one step from it, never from *ontraden* to *aanbevolen* | `proposedChannelAdvice` refinements; a violation is a repair attempt, then a recorded failure |
| A plan outside its campaign — a stage the objective does not cover, a channel the brief does not allow, a doubled cell — is refused before anything is stored | `planProblems` in `concepts/service.ts`; `funnel-plan.test.ts` |
| Content is written one funnel stage per call; an answer for another stage, or with a channel missing or doubled, is refused | `content-assets/service.ts` |

### 11.8 Transport and operations

Restricted CORS (deny-by-default), request body limit, two-layer rate limiting,
origin check on state-changing methods, statement timeout, bounded and paginated
queries. Non-root containers, no Docker socket mount, no secrets in images or
logs. Log redaction is a safety net — the code paths simply never put a secret
or user content into a log object.

The **origin check** is worth separating from CORS in a reader's mind: any
state-changing request that carries an `Origin` header is refused unless it
matches `CORS_ALLOWED_ORIGINS`. A request with no origin at all — `curl`,
server-to-server — is allowed, because there are no ambient credentials for an
origin check to protect. That is why the browser smoke run had to declare its
own web origin while the same POST succeeded from a shell.

**What CI blocks on, and what it only reports** (`docs/security/vulnerability-management.md`):

| Gate | Blocks? |
| --- | --- |
| Typecheck, lint, tests, build (`npm run verify`) | Yes |
| Browser smoke of the whole chain (`npm run smoke`) | Yes |
| Dependency advisories, high and critical (`npm run audit:gate`) | Yes, unless the advisory has a live dated acceptance |
| Trivy on the API and worker images, CRITICAL with a fix available | Yes |
| Dependency advisories at moderate; image HIGHs | Reported |
| gitleaks secret scan | Reported |
| Lockfile drift; non-root container assertion | Yes |

The split is deliberate rather than timid. A gate that cannot be satisfied gets
switched off — base-image HIGHs often have no fix at scan time — and both
scanners in this repository had already reached that state, running but wrapped
so they could not fail.

### 11.9 Privacy

No raw prompts, documents, tokens or personal data in logs by default. Security
audit records are a separate table from content logging. Client addresses are
hashed with a salt before storage. The AI provider's processing region,
retention and training use are **unconfirmed** — risk R-04, to be verified
against company policy.

## 12. What is not built

Stated here so it is never implied elsewhere. The interface routes these areas
to a page that says so rather than showing an empty screen.

| Not built | Consequence today |
| --- | --- |
| Complete advertisement-library ingestion and scheduled monitoring | Marktradar samples public Google/Meta libraries on demand and records access failures (including LinkedIn). Complete coverage, performance data and scheduled monitoring remain unbuilt. |
| OCR for scanned documents | PDF text, DOCX, TXT and Markdown are read through the upload module. Image-only PDFs need a text version; OCR is not implemented. |



| Member administration UI — P1-10 | Memberships are set by seed or SQL. |
| Calendar, results, learnings — Phases 3–4 | Areas marked unavailable. |
| Landing page, e-mail, ads — Phase 3 | Not offered. |
| Facebook channel verification — P2-2 | Content is generated; the channel is never publishable. |
| Production provider evaluation — R-16 | Live local calls, including CROV market discovery, have been checked. This is not a production-scale reliability or content-quality evaluation. |
| Multi-replica behaviour | Fair use is per-process; budget and queue fairness are in PostgreSQL. |
| Rehearsed restore — R-10 | Procedure written, never executed. |

## 13. Documentation map

| Document | What it answers |
| --- | --- |
| `README.md` | How do I run it, and what works today? |
| **this file** | What is every part of it, in detail? |
| `architecture/overview.md`, `modules.md` | How do the pieces relate? |
| `architecture/load-assumptions.md` | What was measured, under what conditions, and what is still unmeasured? |
| `architecture/extension-roadmap.md` | Where would the next capability attach? |
| `decisions/ADR-0001..0018` | Why is it like this, and what was rejected? |
| `security/threat-model.md` | What are we defending against? |
| `security/risk-register.md` | What is still open, who owns it, how is it verified? |
| `security/access-matrix.md` | Who may do what? |
| `security/data-inventory.md` | What data is held, where, for how long? |
| `security/production-readiness.md` | What must be true before production? |
| `security/incident-response.md`, `vulnerability-management.md`, `backup-restore.md`, `change-management.md` | Runbooks. |
| `security/supplier-inventory.md` | Which third parties, for what, with what unknowns? |
| `product/scope-and-phases.md`, `backlog.md` | What are we building, in what order? |
| `product/requirements-traceability.md` | Requirement -> implementation -> test. |
| `product/testing-strategy.md` | What is tested, how, and what is not. |
| `product/campaign-flow-design.md` | The campaign-flow redesign (2026-09-11): campaign objective, three funnel stages with their own message and proof, channel advice with visible two-layer reasoning, and the "make everything anyway" path. Decisions taken and **slice 1 built** the same day — its build record is in the document and in the campaign-flow section of this file; slices 2 and 3 are open. |
| `security/surface-review.md` | The Phase 4 security review: method, two findings (both fixed), the residual it could not close, and what the review explicitly is *not*. |

## 14. Keeping this current

A change is not finished until the rows below are true again.

| If you add or change | Update |
| --- | --- |
| A file under `src/core/` or a module | The table in §4, with its line count and one honest sentence |
| A table or migration | §9, and the Drizzle schema (the parity test will tell you) |
| A route | §10 if the pipeline changed; `access-matrix.md` if a permission is involved |
| A security control | §11 **and** the test that holds it. A row without a test is a claim, not a control |
| A file, module or document | The relevant table in §4–§8 or §13. `platform-doc.test.ts` fails if this document names a path that does not exist |
| An environment variable | `packages/config/src/env.ts` (with the reasoning), `.env.example`, and §7 if it changes behaviour |
| A capability that becomes real | Move it out of §12, update the README table, and update `requirements-traceability.md` |
| A dependency on a third party | `security/supplier-inventory.md` |
| A decision with a rejected alternative | A new ADR, and the index in `decisions/README.md` |
| Anything that changes capacity | Re-measure with `tools/load-test`, then update `load-assumptions.md`. Never state a figure that was not measured |
| A newly discovered risk | `security/risk-register.md`, with an owner and a verification state |

The rule behind all of it: **this document describes the code that exists.** If
a row here and the code disagree, the row is the bug.


Brand Portal integration: linked labels consume published releases through
`integrations/brand-portal/service.ts` on brand use (five-minute successful-check
window, plus manual synchronization). Production releases require no additional
local brand approval; content approval gates remain. The renderer loads original
logo/font files and prompts receive the available content profile. New releases
mark unpublished content for re-review. See the integration README for mapping,
cache limits and the CS Opleidingen live verification.


### Campaign flow: objective, funnel stages and channel advice (2026-09-11)

The complaint that started this was precise: *every campaign comes out the
same*. The cause was structural, not a weak model. A campaign knew how it
started (idea, briefing, research) and where it was in the process, but not
**what it had to achieve**; the content prompt said *one message and one CTA
for every channel*; and channels were a list on the brief whose only stated
reasoning was about the size of the set. Slice 1 of
`docs/product/campaign-flow-design.md` changes the three things at once.

**The flow now.** Stap 0, at creation: *Wat moet deze campagne bereiken?* —
Bekendheid, Overweging, Inschrijving or Hele funnel, no default. The objective
decides the stages: `discover` (Ontdekken), `consider` (Overwegen), `decide`
(Beslissen). Stap 5 is the channel plan: for each stage the system proposes
channels with an argument, shown as a stage × channel grid with ● aanbevolen,
○ mogelijk and — ontraden, the recommended cells ticked by default. The person
may tick any producible cell — *Alle creatives maken* ticks them all — and the
advice stays beside the choice rather than locking it. Stap 6 writes content
per stage: each piece carries its stage, is keyed `${stage}-${channel}-1`, and
is grouped under the stage's message so a reviewer checks a LinkedIn post
against *Ontdekken*'s brief rather than against a campaign-wide thesis.

**Two layers of reasoning, kept visibly apart.** Layer one is the editorial
rule in `packages/contracts/src/funnel.ts`: `channelFit(stage, channel)` gives
a verdict and a reason for every cell — search advertising is *ontraden* in
Ontdekken because nobody is searching yet and *aanbevolen* in Beslissen; e-mail
is *ontraden* in Ontdekken because there is no relationship yet. Deterministic
and unit-tested. Layer two is the model, which receives those verdicts as input
(`<kanaalgeschiktheid>`), writes the campaign-specific argument from the
personas and the course card, and may move a verdict one step with a reason —
never from *ontraden* to *aanbevolen*. The interface shows *Regel:* and *Voor
deze campagne:* side by side; the model does not invent the marketing theory
and the rule does not pretend to know this campaign's audience.

**What the model cannot do here**, enforced the way the advertising proposal
enforces it: cite a figure. The advice shape has no field for reach, cost,
click-through or conversion, the reasons in the rule table contain no digit or
percent sign (asserted by `packages/contracts/tests/funnel.test.ts`), and the
prompt says a reason has to be about fit, audience and stage — something a
reader can check against the persona and the course card.

**Where content generation changed shape.** One provider call per stage
(`groupByStage` in `apps/api/src/modules/content-assets/service.ts`), each with
`<funnelfase>` stating the stage's reader, message, allowed proof and kind of
CTA from `FUNNEL_STAGE_GUIDANCE_NL`. Three stages in one call would have put
three sets of instructions in front of the model at once and drifted back to
the one message on every channel this change exists to remove. The job
reservation follows: three calls and up to eighteen images for
`content.generate` (`generation-jobs.ts`), pessimistic by design.

**Gates unchanged, and now earning more.** *Beslissen* is the stage that wants
to say the price and the dates, and its guidance says: only confirmed facts,
and if a fact is missing, do not name it. The per-field course verification,
the publish-ready refusal and the brand rules apply exactly as before.

| File | Role |
| --- | --- |
| `packages/contracts/src/funnel.ts` | Stages, objectives, guidance per stage, `channelFit`, `channelAdvice` / `proposedChannelAdvice` |
| `packages/contracts/src/campaigns.ts` | `campaign.objective`, `contentPlanItem.stage`, `contentPlan.channelAdvice`, `MAX_PLAN_ITEMS` |
| `packages/contracts/src/content.ts` | `contentProposal.stage`, `contentAssetVersion.funnelStage` |
| `apps/api/db/migrations/0021_funnel.sql` | The three columns, checked |
| `apps/api/src/modules/concepts/service.ts` | Stages from the objective, verdicts into the prompt, `planProblems`, advice stored per plan version |
| `apps/api/src/modules/content-assets/service.ts` | One call per stage, stage on every version, stage-aware asset keys |
| `apps/api/src/modules/campaigns-briefs/service.ts` | `objective` on create, `setObjective` |
| `apps/api/src/core/ai/prompts.ts` | `content.plan` v2, `content.generate` v5; `<campagnedoel>`, `<funnelfasen>`, `<kanaalgeschiktheid>`, `<funnelfase>` |
| `apps/api/src/core/ai/mock-adapter.ts` | Plans the recommended cells per stage from the same rule table; stage-specific demo copy |
| `apps/api/src/modules/exports/service.ts` | Stage folders; advice in `publicatieplan.txt` |
| `apps/web/src/components/ChannelPlanGrid.tsx`, `apps/web/src/pages/campaign-flow.css` | The grid, the advice panel, the objective cards |
| `packages/contracts/tests/funnel.test.ts`, `apps/api/tests/integration/funnel-plan.test.ts` | The rule table complete and figure-free; the chain end to end on the mock; every-creative approval; refusal outside the objective; the objective route |
| `tools/ui-smoke/index.ts` | Chooses *Hele funnel* at creation and checks that the plan covers three stages with advice and that every asset knows its stage |

**Not in this slice.** Per-stage messages on the briefing (Stap 3) and proof
selection over confirmed facts (slice 2); the stage on outcomes and learnings,
and a calendar sequenced by stage (slice 3). The calendar did need one change
now: it numbered pieces per plan item, so a staged plan produced three "first"
e-mails on one day — `buildCampaignCalendar` now numbers per channel across the
plan, and the browser smoke's duplicate-key warning is what found it. Campaigns created before this
change read as *geen doel vastgelegd*, plan as a full funnel until someone sets
an objective, and their existing content keeps its stage-less keys.

### AI campaign visuals

With `AI_IMAGE_ENABLED=true`, content production generates one OpenAI image per
approved image channel, then renders two branded compositions using the pinned
Brand Portal logo, fonts and palette. AI produces the scene; the renderer adds
all text and branding. With the flag off, the existing typographic layouts apply.
Image provider failures fail the job instead of silently substituting a layout.

Generated originals are label-scoped assets with provider/model provenance.
Copy edits and copy-only revisions reuse the original. Image/all revisions
request a new scene. Saved originals are reused across retries of the same job;
each image call has a separate usage unit. Unknown image costs retain their
estimate for budget settlement while actual usage remains null. Cancellation
is checked before each image call; an already-running call may complete.

Content approval and export gates still apply. Migration 0010 adds the asset
provenance, retry key and per-image accounting fields.


### Campaign-specific starting context

Persona requests from a campaign carry its ID. Suggestions use the original idea
or supplied brief alongside course facts, brand rules and research. Campaign
lists are isolated; the course library remains available separately. Existing
briefs retain their pinned persona versions. New persona keys include their
campaign (or course) scope.

Supplied briefs remain verbatim on the campaign. The structured draft preserves
the requested intent and records omissions, conflicts and necessary deviations
in reviewNotes. The original, CTA, channels, scope and review notes are visible
for comparison before approval. Facts still require confirmation; input wishes
do not become research evidence. Migration 0011 adds campaign ownership and
brief review notes. Existing campaigns are not regenerated automatically.


### Creative image production

New concepts propose three explicit art directions: documentary photography,
a conceptual image, and editorial illustration. Each stores the scene,
composition, lighting, treatment and things to avoid. The selected direction and
approved brief inform the image prompt. Historical concepts remain readable.

The default image model is gpt-image-2.5-sunburst with explicit high quality.
AI_IMAGE_QUALITY also accepts xhigh/max for GPT Image 2.5. Higher settings use a
larger conservative budget reservation. Usage-based costs use configured token
rates; they are not provider invoices or current currency conversion quotes.
Missing input usage for referenced images remains unknown instead of being
reported as free.

Campaigns may attach up to three label-scoped raster reference uploads (10 MB
each). References are sent as multipart images to the image edits endpoint;
requests without references use image generations. Reference hashes, model,
quality and prompt version enter the retry key and generated asset provenance.
References affect future generations, not existing originals.

Image-led A/B layouts retain the full image frame. Logos and text still come
from the deterministic brand renderer. Users can open full-size renders and
review composition, anatomy, material and readability before existing content
approval. Image-only revision preserves manually edited copy and requests only
a new image; there is no automatic aesthetic score or claim of guaranteed
realism. Migration 0012 adds art directions and campaign reference IDs.

### Market radar pilot (2026-09-10)

`/radar` connects a selected course to live market discovery, source-backed
opportunity cards, page-image references and campaign creation. This extends the
registered-source research module; it does not change its existing behaviour.

`radar.scan` runs on the worker. OpenAI Responses web search discovers up to ten
URLs; only URLs present in returned search-tool sources are accepted. The
application independently reads pages through its DNS-pinned, bounded SSRF-safe
fetcher. A second structured call proposes up to four concise cards. The entire normalized
excerpt must occur in the named source; unmatched proposals are omitted with a
reason. This establishes passage provenance, not semantic correctness of every
interpretation. Source observation, relationship reasoning, uncertainty and
three creative approaches remain separate and reviewable. No automatic success
score, advertising performance claim or approval is generated.

Migration 0013 stores immutable scan reports with course/label/organization
constraints. A completed job replay reuses its report. Reports retain failures,
retrieval times, verified date excerpts and text hashes. A changed hash means
source text changed, not proof of a market trend. Invalid/truncated creative analysis leaves an explicit partial report and does not
prevent advertisement collection; other errors still follow the normal job policy.
The latest 20 reports are
available in the UI. The latest job is also returned so progress survives page
reloads; retry and cancel use existing job controls.

With OpenAI configured, discovery uses the existing server API key and text
model. Other providers can scan manually supplied URLs without claiming search
support. Search-tool cost is not inferred from token counts: the usage record
keeps actual cost unknown and a conservative estimate is used for budget
settlement. Job settlement totals may consequently contain estimates.

Page previews are fetched through the same guarded fetcher and re-encoded with
Sharp, with byte and pixel limits. No arbitrary image URL proxy is exposed: the
route takes an authorized report/card ID. Web-page images are explicitly not
verified active advertisements. A separate advertisement panel collects bounded
public-library samples from Google (the course domain plus at most two distinct
external domains from separately extracted, source-backed competitor evidence
(with opportunity cards as a fallback)), Meta and LinkedIn
(course keywords across advertisers). Captured records retain literal course
matches, advertiser, library URL/ID, observation time, original text and a
screenshot. Only explicit library status is called active/inactive; Google
status remains unknown. LinkedIn currently blocks automated access and is
reported as blocked, never as evidence that no ads exist. Meta placements
(Facebook versus Instagram) are not independently verified. Complete ingestion,
continuous scheduled monitoring, OCR and advertisement performance data are
not implemented. A user may add public reference URLs to a scan; unreadable
or protected pages remain visible as failures.

Selecting a creative approach creates a draft campaign in the existing
start-from-briefing flow. The supplied brief preserves the selected approach,
source URL, quotation, retrieval date, uncertainties and report/card IDs. The
course source URL is proposed as destination, separate from competitor sources.
Existing persona, brief, brand and content approval gates remain in force.
Approved brief CTA URLs now override missing or conflicting generated copy URLs.

Ad collection uses an isolated, unauthenticated Playwright Chromium context with
service workers disabled, per-platform deadlines, request-count bounds and a
fixed HTTPS library/CDN host allowlist. Unlike web-page fetching, this browser
path is not DNS-pinned; it never navigates arbitrary course or discovered URLs.
No sign-in, access-control bypass or advertiser website clickthrough is used.
The worker needs Playwright Chromium (`npx playwright install chromium`, or
`--with-deps` on Linux). `AD_RESEARCH_BROWSER_EXECUTABLE_PATH` can select a system
browser; `AD_RESEARCH_ENABLED=false` disables collection. Missing browsers and
partial failures leave the rest of the radar usable with explicit coverage.
The repository Docker images do not provision Chromium: supply a browser-capable
worker image before enabling this in a container deployment.
Screenshots live under `STORAGE_ROOT/radar-advertisements`; the API and worker
must share that storage. Preview routes check report/label access and a stored
UUID, with no arbitrary path input. Advertisement-to-campaign creation preserves
provenance and the own-course CTA, requests original creative work, and keeps
existing approval gates. Old reports remain valid and immutable; a new scan is
required to collect advertisements.

Provider request reference: [OpenAI web search documentation](https://developers.openai.com/api/docs/guides/tools-web-search), consulted 2026-09-10.


### Market radar audience evidence (2026-09-10)

Discovery also looks for public employer teams, alumni stories and vacancies
alongside competing courses. Competitor evidence is selected independently of
the creative-opportunity shortlist, checked against fetched passages and shown
for review; the own course domain is excluded. A separate `radar.audience` extraction reads the
same independently fetched pages; it does not scrape authenticated LinkedIn
profiles. Up to six compact findings retain source type, role, exact passage,
optional sector/provider passages, a targeting hypothesis and uncertainty.
Role and optional-field passages must occur in the source page; unsupported
fields are removed. Provider evidence is accepted only for proposed alumni
stories. These checks establish textual provenance, not semantic correctness
of the provider, graduation or sector interpretation. The UI asks for review.
Repeated roles on the same hostname are deduplicated; domain counts describe
this sample, not market share or independent ownership of organizations.

The report's `audience` field defaults to null for historical reports. No
migration is needed. A malformed extraction leaves a partial report and does
not prevent ad collection. Authorization and other errors retain normal job
failure handling. Radar budget reservation now covers three model calls plus
web search. The browser remains limited to library infrastructure; competitor
URLs are encoded as Google domain filters, never arbitrary browser targets.

`POST /labels/:labelId/radar/:runId/audience/:findingId/campaign` creates a
campaign for the chosen hypothesis after label/run access checks. Its supplied
brief freezes the chosen finding, passages, observation dates and limitations.
Existing persona generation reads that campaign-specific brief. Campaigns from
opportunity/ad cards also retain a bounded evidence snapshot (up to three
findings, with the included count shown). Subsequent radar scans do not replace
that evidence or already created persona versions. Existing approval gates
continue to apply. This is a source-backed persona starting point; it does not
prove graduation, prior role, purchase intention or optimal targeting.

Validation: `npm run verify` passed with 453 tests, including unsupported
passages/sectors, diploma-provider non-inference, query bounds, label isolation
and preservation of the evidence snapshot in persona-generation context.


Campaign creation from a role containing the offered qualification (or an alumni
story) explicitly derives an entry hypothesis for people who do not yet hold
that qualification. The qualified source remains occupational evidence, not an
automatic audience of repeat buyers. This correction was checked with a live
persona generation and the campaign-route integration test. The resulting
personas remain drafts and distinguish external role evidence from course-only
hypotheses; no target audience is claimed to be validated by this pilot.


### Marktradar — vragenonderzoek en conceptpakket

`radar.scan` ondersteunt `includeKeywords` (standaard true) en `deliverables` (`blog_faq`, `fit_check`, `site_banner`, standaard leeg). De worker voert na doelgroepanalyse `radar.keywords` uit en, bij gekozen onderdelen en geverifieerde vragen, `radar.package`. De maximale begrotingsreservering dekt vijf modelcalls en de bestaande webzoekreserve. Geen nieuwe migratie: optionele, achterwaarts compatibele velden in het bestaande radar-rapport.

Vragen vereisen een opgehaalde bron en teruggevonden passage; `page_question` vereist ook de letterlijke vraag inclusief vraagteken. Afgeleide zoekvoorstellen heten expliciet hypothesen. Er is geen SERP/PAA-, volume-, CPC- of SEO-scoreprovider aangesloten. Pakketcontent gebruikt de bestaande confirmed-facts/brand-context en valideert evidence-IDs; semantische juistheid en merkstijl blijven reviewwerk. De brondata, selectie en gegenereerde concepten blijven in de gekozen run. Modeloutputproblemen behouden het overige onderzoeksrapport met een melding.

`POST /labels/:labelId/radar/:runId/keywords/:keywordId/campaign` maakt een campagne met bevroren bronvraag en doelgroepcontext. `GET /labels/:labelId/radar/:runId/package?parts=blog_faq,fit_check,site_banner` bouwt een concept-ZIP voor geselecteerde, eerder gegenereerde onderdelen; zonder `parts` alleen het onderzoeksdossier. Labeltoegang en `export:create_draft` worden gecontroleerd. Deze download is een radar-conceptpakket en geen regulier goedgekeurd content-exportrecord.

De keuzehulp bevat drie reflectievragen met verklaarbare antwoordteksten, opnieuw/vorige bediening en toetsenbordfocus. JS en TypeScript (dezelfde geldige bron met type-inferentie) worden lokaal meegeleverd, zonder externe libraries of tracking. Site-banner is voor eigen hosting; Google Ads/Studio-acceptatie wordt niet geclaimd. HTML wordt escaped en runtime-tekst via `textContent` ingevoegd. De ZIP bevat README, manifest en review/provenance JSON. Dit is nog geen merkgetrouw ontwerpsysteem of volledige aansluiting op de campagnegoedkeuring.

### Huidige flow: radar → campagne → goedgekeurde brief → pakket

Deze wijziging vervangt de hierboven beschreven directe radar-contentproductie. Marktradar onderzoekt en start een campagne; `deliverables` in een nieuwe scan wordt geweigerd. Oude radar-pakketten blijven als historische rapportdata bestaan, maar de radar-download levert alleen het onderzoeksdossier. De campaign heeft nu een expliciete `radarRunId`. Migratie 0014 voegt de koppeling en `campaign_packages` toe; 0015 herstelt alleen ondubbelzinnige bestaande radar-referenties met hetzelfde label, dezelfde organisatie en cursusversie.

`campaign.package` is een worker-job met twee modes: `recommend` en `generate`. Beide vereisen de nieuwste, goedgekeurde briefing, een goedgekeurde cursus en een openbare HTTPS-bestemming. Aanbevelingen komen uit brief/doelgroep/broncontext. Productie accepteert alleen geselecteerde vormen uit een actuele aanbeveling; voor een ander doel wordt eerst de briefing aangepast. De content en de bron-snapshot, brief-, cursus- en volledige merkversie worden samen opgeslagen. Dubbele uitvoering met hetzelfde job-ID hergebruikt het resultaat.

Routes: `GET/POST /labels/:labelId/campaigns/:campaignId/packages`; `GET /labels/:labelId/campaigns/:campaignId/packages/:packageId/file`. Contentrechten gelden voor productie, draft-exportrechten voor download. Een gewijzigde of niet-goedgekeurde briefing, gewijzigde merkversie of niet langer goedgekeurde cursus maakt een pakket verouderd. Download controleert de actuele Brand Portal opnieuw en weigert oude of niet controleerbare merkregels. Dit is een concept-download, geen nieuwe publish-ready approval.

`BrandService.requireCurrent` forceert een portaalcontrole en weigert fallback met synchronisatiefout. Zowel het nieuwe pakket als sociale content/beelden gebruiken deze controle. Webtemplates gebruiken de merkkleuren, heading/body-fonts en het logo uit de geverifieerde merkassets. Bij ontbrekende custom fonts of logo weigert de nieuwe renderer te leveren; er is geen stille vervanging door een andere huisstijl. Websafe fonts kunnen zonder fontbestand. Copy volgt contentregels, tone of voice en verboden claims via de bestaande promptcontext. De volledige semantische interpretatie en visuele toepassing blijven menselijk reviewwerk.

Beschikbaar: blog/FAQ (HTML/Markdown en meta-description), website-keuzehulp (HTML/CSS/JS plus TypeScript-bron), Google Studio-interactieset (300×250, 336×280, 300×600). Sociale content en beelden behouden hun bestaande concept/plan/goedkeuringspad, te openen vanuit de contentkeuze.

Google Studio-output bevat per formaat een afzonderlijke ZIP met assets in de root, ad.size, de echte Google Enabler, init-handling, een Course-exit en interactiecounters. Lokale previews met een SDK-vervanger staan buiten de upload-ZIP. Structurele controles begrenzen bestanden (100) en eigen downloadbytes (5 MB), gebruiken een korte animatie zonder loop en registreren maat/SDK-uitgang in platform-controle.json. Dit is geen Google Ads-adapter en geen Google/uitgeversgoedkeuring. De adserver kan de URL overrulen; de uiteindelijke exit moet in Studio worden gecontroleerd. Ook de SDK-netwerkdownloads, uitgeverslimieten, inhoudelijk beleid en live tracking vragen platform-QA.

Technische bronnen, gecontroleerd 10 september 2026: [Studio-banners](https://support.google.com/richmedia/answer/2672545?hl=en), [Studio-review](https://support.google.com/richmedia/answer/2672562?hl=en), [DV360 HTML5-richtlijnen](https://support.google.com/displayvideo/answer/10261241?hl=en-GB). Een lokale preview of structurele controle wordt nooit gepresenteerd als platformacceptatie.

Live verificatie: campagne `0344e05b-8129-4e89-af6d-e3220149cd1b`, pakket `9f8a341f-d41e-4d03-97de-599fd20e7117` (blog/keuzehulp) gebruikt de bestaande goedgekeurde brief. Studio werd niet aanbevolen omdat die brief betaalde ads uitsluit; UI en API accepteren alleen actuele aanbevolen vormen. Studio-layouts zijn afzonderlijk technisch getest met echte merkassets en de echte Enabler in lokale testmodus. Geen Google/uitgeversgoedkeuring geclaimd. Fontgewichten komen uit OS/2-metadata; logoachtergrond wordt uit goedgekeurde primaire/oppervlaktekleuren gekozen op contrast. Actuele CS promptProfiles zijn leeg bij de upstream bron: merkwaarschuwingen worden zichtbaar gemaakt, geen verzonnen tekstregels. CTA-label en URL komen uit de goedgekeurde brief. Validatie: 465 tests, typecheck/lint/build; zes gerichte tests na de laatste CTA-aanpassing.

### 2026-09-10 — radar navigation and creative package refinement

Radar now separates opportunities, audience/competitors, ads, search questions and scan limitations into keyboard-accessible tabs, retaining the same selected scan. Scan setup collapses when results exist. Campaign detail uses five navigable phases with Previous/Next controls, preserved mounted form state and presence checks distinct from approval. Brief fields show populated/missing indicators. Server production gates remain authoritative.

Package composition and results are separate tabs. Each output exposes its recorded radar/brief/brand context, linked keyword evidence and confirmed own course facts. Other radar cards are explicitly research context; sentence-level provenance is not implemented. Source-less campaigns are shown as such.

Interactive generation accepts scenario/dilemma/priorities, persisted in the report and sent to the model; old payloads default to scenario. These are different editorial treatments of the existing three-question engine, not three separate app engines. Prompt v2 removes compulsory qualification screening and requests soft, practical choices with distinct feedback. Existing generated copy is not rewritten.

Studio renderers include branded graphic backgrounds and a distinct tall composition. Website widgets use campaign titles and branded interaction cards. No raster image generation or additional model call was introduced for these visual treatments. Studio platform approval remains external; technical preview fixtures do not approve paid advertising for organic-only briefs.

API priorities, research citations, cost tradeoffs and remaining quality work: [data-api-roadmap-tr.md](pilot/crov/data-api-roadmap-tr.md). These external API integrations are proposed, not installed.

### Content Studio: separate asset library

`/content` now shows generated outputs across the active label's campaigns instead of rendering the campaign list. Filters cover campaign, content type and title; package history is optional and the newest available package per type/campaign is shown by default. Package cards expose copy, source/version context, review warnings and an authorized full-package ZIP link. Social cards expose current copy/image variants and deep-link to the existing editor/review phase. There is no separate package-copy editor or in-browser HTML5 preview in this library; working HTML5 previews remain inside the ZIP.

The library uses existing authorized read endpoints, fetching three campaigns at a time (up to six requests), with partial-error notices and manual refresh. No generation or new backend API is triggered. Package history is limited to the existing endpoint's most recent 20 records per campaign. Campaign production remains the place to create assets; Content Studio is the cross-campaign output workspace. A future paginated server-side asset index should replace this bounded client aggregation for large libraries.

Validated: typecheck/lint/build, UI label test, real browser content-type filtering, social editor deep-link and desktop/mobile layout; no browser errors or horizontal mobile overflow observed.

### Saved radar opportunities and campaign direction feedback

The standalone Kansen navigation item has been removed. `/kansen` redirects to `/radar?tab=saved`. Radar's “Bewaarde kansen” tab stores opportunity-card references in `radar_saved_cards` (migration 0016), shared within the authorized label and scoped to the selected course. Saving is idempotent, requires campaign write permission, and preserves the source scan/card identity. Removing a bookmark never deletes research. Saved cards retain their original scan when creating a campaign; they do not use the currently selected scan. No AI generation occurs when saving or comparing cards. Audience, ad and keyword panels retain their existing direct campaign actions; this shortlist currently supports radar opportunity cards.

Campaign phase 2 now names its purpose “Campagnerichting”. “Kies deze” displays saving/failure states, marks the selected opportunity and navigates to Briefing only after a successful server response. Existing selected directions provide a “Verder naar briefing” action. Browser checks covered both failed and successful selection with intercepted responses, without altering real campaigns. Integration coverage verifies saved-card persistence, deduplication, cross-label isolation, missing-card rejection and bookmark-only deletion.


### Evidence and human package evaluation

Shared deterministic dossier: `packages/contracts/src/package-quality.ts`. It exposes input evidence, versions, hypotheses, absent textual brand rules and unresolved validation limits. It does not issue a semantic quality score. ZIPs include the generated bewijs-en-beperkingen.json file; the authorized evidence endpoint also exports recorded human reviews.

`campaign_package_reviews` (migration 0017) records append-only human assessments against six criteria, comparison reference, test plan and nullable self-reported timing. The POST endpoint requires `content:approve`. A pilot-ready decision requires accepted criteria, current non-mock output and textual brand rules, with a forced current-brand check. It is not publication approval or proof of conversion lift. Read access follows package label/campaign permissions. Historical reviews remain attached to the package; stale status is displayed separately.

`PackageEvidencePanel.tsx` is available on campaign package results and Studio cards. Review inputs are explicit user actions; no automatic expert endorsement or AI self-grading occurs. Dossiers and checks require no model calls. Prompt versions campaign.deliverables v2 and campaign.package v3 request the smallest useful set and reader-specific added value. New prompt behavior has not yet been independently assessed by domain experts.

Decision rationale, research sources, audit limitations and proposed comparison protocol: [quality-and-value-proof-tr.md](pilot/crov/quality-and-value-proof-tr.md).


## AI Visibility — manuel benchmark dikey dilimi (2026-09-11)

AI Visibility, Marktradar yanında ayrı bir araştırma ekranıdır: label marka/rakip ayarları → önerilen/onaylı sorular → sabit benchmark → gerçek yanıtların manuel kaydı → merkezi ölçümler/ham kanıt → mevcut kampanya ve briefing akışı. Motorlar ve markalı/markasız/rakip adlı sorular ayrı değerlendirilir. Başarısız cevaplar paydadan çıkarılır; kaynak kaydı eksikse citation rate bilinmiyor gösterilir. Otomatik tüketici ürünü taraması ve API çalıştırma etkin değildir. Görünürlük, içerik kalitesi veya dönüşüm başarısı olarak sunulmaz.

Uygulama ve sınırlar: [AI Visibility mimarisi](pilot/ai-visibility-architecture.md). Tablolar 0018 migration'ında; HTTP modülü apps/api/src/modules/ai-visibility, ekran apps/web/src/pages/AiVisibilityPage.tsx. Eski entity ayarları benchmark snapshot'ında kalır; observation hücreleri değiştirilemez. Kampanya aktarımı normal marka/kurs kapılarını kullanır, otomatik yayın veya onay vermez.

### AI Visibility varsayılan akış: otomatik GEO araştırması

Aktif label ve kurs otomatik kullanılır; kurs URL'si tekrar kullanılmak üzere saklanır. Kullanıcı önerilen soruları seçip onaylar, geo.research işi gerçek web araması ve güvenli sayfa okumadan sonra kaynaklı sayfa/blog taslakları üretir. Sonuçlar ve kaynak checkpoint'leri PostgreSQL'de tutulur; araştırma geçmişi aranabilir ve Markdown/JSON indirilebilir. Geçici analiz hataları aynı kaynak aramasını tekrar etmeden retry edilir. Web araştırması, tüketici AI ürünü görünürlük ölçümü olarak sunulmaz; önceki manuel özellik gelişmiş bölümde korunur. Ayrıntılar ve sınırlar AI Visibility mimari belgesindedir.
