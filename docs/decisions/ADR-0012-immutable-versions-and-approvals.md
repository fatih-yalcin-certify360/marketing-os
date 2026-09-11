# ADR-0012 — Immutable versions; approval binds to one version

**Status:** Accepted · **Date:** 2026-09-09

## Context

Requirements state repeatedly: approval attaches to a specific content version;
if a persona, brief, course or brand changes, dependent outputs must be flagged
and are not considered approved until re-reviewed; restoring an older version
must not erase history; and user edits must never disappear silently.

## Decision

Reviewable artefacts (`BrandProfileVersion`, `CourseVersion`, `PersonaVersion`,
`BriefVersion`, `ConceptVersion`, `ContentAssetVersion`) are **append-only
version rows**. A revision inserts version *n+1*; nothing is updated in place.

- An `Approval` references one `(artefact, version)` pair. A new version is
  therefore unapproved by construction, not by a flag someone has to remember
  to clear.
- Restoring an older version creates a **new** version whose content is copied
  from the old one, so history stays intact.
- Dependency changes move dependents to `needs_rereview` (see
  `reviewState` in `@c360/contracts/workflow.ts`).
- A publish-ready export additionally requires every gate in
  `PUBLISH_READY_GATES`; a draft export is always allowed and is labelled a
  draft.
- Concurrent edits are rejected with `stale_version` via an optimistic
  concurrency token, so two editors cannot silently overwrite each other.

## Rejected

- **Mutable rows with an `approved` boolean.** The failure mode is exactly the
  one the requirements warn about: content changes, the flag is not cleared, and
  unreviewed material counts as approved.
- **Soft-delete plus in-place edit.** Loses the intermediate states needed to
  compare versions and to explain what an approver actually approved.
- **One gate check for both export kinds.** Collapsing draft and publish-ready
  into one check would either block ordinary drafting or let an unapproved
  package out as publishable. They are separate permissions and separate gate
  sets.

## Consequences

- Accepted: more rows. Bounded by pagination and per-label indexes; version
  tables are cheap and are the audit trail.
- Accepted: Phase 0 ships the contracts, the state machine and the gate
  functions (`canEnterStage`, `canExportPublishReady`, tested in
  `packages/contracts/tests/workflow-gates.test.ts`); the version *tables*
  arrive with their modules in Phase 1.
- Gained: "why is this not publishable?" is answerable as a list of named,
  Dutch-labelled gates rather than a boolean.
