# Decision records

Short records of decisions that would be expensive to reverse or that a future
reader would otherwise have to reconstruct from the code. Each states the
context, the decision, what was rejected and why, and the consequences we
accept.

Status values: **Accepted**, **Superseded by ADR-xxxx**, **Proposed**.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](ADR-0001-modular-monolith.md) | Modular monolith plus a separate worker | Accepted |
| [0002](ADR-0002-npm-workspaces.md) | npm workspaces as the monorepo tool | Accepted |
| [0003](ADR-0003-typescript-strict-esm.md) | TypeScript 5.9, strict, NodeNext ESM | Accepted |
| [0004](ADR-0004-fastify.md) | Fastify 5 for the HTTP layer | Accepted |
| [0005](ADR-0005-drizzle-and-sql-migrations.md) | Drizzle for queries, hand-written SQL migrations | Accepted |
| [0006](ADR-0006-postgres-job-queue.md) | Job queue in our own PostgreSQL schema | Accepted |
| [0007](ADR-0007-identity-adapters.md) | Pluggable identity adapters, no in-app auth | Accepted |
| [0008](ADR-0008-deny-by-default-authorisation.md) | Deny-by-default, label-scoped authorisation | Accepted |
| [0009](ADR-0009-zod-shared-contracts.md) | One Zod contract package for all boundaries | Accepted |
| [0010](ADR-0010-pglite-integration-tests.md) | PGlite for integration tests, real PostgreSQL in CI | Accepted |
| [0011](ADR-0011-react-vite-frontend.md) | React 19 + Vite + TanStack Query | Accepted |
| [0012](ADR-0012-immutable-versions-and-approvals.md) | Immutable versions; approval binds to one version | Accepted |
| [0013](ADR-0013-ai-provider-adapters.md) | Task-scoped AI adapters, no silent mock fallback | Accepted |
| [0014](ADR-0014-dutch-interface.md) | Dutch interface, content language per campaign | Accepted |
| [0015](ADR-0015-openai-provider.md) | OpenAI via the Responses API with strict Structured Outputs | Accepted |
| [0016](ADR-0016-queued-generation.md) | All generation runs as a job; no model call in a request | Accepted |
| [0017](ADR-0017-ssrf-guard.md) | Outbound fetching guarded on the resolved address, every redirect hop | Accepted |
| [0018](ADR-0018-sources-and-research.md) | Sources are registered, not discovered; findings carry provenance | Accepted |
| [0019](ADR-0019-litellm-gateway.md) | LiteLLM as a gateway on the OpenAI-compatible adapter; capabilities declared, not assumed | Accepted |

## Writing a new one

Copy the shape of an existing record. Keep it under a page. Record what was
**rejected** — that is the part which saves the next reader the most time.
