# ADR-0009 — One Zod contract package for all boundaries

**Status:** Accepted · **Date:** 2026-09-09

## Context

Three boundaries need runtime validation: HTTP requests, stored job payloads,
and AI provider responses. Requirement: file input and API input must feed the
same validation contract, and provider output must be schema-validated at
runtime. The frontend needs the same types.

## Decision

`@c360/contracts` holds Zod 4 schemas plus the types inferred from them, and is
imported by the API, the worker and the browser. It contains no server-only or
browser-only imports.

Validation happens at each boundary:
- HTTP: `schema.parse(request.body)` in the handler; a `ZodError` is mapped to
  `validation_failed` with field paths.
- Jobs: the handler validates its own stored payload, so a payload whose shape
  changed under a deploy fails as `validation_failed` rather than being coerced.
- Providers (Phase 2): the same schemas validate model output, with bounded
  repair/retry.

## Rejected

- **Fastify JSON Schema.** Fast, but a second schema language that the worker
  and the browser cannot share.
- **TypeBox.** Good JSON Schema story, weaker ergonomics for the transforms and
  cross-field refinements the env and domain schemas need.
- **Hand-written type guards.** Would drift from the types immediately.

## Consequences

- Accepted: Zod validation is slower than compiled JSON Schema. Irrelevant at
  this request volume; revisit only with a measurement.
- Gained: the error envelope is uniform, so the SPA never invents error copy —
  it renders the Dutch `message` the server sent.
- Gained: one place defines what a valid persona, brief or content asset is,
  whether it arrived by upload, by API, or from a model.
