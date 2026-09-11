# Requirements → implementation → test

The mapping the ISO 9001/27001 preparation asks for. Numbers refer to the
sections of the product and architecture contract.

**Status values are literal.** *Built* means working code with a test. *Contract
only* means the schema/interface exists but no feature uses it yet. *Not built*
means exactly that. Nothing is marked built on the strength of documentation.

**Last updated:** 2026-09-09 (Phase 0 plus the Phase 1/2 campaign chain).
Tests: 113 passing.

## 2 — Technical framework

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| End-to-end TypeScript, strict | `tsconfig.base.json`: strict + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, … | `npm run typecheck` | Built |
| React frontend | `apps/web` — React 19, Vite 8 | `npm run build` | Built |
| Direct PostgreSQL, no Supabase | `pg` + Drizzle; SQL migrations | Integration suite | Built |
| Docker containers + local Compose | `infra/docker/*.Dockerfile`, `docker-compose.yml` | CI `images` job builds both and asserts non-root | Built |
| Worker for long-running work | `apps/worker` | `apps/worker/tests/runner.test.ts` | Built |
| Identity from company proxy headers | `TrustedHeaderAuthAdapter` | `tests/unit/trusted-header-auth.test.ts` | Built; **contract not agreed** (R-01) |
| No in-app OAuth or passwords | No such code exists | — | Built |
| Separated local test identity | `LocalAuthAdapter`, `AUTH_MODE=local` | `tests/unit/env-guards.test.ts` | Built |
| Single AI provider, replaceable layer | Adapter interfaces defined per task | — | Contract only (Phase 2) |
| Modular monolith + separate worker | ADR-0001 | `eslint` import boundaries | Built |
| Choices justified in ADRs | `docs/decisions/` (14 records) | — | Built |

## 3 — Code organisation

| Requirement | Implementation | Status |
| --- | --- | --- |
| `apps/` + `packages/` + `docs/` layout | As specified | Built |
| Domain modules in the backend | `apps/api/src/modules/` — 4 of 15 built | Built (Phase 0 scope) |
| Modules own their rules and data access | `repository.ts` per module; documented boundary | Built |
| Modules must not mutate each other's tables | Directory boundary + review; composition via services | Built |
| No secrets/DB/server code in frontend or shared packages | `no-restricted-imports` in `eslint.config.js`; CI greps the built bundle | Built |
| No large single files, no `utils` dump, no duplicated rules | No `utils` package exists; largest source file ~470 lines | Built |
| No circular dependencies | `tsc -b` project references; worker→api one-way | Built |

## 4 — User experience

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Dutch interface | All UI copy Dutch; ADR-0014 | Playwright render check | Built |
| Content language default `nl`, per campaign | `contentLanguage` in contracts | — | Contract only |
| No technical detail in the UI | Closed error codes + Dutch messages | `http-surface.test.ts` (no stack/paths leak) | Built |
| Clear states, resumable operations, save status | Job panel: progress, stop, retry; "Alle wijzigingen opgeslagen" pattern | `runner.test.ts` partial progress | Built for jobs |
| Accessible form controls, keyboard use | `Field` binds label/hint/error by id; visible focus ring; skip link; `role="progressbar"` | Playwright: skip link is first tab stop | Built |
| Seven main areas | `PRIMARY_NAV` + `KNOWLEDGE_NAV` | Playwright nav check | Built (nav) |
| **Unfinished areas must not look functional** | Server-driven `moduleAvailability`; nav marked "NOG NIET"; placeholder page states the phase | `http-surface.test.ts` asserts non-Phase-0 areas never report `available` | Built |
| Three campaign entry modes | `campaignEntryMode` enum | — | Contract only (Phase 1) |
| Workflow chain and its gates | `workflowStage`, `STAGE_PREREQUISITES` | `workflow-gates.test.ts` | Contract + logic built |
| Resume from saved persona/approved brief without skipping controls | `canEnterStage` checks prerequisites regardless of entry point | `workflow-gates.test.ts` | Logic built |

## 5–8 — Brand, courses, research, personas, opportunities, content

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Brand profile, versioned, user-approved | `modules/brand` | Walked end to end; approval archives the previous version | Built |
| Brand rules are hard constraints for generation and images | `must_not` rules copied into every brief's `offLimits`; colours drive the render layer | Observed in the brief and in rendered PNGs | Built |
| Brand profile from an uploaded file | — | — | **Not built** (needs upload, Phase 1 backlog P1-2) |
| Course card with source, extracted fields, uncertainties, verification state | `modules/courses`, per-field `CourseFact` | Seeded card shows 2 confirmed / 1 unconfirmed | Built |
| Named responsibility for conditions, duration, price, dates | Confirmation records user and timestamp; confirming creates a new version | Walked in the UI | Built |
| **Unconfirmed facts never reach generation** | `statableFacts()` omits them from the prompt entirely | Brief's `offLimits` auto-listed the unconfirmed field | Built |
| Course card from a file or a course-page URL | — | — | **Not built** (needs upload + SSRF fetcher) |
| Change impact: flag dependents for re-review | `flagStaleForLabel`, provenance columns on every asset | Provenance stored; flagging implemented | Built (not yet wired to a UI trigger) |
| Research with source, retrieval date, section | `ResearchAdapter` interface defined; **no implementation** | — | **Not built** — needs the SSRF-safe fetcher |
| Three personas, no invention without grounding | `modules/personas`; a short set without a reason is rejected as invalid output | **Observed: two personas returned with an explicit reason** | Built, tested |
| Grounding separated from assumption | Separate `grounding` / `assumptions` arrays; shown side by side in the UI | Visible per persona | Built |
| No demographic stereotypes | No demographic fields exist in the schema | — | Built (structural) |
| Three grounded opportunities, no unfounded success scores | `modules/opportunities` — no score column exists; order plus a stated reason | Observed: rank + `rankRationaleNl`, uncertainties listed | Built |
| Structured brief; approval required before concepts | `modules/campaigns-briefs`; `requireApprovedBrief` is the only path | **Observed: HTTP 409 `gate_not_passed` before approval** | Built |
| Three concepts from an approved brief | `modules/concepts` | Observed: three, each mapped to a render layout | Built |
| Content plan approved before production | Separate approvable artefact | Observed | Built |
| LinkedIn / Instagram / Facebook, per-channel copy | `modules/content-assets` | Observed per channel | Built |
| **Channel specs versioned and verified against official sources** | All three pilot channels verified with a source URL and a check date; the config is versioned and `content_asset_versions.channel_config_version` records which version each asset met; operative warnings are recomputed from the current config on read | `workflow-gates.test.ts` (22), `http-surface.test.ts` | Built. **Not built:** anything that marks a spec `stale` — the state exists and is refused, but no review interval is agreed (R-25) |
| Two design variants, same message and CTA | Both specs built from one `copy` record | Observed: identical text, different layout | Built |
| Logo and brand text via a controlled render layer, not drawn by AI | `core/render` composites SVG → PNG with resvg | Observed in generated PNGs | Built |
| Editing: direct text, AI revision, single-asset regeneration, version history | `editCopy`, `revise`, version list | Observed: 5 versions retained; stale edit rejected | Built |
| **A hand edit is not silently overwritten** | `revise` refuses without `acceptOverwritingUserEdit` | **Observed: HTTP 409, then explicit confirmation** | Built |
| Budget optional; no invented volume/CPC/conversion | No such fields exist | — | Built (structural) |
| AI image generation | Not offered — Anthropic has none, and a second provider was not authorised | `image()` returns undefined → `capability_unavailable` | **Deliberately absent** |

## 9 — Approval, change, export

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Flexible approval; pilot user may approve own content | `APPROVER_ROLES`; pilot seeded as `label_manager` | `access-matrix.test.ts` | Built (matrix) |
| Authority enforced server-side | `core/authz`, deny-by-default | `label-isolation.test.ts` | Built |
| Membership administration, audited, effective immediately | `modules/identity-access/members-service.ts`; `member:manage` is organisation-scoped so a label manager cannot widen their own access | `member-administration.test.ts` (18) | Built |
| Approval bound to a specific version | ADR-0012; approval references `(artefact, version)` | `workflow-gates.test.ts` | Contract + logic built |
| Changed dependency invalidates approval | `needs_rereview`; `no_stale_dependencies` gate | `workflow-gates.test.ts` | Logic built |
| Version restore creates a new version | ADR-0012 | — | Contract only |
| **Draft vs publish-ready export separated** | Distinct permissions; `PUBLISH_READY_GATES` | `access-matrix.test.ts`, `workflow-gates.test.ts`, `exports.test.ts` | Built, and the package verified end to end: a draft zip is produced and opens; a publish-ready one is refused and the refusal is recorded |
| No direct social publishing or ad account link | No such code exists | — | Built |
| Approved ≠ published | `PublicationRecord` is user-recorded | — | Contract only |

## 10 — Results and learnings

All *Not built* — Phase 4. Contracts for outcome/learning association exist.

## 11 — Data and scalability

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Core entity set | The chain is complete through export. Outcomes and learnings are not built | `schema-parity.test.ts` | Built for Phases 0-2 |
| Normalised relations; controlled JSON for provider payloads | `payload`/`result`/`progress` JSONB with `jsonb_typeof` checks; everything else normalised | `schema-parity.test.ts` | Built |
| Org/label scope preserved in relations and queries | Composite FKs + `organization_id` predicates | `label-isolation.test.ts` incl. DB-level guards | Built |
| Source/model/prompt/input version traceability | `usage_records.prompt_template`, `prompt_version`, `model` | — | Built (schema) |
| Pagination, indexes, bounded queries | `pageQuery` max 100; partial indexes on the queue hot path | — | Built |
| Concurrent edit conflict detection | `requireLatestVersion` compares against `max(version)` for the asset key, not the row's own version - the latter was vacuous, because version rows are immutable | Observed: HTTP 409 on editing a superseded version | Built |
| Heavy work via queue | `jobs` + worker | `job-queue.test.ts` | Built |
| Retry, timeout, cancellation, idempotency | All four | `job-queue.test.ts`, `runner.test.ts` | Built |
| Per-user/label fair use and limits | `core/http/fair-use.ts`: per-user, per-user-generation and per-label-generation budgets, applied after authentication. A pre-auth per-socket ceiling sits in front of it as a deployment circuit breaker | `fair-use.test.ts` (11), `budget.test.ts` | Built - **and previously broken**: the limiter read the subject in `onRequest` where it is always undefined, so every request fell back to the socket address and, behind the proxy, all users shared one bucket |
| Partial results survive | Progress committed as it happens | `runner.test.ts` cancellation keeps `completedUnits: 1` | Built |
| Failed job resumable by the user | `retry()` raises the ceiling, preserves attempt history | `job-queue.test.ts` | Built |
| **Provider failure must not become fake success** | Classified failure, Dutch message, `result` stays null | `job-queue.test.ts`, `runner.test.ts` | Built |

## 12 — AI provider and cost

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Task-scoped adapters (text / research / image) | ADR-0013; mock, Anthropic and OpenAI providers | `openai-adapter.test.ts` (20) | Built |
| Unsupported capability stated, not simulated | OpenAI `research()` returns undefined, so callers get `capability_unavailable` (501) rather than a fabricated finding | `openai-adapter.test.ts` "offers text but not research" | Built |
| Labelled mock for development | `AI_PROVIDER=mock`; UI shows development version | — | Built |
| **No silent mock fallback in production** | Env validation refuses `mock` when production | `env-guards.test.ts` | Built |
| Runtime schema validation of provider output | Zod at the boundary, plus strict Structured Outputs on the request: **OpenAI enforces the shape, Zod enforces the rules** | `strict-schema.test.ts` (35) converts every contract the product sends | Built |
| Prompt versions and evaluation scenarios | `prompt_version` recorded per usage row; templates in `core/ai/prompts.ts` | — | Built; evaluation scenarios **not** built |
| Request, cost and latency tracking | `usage_records` | `job-queue.test.ts` | Built |
| Secrets backend only | `@c360/config` server-only; lint blocks it in the browser | CI bundle grep | Built |
| **Budget reservation for pending work** | `reserved_cents` covers queued + running | `budget.test.ts` | Built |
| User confirmation before exceeding a limit | `budget_exceeded` (402) with a Dutch message | `budget.test.ts` | Built (API) |
| **Estimated vs actual cost separated** | Distinct columns on jobs and usage | `runner.test.ts` (estimate never billed as actual) | Built |
| An unpriced model must not report a cost | `actualCostCents` is null, and the reservation uses a high placeholder rather than zero | `openai-adapter.test.ts` two cost tests | Built |
| A ChatGPT/Claude subscription is not API access | No such path exists; a paid key is the only route | ADR-0015 records the request and the refusal | Built (structural) |
| Live-API behaviour | **Unverified.** 55 tests run against a stubbed transport | Risk R-16 | **Not verified - needs a key** |

## 13 — Identity, security, privacy

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Local vs trusted-header adapter split | ADR-0007 | `env-guards.test.ts` | Built |
| **Dev auth refused in production** | Two independent guards | `env-guards.test.ts` | Built |
| Configurable header names | `AUTH_HEADER_*` | `trusted-header-auth.test.ts` | Built |
| Headers only via a trusted proxy | `TRUSTED_PROXY_IPS` on `socket.remoteAddress`; `trustProxy: false` | `trusted-header-auth.test.ts` | Built |
| Proxy must strip inbound headers | Requirement on the proxy | — | **Open — R-01** |
| Bypassing the proxy must be blocked | Network control + shared secret | — | **Open — R-01** |
| **Header presence is not trust** | IP + secret + single-value + format checks | `trusted-header-auth.test.ts` | Built |
| **Client role/label fields carry no authority** | The subject type has no such fields | `trusted-header-auth.test.ts`, `label-isolation.test.ts` | Built |
| Deny-by-default authorisation | `core/authz/policy.ts` | `access-matrix.test.ts` | Built |
| IDOR/BOLA and cross-label tests | `not_found` not `forbidden`; job checked against its own label | `label-isolation.test.ts` | Built |
| Parameterised queries | Drizzle + parameterised raw SQL only | — | Built |
| Runtime input validation | Zod at every boundary | `http-surface.test.ts` | Built |
| XSS: safe render, CSP | React escaping; helmet CSP on the API | — | Built (API); SPA CSP is a proxy responsibility |
| CSRF / origin checks | No cookies; origin check on state-changing requests | `http-surface.test.ts` | Built |
| Restricted CORS, body size, rate limit | All three | `http-surface.test.ts` | Built |
| **No internal errors or secrets to the client** | Closed error codes; pino redaction | `http-surface.test.ts` | Built |
| SSRF protections | Designed (T-06); limits in env | — | Not built — Phase 1 |
| File safety | Designed (T-07) | — | Not built — Phase 1 |
| Sources/model output treated as untrusted | Designed (T-05) | — | Not built — Phase 1 |
| Model makes no authority/approval/data decisions | Authorisation runs before enqueue; handlers have no authz surface | `handlers/types.ts` contract | Built (structure) |
| No arbitrary command execution | No such code path | — | Built |
| Non-root containers, no extra caps/ports, no Docker socket | Compose + Dockerfiles | CI asserts non-root | Built |
| No secrets in image/repo/logs | `.dockerignore`, `.gitignore`, redaction, gitleaks | CI | Built |
| Safe dependency updates + lockfile | `npm ci`; CI fails on lockfile drift | CI | Built |
| Secret/dependency/static/container scanning | gitleaks, npm audit, eslint, Trivy | CI | Built (reporting) |
| TLS + storage/backup encryption in production | Stated requirement | — | **Not implemented — Phase 5** |
| No custom cryptography; hashing not used as encryption | HMAC-SHA256 for IP pseudonymisation only; `timingSafeEqual` for the secret | — | Built |
| Data minimisation | `docs/security/data-inventory.md` | — | Built |
| Retention, deletion, backup reflection | Documented; periods *to confirm* | — | Partly open |
| **No raw prompts/documents/tokens/personal data in logs** | Redaction + `sanitiseMetadata` drops non-scalars | `http-surface.test.ts` (audit carries no content) | Built |
| **Security audit separate from content logs** | `audit_events` accepts only short scalars | `http-surface.test.ts` | Built |
| AI region/retention recorded as to-verify | R-04 | — | Recorded |

## 14 — ISO preparation

| Deliverable | Location | Status |
| --- | --- | --- |
| Requirement → implementation → test mapping | This document | Built |
| Acceptance criteria | `docs/product/scope-and-phases.md` | Built |
| ADRs and change/release records | `docs/decisions/`, `docs/security/change-management.md` | Built (changelog not automated) |
| Threat model and risk register | `docs/security/` | Built |
| Access matrix | `docs/security/access-matrix.md` | Built |
| Data inventory and retention plan | `docs/security/data-inventory.md` | Built; periods *to confirm* |
| Incident / vulnerability management | `docs/security/` | Built |
| Backup / restore / recovery | `docs/security/backup-restore.md` | Written; **never executed (R-10)** |
| Supplier / AI dependency inventory | `docs/security/supplier-inventory.md` | Built |
| Open risks, owners, verification state | `docs/security/risk-register.md` | Built |

No control numbers are cited and no certification is claimed, per the contract.

## 15 — Critical tests

| Critical test | Where | Status |
| --- | --- | --- |
| Cross-label access denial | `label-isolation.test.ts` | **Passing** |
| Missing / forged identity headers | `trusted-header-auth.test.ts` | **Passing** |
| Development auth refused in production | `env-guards.test.ts` | **Passing** |
| Old approval invalid for a changed version | `workflow-gates.test.ts` | **Passing**; observed end to end - a publish-ready export refuses and names each unapproved item |
| Draft vs publish-ready export separated | `access-matrix.test.ts`, `workflow-gates.test.ts`, `exports.test.ts` | **Passing**, rules and package |
| Research sources not executed as instructions | `sources-research.test.ts` "treats an instruction in a source as quoted material, not as a command" (asserts the course card is unchanged after a page tries to set a price and an accreditation); `prompt-rules.test.ts` (4 tests) asserts input never reaches the system message | **Passing** |
| Document extraction never invents a value | `document-text.test.ts` (18) | **Passing** — a failure returns empty text with a Dutch reason; verified end to end against a real Word document, where all eight fields landed `unverified` citing the file and the accreditation caveat was carried through rather than dropped |
| File safety limits | `file-safety.test.ts` (41), `upload-surface.test.ts` (16) | **Passing** - content-sniffed types, SVG rejection, zip inspected without extracting, traversal and NUL names, quarantine emptied on both paths, attachment-only serving, label-scoped download |
| SSRF limits | `ssrf-guard.test.ts` (23), `safe-fetch.test.ts` (16) | **Passing** - resolved-address classification, every metadata endpoint, IPv6 variants incl. mapped in hex form, redirect re-validation at every hop, DNS-rebinding closed by dialling the classified address, chain-wide timeout and byte budget, port and scheme restriction, allow-list |
| No duplicate asset / duplicate cost on retry | `job-queue.test.ts` (usage idempotency), `runner.test.ts` | **Passing** |
| Cost limit holds under concurrent requests | `budget.test.ts` | **Guard passing**; true concurrency only in the CI PostgreSQL job (R-02) |
| Provider timeout and malformed output | `job-queue.test.ts`, `runner.test.ts` | **Passing** |
| User edits not silently lost | `runner.test.ts` (partial progress survives cancellation); `revise` refuses without `acceptOverwritingUserEdit` | **Passing** for both jobs and content editing |
| Second label independent in the same flow | `label-isolation.test.ts` | **Passing**; also under load - the load test spreads users across all six labels |
| A gate refuses **before** work is queued | `generation-gates.test.ts` (6) | **Passing** - asserts the 409 *and* that no job row was created |
| A business rule inside a job is not reported as a crash | `runner.test.ts` "domain refusals" (5) | **Passing** |
| Capacity claim backed by measurement | `tools/load-test`; `docs/architecture/load-assumptions.md` | **Measured** 2026-09-09: 100 users, 337 req/s, p99 6.1 ms, 0 errors. Multi-replica, real network and real provider remain unmeasured |
