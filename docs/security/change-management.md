# Change and release management

Lightweight controls for a single maintainer that still produce a defensible
trail — the ISO 9001/27001 preparation asks for evidence of controlled change,
not for a heavyweight process.

## What is controlled

| Change | Control |
| --- | --- |
| Code | Branch, `npm run verify` green, CI green |
| Database schema | New forward-only `.sql` migration; released migrations are immutable and checksum-verified |
| Architectural decision | Decision record in `docs/decisions/` |
| Authorisation matrix | Code + test + `docs/security/access-matrix.md` updated together |
| Environment/config | `.env.example` documents every variable; env schema validates at boot |
| Container images | Multi-stage, pinned base images, non-root asserted in CI |
| Channel specifications | Only with a source URL and verification date |

## Gates before merge

`npm run verify` runs the same four gates as CI:

1. `typecheck` — strict, whole workspace via project references
2. `lint` — includes the architectural import boundaries (server code cannot
   reach the browser bundle; the API cannot import the worker)
3. `test` — unit + integration against real PostgreSQL semantics
4. `build` — API, worker and SPA

CI additionally: runs the suite against PostgreSQL 18, asserts the browser
bundle contains no server configuration, builds both images, asserts they do not
run as root, and runs dependency/secret/image scans.

## Migration rules

1. Forward-only. A rollback is a **new** migration.
2. Never edit a released migration. The SHA-256 ledger refuses it — deliberately,
   because a silently edited migration leaves environments on divergent schema.
3. Name `NNNN_short_description.sql`, applied in filename order.
4. One concern per migration, so a failure is easy to localise.
5. Each runs in its own transaction; a failure leaves the previous version
   intact.
6. A session advisory lock serialises concurrent runners, so two API containers
   cannot migrate simultaneously on deploy.
7. Destructive changes (drop column, drop table) need an explicit note in the
   migration header saying what data is lost and why it is safe.

## Release record

Each release should record: version/commit, date, what changed, migrations
included, tests run and result, and known open risks. Not yet automated — a
`CHANGELOG.md` generated from commits is a small Phase 4 task.

## Deployment

Production deployment is **not** performed by this project and requires separate
authorisation. When it is set up, the order matters:

1. Build and scan images.
2. Run `migrate` to completion **before** starting new API/worker containers, so
   no process starts against a schema it does not understand. Compose already
   encodes this with `service_completed_successfully`.
3. Start the worker, then the API.
4. Verify `/health` and `/ready`.
5. Confirm `AUTH_MODE=trusted-header` and `AI_PROVIDER` is not `mock` — the app
   refuses to start otherwise, which is the intended last line of defence.

## Separation of duties

Currently none: one person writes, reviews and would deploy. Recorded honestly
as **R-11**. The CI gates and the immutable migration ledger are the
compensating controls.
