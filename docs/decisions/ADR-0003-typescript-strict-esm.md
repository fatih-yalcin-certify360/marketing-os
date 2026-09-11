# ADR-0003 — TypeScript 5.9, strict, NodeNext ESM

**Status:** Accepted · **Date:** 2026-09-09

## Context

End-to-end TypeScript with strict type checking is a fixed requirement.

## Decision

TypeScript `~5.9.3` with `strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`,
`noFallthroughCasesInSwitch`, `noUnusedLocals`/`Parameters`,
`verbatimModuleSyntax` and `isolatedModules`. Module resolution is `NodeNext`;
relative imports carry explicit `.js` extensions.

**TypeScript 7 (the native compiler) is deliberately not used yet:**
`typescript-eslint@8` declares `typescript: >=4.8.4 <6.1.0`, so adopting 7 would
mean giving up type-aware linting — including `no-floating-promises`, which in
this codebase is what catches an unawaited transaction. Revisit when
typescript-eslint supports it.

`erasableSyntaxOnly` is **off**: constructor parameter properties are used
throughout the service layer, and every entrypoint is transformed by tsx (dev),
tsup (api/worker) or Vite (web) rather than relying on Node's type stripping.

## Rejected

- **`strict` without the extra flags.** `noUncheckedIndexedAccess` alone caught
  several real cases where a query's first row was assumed to exist.
- **Path aliases instead of workspace package names.** Package names work
  identically in tsc, tsx, Vite and esbuild without four separate alias configs.

## Consequences

- Accepted: `exactOptionalPropertyTypes` requires conditional object building
  rather than passing `undefined` (see the API client's `RequestInit`). Slightly
  more verbose; catches a real class of bug.
- Accepted: explicit `.js` extensions in relative imports look odd to newcomers
  but are correct for Node ESM and need no bundler to resolve.
