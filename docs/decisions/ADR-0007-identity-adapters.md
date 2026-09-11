# ADR-0007 — Pluggable identity adapters, no in-app authentication

**Status:** Accepted · **Date:** 2026-09-09

## Context

In production the company's reverse proxy authenticates against Entra ID and
passes identity to the application as request headers. The application must not
implement its own OAuth flow or password store. Local development needs a
clearly separated test identity. The real header contract is not available yet.

## Decision

An `AuthAdapter` interface with two implementations:

- `LocalAuthAdapter` — one fixed development identity, ignores the request.
- `TrustedHeaderAuthAdapter` — reads configurable headers, but only after the
  socket peer matches `TRUSTED_PROXY_IPS` and the proxy shared secret matches
  (constant-time comparison).

An adapter may assert only `externalSubject`, `email`, `displayName` and
`authMode`. **There is no role field and no label field in the type.** Roles and
label access are resolved from `memberships` rows on every request.

Production guards are duplicated on purpose: `loadServerEnv` refuses
`AUTH_MODE=local` when `NODE_ENV=production`, *and* `createAuthAdapter` refuses
to construct it. Two independent checks, because this is the
highest-severity misconfiguration in the system.

## Rejected

- **Trusting header presence.** Rejected explicitly: without the peer check, any
  request that reaches the app past the proxy could assert any identity.
- **Reading `X-Forwarded-For` for the trust decision.** Client-controlled;
  `trustProxy` is therefore off and only `socket.remoteAddress` is used.
- **Picking the first value of a duplicated header.** A duplicate arrives as an
  array — the classic way to smuggle a second value past a proxy that only
  overwrote the first. Any array is rejected outright.
- **Sessions/cookies in the application.** Would create a CSRF surface the
  header model does not have.

## Consequences

- **Open item:** production authentication is **not complete**. The header names,
  whether the proxy strips inbound copies, and whether it signs its assertions
  are all unconfirmed. See `docs/security/trusted-header-contract.md`. No claim
  of production-ready authentication is made until that document is filled in
  and re-tested.
- Accepted: a forged `X-Roles` header is structurally inert, which is stronger
  than filtering it — there is nowhere for it to land.
- Accepted: revoking a membership takes effect on the next request, because
  access is re-derived every time rather than cached in a token.
