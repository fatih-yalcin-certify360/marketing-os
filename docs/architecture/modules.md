# Module map and boundaries

## The boundary rule

Each module owns its tables and its business rules. Modules integrate through
each other's **services**, never by reading or writing another module's tables.

Why it is stated so bluntly: the cheapest way to lose tenant isolation is for
one module to query another's tables and forget the `organization_id`
predicate. Keeping data access inside the owning module means the predicate
lives in one place per table.

Enforced by:
- directory structure — a repository sits next to the tables it owns;
- `no-restricted-imports` in `eslint.config.js` for the cross-app direction
  (worker → api, never api → worker; nothing server-side in the browser bundle);
- code review for module-to-module access.

## Status

| Module | Owns | Phase | Status |
| --- | --- | :-: | --- |
| `identity-access` | `organizations`, `users`, `memberships` | 0 | **Built.** Provisioning from the authenticated subject; memberships are the only source of label access |
| `organizations-labels` | `labels` | 0 | **Built.** Accessible-label listing, readiness, Werkruimte read model, honest availability reporting |
| `jobs-usage` | `jobs`, `usage_records`, `label_budgets` | 0 | **Built.** Queue, idempotency, retry, cancellation, reaper, budget reservations, cost accounting |
| `audit` | `audit_events` | 0 | **Built.** Access decisions only; content is structurally excluded |
| `brand` | `brand_profile_versions`, brand assets | 1 | Not built |
| `courses` | `course_versions` | 1 | Not built |
| `sources-research` | `source_documents`, `research_runs`, `evidence` | 1 | Not built |
| `personas` | `persona_versions` | 1 | Not built |
| `opportunities` | `opportunities` | 1 | Not built |
| `campaigns-briefs` | `campaigns`, `brief_versions` | 1 | Not built |
| `concepts` | `concept_versions` | 2 | Not built |
| `content-assets` | `content_asset_versions` | 2 | Not built |
| `reviews-approvals` | `approvals` | 1 | Not built |
| `exports` | `exports`, `publication_records` | 2 | Not built |
| `outcomes-learning` | `outcomes`, `learnings` | 4 | Not built |

Directories are created when a module is built. Empty scaffolding would be
noise, and would make the codebase look further along than it is.

## Module anatomy

```
modules/<domain>/
  routes.ts       HTTP shape, Zod validation, calls the service
  service.ts      business rules, transactions, authorisation
  repository.ts   data access for this module's tables only
  index.ts        the public surface other modules may use
```

The Werkruimte read model (`organizations-labels/workspace-service.ts`) is the
one place that composes across modules — and it does so through their services,
which is exactly the sanctioned path.

## Cross-cutting concerns

Not duplicated per module:

| Concern | Where |
| --- | --- |
| Authentication | `core/auth` |
| Authorisation | `core/authz` + the matrix in `@c360/contracts` |
| Errors | `core/errors` |
| Database access | `core/db` |
| Validation schemas | `@c360/contracts` |
| Environment | `@c360/config` (server-only) |
| Audit | `audit` module service, injected |

There is deliberately **no** `utils` package. Helpers live next to what they
serve; a general-purpose dumping ground is how modules start depending on each
other by accident.

## Adding a module

1. Write the SQL migration. Include `organization_id`, and a composite foreign
   key to `labels (id, organization_id)` for anything label-scoped.
2. Mirror it in `core/db/schema.ts` — the parity test will confirm it matches.
3. Add permissions to the access matrix and update its test and
   `docs/security/access-matrix.md`.
4. Write repository → service → routes.
5. Register routes in `server.ts`.
6. **Add a cross-label isolation test.** Not optional; this is the class of bug
   that matters most here.
7. Update `MODULE_AVAILABILITY` so the UI stops reporting the area as
   unavailable — and only when it genuinely works.
