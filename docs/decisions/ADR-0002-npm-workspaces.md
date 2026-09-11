# ADR-0002 — npm workspaces as the monorepo tool

**Status:** Accepted · **Date:** 2026-09-09

## Context

Four applications/packages plus shared contracts need one dependency tree, one
lockfile and one command to verify everything.

## Decision

npm workspaces, with the npm version that ships with Node 24.

## Rejected

- **pnpm.** Better disk usage and stricter peer resolution, but it is an extra
  tool every developer and CI runner must install first. Not worth it at four
  workspaces.
- **Turborepo / Nx.** Task caching solves a build-time problem this repository
  does not have; `npm run verify` completes in well under a minute.
- **Separate repositories.** Would force versioned releases of the contracts
  package between a schema change and the UI that consumes it.

## Consequences

- Accepted: no remote build cache. Revisit if CI time becomes a real cost.
- Accepted: npm's flat hoisting means a package can import a dependency it did
  not declare. The lint import boundaries catch the cases we actually care
  about (server code in the browser bundle, api importing worker).
- Gained: `git clone && npm ci` is the whole setup, and one lockfile pins the
  entire tree for reproducible container builds.
