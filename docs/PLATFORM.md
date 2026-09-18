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

Last reviewed: **2026-09-15**, after the interface redesign of that date: the
platform colours now follow the selected label, the shell is a 56px icon rail
with a 48px top bar, and every screen uses one of three layout patterns. Before
that, the same day: the flow audit — FA-0 to FA-4 built (publish-ready output,
the plan's counts honoured, the advertising channels given a creative, the
website split into a course-page change and a blog article, and content that
belongs to no campaign) and the Phase 4 security review.

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

Since the 2026 redesign the **platform colours follow the selected label** and
every screen uses one of three layout patterns. The full reference — token
layers, the two contrast rules, the shell, the patterns, the shared vocabulary
and all eleven screens — is `product/design-system-2026.md`; the rows below say
what each file does.

| File | What it does |
| --- | --- |
| `api/client.ts` | One fetch wrapper. Turns the error envelope into `ApiClientError` carrying the Dutch message and the request id. It depends on the API's rule above: no envelope means no message, and the generic fallback is all the user sees. |
| `api/queries.ts` | Identity, labels, workspace. |
| `api/campaign-queries.ts` | The chain, plus `useJobProgress` with adaptive polling (1.2 s, then 3 s, then 6 s; never in a hidden tab) and `isTerminalJobStatus`, exported so a screen can decide what to disable while work is in flight without keeping its own status list — there were two such lists, and a third would have been the one that forgot `cancelled`. Its campaign id is **optional**: a course card read from a page and a research run belong to the label, not to a campaign. It was once required, so a screen with no campaign passed the literal string `'kansen'` and invalidated a cache key that never existed — a placeholder meaning "nothing" is worse than an absent value, because the next reader cannot tell it from a real id. |
| `shell/AppShell.tsx`, `shell/shell.css` | The 2026 shell: a 56px icon rail painted from the selected label's ink, a click-to-open 232px flyout, a 48px top bar that does not collapse, and the label switcher that shows each label's three colours before you pick one. `shell.css` also holds the three layout patterns and the vocabulary every screen builds from. An unfinished area stays in the rail at reduced weight with its reason, in `title` and for screen readers — hiding it would answer "where is the calendar?" by pretending it was never planned. |
| `shell/nav-icons.tsx` | One mark per navigation destination, Lucide geometry at 1.9px. Keyed by **path**, not by `ProductArea`: Marktradar and AI Visibility share the area `kansen`, and in a rail without text two identical glyphs are two unlabelled buttons that look like the same screen. |
| `shell/LabelTheme.tsx` | Writes the active label's palette onto `:root`, so every screen — including the ones still written against the old `--c360-*` names — follows the label. Also exports `paletteOfLabel` for the screens that *show* a palette. The colours travel with the label list, so switching re-tints in one frame with no flash to the house palette and back. |
| `shell/BackgroundWork.tsx` | Tells you when background work has landed, top right, with a link to the result. It reads the job list the background-task panel already polls, so it costs no request of its own. Only *transitions* are announced: the first load seeds the set of jobs already accounted for, or opening the app would raise a notice for everything that finished last week. A notice stays until it is dismissed — one that fades is one somebody missed, and the whole point is that the person had walked away. A link is offered only where the job's own result says where its output landed; a guessed destination is worse than none. |
| `shell/CommandPalette.tsx` | ⌘K / Ctrl-K: jump to a screen. Deliberately a *screen* finder and it says so ("Ga naar…"): there is no search endpoint, and a box labelled "Zoeken" that appears to search campaigns and sources would be a promise the product cannot keep. An unfinished area is listed with its reason and cannot be chosen. |
| `shell/navigation.ts` | The seven areas. An unbuilt area routes to `NietBeschikbaarPage`. |
| `pages/WerkruimtePage.tsx` | Pattern A. The day's start: a KPI strip of four, then a queue sorted by *what blocks a decision* rather than by date, then the label's foundation, its AI budget and its background tasks. The queue has an Alles / Review / Problemen filter with live counts; only a problem row carries a reason, because a sentence under every row would turn the queue into prose. Ages are relative and in tabular mono, with the exact moment in `title`. |
| `pages/KansenPage.tsx` | "Ontdek kansen" — exploration, commits nothing. |
| `pages/CampagnesPage.tsx` | The form in the order a marketer thinks: Opleiding (pre-filled when there is one, a placeholder when there are several), *Wat moet deze campagne bereiken?* (four objective cards, **no default**, each naming the stage(s) it plans for from `stagesForObjective`), *Wat heb je al?* (three stacked cards — *Ik heb nog geen idee* / *Ik heb een idee* / *Ik heb al een briefing* — each saying what you supply, what the system does and what you get back; the safe input-free option is the visible default), the idea/briefing textarea revealed directly under that group with a character count from three quarters of the limit, and a **suggested, editable name** from course + objective + month. One summary sentence restates the choices before the button. The button is never disabled for missing input: submit validates and an error summary at the top links to each problem (GOV.UK error-summary pattern); a server refusal lands in the same place. The list shows each campaign's objective and starting point. |
| `pages/CampagneDetailPage.tsx` | The campaign screen: **eight numbered steps from one list** (`STEPS`) — Doelgroep, Richting, Briefing, Concept, Kanaalplan, Content & beelden, Export, Resultaten & lessen — plus the unnumbered branch *Website & interactief*. The step bar numbers by position and every card takes its number from the same list, so the two cannot disagree. Where the person is comes from the server's state (`nextStepFor`: an approved brief, a chosen concept, an approved plan…), is written to `?fase=` on every change, and is repeated as a *Volgende stap* notice that jumps there. **One primary action per step**: the purple button is the next thing to do; every other button is secondary. Stap 1 shows each persona's evidence in full (grounding, assumptions, where the audience orients — *onderbouwd* or *aanname*) and caps the choice at three visibly. Stap 3 shows the *Boodschap per funnelfase* block and offers a re-approval when a persona was revised. Stap 5 (`PlanEditor`): the grid, the focused cell's argument without hover, *Alle creatives maken*, the measurement plan, the calendar sequenced by stage. Stap 6 groups content under the stage's own message. Stap 7 shows the gates as the reason *Publicatieklaar* is or is not primary. Stap 8 is `ResultsStep`. **Due a split.** |
| `pages/MerkPage.tsx` | Pattern A, two columns: where the brand comes from beside what it paints with. Each colour is shown with the role it plays *in this interface* and its hex, plus a gradient example in the label's own colours. Brand profile and approval. |
| `pages/OpleidingenPage.tsx` | Pattern B. Cards on the left, one card's fields on the right: per field the value, the extractor's reservation and its verification status, under a progress line that says how many of how many are checked. An empty field stays empty and says it is not guessed. |
| `pages/ContentStudioPage.tsx` | Pattern B. Every piece of content of the label as one ordered list — campaign pieces grouped by channel, then loose pieces, then website packages — with a status filter carrying counts and a counter that always says how many of how many. The detail pane holds the meta strip, the full asset card, and for a loose piece the way to attach it to a campaign. It replaced a grid of 27 cards that ran to ten thousand pixels. |
| `pages/PersonasPage.tsx` | Pattern B. The persona library and the proposals from campaigns behind one filter. The detail opens with three figures — grounded, assumed, questions answered — because those decide whether this persona is safe to brief on. |
| `pages/GeoPage.tsx` | Pattern C without a third column. Seven sub-views over one research run: the answers, the **cited sources** as a table with computed counts, the comparison, the page and blog proposals, the research notes, a new run, and the saved runs — plus the manual product measurements, which used to sit behind a disclosure where nobody found them. |
| `pages/ResultatenPage.tsx` | Pattern A. Four counts, each a `length` over rows that exist, and deliberately no cross-campaign total: every figure behind them was typed in by hand or read from an uploaded platform report, and adding them up would suggest a measurement nobody made. |
| `pages/LabelsPage.tsx` | Pattern A. The labels you have a role for, with a **PALET** column: the three colours that label paints the interface with, and in the `title` whether they come from its own approved brand profile or from the Certify360 house palette. |
| `pages/JobsPanel.tsx` | Queue, progress, retry, cancel. |
| `pages/NietBeschikbaarPage.tsx` | Says plainly that an area is not built, which phase delivers it, and what already works instead. No widgets, no empty charts, no zeroes. |
| `components/JobWatcher.tsx` | One job-progress behaviour for every screen: the worker's own message, the server's Dutch failure text, a retry when the job says it is retryable. It was a private function inside `CampagneDetailPage` while the Kansen screen called the hook with a placeholder campaign id and the sources panel grew a second poller — three behaviours for one concept, which is how one of them ends up without the adaptive backoff. Also exports `jobResultString`, which had been copied into two screens. |
| `components/CourseIntakePanel.tsx` | Creates a course card from a course **page** or from an uploaded **document** (PDF, Word, text, Markdown). States before anything is submitted that the result is a **concept** — every field `unverified`, its source recorded, nothing filled in that the source does not say — and afterwards names what was read plus the extractor's own reservation. A refusal is specific and costs nothing: a URL's shape is judged before a job is queued, and a document is validated before one is. The two routes share one progress area, because they produce the same artefact and separate ones would invite starting both. |
| `components/SourcesResearchPanel.tsx` | Sources and research runs for a course version: register a page or upload a document, activate or disable a source, start a run, read the findings with their passages. Uses the shared `JobWatcher`. Its findings query keys on whether the job is still busy, because the worker writes the findings — so the key changing once, when the job stops, is what refetches them; the last poll of a busy run can land before the worker has committed. |
| `components/VisualReferencesPanel.tsx` | Up to three of the label's own images as references for image generation. |
| `components/FlowNavigation.tsx`, `components/flow-navigation.css` | The tab bar (`role="tablist"` with arrow keys), still used by the manual AI-visibility measurements. Its `FlowItem` type — `done`, `attention`, `numbered` — is what the campaign step rail reads. The step and rail variants it once rendered are now `.os-step` in `shell/shell.css`, where the radar and the campaign share them. |
| `components/FunnelPills.tsx` | Ontdekken · Overwegen · Beslissen as pills, the covered stages filled — one indicator for the header, the campaign list and anything else that says which part of the journey it is about. |
| `components/ResultsStep.tsx` | Stap 8: publications (which version, where, when), measured figures per channel and — when a report splits by stage — per funnel stage, and learnings (observation, hypothesis, next test, citing the figures) with approval. The first interface the outcomes and learnings modules had. Shows the approved measurement plan at the top so figures are recorded against what was agreed. Computes and shows no ratio. |
| `components/CampaignPackagePanel.tsx` | The *Website & interactief* branch: the website forms (blog with FAQ, keuzehulp, Studio banners) from the same briefing, personas and plan; each recommended form carries the stage it serves; its inner tabs are *Samenstellen* and *Gemaakte pakketten*. |
| `pages/RadarPage.tsx`, `components/MarketPicturePanel.tsx`, `components/ObjectiveSelect.tsx`, `pages/radar.css` | Marktradar in reading order: **Marktbeeld** first (the digest since the previous scan, the insights as radio-selectable cards with Wat / En dus / Nu, evidence and agreement badges, "wat dit niet laat zien", an evidence drawer named by what it holds, and one primary hand-off with the objective preselected from the insight), then Kansen, Bewaarde kansen, Doelgroepen & concurrenten, Advertenties, Zoekvragen and Scan & beperkingen. Course, tab and run live in the URL; counts carry denominators; the scan button is primary only while there is nothing to read. `ObjectiveSelect` is the objective picker every radar hand-off uses. Tokens only. |
| `components/ChannelPlanGrid.tsx` | The grid, `CellAdvicePanel` (the focused or hovered cell's argument written out, so keyboard and touch users are not left reading glyphs; cells whose advice moved from the rule are marked), `MeasurementPlanPanel` (indicator, source and decision rule per stage next to the ladder rung) and the *Waarom dit advies* panel. A cell shows a verdict (● aanbevolen, ○ mogelijk, — ontraden) and a checkbox, kept apart on purpose: the verdict is advice, the choice is the person's, and a discouraged cell can be ticked with the advice still beside it. The verdict shown is the model's advised one when the plan has advice for the cell, else the editorial rule; the panel shows both layers, *Regel* and *Voor deze campagne*, and where they differ, both verdicts. `rendersImage` reads the channel configuration rather than keeping a list of social channels. |
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

**`ui`** — the design language and the accessible primitives, in four layers
that load in this order:

| File | What it holds |
| --- | --- |
| `design-system.css` | The house system: type roles, the spacing and radius scale, shadows, motion curves, the focus ring. No label colour. |
| `tokens.css` | The `--c360-*` names, forwarded onto the layer below, plus `body`, the focus ring, the skip link. The forwarding is why screens written years before the redesign follow the selected label without being rewritten; it also declares `--c360-color-border` and `--c360-danger`, two names screens referenced and nobody had defined — a missing custom property invalidates the whole declaration, so those borders were simply absent. |
| `tokens-2026.css` | The `--lp-*` label layer (written at runtime), the neutrals, the text and status colours, the shell metrics. |
| `label-theme.ts` | Palette in, CSS variables out. Pure: no React, no network, no invented colour. `readableOnWhite` darkens a brand primary step by step until 12px type on it clears 4.6:1 — `#00A894` on white is 2.99:1 — which is why `--lp-solid` exists beside `--lp`, and `--lp-active` falls back to the accent when a brand uses one dark colour for both primary and ink. |
| `primitives.css`, `components.tsx` | The accessible primitives, sized for the 2026 interface: 13px reading text, 12px controls, 34px buttons, 16px card corners. |

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
| `0022_stage_briefing_results` | `brief_versions.stage_messages` (jsonb, default `[]`: message, CTA kind and confirmed proof *fields* per stage), `content_plans.measurement_plan` (jsonb, default `[]`: indicator, source, decision rule per stage), `persona_versions.orientation_sources` (jsonb, default `[]`: where the audience orients, with evidence or null), `outcome_reports.funnel_stage` (nullable, checked against the three stages). Nothing existing is back-filled |
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
| A plan outside its campaign — a stage the objective does not cover, a channel the brief does not allow, a doubled cell, a stage without a measurement — is refused before anything is stored; advice may cover every producible channel | `planProblems` in `concepts/service.ts`; `funnel-plan.test.ts` |
| A briefing must speak to exactly the stages its objective covers, and may cite as proof only course-card fields a person has confirmed; an unconfirmed field is removed and named in the review notes | `stageMessageProblems`, `confirmedProofOnly` in `campaigns-briefs/service.ts`; `funnel-plan.test.ts` |
| A persona's statement about where its audience orients keeps its evidence only when the cited source is one the service handed the model (a finding, a confirmed fact, the brand); anything else reads as an assumption, and the channel plan may not move a verdict on an assumption | `verifyOrientationSources` in `personas/service.ts`; `persona-orientation.test.ts` |
| Every answer in a system-filled persona questionnaire carries its origin: *uit bron* only when its quote is found literally in the material the service supplied (findings, confirmed facts, campaign input), with the reference; everything else the model states is an assumption marked *door AI afgeleid* with the model's reasoning; a question the model leaves out or answers twice becomes an explicit open cell written by the system; an age stated without a passage is replaced by the statement that age is not derivable; an unusable model answer leaves every question open rather than failing the persona, and fails the stand-alone fill job so nothing is stored | `verifyQuestionnaire`, `fillOpenQuestions` in `personas/questionnaire.ts`; `PersonaService.fillQuestionnaire`; `persona-questionnaire.test.ts`, `persona-auto-questionnaire.test.ts`, `persona-fill-questionnaire.test.ts` |
| A briefing's call to action always names a destination: the model's URL, else the briefing's radar target, else the course page; a piece of content inherits it the same way. A call to action that promises a keuzehulp, quiz or checklist is flagged in the briefing and in the Website & interactief branch until that form exists | `CampaignService.draftBrief`, `ContentAssetService`, `promisesInteractiveForm`; `campaign-package-quiz.test.ts`, `google-ads.test.ts` (contracts) |
| The keuzehulp is a quiz whose decision is fixed code, not model output: a signal per option, majority wins, a tie is *explore*; the outcome texts come from the model and are reviewed; the page stores nothing and tags its one link | `decideOutcome`, `buildQuizFiles` in `campaign-packages/quiz.ts`; `quiz.test.ts` |
| A Google Search ad is stored only within Google's documented limits (30 · 90 · 15, read 2026-09-15), with at least eight headlines and three descriptions, a search phrase inside a headline, no exclamation mark in a headline, no repeated punctuation, no shouting, no superlative or guarantee and no number that is not on the course card; a shortfall goes back to the model once and is then refused | `checkGoogleAdsShape`, `checkGoogleAdsContext` in `content-assets/quality.ts`; `google-ads-quality.test.ts` |
| The Google Ads frame per stage is deterministic and sourced: objective, campaign type, conversion actions, bidding path, EEA requirements, every entry with the help page it comes from and the date it was read; no volume, price or forecast anywhere | `googleAdsFrame` in `contracts/src/google-ads.ts`; `google-ads.test.ts`, `ad-proposal.test.ts` |
| A campaign can be moved to the currently approved version of its own course, and that move flags its briefing and its content for re-review in the same transaction; a campaign is never moved silently, and a label without an approved card is refused | `CampaignService.repointToCurrentCourse`; `course-version-repoint.test.ts` |
| Approving a course card or a brand version flags, in the same commit, every draft or approved piece of content whose brand or course version is no longer approved | `flagStaleForLabel` called from `CourseService.approve` and `BrandService.approve`, wired in `server.ts`; `course-version-repoint.test.ts` |
| A proposed persona is a new identity every run; a proposal whose name already exists in scope is skipped and named in the shortfall reason, and the model is handed the existing audiences under `<bestaande_doelgroepen>` | `PersonaService.propose`, `normalisePersonaName`; `persona-additions.test.ts` |
| A briefing's search phrases come from the pool the service supplied — radar keyword research or phrases derived from the course card — and a phrase outside it is dropped and named in the review notes; no volume or position is stored anywhere | `CampaignService.keywordPool`; `content-quality.test.ts` |
| A piece of content is stored only when it meets its channel's minimum in words, carries its hashtags, uses only search phrases that occur in it, quotes only passages that are on the live course page, and repeats no other piece of the campaign; a page or a mail that falls short goes back to the model once and is then refused, never stored thin | `content-assets/quality.ts`, `ContentAssetService.generateBatch`; `content-quality.test.ts` (unit and integration) |
| A briefing is stored only when every narrative section reaches its floor in words, the whole reaches its floor, every suggested channel has a role, and neither the goal nor the measurement carries a percentage; a shortfall goes back to the model once as `<herstelpunten>`, then is refused | `briefProblems`, `CampaignService.draftBrief`; `brief-problems.test.ts`, `brief-professional.test.ts` |
| A persona's course links may name only course versions of the same label; the list under a course shows the latest version per identity and only if that version still links to the course | `PersonaService.verifiedCourseLinks`, `latestVersions`; `persona-course-links.test.ts` |
| The measurement plan has no field for a target, a baseline or a forecast; the ladder guidance per stage contains no digit | `stageMeasurement`, `FUNNEL_STAGE_INDICATOR_NL` in `contracts/src/funnel.ts`; `funnel.test.ts` |
| A brief pinned to a persona version that gets a successor moves to `needs_rereview`; the gate says why and a person approves it again | `PersonaService.createVersion`; `persona-orientation.test.ts` |
| A radar insight survives only when every cited id exists in the same run, every figure is quoted from a cited passage, and no percentage, *trend* or *significant* appears; its confidence is computed from the cited domains, and a single source cannot claim agreement | `verifyInsights` in `market-radar/synthesis.ts`; `radar-synthesis.test.ts`, `market-radar.test.ts` |
| Contact details (e-mail, phone) are redacted from every stored radar passage after verification; names are refused at the prompt and the residual risk is stated on screen | `redactReport` in `market-radar/synthesis.ts`; `market-radar.test.ts` |
| Every campaign created from the radar carries an objective the person confirmed; an objective outside the vocabulary is refused | `market-radar/routes.ts` (`handoffBody`); `market-radar.test.ts` |
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



| ~~Member administration UI — P1-10~~ | **Built since**: `identity-access/members-routes.ts` and the Labels & toegang screen grant, change and revoke access. Row kept so the correction is visible; noticed during the feature-gap review of 2026-09-15. |
| Editorial calendar across campaigns, results across campaigns | The "Kalender & journeys" and "Resultaten" screens are marked unavailable. A campaign's schedule is computed from its approved plan and shown inside the campaign; results are recorded per campaign. See `product/feature-gap-2026-09-15.md`. |
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
| `decisions/ADR-0001..0019` | Why is it like this, and what was rejected? |
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
| `product/campaign-flow-design.md` | The campaign-flow redesign (2026-09-11): campaign objective, three funnel stages with their own message and proof, channel advice with visible two-layer reasoning, and the "make everything anyway" path. Decisions taken and **all three slices built** the same day — the build records are in the document and in the two campaign-flow sections of this file. |
| `security/surface-review.md` | The Phase 4 security review: method, two findings (both fixed), the residual it could not close, and what the review explicitly is *not*. |
| `product/market-radar-senior-design.md` | Marktradar as a senior market-intelligence practice (2026-09-11): a market picture synthesised across the run's verified evidence with computed confidence, change notes since the previous scan, competitors quoted next to our confirmed facts, the objective on every hand-off, contact-detail redaction, and the screen in reading order. Slice MR-1 built; MR-2…MR-5 open. States plainly which research and design agents did not run. |
| `product/feature-gap-2026-09-15.md` | What is *not* in the product, per capability, with a proposed verdict — belongs in the MVP, later, or a motivated deviation — plus an external benchmark of what comparable tools document (read 2026-09-15) and where this product is ahead. Written in Dutch for the team, in answer to the request to have the current setup challenged. |
| `product/flow-audit-2026-09-15.md` | Is de campagnemaker klaar, en is de output direct te gebruiken? De audit van 15 september 2026 door vijf parallelle onderzoekers, met de zwaarste bevindingen met de hand in de code nagelopen: welke van de acht stappen echt zijn afgedwongen, tien geverifieerde defecten, wat een exportpakket feitelijk bevat, wat de platforms gepubliceerd eisen met bron per getal, waarom het websitekanaal twee deliverables is, wat losse uitingen blokkeert, en wat de markt doet met een asset zonder campagne. Diagnose; het plan staat als FA-0…FA-5 in `backlog.md`. |
| `product/design-system-2026.md` | Hoe ziet de interface eruit en waarom? Het herontwerp van 15 september 2026: de tokenlagen, de twee contrastregels die niet gebroken mogen worden, de shell, de drie layoutpatronen, het gedeelde vocabulaire, alle elf schermen, en wat bewust *niet* uit het ontwerp is overgenomen. |
| `product/google-ads-practice.md` | Google Ads as an advised channel (2026-09-15): what Google's documentation says about objectives, campaign types, responsive search ads, policy, keywords, conversion tracking, Consent Mode v2, bidding and budgets — every figure with its page and date — and what the product enforces, shows and exports from it. |
| `product/campaign-package-and-audience-research-design.md` | Design (2026-09-11) for model-proposed deliverables from a bounded catalogue, questions as a research instrument (aggregate-only, thresholds, persona *hypotheses* a person reviews), audience-aware channel advice with citable public NL evidence, one vocabulary, the campaign screen's information architecture and measurement without forecasts. Every practice carries an opened source. The six decisions were taken (recommended options) and R-1, R-2, R-3 and R-6 are **built**, R-4, R-5 and R-7 in part; the slice table says which part. States plainly that its design panel and verifiers did not run. |

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
| A screen, a layout pattern or a design token | `product/design-system-2026.md`. A fourth layout pattern is a decision, not an edit: say why the three do not fit |

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

**One vocabulary (R-1, 2026-09-11).** The content-plan gate, stage and
service messages say *kanaalplan*; *campagnepakket* is the three website forms
of the campaign package; *exportpakket* is the ZIP. The word *contentpakket*
had meant all three. The brief's *Kanalen* row and the worker's progress line
use `CHANNEL_LABEL_NL`, and the advice panel refuses to print a reasoning that
merely repeats the rule as if it were a tailoring.

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

### The funnel connected end to end: per-stage briefing, audience evidence, measurement and results (2026-09-11)

Slice 1 gave a campaign an objective, a plan per stage and content per stage.
Three connections were still missing, and the product owner named them: the
briefing spoke with one voice to three audiences, the channel advice could only
*infer* an audience's media habits from prose about its needs, and the chain
ended at Export with nothing recorded afterwards — the outcomes and learnings
modules had no interface at all. Slices 2 and 3 of
`docs/product/campaign-flow-design.md` and R-2, R-3, R-6 and parts of R-4, R-5,
R-7 of `docs/product/campaign-package-and-audience-research-design.md` close
them, in one migration (`0022_stage_briefing_results`).

**The briefing speaks per stage.** `brief.draft` v4 returns `stageMessages`:
for every stage the objective covers, what the campaign thesis (`coreMessage`)
says to a reader in that stage, the kind of call to action the stage guidance
asks for, and which course-card **fields** may serve as proof. Fields, not
values: the value is read from the course card when content is generated
(`stageMessageBrief` in `prompts.ts`), so a fact confirmed after the brief is
quoted correctly and one withdrawn since is listed as unavailable rather than
quoted from a stale copy. The model is handed `<bewijsvelden>` — every field by
id, marked confirmed or not — and the service enforces what the schema cannot:
exactly one message per stage of the objective (`stageMessageProblems`, a
provider error on a proposal and a bad request on an edit) and confirmed proof
only (`confirmedProofOnly`, which removes the rest and names it in the review
notes so the person can confirm the fact if it is true). `content.generate` v6
receives `<fase_boodschap>` and leads with it; a brief from before stage
messages has none and the stage guidance leads, as before.

**The audience reaches the channel plan as evidence.** A persona now carries
`orientationSources`: statements of where and when its audience orients
(search, the course page, employer or HR, colleagues, LinkedIn, trade media),
each naming the channel it bears on and carrying its `grounding` — or `null`
for an assumption. `persona.propose` v4 states the rule the demographics rule
already had: only behaviour traceable to a source in the prompt, otherwise
leave it empty or mark it an assumption. The service then **verifies** every
citation the way research excerpts are verified (`verifyOrientationSources`):
an external or document reference must be one of the findings handed to the
model, a course-fact reference must name a confirmed fact, a brand reference is
accepted when a brand profile was in the prompt, an outcome reference never is;
anything else keeps its statement and loses its grounding. `content.plan` v3
receives these as `<doelgroep_kanalen>`, marked *onderbouwd* or *aanname*, and
may move a verdict one step **only** on a grounded statement or a course fact;
without such evidence it keeps the rule and says "geen doelgroepbewijs over dit
kanaal", which the interface prints as such instead of dressing the rule up as
a tailoring. Advice now covers every producible channel (twenty-four cells for
a full funnel), so a person ticking an unplanned cell is not choosing blind;
items are still planned for the brief's channels only
(`<kanalen_uit_briefing>`). Approved learnings reach the plan and the content
prompts (`ConceptService` and `ContentAssetService` take the learning store).

**Measurement is agreed before anything is made.** The plan carries a
`measurementPlan`: per stage one leading indicator in words, where it is read,
and a decision rule for after the review moment — *opschalen, aanpassen of
stoppen als …*. The shape has no field for a target, a baseline or a forecast,
and the editorial ladder the model writes from (`FUNNEL_STAGE_INDICATOR_NL`,
after the GCS evaluation cycle: outputs and outtakes for Ontdekken, engagement
and intent for Overwegen, outcomes for Beslissen) contains no digit. It is
approved with the plan, shown in Stap 5, repeated at the top of Stap 8 and
printed in `publicatieplan.txt`.

**Results and lessons, per stage.** `outcome_reports.funnel_stage` is
nullable — a platform report usually covers a channel, not a stage — and lets
a learning say *e-mail in Overwegen*. The calendar is sequenced by stage:
Ontdekken from week one, Overwegen from week two, Beslissen from week three,
numbering still per channel across the plan. Stap 8 (`ResultsStep`) is where
a person records publications (which version, where, when), figures with their
period, provenance and stage, and learnings citing those figures; a learning is
a draft until approved and an approved one is context for the next campaign's
plan and content, never an edit to a persona or a brand rule.

**A revised audience reopens the briefing.** When a persona gets a new version
(an edit, or a re-proposal for the same course), every brief in `draft` or
`approved` that is pinned to an older version of that persona moves to
`needs_rereview` — the same transition content makes when a course fact or a
brand rule changes. `requireApprovedBrief` says why, and Stap 3 offers
*Briefing opnieuw goedkeuren*.

**The screen: eight steps, one numbering, one primary action.** The step bar
numbers by position and every card takes its number from the same list, so
"4. Contentpakket" over a card saying "5. Kanaalplan" — the previous layout —
cannot recur. The chain reads Doelgroep · Richting · Briefing · Concept ·
Kanaalplan · Content & beelden · Export · Resultaten & lessen; the website
package is the unnumbered branch *Website & interactief*, because it reads the
same briefing and plan but produces something else. Where the person is comes
from the server's state, is written to `?fase=` and is repeated as a *Volgende
stap* notice. The purple button on each step is the next thing to do; every
other button is secondary. The plan grid's argument is readable without hover
(`CellAdvicePanel`), cells whose advice moved from the rule are marked, and the
persona step shows every statement's evidence instead of a badge count.

**The package is a branch of the same campaign (R-4, first slice).**
`campaign.deliverables` v3 and `campaign.package` v4 receive `<campagnedoel>`,
`<funnelfasen>`, `<doelgroepen>`, `<fase_boodschappen>` and the approved
`<kanaalplan>`; every recommended form names the stage it serves and the mock
proposes one form per stage rather than all three. The catalogue with stage
fit and *niet gekozen omdat*, and folding the forms into the grid, remain
open — see the backlog.

| File | Role |
| --- | --- |
| `packages/contracts/src/funnel.ts` | `stageMessage`, `stageMessageFor`, `FUNNEL_STAGE_INDICATOR_NL`, `stageMeasurement` |
| `packages/contracts/src/campaigns.ts`, `personas.ts`, `outcomes.ts`, `calendar.ts`, `campaign-package.ts` | `briefVersion.stageMessages`, `contentPlan.measurementPlan`, `orientationSource` / `personaVersion.orientationSources`, `outcomeInput.funnelStage`, `calendarSlot.stage` with stage sequencing, `stage` on a recommended form |
| `apps/api/db/migrations/0022_stage_briefing_results.sql` | The four columns, nothing back-filled |
| `apps/api/src/core/ai/prompts.ts` | `brief.draft` v4, `content.plan` v3, `content.generate` v6, `persona.propose` v4, `campaign.deliverables` v3, `campaign.package` v4; `<bewijsvelden>`, `<fase_boodschap(pen)>`, `<doelgroep_kanalen>`, `<kanalen_uit_briefing>`, `<meetladder>`, `<kanaalplan>`; `stageMessageBrief` |
| `apps/api/src/modules/campaigns-briefs/service.ts` | Stage messages stored and validated; `requireApprovedBrief` explains a re-review |
| `apps/api/src/modules/concepts/service.ts` | Advice for every producible cell, orientation evidence and learnings into the prompt, measurement plan stored and checked |
| `apps/api/src/modules/content-assets/service.ts` | The stage's own message and learnings into generation and revision |
| `apps/api/src/modules/personas/service.ts` | `verifyOrientationSources`; briefs flagged on a persona revision |
| `apps/api/src/modules/campaign-packages/service.ts` | The package reads objective, stages, personas, stage messages and the approved plan |
| `apps/api/src/core/ai/mock-adapter.ts` | Stage messages, advice for all producible cells, a measurement plan, orientation statements (one grounded, one assumption, one with an invented source the service must strip), one form per stage |
| `apps/web/src/pages/CampagneDetailPage.tsx`, `components/FlowNavigation.tsx`, `components/FunnelPills.tsx`, `components/ResultsStep.tsx`, `components/ChannelPlanGrid.tsx` | The eight-step screen, the branch, the pills, the results step, the focused-cell and measurement panels |
| `apps/api/tests/integration/funnel-plan.test.ts`, `persona-orientation.test.ts`, `packages/contracts/tests/funnel.test.ts`, `calendar.test.ts` | Every stage briefed with confirmed proof only; advice on every producible channel; a measurement per stage without a figure; content opening with the stage's message; the calendar in journey order; an outcome per stage; orientation evidence kept or stripped per kind; a brief re-reviewed after a persona revision |
| `tools/ui-smoke/index.ts` | Walks the eight numbered steps (nineteen clicks) and checks, among sixteen properties, three stages briefed, eight channels advised, three stages measured and the calendar in journey order |

**Found by the first real-provider run, fixed the same day.** Stap 6 died with
*Er is een onverwachte fout opgetreden*: the worker could not open the brand
logo the api had stored. `STORAGE_ROOT` was a relative path (`./var/storage`)
resolved against each process's working directory, and `npm run dev -w`
starts the api in `apps/api` and the worker in `apps/worker` — three storage
roots on one machine, and a file written by one process invisible to the
other. Three fixes: `packages/config/src/env.ts` now resolves a relative root
against the **repository root** (the nearest ancestor with a workspaces
manifest), so every process agrees on one folder whatever its working
directory (`packages/config/tests/storage-root.test.ts`); a missing brand file
is an `AppError('dependency_changed')` with a message that names the two things
that fix it (`readStoredFile` in `apps/api/src/integrations/brand-portal/service.ts`)
instead of a raw `ENOENT` that killed the job as an internal error; and the api
and the worker log their resolved `storageRoot` at boot so a mismatch is
visible before the first job dies on it. Production is unaffected: an
absolute path is used as given.

The same run exposed a second trap: the content and plan jobs use a fixed
intent per campaign (`['content', campaignId]`), and the idempotency key made
every later click return the finished — here: dead — job unchanged, so
*Content maken* after the failure showed the old failure and ran nothing.
`JobService.enqueueForLabel` now lets a **finished** job (succeeded, failed,
dead, cancelled) be followed by a deliberate re-run, deriving the next key from
the finished job's id; a click *during* a queued or running job still collapses
onto that job, and the finished row keeps its history
(`job-queue.test.ts`, "lets a deliberate re-run follow a finished job").

**Not in this slice.** The deliverable catalogue and *niet gekozen omdat*
(R-4); question-design rules, aggregate-only interaction signals and persona
hypotheses from them (R-5); an experiment spec for paid channels and results as
intervals with n (R-7); public NL sources registered per label as citable
evidence (R-3 remainder); a brief editor in the interface (the API has one).
Campaigns briefed before this slice read as *geen boodschap per fase* and
generate from the stage guidance until the brief is re-drafted.

### Marktradar as market intelligence: the market picture (2026-09-11)

The pilot radar produced one card per page and offered three creative
approaches per card; a senior marketer reads a market, not a list of pages.
`docs/product/market-radar-senior-design.md` records the design and the
honest account of how it was produced (two code maps and one opened research
angle; the intelligence, legal and market-data researchers, the design panel
and the judge did not run). Slice MR-1 is built.

**The market picture.** After the extraction calls, `radar.synthesize` v1
reads the run's *verified* items — cards, doelgroep findings, competitors,
questions, advertisements, each with id, organisation, domain and passage —
and proposes at most five insights in the What → So what → Now what order
(`headlineNl`, `observationNl`, `meaningNl`, `nowNl`), each with an
alternative reading, a "wat dit niet laat zien" line, a funnel stage, a
suggested objective and the ids it rests on. `verifyInsights`
(`apps/api/src/modules/market-radar/synthesis.ts`) keeps only insights whose
cited ids exist in this run, refuses percentages and *trend* / *significant*
language, refuses any digit outside the observation and any number in the
observation not quoted from a cited passage, and computes confidence from the
cited domains — one *beperkt*, two *gemiddeld*, three or more *robuust* — with
the model stating only whether its sources agree, and a single source never
allowed to claim agreement (IPCC's two inputs, evidence and agreement). A model
failure leaves the rest of the report intact with a note. `insights`, `digest`
and `claims` default to empty on the report, so every historical run still
reads.

**Since the previous scan.** `buildDigest` compares two reports in code: new,
changed and gone source pages, new competitors, new questions, new
advertisements, changed coverage status — one Dutch change note each. A
changed content hash is written as a changed text, never as a market movement;
a page missing from this scan is written as not in this scan.

**Competitors quoted, not ranked.** `competitorClaims` lists the verified
competitor passages once each; the screen puts them next to our confirmed
course facts and adds nothing.

**The hand-off carries the objective.** Every route that creates a campaign
from the radar — insight, card approach, doelgroep finding, question,
advertisement — accepts `objective` and writes it to the campaign, so the
campaign lands in the eight-step screen with its funnel stages decided
instead of "geen doel vastgelegd". `campaignFromInsight` freezes the insight
in the brief in its own order with every cited URL and passage, the confidence
and the stage.

**Contact details out.** `redactReport` replaces e-mail addresses and phone
numbers in every stored passage after the excerpt-in-page verification (a
redacted passage would no longer be found in the page), and the report says
how many passages were affected. Names cannot be redacted reliably; the prompts
refuse them and the *Scan & beperkingen* text says so.

**The mock.** `radar.analyze` quotes one real sentence per fetched page as a
card marked *uncertain* and *demo*; `radar.synthesize` writes one insight per
distinct domain citing those cards — so a development scan of a supplied URL
exercises the whole path, including every check, without a provider. The scan
job now reserves five calls.

| File | Role |
| --- | --- |
| `packages/contracts/src/radar.ts` | `radarInsightProposal`, `radarSynthesis`, `radarInsight` with computed `confidence`, `gradeEvidence`, `radarDigest`, `competitorClaim`; `insights`, `digest`, `claims` on the report |
| `apps/api/src/modules/market-radar/synthesis.ts` | `evidenceItems`, `verifyInsights`, `buildDigest`, `competitorClaims`, `redactContactDetails`, `redactReport` |
| `apps/api/src/modules/market-radar/service.ts`, `routes.ts` | The synthesis call and its checks in `scan`; `campaignFromInsight`; `objective` on every hand-off (`handoffBody`) |
| `apps/api/src/core/ai/prompts.ts` | `radar.synthesize` v1 (an extraction template: it reads our verified evidence) |
| `apps/api/src/core/ai/mock-adapter.ts` | Demo cards from page sentences; a demo market picture from the evidence bundle |
| `apps/web/src/pages/RadarPage.tsx`, `components/MarketPicturePanel.tsx`, `components/ObjectiveSelect.tsx`, `components/KeywordPanel.tsx`, `AudiencePanel.tsx`, `AdvertisingPanel.tsx`, `pages/radar.css` | The screen in reading order, the objective picker on every hand-off, denominators on every count, tokens |
| `apps/api/tests/unit/radar-synthesis.test.ts`, `apps/api/tests/integration/market-radar.test.ts` | Unknown evidence dropped; unquoted and misplaced figures refused; percentages and trend language refused; grades from domains; single source cannot agree; digest across two runs; claims quoted once; redaction after verification; insight hand-off with the default and a chosen objective; 404 for an unknown insight |

**Not in this slice.** A decision trail per insight (MR-2), public Dutch
market sources per label and the moments calendar (MR-3 — needs the research
pass that did not run), typed competitor attributes for a positioning table
(MR-4), scheduled re-scans with the digest as deliverable (MR-5). The radar
still measures nothing — no volume, share, reach or result — and says so on
every screen.

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

### Handmatige personabibliotheek

`/beheer/doelgroepen` biedt een bibliotheek per actief label en opleidingsversie.
Gebruikers kunnen een persona handmatig maken, als JSON importeren/exporteren,
zoeken en bewerken. Import vult eerst het formulier; alleen expliciet opslaan
maakt een record. Bronnen en aannames blijven gescheiden. Handmatige invoer doet
geen AI-aanroep. Het POST-endpoint op `/labels/:labelId/courses/:courseVersionId/personas`
controleert schrijfrecht en de labelkoppeling van de opleiding. Een nieuwe persona
krijgt een eigen identiteit; bewerken gebruikt de bestaande versiegeschiedenis.
De campagne-stap Doelgroep toont zowel de opgeslagen opleidingspersona’s als de
voor die campagne gegenereerde persona’s. Bestaande campagnes blijven aan hun
specifieke personaversies gekoppeld. Eén persona-record hoort bij één opleidingsversie;
voor een andere opleiding kan een export opnieuw worden geïmporteerd en aangepast.

De bibliotheek bevat nu een generieke vragenlijst met 36 optionele vragen,
gegroepeerd in werk/achtergrond, persoonlijke context, behoefte/motivatie,
drempels/leren, keuze/aankoop, oriëntatie/taal en onderbouwing. Leeftijd is alleen
relevant als die de leerbehoefte of keuze beïnvloedt. Elk antwoord heeft de status
`provided`, `assumption` of `unknown`; de teller meet volledigheid, geen kwaliteit.
`persona_versions.questionnaire` wordt toegevoegd door migration
`0023_persona_questionnaire`; bestaande versies krijgen een leeg object.

**Losse tekst → controleerbaar concept → expliciet opslaan.** Het endpoint
`POST /labels/:labelId/courses/:courseVersionId/personas/extract-from-text` neemt
30–20.000 tekens en een `requestKey` aan, controleert rechten en de opleidingskoppeling
en start het gebudgetteerde worker-job `persona.extract_from_text`. Eén AI-aanroep
verdeelt alleen de aangeleverde informatie over de vragen, in het Nederlands.
Ontbrekende antwoorden blijven onbekend. Dubbele antwoorden en antwoorden zonder
een teruggevonden letterlijk bronfragment worden niet overgenomen. Een fragment
bewijst de herkomst, niet de waarheid of de juistheid van de samenvatting; controle
door de gebruiker blijft nodig. Er wordt geen webonderzoek gedaan.

Het jobresultaat bevat een bewerkbare `personaDraft` en waarschuwingen. **AI in
formulier overnemen** vult het formulier; **Persona opslaan** legt de nieuwe
personaversie vast. Het formulier wordt niet automatisch opgeslagen. Een gewijzigd
invoertekst maakt de oude AI-preview onbruikbaar. De huidige editor moet openblijven
om het concept over te nemen. Een verloren HTTP-antwoord kan met dezelfde
`requestKey` worden herhaald zonder een tweede AI-job, ook als de eerste al klaar is.
Handmatige antwoorden kunnen met **Antwoorden in personakaart overnemen** zonder
AI-kosten naar de samenvattingsvelden worden vertaald.

Alle ingevulde antwoorden en hun status gaan met de gekozen personaversie mee naar
briefing, richting, concept, kanaalplan, content en campagnepakketten. Bronfragmenten
worden opgeslagen voor controle, maar niet telkens opnieuw aan generatieprompts
toegevoegd. Opgegeven kanaalgedrag wordt niet tot geverifieerd kanaalbewijs verheven.
Een persona uit een tekst blijft een gebruikersinvoer na controle; het AI-job en
de bronfragmenten leggen de extractie vast. JSON-import/export bewaart de vragenlijst.

Gedekt door `persona-extraction.test.ts` (validatie, rechten, idempotentie, expliciet
opslaan, versies en campagnecontext), `persona-text-draft.test.ts` (bronfragmenten,
korte/onbekende antwoorden) en `persona-library.test.ts` (bibliotheek en imports).


### Proposed personas arrive with the questionnaire filled from the system's own research (2026-09-11)

**Story.** The library's 36 questions (previous section) were filled by hand or
from a pasted text. A persona the system proposed itself came with an empty
questionnaire, so the richest description sat next to the thinnest one. Now
`PersonaService.propose` fills the questionnaire for every proposed persona from
exactly the material the system gathered for it, and says per persona what it
could and could not answer.

**How it runs.** After the persona set is proposed, `propose` builds the
*material* with `questionnaireMaterial` in `apps/api/src/modules/personas/questionnaire.ts`:
every research finding (claim, source URL, retrieval time), every course fact a
person has confirmed (`statableFacts`, referenced as `Opleidingskaart · <label>`),
and, when the proposal is scoped to a campaign, the supplied brief or the user's
idea (`campagne-input`). One `persona.questionnaire` v1 call per persona receives
the persona profile, the 36 questions and that material in `<doelgroepprofiel>`,
`<vragen>` and `<materiaal>`; nothing else counts as a source. A provider
failure on this call (`provider_invalid_output`) does not fail the persona: the
questionnaire is stored on unknown with a note. The job budget for
`persona.propose` counts four calls (the set plus at most three questionnaires).

**What survives.** `verifyQuestionnaire` starts from all 36 questions on
`unknown` and then, per question:

- two answers to one question → unknown, counted in the note as conflicting;
- `provided` or `assumption` with a quote of at least eight normalised characters
  found literally in the material → kept, with `sourceQuote`, `sourceRef`,
  `sourceKind` and `sourceRetrievedAt` taken from the item that actually holds
  the passage (a wrong reference from the model is corrected, not trusted);
- the personal-context questions (age, region, personal circumstances) without
  such a passage → unknown; the material has to state the relevance, inference
  is not enough;
- the meta-question about which answers rest on evidence → allowed without a
  quote;
- any other stated answer without a traceable passage → `assumption` with
  `sourceQuote: null`, counted in the note;
- output the schema refuses → every question unknown, note "alle vragen staan op
  onbekend".

The note ends with "N van de 36 vragen ingevuld uit het onderzoek". The worker
puts the notes of all personas in `questionnaireNoteNl` on the job result; the
Doelgroep step shows them under **Vragenlijst uit het onderzoek**, next to the
existing shortfall reason. The mock adapter answers three questions from
confirmed course facts, one assumption without a quote and the meta-question, so
the demo path exercises every branch.

**Contract.** `personaAnswer` gained `sourceRef`, `sourceKind`
(`research_finding` | `course_fact` | `campaign_input`) and `sourceRetrievedAt`,
all nullable and optional so rows written before this change still parse.
`personaQuestionnaireProposal` is the provider schema (`answers` ≤ 36 with
`questionId`, `answer`, `status`, `quote`, `sourceRef`; `noteNl`). The
questionnaire component shows the kind, the reference (linked when it is a URL),
the retrieval date and the passage, with the standing caveat that a passage
shows provenance and not truth. No migration: the JSON column from
`0023_persona_questionnaire` holds the new fields.

| File | Change |
| --- | --- |
| `packages/contracts/src/persona-questionnaire.ts` | `personaAnswerSourceKind`; provenance fields on `personaAnswer`; `personaQuestionnaireProposal` |
| `apps/api/src/modules/personas/questionnaire.ts` | `questionnaireMaterial`, `materialForPrompt`, `verifyQuestionnaire` |
| `apps/api/src/modules/personas/service.ts` | the questionnaire call per proposed persona; `questionnaireNoteNl` on the result |
| `apps/api/src/core/ai/prompts.ts` | `persona.questionnaire` v1 and its task rule; `personaProfile`, `questions`, `material` in the context block |
| `apps/api/src/core/ai/mock-adapter.ts` | `questionnaire(context)` |
| `apps/api/src/modules/jobs-usage/generation-jobs.ts` | `persona.propose` reserves four calls |
| `apps/worker/src/handlers/generation.ts` | `questionnaireNoteNl` in the job result |
| `apps/web/src/pages/CampagneDetailPage.tsx` | the note in the Doelgroep step |
| `apps/api/tests/unit/persona-questionnaire.test.ts`, `apps/api/tests/integration/persona-auto-questionnaire.test.ts` | the survival rules above; a full questionnaire on every proposed persona; an invented quote demoted through a spied provider; a refused answer leaving unknowns without failing the persona |

**Not done.** The counter on the persona card still measures completeness, not
quality. The new prompt has run on the mock only; a real-provider run is the
user's to trigger. Answers about channel behaviour remain statements about a
segment and do not become channel evidence (that path is `orientationSources`).


### Personas that accumulate, a campaigns list that shows state, content that reads as written (2026-09-12)

Three complaints from one afternoon of real use, traced to code and fixed
together (`docs/product/personas-campaigns-content-quality-design.md`). The
design was to be built by three parallel agents; all three stopped on the
account's spend limit after leaving coherent partial work in seven files, and
the rest was built by hand on top of it. `npm run verify` and `npm run smoke`
decide when it is done.

**Personas (slice P).** A proposal used to derive its identity from
`campaign:slug(name)`, so a second run in the same campaign became version
two of the first and the list — latest per identity — did not grow; the model
was never told what existed; campaign personas were editable nowhere. Now:

- `PersonaService.propose` gives every proposal its own key
  (`scope:runToken:slug`), hands the model the library's and the campaign's
  personas as `<bestaande_doelgroepen>` (`persona.propose` v5: propose only
  audiences that differ materially, fewer when nothing else can be grounded),
  and skips a proposal whose normalised name already exists — counted and
  named in `shortfallReasonNl`; a run that adds nothing is a valid outcome.
- `personaVersion` exposes `personaKey` and `campaignId`; the list route
  accepts `scope=library|campaign|all`; `POST /labels/:labelId/personas/:id/library`
  copies a campaign persona into the library as a new identity with a
  provenance grounding entry (`campagne:<id>`), the original untouched.
- The Doelgroep step orders rows new → this campaign → library → pinned
  older versions, badges them, disables the propose button while the job runs,
  says when a run added nothing, and offers **Bewerken** (the shared
  `PersonaEditor`, extracted from the library page; saving is version n+1
  through the existing PATCH route, the selection follows the new id, a pinned
  briefing is flagged as before) and **Opslaan in bibliotheek**. The library
  page gained the list "Voorgesteld in campagnes" with the same actions.
- The mock varies its persona names by what exists, so the demo path appends.

**Campaigns list (slice K).** `packages/contracts/src/campaign-progress.ts`
holds the one rule for "where does this campaign stand": `computeCampaignProgress`
takes a small flat input and returns the next step, its number and Dutch
action, the done steps, an attention flag and a state (`open`, `attention`,
`finished`). The detail page's `nextStepFor` now calls it; the list route
feeds it from six grouped queries per page of campaigns (latest brief,
approved brief, selected concept, latest plan, latest asset versions, exports
with bytes, outcomes) — never a detail call per row — and returns
`CampaignListItem` rows with `courseName` and `progress`, the briefing bodies
nulled, paginated by keyset (`limit`, `cursor`). `campaign.stage` is no longer
shown anywhere as a status. The screen: one primary **Nieuwe campagne** that
reveals the form (open by default only when the label has no campaign, hidden
for viewers), a toolbar with search, next step, objective, course and sort, a
table that becomes cards under 720px, a purple/amber/green badge per row, a
progress bar "n van 8", the last activity relative with the full date in the
title, honest empty states, and the eight step names everywhere. The smoke
driver opens the form when it is collapsed.

**Content (slice C).** A landing page of two sentences, an e-mail reciting
the course card and four posts opening alike were all schema-valid; the
prompt said "3 to 5 sections" and allowed leaving them out; `channelNotes`
told long-form channels to keep it short; keyword research never reached a
prompt. Now:

- `channelGuidance.length` per channel (house style, not platform limits):
  website ≥ 500 words in 4–6 sections of ≥ 120; e-mail 2–4 sections, ≥ 180;
  LinkedIn ≥ 80, Facebook ≥ 60, Instagram ≥ 40 words; hashtags 3–5 / 1–3 /
  5–10, none elsewhere. `CHANNEL_CONFIG` is version 7.
- The website piece (`landing_page`) carries `copy.website`: a
  `course_page_update` (page URL, 1–6 changes with placement, reason, a
  literally quoted `currentExcerpt` and ≥ 80 words of `proposedText`) or a
  `blog_article` (title, meta description, intro, 3–6 sections, 2–4 FAQ,
  internal link text, ≥ 700 words). The live course page is read once per job
  through the guarded fetch (`content-assets/course-page.ts`) and handed to
  the prompt; when it cannot be read only the article is allowed. The channel
  label reads "Website: opleidingspagina of blogartikel"; the export prints
  either form in full.
- `briefVersion.keywords` (migration `0024_brief_keywords`): up to ten
  `{phrase, sourceRef, kind: radar | afgeleid}` chosen by `brief.draft` v6 from
  `<zoektermen>` — the radar keyword report when the campaign came from a
  scan, else phrases derived from the course name and its confirmed facts.
  `contentCopy.keywordsUsed` lists what a piece used; the code verifies each
  occurs literally.
- `content-assets/quality.ts`: shape checks (recomputed on every read, like
  the channel checks) and context checks (stored with the piece): too short,
  sections missing, hashtags missing or invalid, alt text missing, website
  form missing, keywords missing, a ten-word sentence copied from a course
  fact, a piece repeating another (trigram Jaccard above 0.6 on hook or body),
  a change quoting text the page does not have, page unavailable. Every one
  blocks a publish-ready export.
- `ContentAssetService.generate` makes one call per stage for the posts and
  adverts and one call per page or mail (`CALLS_PER_JOB` ceiling 9), hands
  every call the search phrases, the course page and the hook and opening of
  every earlier piece (`<eerdere_content>`), and sends a repairable problem
  back once as `<herstelpunten>`; a second failure is `provider_invalid_output`
  with the problems named. `content.generate` v8 states the minimums, the
  website decision, the hashtag and keyword rules, the no-recitation rule and
  the no-repetition rule; `content.revise` sees the whole piece.
- `ContentAssetCard` (new, in the detail page and the studio): word count
  against the minimum, inline warnings, hashtags and alt text as text, copy
  actions per part and for the whole piece as Markdown, the website form in
  full, and an editor for sections and hashtags.
- The mock builds each piece from channel- and stage-specific sentence banks
  so the smoke run and the tests exercise every rule.

| File | Change |
| --- | --- |
| `packages/contracts/src/personas.ts`, `apps/api/src/modules/personas/service.ts`, `apps/api/src/modules/campaigns-briefs/routes.ts` | `personaKey`/`campaignId` on the contract; run-scoped keys, `<bestaande_doelgroepen>`, duplicate guard, `listForCourse` scopes, `promoteToLibrary`; `scope=` and the library route |
| `apps/web/src/components/PersonaEditor.tsx`, `apps/web/src/pages/PersonasPage.tsx`, `apps/web/src/pages/CampagneDetailPage.tsx` | the shared editor; the library's second list; the Doelgroep step's ordering, badges, editing and promotion |
| `packages/contracts/src/campaign-progress.ts`, `packages/contracts/src/campaigns.ts` | the progress rule and `campaignListItem` |
| `apps/api/src/modules/campaigns-briefs/service.ts` | `list()` with grouped progress queries and keyset cursors; `keywordPool` and keyword verification on `draftBrief` |
| `apps/web/src/pages/CampagnesPage.tsx`, `apps/web/src/pages/campaigns-list.css`, `tools/ui-smoke/index.ts` | the redesigned list; the driver opens the collapsed form |
| `packages/contracts/src/channels.ts`, `packages/contracts/src/content.ts` | `lengthGuidance`, new warning kinds, `lengthGuidanceFor`; `websiteCopy`, `keywordsUsed`, `website` |
| `apps/api/db/migrations/0024_brief_keywords.sql` | `brief_versions.keywords` |
| `apps/api/src/modules/content-assets/quality.ts`, `course-page.ts`, `service.ts` | the checks; the page reader; per-piece calls with one repair, stored context warnings, `channelNotes` with minimums |
| `apps/api/src/core/ai/prompts.ts`, `apps/api/src/core/ai/mock-adapter.ts` | `content.generate` v8, `brief.draft` v6, `persona.propose` v5; `<zoektermen>`, `<opleidingspagina_*>`, `<eerdere_content>`, `<herstelpunten>`; the mock's banks |
| `apps/web/src/components/ContentAssetCard.tsx`, `apps/api/src/modules/exports/service.ts` | the card; the website form and keywords in the export |
| `apps/api/tests/integration/persona-additions.test.ts`, `campaign-list-progress.test.ts`, `content-quality.test.ts`, `apps/api/tests/unit/content-quality.test.ts`, `packages/contracts/tests/campaign-progress.test.ts` | the behaviour above, including a spied two-line page refused after one repair |

**Not done.** Approving or archiving personas; a second page on the campaigns
list in the interface (the route pages, the screen asks for a hundred);
HTML rendering of the website piece; measured reach of any hashtag or
keyword — there is no measurement, and the card says so. The new prompts
have run on the mock only; a real-provider run is the user's to trigger.


### Personas linked to several courses, and a briefing a colleague can pick up (2026-09-14)

Two asks from the presentation day, built on the 2026-09-12 slices.

**Course links.** A persona is made for one course version — its facts and
research are that course's — but the same audience often fits several courses
of a label. `personaVersion.linkedCourseVersionIds` (migration
`0025_persona_course_links`) lists the other course versions the persona is
relevant for. The persona editor shows the label's courses as a checkbox
dropdown ("Opleidingen"); the course the persona was made for is fixed, the
others toggle. A link may name only course versions of the same label
(`verifiedCourseLinks`, refused with a bad request otherwise). Listing under a
course now collapses to the latest version per identity *first* and filters by
course second, so unlinking in version two removes the persona from that
course's list even though version one still linked it. A campaign on a linked
course may brief with the persona (`requireForCampaign` accepts links). The
library page says "Gemaakt voor …; hier gekoppeld" or "Ook gekoppeld aan …".
Editing a persona from the campaign step (`Bewerken`) was already there; it is
the same editor. Two things made that button read as broken, and both are
fixed: the library opened the editor at the top of the page while the person
was looking at a card far below it, and nothing scrolled. The editor now opens
under the card it edits, `Bewerken` toggles to `Bewerken sluiten`, and the
editor scrolls itself into view and takes focus when it opens.

**The brief.** The first briefs had a goal, a message, claims and a measurement
line. A professional campaign brief also states the situation and why now,
describes the audience and the insight, makes a proposition and says why it is
credible, sets tone and mandatories, gives every channel a role, names
deliverables and phasing, says how success is read and what stops the
campaign, and lists risks and assumptions. `briefVersion` gained
`contextNl`, `audienceInsightNl`, `propositionNl`, `toneOfVoiceNl`,
`mandatories`, `channelRoles`, `timingNl` and `risks` (migration
`0026_brief_sections`, all defaulted so older briefs read back and show
"niet uitgewerkt"). `briefProposal` holds the model to minimums;
`briefProblems` counts words per section (context 80, audience insight 80,
goal 40, deliverables 60, measurement 40, proposition 30, stop criteria 20,
tone 20, core message 12, timing 10) and in total (550), requires a role per
suggested channel and refuses a percentage in the goal or the measurement.
`draftBrief` sends a shortfall back once as `<herstelpunten>` and then fails
with `provider_invalid_output`, storing nothing; a role for a channel the
brief does not suggest is dropped. `brief.draft` v7 describes the sections
with word ranges and the working method per entry mode (a supplied briefing
is structured into the sections; the analysis sections are always written
out; what the supplied text does not say about timing or budget becomes
"nog te bepalen" plus a review note). `<doelgroepen>` now carries each
persona's relation to the course, grounding and assumptions, so the context
and insight sections rest on the research. `briefEditInput` is built field by
field without inherited defaults — `.partial()` on a defaulted field still
applied the default, so a one-field patch wiped stage messages and keywords.
The screen shows the brief as a numbered seventeen-section document
(`BriefDocument`) with a word count and **Kopieer als Markdown**; the mock
writes a full brief so the smoke run and the tests exercise the floors.

| File | Change |
| --- | --- |
| `packages/contracts/src/personas.ts`, `apps/api/db/migrations/0025_persona_course_links.sql`, `apps/api/src/modules/personas/service.ts`, `apps/api/src/modules/campaigns-briefs/routes.ts` | `linkedCourseVersionIds`; verified links; latest-then-filter listing; links on create and edit |
| `apps/web/src/components/PersonaEditor.tsx`, `apps/web/src/pages/PersonasPage.tsx`, `apps/web/src/pages/personas.css` | the course checkbox dropdown; linked-course notes |
| `packages/contracts/src/campaigns.ts`, `apps/api/db/migrations/0026_brief_sections.sql`, `apps/api/src/modules/campaigns-briefs/service.ts` | the brief sections; `briefProblems`; the repair round; `briefEditInput` without defaults |
| `apps/api/src/core/ai/prompts.ts`, `apps/api/src/core/ai/mock-adapter.ts` | `brief.draft` v7; persona grounding in `<doelgroepen>`; the full mock brief |
| `apps/web/src/components/BriefDocument.tsx`, `apps/web/src/pages/CampagneDetailPage.tsx`, `apps/web/src/pages/campaign-flow.css` | the brief as a document with Markdown copy |
| `apps/api/tests/unit/brief-problems.test.ts`, `apps/api/tests/integration/brief-professional.test.ts`, `apps/api/tests/integration/persona-course-links.test.ts` | the floors, the repair-then-refuse path, the dropped role, a lenient edit; links listed under both courses, unlinking, briefing on a linked course, a foreign course refused |

**Not done.** A brief export file (the Markdown copy stands in); budget as a
brief section (the campaign's `budgetCents` is shown elsewhere); the new
prompt has run on the mock only.


### One interface: page anatomy, components and the stepper (2026-09-14)

Every screen now shares one anatomy and one set of parts, described in
`docs/product/ui-design-system.md`. `packages/ui` gained `PageHeader`, `Tabs`,
`SectionHeader`, `EmptyState`, `Skeleton`, `Disclosure`, `KeyValue`, `Toolbar`
and `Icon`; `Card` gained a description, a tone and a small padding; `Button`
gained a size and icons; `Notice` shows an icon. `shell.css` sets element
defaults inside the content area (purple links, shared heading sizes, turning
chevrons on `<details>`, token-styled plain form controls) so a page written
without the components still looks like the product. The step bar is a
stepper — numbered discs, green when done, purple when current, amber when
something asks for a second look — and the tab bar is underline tabs, both
from `FlowNavigation` with a mode class. `LoadingState` shows a skeleton.

Screens: Werkruimte rebuilt around the header with the two starts, linked stat
tiles, attention items linking to their campaign, the fundament as a key–value
list and the development test form behind a toggle; the campaign screen with
a header, a compact next-step line, step-card heads with a numbered disc, the
explanatory text of every step behind "Hoe werkt deze stap?" and the content
step's stages behind tabs; Content Studio and Doelgroepen rewritten in the
anatomy (tabs by kind with counts, one card shape, empty states); Opleidingen
with the intake behind the primary action and per-course tabs; AI Visibility &
GEO, Marktradar, Merk & bronnen and Labels & toegang with the shared header
and the baseline styles. No colour outside `tokens.css` was added; every label
the browser smoke clicks is unchanged (`ui-smoke-labels.test.ts`).

| File | Change |
| --- | --- |
| `packages/ui/src/components.tsx`, `packages/ui/src/index.ts`, `packages/ui/src/primitives.css` | the new components and their styles |
| `apps/web/src/shell/shell.css` | element defaults inside the content area |
| `apps/web/src/components/FlowNavigation.tsx`, `apps/web/src/components/flow-navigation.css` | stepper and underline tabs |
| `apps/web/src/components/states.tsx` | skeleton loading |
| `apps/web/src/pages/WerkruimtePage.tsx`, `apps/web/src/pages/JobsPanel.tsx` | the rebuilt workspace; Dutch job names, six recent tasks, the test form behind a toggle |
| `apps/web/src/pages/CampagneDetailPage.tsx`, `apps/web/src/pages/campaign-flow.css` | header, next-step line, step-card heads, disclosures, content tabs |
| `apps/web/src/pages/ContentStudioPage.tsx`, `apps/web/src/pages/radar.css` | the rewritten studio |
| `apps/web/src/pages/PersonasPage.tsx`, `apps/web/src/pages/personas.css` | the rewritten library |
| `apps/web/src/pages/OpleidingenPage.tsx`, `CampagnesPage.tsx`, `RadarPage.tsx`, `MerkPage.tsx`, `LabelsPage.tsx`, `GeoPage.tsx`, `AiVisibilityPage.tsx`, `ai-visibility.css` | shared header, tabs, baseline styles |

**The trail (later the same day).** The top bar's breadcrumb became a real
trail (`apps/web/src/shell/breadcrumbs.tsx`, `AppShell`): every level above
the current page is a link, the page itself is bold and unlinked; the route
gives the default and a page may set its own with `useBreadcrumbs` — the
campaign screen writes "Campagnes / <naam> / <stap>", so a person returns to
the campaign or the list from any step in one click. The redundant "Alle
campagnes" link in the campaign header went.

**Not done.** A mobile navigation drawer; per-screen component tests; icons on
every button.


### The blog article as practice, not as length (2026-09-14)

The website piece's article had the right length and the wrong shape: five
sections that summarised the course page, the course in every paragraph, no
question answered. Two researchers read the 2024–2026 material on how an
article ranks, gets cited by AI answer engines and still leads to a course
page; the convergent practice is in `docs/product/blog-article-practice.md`
and is now what the code holds the model to.

- `websiteBlogArticle` gained the parts of that practice as fields —
  `directAnswerNl`, `scenarioNl`, `externalFacts`, `midCtaNl` with
  `midCtaAfterSection`, `coursePathNl`, `closingCtaNl` — next to title, meta
  description, intro, sections (now up to seven), FAQ (up to five) and link
  text; all defaulted, so older articles read back.
- `content-assets/article-quality.ts`: `checkArticleStructure` judges title
  (a question, ≤ 70 characters, no course name), meta description (120–155),
  the direct answer (35–90 words, declarative, quotable), the intro without
  the course, 4–7 question headings whose text stands alone, the scenario, 3–5
  FAQ with answer-first answers, the bridge sentence naming the course after
  the first or second section, the path section, a benefit-led close without
  pressure, no exclamation marks, no superlatives, the search phrase in the
  opening, and the length band; `checkArticleFacts` refuses a number that is
  not on the course card or in a cited fact, a source the service did not hand
  the model, and reports the course share and sentence length. Structure,
  tone, numbers and sources go back to the model once as `<herstelpunten>`;
  readability is shown to the reviewer.
- `content.generate` v9 states the practice in Dutch, part by part with word
  ranges, the teach-versus-signal line and the tone rules.
- The mock writes an article that passes every check; the card and the export
  render the parts in reading order (the bridge after its section, the
  scenario as a quote, the sources, the path, the close).

| File | Change |
| --- | --- |
| `packages/contracts/src/content.ts`, `packages/contracts/src/channels.ts` | the article fields; warning kinds `article_structure`, `marketese`, `unverified_number`, `unsourced_fact`, `course_share`, `readability` |
| `apps/api/src/modules/content-assets/article-quality.ts`, `quality.ts`, `service.ts` | the checks; the repair set; the sources the model may cite (persona groundings, the course page) |
| `apps/api/src/core/ai/prompts.ts`, `apps/api/src/core/ai/mock-adapter.ts` | `content.generate` v9; `mockArticle` |
| `apps/web/src/components/ContentAssetCard.tsx`, `apps/api/src/modules/exports/service.ts` | the article in reading order, in the card, in Markdown and in the export |
| `apps/api/tests/unit/article-quality.test.ts` | a compliant article passes clean; every drift is named |
| `docs/product/blog-article-practice.md` | the practice and its sources |

**Not done.** An author byline and dates (the product has no author model);
Article JSON-LD (the export is text, not HTML); a real-provider run of v9.


### Creatieve sociale beeldbrief — 14 september 2026

Nieuwe sociale beeldvoorstellen combineren een onderbouwd campagne-idee met een
scène, gekozen tekstbehandeling en merkintegratie in `creativeBrief`. De brief
wordt in dezelfde contentgeneratie gemaakt en in de renderspecificatie bewaard.
Het beeldmodel maakt de scène; de renderer zet kop, optionele spreekballon,
CTA en echt logo met de actuele merkbestanden. De bronpixelkaart houdt rekening
met uitsnede en tekstruimte. Ontbrekende briefs worden één keer hersteld;
onleesbare kleuren of overlopende tekst leveren een duidelijke fout op.
De contentkaart toont **Creatieve beeldbrief**, inclusief tekst, kleuren, fonts
en een melding wanneer er geen merkfontbestanden zijn geladen.

Bronnen, implementatie en grenzen: [Social creative direction 2026](product/social-creative-direction-2026.md).
Bestaande beelden worden niet automatisch gewijzigd. Gebruik nieuwe content
of een gecombineerde revisie voor een nieuwe beeldbrief. Alleen-tekst-revisies
behouden het beeld; alleen-beeld-revisies behouden tekst en de bestaande richting.

### Campagnebreed creatief onderzoek en kanaaladaptatie — 14 september 2026

Vóór sociale beeldbriefs wordt één `creativeResearch`-dossier samengesteld uit
de goedgekeurde campagne, gekozen concept, actuele merkversie, geselecteerde
persona’s, actuele bestaande onderzoeksbevindingen en de aan de campagne
gekoppelde radarrun. De paginalezer kan maximaal twee unieke radarpagina’s
opnieuw lezen; er wordt hiervoor geen extra AI-zoek- of strategieaanroep gedaan.
De bestaande contentaanroep gebruikt dit materiaal om een kanaalspecifieke
brief te schrijven. Officiële kanaalrichtlijnen zijn gedateerde redactionele
input, geen bewijs van het mediagedrag van een persona.

Het dossier bewaart bronverwijzingen, data, passages, interpretaties en gaten.
Een eerder vastgelegde claim, opnieuw gelezen paginatekst en daadwerkelijk
visueel onderzochte advertentie worden niet gelijkgesteld: automatische
analyse van concurrentbeelden is in deze stap **niet** geïmplementeerd.
Het dossier deelt concept, beeldrichting, materiaal en licht over de kanalen.
Per uiting zijn `campaignAlignment`, `channelRationale`, gekozen persona-id’s,
gebruikte bron-id’s en `testHypothesis` verplicht. Niet-bestaande verwijzingen
en letterlijk herhaalde scènes gaan terug in de bestaande ene herstelronde.
De inhoudelijke juistheid van een interpretatie en visuele kwaliteit blijven
onderdeel van menselijke beoordeling; er wordt geen effectscore verzonnen.

De contentkaart toont **Onderbouwing & kanaalkeuze** met gebruikte bronnen,
de gedeelde richting, de kanaalredenering en onzekerheden. De volledige
momentopname wordt in de bestaande variant-JSON bewaard; geen migratie nodig.
Bij ongewijzigde invoerversies en bronstaat wordt een opgeslagen dossier
maximaal zeven dagen hergebruikt. Tekst- en beeldrevisies afzonderlijk bewaren
hun oorspronkelijke dossier; **Tekst en beeld** bereidt het dossier opnieuw
voor met geldige cachecontrole. Als bewaarde onderzoeksinvoer afwijkt van de
huidige contentversie, markeert de kaart het dossier expliciet als historisch.
Een tekst-only herziening krijgt oude merkregels uit dat dossier niet opnieuw
als promptcontext. Het dossier ontstaat pas duurzaam zodra een
contentversie wordt opgeslagen; er is nog geen los onderzoeksproject of
handmatige vernieuwknop voor dit dossier.

De contrastcontrole kiest nu een leesbare combinatie **binnen het bestaande
merkpalet**, inclusief alternatieve tekstvlakken. De CS-kleuren lichtvlak
`#f3edeb` en tekst `#203E58` halen circa 9,58:1, terwijl tekst op het vaste
groen de grens niet haalde. Deze controle vindt vóór een nieuwe beeldoproep
plaats. Zonder enige leesbare merkcombinatie blijft er een gerichte fout;
er worden geen extra kleuren bedacht. Een echte lichte PNG-logo-uitvoering
kan binnen het logovak een contrasterende plaat uit het merkpalet krijgen.
De oorspronkelijke logo-bytes blijven behouden. De werkelijk gebruikte
tekstparen en logo-achtergrond worden vastgelegd in `colorResolution`.

Onderzoek, bronnen, aanbevelingen en implementatiegrenzen:
[Uitgebreid onderzoek naar consistente sociale creativiteit](product/social-creative-research-2026.md).
Nieuwe productie gebruikt `content.generate` v11, `content.revise` v4 en
`content.visual` v4. Bestaande beelden blijven beschikbaar; een beeldrevisie
past de contrastcorrectie toe, en **Tekst en beeld** voegt ook de nieuwe
onderbouwing en kanaalbrief toe.

### Every persona question answered, and stored personas completed (2026-09-14)

**Why.** The questionnaire the system fills for a proposed persona (2026-09-11)
answered only what it could quote: three to six of the 36 questions, the rest
*onbekend*. A persona with thirty open questions is not something a campaign
can be planned on, and it hid the real distinction — not provided/assumption,
but *who says so*. The request was plain: the system must think every question
through; what it infers it labels as its own inference with the reasoning; what
rests on material it labels with where that comes from; no question stays open;
and the personas that already exist get the same treatment.

**Two kinds of answer, one origin per cell.** `personaAnswer` gains `origin`
(`ai_source` · `ai_inference` · `system` · `user`) and `reasoningNl`
(`packages/contracts/src/persona-questionnaire.ts`). `persona.questionnaire`
v2 tells the model to answer all 36: *uit bron* with a literal quote and the
exact reference, or *door AI afgeleid* as an assumption whose `reasoningNl`
says in one or two sentences what it was inferred from. The personal-context
questions are answered about relevance — that age is not decisive and why,
what travel time or class form suits a working professional, that
participation must fit next to a full job — never as an estimate, and never
as a source of preferences or budget. `verifyQuestionnaire` keeps the same
posture as before and adds the labels: a found passage → `ai_source` with the
source fields; a stated answer without a passage → `assumption` with
`ai_inference` and the model's reasoning (or the plain sentence that there is
no passage); q36 → `ai_inference`. Three things it now writes itself, with
origin `system`: a question the model left out or marked unknown (the model's
own explanation is kept when it gave one), a question answered twice, and —
new — an age stated without a passage, which is replaced by the sentence that
age is not derivable and not decisive, counted in the notes. The parse-failure
path leaves every cell open with an explicit sentence. The summary note reads
"N van de 36 vragen ingevuld: A uit bron (letterlijke passage), B door AI
afgeleid als aanname; geen vraag staat open." The mock answers all 36 the same
way (six from confirmed course facts when present, the rest inferred with a
demo reasoning, q36 as summary), so the demo path shows the shape a real run
has.

**Completing what exists.** A new job, `persona.fill_questionnaire`, one call,
started by a person: `POST /labels/:labelId/personas/:id/questionnaire/fill`
(202, or 200 with the running job). `PersonaService.fillQuestionnaire` runs
the same call and the same verification over the persona's own course,
campaign input and research, then `fillOpenQuestions` **touches only the open
cells**: an answer a person or an earlier run gave stays byte for byte. The
result is the next version of the same persona — same key, campaign, links
and **origin** (a hand-made persona does not become a proposal because the
system completed its questionnaire; every new cell carries its own origin).
When nothing is open the call stores nothing and says so. A model failure
fails the job, so nothing is stored and the job can be retried. The job type
is in `IMPLEMENTED_JOB_TYPES`, its budget is one call, the worker handler
reports how many questions it filled.

**Screen.** The questionnaire opens with a legend of four badges — *uit bron*
(green), *door AI afgeleid* (purple), *handmatig* (neutral), *open* (amber) —
and one sentence saying what the first two mean. Every answer carries its
badge; an inferred one shows its *Redenering*; a sourced one keeps the
passage-and-provenance disclosure. Answers stored before the origin existed
fall back to what their status and source fields imply. A typed answer is
marked `user`. The persona card (Doelgroepen) and the persona row (Doelgroep
step) show **Open vragen door AI laten invullen (N)** while N > 0, with the
job's progress and the note it returns; in the campaign step the choice
follows the new version. The library page adds one card per view: **Open
vragen van N persona's laten invullen (N AI-aanroepen)**, one job per persona,
each with its own progress, so a failure in one leaves the others alone. The
development stack runs against a real provider, so these buttons were built
and typechecked but **not pressed** here; the mock path is what the tests and
the browser smoke exercise.

**Not done.** No migration: the questionnaire is JSONB and older cells simply
lack `origin`. A real-provider run of v2 is the user's to trigger. The
region/circumstances answers rely on the prompt's rule against estimates; only
the age answer has a mechanical guard. The bulk button starts jobs
sequentially from the browser; a closed tab stops the loop, not the jobs
already started.

| File | Change |
| --- | --- |
| `packages/contracts/src/persona-questionnaire.ts` | `personaAnswerOrigin`; `origin`, `reasoningNl` on `personaAnswer` and on the proposal's answers |
| `packages/contracts/src/jobs.ts` | `persona.fill_questionnaire` in the vocabulary and in `IMPLEMENTED_JOB_TYPES` |
| `apps/api/src/core/ai/prompts.ts` | `persona.questionnaire` v2 and its task rule |
| `apps/api/src/core/ai/mock-adapter.ts` | `questionnaire(context)` answers all 36; `personaProfileName` from `<doelgroepprofiel>` |
| `apps/api/src/modules/personas/questionnaire.ts` | origins and reasoning in `verifyQuestionnaire`; system cells; the age guard; `counts`, `questionnaireSummaryNl`, `isAnswered`, `openQuestionIds`, `fillOpenQuestions` |
| `apps/api/src/modules/personas/service.ts` | `fillQuestionnaire` |
| `apps/api/src/modules/campaigns-briefs/routes.ts` | `POST /labels/:labelId/personas/:id/questionnaire/fill` |
| `apps/api/src/modules/jobs-usage/generation-jobs.ts` | one call per fill job |
| `apps/worker/src/handlers/generation.ts` | the `persona.fill_questionnaire` handler |
| `apps/web/src/components/PersonaQuestionnaire.tsx` | `provenanceOf`, the legend, the badge and reasoning per answer, typed answers marked `user`; `questionnaireStats` gains sourced/inferred/manual |
| `apps/web/src/components/PersonaQuestionnaireFill.tsx` | the fill button with job progress |
| `apps/web/src/pages/PersonasPage.tsx`, `CampagneDetailPage.tsx`, `JobsPanel.tsx`, `personas.css` | the button on the card and the row; the bulk card; the job's Dutch name; styles |
| `apps/web/src/api/campaign-queries.ts` | `useFillPersonaQuestionnaire` |
| `apps/api/tests/unit/persona-questionnaire.test.ts`, `tests/integration/persona-auto-questionnaire.test.ts`, `tests/integration/persona-fill-questionnaire.test.ts` | the rules above |

### Showcase readiness: a destination on every call to action, the keuzehulp as a quiz, Google Ads from Google's own documentation (2026-09-15)

**What the real campaign showed.** Reading the latest real-provider campaign
in the development database before the showcase: every piece — LinkedIn,
Instagram, Meta Ads, the page change — ended in "Bekijk de keuzehulp", the
briefing's call to action had **no URL**, and no keuzehulp had been made in
the Website & interactief branch. The chain had promised an interactive tool
that did not exist and pointed nowhere. The branch itself showed one disabled
button and one sentence, so a person could not tell whether it was broken or
waiting; its keuzehulp, once made, listed the reader's own answers back and
could only be seen by downloading a ZIP. Google Search Ads existed with every
limit `null` and three headlines.

**A destination on every call to action.** `draftBrief` stores `ctaUrl` as
the model's URL, else the radar target from a supplied briefing, else the
course page; a content piece takes the briefing's URL, else its own, else
the course page. `brief.draft` v8 tells the model to name the destination
and to promise a keuzehulp, quiz or checklist only when the campaign makes
one in the Website & interactief branch — in which case the destination is
the course page where it is embedded. `promisesInteractiveForm` (contracts)
recognises such a promise; the briefing document notes it under the call to
action, and the branch shows a warning until a keuzehulp exists and a
neutral note once it does.

**The keuzehulp as a quiz.** `campaignPackageContent` gains a `signal`
per option (`fit` · `explore` · `other`, defaulted for stored reports) and
three written `outcomes` (title, 60–120 words, two to four next steps;
`null` for older reports). `campaign.package` v6 asks for three to five
questions, a signal per option and the three outcomes; the mock delivers
them. `campaign-packages/quiz.ts` builds the page: a progress bar, one
question at a time, a short reaction per answer, then the outcome by
majority of signals — a tie is *explore* — with the next steps and one link
to the course page carrying `utm_source=keuzehulp`; "Opnieuw beginnen"; a
line saying it is no admission test and stores nothing. No cookies, no
form, no tracking; `noindex`. `decideOutcome` in TypeScript and the same
algorithm in the page's script are tested together, and the page was played
through in a browser (three answers → outcome → tagged link; the tie path →
*explore*). `render.ts` writes the quiz files over the older reflection list
for `fit_check`; an older report without outcomes still renders as before.

**The branch a person can read.** `GET …/packages` now returns `readiness`:
the four gates (newest briefing approved, course card approved, public
HTTPS destination, approved brand version) each as *Klaar* or *Nog te doen*
with what to do, plus `interactivePromised`. `GET …/packages/:id/preview`
returns every produced page as self-contained HTML (stylesheet and script
inlined, logo as data URI, brand font files left out and said so) and the
embed snippet. `CampaignPackagePanel` was rewritten in the shared style:
the checklist, three numbered actions (propose forms → choose → make), each
package with tabs Keuzehulp · Blog in a sandboxed `srcdoc` frame
(`allow-scripts allow-popups`), the embed code with a copy button, the ZIP
download, the evidence panel and the provenance. The Studio option is
labelled as rich media for Studio, and points to step 6 for Google Ads.

**Google Ads.** Two research passes read Google's help pages on 2026-09-15
(`docs/product/google-ads-practice.md`, sixty-six sources). From that:
`google_search_ads` is *verified against official docs* for its text limits
(headline 30, description 90, path 15, `CHANNEL_CONFIG` v8) and therefore
publishable when a piece passes the checks; `adProposal` carries up to
fifteen headlines and four descriptions plus `paths`, `negativeKeywords`,
`matchTypeAdviceNl` and `finalUrl`, all defaulted so stored ads read back;
`googleAdsFrame(stage)` (contracts) states per funnel stage the objective in
Google's vocabulary, the campaign type, why, keywords and negatives, the
conversion actions to configure first, the bidding path as data grows, the
budget arithmetic, measurement, the landing page and the EEA requirements
(Consent Mode v2, advertiser verification, Ads Transparency Center), each
with its source page — Ontdekken says plainly that Search reaches only
people who already search and points at Demand Gen. `content.generate` v12
receives the frame as `<google_ads_kader>` and writes a responsive search
ad; `checkGoogleAdsShape`/`checkGoogleAdsContext` refuse a piece outside the
limits or the policy (exclamation in a headline, repeated punctuation,
shouting, superlatives, an unverified number, no search phrase in a
headline), repaired once. The content card shows every line with its count
against the limit and the frame beneath; the channel plan shows the frame
next to the advice; the export writes the lines with counts, the frame and a
hand-off sheet `google-ads-v<n>.csv` (our column names; a sheet for the
person, not an upload). The channel label reads "Google Ads
(zoekadvertenties)".

**Not done.** The real-provider run of v8/v6/v12 is the user's to trigger
before the showcase. LinkedIn Ads and Meta Ads stay unverified and
draft-only. No Google Ads account connection, no keyword volumes, no bids.
The quiz's outcome texts are model output and reviewed like the rest. The
CSV column names are ours; Google Ads Editor's import format was not read.

| File | Change |
| --- | --- |
| `packages/contracts/src/campaign-package.ts` | `quizSignal`, `quizOutcome(s)`, `signal`/`outcomes` on the content, `promisesInteractiveForm`, `PackageReadiness`, `PackagePreview` |
| `packages/contracts/src/google-ads.ts` | `GOOGLE_ADS_SOURCES`, `GOOGLE_RSA`, `GOOGLE_RSA_HOUSE`, `googleAdsFrame`, `googleAdsFrameText` |
| `packages/contracts/src/channels.ts` | Google Search Ads verified (30 · 90 · 15), five `ad_*` warning kinds, label, config v8 |
| `packages/contracts/src/content.ts` | `adProposal`: 15 headlines, 4 descriptions, `paths`, `negativeKeywords`, `matchTypeAdviceNl`, `finalUrl` |
| `apps/api/src/core/ai/prompts.ts` | `brief.draft` v8 (destination rule), `campaign.package` v6 (quiz), `content.generate` v12 (responsive search ad), `<google_ads_kader>` |
| `apps/api/src/core/ai/mock-adapter.ts` | quiz signals and outcomes; a compliant responsive search ad |
| `apps/api/src/modules/campaigns-briefs/service.ts`, `content-assets/service.ts` | CTA URL fallbacks; the Google Ads frame in the content context |
| `apps/api/src/modules/campaign-packages/quiz.ts` (new), `render.ts`, `service.ts`, `routes.ts` | the quiz files; `readiness`, `preview` and their routes |
| `apps/api/src/modules/content-assets/quality.ts` | `checkGoogleAdsShape`, `checkGoogleAdsContext`, repair kinds |
| `apps/api/src/modules/exports/service.ts` | ad lines with counts, the frame, `buildGoogleAdsSheet` |
| `apps/web/src/components/CampaignPackagePanel.tsx` (rewritten), `GoogleAdsFrame.tsx` (new), `ContentAssetCard.tsx`, `ChannelPlanGrid.tsx`, `BriefDocument.tsx`, `campaign-flow.css` | the branch, the frame, the ad lines with counts, the promise note |
| `apps/api/tests/unit/quiz.test.ts`, `google-ads-quality.test.ts`; `tests/integration/campaign-package-quiz.test.ts`; `packages/contracts/tests/google-ads.test.ts`, `ad-proposal.test.ts` | the rules above |
| `docs/product/google-ads-practice.md` | the reading of Google's documentation and what the product does with it |

## Gedeelde concurrentenregistratie — 15 september 2026

Market Radar heeft een tab **Concurrenten**, ook vóór een eerste scan. Handmatig
toegevoegde bedrijven en expliciet geaccepteerde onderzoeksvoorstellen delen
dezelfde identiteiten als de bestaande handmatige AI Visibility-merkenlijst.
Website, LinkedIn-/Facebook-/Instagram-organisatiepagina’s, opleidingsbronnen,
aliassen, actieve status en opleidingskoppelingen worden bewaard. Volgende
scans nemen de actieve gekoppelde bedrijven mee en bewaren hun gebruikte
primaire bronnen in het rapport. Nieuwe voorstellen worden pas na een klik
opgeslagen; oude rapporten blijven intact.

Zie [werkwijze, grenzen en controles](product/competitor-registry.md). Dit
activeert geen externe social- of advertentie-API: de bestaande bereikbaarheid
en de begrensde advertentieverzameling blijven gelden.

| Bestand | Verantwoordelijkheid |
|---|---|
| `packages/contracts/src/competitors.ts` | Gedeelde bedrijfsprofielen en invoercontroles |
| `apps/api/db/migrations/0027_competitor_profiles.sql` | Profielgegevens op bestaande bedrijfsidentiteiten |
| `apps/api/src/modules/competitors/service.ts` | Labelgebonden opslag en identiteitscontrole |
| `apps/api/src/modules/competitors/routes.ts` | Profielen opvragen, toevoegen en bijwerken |
| `apps/api/src/modules/market-radar/registered-competitors.ts` | Opleidingsselectie, bronvoorrang en herkenning |
| `apps/web/src/components/CompetitorRegistry.tsx` | Profielbeheer en expliciet overnemen van voorstellen |

### Repairing what the audit found: a campaign can follow its course card (2026-09-15)

The ten-agent audit of this date named one defect as the worst in the product,
and the reading of the code confirmed it exactly. `campaigns.courseVersionId`
is set at create and never moved. `CourseService.approve` archives every
previously approved version of the same `courseKey`. The export gate reads the
version the campaign is pinned to and requires `approved`. So approving one
corrected opleidingskaart froze **every running campaign of that course**, each
refusing to export with *"De opleidingskaart is nog niet goedgekeurd"* — about
a card the user had approved seconds earlier. The only escape was to re-approve
the stale card, which is the opposite of what the product is for.

Two changes, both small, both now held by `course-version-repoint.test.ts`:

**A campaign can catch up.** `CourseService.approvedForSameCourse` resolves the
`courseKey` of any version and returns the approved one.
`CampaignService.repointToCurrentCourse` moves the campaign to it and, in the
same transaction, sets the campaign's briefings and content assets that are
`draft` or `approved` to `needs_rereview`, and writes an audit entry naming the
version it came from and went to. Moving is **not** automatic and not silent:
the briefing quotes facts from the card, so a changed price or date has to be
looked at by a person. A campaign already on the current card returns
`moved: false` and touches nothing; a label with no approved card is refused
with a gate error. Route: `POST /labels/:labelId/campaigns/:campaignId/course-version`,
`campaign:write`.

**The warning that never fired.** `ContentAssetService.flagStaleForLabel` —
written to flag content whose brand or course version is no longer approved,
and documented as "called after a brand or course version is approved" — had
**zero callers anywhere in the repository**. Approved content therefore sat on
an archived version showing *Goedgekeurd* until the export gate refused it for
a reason that pointed at the wrong artefact. It now runs inside both approve
transactions. The dependency runs content → courses/brand, so it arrives as a
callback set in `server.ts` (`useStaleContentFlagger`) rather than as a
constructor argument, and its signature widened from `Db` to `DbOrTx` so the
flag lands in the same commit that archives the version.

A consequence worth naming: the Werkruimte's *"opnieuw beoordelen"* attention
row has existed since the workspace screen did, and until now nothing ever put
a campaign into that state from a course or brand approval. It works for the
first time.

**The report nobody could see.** `GET /labels/:labelId/source-impact` has
answered "a source changed — which campaigns does that touch?" since P4-3 and
was rendered on no screen at all. `WerkruimtePage` now shows it under
**Gewijzigde bronnen**: what changed per source, then the campaigns that rest
on it with a severity badge, their exposure in words, how many findings came
from a changed source, and a link per campaign. It renders only when something
actually changed, and it carries no action button — what to do about a changed
source depends on what changed, and a "fix it" button would invite not reading.

**Three more repairs from the same list.** The briefing is no longer read-only:
`BriefDocument` renders nine narrative sections with a **Bijschrijven** control
that opens a textarea and saves through the PATCH route that had existed since
the brief did and had no caller. Saving stores the next version, so the
existing versioning, review state and re-review rules apply unchanged, and the
control says so. The step bar no longer lies for the entry point the product
pushes hardest: `campaignProgressInput` gains `fromRadar` (defaulted, so every
caller keeps working) and a campaign started from a radar scan counts as having
chosen its direction instead of being told to go and choose one. And
`/resultaten` is a real screen: label-wide lessons split into the approved ones
that colour later proposals and the ones still in concept, each with its thin-
evidence warning and a link to the campaign it came from, plus the campaigns
whose results are recorded. It adds no figure of its own — the numbers are
hand-entered per campaign and a cross-campaign total would suggest a
measurement nobody made. `/kalender` stays honestly marked unavailable until
the calendar is built.

Also repaired, in a file this session does not own: `RadarPage` still passed a
`run` prop to `CompetitorRegistry` after that component was split into a
registry and a separate `CompetitorSuggestions`, which broke the web
typecheck for the whole repository. The caller now renders both, the
suggestions only when a scan exists.

| File | Change |
| --- | --- |
| `apps/api/src/modules/courses/service.ts` | `approvedForSameCourse`; `useStaleContentFlagger` and the call inside `approve` |
| `apps/api/src/modules/brand/service.ts` | `useStaleContentFlagger` and the call inside `approve` |
| `apps/api/src/modules/content-assets/service.ts` | `flagStaleForLabel` accepts a transaction |
| `apps/api/src/modules/campaigns-briefs/service.ts` | `repointToCurrentCourse`; optional audit dependency |
| `apps/api/src/modules/campaigns-briefs/routes.ts` | `POST …/campaigns/:campaignId/course-version` |
| `apps/api/src/server.ts` | audit passed to campaigns; both stale flaggers wired after the content service exists |
| `apps/web/src/api/queries.ts`, `pages/WerkruimtePage.tsx` | `useSourceImpact`; the **Gewijzigde bronnen** card |
| `apps/web/src/components/BriefDocument.tsx`, `pages/CampagneDetailPage.tsx`, `campaign-flow.css` | editable narrative sections wired to the existing PATCH |
| `packages/contracts/src/campaign-progress.ts` and both call sites | `fromRadar`, so a radar campaign has a direction |
| `apps/web/src/pages/ResultatenPage.tsx`, `App.tsx`, `shell/navigation.ts` | the Resultaten screen |
| `apps/web/src/pages/RadarPage.tsx` | reconnected to the split competitor components |
| `apps/api/tests/integration/course-version-repoint.test.ts`, `packages/contracts/tests/campaign-progress.test.ts` | the rules above |

### De schermen opnieuw ingedeeld: kaarten in plaats van stapels (2026-09-15)

De klacht was concreet: kaarten stonden onder elkaar in plaats van naast
elkaar, de gemaakte content in een campagne was niet gesplitst per kanaal, en
de concurrentenlijst zat verstopt in een tab van de Marktradar. Het schermbeeld
bevestigde dat. Gemeten met een volledige paginaschermafdruk op 1440 px:

| Scherm | Hoogte vóór | Hoogte na |
| --- | --- | --- |
| Campagne · stap 6 Content | 5660 px | 2463 px |
| Content Studio | 6080 px | 5622 px, gegroepeerd per kanaal |
| Marktradar · Marktbeeld | 4489 px | 3087 px |
| Campagnes | 3090 px | 2904 px |
| Werkruimte | 2373 px | 1983 px |
| AI Visibility | 2237 px | 1687 px |

Geen enkel scherm laat nog een element horizontaal overlopen, en geen enkel
scherm logt een scriptfout. Wat er is veranderd:

**Sub-navigatie onder Marktradar.** `NavItem` heeft een veld `children`.
Marktbeeld, Bewaarde kansen, Concurrenten en Zoekvragen staan als ingesprongen
links onder Marktradar en openen dezelfde schermtab via `?tab=`. De actieve
staat vergelijkt pad én `tab`, zodat een sub-link alleen oplicht bij zijn eigen
weergave. Beschikbaarheid kijkt naar het pad zonder query, zodat een query een
scherm niet onbeschikbaar maakt.

**Eén kaartvorm voor overzichten.** `.c360-deck` is een raster dat zichzelf
vult (`auto-fill`, minimaal 18 rem) met kaarten van gelijke hoogte;
`.c360-deck__foot` zet de knoppen van elke kaart op dezelfde lijn. De twee
vaste kolommen met `align-items: start` die elk overzicht gebruikte, lieten een
rafelrand achter.

**Content Studio splitst per kanaal.** De 27 stukken staan onder een kop per
kanaal — LinkedIn, Instagram, Website, E-mail, LinkedIn Ads, Meta Ads, Google
Ads — in de volgorde van `CHANNEL_LABEL_NL`, zodat een nieuw kanaal niet stil
uit de groepering valt. De kaart zelf is compacter: titel op twee regels,
tekst op twee, ten hoogste drie beelden in een strook van vaste hoogte, en één
regel met hashtags, beelden en aandachtspunten geteld.

**Marktradar leest als een rapport.** "Sinds de vorige scan" opent met tellingen
per soort verschil en houdt de achttien losse notities één niveau lager. Van de
inzichten opent alleen het gekozen inzicht zijn vijf regels en zijn bronnen; de
rest toont kop plus waarneming op twee regels. Twee tabbladnamen zijn ingekort
zodat de balk op één regel past.

**Campagnes opent met de stand van zaken.** Vier tellingen boven de lijst —
alle, nu aan zet, opnieuw beoordelen, afgerond — die tegelijk het filter zijn,
geteld op dezelfde `progress.state` als de badge in de rij. De kolom Opleiding
is vervallen; opleiding en startpunt staan als één afgekapte regel onder de
naam. De tabel heeft vaste kolombreedtes.

**De briefing heeft een inhoudsopgave.** De zeventien onderdelen staan in één
lijst `BRIEF_SECTIONS`, die zowel de sprongindex links als de secties zelf
voedt; de index kan dus geen onderdeel noemen dat er niet is. Lopende tekst is
begrensd op 70 tekens per regel.

**Kleine defecten verholpen.** De foutzin van een mislukte achtergrondtaak
stond in een kolom van tien tekens en brak op één woord per regel; ze staat nu
op een eigen rij onder de taak. Persona-kaarten vullen hun cel en zetten hun
knoppen op dezelfde lijn. In AI Visibility stonden dezelfde negen bronnen twee
keer in de lijst — als "Zoekbron" en als "Bijgevoegde link"; ze zijn samengevoegd
per URL met beide labels erbij, en het letterlijke antwoord scrollt in een eigen
kader van 22 rem.

| Bestand | Wijziging |
| --- | --- |
| `apps/web/src/shell/navigation.ts` | `children` op `NavItem`; vier sub-links onder Marktradar |
| `apps/web/src/shell/AppShell.tsx` | ingesprongen sub-links; `matchesLocation` vergelijkt pad én `tab` |
| `apps/web/src/shell/shell.css` | `.c360-nav__children`, `.c360-deck*`, `.jobs-table` |
| `apps/web/src/pages/ContentStudioPage.tsx` | groepering per kanaal; compactere kaart; `Disclosure` in plaats van losse `details` |
| `apps/web/src/pages/radar.css` | compacte studiokaart; tellingen en ingekorte inzichtregel |
| `apps/web/src/components/MarketPicturePanel.tsx` | tellingen per verschil; alleen het gekozen inzicht opent |
| `apps/web/src/pages/RadarPage.tsx` | twee ingekorte tabbladnamen |
| `apps/web/src/pages/CampagnesPage.tsx`, `campaigns-list.css` | stand-van-zaken-strook, filter op `progress.state`, vaste kolommen |
| `apps/web/src/components/BriefDocument.tsx`, `pages/campaign-flow.css` | `BRIEF_SECTIONS`, sprongindex, regellengte |
| `apps/web/src/pages/JobsPanel.tsx` | foutzin op een eigen rij |
| `apps/web/src/pages/personas.css` | kaarten van gelijke hoogte, knoppen op één lijn |
| `apps/web/src/pages/GeoPage.tsx`, `ai-visibility.css` | bronnen samengevoegd per URL; antwoord in een eigen kader |

### Marktradar als werkbank: een kolom met weergaven naast één paneel (2026-09-15)

De ingekorte tabbalk hielp niet genoeg. Acht weergaven op één regel pasten nog
steeds niet en braken naar een tweede rij die als een aparte balk las, en een
tabnaam alleen zegt niet wat er onder zit. De radar is nu een werkbank van twee
kolommen.

**Links een kolom met de acht weergaven.** `FlowNavigation` heeft een stand
`vertical`: `role="tablist"` met `aria-orientation="vertical"`, pijl-omhoog en
pijl-omlaag in plaats van links en rechts, en per rij drie dingen — de naam,
één regel die zegt wat de weergave bevat, en hoeveel items erin zitten. De
gekozen rij is een kaart met paarse rand op het oppervlak; de rest is vlak.
Onder de kolom staat **Nieuwe scan instellen** ingeklapt: een instelling, geen
weergave. De kolom blijft staan bij het scrollen.

De acht rijen, in leesvolgorde:

| Weergave | Wat er onder zit |
| --- | --- |
| Marktbeeld | Wat de scan samen betekent |
| Kansen | Voorstellen om iets mee te doen |
| Bewaarde kansen | Jouw shortlist voor deze opleiding |
| Concurrenten | Aanbieders die je volgt |
| Doelgroepen | Wie er in deze markt zoekt |
| Advertenties | Wat anderen adverteren |
| Zoekvragen | Waar mensen op zoeken |
| Scannotities | Wat is gelezen en wat niet |

Concurrenten staat er ook zonder scan; de zeven andere verschijnen pas als er
een rapport is. Dezelfde acht ids blijven de `?tab=`-waarden, dus de sub-links
in het hoofdmenu en bestaande links blijven werken.

**Rechts één paneel van kaarten.** Boven het paneel staat één blok met welke
scan je leest, de teller per soort bevinding en de keuzelijst met eerdere
scans. Daaronder kaarten met ronde hoeken. `.radar-grid` is geen twee vaste
kolommen meer maar een zelfvullend raster met kaarten van gelijke hoogte, zodat
Kansen, Doelgroepen, Advertenties en Zoekvragen dezelfde rand houden.

| Bestand | Wijziging |
| --- | --- |
| `apps/web/src/components/FlowNavigation.tsx` | `vertical`; `count` en `hintNl` op een item; pijltoetsen volgen de as |
| `apps/web/src/components/flow-navigation.css` | `.flow-navigation--rail`, `.flow-rail__text/__hint/__count` |
| `apps/web/src/pages/RadarPage.tsx` | twee kolommen; acht rijen met omschrijving en telling; scaninstellingen onder de kolom |
| `apps/web/src/pages/radar.css` | `.radar-workspace*`, `.radar-scan`, `.radar-panel-head`; `.radar-grid` als zelfvullend raster |

### Van "ziet er af uit" naar bruikbaar: FA-0 tot FA-2 (2026-09-15)

De flowaudit van deze datum vond tien defecten. Zes ervan zaten in de keten
zelf, vier in wat er uit komt. Dit is wat er is gebouwd; de diagnose staat in
`product/flow-audit-2026-09-15.md`, het plan als FA-0…FA-5 in `backlog.md`.

**Goedkeuring is afgeschermd op de campagne.** `approveBrief` zocht de briefing
op `(id, labelId)` en archiveerde daarna op `campaignId`; `concepts.select` had
dezelfde vorm. Een briefing-id van campagne B door de route van campagne A gaf
de vreemde briefing de goedkeuring én haalde die van A weg, waarna A stil
terugviel naar stap 3. Beide resolveren nu ook op de campagne.
`campaign-scoped-approval.test.ts` legt vast dat de onaangeraakte campagne
houdt wat ze had.

**Social beeld is JPEG.** De renderer schreef onvoorwaardelijk PNG terwijl onze
eigen kanaalregistratie voor Instagram `imageFormats: ['jpeg']` zei en de
publicatie-API van Instagram niets anders accepteert. De renderer kent nu een
`encoding`, kiest die uit het register per kanaal, en de opgeslagen `mimeType`
en de bestandsnaam in het pakket volgen de bytes. Een conceptpakket kromp
daarmee van 201 kB naar 172 kB.

**De harde kanaalgrenzen worden gelezen.** `imageFormats`, `maxImagePixels`,
`maxImageBytes` en `altTextMaxChars` stonden in de contracten en werden nergens
geraadpleegd: de poort controleerde of een specificatie geverifieerd was, nooit
of het bestand zich eraan hield. Er zijn twee poorten bij gekomen,
`channel_specs_verified` — de weigering die al bestond maar geen id had en dus
nooit in de checklist stond — en `assets_within_channel_limits`, die per beeld
het formaat, de bytes en de pixels toetst en per item de alt-tekstlengte.

**Content kan worden teruggetrokken.** Er bestond geen enkele verwijderroute,
dus één e-mail of advertentie op een kanaal zonder geverifieerde specificatie
blokkeerde voorgoed elke publicatieklare export. `DELETE …/content/:assetId`
archiveert elke versie van het stuk: de goedkeuringen en eerdere exports blijven
naar iets echts wijzen, en `list` laat gearchiveerde stukken weg.

**Het demo-etiket staat in het bestand.** Productie blijft geweigerd bij
`AI_PROVIDER=mock`, maar in ontwikkeling schreef een publicatieklaar pakket
"Alle controles en goedkeuringen zijn afgerond" zonder een woord over demodata.
De leesmij opent nu met **DEMO — NIET PUBLICEREN** zodra de aanbieder verzint.

**Het kanaalplan wordt waargemaakt.** De kalender zette een publicatiemoment per
stuk, de generatie maakte er precies één per fase en kanaal omdat de assetsleutel
op `-1` vaststond. De sleutel telt nu het stuk binnen zijn cel, de generatie
draait één ronde per gevraagd stuk, en elk gemaakt stuk gaat als context mee naar
het volgende zodat de herhaalcontrole iets te toetsen heeft. De prompt krijgt
`<welk_stuk>` met "stuk 2 van 4". `plan-count.test.ts` legt vast dat een plan met
twee stuks ook twee verschillende stuks oplevert.

**De exportchecklist toont alleen wat de server invult.** Er stonden tien
poortlabels op het scherm terwijl `evaluateGates` er vijf vulde; vijf stonden
dus altijd open, ook op een afgeronde campagne. Het scherm loopt nu
`PUBLISH_READY_GATES`.

**Stap 8 vinkt af.** Het detailscherm zette `hasOutcomes` hard op onwaar terwijl
de lijstroute de echte waarde kende. De detailroute levert hem nu mee. In
dezelfde beweging vinkt stap 2 af voor een campagne die uit een radarscan komt.

**De advertentiekanalen zijn advertenties geworden.** LinkedIn Ads en Meta Ads
leverden koppen en beschrijvingen en verder niets, wat geen advertentie is: Meta
kan niet draaien zonder beeld en LinkedIn noemt het beeld verplicht. Beide zijn
tegen hun eigen platformpagina gelezen op 15 september 2026 en hebben nu een
creatie en gecontroleerde lengtes.

| Kanaal | Beeld | Kop | Tekst | Bron |
| --- | --- | --- | --- | --- |
| LinkedIn Ads | 1200 × 628, 1200 × 1200, 720 × 900; maximaal 5 MB | 200, afgekapt na 70 | 3.000, afgekapt na 150 | linkedin.com/help/lms/answer/a426534 |
| Meta Ads | 1440 × 1800 (4:5); maximaal 30 MB | 27 | afgekapt na 125 | facebook.com/business/ads-guide/image/facebook-feed/ |

Bij Meta geldt telkens de strengste van de twee plaatsingen, want één creatie
draait op de Facebook- én de Instagram-feed. `CHANNEL_CONFIG.version` staat op 9.

**Het hele bericht wordt geteld.** De lengtecontrole mat alleen `copy.body`,
terwijl de hook de eerste regel van het bericht is en de hashtags eronder staan.
Voor de drie berichtkanalen telt nu hook plus tekst plus hashtags; een pagina,
een mail en een advertentie houden hun eigen regels.

**Het websitestuk komt als Markdown mee.** De `.txt` is om te lezen, maar een
wijzigingsvoorstel of artikel moet geplaatst worden en elk CMS neemt Markdown.
De bouwer staat nu in de contracten en voedt zowel de kopieerknop in het scherm
als het bestand in het pakket, zodat die twee niet uit elkaar kunnen lopen.

**Links dragen campagnemarkering.** Geen enkel platform eist het — LinkedIn
noemt trackingparameters uitdrukkelijk optioneel en Google eist alleen dat het
domein van de weergave-URL overeenkomt met de eind-URL — maar zonder markering
komt een klik uit een geëxporteerd bericht binnen als "direct". De export tagt
de link op de weg naar buiten met bron, medium, campagne en het stuk, laat een
link die de marketeer zelf al tagde volledig met rust, en zet in het bestand dat
de markering is toegevoegd en wat de goedgekeurde link was. De opgeslagen
`ctaUrl` verandert niet.

| Bestand | Wijziging |
| --- | --- |
| `apps/api/src/modules/campaigns-briefs/service.ts`, `modules/concepts/service.ts` | goedkeuring en conceptselectie afgeschermd op de campagne |
| `apps/api/src/core/render/renderer.ts` | `encoding`, JPEG via sharp, extensie en mimetype volgen de bytes |
| `packages/contracts/src/channels.ts` | `hardConstraintsFor`, `imageEncodingFor`, geverifieerde specs voor beide advertentiekanalen, versie 9 |
| `packages/contracts/src/workflow.ts` | twee poorten: `channel_specs_verified`, `assets_within_channel_limits` |
| `apps/api/src/modules/exports/service.ts` | grenzen toetsen, demo-etiket, Markdown in het pakket, UTM op de uitgaande link |
| `apps/api/src/modules/content-assets/service.ts` | stuk per cel, `publishedText`, `withdraw` |
| `apps/api/src/modules/content-assets/quality.ts`, `creative.ts` | vormcontrole voor betaalde social, beeld voor beide advertentiekanalen |
| `apps/api/src/core/ai/prompts.ts`, `mock-adapter.ts` | `<welk_stuk>`, en een mock die per stuk anders schrijft |
| `packages/contracts/src/utm.ts`, `content-markdown.ts` | gedeelde bouwers voor markering en Markdown |
| `apps/web/src/pages/CampagneDetailPage.tsx` | eerlijke checklist, `hasOutcomes`, radarcampagne vinkt stap 2 af |

### Het websitekanaal gesplitst (FA-3, 2026-09-15)

`landing_page` droeg twee verschillende dingen: een wijzigingsvoorstel voor de
bestaande opleidingspagina en een nieuw blogartikel. Ze hadden al een eigen
schema, een eigen kwaliteitsmodule en een eigen exportblok, maar deelden één
kanaal — en die gedeelde configuratie beschadigde het artikel: de prompt vroeg
vier tot zeven secties van 60 tot 320 woorden, de poort blokkeerde boven zes of
onder 120. Het systeem bestelde dus een artikel dat het daarna weigerde.

**Twee kanalen, elk met eigen regels.** `course_page_update` en `blog_article`
staan in `PRODUCIBLE_CHANNELS`. De wijziging kent geen paginalengte — haar
eenheid is de ingreep, en elke voorgestelde passage moet minimaal 80 woorden
tellen. Het artikel heeft de lengtes die de prompt werkelijk vraagt: vier tot
zeven secties van minstens 60 woorden, samen minstens 800.

**Het kanaal is voortaan de vorm.** Een stuk dat als wijziging is gevraagd maar
als artikel is geleverd, wordt geweigerd en teruggestuurd. Dat sluit de stille
vervanging die er zat: als de opleidingspagina niet te lezen was, schreef het
model een blog en zei niemand er iets over. Nu blijft het een
wijzigingsvoorstel en draagt het `page_unavailable`, dat een publicatieklare
export blokkeert tot iemand ernaar heeft gekeken. Die waarschuwing is
uitdrukkelijk **niet** herstelbaar: aan een onbereikbare website kan het model
niets doen.

**`landing_page` blijft bestaan, maar is niet meer planbaar.** Van de zes
opgeslagen websiterijen droegen er drie helemaal geen vorm, en er is geen regel
die die achteraf kan indelen. De waarde blijft dus in de woordenlijst, met een
eigen label en specificatie, zodat bestaande stukken leesbaar en exporteerbaar
blijven — maar `PRODUCIBLE_CHANNELS` kent hem niet meer, dus er wordt niets
nieuws op gepland.

Migratie `0028_website_channel_split.sql` verplaatst de rijen die wél een vorm
dragen, in drie tabellen, en laat de jsonb-kolommen met kanaaladvies met rust:
dat is advies óver een kanaal, geen stuk óp een kanaal, en het is veilig juist
omdat de oude waarde geldig blijft. De publicatieregels volgen het stuk waar ze
naar wijzen; uitkomstrapporten zijn cijfers per kanaal zonder stuk om op te
joinen en blijven staan waar ze staan.

| Maat | Vóór | Na |
| --- | --- | --- |
| Kanalen in de woordenlijst | 8 | 10 |
| Produceerbare kanalen | 8 | 9 |
| Maximaal aantal planitems | 24 | 27 |
| Versie van de kanaalconfiguratie | 8 | 10 |

De smoke-keten adviseert nu negen kanalen en levert tien stukken.

### Losse uitingen: content zonder campagne (FA-4, 2026-09-15)

Elk stuk content moest binnen een campagne worden geboren: `campaign_id`,
`brief_version_id` en `concept_version_id` waren alle drie `NOT NULL`. Een
blogartikel dat rechtstreeks uit een AI Visibility-bevinding kwam, kon dus
niet bestaan — het onderzoek schreef er al een, maar die bleef een veld in een
JSON-rapport zonder versie, zonder beoordeling en zonder export.

**Wat een losse uiting behoudt en wat ze loslaat.** Ze houdt een goedgekeurde
opleidingskaart en een goedgekeurd merkprofiel, dezelfde huisstijlcontroles,
dezelfde beoordelingsstaat en dezelfde versiegeschiedenis. Ze laat de briefing,
het concept en het kanaalplan los: dat zijn de drie artefacten die bestaan om
*een campagne* samenhangend te houden. De verankering in opleiding en merk is
precies wat een stuk zonder briefing veilig maakt, en daarom blijven die twee
kolommen verplicht.

**De afspraak staat in de database, niet in elke query.** Migratie
`0029_standalone_content.sql` maakt drie kolommen nullable en voegt
`owner_scope` toe met een CHECK die zegt: `owner_scope = 'campaign'` en een
campagne-id zijn samen waar of samen onwaar. De oude unieke sleutel stond op
`campaign_id` en stopte met werken zodra die leeg mocht zijn — NULL-waarden
botsen nooit — dus is die vervangen door twee partiële indexen, één per soort.

**De herkomst gaat mee.** `origin_kind` en `origin_ref_id` op de rij. Van de
zeven producten die we bekeken, bewaart er geen enkele de herkomst van een
onderzoeksbevinding in de geschreven tekst; in de hele markt is een zoekterm de
volledige lading die de overgang haalt. Bij ons wijst een blogartikel terug
naar het rapport dat het aanleiding gaf.

**Eén keuzescherm, twee deuren.** De knop bij een radarinzicht en bij een
kanskaart heet niet langer "maak campagne van", maar opent een keuze tussen
**Volledige campagne** en **Losse uiting**, met in één zin wat elk betekent.
Dezelfde keuze staat onder een blogvoorstel in AI Visibility. Het dialoogvenster
zet de focus naar binnen, sluit op Escape en op een klik ernaast.

**En het filter "Zonder campagne" is er meteen bij.** Geen enkele leverancier
documenteert een weergave van uitingen die bij geen campagne horen, en dat is
precies hoe een los stuk de dag erna onvindbaar is. De Content Studio krijgt
daarom een eigen schap plus een knop om er een te maken, en werd daarmee van
een leesoppervlak ook een maakoppervlak.

**Later koppelen kan, en is niet vernietigend.** Vanuit het stuk zelf, en alleen
aan een campagne over dezelfde opleiding — koppelen aan een andere opleiding zou
de onderbouwing losmaken van waar het stuk over gaat. Een tweede koppeling wordt
geweigerd in plaats van stil verplaatst, wat HubSpot wél doet.

**Twee grenzen, uitgesproken.** Een losse uiting is voorlopig tekst: een gerenderd
beeld heeft de opmaak van het concept en de kernboodschap van de briefing nodig,
en beeld, animatie en video komen uit het interne gereedschap (Edumotion). En een
AI-herziening wordt geweigerd met een reden: er is geen briefing om tegen te
herschrijven. Met de hand aanpassen werkt wel, en versioneert zoals elk ander
stuk.

| Bestand | Wijziging |
| --- | --- |
| `apps/api/db/migrations/0029_standalone_content.sql` | nullable kolommen, `owner_scope`, herkomst, twee partiële indexen |
| `packages/contracts/src/content.ts` | `contentOwnerScope`, `contentOriginKind`, nullable briefing en concept, invoercontracten |
| `apps/api/src/modules/content-assets/service.ts` | `generateStandalone`, `listStandalone`, `attachToCampaign`; versienummering per soort |
| `apps/api/src/modules/content-assets/routes.ts` | drie routes op labelniveau |
| `apps/web/src/components/StandaloneContentForm.tsx` | het formulier |
| `apps/web/src/components/Modal.tsx`, `modal.css` | het dialoogvenster; focus naar binnen, Escape sluit, focus keert terug |
| `apps/web/src/components/MakeSomethingOf.tsx` | knop, keuze en formulier in één onderdeel, gebruikt door vijf radarweergaven |
| `apps/web/src/pages/ContentStudioPage.tsx` | schap **Zonder campagne**, maakknop, lege staat per schap |
| `MarketPicturePanel.tsx`, `KeywordPanel.tsx`, `AudiencePanel.tsx`, `AdvertisingPanel.tsx`, `pages/RadarPage.tsx`, `pages/GeoPage.tsx` | de keuze op elke plek waar een bevinding iets wordt |
| `apps/web/src/components/AttachToCampaign.tsx` | alsnog koppelen, alleen aan een campagne over dezelfde opleiding |
| `apps/api/tests/integration/standalone-content.test.ts` | maken, bewerken, koppelen, en de geweigerde herziening |

Twee knoppen sloten de ronde af, omdat een route zonder knop geen halve
oplevering mag blijven. **Terugtrekken** staat op elk contentitem van een
campagne, met een bevestiging die zegt wat er gebeurt: het stuk verlaat de
campagne en haar export, de versies en goedkeuringen blijven bewaard.
**Koppel aan campagne** staat onder een losse uiting en biedt alleen campagnes
over dezelfde opleiding aan; de server controleert dat opnieuw. En de lijst
zonder campagne toont één regel per stuk met een uitklap, want de volledige
kaart van een blogartikel is ruim vierduizend pixels hoog en een bibliotheek is
om te vinden, niet om alles tegelijk te lezen.

### "Hier iets van maken" op elke radarweergave (2026-09-15)

Twee dingen die de eerste oplevering van FA-4 nog niet goed deed.

**Het formulier verscheen buiten beeld.** Het werd gerenderd binnen de kaart
waar het verzoek vandaan kwam, en op het tabblad Kansen is dat een smalle
rasterkolom ver boven de vouw: het stond op 153 pixels breed, elfhonderd pixels
boven de zichtbare rand. Klikken leek dus niets te doen. Beide stappen openen nu
in een `Modal` boven de pagina, waar de keuze ook is gemaakt: focus naar binnen
bij openen, Escape sluit, een klik ernaast sluit, en de focus keert terug naar de
knop die het opende.

**De keuze stond maar op twee plekken.** Elke radarweergave eindigt in iets waar
een mens iets mee kan — een inzicht, een kans, een zoekvraag, een
doelgroepbevinding, een advertentie — en vier daarvan boden alleen "maak
campagne". Eén onderdeel, `MakeSomethingOf`, draagt nu de knop, de keuze en het
formulier, en wordt door alle vijf gebruikt. Dat scheelt dezelfde toestandsmachine
op vijf plekken en zorgt dat een verbetering aan één ervan overal landt.

| Weergave | Knop | Wat een losse uiting meekrijgt |
| --- | --- | --- |
| Marktbeeld | Iets maken van dit inzicht | kop, waarneming en betekenis van het inzicht |
| Kansen | Hier iets van maken | de creatieve richting plus de aanleiding bij de bron |
| Doelgroepen | Hier iets van maken | de rol, de organisatie en de gevonden passage |
| Advertenties | Hier iets van maken | de advertentietekst als inspiratie, uitdrukkelijk niet om over te nemen |
| Zoekvragen | Hier iets van maken | de vraag zelf, waarom ze speelt en de gevonden passage |

### Een aangehaalde bron wordt een concurrent, met zijn eigen sociale kanalen (2026-09-15)

De bronnen onder een motorantwoord in AI Visibility zijn de pagina's waarop een
assistent leunde toen hij een vraag over deze opleiding beantwoordde. Een deel
daarvan zijn aanbieders van diezelfde opleiding, en dat is het meest directe
concurrentiebewijs dat het product heeft. Tot nu toe was het een lijst met links
waar niets mee te doen viel.

**Onder elke bron staat nu "Toevoegen als concurrent".** De naam wordt
voorgesteld uit de paginatitel en het domein en is een invulveld, want een
paginatitel is geen organisatienaam. De website is de oorsprong van de bron
zelf, wat een feit is en geen gok. Staat de bron al in de lijst, dan zegt de
regel dat, met de naam waaronder hij bekend is. Die vergelijking loopt op de
hostnaam met een puntgrens, zodat `notvoorbeeld.nl` niet als `voorbeeld.nl`
telt.

En de eigen site wordt herkend. Een assistent die over onze eigen opleiding
antwoordt, haalt onze eigen pagina's aan, en die als concurrent aanbieden is
gewoon fout. De onderzochte opleidingspagina is daarvoor het betrouwbare
signaal op dit scherm; een als eigen merk geregistreerde rij telt ook mee. Van
de negen bronnen onder één antwoord bleken er zo twee van onszelf.

**En een vinkje: ook hun sociale kanalen opzoeken.** Dat is het antwoord op de
vraag hoe je aan die links komt. Wij **lezen hun eigen website** en nemen de
LinkedIn-, Facebook- en Instagrampagina over die zij daar publiceren. De
verleiding is om het model te vragen "wat is de LinkedIn-pagina van X"; dat
levert een zelfverzekerde URL op die van iemand anders kan zijn, en aan het
antwoord is dat niet te zien. Elke link hier komt van een pagina die wij hebben
opgehaald, en die pagina reist mee.

Drie regels maken het bruikbaar in plaats van riskant:

- **Nooit overschrijven wat een mens heeft ingevuld.** Een afwijkende vondst
  wordt gemeld, niet doorgevoerd. In de praktijk gebeurde dat meteen: bij een
  aanbieder stond de vanity-URL ingevuld en publiceerde de site de numerieke
  vorm. Het systeem meldde het verschil en liet de ingevulde waarde staan.
- **Alleen organisatiepagina's.** Een deelknop naar Facebook, het persoonlijke
  LinkedIn-profiel van een medewerker, een losse Instagrampost: geen van drieën
  is het account van de organisatie, en alle drie staan op vrijwel elke pagina.
  Een persoonsprofiel wordt door de vorm van het pad geweigerd, dus komt er geen
  genoemd persoon in een concurrentprofiel terecht. `social-discovery.test.ts`
  legt dat vast.
- **Begrensd.** Ten hoogste twee pagina's per organisatie: de opgegeven URL en
  de sitewortel, want de voettekst draagt meestal de links. Een crawler is een
  ander product met andere verplichtingen. Een pagina die niet te lezen was,
  wordt gemeld: "niets gevonden" en "niet kunnen kijken" zijn verschillende
  antwoorden.

Dezelfde knop staat in de Concurrenten-weergave bij elke aanbieder, zodat een
rij die al bestond alsnog zijn kanalen kan krijgen.

| Bestand | Verantwoordelijkheid |
| --- | --- |
| `apps/api/src/modules/competitors/social-discovery.ts` | links uit HTML halen, organisatiepagina's onderscheiden van deelknoppen, ten hoogste twee ophaalacties |
| `apps/api/src/modules/competitors/service.ts` | vullen wat leeg is, melden wat afwijkt, nooit overschrijven |
| `apps/api/src/modules/competitors/routes.ts` | `POST /labels/:labelId/competitors/:id/socials` |
| `apps/web/src/components/AddSourceAsCompetitor.tsx` | de knop onder een aangehaalde bron, met het vinkje |
| `apps/web/src/components/CompetitorRegistry.tsx` | dezelfde actie per bestaande concurrent |
| `apps/api/tests/unit/social-discovery.test.ts` | deelknoppen, persoonsprofielen en losse posts blijven buiten |

---

## De interface volgt het label — 15 september 2026

Het volledige herontwerp uit het handoffpakket is gebouwd. De regel die de hele
inrichting bepaalt:

> **De platformkleuren volgen het gekozen label.**

Elk label krijgt zijn palet uit zijn eigen goedgekeurde merkprofiel. Een label
zonder goedgekeurd profiel valt terug op het Certify360-huispalet, en de
interface benoemt dat — in de labelschakelaar, in de PALET-kolom van Labels &
toegang en in het contextpaneel van een campagne.

De volledige referentie staat in `product/design-system-2026.md`. Hieronder wat
er in de code veranderde en waarom.

### Het palet reist met de labellijst mee

Een nieuw veld `palette` op `labelSummary`, nullable, gelezen uit de
*goedgekeurde* merkprofielversie:

| Bestand | Rol |
| --- | --- |
| `packages/contracts/src/labels.ts` | `labelPalette` en het nullable veld |
| `apps/api/src/modules/organizations-labels/repository.ts` | `findApprovedColorsByLabelIds` — één query voor de hele schakelaar in plaats van één per label |
| `apps/api/src/modules/organizations-labels/service.ts` | `paletteOf` **parseert** de opgeslagen JSON; een profiel met een andere vorm levert `null` |
| `apps/web/src/shell/LabelTheme.tsx` | schrijft de variabelen op `:root` |

Omdat de kleuren al in de lijst zitten, hertint de interface bij een
labelwissel in één frame. Er is geen merkquery die eerst moet landen, dus geen
flits naar het huispalet en terug. `null` betekent hier "geen goedgekeurd
profiel", niet "geen kleur bekend": het verschil is precies wat de interface
moet kunnen zeggen.

### Twee kleurregels die niet gebroken mogen worden

**Een merkkleur is gekozen voor druk, niet voor 12px interfacetekst.**
`#00A894` op wit haalt 2,99:1. `readableOnWhite` in
`packages/ui/src/label-theme.ts` verdonkert stap voor stap tot 4,6:1. Daarom
bestaat `--lp-solid` naast `--lp`: elk gevuld vlak dat tekst draagt gebruikt de
eerste, balken en markers de tweede. Wie een gevulde knop `background: var(--lp)`
geeft, zakt onder 4,5:1.

**De ring om het actieve railitem mag niet uit `--lp` komen.** De rail is
`--lp-shell`, afgeleid van de inkt van het merk. Lindenhaeghe gebruikt
`#183B3E` voor primary én ink; een markering uit de primary zou daar onzichtbaar
zijn. `--lp-active` valt in precies dat geval terug op de accentkleur, gemeten
in plaats van aangenomen.

### De oude tokennamen zijn blijven bestaan

`packages/ui/src/tokens.css` houdt elke `--c360-*`-naam en zet hem door naar de
nieuwe laag. Veertienduizend regels schermcode volgen daarmee het label zonder
te zijn aangeraakt. Dat is een keuze, geen tijdelijke shim: een scherm hoort
niet te weten of een kleur het huisviolet is of de eigen primary van een label
— het vraagt om "de actiekleur" en krijgt wat het goedgekeurde merkprofiel van
het geselecteerde label daarover zegt.

### De letters staan op onze eigen oorsprong

Drie merkletters in `apps/web/public/fonts/`, gedeclareerd in
`apps/web/src/fonts.css`. Geen verbinding met een lettertype-CDN: zo'n verzoek
draagt het IP-adres en de verwijzer van de bezoeker naar een derde partij bij
elke paginalading, en deze applicatie toont labelmateriaal aan genoemde
collega's. At Gambit — de displayletter — is **niet** meegeleverd: het merk
reserveert hem voor externe communicatie, dus zou elke gebruiker betalen voor
een download die geen scherm gebruikt.

### Drie layoutpatronen, geen vierde

`apps/web/src/shell/shell.css` draagt ze alle drie plus het vocabulaire dat de
schermen delen. A is overzicht, B is lijst+detail, C is rail+werkvlak+context.
Een scherm dat een vierde nodig heeft, is een scherm dat niet heeft besloten
waar het voor is; dat is een besluit, geen bewerking.

Onder 1180px geeft de contextkolom haar plaats op en verschijnt er een
Context-knop in de stapkop; onder 900px wordt lijst+detail één kolom. Gemeten
bij 1100px en 820px: geen horizontale overflow, werkvlak 812px — ruim boven de
460px-ondergrens.

### Wat bewust niet is overgenomen

- **Een zoekveld dat campagnes en bronnen doorzoekt.** Er is geen zoekendpoint.
  Het veld zoekt schermen en zegt dat: "Ga naar…" met ⌘K. Een gebied dat niet af
  is, staat in de lijst met zijn reden en is niet te kiezen.
- **De vaste aantallen uit de ontwerpteksten.** Elk aantal in de interface is een
  `length` over rijen die bestaan. Op AI Visibility betekent dat: "9 bronnen, 18
  vermeldingen, 0 met citaatlink" is drie berekeningen, niet drie getallen in de
  opmaak. Een getal dat niemand kan narekenen hoort niet op een scherm dat over
  bewijs gaat.

### Het browserscript volgt de schakelaar

`tools/ui-smoke/index.ts` koos het label via `selectOption` op een `<select>`.
De schakelaar is een menu geworden, omdat een label kiezen de hele interface
hertint en het menu de kleuren toont vóór je kiest. Het script klikt nu op de
chip en kiest het `menuitem`; de actieve label-id leest het waar de applicatie
hem bewaart.

---

## Werk dat doorloopt terwijl jij verdergaat — 16 september 2026

Drie dingen die bij elkaar horen: een losse uiting wordt niet meer in het
verzoek geschreven, een beeldkanaal krijgt echt beeld, en de shell zegt wanneer
achtergrondwerk is geland.

### De losse uiting staat in de wachtrij

`POST /labels/:labelId/content/standalone` gaf de uiting terug. Schrijven duurt
minuten, en voor een beeldkanaal komen daar twee renders bij; de aanvrager hield
al die tijd een open verbinding vast. De route zet nu een taak in de wachtrij en
antwoordt met een `JobSummary`.

| Laag | Bestand | Wat erbij kwam |
| --- | --- | --- |
| Contract | `packages/contracts/src/jobs.ts` | `content.standalone` in `jobType` én in `IMPLEMENTED_JOB_TYPES`. Een drifttest vergelijkt die lijst met het register van de worker, dus een type zonder handler kan niet stilletjes ontstaan |
| Worker | `apps/worker/src/handlers/generation.ts` | De handler. Het resultaat draagt `assetId`, `channel` en de hook, zodat de melding naar het stuk zelf kan linken |
| Route | `apps/api/src/modules/content-assets/routes.ts` | Enqueue in plaats van genereren; 202 met de taak |
| Kosten | `apps/api/src/modules/jobs-usage/generation-jobs.ts` | Twee aanroepen (tekst plus één herstelronde) en twee renders voor een beeldkanaal |
| Interface | `apps/web/src/components/StandaloneContentForm.tsx` | Na *Maak deze uiting*: een vinkje, de zin dat je verder kunt en dat je bericht krijgt, en daarna sluit het venster zichzelf |

### Een beeldkanaal krijgt beeld

Een losse uiting werd opgeslagen met `withImage: false`, omdat de renderlaag
haar layout en artdirectie van het gekozen concept las en een los stuk dat niet
heeft. Een Instagram-bericht zonder beeld is geen Instagram-bericht.

`storeVersion` neemt nu een **descriptor** in plaats van een concept: layout,
artdirectie, het idee, de visuele intentie, de kernboodschap en de reikwijdte.
Een campagnestuk vult die uit zijn concept en zijn goedgekeurde briefing; een
los stuk uit de eigen opdrachtzin van de aanvrager en de opleidingskaart.

Dat is het verschil met de voor de hand liggende oplossing. Een verzonnen
conceptobject doorgeven zou een `concept_version_id` hebben weggeschreven die
naar een rij wijst die niet bestaat. Nu blijven `concept_version_id` en
`brief_version_id` netjes leeg, precies omdat er niets is om naar te wijzen.

Welke kanalen beeld dragen staat sinds vandaag in de contracten
(`IMAGE_CHANNELS` in `packages/contracts/src/channels.ts`) in plaats van in de
renderlaag, want het formulier dat om één stuk vraagt moet dezelfde vraag kunnen
beantwoorden vóórdat er iets wordt gemaakt. Twee lijsten zouden ooit uit elkaar
lopen, en de lijst die de gebruiker las zou de verkeerde zijn.

### De shell meldt wat er klaar is

`apps/web/src/shell/BackgroundWork.tsx` leest de takenlijst die het
achtergrondtakenpaneel toch al ophaalt en toont rechtsboven wat er is geland,
met een link naar het resultaat. Een geslaagde taak maakt bovendien de caches
ongeldig die haar uitkomst dragen — dat is hier bekend en nergens anders, dus
zonder dat zou de link naar een lijst leiden die het stuk nog niet bevat.

De Marktradar-scan opent voortaan als venster in plaats van als lade in de rail:
het is een besluit met vier keuzes en een prijs. Zodra hij loopt sluit het
venster, want de scan draait op de worker en de melding komt vanzelf.

### Content Studio: volgorde en datum

De bibliotheek staat standaard op **nieuwste eerst** — het stuk dat je zojuist
hebt gevraagd is het stuk waarvoor je terugkomt. *Oudste eerst* en *Per kanaal*
staan ernaast; die laatste is de oude rangschikking, die je wilt als je een
reeks doorwerkt. Elke rij draagt zijn datum, zodat de volgorde te controleren is.

---

## Geen call to action in een beeld dat niemand kan aanklikken — 16 september 2026

De renderlaag zette in elk beeld een call to action met een pijl. Op een
organische post is de afbeelding geen link: erop tikken opent de post, en de
bestemming staat in het bijschrift, de eerste reactie of het profiel. "Bekijk de
opleiding →" in zo'n beeld is dus een instructie die de kijker niet kan opvolgen,
met een pijl die nergens heen wijst. Een betaalde single image is wél het
klikdoel, en daar hoort hij.

| Laag | Bestand | Wat er veranderde |
| --- | --- | --- |
| Contract | `packages/contracts/src/channels.ts` | `CLICKABLE_IMAGE_CHANNELS` en `imageIsClickable` — op dit moment alleen `linkedin_ads` en `meta_ads` |
| Contract | `packages/contracts/src/content.ts` | `renderSpec.ctaText` is nullable |
| Render | `apps/api/src/core/render/layouts.ts`, `creative-layouts.ts` | Geen tekst, geen pijl en geen gereserveerde ruimte als er geen call to action is; het woordmerk blijft, want merkaanwezigheid belooft geen link |
| Service | `apps/api/src/modules/content-assets/service.ts` | `ctaText: imageIsClickable(channel) ? copy.ctaText : null` |
| Test | `apps/api/tests/unit/render-layout.test.ts` | Per layout: de tekst en de pijl verdwijnen samen, de kop blijft staan, en het blijft een echt bitmap opleveren |

Het is een **redactionele regel van dit product**, geen geciteerde
platformspecificatie: het gaat over wat wij bereid zijn in een beeld te tekenen,
en het is bewust de voorzichtige kant van de vraag. De call to action zelf
verdwijnt niet — die staat in de tekst, waar hij wél te volgen is.

## Wat je met een beeld doet, staat op het beeld — 16 september 2026

`apps/web/src/components/AssetImage.tsx` legt bij aanwijzen (en bij
toetsenbordfocus) een donkere laag over een gerenderde variant met drie acties.
De bewoording houdt twee dingen uit elkaar, omdat ze verwarren de tijd van een
collega kost:

- **Downloaden** geeft het **bestand**, op de maat van het kanaal, met een
  bestandsnaam uit de titel van het stuk. Dat is wat in een post gaat.
- **Delen** stuurt een **link naar dit stuk in Marketing OS**. Alleen iemand met
  toegang tot dit label kan die openen. Teams en Outlook openen met het bericht
  klaar; versturen doet de persoon zelf. Het paneel zegt dit met zoveel woorden,
  want een deelknop die een link oplevert die de ontvanger niet kan openen, is
  een gebroken belofte.

De acties zijn echte links en knoppen in de tabvolgorde, dus een
toetsenbordgebruiker bereikt ze zonder aanwijsapparaat; op een aanraakscherm
staat de laag permanent onderaan het beeld.

---

## Drie vragen die het product zelf stelde — 16 september 2026

### Waar deze doelgroep zich oriënteert, als eigen veld

`persona_versions.orientation_sources` bestond al en is het veld waarop het
kanaaladvies leunt: een verdicht mag worden verschoven op een **onderbouwde**
uitspraak, nooit op een aanname. Er waren twee gaten. Het stond als vier woorden
onderaan de facetten, wat niet de plek is waar iemand "welke kanalen bereiken
deze persoon" zoekt. En een persona die met de hand is geschreven of uit een
document is geïmporteerd had het leeg, zonder manier om het te vullen.

| Laag | Bestand | Wat erbij kwam |
| --- | --- | --- |
| Prompt | `apps/api/src/core/ai/prompts.ts` | `persona.orientation`: uitspraken over gedrag met een kanaal uit onze eigen woordenlijst, geciteerd uit het materiaal of als aanname gemarkeerd |
| Contract | `packages/contracts/src/personas.ts` | `personaOrientationProposal` |
| Service | `apps/api/src/modules/personas/service.ts` | `fillOrientation`: leest hetzelfde materiaal als de vragenlijst, **voegt toe en overschrijft nooit**, en haalt de onderbouwing weg van een bron die niet in dat materiaal zat |
| Job | `packages/contracts/src/jobs.ts`, `apps/worker/src/handlers/generation.ts` | `persona.fill_orientation` |
| Scherm | `apps/web/src/pages/PersonasPage.tsx` | Een eigen sectie met per uitspraak het kanaal en *onderbouwd* of *aanname* |
| Met de hand | `apps/web/src/components/PersonaEditor.tsx` | Het kanaal is nu een keuze. Dat was het nooit: de editor schreef altijd `null`, dus een handgeschreven persona kon geen enkel kanaaladvies verschuiven |
| Test | `apps/api/tests/integration/persona-orientation.test.ts` | Een handgeschreven uitspraak overleeft, een verzonnen bron wordt een aanname, en tweemaal drukken voegt niets toe |

### Dertien kernvragen in plaats van zesendertig

De volledige vragenlijst is het juiste diepteniveau zodra een persona ertoe doet,
en de verkeerde plek om te beginnen: wie het product wil testen moet eerst
zesendertig vragen beantwoorden voordat er iets bestaat.
`PERSONA_CORE_QUESTION_IDS` in `packages/contracts/src/persona-questionnaire.ts`
benoemt de dertien waaruit de persona feitelijk wordt geschreven — naam,
behoefte, motivatie, drempels, keuzecriteria en kanalen komen hier vandaan
(`personaFromQuestionnaire`).

Wie, in welke organisatie · doel en probleem · de aanleiding · het bezwaar en de
beschikbare tijd · budget, betaler en beslisser · de drie zwaarste criteria en
het echte alternatief · via welk kanaal ze het onderwerp tegenkomen · en hun
eigen woorden.

Twee soorten vragen staan er bewust níet in. q07–q09 (leeftijd, regio,
persoonlijke omstandigheden), omdat een persona uit gedrag wordt opgebouwd en
niet uit demografie. En q36 (wat is onderbouwd en wat is aanname), omdat het
systeem dat per antwoord vastlegt in plaats van het aan iemand te vragen.

De overige drieëntwintig verdwijnen niet: ze blijven open, en het systeem kan ze
later uit het eigen materiaal van het label invullen. Elke kernvraag draagt in
het scherm één zin over waarom zij er staat.

### Wat een marktscan gaat zoeken

`radarScanFocus` in `packages/contracts/src/radar.ts` geeft de scan drie standen
in plaats van één:

| Stand | Wat er gebeurt |
| --- | --- |
| `market` | De brede blik die de radar altijd deed: concurrerende opleidingen, organisaties met dezelfde doelgroep, primaire vakinformatie. Een markt is meer dan haar aanbieders, dus de zoekacties worden verdeeld |
| `providers` | Alle zoekacties gaan naar organisaties die deze opleiding of een gelijkwaardige aanbieden, ook onder een andere term, met een ruimere paginalimiet — anders vind je aanbieders en lees je er vijf |
| `competitors` | Er wordt niets gezocht. De opgeslagen concurrenten worden opnieuw gelezen, wat je wilt als de lijst vaststaat en de vraag is wat er op hún pagina's veranderde |

Twee dingen die de scan over zichzelf zegt en blijft zeggen: een
aanbiederszoektocht is een **steekproef van het openbare web**, geen register —
wie niet in de zoekresultaten stond, staat hier niet, en dat bewijst niet dat die
er niet is. En een concurrentenscan zegt niets over wie er nog meer is.

De route weigert een `competitors`-scan zonder opgeslagen concurrent met een
bronlink, want dan is er letterlijk niets te lezen; en zij weigert zo'n scan
níet meer wanneer webzoeken onbeschikbaar is, want die scan zoekt toch niet.

---

## Een gateway voor de modellen: LiteLLM — 16 september 2026

`AI_PROVIDER=litellm` stuurt dezelfde twee aanroepen naar een LiteLLM-proxy in
plaats van rechtstreeks naar OpenAI. Geen tweede adapter: het is dezelfde HTTP-
interface, dus wat verschilt is de basis-URL, de sleutel — en wat het product
mag *beweren*. De afweging staat in `decisions/ADR-0019-litellm-gateway.md`.

### Vier variabelen

```
AI_PROVIDER=litellm
LITELLM_BASE_URL=https://llm.intern        # zonder pad
LITELLM_API_KEY=sk-…                       # de virtual key van de proxy
AI_TEXT_MODEL=team-default                 # de alias die de proxy kent
```

De adapter plakt er zelf `/v1/responses` en `/v1/images/generations` achter, de
twee endpoints die hij ook bij OpenAI aanroept. In productie weigert het opstarten
een `http://`-URL: prompts, documenttekst en de sleutel gaan hier overheen.

### Wat níet automatisch meekomt

| Onderwerp | Gedrag |
| --- | --- |
| Webzoeken | `AI_WEB_SEARCH_ENABLED`, **standaard uit** achter een gateway. `web_search` is een tool die OpenAI host; een proxy geeft hem alleen door als het model erachter hem heeft. Het product weigert marktontdekking dan eerlijk (`canDiscover` → `capability_unavailable`) in plaats van de aanroep te laten mislukken. Geeft jouw proxy hem wél door: zet hem op `true` |
| Prijs | `AI_TEXT_PRICE_INPUT_CENTS_PER_MTOK` en `_OUTPUT_`, in eurocent per miljoen tokens — beide of geen van beide. Zonder blijft het bestaande gedrag: een onbekend model reserveert een bewust hoge plaatshouder en meldt **geen** werkelijke kosten in plaats van een verzonnen bedrag |
| Werkelijke kosten | `x-litellm-response-cost` is in **dollars**; elke kolom hier is in eurocent. Met `AI_COST_USD_TO_EUR_RATE` wordt het cijfer van de proxy de geboekte werkelijke kost — die kent de echte inkoopprijs beter dan onze tabel. Zonder koers wordt de header genegeerd |
| Beelden | Mag nu ook via een gateway; de controle bij het opstarten eiste eerder `AI_PROVIDER=openai` |
| In het grootboek | `litellm`, niet `openai`. Een gebruiksregel zegt door welke deur de aanroep ging, en dat zijn verschillende leveranciers |

### Bestanden

| Bestand | Rol |
| --- | --- |
| `packages/config/src/env.ts` | De variabelen, de opstartcontroles en `OPENAI_COMPATIBLE_PROVIDERS` |
| `apps/api/src/core/ai/openai-adapter.ts` | `endpointFor(env)` lost basis-URL, sleutel, claims en prijs op; `gatewayCostCents` leest de kostenheader |
| `apps/api/src/core/ai/index.ts` | `openai` en `litellm` krijgen dezelfde provider |
| `apps/api/tests/unit/env-guards.test.ts` | De opstartcontroles |
| `apps/api/tests/unit/openai-adapter.test.ts` | De aanroep, de kostenomrekening en de capaciteitsvlag |

---

## Een gevonden aanbieder is nu een aanbieder die je kunt opslaan — 16 september 2026

De scan meldde "nieuwe aanbieder gevonden" en er was niets om op te klikken.
Drie oorzaken, alle drie weg:

| Waar | Wat er mis was | Nu |
| --- | --- | --- |
| Concurrenten-weergave (`CompetitorRegistry.tsx`) | De lijst las alleen `audience.competitors` — de aanbieders die de *doelgroepanalyse* toevallig noemde. Een scan die vier aanbieders ontdekte en hun opleidingspagina's las, toonde die als kanskaarten en bood geen enkele manier ze te bewaren | De lijst voegt de gelezen pagina's (`cards` met `relationship: 'competitor'`) samen met de doelgroepbevindingen, ontdubbeld op bron-URL, elk met de herkomst erbij |
| Kanskaart (`RadarPage.tsx`) | Een kaart over een aanbieder is het meest directe concurrentiebewijs dat een scan oplevert, en je kon hem alleen lezen | Dezelfde knop als onder een aangehaalde bron in AI Visibility: `AddSourceAsCompetitor`, met de eigen-site-controle en het vinkje om sociale kanalen op te zoeken |
| Contextkolom | "Aanbieders (geciteerd)" stond in een kolom waar je niets kunt doen | Weg. "Onze opleiding (gecontroleerd)" blijft: dat is waar je de citaten tegen afzet |

### De scope van een concurrent is een keuze geworden, geen plaats

`courseVersion.courseKey` staat sinds vandaag op het contract
(`packages/contracts/src/courses.ts`). Dat klinkt klein en loste dit op: de
editor kon alleen de opleiding aanvinken die je toevallig in beeld had, met de
tekst "kies bovenaan deze pagina een opleiding om een koppeling toe te voegen".
De reikwijdte van een aanbieder hing dus af van waar je stond. Nu staan alle
opleidingskaarten van het label er als lijst, met twee duidelijke keuzes: *alle
opleidingen* of *alleen wat ik kies*. Koppelingen aan een opleiding die het
label niet meer toont, blijven staan en worden gemeld.

### De relatie is altijd te wijzigen

`kind` — concurrent of eigen merk — was alleen in te stellen bij het *aanmaken*
en daarna alleen leesbare tekst. Een aanbieder die een zustermerk blijkt, of een
overname, moest dus worden verwijderd en opnieuw ingetypt. Het is nu een keuze,
ook bij bewerken; de optie *eigen merk* verschijnt alleen wanneer het label er
nog geen heeft, of wanneer dit profiel het al is.

### Eén knop die één vraag stelt

Het tabblad **Concurrenten** heeft nu bovenaan een eigen knop: *Concurrenten
zoeken*. Hij stelt de vraag waarvoor het tabblad bestaat — wie biedt deze
opleiding nog meer aan — en doet daarvoor precies dat en niets anders.

De mogelijkheid zat er technisch al in: `radarScanFocus` kende `providers`
naast `market` en `competitors`. Maar die focus veranderde alleen waar de scan
naar zócht; daarna draaide dezelfde brede analyse eroverheen. Vier extra
modelaanroepen per veegbeurt — doelgroeponderzoek, zoekvragen, advertenties en
het marktbeeld — voor uitkomsten die op dit tabblad niemand had gevraagd. Een
gerichte aanbiederszoektocht slaat die nu over
(`apps/api/src/modules/market-radar/service.ts`, `providerSweep`).

Wat overblijft is de kern: zoeken, de gevonden opleidingspagina's lezen, en per
bron beoordelen of het een aanbieder is, met de passage erbij. De gevonden
partijen komen op dezelfde plek terecht als altijd — de kansenkaarten en de
suggestielijst, elk met *Toevoegen als concurrent*.

Twee dingen zijn met opzet niet geërfd van het scanvenster. De knop zet
`discover` zelf aan: zoeken ís de opdracht, en een schakelaar die iemand eerder
in het venster had uitgezet zou de veegbeurt stil veranderen in een scan die
niets vindt. En advertenties, zoekvragen en handmatige bronnen gaan er niet in
mee — daar vraagt de knop niet om.

Wat het rapport zegt als het iets oversloeg, is nu ook waar. Het lege
doelgroepverslag droeg de zin "Geen leesbare bronnen voor doelgroeponderzoek",
en dat was onjuist: de bronnen waren er en gelezen, we hadden er alleen geen
vraag over gesteld. Bij een aanbiederszoektocht staat er nu *Overgeslagen*, en
bovenaan de notities één regel die opsomt wat er niet is gedaan en hoe je het
alsnog krijgt.

Onder de knop staat wat de uitkomst wél en niet is: een steekproef van het
openbare web, geen register. Een aanbieder die niet in de zoekresultaten stond,
staat er niet — en dat bewijst niet dat die er niet is. Zonder webzoeken bij de
ingestelde AI-provider is de knop uitgeschakeld met die reden erbij, in plaats
van een zoekopdracht die stil niets oplevert.

`apps/api/tests/integration/market-radar.test.ts` legt het vast: bij focus
`providers` blijven `keywords`, `advertising` en `insights` leeg, blijft het
doelgroepverslag leeg mét de juiste reden, wordt er precies één modelaanroep
gedaan, en worden de kaarten gewoon gemaakt.

### Een test die geen fout meldde die er niet was

`apps/api/tests/integration/generated-visuals.test.ts` rendert echte PNG's op
1536×1024, meerdere per geval. Alleen draaiend duurt het eerste geval ~10
seconden; tijdens `npm run verify`, met 87 andere testbestanden op dezelfde
kernen, 31–34. Dat ging over de limiet van 30 seconden heen, en de time-out zág
eruit als een logische fout: het afgebroken geval liet de content op een oudere
versie staan, waarna de vier revisiegevallen erachter struikelden over
`conflict` in plaats van over wat ze beweren. Zes rode tests in een bestand dat
alleen 11 van de 11 haalt.

De grens staat nu op twee minuten, in het bestand zelf zodat hij ook geldt als
je het vanuit `apps/api` draait. Dat is ruimte voor een rasteriser onder
belasting, niet voor trage code: een echt vastlopende test faalt nog steeds,
alleen later. `npm run verify` is hiermee weer groen over de hele repo — 88
bestanden, 817 tests.

## Display banners: een korte reeks, uit de campagne geschreven — 16 september 2026

Eén boodschap, meerdere formaten, en per formaat de bestanden waar een banner
uit bestaat: index.html, style.css, main.js en de bestanden ernaast.
Wat die bestanden doen is een reeks — een loader, één tot drie schermen die elk
één ding zeggen, en een stilstaand eindbeeld met de knop dat de rest van de
vertoning blijft staan.

`packages/contracts/src/display-banner-screenplay.ts` ·
`packages/contracts/src/display-banners.ts` ·
`apps/api/src/modules/display-banners/` ·
`apps/web/src/components/DisplayBannerStudio.tsx`

### Twee keer verkeerd begonnen, en wat dat leerde

De eerste versie leverde **één zelfdragend HTML-bestand** per formaat. Dat maakte
de rekensom over bestandsgewicht makkelijk, en het maakte de uitkomst iets wat
niemand kan openen, aanpassen of aan een mediabureau geven. Gewicht wordt
sowieso ná gzip gemeten en een ZIP comprimeert vier bestanden net zo goed als
één, dus er was niets gewonnen.

De tweede fout zat in het ontwerp zelf: kop, ondersteunende regel en knop
tegelijk in beeld, met wat beweging eroverheen. Dat is een poster. Een banner
die als bureauwerk leest is een reeks.

Wat dat rechtzette is een echte, uitgeleverde banner die in
`reference-banners/zorgverzekeraar-300x600/` bewaard wordt: een 300x600 van een
Nederlandse zorgverzekeraar. Enabler, GSAP met SplitText, Montserrat als
fontbestand, een achtergrondfoto, een logo-plaat, een roterende USP-lijst, een
`textFitter()` en per formaat eigen tekst. De structuur hier is die structuur,
expliciet gemaakt.

### De reeks

`bannerScreenplay` is wat de banner zegt, in de volgorde waarin hij het zegt:
schermen van soort `hook` (de aanleiding), `proof` (het aanbod) en `usp` (een
korte lijst die één voor één langskomt — de truc uit de referentiebanner om vier
pluspunten in de ruimte voor één te krijgen), plus de knoptekst, een hoekje en de
kleine lettertjes.

Het eindbeeld draagt de **proof**-regel, niet de hook. Een hook is een vraag, en
een banner die de rest van de vertoning op een vraag blijft staan komt er nooit
aan toe te zeggen wat hij verkoopt.

Hoeveel schermen een formaat krijgt, beslist het formaat: een staand formaat van
600 pixels hoog krijgt er drie, een kleine rechthoek twee, een liggende strip
één. Een reeks in een strip leest als geflikker, wat de tekst ook zegt.

### Het rustpunt is het eindbeeld

De stylesheet beschrijft de banner zoals hij eruitziet als de animatie klaar is.
Het script zet vóór de eerste tekening één klasse op `<html>`, en dat is wat de
schermen verbergt zodat ze kunnen binnenkomen; gaat er iets mis, dan haalt het
die klasse weer weg. De faalstand van de animatie is dus een correcte stilstaande
banner in plaats van een lege rechthoek — en dat is meteen wat de meeste
vertoningen te zien krijgen.

### Zonder foto is het frame zijn eigen vlak

Ook een tussenversie die niet deugde: met de merksurface als achtergrond was een
300x600 twee derde wit met een zin onderin, wat eruitziet als een banner die niet
is ingeladen. Zonder achtergrondbeeld vult een merkvlak het frame nu, en de knop
draait om naar de surfacekleur — dezelfde twee kleuren andersom, geen derde die
niemand heeft goedgekeurd.

Een gegenereerde achtergrond hoort hier; de screenplay draagt er al een
briefing voor (`backgroundBriefEn`, in het Engels omdat de beeldmodellen daarop
getraind zijn). Beeldgeneratie staat in deze omgeving uit, en het rapport zegt
dat met zoveel woorden in plaats van te doen alsof er een plaatje mislukte.

### Uit de campagne, niet uit een leeg formulier

`POST /labels/:id/campaigns/:id/display-banners/propose` leest de goedgekeurde
briefing, de doelgroepen die in stap 1 zijn gekozen en de richting uit stap 4, en
schrijft daar de reeks uit (prompt `banner.screenplay` v1). Getallen, prijzen,
examens en accreditaties mogen alleen uit de opleidingskaart komen, en het schema
heeft nergens een veld om iets anders in te zetten.

Wat terugkomt is een **voorstel**: het vult de velden en iemand leest en
corrigeert het. Dat is geen beleefdheid — een banner draait weken onbeheerd op de
pagina's van anderen, en het enige wat een slechte regel daar tegenhoudt is dat
iemand hem heeft gelezen. De versies waarop het voorstel rustte reizen mee, zodat
een banner later tegen zijn briefing te controleren is.

### Het model schrijft de code niet

Het levert tekst, en hoogstens een keuze tussen bewegingspatronen met een naam.
De markup, de stijlen en de tijdlijn komen uit sjablonen die wij hebben
geschreven en kunnen nalezen. Dit stond al zo in het pilotplan en is hier
structureel gemaakt: een banner is uitvoerbare code die op de pagina van een
ander draait, en "het model heeft het gemaakt" is geen review.

### De getallen, en waar ze vandaan komen

| | Bron |
|---|---|
| Google Ads: ZIP ≤ 600 kB, ≤ 40 bestanden, alleen `.css .js .html .gif .png .jpeg .svg` | [specificatie](https://support.google.com/google-ads/answer/1722096?hl=en) |
| Google Ads: geen fontbestanden, geen niet-Google letters, geen `<iframe>`, geen `<audio>`/`<video>`, geen opslag-API | [beleid](https://support.google.com/adspolicy/answer/15576219?hl=en) |
| Google Ads: klikdoel komt uit de campagne; "your entire ad will be clickable" | [foutpagina](https://support.google.com/google-ads/answer/6335679?hl=en) |
| Bestandsgewicht per formaat, **na gzip** — 150 kB voor 300x250, 50 kB voor 320x50 | IAB New Ad Portfolio, vaste formaten |
| Animatie ≤ 4,5 s, geen herhaling | WCAG 2.2.2 grijpt pas boven vijf seconden; Chrome lost een advertentie op boven 15 s hoofdthread-CPU per 30 s |

De formatenlijst is de doorsnede van wat Google Ads ondersteunt en wat twee
Nederlandse uitgevers aannemen (Mediahuis Nederland en Ster). Ster staat in het
contract als formatenreferentie en uitdrukkelijk niet als kanaal: hun
display-inventaris is beperkt tot publieksboodschappen en verbiedt elke oproep om
je in te schrijven.

Elk formaat wordt als eigen ZIP geleverd, want dat is de eenheid die een
advertentieplatform aanneemt — één creative per plaatsing, geen archief met zes.
Dezelfde bestanden staan er uitgepakt naast om te lezen.

### GSAP en SplitText zitten in het pakket

Standaardlicentie zonder kosten van 30 april 2025: commercieel gebruik vrij,
inclusief de plug-ins die vroeger alleen voor leden waren — SplitText dus ook —
en geen naamsvermelding vereist. De verleende rechten zijn letterlijk "use,
reproduce, display, and implement"; meeleveren valt daaronder. De enige
verplichting die ons raakt is dat eigendomsvermeldingen er niet uit mogen, dus
`gsap-runtime.ts` controleert bij het lezen of het `/*! …` blok er nog staat en
weigert te bouwen als het weg is.

Let op wie de licentiepagina naleest: de oude "Plain English Summary" — met de
regel dat eindgebruikers niets in rekening mag worden gebracht — staat nog in de
HTML van die pagina, binnen commentaartekens, en wordt niet getoond. Elk
gereedschap dat tags stript haalt die dode tekst weer boven alsof hij geldt.

Gemeten: `gsap.min.js` 72.927 bytes (28.314 gzip), `SplitText.min.js` 7.732
(3.658 gzip). Een complete 300x250 met beide erin is 34,7 kB gzip van de 146 kB
die IAB voor dat formaat aanhoudt. Op 320x50 is het budget 49 kB en zou de
bibliotheek twee derde kosten — dat formaat animeert met CSS en komt uit op
3,0 kB.

### De letter is het lastigste punt

Google Ads accepteert geen fontbestand in het pakket — het staat niet eens in de
lijst met toegestane bestandstypen — en "using non-Google fonts" is een genoemde
afkeuringsgrond. Daar bovenop komt een licentievraag die los van het platform
speelt: een fontbestand meesturen in een pakket dat naar een advertentienetwerk
gaat is herdistributie, en een desktoplicentie dekt dat doorgaans niet.

Beide problemen verdwijnen met dezelfde ingreep: de kop omzetten naar
vectorcontouren, want dan is het tekening en geen font meer. Dat is precies wat
de commerciële platforms doen — bij The Brief heet de instelling letterlijk
"Convert custom fonts to SVG". Die stap is **nog niet gebouwd** (DB-1). Tot dan:
een familie die op Google Fonts staat wordt als zichzelf gebruikt (Plus Jakarta
Sans bijvoorbeeld), en een familie die er niet op staat valt terug op een
systeemletter **met een luide notitie** in het rapport en een oranje badge in het
scherm. Wat niet gebeurt, is stil een andere letter gebruiken.

### Wat de controles wel en niet zeggen

`preflight.ts` meet de gebouwde bestanden tegen de regels hierboven: grootte,
aantal bestanden, gewicht na gzip, de `ad.size`-meta, de aan- of afwezigheid van
een eigen uitgang, de bestandstypen, en het ontbreken van iframe, media,
opslag-API's, `document.write` en externe verwijzingen. Die laatste worden gemeten
op de markup en op ons eigen script, nooit op de meegeleverde bibliotheek: GSAP's
broncode noemt elke optie die hij kent, en een bibliotheek die het woord
`localStorage` bevat is geen advertentie die opslag gebruikt.

Ze zijn geen goedkeuring, en het rapport zegt dat met zoveel woorden. Eén ding
kunnen we van hieruit sowieso niet zien: Google Ads laat dit advertentietype
alleen toe bij een account dat ouder is dan 90 dagen en meer dan $9.000 levenslang
heeft besteed, na aanvraag. Een pakket dat elke controle haalt kan daarop alsnog
stranden.

### Leestijd wint van de vijf-secondengrens

De eerste versie gaf elk scherm 1.150 ms en hield het geheel onder vier en een
halve seconde, zodat WCAG 2.2.2 niet zou aangrijpen. Dat was de verkeerde
afweging: drie schermen in die tijd geeft elk scherm ongeveer een seconde, en de
USP-lijst propte er ook nog drie punten in — 383 ms per punt. Onleesbaar.

De tijden komen nu uit leessnelheid: een geschreven regel krijgt 1.900 ms, een
punt uit een roterende lijst 950 ms. Een reeks van drie schermen loopt daarmee
over de vijf seconden heen, dus de banner krijgt een **pauzeknop** — dat is wat
WCAG 2.2.2 vraagt, en het kost ongeveer een kilobyte. Het plafond blijft vijftien
seconden (IAB, en ruim onder Chrome's heavy-ad-grens); een reeks die daaroverheen
zou gaan wordt als geheel vertraagd, zodat het laatste scherm nooit het scherm is
dat wegvalt.

De pauzeknop staat boven de kliklaag, zodat pauzeren niet óók doorklikken is, en
verdwijnt bij `prefers-reduced-motion` omdat er dan niets te pauzeren valt.

Ook gerepareerd: de punten in de lijst stonden absoluut op elkaar en de volgende
kwam op terwijl de vorige nog wegfadete, dus je zag twee regels door elkaar. De
uitgaande tween eindigt nu precies waar de inkomende begint.

### De merkletter reist mee waar dat mag

Voor de eigen site is het probleem opgelost: de goedgekeurde merkfonts gaan als
bestand mee in het pakket, met `@font-face` in de style.css van de banner. Dat is dezelfde bron
die de beeldrenderer gebruikt, en de familienaam komt uit het fontbestand zelf —
niet uit het merkprofiel, want een bestand waarvan de interne naam niet
overeenkomt past de browser niet toe, en stil terugvallen op een systeemletter is
precies wat we willen voorkomen.

Drie dingen bleken nodig, en het derde was de echte fout.

Het ontwerp gebruikte vier snedes (400, 500, 600, 700) en elke snede is een heel
fontbestand: zeven meegeleverde bestanden brachten een 300x250 op **359 kB gzip
tegen een budget van 146 kB**, en de gewichtscontrole sloeg terecht aan.

Een font declareert vaak méér dan één familienaam — het semibold-bestand van dit
merk heet zowel "Behind The Nineties Semibold" als "Behind The Nineties" — en de
eerste versie nam simpelweg de eerste naam. Daardoor matchte een bestand de
merkfamilie per ongeluk wel of niet. Er wordt nu op elke gedeclareerde naam
gematcht, en het bestand wordt geregistreerd onder de naam die de stylesheet
noemt.

**En het merk heeft twee families, niet één.** De koppen staan in *Behind the
Nineties*, een display-schreefletter; de lopende tekst in *Euclid Square*. De
stylesheet zette de kopfamilie op het body-element en niets overschreef dat ooit,
dus stond een hele banner in de display-letter — de ondersteunende regels, de
pluspunten, de kleine lettertjes. Nu draagt het pakket één snede per familie: de
display-letter op 700 voor de kop, het eindbeeld, de knop en de sticker, en de
tekstletter op 400 voor al het andere. Twee bestanden, en geen snede die de
browser zelf moet namaken.

En de afweging is per formaat, want de budgetten verschillen: een 300x600 heeft
244 kB en een mobiele strip 49 kB. Een paar commerciële snedes is samen ruim
zeventig. Waar het niet past valt dát formaat terug op een systeemletter **met de
reden erbij** — liever een banner in de verkeerde letter dan een banner die
niemand aanneemt. In de praktijk: 300x250, 300x600 en 728x90
dragen beide merkletters op 143 kB, 320x50 niet.

Die 143 van 146 kB is krap: er is bijna geen ruimte over, en een groter logo
breekt het. Zolang de snedes niet gesubset zijn is dit het plafond.

Wat dit definitief oplost is subsetting: de snedes terugbrengen tot de tekens die
een banner werkelijk gebruikt, wat een Latijnse snede doorgaans naar enkele kB's
brengt. Dat is DB-1, samen met de vectorcontouren die Google Ads sowieso nodig
heeft — daar mag een fontbestand helemaal niet mee.

Wat we **niet** weten is of de fontlicentie van de klant insluiten in
advertentiemateriaal toestaat. Het rapport zegt dat met zoveel woorden bij elk
pakket dat een fontbestand draagt.

### De pluspunten stapelen

Ze wisselden elkaar af, één voor één op dezelfde plek. Wie halverwege opkeek had
de eerdere gemist en kon er niet meer bij. Ze bouwen nu onder elkaar op en
blijven staan, zodat het scherm eindigt als een lijst die je in één keer leest.
Dat kost tijd — 420 ms per punt plus 1.300 ms om de lijst te lezen — en die tijd
is precies waarom de pauzeknop er is.

### Passen we het, of denken we dat we het passen?

`tools/banner-fit` (`npm run banner-fit -- <labelId>`) vraagt de draaiende API om
een set, opent elk formaat in een browser, wacht op de letters en vraagt aan elk
tekstelement of het buiten zijn doos valt, buiten de banner valt, onder de
leesbaarheidsgrens zit of iets anders raakt. Via de API en niet via de bouwer,
want de echte merkfonts en het echte logo zijn nu juist waar passingsproblemen
zitten.

Wat het meteen opleverde, en wat je met tekens tellen nooit had gezien:

De tekenbudgetten en de lettergroottes waren twee losse tabellen die uit elkaar
waren gelopen. Het budget zei dat een regel paste terwijl de browser hem 25
pixels buiten de banner duwde. Ze zijn opnieuw afgeleid uit de gerenderde doos —
bruikbare breedte ÷ (lettergrootte × 0,52) — en de 160x600 kreeg 16px in plaats
van 21px, want "verzuimdossier?" is vijftien tekens die op één regel van 136
pixels moeten passen.

De sticker op de 160x600 stond op 11px, onder de leesbaarheidsgrens van 12. Die
is daar weg: een rondje van 55 pixels in een kolom van 160 was toch al te veel.

En het gereedschap had zelf twee fouten, die het eerlijk gezegd bewijzen:
aanvankelijk mat het alle schermen tegelijk en verzon zo achtenveertig botsingen
tussen schermen die nooit samen te zien zijn; en het meldde een constante "10px
te hoog" die SplitText bleek te zijn, dat de woorden al had opgesplitst vóór de
meting. De gemeten kopie draait daarom geen script.

De derde les zat in de laatste twintig meldingen: een letter waarvan de
glyph-doos hoger is dan zijn regelhoogte loopt over zijn contentdoos heen en
rendert perfect, want niets knipt hem af. Het gereedschap meldt een overloop nu
alleen als er werkelijk iets afknipt — het loopt de ouderketen af tot aan de
banner en kijkt naar `overflow`. De regelafstand staat op 1,18 omdat dat er goed
uitziet, niet omdat een meting het afdwong.

### Wat er nog niet is

De tekstpassing is voorlopig: er wordt geteld in regels en tekens per regel, met
een aparte controle op het langste woord — want `herkansingsmogelijkheid` is
drieëntwintig tekens die niet kunnen breken, en daar ziet een gemiddelde
overheen. De eerlijke versie meet de werkelijk getekende regel in een browser
nadat de letter is geladen (DB-2). Zichtbaar in de praktijk: op 160x600 brak een
kop van 33 tekens naar vier regels terwijl het budget drie zei.

### Een uitvoerlimiet die zich voordeed als een onbruikbaar model — 16 september 2026

`AI_MAX_OUTPUT_TOKENS` stond op 4096. De sjablonen met de grootste uitvoer
liepen daartegenaan, en de melding die iemand te zien kreeg was *"Het antwoord
van de AI-aanbieder was onbruikbaar"* — wat naar het model wees terwijl de
instelling van ons was.

Het bewijs staat in `usage_records`: `brief.draft` kwam uit op **4032** tokens
en haalde het met vierenzestig tokens over, `persona.fill_questionnaire` (36
antwoorden) haalde het bij geen van de drie pogingen. Eén meting bevestigde het:
hetzelfde verzoek geeft `status=incomplete` met reden `max_output_tokens` bij
4096, en `status=completed` bij 16000.

De adapter deed het goede: een afgebroken antwoord is een mislukking, geen half
resultaat, dus er werd niets opgeslagen. Wat eromheen zat deugde niet. Drie
dingen zijn veranderd:

De limiet staat op 16000. Het is een plafond en geen uitgave — er wordt betaald
voor de tokens die werkelijk worden geproduceerd — en 4096 kostte juist geld:
elke afgekapte poging was een volle aanroep die werd weggegooid, drie keer per
job.

Een afgekapt antwoord zegt nu dát het afgekapt is. `AiInvalidOutputError` draagt
een `truncated`-vlag en de melding luidt dat de uitvoerlimiet is geraakt en dat
opnieuw proberen tegen dezelfde grens loopt. Onderscheid dat ertoe doet: bij
elke andere onbruikbare uitvoer is opnieuw proberen zinvol, hierbij niet.

En `.env.example` draagt de reden mee, zodat de volgende omgeving niet opnieuw
op een te krappe waarde wordt gezet.

**Beeldgeneratie staat los hiervan en staat uit.** `AI_IMAGE_ENABLED` ontbreekt
in `.env` en is standaard `false`; het laatste `ai_image`-gebruik dateert van 15
september 22:05. Dat is een keuze, geen storing — aanzetten begint echte uitgaven
per beeld.

### `hidden` betekende niet verborgen — 16 september 2026

De funnelfases in stap 6 hadden tabs, en die filterden niets: op elk tabblad
stonden alle drie de fases. De oorzaak lag niet in de tabs maar in één CSS-regel.

De browser verbergt een element met `hidden` via `display: none`, maar op
user-agent-gewicht. Elke eigen regel die `display` zet, wint daarvan. De panelen
waren geschreven als `<div className="c360-stack" hidden>`, en `.c360-stack` zet
`display: flex` — dus het paneel bleef staan. Twee plekken in de applicatie
hadden dit al lokaal gerepareerd met een eigen `[hidden]`-regel; de derde plek
had die niet, en daar was het zichtbaar kapot.

`packages/ui/src/design-system.css` regelt het nu voor de hele applicatie:

```css
[hidden] { display: none !important; }
```

Dat is de enige regel in de huislaag met `!important`, en die verdient het: er
is geen ontwerp waarin iets dat als verborgen is gemarkeerd zichtbaar hoort te
zijn, en het alternatief is deze fout één keer per component terugvinden.

### En een tabblad "Alles"

Stap 6 opent nu op **Alles** en toont de drie fases onder elkaar; een fase
aanklikken beperkt de weergave tot die fase. Wie net een hele funnel heeft
gemaakt wil die funnel zien, en de drie fasenboodschappen naast elkaar lezen is
hoe je merkt dat er twee hetzelfde zeggen.

Zwaar is dat niet: elke fase opent onder zijn eigen tegels één kaart tegelijk,
dus "Alles" is drie kaarten en geen twaalf. Alle fases blijven gemonteerd, zodat
een half getypte bewerking en een geladen e-mailvoorbeeld een tabwissel
overleven.

Één paneel om alle fases heen in plaats van één per fase: met "Alles" staan er
meerdere tegelijk op het scherm, en meerdere elementen die elk beweren *het*
paneel van één tabblad te zijn is niet wat een tablist betekent.

### Eén pagina, één voorstel — 16 september 2026

Twee dingen klopten niet aan de voorgestelde wijzigingen voor de opleidingspagina.

**Het blok zei niet wat je moest schrijven.** Het begon met de passage die nu op
de pagina staat, en zette de nieuwe tekst daaronder — zonder label, in dezelfde
stijl. Het voorstel las daardoor als een vervolg op het citaat in plaats van als
vervanging ervan. Iemand die de wijziging moet doorvoeren wil de zin om te
plakken; de oude passage is hoe je de plek terugvindt, en de reden is waarom je
de moeite zou nemen. Die volgorde staat er nu: **Schrijf dit**, de tekst, de
kopieerknop, dan *In plaats van wat er nu staat* met het citaat, en als laatste
de reden.

**En de pagina werd drie keer gepland.** `course_page_update` stond in alle drie
de funnelfases als "aanbevolen", elk met een eigen reden. Een volledige funnel
leverde dus drie losse wijzigingssets voor dezelfde pagina op. Voer je ze alle
drie door, dan blijft de pagina achter in de staat die het laatst is toegepast —
de voorstellen spreken elkaar per constructie tegen.

Het advies per fase was niet fout: elke fase wil werkelijk iets anders van die
pagina. De fout zat in de vorm. De oplevering is al een lijst wijzigingen, elk
met een eigen plaats en reden, dus wat de fases vragen hoort in één voorstel te
staan. De pagina is nu aanbevolen in één fase — overwegen, waar ze het meeste
werk doet — en mogelijk in de andere twee, met een reden die zegt waarom.

`planProblems()` bewaakt het als regel: een plan dat de pagina meer dan één keer
bevat wordt geweigerd, met de fases erbij en met de zin dat de andere fases hun
wijziging in datzelfde voorstel krijgen.

Dat is een echte regel en geen advies, en dat is hier het onderscheid waard.
Overal elders in dit product is een oordeel advies en blijft de keuze van de
persoon — een ontraden vakje mag je aanvinken, met het advies ernaast. Hier gaat
het niet om smaak: twee wijzigingssets voor één pagina kunnen niet allebei worden
toegepast, en één ervan verdwijnt stil. Een tegenstrijdigheid weiger je; een
mening niet.

Zichtbaar effect: de volledige-funnelketen maakt nu acht stukken in plaats van
tien.

## Eén tekst, alle doelgroepen die erin staan — 17 september 2026

Persona-onderzoek beschrijft zelden één persoon. Het CROV-materiaal noemt een
HR-adviseur, een casemanager bij een arbodienst, een zij-instromer, een
leidinggevende en een arbeidsdeskundige — en eindigt met de opmerking dat
daar drie tot vijf subpersona's uit te halen zijn.

De extractie deed dat niet. De prompt zei letterlijk: *"Bij meerdere doelgroepen
neem alleen de eerste duidelijk beschreven doelgroep en benoem die beperking bij
q36."*

Dat was de verkeerde helft van een goed instinct. Verschillende mensen
samenvoegen tot één fictieve persoon is werkelijk slecht — maar het antwoord op
meerdere doelgroepen is meerdere persona's, niet één en een excuus.

### Wat er nu gebeurt

`personaTextExtraction` draagt een lijst. Elke persona heeft een eigen naam in
de woorden die de tekst zelf gebruikt, een zin die zegt waarin deze zich van de
andere onderscheidt, een eigen set antwoorden en eigen citaten. Die laatste
regel is wat ze uit elkaar houdt: de letterlijke-fragmentcontrole draait per
persona, dus een citaat dat bij de zij-instromer hoort kan niet stilletjes onder
de leidinggevende belanden.

Het samenvoegverbod staat er nog, scherper dan eerst: twijfel je of twee
beschrijvingen dezelfde persoon zijn, houd ze dan samen.

Twee voorstellen die inhoudelijk vrijwel gelijk zijn, zijn één persona die het
model in tweeën heeft geknipt. De bouwer vergelijkt ze en zegt het — goedkoper
dan iemand beide laten opslaan en later ontdekken dat hun campagnes identiek
zijn.

### De kaart vulde zichzelf niet helemaal

Twee velden op de campagnekaart konden niet uit de vragenlijst komen en werden
daarom nooit ingevuld.

De **naam** was het antwoord op q01, de rol. Bij één persona valt dat niet op;
bij vijf uit dezelfde tekst heten ze dan allemaal naar hun functie en lezen ze
hetzelfde. De naam komt nu van het model, uit de woorden van de tekst.

De **relatie met de opleiding** was een vaste zin: "moet nog worden
gecontroleerd". Dat is geen uitspraak over deze doelgroep, en hij stond er bij
elke persona. Het model schrijft hem nu, en de opleidingskaart reist mee zodat
hij ergens op rust. Staat er in die kaart niets over, dan blijft de eerlijke
zin staan in plaats van dat er iets wordt verzonnen.

De kaart wordt verder nog steeds zonder modelaanroep uit de vragenlijst gebouwd,
en dat blijft zo: dan kan hij niets beweren wat de antwoorden niet zeggen. Wat
de tekst niet zegt, blijft "Nog onbekend — aanvullen bij controle".

### In het scherm

Alle voorstellen staan onder elkaar, elk met een vinkje. *In formulier
overnemen* opent er één om aan te sleutelen, zoals eerst. *Aangevinkte persona's
opslaan* bewaart de aangevinkte concepten ongewijzigd — een tekst met vijf
doelgroepen is anders vijf keer een formulier invullen.

Opslaan gebeurt één voor één en stopt bij de eerste weigering; wat al bewaard
is, is bewaard, en het scherm zegt hoeveel.

Gemeten op het echte CROV-materiaal: vijf persona's, elk met een eigen
onderscheid en 9 tot 14 van de 36 vragen ingevuld uit de tekst.

## Een losse uiting schrijf je voor iemand — 17 september 2026

Een losse uiting is de snelle weg: geen campagne, geen flow, één blog, mail of
advertentietekst. Die weg liep alleen langs de doelgroep heen. In
`generateStandalone` stond letterlijk `personas: []` in de promptcontext, dus
elke losse uiting werd geschreven voor de opleiding in het algemeen — terwijl er
persona's klaarstonden die voor campagnes wél worden meegegeven. Hetzelfde
model, dezelfde opleiding, maar de ene tekst wist voor wie hij was en de andere
niet.

### Wat er nu gebeurt

In het formulier staat een veld **Voor welke doelgroep?**, met de persona's van
het gekozen label erin en "Geen specifieke doelgroep" als standaard. Kies je er
een, dan reist de persona mee tot in de prompt: naam, behoefte, bezwaren,
motivatie — dezelfde kaart die een campagne gebruikt.

De keuze blijft optioneel. Een losse uiting is soms juist algemeen, en een veld
dat je moet invullen om iets kleins te maken haalt de snelheid eruit die het
hele scherm bestaat om te leveren.

### Waarom het een id is en geen tekst

Het formulier stuurt een `personaVersionId`, geen naam en geen omschrijving. De
server zoekt die op binnen het label van de aanvraag; hoort hij daar niet,
dan volgt een weigering (`persona_version niet gevonden`) en geen stille val
terug op "dan maar zonder doelgroep". Een id van een ander label mag geen tekst
opleveren die eruitziet alsof hij klopt, en wat de client meestuurt over wie
iets is, is nooit het bewijs dat hij het mag gebruiken.

De gekozen persona wordt ook vastgelegd op de bewaarde uiting
(`personaVersionIds`), zodat later te zien is waarvoor een tekst geschreven is.
Zonder dat is een losse uiting een tekst zonder herkomst, en dan is de enige
manier om erachter te komen: opnieuw lezen en raden.

De taak zelf accepteert het veld als optioneel met `null` als standaard, dus
opdrachten die al in de wachtrij stonden voordat dit bestond blijven gewoon
draaien.

### Gecontroleerd

Twee integratietests: een uiting die met een gekozen doelgroep wordt gemaakt —
waarbij wordt nagegaan dat naam en behoefte van die persona daadwerkelijk in de
modelcontext terechtkomen en dat de bewaarde uiting de persona noemt — en een
uiting met een persona van een ander label, die wordt geweigerd.

## Eén uiting als één document — 17 september 2026

Content leefde alleen in het product. Wilde je een collega laten zien wat er
gemaakt is, dan stuurde je een link — en dan had die collega een account, een
label en een scherm nodig — of je plakte de tekst in een mail, en onderweg viel
alles eraf wat er omheen stond: voor wie het geschreven was, wat je gevraagd
had, welke versie het is en dat een model het schreef.

Elke uiting is nu te downloaden als **Word** of **PDF**: één document met de
hele vastlegging.

### Wat erin staat, in deze volgorde

1. **Waar dit over gaat** — label, opleiding met code, kanaal, funnelfase,
   doelgroep, campagne of "losse uiting", wie het maakte met naam en e-mail,
   wanneer, versie, status en of het door AI of door een mens geschreven is.
   Daaronder in kleine letters wat de status betekent, en hoeveel
   aandachtspunten er zijn.
2. **Voor wie dit geschreven is** — de persona, volledig: samenvatting,
   behoefte, drijfveren, drempels, keuzecriteria, relatie met de opleiding,
   oriëntatie per kanaal met bron of de melding dat het een aanname is,
   aannames, onderbouwing, en de beantwoorde vragen uit het doelgroeponderzoek
   met het bronfragment erbij. Was er geen doelgroep gekozen, dan staat dat er,
   in plaats van een lege sectie.
3. **Wat er gevraagd is** — de opdracht, letterlijk zoals hij is ingevoerd.
4. **De uiting** — de tekst in de vorm die het kanaal echt heeft: een blog in
   leesvolgorde met titel, direct antwoord, intro, secties, de bruggenzin op de
   plek waar hij hoort, voorbeeldsituatie, FAQ en afsluiting; een
   paginawijziging als "schrijf dit / in plaats van dit / waarom"; een
   advertentie als koppen, beschrijvingen en zoektermen; een post of mail als
   openingsregel, tekst, hashtags en call to action.
5. **Aandachtspunten en herkomst** — de kanaalcontrole, en de versies waaruit
   dit stuk is voortgekomen: opleidingskaart, merkprofiel, briefing, concept,
   persona's, promptversie en de interne id.

### De opdracht werd niet bewaard

De zin die je typt bij een losse uiting ging het model in en werd daarna
weggegooid: hij stond alleen in de wachtrijregel van de taak die de uiting
schreef, en dat is werkgeheugen, geen vastlegging.

Migratie `0030_content_instruction.sql` voegt de kolom toe en haalt hem terug
waar dat kan — niet door te reconstrueren, maar omdat de taakregel de
letterlijke zin bevat en het resultaat de id van de uiting die eruit kwam.
Daarna wordt hij doorgegeven aan elke volgende versie: een handmatige aanpassing
en een AI-herziening schrijven allebei een nieuwe rij, en geen van beide
verandert wat er gevraagd was. Op de ontwikkelomgeving kwamen zo 2 van de 4
bestaande losse uitingen weer aan hun opdracht; bij de rest is de taakregel
opgeruimd en zegt het dossier dat de opdracht niet is vastgelegd.

### Waarom het twee bestanden zijn en één model

`modules/content-assets/dossier.ts` bepaalt de inhoud — één pure functie,
zonder bestandsformaat in zicht. `core/render/dossier-docx.ts` en
`core/render/dossier-pdf.ts` bepalen alleen hoe een kop eruitziet, nooit of er
een kop is. Anders zit een correctie in de ene vorm wel en in de andere niet.

Word omdat mensen er iets mee dóen: een alinea overnemen, de persona
doorsturen, in de tekst strepen. PDF omdat je die verstuurt en hij er bij
iedereen hetzelfde uitziet.

### Twee dingen die eerlijk moesten blijven

Het lettertype van een standaard-PDF kent Nederlands volledig, maar geen pijl,
vinkje of emoji. In plaats van een Unicode-lettertype in de bundel te leggen
(een megabyte, plus een licentievraag) worden die tekens omgezet naar hun
gewone equivalent — een pijl wordt `->` — en wat overblijft wordt weggelaten
**met een melding op de eerste pagina**: hoeveel tekens, en dat de Word-versie
de tekst ongewijzigd bevat. Een stille vervanging in een document waaruit
geciteerd wordt, is precies wat je niet wilt.

En het dossier wordt per aanvraag gebouwd, niet opgeslagen. Een persona wordt
herzien, een uiting wordt goedgekeurd; een bewaard bestand zou de dag erna al
iets anders beweren dan het product, en niemand zou weten welke van de twee
klopt.

### Grenzen

Het document is een weergave, geen goedkeuring — dat staat er ook in. Beelden
bij een uiting zitten er niet in; die staan bij de uiting in het systeem. En de
tekst is niet extern geverifieerd: cijfers, voorwaarden en erkenningen horen
tegen de bron gecontroleerd te worden voordat er iets mee naar buiten gaat.

## Wie deze doelgroep heeft gemaakt — 17 september 2026

Een persona bepaalt waar elke campagne, elk stuk content en elke kanaalkeuze op
mikt. Zegt er een iets verrassends, dan is de vraag altijd dezelfde: wie heeft
dit geschreven, en waarop?

Het antwoord stond er al. Elke bewerking, elke door AI ingevulde vragenlijst,
elke overname in de bibliotheek en elke goedkeuring schreef een rij weg mét
auteur en tijdstip — vanaf de eerste versie van het product. Alleen kon je het
niet lezen: de lijst toont de nieuwste versie per doelgroep, en alles daarachter
was vastgelegd en onzichtbaar. Dat is voor iedereen die geen SQL schrijft
hetzelfde als niet vastgelegd.

### Wat het scherm nu toont

Boven aan een doelgroep staat **Herkomst**: aangemaakt door wie en wanneer,
laatst gewijzigd door wie en wanneer, goedgekeurd door wie en wanneer. Daaronder
is de volledige lijst uit te klappen: elke versie met wat het wás (uit een tekst
gehaald, door AI voorgesteld, vragenlijst aangevuld, met de hand aangepast,
overgenomen in de bibliotheek), wie het opsloeg, welke prompt eraan te pas kwam,
en **welke velden verschillen van de versie ervoor**.

Dat laatste wordt vergeleken, niet opgeslagen. Zou elke schrijfweg zelf moeten
noteren wat er veranderde, dan levert de weg die het vergeet een versie op die
eruitziet alsof er niets gebeurd is. Vergelijken kan dat niet vergeten. Het zegt
ook precies wat het kan zien: *dat* de behoefte veranderde, niet of het een
verbetering was.

Een auteur wiens account is verwijderd leest als "Onbekende gebruiker" en een
rij van voor deze vastlegging als "Niet vastgelegd" — dat een wijziging is
gedaan door iemand die we niet meer kunnen noemen, hoort in het spoor thuis.

### Wat onderweg aan het licht kwam

De service kon een persona goedkeuren sinds de eerste versie: hij zet de
reviewstatus en schrijft een goedkeuringsrij die aan precies die versie hangt.
Alleen riep niets die aan. Er was geen route en geen knop, dus **geen enkele
doelgroep in het product kon worden goedgekeurd** en het recht `persona:approve`
gaf niets. Dat viel op doordat de tegel "Goedgekeurd door" nooit gevuld kon
raken.

Nu bestaat de route en staat de knop in het scherm, voor de rollen die het recht
al hadden. De goedkeuring hangt aan de versie en niet aan de doelgroep: v2
goedkeuren zegt niets over v3 — daar is het versienummer op een goedkeuring voor.

### Ook in het dossier

Het downloadbare dossier van een uiting noemt bij de doelgroep nu ook wie die
heeft vastgelegd. Een dossier wordt buiten het product gelezen, waar "wie heeft
dit bedacht" niet aan te klikken is.

### Kosten

Eén verzoek per doelgroep, opgehaald wanneer het paneel in beeld is en niet bij
de lijst — een overzicht toont er tientallen. Binnen dat verzoek drie queries:
de versies, de mensen, de goedkeuringen. Een doelgroep met negen versies zou
anders negentien queries zijn voor een paneel dat niemand twee keer opent.
