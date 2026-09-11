# Supplier and dependency inventory

Third parties and significant dependencies the system relies on, so an
availability or security problem at any of them can be assessed quickly.

**Last reviewed:** 2026-09-09.

## External services

| Supplier | Purpose | Data sent | Status |
| --- | --- | --- | --- |
| Microsoft Entra ID (via the company proxy) | User authentication | None by us — the proxy authenticates and passes identity to us | In use conceptually; **header contract not agreed** (R-01) |
| OpenAI | Structured text generation; image generation when explicitly enabled. **No research** — that capability is not implemented and reports as unavailable | Task input only, minimised; `store: false` on every call so no conversation state is retained. **Region, retention and training use unconfirmed** | Adapter written and unit-tested against a stubbed transport; **never run against the live API** (R-16). Blocked on R-04 for real data. Model prices verified 2026-09-09 and need periodic review — see ADR-0015 |
| Anthropic | Alternative text provider | As above | Adapter written, unexercised. Not the configured default |
| `pdfjs-dist` (Mozilla) | Reading the text layer out of an uploaded PDF | Runs entirely locally; no data leaves the process | Apache-2.0, **zero runtime dependencies**, actively maintained (6.3.289, published 2026-08-29). Chosen because writing a PDF parser means parsing untrusted input by hand, and this is the implementation every browser already runs. **Contained:** it runs on the worker in a `worker_threads` worker so a page that never yields can be terminated; after upload validation, on a file whose type and size are already judged; with font faces, system fonts, XFA, worker fetch, base/font/CMap URLs and image decoding all off; and with page, character and wall-clock ceilings. Review its advisories with the dependency scan |
| LinkedIn / Meta / Google | Channel specifications, read from public documentation | Nothing | Documentation only. No account connection, no publishing, no ad spend |

There is deliberately **no** direct social publishing and **no** advertising
account connection. Exports are files the user takes elsewhere; publication
status is something the user records manually. "Approved" never means
"published".

## Runtime dependencies (in the production images)

| Dependency | Version | Role | If it breaks |
| --- | --- | --- | --- |
| Node.js | 24 (alpine) | Runtime | Pinned base image; rebuild on security release |
| PostgreSQL | 18 (alpine) | Sole datastore | Hard dependency. No queue, cache or session store to fail separately |
| Fastify | 5.x | HTTP | ADR-0004 |
| `pg` (node-postgres) | 8.x | Driver | Bundled |
| Drizzle ORM | 0.45.x | Query layer | Queries are SQL-shaped; migrations are plain SQL, so an exit is bounded |
| Zod | 4.x | Validation | Used at every boundary; a breaking change is a contained refactor |
| pino | 10.x | Logging | |

Note what is *absent*: no Redis, no message broker, no external session store,
no object-storage SDK yet. Fewer suppliers, fewer failure modes.

## Build and development dependencies (not in runtime images)

TypeScript 5.9, Vite 8, tsup/esbuild, Vitest 5, ESLint 10 + typescript-eslint 8,
Playwright, PGlite (`@electric-sql/pglite`, `-socket`).

Two constraints worth recording because they shaped decisions:

- **typescript-eslint 8 requires `typescript <6.1`**, which is why TypeScript 7
  is not adopted (ADR-0003). Revisit when typescript-eslint supports it.
- **PGlite serialises queries** (it accepts several connections via
  `tools/dev-db`, but runs one query at a time), which is why CI also runs the
  suite against real PostgreSQL 18 (ADR-0010, R-02).

## Infrastructure — to confirm

Hosting, TLS termination, secret storage, backup storage and log retention are
all provided by the company environment and are **not yet specified**. Required
of whatever is chosen: TLS in transit, encryption at rest for database and
backups, a secret store that is not the repository, and an off-site backup copy
in a separate trust domain.

## Review

At the end of each phase, and whenever a supplier is added: confirm what data
flows to it, whether a data processing agreement exists, and what happens if it
is unavailable.
