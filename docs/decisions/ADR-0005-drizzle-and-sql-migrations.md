# ADR-0005 — Drizzle for queries, hand-written SQL migrations

**Status:** Accepted · **Date:** 2026-09-09

## Context

Direct PostgreSQL, no Supabase. The schema needs composite foreign keys for
tenant isolation, partial indexes for the queue's hot path, `CHECK` constraints
on every enum-like column, and `SELECT ... FOR UPDATE SKIP LOCKED`. Around 25
entities are planned, which is more than is comfortable to hand-type in SQL
strings.

## Decision

- **Queries:** Drizzle ORM over `node-postgres`. Typed selects/inserts, SQL-shaped
  API, no lazy-loading or identity-map surprises.
- **Schema:** hand-written, forward-only `.sql` migrations in
  `apps/api/db/migrations`, applied by a small runner
  (`src/core/db/migrate.ts`) that records a SHA-256 per migration and takes a
  session advisory lock.
- **Drift protection:** `tests/integration/schema-parity.test.ts` applies the real
  migrations to a real PostgreSQL and asserts every table and column the Drizzle
  definitions declare actually exists.

## Rejected

- **Prisma.** A separate engine binary, awkward multi-arch container builds, and
  the constraints we need (composite FKs, partial indexes) fall outside its
  schema language — meaning raw SQL escape hatches anyway.
- **`drizzle-kit generate`.** Generates migrations from the TS schema, but does
  not express partial indexes or composite foreign keys the way we need, and
  produces migrations that are harder to review line by line. Reviewable SQL is
  also worth more for change control.
- **Raw `pg` with no query layer.** Rejected on maintainability: 25 entities of
  hand-written SQL strings for a single developer invites typos that types would
  have caught.

## Consequences

- Accepted: the SQL and the Drizzle definitions are two representations of one
  schema and can drift. The parity test is the control; it fails loudly, and a
  renamed column cannot pass CI.
- Accepted: no automatic down-migrations. Rollback is a new forward migration —
  deliberate, because an automatic down-migration on production data is a data
  loss risk, not a safety net.
- Gained: editing a released migration fails the checksum check instead of
  silently leaving environments on divergent schema.
