# Extension roadmap

Long-term directions, with the seams they would attach to. Nothing here is
built. The point of the document is that the current boundaries already permit
these without rewriting the core — and to record where they would *not*.

## Connectors (CRM, CMS, advertising)

**Seam:** the same validation contract serves file input and API input
(`@c360/contracts`), so a connector becomes another source feeding existing
schemas rather than a parallel ingestion path.

**Design constraint already honoured:** exports are files, and publication
status is recorded by the user. "Approved" never means "published". A connector
must not quietly change that — publishing on the user's behalf stays an
explicit, separately authorised action.

**Additions needed:** `connector_accounts` (credentials in a secret store, never
in the database), per-connector rate limits, and a sync-state table. Outbound
credentials also mean the egress controls designed for research (T-06) apply.

## Market Radar

Continuous monitoring of market and competitor signals per label.

**Seam:** `research_runs` + `evidence` already carry source URL, retrieval date
and the section a finding rests on. Market Radar is a scheduled research run
whose findings feed opportunity proposals.

**Additions needed:** a scheduler (the job table already supports `run_at`, so
recurrence is a thin layer), signal deduplication, and a change-detection notion
so the same finding is not re-proposed weekly.

## SEO / GEO

**Seam:** landing-page content is already specified as *structured* text
(section order, headings, body, CTA) rather than free HTML, which is what makes
programmatic SEO analysis possible at all.

**Additions needed:** keyword/volume data from a source with a licence
permitting it. Until such a source exists, no search volume, CPC or conversion
number may be shown — inventing one is explicitly out of bounds.

## Website Assurance

Checking that published pages still match approved content.

**Seam:** approvals bind to a specific version, so "what was approved" is
already an exact, queryable answer. Assurance compares a live page against that
version.

**Additions needed:** a fetcher (the SSRF controls in T-06 apply), a diffing
strategy tolerant of templating, and a correction-task flow. The requirement
that published content gets a *correction task* rather than a silent republish
already matches the existing rule that the system never publishes on the user's
behalf.

## Journey and cross-sell

**Seam:** `PersonaVersion` and course relationships exist; a journey is a
sequence of campaigns linked to persona versions.

**Additions needed:** journey entities, step conditions, and a suppression
notion so a learner is not targeted for a course they already hold. That last
point touches individual learner records — which this system deliberately does
not store. Any journey feature must be designed so it stays that way, or the
privacy posture in `docs/security/data-inventory.md` changes materially and
needs its own assessment.

## Label Integration Workspace

Onboarding a newly acquired or added label.

**Seam:** everything is already label-scoped, with tenant isolation enforced in
the relations. Adding a label is data, not code.

**Additions needed:** a guided onboarding flow (brand extraction, course import,
persona seeding) and a per-label progress view. The `LabelReadiness` contract
already exists for exactly this.

## M&A workspace

Explicitly **not** built now; the requirement is to document the expansion path.

Would add:

| Concept | Attaches to |
| --- | --- |
| `AcquisitionRecord` | A new module; references `organizations` and `labels` |
| Inventory of acquired assets (domains, pages, brands, courses) | New tables, label-scoped like everything else |
| KEEP / IMPROVE / MIGRATE / RETIRE disposition per asset | A status column plus an approval, reusing the versioned-approval pattern |
| Brand architecture decisions | Brand profile versions already versioned and approvable |
| Continuity mapping (old URL → new URL) | New table; feeds SEO migration |
| SEO migration plan and monitoring | Depends on Website Assurance and SEO/GEO above |

**Boundaries it would respect:** label scoping, versioned approvals, and no
automatic publication. **Boundary it would stress:** an acquisition inventory
spans organisations, whereas today every relation is scoped to exactly one. That
is the piece to design carefully — most likely as an acquisition-scoped module
that *references* organisations rather than widening the existing tenant scope.
Widening the scope of the existing relations would weaken the isolation
guarantee that the rest of the system depends on.
