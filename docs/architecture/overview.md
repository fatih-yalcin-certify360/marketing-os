# Architecture overview

## Shape

```
                    ┌──────────────────────────────────────────┐
   Browser ────────►│ Authenticating proxy (Entra ID)          │
                    │  · authenticates the user                │
                    │  · writes identity headers               │
                    │  · MUST strip client-supplied copies     │  ← open item R-01
                    └────────────────┬─────────────────────────┘
                                     │  x-c360-subject / -email / -name
                                     ▼
        ┌────────────────────────────────────────────────┐
        │ apps/api  — modular monolith (Fastify 5)       │
        │  core/  auth · authz · db · errors · http      │
        │  modules/  identity-access · organizations-    │
        │            labels · jobs-usage · audit · …     │
        └───────┬────────────────────────────────┬───────┘
                │                                │
                ▼                                ▼
        ┌───────────────┐              ┌──────────────────────┐
        │ PostgreSQL 18 │◄─────────────│ apps/worker          │
        │ sole datastore│   SKIP LOCKED│  claims jobs, runs    │
        │ + job queue   │              │  handlers, heartbeats │
        └───────────────┘              └──────────┬───────────┘
                                                  │  Phase 2
                                                  ▼
                                        AI provider · web sources
                                        (both untrusted)
```

`apps/web` is a static SPA served same-origin with the API under `/api`.

## Why this shape

One API process and one worker process, sharing one database and one set of
domain modules (ADR-0001). The property that buys the most is transactional:
a job, its budget reservation, its audit entry and its partial results commit
together. Requirements like "no double charge on retry" and "pending work counts
against the budget" are then enforceable with a constraint rather than with a
distributed protocol.

PostgreSQL is the only datastore. No Redis, no broker, no external session
store. Fewer moving parts for one maintainer, and fewer things that can be
inconsistent with each other.

## Layers inside the API

| Layer | Responsibility | Must not |
| --- | --- | --- |
| `core/http` | Fastify wiring, security plugins, request context | Contain business rules |
| `core/auth` | Establish *who* the caller is | Decide what they may do |
| `core/authz` | Decide what they may do, from persisted memberships | Read request headers or body |
| `core/db` | Pool, schema, migrations, seed | Contain domain logic |
| `core/errors` | The single failure exit point | Leak internal detail to clients |
| `modules/*/routes.ts` | HTTP shape, validation, calling a service | Query the database directly |
| `modules/*/service.ts` | Business rules, transactions, authorisation calls | Know about HTTP |
| `modules/*/repository.ts` | Data access for **this module's** tables | Touch another module's tables |

The split between `auth` and `authz` is the one to preserve. An identity adapter
can assert only subject, e-mail and display name — the type has no role and no
label field — so a forged authority claim has nowhere to land.

## Request path

1. Fastify hooks: helmet, CORS (deny-by-default), rate limit, origin check on
   state-changing requests.
2. `authenticate` pre-handler — per route, never global, so adding an
   unauthenticated route is a visible act. Only `/health` and `/ready` are open.
3. The identity adapter resolves the subject.
4. `IdentityService` provisions/refreshes the user and loads memberships **from
   the database, every request** — so revoking access takes effect immediately.
5. The handler validates input with Zod and calls a service.
6. The service calls `requireLabelPermission` *before* any write.
7. Repositories query with `organization_id` predicates.
8. Failures exit through one error handler: Dutch message + request id to the
   client, internal detail to the log only.

## Background path

1. The API enqueues inside a transaction: job row + budget reservation + audit
   entry. An idempotency key derived from the intent collapses double submits.
2. A worker claims with `FOR UPDATE SKIP LOCKED` — exactly one worker wins.
3. The handler validates its own payload, then runs, committing progress as it
   goes and checking for cancellation at each checkpoint.
4. Every write-back is guarded by `claimed_by`, so a worker the reaper already
   replaced writes nothing.
5. Terminal states settle the budget exactly once. A requeue keeps the hold,
   because the job will run again.
6. A provider failure becomes a recorded failure with a Dutch message — never a
   fabricated success.

## Data model principles

- **Tenant scope in the relations, not only in queries.** `users` and `labels`
  carry `UNIQUE (id, organization_id)`; `memberships` references both through
  composite foreign keys including `organization_id`. A cross-organisation
  membership is impossible at the storage layer.
- **Immutable versions.** Reviewable artefacts append versions; approval binds to
  one version, so a new version is unapproved by construction (ADR-0012).
- **Traceability.** Sources, models, prompt templates and prompt versions are
  recorded per usage row.
- **JSONB where shape genuinely varies** (job payloads, provider metadata) and
  normalised columns everywhere else. Nothing important lives only inside a JSON
  blob or a prompt string.
- **Bounded reads.** Every collection endpoint is paginated with a maximum page
  size; hot paths have partial indexes.

## Frontend

React 19 + Vite + TanStack Query (ADR-0011). Dutch interface built on the
Certify360 design tokens in `packages/ui`, sampled from the approved interface
designs.

The rule that shapes it: **availability comes from the server.** The API reports
`moduleAvailability`, and navigation renders from it — so an unfinished area is
marked unavailable with the reason rather than rendering an empty widget that
looks broken. Updating that list is part of finishing a phase.

## What is not here yet

Phases 1–4 add the brand, courses, sources-research, personas, opportunities,
campaigns-briefs, concepts, content-assets, reviews-approvals, exports and
outcomes-learning modules. The seams they attach to — job types, review states,
workflow gates, the access matrix, versioned approvals — already exist and are
tested. See [modules.md](modules.md) and
[extension-roadmap.md](extension-roadmap.md).
