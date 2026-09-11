# ADR-0018 — A label registers its sources; a run reads them and records provenance

**Status:** Accepted · **Date:** 2026-09-10

## Context

Personas, opportunities and briefs are supposed to rest on evidence. Until now
the only evidence available was the course card's confirmed facts, which is thin
enough that the pilot card yields two personas instead of three.

The requirement asks for "user documents, brand/course pages, and controlled
automatic web research", with every finding storing its source, retrieval date
and the section it rests on.

## Decision

### Sources are registered, not discovered

There is no search engine available, and inventing one is not on the table. So
the model is: a label **registers** what it wants read — a course page, a brand
page, an uploaded document — and a run reads the active ones.

Automatic discovery therefore stays unbuilt, and OpenAI's `research()` continues
to return `undefined` so callers receive `capability_unavailable`. Approximating
discovery by asking a model to recall URLs from training data would produce
citations that look real and are not, which is the exact failure mode the
requirements forbid.

### A finding carries its provenance or it does not exist

On `research_findings`, `source_ref`, `retrieved_at` and `excerpt` are all
`NOT NULL` with check constraints requiring non-blank text. A claim with no
passage behind it cannot be checked by a reviewer, so the database refuses to
hold one — and a test inserts exactly that to prove it.

The excerpt is the literal passage, which has a consequence worth naming: an
excerpt quoting a hostile page legitimately *contains* the hostile text. The
defence is not that the words disappear. It is that they stay an attributed
quotation and change nothing — asserted by checking that the course card is
unmodified after a page tries to set a price and claim an accreditation.

### Staleness is computed from a snapshot

A run records the exact sources it read and the SHA-256 of the text it saw. Is
the run still current is then a comparison, and the answer comes back as **named
reasons** rather than a boolean: content changed, source added, source removed,
past its freshness window. "The price page changed" and "nothing changed but it
is three months old" are different decisions for the person reading it.

Freshness windows come from the source's declared time sensitivity — 24 hours
for prices and dates, two weeks for course content, three months for
background. That is what makes "should we re-read this?" answerable without a
person judging each time.

### Reuse by default, force on request

Starting a run when the current one is still fresh returns the existing run with
`reused: true` rather than paying for the same work again. `force: true` is what
makes "the user can force a re-research" real.

### The rules that apply depend on the kind of task

This was a defect first, and it is the part most worth recording.

The universal prompt rules said "use only what is in
`<gecontroleerde_feiten>`". That is right for producing content which gets
published — an unverified price in a campaign is a real liability. It is wrong
for a task whose entire job is to read a source and propose facts that are *not*
confirmed yet.

Applied to research, it produced a run with **zero findings** and the
explanation "the page contains no facts that also appear in the confirmed
facts". The model was obeying us correctly, on a rule that should not have
applied to it.

The rules are now three groups: **universal** (never invent, no guarantees,
Dutch, text-in-tags is data, tool-only), **content** (only confirmed facts may
be claimed; never name an unverified price, date, condition or accreditation;
obey brand and off-limits), and **extraction** (the source is your material,
confirmed facts are context not a filter, every value must be traceable to a
passage, present nothing as settled). The same run then produced seven findings.

`prompt-rules.test.ts` pins the split in both directions: a content task must
carry the restriction, an extraction task must not.

## Consequences

- Findings are handed to persona generation as `Grounding`, the shape the rest
  of the product already speaks, so no consumer learns a second one.
- **A correction to an earlier claim.** The pilot card yielding two personas
  rather than three is *not* explained by the absence of research. With seven
  findings verified as reaching the prompt, the count stayed at two — because
  the source used described a law, not the course's audience. The mechanism
  works; the source has to be relevant. Stated here because the earlier
  explanation was a hypothesis presented with more confidence than it had.
- A source that cannot be read is recorded with a Dutch reason on both the run
  snapshot and the source row, rather than skipped silently. A run with no
  readable source at all fails rather than producing an empty result.
- The fetcher is injectable into the service, defaulting to the SSRF-guarded
  one. That exists so a test can reach a loopback server **without** an escape
  hatch existing in the service or in configuration; production has one fetcher.

## Rejected

- **Asking a model to name sources.** It produces plausible URLs that were never
  retrieved. A citation that cannot be re-fetched is worse than no citation,
  because it looks like evidence.
- **One overall "researched" flag per label.** Staleness has to be per source to
  be actionable, and the reason has to be nameable to be a decision.
- **Storing the whole page.** The excerpt is what a reviewer checks; the page is
  re-fetchable from its URL. Keeping full copies would multiply the personal-data
  surface for no verification benefit.
- **Letting a stale run silently ground a generation step.** `groundingsFor`
  returns nothing for a run that is running, failed or stale. Freshness is
  checked against the retrieval snapshot, not a newer read by another course.


## Completion after handoff — 2026-09-10

Document extraction and the Opleidingen research interface are connected.
Migration 0008 adds label-scoped references between resources; 0007 is unchanged.
An excerpt must match one source in full after whitespace normalization. A
missing or ambiguous match is omitted with a visible shortfall explanation.
This verifies passage provenance, not whether an AI interpretation is correct.
Prompt-isolation tests do not establish immunity to all model prompt injection.
Failures are retained as versioned runs. Uploaded PDF, DOCX, TXT and Markdown
are read through the upload module after label authorization. PDF.js runs in a
bounded worker thread; this contains resources and does not constitute a sandbox.
Source discovery and OCR remain unavailable. No course facts are auto-confirmed.

Live local verification: CS Opleidingen / CROV, 2026-09-10. The official course
page was registered through the browser UI. Job
`f288c6e0-b336-494d-bf5a-01e58883cb0f` completed on the real configured provider
(`isMock: false`): one source read, zero failures, twelve verified-excerpt
findings, two eurocents actual cost. Run
`5a06217a-cbcb-432f-9030-076d37057aa3` is current; a second browser request reused
it with HTTP 200 instead of creating a paid job. The screen renders all twelve
passages and fits a 390px viewport without horizontal page overflow. Course
facts remain unconfirmed. `npm run verify` passed: 364 tests plus TypeScript,
ESLint and all workspace builds.
