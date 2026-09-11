# ADR-0004 — Fastify 5 for the HTTP layer

**Status:** Accepted · **Date:** 2026-09-09

## Context

The API is a JSON service for our own SPA. It needs schema validation,
structured logging, a plugin model for security middleware, and first-class
support for testing without binding a port.

## Decision

Fastify 5, with `@fastify/helmet`, `@fastify/cors` and `@fastify/rate-limit`.
Validation is Zod at the handler boundary (ADR-0009) rather than Fastify's JSON
Schema, so one schema serves the API, the worker and the browser.

## Rejected

- **Express 5.** Smaller ecosystem for typed plugins, no built-in structured
  logging, and no equivalent of `app.inject()`.
- **NestJS.** Its module/DI system duplicates the structure we already get from
  the module layout, at the cost of decorators and a much larger surface for one
  maintainer.
- **Hono.** Attractive and small, but Fastify's plugin encapsulation and mature
  `helmet`/`rate-limit` integrations matter more here than edge portability we
  do not need.

## Consequences

- Gained: `app.inject()` lets the integration suite exercise real routes,
  hooks and the error handler over HTTP with no port and no flakiness. Every
  cross-label isolation test runs through the real routing stack because of it.
- Accepted: Fastify's own errors use its codes, so `toAppError` maps them onto
  our closed error-code set. One place, explicitly.
- Accepted: `trustProxy` is off. `request.ip` therefore ignores
  `X-Forwarded-For`, which is exactly what we want — the trusted-proxy check
  reads `socket.remoteAddress`.
