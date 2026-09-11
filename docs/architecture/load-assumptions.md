# Load assumptions and measured behaviour

Requirement 15 forbids claiming capacity without measuring it. This document
therefore separates three things that are usually blurred together:

1. **Assumptions** — what we designed for, stated so they can be checked.
2. **Measurements** — numbers from an actual run, with the conditions.
3. **Unknowns** — what has not been measured and must not be claimed.

Last measured: **2026-09-09**, commit at the time of the OpenAI provider work.

---

## 1. Assumptions

These are inputs to sizing, not findings.

| Assumption | Value | Where it comes from |
| --- | --- | --- |
| Concurrent users | 100 | Stated requirement |
| Labels at launch | 6 | Stated requirement |
| Requests per active user, steady state | 10–25 / min | Navigation in the SPA: a page change is 4–6 calls |
| Requests per user watching a job | +10–50 / min | Adaptive polling: 1.2 s for the first 20 s, then 3 s, then 6 s |
| Peak per user | ~75 / min | Sum of the two above |
| Generation jobs per user per session | 5–15 | One per chain step, plus revisions |
| Generation job duration, real provider | 20–90 s text, longer with images | Provider-side; **not measured by us** |
| Generation job duration, mock provider | ~0.8 s | Measured, used for queue throughput only |

The sizing consequence of the peak figure is written into
`packages/config/src/env.ts` next to `RATE_LIMIT_MAX_PER_MINUTE`, because a
number chosen by feel there throttles the whole company at once.

---

## 2. Measurements

### Conditions

| | |
| --- | --- |
| Database | **PostgreSQL 18.4**, native binaries, `max_connections = 200`, `shared_buffers = 256MB`, `fsync = on` |
| API | one process, `DATABASE_POOL_MAX=20` |
| Worker | one process, concurrency as noted per run |
| Identity | `AUTH_MODE=trusted-header`, one distinct subject per virtual user, proxy shared secret enforced |
| AI provider | **mock** — see "Why the mock provider" below |
| Host | Apple Silicon laptop; client, API, worker and database all on the same machine |
| Driver | `tools/load-test/index.ts` over HTTP, one identity per virtual user |

Reproduce with:

```bash
API_BASE=http://127.0.0.1:4000 \
DATABASE_URL=postgresql://... \
AUTH_PROXY_SHARED_SECRET=... \
npx tsx tools/load-test/index.ts --users 100 --seconds 30
```

### Read mix — 100 concurrent users, 30 s

Mix: `/me`, workspace overview, campaign list, job list, brand, courses.

| Metric | Result |
| --- | --- |
| Requests | 10,113 |
| Throughput | **337 req/s** |
| Success | **100.00%** (0 errors, 0 refusals) |
| p50 | **2.8 ms** |
| p95 | **5.1 ms** |
| p99 | **6.1 ms** |
| max | 16.5 ms |

Per route, p50 / p95 in ms:

| Route | p50 | p95 |
| --- | --- | --- |
| `/me` | 2.4 | 3.1 |
| `labels/:id/jobs` | 2.7 | 3.5 |
| `labels/:id/campaigns` | 2.7 | 3.5 |
| `labels/:id/courses` | 2.7 | 3.5 |
| `labels/:id/brand` | 3.1 | 4.0 |
| `labels/:id/workspace` | 4.8 | 6.1 |

The workspace overview is the slowest because it aggregates across modules; at
6 ms p95 it does not yet warrant caching.

A pool of 20 was never the constraint at this rate. The database was not the
constraint either — the driver, API, worker and database shared one machine, so
these numbers include no network latency and should be read as a floor.

### Enqueue latency

| Phase | p50 | p95 | max |
| --- | --- | --- | --- |
| Generation enqueue, uncontended | 11 ms | 12 ms | 12 ms |
| 120 simultaneous enqueues | 75–115 ms | 85–127 ms | 117 ms |

Enqueue is slower than a read because it opens a transaction and reserves
budget. Under a 120-way simultaneous burst it stays under ~130 ms, which is well
inside what a button press tolerates.

### Queue throughput — 120 jobs, one worker

| Worker concurrency | Drained in | Longest wait before starting |
| --- | --- | --- |
| 4 | 25.1 s | 23.6 s |
| 12 | 8.6 s | 7.0 s |
| 24 | 4.5 s | 3.0 s |

Close to linear across a 6× range, so `FOR UPDATE SKIP LOCKED` with the
label-fair CTE is not the bottleneck in this range. No job failed at any
concurrency.

This is why the `WORKER_CONCURRENCY` default is 8 rather than 2: generation
jobs are I/O-bound, and **no database transaction is held across the provider
call** — in every service the model call completes before the write transaction
opens. A slot therefore costs a pending promise, not a held connection.

### Correctness under load

| Property | Result |
| --- | --- |
| Every enqueue accepted or honestly refused (no 5xx, no transport error) | Yes |
| Duplicate submissions collapsed by idempotency key | Yes — 20 requests for the same artefact produced one job per label |
| New failures introduced by load | None at any concurrency |
| Fair-use refusals returned as 429 with `retry-after` | Yes |

---

## 3. What these numbers do **not** show

Stated plainly, because the temptation is to read a good result as a broader
guarantee than it is.

- **Nothing about model latency or provider throughput.** The run used the mock
  provider. A real OpenAI call takes tens of seconds and its rate limits are
  the provider's, not ours. This is precisely why generation was moved to the
  worker: request latency is now independent of it. Provider behaviour under
  concurrency is **unmeasured**.
- **Nothing about a real network.** Everything ran on one host. Add real
  round-trip time per request.
- **Nothing about more than one replica.** A single API process and a single
  worker were measured. The in-memory fair-use limiter is per-process (the
  controls that must hold across replicas — budget reservation and the per-label
  worker ceiling — are in PostgreSQL and are unaffected).
- **Nothing about the real reverse proxy, TLS, or Entra ID.** The trusted-header
  contract itself is still unverified; see
  `docs/security/trusted-header-contract.md`.
- **Nothing about sustained load over hours.** The longest run was 30 seconds.
  Connection churn, memory growth and index bloat are unobserved.
- **Nothing about image generation volume.** Image rendering is CPU-bound
  (`@resvg/resvg-js`), unlike the rest of a generation job, so a content-heavy
  workload will not scale the same way as the table above. Unmeasured.

## 4. Findings that changed the code

The run was not a formality; it found three defects.

1. **The rate limiter counted every user as one.** `keyGenerator` read the
   authenticated subject in `onRequest`, but authentication ran in
   `preHandler` — so it was always `undefined` and every request fell back to
   the socket address. Behind the Entra ID proxy that is the *proxy's* address,
   so all 100 users shared one 300/min bucket. Fixed by moving authentication to
   an `onRequest` hook on the authenticated scope and adding a per-user and
   per-label limiter (`apps/api/src/core/http/fair-use.ts`) that runs after it.
2. **The per-IP ceiling was too low to be safe behind a proxy.** The first run
   refused 893 of 10,136 requests against a 9,000/min default. Raised to
   30,000/min with the arithmetic recorded in the env contract.
3. **Domain refusals inside a job were reported as crashes.** Every job in the
   first run died with `internal_error` and "er is een onverwachte fout
   opgetreden" when the real cause was a plain `not_found`. The runner's catch
   chain did not handle `AppError`. Fixed, with a failure-kind mapping and
   tests in `apps/worker/tests/runner.test.ts`.

A fourth defect was found by the end-to-end run alongside it: moving generation
onto the worker had moved the workflow gates with it, so asking for concepts
without an approved brief returned `202 Accepted` instead of `409`. Fixed with
pre-enqueue gate checks and pinned by
`apps/api/tests/integration/generation-gates.test.ts`.

## 5. Sizing guidance

Derived from the above, to be revised when any of it is measured again.

| Knob | Default | Raise when |
| --- | --- | --- |
| `DATABASE_POOL_MAX` | 20 | Sustained p95 rises while CPU is idle. Keep `max_connections` above the sum across all API replicas *and* workers. |
| `WORKER_CONCURRENCY` | 8 | Queue head age grows. Cheap for text jobs; watch CPU for image-heavy ones. |
| `WORKER_MAX_JOBS_PER_LABEL` | 4 | One label legitimately needs more of the pool than the others. |
| `RATE_LIMIT_MAX_PER_MINUTE` | 30,000 | In step with user count: roughly 75/min per user, times four for headroom. |
| `RATE_LIMIT_USER_MAX_PER_MINUTE` | 600 | Rarely. A real user does not exceed ~75/min. |
| `RATE_LIMIT_USER_GENERATION_PER_MINUTE` | 20 | A power user is legitimately blocked. |
