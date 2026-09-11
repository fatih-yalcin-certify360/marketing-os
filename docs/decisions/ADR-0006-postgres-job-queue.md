# ADR-0006 — Job queue in our own PostgreSQL schema

**Status:** Accepted · **Date:** 2026-09-09

## Context

Background work must provide, per requirement: retry, timeout, cancellation,
idempotency, per-label fair-use limits, budget reservation for *pending* work,
survival of partial results, user-resumable failures, and no duplicate asset or
duplicate charge on retry.

## Decision

A `jobs` table in our own schema. Workers claim with:

```sql
UPDATE jobs SET status='running', attempt=attempt+1, claimed_by=$1, ...
WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_at <= now()
            ORDER BY priority, run_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING ...
```

Every write-back (`complete`, `fail`, `reportProgress`, `markCancelled`) is
guarded by `claimed_by = :workerId`. Idempotency is a unique constraint on
`(organization_id, type, idempotency_key)` with `ON CONFLICT DO NOTHING`.

## Rejected

- **pg-boss / graphile-worker.** Both are good, both own their own schema. The
  requirements demand that a job, its idempotency key, its budget reservation
  and its partial results commit **atomically together**. With an external queue
  those live in a different schema and often a different connection, so the
  cross-cutting invariants become two-phase problems. It would also become a
  second source of truth for job state that the UI has to reconcile.
- **Redis (BullMQ).** Adds infrastructure we otherwise do not need, and makes
  "budget reserved for a queued job" a distributed-transaction problem.
- **`LISTEN`/`NOTIFY` instead of polling.** Deferred, not rejected: a 1-second
  poll against a partial index (`WHERE status='queued'`) is negligible at this
  scale, and adding NOTIFY means another connection mode with its own
  reconnection handling. If queue latency ever matters, it is a local change to
  the claim path.

## Consequences

- Accepted: we own the queue's correctness. This is why the guarantees are
  covered by tests rather than assumed — `apps/api/tests/integration/job-queue.test.ts`
  and `apps/worker/tests/runner.test.ts` cover claim exclusivity, guarded
  write-back, backoff, retry exhaustion, non-retryable failure, cancellation
  with preserved progress, the reaper, and usage-accounting idempotency.
- Accepted: throughput is bounded by PostgreSQL. Untested at scale; no capacity
  claim is made (see docs/product/testing-strategy.md).
- Gained: the queue is inspectable with SQL, backed up with the database, and
  restored with it.
- Gained: a reaped worker that wakes up late writes nothing, because the
  ownership guard turns its write-back into a no-op instead of a double write.
