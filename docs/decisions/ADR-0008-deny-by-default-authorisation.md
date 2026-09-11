# ADR-0008 — Deny-by-default, label-scoped authorisation

**Status:** Accepted · **Date:** 2026-09-09

## Context

Six labels at launch, more later. A leak between labels is the most damaging
failure this system can have. Authorisation must be enforced server-side and
must not be derivable from anything the client sends.

## Decision

A static matrix in `@c360/contracts/access.ts` maps roles to permissions, with
two scopes that are **not** interchangeable:

- organisation roles (`org_owner`, `org_admin`, `org_member`) grant org
  administration only;
- label roles (`label_manager`, `label_editor`, `label_approver`,
  `label_viewer`) grant everything inside one label.

**No organisation role grants read access to a label's brand, courses,
personas, campaigns, briefs or content.** Reading label data always requires a
membership row for that label, so an org admin cannot quietly read another
label's material. This is asserted by test, not just documented.

`requireLabelPermission` throws **`not_found`, not `forbidden`**, when the caller
is not a member: a 403 would confirm the id exists and hand an attacker a label
enumeration oracle.

Defence in depth at the storage layer: `memberships` references `users` and
`labels` through **composite foreign keys including `organization_id`**, so a
membership cannot join a user of one organisation to a label of another even if
application code is wrong.

## Rejected

- **PostgreSQL row-level security.** Attractive, but it needs a per-request
  session variable to carry the tenant, which is easy to forget on a pooled
  connection and produces silent over-broad reads when missed. Explicit
  `organization_id` predicates in repositories plus the composite FKs give a
  comparable guarantee with a failure mode that is visible in code review.
- **Permissions in the JWT/header.** Would make the client a source of
  authority.
- **A single flat role list.** Cannot express "org admin, but not inside this
  label", which is the exact case that matters.

## Consequences

- Accepted: adding a permission means editing the matrix and its test. That is
  the point — the matrix is reviewable in one file.
- Accepted: `effectiveLabelPermissions` is sent to the UI so it can hide actions
  it cannot perform. It is advisory for rendering only; every route re-checks.
- Gained: `apps/api/tests/integration/label-isolation.test.ts` exercises listing,
  reading, enqueueing, IDOR via a foreign job id, forged role headers, and
  database-level tenant guards.
