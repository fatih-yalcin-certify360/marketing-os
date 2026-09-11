# Scope, phases and acceptance criteria

## Long-term goal

A Marketing Operating System that joins research, personas, campaigns, content
production, approval, activation, measurement and multi-label integration.

Delivery is **output-first**: each phase ships something small that works end to
end and is usable on its own. No phase waits for the whole platform.

## Pilot

- Label: **Lindenhaeghe**
- Course: **Wft Basis**
- Six labels at launch, more later.

The real brand and course package has not been supplied. Nothing about it is
invented: no logo, accreditation, price or course condition. Development data is
marked `origin = 'demo'` and shown as *Demo*.

## Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| **0 — Foundation** | Repository, ADRs, threat model, workspace, Compose, migrations, local auth, label authorisation, CI | **Complete** |
| **1 — Recorded working flow** | Brand/course input, personas, opportunities, brief, approval — with labelled mock AI | **Complete**, except document upload and web research |
| **2 — Social pilot** | Concepts, LinkedIn/Instagram/Facebook, two visual variants, editing, approval, export | **Complete**, except a real provider key and moving generation onto the worker |
| **3 — Campaign package** | Landing-page copy, e-mail preview + HTML export, relative calendar, ad proposals | Planned |
| **4 — Learning and hardening** | Outcome import, approved learnings, source-change impact, cost/load tests, restore test, security review | Planned |
| **5 — Production connection** | Real trusted-header contract, company environment, data/AI policies, production controls | Planned |

## Phase 0 acceptance criteria — met

| Criterion | Evidence |
| --- | --- |
| Repository analysed; existing files preserved | Working directory was empty; the two design PNGs in `../Final/` were used as the visual source and left untouched |
| Initial ADRs written | 14 records in `docs/decisions/` |
| Threat model started | `docs/security/threat-model.md`, 12 threats with controls and verification |
| Workspace runs | `npm ci && npm run verify` — typecheck, lint, 106 tests, build all pass |
| Docker Compose | `docker-compose.yml` with postgres + migrate + api + worker, non-root and hardened |
| PostgreSQL migrations | 3 forward-only SQL migrations, checksum-verified, parity-tested |
| Local auth | `LocalAuthAdapter` + `TrustedHeaderAuthAdapter`, production guards tested |
| Label authorisation | Deny-by-default matrix; cross-label isolation tested at API *and* database level |
| CI | Typecheck, lint, test (PGlite **and** PostgreSQL 18), build, image build + non-root assertion, dependency/secret/image scans |
| Working end-to-end behaviour | Job enqueued through the UI → worker fails attempt 1 → backs off → succeeds on attempt 2 → 100% progress visible. Verified by running the stack |

## What Phase 0 deliberately does not include

Brand, courses, research, personas, opportunities, briefs, concepts, content,
exports, results, real AI adapters, uploads, URL fetching. Each is absent from
the interface as an explicitly unavailable area — not stubbed to look finished.

## Standing acceptance criteria

Applied to **every** phase, not just once:

1. `npm run verify` passes.
2. New label-scoped data has a cross-label isolation test.
3. New user-facing failure modes have a Dutch message tied to an error code.
4. Anything unfinished is reported through `moduleAvailability` as unavailable.
5. No number is displayed that was not measured or entered — no invented
   metrics, prices, volumes or scores.
6. Requirements traceability and the risk register are updated.
7. A decision that would be expensive to reverse gets a decision record.
8. New AI-touching code separates estimated from actual cost and reserves budget
   before the call.

## Definition of done for a phase

The delivery report states: what works, how to run and try it, which files
changed, which tests ran and their results, what is mock or missing, security
and migration risks, and the next small step.
