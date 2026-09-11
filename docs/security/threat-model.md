# Threat model

**Scope:** Certify360 Marketing OS as built through Phase 2 — API, worker, SPA,
PostgreSQL, the outbound fetcher, the file-upload surface and the AI provider
adapters. **Last reviewed:** 2026-09-10.

Two entries in this document had gone stale in the direction that matters most:
they said a surface did not exist when it did (T-06, T-07). A threat model that
understates the surface is worse than none, because it is read as a statement
that nothing needs checking. Both now describe what is built.

This is a living document. Threats for features that do not exist yet are listed
with the phase that introduces them, so the control is designed before the
feature rather than after.

No claim is made that the system is free of vulnerabilities.

## Assets

| Asset | Why it matters |
| --- | --- |
| Label-scoped marketing material (brand, courses, personas, briefs, content) | Commercially sensitive; a leak between labels is the worst realistic outcome |
| Course truth (conditions, duration, price, dates) | Incorrect published information carries regulatory and reputational cost |
| Approval records | Determine what may be published; forging one bypasses human review |
| Identity and membership data | Determine all access |
| AI provider credentials | Direct financial cost if leaked |
| AI budget | Abuse is a direct financial loss |
| Audit trail | Needed to reconstruct incidents |

## Trust boundaries

```
Browser ─┬─► Authenticating proxy (Entra ID) ─► API ─┬─► PostgreSQL
         │        [writes identity headers]          │
         └─ untrusted                                └─► AI provider  (Phase 2)
                                                     └─► External websites (Phase 1/2)
Worker ──────────────────────────────────────────────┘   [both untrusted]
```

Untrusted: the browser, uploaded files, retrieved web pages, and **AI model
output**. Trusted only after verification: the identity headers, and only when
they arrive from an allow-listed peer with a matching shared secret.

---

## T-01 — Development identity reaches production

**Impact:** Critical. Anyone reaching the app would be a seeded org owner.

**Controls**
- `loadServerEnv` rejects `AUTH_MODE=local` when `NODE_ENV=production`.
- `createAuthAdapter` independently refuses to construct `LocalAuthAdapter` in
  production, and `LocalAuthAdapter`'s own constructor refuses too.
- Seed and reset scripts refuse to run when `NODE_ENV=production`.

**Verification:** `apps/api/tests/unit/env-guards.test.ts` — the process fails at
boot, not at request time.

**Residual:** an operator who sets `UNSAFE_ALLOW_DEV_AUTH_IN_PRODUCTION=true`
defeats this. The flag exists only so the guards themselves can be tested; it is
named to be unmissable in a deployment review.

---

## T-02 — Cross-label / cross-organisation access

**Impact:** Critical. One label reading another label's campaigns.

**Controls**
- Deny-by-default matrix; **no org role grants read access to label content**
  (ADR-0008).
- Label access requires a `memberships` row for that specific label.
- Repositories filter by `organization_id` in addition to the id being looked up,
  so a foreign id cannot return a row even if it reaches the query.
- `memberships` uses **composite foreign keys including `organization_id`**, so a
  cross-organisation membership is impossible at the storage layer.
- Job visibility is checked against the job's **own** `label_id` read from the
  database, never a caller-supplied label id.

**Verification:** `apps/api/tests/integration/label-isolation.test.ts` — listing,
detail, workspace, job list, enqueue, IDOR via foreign job id, forged
role/label headers, and the database-level guards.

**Residual:** a new module could forget the predicate. Mitigation is that every
label-scoped route goes through `requireLabelPermission`, and new modules are
expected to add an isolation test — see the checklist in
`docs/product/testing-strategy.md`.

---

## T-03 — Forged or spoofed identity headers

**Impact:** Critical. Impersonation.

**Controls**
- Headers are read only when `socket.remoteAddress` matches
  `TRUSTED_PROXY_IPS`. `trustProxy` is off, so `X-Forwarded-For` cannot
  influence the decision.
- Proxy shared secret compared in constant time.
- A **duplicated** header (delivered as an array) is rejected outright rather
  than resolved to one value.
- Subject and e-mail are format-validated; control characters and whitespace are
  refused, which also blocks header-injection payloads.
- The authenticated subject type has **no role or label field**, so a forged
  `X-Roles` header has nowhere to land.

**Verification:** `apps/api/tests/unit/trusted-header-auth.test.ts`.

**Residual — OPEN:** the real proxy contract is unconfirmed. Specifically:
whether the proxy strips inbound copies of these headers, and whether the app is
reachable at all without traversing the proxy. Until both are answered,
production authentication is **not complete**. See
[trusted-header-contract.md](trusted-header-contract.md).

---

## T-04 — Approval bypass via content change

**Impact:** High. Unreviewed material published as approved.

**Controls**
- Approval binds to one immutable `(artefact, version)` pair, so a new version is
  unapproved by construction (ADR-0012).
- Dependency changes move dependents to `needs_rereview`.
- A publish-ready export requires every gate in `PUBLISH_READY_GATES`; a draft
  export is separately permissioned and labelled a draft.
- `export:create_publish_ready` is a distinct permission an editor does not hold.

**Verification:** `packages/contracts/tests/workflow-gates.test.ts`,
`packages/contracts/tests/access-matrix.test.ts`.

**Status:** enforced against real artefacts. An approval binds to
`(artefact_type, artefact_id, artefact_version)`, so editing an artefact
invalidates its approval rather than carrying it forward, and a publish-ready
export refuses while naming each item that is not approved — observed end to
end, not only in the contract tests.

---

## T-05 — Prompt injection via sources or model output

**Impact:** High. A retrieved page or uploaded document instructing the model to
exfiltrate another label's data or to approve content.

**Controls (designed now, enforced in Phase 1/2)**
- Sources and model output are treated as untrusted data, never as instructions.
- The model has no authorisation, approval or data-access decision authority —
  those are server-side checks that run before any job is enqueued.
- No arbitrary command execution.
- Retrieval is label-scoped; cache keys include the label to prevent
  cross-label cache leakage.
- Data sent to the provider is minimised to what the task needs.

**Verification:** planned as an explicit suite in Phase 1
(`research sources are not executed as instructions`), listed in the backlog.

---

## T-06 — SSRF via URL research

**Impact:** High. Reading cloud metadata or internal services.

**Controls (built)**
- Block loopback, private, link-local, CGNAT, documentation, multicast,
  reserved and unique-local addresses, and every known cloud metadata endpoint
  by name (`ip-guard.ts`). NAT64 / Teredo / 6to4 prefixes are refused whole
  rather than decoded; IPv4-mapped IPv6 is caught in both dotted and hex form.
- The **resolved address** decides, not the hostname.
- https only (http opt-in per deployment); `file:`, `gopher:`, `data:` and the
  rest refused; credentials in the URL refused; ports 80 and 443 only, so a
  public host on 6379 is still unreachable; single-label and special-use
  hostnames refused (`url-guard.ts`).
- Re-validate after **every** redirect, not only the first URL (`safe-fetch.ts`).
- Resolve DNS once and connect to the address that was checked
  (`pinnedLookup`), closing DNS rebinding.
- One timeout and one byte budget for the whole redirect chain, the byte cap
  enforced while streaming rather than trusted from `content-length`.
- No cookies and no authorization header, so nothing is replayable.
- Everything decidable without DNS is refused **at the route**, before a job is
  queued: otherwise `file:///etc/passwd` answers `202 Accepted`, holds a budget
  reservation and shows the user a progress bar for a fetch that will never
  happen. That was a real defect.
- Fetched text reaches the model as task data inside `<paginatekst>`, never as
  an instruction (T-05).
- Optional hostname-suffix allow-list, `RESEARCH_ALLOWED_HOST_SUFFIXES`.

**Status: built, and reachable from the interface.** Two job types fetch
(`course.extract_from_url`, `research.run`), and as of 2026-09-10 two screens
hand them user-supplied URLs — `CourseFromUrlPanel` on Opleidingen and the
source registration in `SourcesResearchPanel`. Both entry points are
authenticated, label-scoped and route-guarded. Held by `ssrf-guard.test.ts`
(23 tests) and `safe-fetch.test.ts`; `generation-gates.test.ts` asserts that a
hostile URL is refused **and** that no job row was created.

**Residual risk, stated plainly:** `RESEARCH_ALLOWED_HOST_SUFFIXES` is empty by
default, so any public https host that passes the address rules may be fetched.
This is deliberate — course pages live on whatever domain a provider uses — but
it means the address and scheme rules carry the entire weight, with no domain
allow-list behind them. A deployment wanting a narrower surface sets that
variable. The test-only hatch that lets a test reach a loopback server permits
loopback alone, is refused when `NODE_ENV=production`, and a test asserts it
appears nowhere in production code.

---

## T-07 — Malicious file upload

**Impact:** High. Stored XSS via SVG/HTML, zip bombs, path traversal.

**Controls (built)**
- The **bytes** decide the type; the declared MIME type and the extension are
  treated as hints only (`validate.ts`).
- Global and per-type size ceilings, applied by the parser rather than after
  the fact.
- Archives, executables and HTML refused outright, each with a specific reason.
- SVG **rejected** — not sanitised — if it carries script, event handlers,
  `foreignObject`, entities, a DOCTYPE or external references; and never served
  inline even when clean.
- Zip files inspected through the central directory and **never extracted**;
  reading a document opens exactly one archive member, after the directory has
  been judged.
- Decompression bounded (DOCX inflation capped, PDF parsed in a separate thread
  the parent can terminate), and every extractor **says** when it truncated.
- Filenames checked for traversal, NUL, RTL override, reserved names and
  length; storage is content-addressed, so a hostile name never reaches the
  filesystem.
- Path containment re-checked on every read and write (`absolutePathFor`).
- Quarantine until validated, nothing in the product reads from quarantine, and
  the quarantine is swept at startup and on a timer.
- Authorised, label-scoped download only — no public or guessable URL — with
  `nosniff`, `default-src 'none'; sandbox` and `no-store` on every response.
- Refusals audited with what was detected, never with the payload.

**Status: built, and every accepted purpose is reachable from the interface and
has a consumer** — `visual_reference`, `source_document`, `course_document` and
`brand_logo`. A fifth, `brand_document`, was removed on 2026-09-10: it accepted
and stored documents no code path read, which is accepted-file surface and
storage for no benefit. The accepted set is pinned by a test, so the surface
cannot widen unnoticed. The controls are per-purpose and do not depend on which
screen calls them. Held by `file-safety.test.ts` (41 tests),
`upload-surface.test.ts` and `brand-logo.test.ts`.

**A property worth stating separately: an asset id is not self-describing.**
The purpose an upload was made for is not recorded on the stored row, and every
upload is stored with `kind: 'upload'`. So a client can send the id of a course
document where a logo is expected, and the row alone cannot refuse it. Each
consumer re-checks what it actually needs against the **stored** type — the one
decided by the file's own bytes, never the declared one — and does so
label-scoped, with a foreign id reading as absent rather than forbidden. The
brand profile requires `image/png`; `brand-logo.test.ts` pins that a document
belonging to the same label is refused.

**Content re-verified before it is composited.** An uploaded logo is drawn into
images the product exports, which is the one place its output stops being
reviewable text. `loadRenderResources` therefore re-reads the asset
label-scoped and re-checks its content hash against the value recorded at
upload before the bytes are used; a mismatch refuses the render rather than
producing an image. `brand-logo.test.ts` overwrites a stored file and asserts
the refusal.

**Residual risk:** OCR is not implemented, so an image-only PDF yields no text
rather than being read — a course fact cannot be extracted from a scanned
brochure. This is a capability gap, not a control gap, and it is reported to the
user rather than silently producing an empty extract.

---

## T-10 — Script or remote content in generated output

**Impact:** High. The product generates two kinds of markup — SVG images and
e-mail HTML — and both interpolate text the product does not control. A script
in an e-mail we produced would run in the recipient's client; a script in a URL
we render as a link would run in our own origin.

**Controls (built)**
- **No model output is ever markup.** A model returns a subject, paragraphs,
  titled sections and a call to action, all plain text; `email-html.ts` is the
  only thing that writes tags. So there is nothing to sanitise. This ordering
  is the control: sanitising model-authored HTML would be strictly worse, as a
  bypass would ship inside a file the product had signed its name to.
- One strict escaper for all generated markup (`core/render/markup.ts`), shared
  by the SVG layer and the e-mail builder. There were four implementations
  before, differing in coverage.
- **No remote resources in a generated e-mail** — no images, no web fonts, no
  tracking pixel. The mail cannot report when it was opened, and renders
  identically with images blocked.
- **CSS values are validated where they become CSS**, not only where they
  arrive. A brand font family is a free string in the contract and sits inside
  a `style` attribute, where `Inter; background:url(https://…)` adds a remote
  background without needing a tag or a quote — escaping does not catch it.
  Font names are matched against a font-name character set; colours re-checked
  as hex.
- **`webUrl` at the contract boundary.** `z.url()` accepts `javascript:`,
  `data:` and `vbscript:` because they are syntactically valid URLs. Every
  field whose value can reach an `href` — a content or brief call to action, a
  research source, a market-radar finding source — now allows http and https
  only.
- The preview is served origin-less and script-free: `Content-Security-Policy:
  sandbox; default-src 'none'; style-src 'unsafe-inline'`, `nosniff`,
  `no-store`, and framed with an empty `sandbox` attribute. Inline styles are
  allowed because an e-mail is styled with them and blocking them showed the
  user an unstyled document — which is not what a recipient sees.

**Status:** built. Held by `email-html.test.ts` (8 tests, including a hostile
font family and a hostile colour), `web-url.test.ts` (7 tests) and
`page-and-email.test.ts`. The browser smoke run reads the preview frame's own
text, because a frame that loads and paints nothing passes every other check.

**Residual risk:** rendering across e-mail clients is not verified against any
primary source, which is why an e-mail cannot reach a publish-ready export at
all (see the channel specification's note). Nothing is sent from this system.

**A related control, structural rather than instructed.** An advertising
proposal has no field for search volume, cost per click, budget, reach or
conversions — see `adProposal` in `contracts/src/content.ts`. This is not a
markup concern but the same principle: a number the system cannot know must not
have a place to sit, because a prompt rule can be forgotten by a later edit and
a schema cannot. A fabricated performance figure would be acted on with money.

---

## T-08 — Cost abuse / budget bypass

**Impact:** Medium-High. Direct financial loss.

**Controls**
- Per-label monthly budget with reservations covering *pending* work.
- Reservation is a single conditional `UPDATE` (`budget - spent - reserved >= n`),
  so concurrent requests cannot reserve against a stale balance.
- Idempotency key collapses double submits onto one job.
- One usage row per `(job, attempt, kind)`, enforced by a unique index, so a
  replayed attempt cannot double-charge.
- Estimated and actual cost are separate columns.
- Rate limiting keyed on the authenticated user.

**Verification:** `apps/api/tests/integration/budget.test.ts`,
`job-queue.test.ts` (usage idempotency), `apps/worker/tests/runner.test.ts`
(reservation held across requeue, released exactly once).

**Residual:** true concurrent contention is exercised only in the CI job against
PostgreSQL 18; PGlite is single-connection.

---

## T-09 — Information disclosure through errors and logs

**Impact:** Medium.

**Controls**
- Closed set of error codes; the client receives a Dutch message plus a request
  id and nothing else. Internal detail goes to the log only.
- Pino redaction on identity and secret headers as a safety net; the code paths
  do not put secrets into log objects in the first place.
- The audit trail is separate from content logging and accepts only short scalar
  metadata, so user content cannot be smuggled into it.
- Client addresses are stored as a salted HMAC, never raw.

**Verification:** `apps/api/tests/integration/http-surface.test.ts` asserts no
stack, no `node_modules` path and no database string appears in a response, and
that an enqueue's audit row contains no message content.

---

## T-10 — Duplicate work / double charge on retry

**Impact:** Medium. Duplicate assets, duplicate cost.

**Controls**
- `SKIP LOCKED` claim: exactly one worker gets a job.
- Every write-back guarded by `claimed_by`, so a reaped worker that wakes up
  writes nothing.
- Unique `(organization_id, type, idempotency_key)` with `ON CONFLICT DO NOTHING`.
- Unique `(job_id, attempt, kind)` on usage rows.
- The SPA never auto-retries a mutation.

**Verification:** `job-queue.test.ts`, `runner.test.ts` (`lost` outcome).

---

## T-11 — Cross-site request forgery

**Impact:** Low, by design.

The API uses no cookies and no ambient credentials, which removes the classic
CSRF surface. As defence in depth, state-changing requests that carry an `Origin`
header must match `CORS_ALLOWED_ORIGINS`. CORS is deny-by-default.

**Verification:** `http-surface.test.ts` — a POST from a disallowed origin is
refused; the configured origin is accepted.

**Note:** if a cookie-based mode is ever added, a token-based CSRF control must
be added with it. Recorded in the risk register.

---

## T-12 — Container and supply-chain compromise

**Impact:** High.

**Controls**
- Non-root uid 10001, `cap_drop: ALL`, `no-new-privileges`, read-only root
  filesystem with a single writable volume; no Docker socket mounted; the worker
  publishes no ports; PostgreSQL bound to loopback.
- Multi-stage images: no build toolchain, no dev dependencies, no source.
- `npm ci` against a committed lockfile; CI fails if the lockfile drifts.
- CI runs dependency audit, secret scanning (gitleaks) and image scanning
  (Trivy), and asserts the images do not run as root.

**Residual:** audit and image scan thresholds are reporting-only until a
vulnerability-management policy sets an agreed bar. See
[vulnerability-management.md](vulnerability-management.md).

---

## Not covered by this document, and why

The four items that used to be listed here — SSRF, uploads, prompt-injection
enforcement and approval enforcement against real artefacts — are all built and
are described above. What remains outside this document is genuinely outside it:

- **The production environment itself.** The trusted-header contract has not
  been verified against the real proxy (R-01), and TLS, secret storage and
  encryption at rest are deployment concerns this repository does not configure
  (P5-1, P5-2). Nothing here should be read as a statement about a production
  deployment, because there is not one.
- **Concurrency proofs.** The default test database executes queries one at a
  time, so it proves guards and not races (R-02). The claim-exclusivity and
  budget-race properties come from the SQL — `FOR UPDATE SKIP LOCKED`, a single
  conditional `UPDATE` — and are exercised in CI against real PostgreSQL, not
  in the default suite.
- **Monitoring, alerting and a rehearsed restore** (P5-4, P4-5, R-10). A
  control that has never been exercised is an intention, and backups fall into
  that category until a restore has actually been performed.
- **Publishing.** Nothing is published and no advertising account is connected,
  by design, so there is no outbound publishing surface to model. "Approved" is
  deliberately not "published".
- **The Phase 3 surfaces** — landing-page copy, e-mail HTML, advertising
  proposals — do not exist. E-mail HTML in particular will need its own entry
  when it does, because generated markup leaving the system is a new class of
  problem rather than a variation on an existing one.

No claim is made that the system is free of vulnerabilities, and no control
here has been reviewed by anyone but its author.
