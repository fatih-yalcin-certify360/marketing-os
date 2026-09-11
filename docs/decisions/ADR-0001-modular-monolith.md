# ADR-0001 — Modular monolith plus a separate worker

**Status:** Accepted · **Date:** 2026-09-09

## Context

The product spans research, personas, campaigns, content production, approval,
export, measurement and multi-label operation. It is built and maintained by a
single developer, and must stay robust enough for six labels at launch with
more to follow.

Long-running work (AI generation, web research, file processing, exports) cannot
run inside a request: it takes minutes, must survive a deploy, and must be
resumable.

## Decision

One deployable API process containing all domain modules, plus one worker
process that runs background jobs. Both share the same database and the same
domain modules. The dependency direction is **worker → api**, never the reverse.

Modules live under `apps/api/src/modules/<domain>/`. Each owns its tables and
business rules. Modules integrate through each other's *services*; no module
reads or writes another module's tables directly.

## Rejected

- **Microservices.** Would multiply deployment, observability and data-consistency
  work for a single maintainer, with no scaling problem to solve. The module
  boundaries here are the part that matters, and they are enforceable in one
  process via lint rules and service-level integration.
- **Serverless functions.** Poor fit for minutes-long jobs with partial progress
  and cancellation, and it would push the queue into a managed broker we do not
  otherwise need.
- **Running jobs in-process in the API.** A slow generation would occupy a
  request worker, and a deploy would kill work in flight.
- **Kubernetes.** No requirement it addresses today. Two containers and Compose
  cover development; production runs the same two images.

## Consequences

- Accepted: a module boundary violation is caught by lint and review, not by a
  network boundary. `no-restricted-imports` enforces the api/worker direction.
- Accepted: API and worker scale together as images, not independently per
  module. If one module ever needs separate scaling, its service is already the
  seam to extract along.
- Gained: a job, its budget reservation, its audit entry and its partial results
  commit in a single database transaction. This is the property that makes
  "no double charge on retry" achievable at all, and it would be materially
  harder across a service boundary.
