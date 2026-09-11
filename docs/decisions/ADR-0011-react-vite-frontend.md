# ADR-0011 — React 19 + Vite + TanStack Query

**Status:** Accepted · **Date:** 2026-09-09

## Context

A React-based frontend is a fixed requirement. The interface is a
data-heavy internal tool: long-running jobs to poll, versioned records to
compare, forms whose save state must be visible, and no secrets in the bundle.

## Decision

React 19, Vite 8, React Router 7, TanStack Query 5. No CSS framework — design
tokens and primitives in `@c360/ui`, taken from the approved Certify360
interface designs.

The API is served same-origin under `/api` in every environment; in development
Vite proxies it, so the browser origin matches production and CORS never has to
be relaxed for local work.

## Rejected

- **Next.js.** Server-side rendering and route handlers would create a second
  server-side place where authorisation could be enforced, next to the API.
  This is an internal tool behind an authenticating proxy; SEO is irrelevant and
  a single authorisation surface is worth more.
- **Tailwind.** The design language is already defined by the approved designs
  as a small token set. Hand-written CSS with custom properties keeps the
  generated markup readable and avoids a build-time dependency for styling.
- **Redux / Zustand for server data.** The hard problems here are caching,
  invalidation and polling, which TanStack Query solves directly. Local UI state
  is small enough for `useState`.

## Consequences

- Accepted: `mutations.retry = false` globally. A silently retried POST is how
  duplicate work and duplicate cost get created; retry is the user's decision.
- Accepted: job polling runs at 1.5 s only while a job is active and stops
  entirely once everything is terminal, so an idle screen makes no requests.
- Accepted: `localStorage` holds only the selected label — a per-browser
  convenience, never a source of authority. A stored id the user no longer has
  access to simply stops matching.
- Accepted: no web font is loaded. The token set names Inter first but falls
  back to the system stack, so there is no external request and no personal data
  sent to a font CDN.
