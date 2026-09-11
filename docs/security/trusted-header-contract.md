# Trusted header contract — OPEN ITEM

**Status: not agreed. Production authentication is not complete.**

The application is built to receive identity from the company's reverse proxy
after it authenticates the user against Entra ID. The code for this exists and
is tested (`TrustedHeaderAuthAdapter`), but the *contract* has not been
confirmed with whoever operates the proxy. Until the questions below are
answered and the answers are re-tested, no claim of production-ready
authentication should be made.

## What the application already does

Header names are configurable, so agreeing on names later costs a configuration
change and no code:

| Setting | Default | Meaning |
| --- | --- | --- |
| `AUTH_HEADER_SUBJECT` | `x-c360-subject` | Stable user id (Entra ID object id) |
| `AUTH_HEADER_EMAIL` | `x-c360-email` | User e-mail |
| `AUTH_HEADER_NAME` | `x-c360-name` | Display name |
| `AUTH_HEADER_PROXY_SECRET` | `x-c360-proxy-secret` | Shared secret proving the request came from the proxy |
| `TRUSTED_PROXY_IPS` | *(empty — denies all)* | Peers permitted to supply identity headers |
| `AUTH_PROXY_SHARED_SECRET` | *(required in production)* | Expected secret value, min 32 chars |

Enforced before any header is read:

1. `socket.remoteAddress` must match `TRUSTED_PROXY_IPS`. Forwarded-for headers
   are ignored (`trustProxy: false`).
2. The proxy shared secret must match, compared in constant time.
3. Subject and e-mail must be single-valued and well-formed. A **duplicated**
   header arrives as an array and is rejected outright rather than resolved.

The adapter can assert only subject, e-mail and display name. It has **no role
and no label field**, so a forged `X-Roles` or `X-Labels` header has nowhere to
land — access comes from `memberships` rows on every request.

If the Entra ID setup uses App Service / Easy Auth style headers, the likely
mapping is `AUTH_HEADER_SUBJECT=X-MS-CLIENT-PRINCIPAL-ID` and
`AUTH_HEADER_EMAIL=X-MS-CLIENT-PRINCIPAL-NAME`. This is a **guess** and must be
confirmed — the code is already tested with those names, but that proves the
configurability, not the contract.

## Questions that must be answered before production

| # | Question | Why it matters |
| --- | --- | --- |
| 1 | Exact header names the proxy writes | Configuration; must be exact |
| 2 | **Does the proxy strip inbound copies of these headers from the client request?** | If it does not, a client can supply its own and the proxy may append rather than overwrite — the single most important question here |
| 3 | Can the application be reached at all without traversing the proxy? | If yes, the IP allow-list is the only control and network policy must close the path |
| 4 | Is the subject value stable across renames and e-mail changes? | We key users on it; an unstable value creates duplicate accounts |
| 5 | Does the proxy sign its assertions (e.g. a JWT), or only pass plain headers? | A signature is stronger than a shared secret and would change the design |
| 6 | Which source IPs / CIDRs does the proxy egress from? | Fills `TRUSTED_PROXY_IPS` |
| 7 | How is the shared secret provisioned and rotated? | Rotation must not require a code change |
| 8 | What does the proxy send for a user whose session expired? | Determines whether we can distinguish "not signed in" from "no access" |
| 9 | Is there a group/role claim, and should it map to `org_role`? | Today `org_role` is assigned inside the product and never overwritten from a header — deliberate, and should stay so unless there is a reason |
| 10 | Which organisation does a user belong to, for multi-tenant use? | Phase 0 resolves a single organisation from the database; a tenant claim would replace that lookup |

## Verification required once answered

Re-run and extend `apps/api/tests/unit/trusted-header-auth.test.ts` with the real
names, then verify in the target environment:

- [ ] A request that bypasses the proxy is refused (or is proven unroutable).
- [ ] A client-supplied copy of the identity header cannot survive the proxy.
- [ ] A duplicated header is rejected end to end, not just in unit test.
- [ ] A wrong shared secret is refused.
- [ ] An expired session produces a clean `unauthenticated`, not a blank page.
- [ ] Rotating the shared secret does not require a redeploy of the app image.

## Until then

- `AUTH_MODE=local` is refused when `NODE_ENV=production`, so the development
  identity cannot be used as a stopgap.
- `AUTH_MODE=trusted-header` refuses to start without `TRUSTED_PROXY_IPS`, and
  in production also without `AUTH_PROXY_SHARED_SECRET`.

Tracked as **R-01** in [risk-register.md](risk-register.md).
