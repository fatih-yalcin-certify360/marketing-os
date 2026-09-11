# Production readiness checklist

**Current state: not ready for production, and deliberately so.** Phase 5 is
where production connection happens, and it needs input from IT and the
Information Security Officer that has not been supplied yet.

This list is what "ready" would mean. Nothing here is claimed as done unless it
is marked done.

## Blocking

- [ ] **Trusted header contract agreed and verified in the target environment** —
      [trusted-header-contract.md](trusted-header-contract.md), R-01. In
      particular: the app must not be reachable past the proxy, and the proxy
      must strip client-supplied identity headers.
- [ ] **AI provider data processing terms confirmed** — region, retention,
      training use (R-04). Must be answered before real label data reaches a
      provider.
- [ ] TLS termination in front of the API, with HSTS set by the proxy (the app
      deliberately does not set HSTS over plain HTTP inside the network).
- [ ] Encryption at rest for the database and for backups.
- [ ] Secret storage outside the repository, with a rotation procedure that does
      not require rebuilding the image.
- [ ] **One rehearsed restore from backup** (R-10).
- [ ] `TRUSTED_PROXY_IPS` populated with the proxy's real egress addresses.
- [ ] `AUTH_PROXY_SHARED_SECRET` provisioned (min 32 chars) and rotatable.
- [ ] `CORS_ALLOWED_ORIGINS` set to the real application origin.

## Already enforced by the application

- [x] Refuses to start with `AUTH_MODE=local` when `NODE_ENV=production`.
- [x] Refuses to start with `AI_PROVIDER=mock` when `NODE_ENV=production`.
- [x] Refuses `trusted-header` mode without a trusted-proxy allow-list, and in
      production without a proxy shared secret.
- [x] Seed and reset scripts refuse to run in production.
- [x] Deny-by-default authorisation; `not_found` rather than `forbidden` for
      another label's records.
- [x] Non-root containers, all capabilities dropped, read-only root filesystem,
      no Docker socket, worker exposes no port.
- [x] Migrations applied before the API and worker start.
- [x] Graceful shutdown draining in-flight requests.
- [x] Statement timeout, request body limit, rate limiting, deny-by-default CORS.
- [x] No secrets or server modules in the browser bundle — asserted in CI.

## Before scale claims

- [ ] Load test with realistic job mix; record measured numbers (R-03).
- [ ] Decide `WORKER_CONCURRENCY` and `DATABASE_POOL_MAX` from measurement, not
      from the current defaults.
- [ ] Alerting: today nothing alerts; a failure would be noticed by a person.

No capacity, throughput or latency figure should be quoted until the load test
exists. The current defaults are starting points, not measurements.

## Operational gaps

- [ ] Log aggregation and retention period.
- [ ] Uptime/health monitoring on `/health` and `/ready`.
- [ ] Queue-depth and job-failure alerting.
- [ ] Budget-exhaustion alerting per label.
- [ ] Named incident contacts and out-of-hours escalation.

## Operational endpoints

`/health`, `/ready` and `/metrics` answer without authentication, because an
orchestrator and a scraper have no session. `surface-authz.test.ts` asserts none
of them carries a UUID, a label name or an e-mail address.

`/metrics` still reveals **how busy** the system is — queue depth and
rate-limit bucket counts. That is the endpoint's purpose, so the control is to
keep the port reachable only from inside the deployment network rather than to
blind the operator. Not configured here: this repository builds the images and
does not own the network.
