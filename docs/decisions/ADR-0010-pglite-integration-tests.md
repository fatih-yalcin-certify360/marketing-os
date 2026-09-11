# ADR-0010 — PGlite for integration tests, real PostgreSQL in CI

**Status:** Accepted · **Date:** 2026-09-09

## Context

The most valuable tests here are integration tests: cross-label denial,
`ON CONFLICT` idempotency, `SKIP LOCKED` claiming, budget guards. They need real
PostgreSQL semantics. They must also run on a developer machine with no Docker,
because a missing dependency must not block local development.

## Decision

Two tiers:

1. **Default (`npm test`):** `@electric-sql/pglite` — a real PostgreSQL build
   compiled to WebAssembly, in-process, one fresh database per test file. No
   Docker, no service containers.
2. **CI (`test-real-postgres` job):** the same suites against `postgres:18-alpine`.

`tools/dev-db` wraps PGlite in the PostgreSQL wire protocol so the whole stack
can also *run* without Docker.

## Rejected

- **Mocking the database.** Would test the mock. None of the guarantees we care
  about (constraint enforcement, `SKIP LOCKED`, `ON CONFLICT`, row locking)
  survive mocking.
- **Testcontainers only.** Requires Docker for `npm test`, which contradicts the
  local-development requirement and slows the inner loop.
- **A shared CI database.** Cross-test interference and no clean per-file state.

## Consequences

- **Stated limitation:** PGlite executes queries one at a time, so it proves
  *guards* but not *races*. (`tools/dev-db` accepts several connections, but
  serialises their queries onto one instance, so the limitation is unchanged.)
  The budget suite therefore asserts that an over-limit reservation is refused
  and the balance never goes negative — real concurrent contention is exercised
  by the CI job against PostgreSQL 18. Recorded in
  `docs/product/testing-strategy.md` rather than papered over.
- Accepted: one deliberate type cast, in `apps/api/src/testing/harness.ts`, to
  present PGlite's Drizzle database as the node-postgres flavour that production
  uses. Confined to one line and commented.
- Gained: 106 tests run in about 10 seconds with no external services.
