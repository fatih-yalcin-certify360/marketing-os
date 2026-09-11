# ADR-0013 — Task-scoped AI adapters, no silent mock fallback

**Status:** Accepted · **Date:** 2026-09-09

## Context

One provider at launch, behind a replaceable layer. Three distinct capabilities
are needed: structured text generation, web research, and image generation. A
provider may not support all three. Requirements are explicit that unsupported
capabilities must be stated rather than simulated, that a mock may be used in
development but never silently in production, and that a provider failure must
never become a fake success.

## Decision

Separate adapter interfaces per task — `TextGenerationAdapter`,
`ResearchAdapter`, `ImageGenerationAdapter` — rather than one "AI client".
A provider that does not implement a capability simply does not register it, and
callers receive `capability_unavailable` (HTTP 501) with a Dutch explanation.

Around every call: runtime schema validation of the response, bounded
repair/retry, request/cost/latency recording split into **estimated** and
**actual** columns, prompt template + version recorded per usage row, and budget
reserved before the call.

`AI_PROVIDER=mock` is **refused when `NODE_ENV=production`** by env validation,
so a production deployment cannot serve fabricated output. Mock output is
labelled as such in the interface.

## Rejected

- **One monolithic client interface.** Would force stub methods that throw, or
  worse, stubs that return plausible-looking empty results — the "pretending to
  work" failure the requirements call out.
- **A fallback chain that drops to mock on provider error.** Explicitly rejected:
  it converts an outage into fabricated marketing content.
- **Using a ChatGPT/Claude subscription as an API.** Not permitted, and not a
  supported integration path.
- **Charging estimated cost as actual.** Estimates drive reservations; actuals
  drive reporting. Conflating them makes cost reporting fiction.

## Consequences

- **Phase 0 status:** only the labelled mock exists; no real provider adapter is
  implemented. The env guard is in place and tested
  (`apps/api/tests/unit/env-guards.test.ts`).
- Accepted: three interfaces instead of one is slightly more code, and it is
  what makes "this provider cannot generate images" a first-class, honest answer.
- Accepted: sources and model output are treated as **untrusted data**. Retrieved
  page content is never executed as instructions, and tool permissions available
  to a model stay minimal. The model never decides authorisation, approval or
  data access.
- Open item: data processing location and retention at the provider must be
  confirmed against company policy before Phase 2 goes near real data. Recorded
  in `docs/security/risk-register.md`.
