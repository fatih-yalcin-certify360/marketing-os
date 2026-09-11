# Certify360 Marketing OS

An AI-native Marketing Operating System for Certify360: research, personas,
campaigns, content production, approval, activation, measurement and
multi-label operation in one place.

**Current state: Phase 0 (foundation) plus the Phase 1/2 campaign chain are
complete and runnable.** A campaign can be walked end to end today — brand,
course card, personas, opportunity, brief, approval, concepts, content plan,
per-channel copy, two rendered image variants, editing, approval and export.
What works is listed under [What works now](#what-works-now); everything else
is marked unavailable in the interface rather than stubbed to look finished.

---

Marktradar is available at `/radar`: live web discovery, source-backed opportunities, page-image references and a selected creative approach carried into a new campaign. See [the CROV pilot and validation](docs/pilot/crov/market-radar-mvp-tr.md). Role/sector evidence can seed campaign-specific personas with a frozen source snapshot. Google samples include up to two source-backed competitor domains; Google and Meta library samples include course-matched ad text, screenshots and source links; LinkedIn access failures are shown explicitly. Install the worker browser with `npx playwright install chromium` (Linux: `npx playwright install --with-deps chromium`).

## Quick start

Two options. Both give you a real PostgreSQL.

### Option A — Docker (recommended; matches production)

```bash
cp .env.example .env
docker compose up --build          # postgres + migrate + api + worker
npm ci
npm run db:seed                    # clearly-labelled demo data
npm run dev:web                    # http://localhost:5173
```

### Option B — no Docker

`tools/dev-db` runs PostgreSQL compiled to WebAssembly (PGlite) behind the real
PostgreSQL wire protocol, so `pg` and `psql` connect to it normally. It exists
so a missing Docker install never blocks local development.

```bash
cp .env.example .env
# point DATABASE_URL at the dev database:
#   DATABASE_URL=postgresql://c360:c360@127.0.0.1:5433/postgres
# (this is what .env.example ships with, so usually there is nothing to change)
npm run dev:db                    # terminal 1 - listens on 5433
npm run db:migrate && npm run db:seed
npm run dev:api                    # terminal 2
npm run dev:worker                 # terminal 3
npm run dev:web                    # terminal 4 -> http://localhost:5173
```

> **Limitation, stated plainly:** the dev database accepts several client
> connections, but **executes queries one at a time** against a single PGlite
> instance. Everything works, including the API and worker together — but
> genuine lock contention cannot occur, so anything touching concurrency or
> performance must be tested against Option A. See
> [docs/product/testing-strategy.md](docs/product/testing-strategy.md).

### Try it

Open <http://localhost:5173>. You are signed in as the local development test
identity — the top bar says so.

**Walk a whole campaign** (the demo seed gives the pilot label an approved
brand profile and a *Wft Basis (Demo)* course card):

1. **Campagnes → Nieuwe campagne** — pick the course, choose what the campaign
   must achieve (*Hele funnel* walks all three stages), keep *Ik heb nog geen
   idee* under *Wat heb je al?*, accept the suggested name, start.
2. **1. Doelgroepen** → *Doelgroepen voorstellen*. You get **two**, not three,
   with the reason stated: the course card is too thin to ground a third. Tick
   two, then *Briefing opstellen*.
3. **3. Briefing** — note **Buiten kader**: the brand's `must_not` rules plus an
   automatic ban on *Toelatingsvoorwaarden*, because that field is deliberately
   left unconfirmed in the seed. Approve it.
4. **4. Concepten** — try *Concepten voorstellen* **before** approving the brief
   and you get a Dutch refusal; the gate is real. After approval, pick one.
5. **5. Kanaalplan** → *Kanaalplan voorstellen*. A stage × channel grid: ●
   aanbevolen, ○ mogelijk, — ontraden, each with a reason you can check against
   the doelgroep and the course card, the recommended cells ticked. Tick more,
   or *Alle creatives maken*, then approve.
6. **6. Content & beelden** → *Content maken*. Real 1080×1350 PNGs appear, two
   variants per channel with identical message and CTA. Edit the text, or type a
   revision instruction and press *Herzien met AI* — it refuses to overwrite a
   hand edit until you confirm.
7. **Export** — *Concept exporteren* always works. *Publicatieklaar* is refused
   with a list of exactly what is outstanding.

Also worth seeing: **Opleidingen** — paste a course page URL into *Opleidingskaart
uit een opleidingspagina* and it is read into a concept card with every field
marked unchecked and the page as its source; try `http://169.254.169.254/` first
to see it refused with a reason before any work is queued. Then **Merk & bronnen**
(brand rules that drive the images), **Werkruimte → Achtergrondtaken** (set
*Eerste pogingen laten mislukken* to `1` and watch retry with backoff), and
**Labels & toegang** — `demolabel-5` and `-6` exist in the database and never
appear, because the API never returns them.

---

## What works now

| Capability | State |
| --- | --- |
| Modular monolith API + separate worker | Working |
| PostgreSQL schema, forward-only SQL migrations, checksum-verified | Working |
| Identity: local dev adapter / trusted-header adapter | Working; production header contract **not yet agreed** |
| Deny-by-default authorisation, per-label roles | Working |
| Cross-label isolation (application *and* database constraints) | Working, tested |
| Job queue: idempotency, retry with backoff, cancellation, partial progress, reaper | Working, tested |
| Per-label AI budget with reservations | Working, tested |
| Security audit trail, separate from content logging | Working |
| Dutch interface in the Certify360 design language | Working |
| Honest capability reporting to the UI | Working |
| Brand profile with versioned approval; rules drive generation and images | Working. A label can upload its own PNG logo and it is composited into the images; licensed fonts still come only from a Brand Portal release |
| Course card with **per-field** verification, blocking unchecked facts | Working, tested |
| Personas, opportunities, brief, concepts, content plan — each versioned and gated | Working, tested |
| **Campaign objective, three funnel stages, channel advice** | Working, tested. Per stage its own message, proof rules and CTA; channels recommended per stage with a two-layer argument (editorial rule, model's tailoring) and no performance figure anywhere; every creative can still be made on request |
| Per-channel copy for LinkedIn / Instagram / Facebook | Working |
| **Landing-page copy as structured sections** | Working, tested. Plain text, not HTML; no rendered image; publishable because a page on your own site has no platform limits to verify — recorded as `not_platform_constrained`, never as a claimed source |
| **E-mail: structured copy, brand preview, HTML export** | Working, tested. The model never writes markup — the builder does, from plain text — so there is nothing to sanitise. No scripts, and no remote resources at all, so the mail cannot report when it was opened. **Nothing is sent**, and it cannot reach a publish-ready export because client rendering is unverified |
| **Campaign calendar, relative until you choose a start date** | Working, tested. The schedule is arithmetic, not a model's guess. It refuses to read a course date nobody has confirmed and says so, rather than parsing the prose on the card |
| **Advertising proposals: LinkedIn, Meta, Google Search** | Working, tested. Headlines, descriptions and — for Search — keyword suggestions. **No search volume, click price or conversion figure exists anywhere in the shape**, so none can be produced. Character limits are not stated either, because none has been verified; the platform is named for you to check |
| **Recording what happened: publications and measured results** | Working, tested. The system measures nothing, so every figure records how a person obtained it, and a row claiming a platform export must have the export attached. Nullable metrics (absence is not zero) and **no stored ratio**, so nothing reads as a verdict |
| **Learnings that feed later proposals** | Working, tested. A person's conclusion, split into observation / hypothesis / next test, approved before it influences anything. The size of the evidence travels with the claim into the prompt, and **approving a learning changes no persona and no brand rule** — asserted by snapshotting both tables |
| **Source-change impact across campaigns** | Working, tested. Which campaigns rest on a source that has changed, how exposed each is (published and exported rank highest), and the exact findings that came from it — by foreign key, not text matching. It reports exposure, never that a claim is wrong |
| **Rehearsed restore** | Backup → destroy → restore → verify, on every commit, including a deliberate restore-without-files that must be caught. Eight checks ship in the app so `npm run db:verify-restore` can be pointed at a real restored database. `pg_dump`/`pg_restore` and WAL recovery remain unrehearsed — stated, not glossed |
| **AI photo/illustration + two branded variants** per image channel; copy edits reuse the original | Working |
| Editing, AI revision per asset, version history, stale-edit rejection | Working, tested |
| Draft vs publish-ready export, with reasons on refusal | Working, tested |
| AI text provider layer (mock, Anthropic, **OpenAI**) | Working against the live OpenAI API: the whole chain has been run end to end through the interface, and every job records `isMock: false`. 55 tests against a stubbed transport pin the adapter itself. Anthropic is written but has not been run against its live API |
| Strict Structured Outputs schema conversion for OpenAI | Working, tested against every contract the product sends |
| Channel specifications | All three pilot channels verified against official docs, each with a source URL and a check date. No review interval is agreed yet, so nothing marks a spec `stale` |
| Course card from a **course-page URL**, through the SSRF guard | Working, tested, and reachable from **Opleidingen** |
| Course card from an **uploaded Word document or PDF** | Working, tested, and reachable from **Opleidingen** |
| Registered sources, research runs, findings with source + date + passage | Working, tested |
| Label member administration: roles, revocation, audited, effective immediately | Working, tested |
| Staleness detection with a named reason; reuse by default, force a re-run | Working, tested |
| Automatic source *discovery*, calendar, results, learnings | **Not built** — `research()` reports itself unavailable rather than pretending |
| Generation on the worker queue | Working — no route calls a model, so a slow provider cannot time out a request (ADR-0016) |
| Per-user and per-label fair use | Working, tested |
| Liveness / readiness / Prometheus metrics on API **and** worker | Working |
| Graceful shutdown; in-flight jobs finished or returned to the queue | Working, tested |
| Measured load behaviour at 100 concurrent users | Measured — see [load assumptions](docs/architecture/load-assumptions.md) |
| Browser check of the whole chain, asserted, in CI | `npm run smoke` — boots its own stack with the mock provider, drives sixteen steps, asserts ten properties of the finished campaign. No API key, no cost |
| Blocking vulnerability gates in CI | Dependencies at high/critical (`npm run audit:gate`), container images at CRITICAL. Acceptances need a reason and an **expiry date**; a lapsed or stale one fails the build |

**Facebook cannot reach a publish-ready export, on purpose.** LinkedIn and
Instagram limits were verified against the platforms' own developer
documentation, with the source URL and check date recorded next to each value.
Meta's business help centre renders client-side and could not be read directly,
so Facebook's specs are marked `unverified` — content is still generated for it,
but `isPublishable()` returns false and the export refuses. Filling that in from
a third-party blog is exactly the shortcut this design refuses to take.

**No brand or course content is invented.** The real Lindenhaeghe / Wft Basis
package has not been supplied. Seeded data is marked `origin = 'demo'` and shown
as *Demo* in the interface. No logo, accreditation, price or course condition is
generated.

---

## Commands

```bash
npm run verify        # typecheck + lint + test + build (what CI runs)
npm run typecheck
npm run lint          # eslint, incl. the architectural import boundaries
npm run test          # unit + integration against real PostgreSQL (PGlite)
npm run build

npm run db:migrate    # apply pending migrations
npm run db:seed       # demo data; refuses to run when NODE_ENV=production
npm run db:reset --yes  # DESTRUCTIVE, development only
```

To run the suite against a real PostgreSQL instead of PGlite, set
`TEST_DATABASE_URL`. See [docs/product/testing-strategy.md](docs/product/testing-strategy.md).

### Using a real OpenAI key

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
AI_TEXT_MODEL=gpt-5.6-terra     # see ADR-0015 for the price table
AI_IMAGE_ENABLED=true           # OpenAI photo/illustration + branded A/B renders
AI_IMAGE_MODEL=gpt-image-2.5-sunburst
AI_IMAGE_QUALITY=high           # xhigh/max also supported for GPT Image 2.5
```

Nothing else changes: generation already runs as a worker job, so a call taking
minutes cannot time out a request. A ChatGPT subscription is **not** API access
— requirement 12 forbids using one that way, and so do the provider's terms.

### Health, readiness and metrics

| | API (`:4000`) | Worker (`:4001`) |
| --- | --- | --- |
| `/health` | process is up; never touches the database | same |
| `/ready` | 503 while draining or if PostgreSQL is unreachable | same |
| `/metrics` | queue depth, oldest queued age, fair-use buckets | plus in-flight jobs, slots, accepting |

Prometheus text format, operational counters only — no user content, no label
names, no identifiers.

### Browser smoke run

```bash
npm run dev:stack
npx tsx tools/ui-smoke/index.ts ./var/ui-shots
```

Creates a campaign and clicks the whole chain the way a person would, taking a
screenshot at each stage and reporting where it got stuck. Uses whatever AI
provider the stack is configured with, so a run against OpenAI costs about what
one campaign costs (measured: ~EUR 0,10).

### Load test

```bash
API_BASE=http://127.0.0.1:4000 DATABASE_URL=... AUTH_PROXY_SHARED_SECRET=... \
  npx tsx tools/load-test/index.ts --users 100 --seconds 30
```

Drives the running API over HTTP with one distinct identity per virtual user
and reports latency percentiles, throughput, an error breakdown and queue drain
time. Requires `AUTH_MODE=trusted-header` with `127.0.0.1` trusted. It
provisions fixture users prefixed `loadtest-`; remove them with `--cleanup`.
Recorded results and their conditions:
[docs/architecture/load-assumptions.md](docs/architecture/load-assumptions.md).

---

## Layout

```
apps/
  api/      modular monolith: HTTP, domain modules, migrations
  worker/   background job runner (imports api modules; never the reverse)
  web/      React SPA, Dutch interface
packages/
  contracts/  Zod schemas, domain enums, access matrix (isomorphic)
  config/     server-only environment contract
  ui/         Certify360 design tokens and accessible primitives
  testing/    in-process PostgreSQL, env factories
tools/dev-db/    PostgreSQL over TCP without Docker
tools/load-test/ HTTP load driver; measures, does not assert
tools/ui-smoke/  drives the chain through a real browser
docs/         architecture, decisions (ADRs), security, product
infra/docker/ container images
```

Backend domain modules live under `apps/api/src/modules/`. Each owns its own
tables and business rules; modules integrate through each other's *services*,
never by reaching into another module's tables. See
[docs/architecture/modules.md](docs/architecture/modules.md).

---

## Security posture

Identity in production comes from the company's Entra ID authenticating proxy
as request headers. The application deliberately implements no OAuth flow and
no password store.

The rules that matter most:

- **A header's presence is not trust.** Identity headers are read only when the
  socket peer is in `TRUSTED_PROXY_IPS` *and* the proxy shared secret matches.
  Duplicate headers are rejected outright rather than resolved.
- **Clients cannot nominate their own authority.** The authenticated subject
  type has no role and no label field, so a forged `X-Roles` header has nowhere
  to land. Access is derived from membership rows every request.
- **The development identity cannot reach production.** `AUTH_MODE=local` is
  refused when `NODE_ENV=production`, by env validation *and* by the adapter
  factory.
- **A mock AI provider cannot reach production.** `AI_PROVIDER=mock` is refused
  when `NODE_ENV=production`, so a deployment can never silently serve
  fabricated content.
- **404, not 403, for another label's records** — a 403 would confirm the id
  exists and hand out an enumeration oracle.

Open items — read before deploying:
[docs/security/trusted-header-contract.md](docs/security/trusted-header-contract.md),
[docs/security/threat-model.md](docs/security/threat-model.md),
[docs/security/risk-register.md](docs/security/risk-register.md).

No claim is made that this code is free of vulnerabilities or that it is
certified against any standard.

---

## Documentation

**Start here for detail:** [docs/PLATFORM.md](docs/PLATFORM.md) — what every
directory and file is for, how a request travels through the stack, every
security control with the test that holds it, and what is deliberately not
built. It is updated in the same change as the code.

- [Architecture overview](docs/architecture/overview.md)
- [Module map & boundaries](docs/architecture/modules.md)
- [Extension roadmap](docs/architecture/extension-roadmap.md) — connectors,
  Market Radar, SEO/GEO, M&A workspace
- [Decision records (ADRs)](docs/decisions/README.md)
- [Threat model](docs/security/threat-model.md) ·
  [Access matrix](docs/security/access-matrix.md) ·
  [Data inventory](docs/security/data-inventory.md) ·
  [Risk register](docs/security/risk-register.md)
- [Incident response](docs/security/incident-response.md) ·
  [Backup & restore](docs/security/backup-restore.md) ·
  [Vulnerability management](docs/security/vulnerability-management.md) ·
  [Supplier inventory](docs/security/supplier-inventory.md)
- [Scope & phases](docs/product/scope-and-phases.md) ·
  [Backlog](docs/product/backlog.md) ·
  [Requirements traceability](docs/product/requirements-traceability.md) ·
  [Testing strategy](docs/product/testing-strategy.md)

---

## Not done by this application

By design, and requiring separate authorisation: production deployment, sending
real e-mail or social posts, spending advertising budget, connecting an ad
account, and deleting data.


De contentflow is **Marktradar → campagne → goedgekeurde briefing → inhoudelijke aanbevelingen → gekozen content produceren**. Blog/FAQ, website-keuzehulp en een Google Studio-interactieset worden vanuit de campagne gemaakt met actuele merkregels, fonts en logo. Sociale content en beelden behouden hun bestaande concept/plan-pad. Een gewijzigd merk of brief blokkeert de oude pakketdownload. Studio-ZIP’s hebben lokale structurele checks; definitieve platform- en uitgevers-QA blijft nodig. Dit is geen rechtstreekse Google Ads-uploadadapter. Zie [het markt-naar-campagneplan](docs/pilot/crov/market-to-campaign-plan-tr.md).
