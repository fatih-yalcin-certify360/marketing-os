# Testing strategy

Tests here verify **behaviour**, not implementation. The ones that matter most
are the security and correctness properties that would be expensive to discover
in production: cross-label isolation, identity spoofing, budget ceilings under
concurrency, and no duplicate work or cost on retry.

**Current state: 106 tests across 10 files, ~10 seconds, no external services.**

## Layers

| Layer | Tool | What it covers |
| --- | --- | --- |
| Unit | Vitest | Pure logic: access matrix, workflow gates, env guards, header parsing, IP matching |
| Integration | Vitest + real PostgreSQL | Repositories, services, routes over HTTP via `app.inject()`, database constraints |
| E2E | Playwright | Browser install and render check done; **suite not written** — backlog item |

## Why integration tests dominate

The guarantees that matter are database guarantees: `ON CONFLICT`,
`FOR UPDATE SKIP LOCKED`, composite foreign keys, `CHECK` constraints,
conditional `UPDATE`. None of them survive mocking — a mocked database would
test the mock. So the integration suite runs against real PostgreSQL and
exercises real routes.

## Two database tiers

| Tier | Command | Database | Purpose |
| --- | --- | --- | --- |
| Default | `npm test` | PGlite (real PostgreSQL, WebAssembly, in-process) | Fast inner loop, no Docker |
| CI | `test-real-postgres` job | `postgres:18-alpine` | Everything PGlite cannot express |

Each integration file gets a fresh database, so files cannot leak state.

### The PGlite limitation, stated plainly

**PGlite executes queries one at a time.** The test harness drives it in-process
through the JS API, and `tools/dev-db` multiplexes several wire-protocol
connections onto the same single instance — in both cases the queries serialise,
so the limitation is the same. It therefore proves *guards* but not *races*:

- `budget.test.ts` proves an over-limit reservation is refused and the balance
  never goes negative — sequentially.
- It does **not** prove that two simultaneous requests cannot both reserve the
  last of the budget. That property comes from the reservation being a single
  conditional `UPDATE` (one row lock, WHERE re-evaluated after the lock), and is
  exercised in CI against PostgreSQL 18.

Same applies to `SKIP LOCKED` claim exclusivity. Recorded as **R-02**. Do not
quote these suites as proof of concurrent correctness.

To run the suite against real PostgreSQL locally, set `TEST_DATABASE_URL` and
use Docker Compose.

## The critical tests

Requirement 15 names these. Current status:

| Test | File | Status |
| --- | --- | --- |
| Cross-label access denial | `apps/api/tests/integration/label-isolation.test.ts` | Passing |
| Missing / forged / duplicated identity headers | `apps/api/tests/unit/trusted-header-auth.test.ts` | Passing |
| Development auth refused in production | `apps/api/tests/unit/env-guards.test.ts` | Passing |
| Old approval invalid for a changed version | `packages/contracts/tests/workflow-gates.test.ts` | Rules passing; artefact enforcement Phase 1 |
| Draft vs publish-ready export separation | `access-matrix.test.ts`, `workflow-gates.test.ts`, `exports.test.ts` | Passing |
| Channel advice cannot carry a figure; the rule table is complete and figure-free; a plan outside its objective is refused; content is written per stage under stage-aware keys | `funnel.test.ts`, `funnel-plan.test.ts` | Passing |
| Research sources not executed as instructions | — | **Phase 1** |
| SSRF and file-safety limits | — | **Phase 1** |
| No duplicate asset / duplicate cost on retry | `job-queue.test.ts`, `runner.test.ts` | Passing |
| Cost limit under concurrent requests | `budget.test.ts` | Guard passing; race in CI only (R-02) |
| Provider timeout and malformed output | `job-queue.test.ts`, `runner.test.ts` | Passing |
| User edits not silently lost | `runner.test.ts` | Passing for jobs; content editing Phase 2 |
| Second label independent in the same flow | `label-isolation.test.ts` | Passing |

## Schema parity

`schema-parity.test.ts` applies the real migrations to a real PostgreSQL and
asserts every table and column the Drizzle definitions declare actually exists.
It is the control that keeps the hand-written SQL and the typed mirror from
drifting (ADR-0005). It also verifies the migration ledger, idempotent re-runs,
and that editing a released migration is refused.

## Writing a test here

Do:
- assert observable behaviour — status codes, database rows, returned values;
- use `createTestHarness()`, which runs the real migrations and seeds demo data;
- name the property, not the function: *"returns not-found for a label that
  exists but is not accessible"*;
- for a new label-scoped feature, add an isolation test. Non-negotiable.

Do not:
- assert that a specific private method was called;
- mock the database;
- rely on wall-clock timing — inject the clock (`fixedClock()`) or the delay;
- share state between test files.

## Deliberate coverage gaps

Honest, and each with a reason:

- **The browser suite is one path, not a matrix.** `npm run smoke` boots its own
  stack, drives the whole campaign chain and asserts ten properties of the
  finished campaign; it runs in CI as the `ui-smoke` job. What it does *not* do:
  more than one browser, more than one entry mode (`discover_opportunities`
  only), any error path, or anything outside the chain — the Opleidingen, Merk
  and Labels screens are still verified by hand. It also runs against the
  **mock** provider, so it proves the product works, not that a model's output
  is any good.
- **Load testing was done and is bounded.** A measured run sized the rate limits
  and found four defects; the numbers and, more importantly, the conditions they
  hold under are in `docs/architecture/load-assumptions.md`. It was a single
  host, a single replica, a mock provider and a short run, so it supports
  statements about *that* configuration and nothing wider. **No general capacity
  claim is made** (R-03).
- **No React test harness.** The web app has no unit or component tests: there
  is no jsdom setup and `apps/web/tsconfig.json` does not include a tests
  folder. The rules the screens depend on are tested where they are enforced —
  on the API — so what is unproven automatically is whether the interface
  *renders* them. That is not a small gap: a mutation whose failure was never
  rendered is exactly how a broken export looked like a working one for several
  migrations. `tools/ui-smoke` covers the campaign chain in a real browser;
  screens outside that chain — Opleidingen, Merk, Labels & toegang — are
  verified by hand with screenshots.
- **The Docker-free database is not the CI database.** `tools/dev-db`
  multiplexes several connections onto one PGlite instance, and unnamed
  prepared statements can collide between them under load — surfacing as a
  spurious 500 on whichever query lost, roughly one browser-smoke run in
  several. The in-process suite does not hit it, and neither does the
  `test-real-postgres` job. The smoke driver therefore tolerates a transient
  failure of its *polling* request (a poll reads and changes nothing) and fails
  after five consecutive ones. Anything that looks like this in a smoke run is
  worth re-running once before believing it.
- **No mutation testing.** Not proportionate for one maintainer today.
- **Coverage percentage is not a gate.** A number would be easy to satisfy and
  easy to game; the named critical tests above are the real bar.

## A test that cannot fail is worse than no test

This has cost real defects three times, in three different disguises, so it is
written down rather than remembered:

- **A suite that passes because the world already agrees with it.** The P2-2
  channel gate tests asserted that unverified channels are refused, using the
  shipped configuration — in which the relevant channel had since been verified.
  They passed while testing nothing. Rewritten against a purpose-built
  unverified fixture, with the shipped configuration's status asserted
  separately in one place.
- **A driver that reports steps it did not perform.** `tools/ui-smoke` returned
  as soon as it saw an empty job queue, which is true for a moment after every
  click, and reported `chose 0 of 0 doelgroepen` as a success. It now requires
  the job to appear and refuses to select nothing.
- **An extractor that silently matches nothing.** `ui-smoke-labels.test.ts`
  derives its assertions by parsing another file, so a reformat could leave it
  iterating over an empty list and reporting success. It asserts a minimum
  count first, for exactly that reason.
- **A test whose precondition never existed.** The source-impact test read the
  seed for a registered source and asserted on what it found. The seed
  registers none — the one in the developer database had been added by hand —
  so the assertion failed loudly, which was the good outcome. The version that
  would have been worse is the one that finds nothing, reports "no changed
  sources", and passes: correct behaviour, tested against an absence. The test
  now builds its own source **and** a run that recorded a hash for it, because
  without a recorded hash a later change is *unknowable* rather than absent,
  and the report would rightly say nothing.
- **A spy assertion after `mockRestore()`.** `mockRestore` clears the recorded
  calls as well as restoring the original method, so reading `spy.mock.calls`
  in or after a `finally` reports zero — and zero is exactly what a broken
  wiring would report. It cost a real debugging detour in `learnings.test.ts`:
  the assertion said the learnings never reached the prompt while the personas
  they had shaped were plainly being generated. Capture what you need inside
  the `try`.
- **A gate that cannot fail.** Both security scanners in CI ran on every push
  and neither could fail a build: `|| true` on the dependency audit,
  `exit-code: '0'` on the image scan. They produced output nobody was obliged
  to read, which is the most convincing form of this failure because the
  evidence of work is right there in the log. `tools/audit-gate/` takes its exit
  code from the policy instead of from the scanner, and its own tests cover the
  three ways it could go quiet again — an acceptance that never expires, a list
  nobody prunes, and a report format it no longer understands.
- **A list derived from the thing it is checking.** `prompt-rules.test.ts`
  keeps its own hand-written list of which prompt templates are extraction
  tasks, instead of importing `EXTRACTION_TEMPLATES`. Importing it would make
  the test agree with the code by construction, including a template put on the
  wrong side — and that is the error that matters, in both directions. A
  separate assertion compares the two lists and names any template that appears
  in one and not the other, so adding a template forces a person to classify it
  rather than failing with a wall of Dutch prose.

The pattern to look for: a test whose assertion is over a collection it built
itself. Assert the collection is non-empty before asserting anything about its
contents.

## An endpoint with nothing on the other end

A second failure shape, found twice and worth naming separately from the ones
above: a capability whose halves are each correct and never meet.

- The **draft export** had a writer with a valid `ON CONFLICT` and an index that
  had since become partial. Both halves were defensible; nothing exercised the
  seam.
- The **brand logo** had an endpoint that received a file, validated it, stored
  it and a column to hold the reference — and a render path that loaded a logo
  only for Portal-linked labels. Everything worked except the part where the
  logo appeared in an image.

Unit tests do not find these, because each half passes its own. What finds them
is a test that starts where the user starts and asserts the *last* observable
effect: not "the reference was stored" but "the bytes reach the renderer", not
"the export row was written" but "the zip opens and contains the images".

The rule of thumb: when adding an endpoint, name its consumer in the same
change. `upload-surface.test.ts` now enforces it for upload purposes — the
accepted set is pinned, so adding one fails until the list is updated and
whoever updates it has to answer "what reads this?".

The rule also decides what to do with an endpoint that never got its consumer:
remove it. `brand_document` accepted and stored documents no code path read, and
was deleted rather than given a screen. Writing "no consumer" in the
documentation was better than a screen that appears to do something, but not as
good as not having the surface.

## Where the coverage actually was missing

The export package — the only artefact that leaves this system — had **no tests
at all** until 2026-09-10, and the defect that revealed this had been live for
several migrations: every draft export answered 500 (see `exports.test.ts` and
§9 of `docs/PLATFORM.md`). Two things let it hide. The interface rendered no
error for that particular mutation, so the failure looked like a success. And
the browser smoke run clicked the button, saw the button return to normal, and
counted the step as done.

The lesson is about *where* to look for gaps, not about exports: the last step
of a flow is the least-tested one, because reaching it in a test costs the whole
flow first.
