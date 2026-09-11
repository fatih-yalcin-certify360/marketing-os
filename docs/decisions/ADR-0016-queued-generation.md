# ADR-0016 — All generation runs as a job; no model call in a request

**Status:** Accepted · **Date:** 2026-09-09

## Context

The requirement is that the system must not time out and must keep working with
100 concurrent users. A real model call for a persona set or a content package
takes tens of seconds, sometimes minutes with image work. Any design that holds
an HTTP request open for that is fighting every timeout between the browser and
the database: the browser's, the reverse proxy's, the load balancer's, and
Node's own.

Raising those timeouts is the obvious move and the wrong one. It makes the
failure rarer without making it impossible, and it holds a connection and a
request slot for the duration — which is exactly what breaks at 100 users.

## Decision

**No route calls a model.** Every generating endpoint validates, checks its
gates, reserves budget, writes a job row and returns a `JobSummary` in
milliseconds. The model call happens on the worker, where minutes are normal.
The client follows the job.

Concretely:

- Seven job types: `persona.propose`, `opportunity.propose`, `brief.draft`,
  `concept.propose`, `content.plan`, `content.generate`, `content.revise`.
- The worker builds **the same service graph** as the API, so a stage behaves
  identically wherever it runs. No business rule is duplicated.
- A job **re-resolves its actor** via `identity.resolveById` rather than
  inheriting the enqueuer's permissions, so a membership revoked between
  enqueue and run takes effect. Authority is never carried in the payload.
- Budget is reserved pessimistically at enqueue, so a hundred queued jobs count
  against the label's ceiling before any of them runs. The runner settles the
  difference against actual token cost exactly once.
- The idempotency key is derived from the target artefact, so an impatient
  second click returns the *same* job rather than paying twice.
- Progress is reported per step and committed as it happens, so a cancelled or
  failed job keeps what it had already written.

### Gates are checked twice, deliberately

This is the part that went wrong first and is therefore written down.

Moving generation to the worker moved the gate checks with it, and the result
was that asking for concepts without an approved brief returned **202 Accepted**
with a job id. The control still held — the job died with the right Dutch
message — but the user got a progress bar for work that was never going to run,
and a budget reservation was held against it.

So each gated step is checked **before enqueueing** (`assertCanPropose`,
`assertCanProposePlan`, `assertCanGenerate`, `assertCanDraftBrief`,
`assertRevisable`) *and* again in the handler:

- **Before enqueue**, so an unapproved brief is a `409` the user can act on.
- **In the handler**, because un-approving the brief after enqueue must still
  refuse, and approving it after enqueue must not be a way to have skipped the
  check.

Pinned by `apps/api/tests/integration/generation-gates.test.ts`, which asserts
both the status *and* that no job row was created.

### Fairness

One label's burst must not occupy every worker. The claim query counts running
jobs per label in a CTE and orders by that count first, with
`WORKER_MAX_JOBS_PER_LABEL` as a hard ceiling:

```sql
ORDER BY COALESCE(running.active, 0) ASC, priority ASC, run_at ASC, id ASC
FOR UPDATE OF candidate SKIP LOCKED
```

### Client behaviour

`useJobProgress` polls and backs off: 1.2 s for the first 20 s, 3 s to 90 s,
then 6 s, and never in a background tab. At a hundred users a fixed 1.2 s poll
is roughly eighty requests a second of pure status checking.

## Consequences

- **Request latency is now independent of model latency.** Measured p99 across
  the read mix is 6.1 ms at 337 req/s (`docs/architecture/load-assumptions.md`).
  Enqueue is 11 ms uncontended, ~130 ms worst case under a 120-way burst.
- No database transaction is held across a provider call — in every service the
  model call completes before the write transaction opens. This is what makes
  high worker concurrency cheap, and it is a property to preserve when adding a
  stage.
- The UI must express "queued", "running with progress", "failed with a reason
  and a retry", not just a spinner. It does.
- A domain refusal inside a job must be classified as such. It was not: the
  runner's catch chain did not handle `AppError`, so every business rule reached
  the user as "an unexpected error occurred". Fixed with a failure-kind mapping;
  see `APP_ERROR_FAILURE_KIND` in `apps/worker/src/runner.ts`.
- Deploys interrupt jobs. A stopping worker finishes what it holds within
  `WORKER_SHUTDOWN_GRACE_MS` and otherwise **releases** them back to the queue
  without consuming an attempt, so another replica resumes them on its next poll
  instead of waiting out the heartbeat reaper.

## Rejected

- **Raising the request timeout.** Makes the failure rarer, not impossible, and
  holds a request slot and a connection for minutes.
- **Server-sent events or WebSockets for progress.** A second connection mode
  with its own reconnection handling, for a status field that changes a handful
  of times per job. Polling with backoff is enough at this scale; the job row is
  the source of truth either way, so this is a local change if latency ever
  matters.
- **A dedicated queue service (Redis, SQS, a workflow engine).** The queue is
  already transactional with the data it guards, which is what makes
  "reserve budget and enqueue atomically" a single commit. Introducing a second
  store would add a consistency problem to solve a throughput problem we do not
  have — measured drain is near-linear to 24 concurrent jobs on one worker.
