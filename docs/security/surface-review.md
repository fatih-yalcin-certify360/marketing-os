# Security review of the accumulated surface

**Reviewed:** 2026-09-11, covering everything built through Phase 4. Reviewer:
the engineer who wrote most of it, which is the main limitation of this
document — see *What this review is not* at the end.

A review that concludes "the code was read and it looked correct" decays the
day somebody adds a route, and a reader cannot tell a reviewed surface from an
unreviewed one. So wherever a finding could be expressed as a test, it was:
`apps/api/tests/integration/surface-authz.test.ts` walks **Fastify's own route
table** — not a list anybody maintains — and holds the properties below on every
commit.

## Method

1. Enumerated every registered route from `app.printRoutes()`, rather than from
   a hand-kept inventory, because the inventory is the thing that goes stale.
2. Called every label-scoped route with a label that **exists and does not
   belong to the caller** (`demolabel-5`, which the seed deliberately creates
   with no membership). An id that does not exist would prove much less:
   refusing something absent is easy.
3. Classified each answer. A **2xx** means data was served to a non-member; a
   **5xx** means the check crashed instead of deciding. Both fail the suite.
4. Audited all 161 service methods for an authorisation or ownership check, and
   read by hand every one the automated pass could not account for.
5. Checked the unauthenticated endpoints for anything identifying.

## Findings

### 1. `GET /labels/:labelId/members/candidates` answered for any label — fixed

**Severity: low, but a real crossing.** The route answered `200` for every
label id, including one belonging to **another organisation**.

`member:manage` is an *organisation* permission on purpose: a brand-new label
has no members, so requiring membership to manage members would make a new
label unmanageable by anyone. An org administrator therefore administers every
label in their organisation, and seeing candidates for a label they are not a
member of is inside that authority.

What was missing was the boundary of that authority. The label id arrived from
the client and went straight into a subquery that excludes current members,
without anyone checking whose label it was. The returned users are always the
caller's own organisation, so the data itself did not cross — but the
**absence** of a user from the candidate list is information about that label's
membership, and a `200` also confirms the id is real. Everywhere else in this
product a label the caller cannot reach reads as `not_found`, precisely so ids
are not oracles.

Fixed by `requireLabelInOrganisation` in `members-service.ts`. Held by *"stops
organisation authority at the organisation boundary"*, which creates a second
organisation and asserts the route answers `404` for its label while still
answering `200` inside the caller's own — so the fix cannot have been to simply
close the route.

**The first version of this review's test was also wrong**, and that is worth
recording: it assumed *every* label-scoped route requires membership. It does
not, and the exception is legitimate. The test now names the exception instead
of hiding it.

### 2. `/metrics` promised no identifiers and nothing checked — now checked

**Severity: none today; a plausible future leak.** The endpoint is
unauthenticated by design — an orchestrator and a scraper have no session — and
carries a comment promising "operational counters only: no user content, no
label names, no identifiers". That was true and unverified. A per-label gauge
with the label's name in the series is the obvious next metric somebody adds,
and it would publish a customer list to anything that can reach the port.

Now asserted: no UUID, no seeded label name and no e-mail address appears in
`/health`, `/ready` or `/metrics`.

Queue depth still reveals *how busy* the system is. That is the endpoint's
purpose, and the answer is to keep the port internal in production rather than
to blind the operator — recorded in `production-readiness.md`.

### 3. No other authorisation gap found

Every other label-scoped route refused a non-member, and every service method
reachable from a route authorises or scopes its query by label. Two methods the
automated pass flagged — `campaign-packages.generate` and `market-radar.preview`
— are guarded one call deeper (`assertReady` holds `content:write`; `preview`
delegates to `requireRun`), which the heuristic's window missed rather than the
code being wrong.

## Residual, and why it is residual

**Seventeen `POST`/`PATCH` routes are inconclusive under the automated walk.**
A request with no body is refused by schema validation *before* authorisation,
and a `422` does not prove a permission check exists. They are listed by the
suite on every run rather than counted as passing, and each was read by hand
for this review; all seventeen authorise in the service they call. What cannot
be automated is the *next* one somebody adds.

Two ways to close it were considered and rejected for now:

- **Synthesising a valid body per route.** Seventeen fixtures that go stale
  with every schema change, and a stale fixture reports a false pass.
- **Authorising before validation**, via a scope-level hook on `:labelId`. This
  is the better answer and is recorded as a backlog item. It has to keep the
  organisation-administration exception above working, which is exactly the
  kind of exception that goes wrong in a hook, so it deserves its own change
  rather than a paragraph at the end of a review.

## What this review is not

- **Not an external assessment.** It was carried out by the author of most of
  the code. Someone who did not write it will see things this could not, and
  P5 lists an external review before production.
- **Not a penetration test.** No fuzzing, no timing analysis, no dependency
  exploitation, no attempt at the AI-specific attacks beyond what `T-05` covers.
- **Not a statement about a production deployment.** There is not one. The
  trusted-header contract is unverified against a real proxy (`R-01`), and TLS,
  secret storage and encryption at rest are deployment concerns this repository
  does not configure.
- **No claim of "zero vulnerabilities" is made or implied.** The findings above
  are what this method could find, and the method's limits are stated so the
  next reviewer knows where to start.

## Where the standing guarantees live

| Property | Held by |
| --- | --- |
| Every label-scoped route refuses a non-member | `surface-authz.test.ts` |
| Organisation authority stops at the organisation | `surface-authz.test.ts` |
| Absent and inaccessible are indistinguishable | `surface-authz.test.ts`, `label-isolation.test.ts` |
| Unauthenticated endpoints carry no identifier | `surface-authz.test.ts` |
| Cross-label reads and writes are refused | `label-isolation.test.ts` |
| Identity headers cannot be forged or replayed | `trusted-header-auth.test.ts` |
| Development auth and mock AI refuse to start in production | `env-guards.test.ts` |
| Untrusted files are judged by their bytes | `file-safety.test.ts` (41 tests) |
| Outbound fetches cannot reach internal addresses | `ssrf-guard.test.ts`, `safe-fetch.test.ts` |
| No URL that becomes an `href` can carry script | `web-url.test.ts` |
| Generated e-mail HTML cannot carry script or phone home | `email-html.test.ts` |
| A restore is verified, files included | `restore-drill.test.ts` |
| Dependency and image advisories block a build | `npm run audit:gate`, Trivy |
