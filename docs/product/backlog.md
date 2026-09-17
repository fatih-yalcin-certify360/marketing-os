# Backlog

Ordered, actionable work. Each item states its acceptance criteria, because
"done" for this product usually means "done *and* a control proves it".

Each item is marked **Done**, **Partly done** or left unmarked (not started).
A "Done" item names the tests that hold it, because that is what makes the claim
checkable rather than a status.

**Status, 2026-09-11.** The campaign chain is connected end to end — objective,
per-stage briefing, audience-aware channel plan with a measurement plan,
per-stage content, export, results and learnings by stage — on an eight-step
screen with one numbering (F-1…F-3, R-1…R-3, R-6 done; R-4, R-5, R-7 partly).
Phase 0 is complete. Phase 1 is done except automatic
source discovery (the remainder of P1-5) and member
administration (P1-10). Phase 2 is
done except the verified Facebook specification (P2-2). The full chain has been
run end to end against the live OpenAI API and produces real Dutch content and
brand-rendered images; a course card can be proposed from a real public URL, and
a label's sources can be read into findings with full provenance. The next
unstarted item is **P1-10**, with the P1-5 discovery remainder above ahead of it in
value.

Estimates are relative sizes (S/M/L), not dates.

---

## Phase 1 — A recorded, working flow

Goal: brand and course input, sources, personas, opportunities, brief and
approval — end to end, testable with the labelled mock AI.

### P1-1 · Brand profile module — M · **Done**
Upload or manual entry; extracted fields are a **proposal** the user edits and
approves; approved versions retained; logo, colours, fonts, tone of voice, rules
and example content; font/image usage rights recordable.

**Acceptance:** a brand profile can be created manually and approved; an
approved version is immutable and a revision creates version *n+1*; an
unapproved profile blocks the `brand_profile_approved` gate; cross-label
isolation test added.

**Held by:** `workflow-gates.test.ts`, `label-isolation.test.ts`. Logo upload
now works through P1-2; research can now read PDF, DOCX, TXT and Markdown documents (P1-5).

### P1-2 · File upload with the safety controls — M · **Done** (2026-09-10)
The first untrusted-file surface. Unblocked P1-1's upload path and P1-3.

**Acceptance:** type/size/content/name validation; SVG and HTML never served
inline; path traversal rejected; decompression bounded; quarantine until
processed; authorised download only, no permanent public URLs; temporary files
cleaned up. **Tests for each** (threat T-07).

**Built:** `apps/api/src/core/files/` (allow-list, magic-byte sniffing, SVG
guard, zip guard, filename rules, quarantine store) and
`apps/api/src/modules/uploads/`.

**Held by:** `file-safety.test.ts` (41 tests) and `upload-surface.test.ts`
(16 tests). What each criterion rests on:

| Criterion | Where |
| --- | --- |
| Content decides the type, not the declared MIME or extension | "refuses a script that claims to be a PNG" |
| Size, global and per type | "enforces the per-type ceiling as well as the global one" |
| Filename: traversal, NUL, RTL override, reserved names | "upload validation - filenames" (7 tests) |
| SVG never served inline | "serves an accepted SVG as an attachment, never inline" |
| HTML refused outright | "refuses HTML outright" |
| Decompression bounded without extracting | "archives are inspected, never extracted" (9 tests) |
| Quarantine emptied on accept *and* on refuse | two tests of that name |
| Authorised download, label-scoped, no public URL | "does not serve an upload to another label" |
| Temporary files cleaned up | "quarantine housekeeping" (3 tests) |

**Deliberately narrower than it could be:** SVG is validated by *rejection*, not
sanitisation — cleaning is where sanitisers get bypassed. A brand whose logo
carries a tracking script is refused with a message saying so.

### P1-3 · Course card module — M · **Done** (2026-09-10)
Manual form, per-field verification, extraction from a **course-page URL** and
extraction from an **uploaded document** all work.

**Acceptance:** a field stays `unverified` until a user confirms it; anything
`unverified` blocks a publish-ready export; an approved course version is
immutable; no value is ever invented when extraction fails — it stays empty and
flagged.

**Built for the document path:** `core/files/docx-text.ts` (one member of the
archive inflated under a hard cap, after the zip guard has already judged the
directory), `core/files/pdf-text.ts` (pdfjs in a `worker_threads` worker, so the
parent can terminate a page that never yields), `core/files/document-text.ts`
(the single entry point), `CourseService.extractFromDocument`, the
`course.extract_from_documents` job type and its handler.

**Held by:** `document-text.test.ts` (18) and `workflow-gates.test.ts`.
Verified end to end against a real Word document: eight fields extracted, each
traceable to a sentence in the source, every one `unverified` and citing the
file, and the accreditation caveat ("dit is geen wettelijk erkend diploma")
carried through rather than dropped.

| Criterion | Where |
| --- | --- |
| One archive member read, nothing else | "reads only the body member, whatever else the archive holds" — asserts an embedded macro does not leak into the text |
| Bounded output, and it says when it truncated | "truncates rather than returning an unbounded extract, and says it did"; a caller's cap is clamped, not trusted |
| Tracked deletions are not document text | "leaves out text marked as deleted" |
| A scan is reported as a scan, not as empty | `pdf-text.ts` returns "waarschijnlijk is het een scan" |
| Nothing is guessed on failure | "never returns text on a failure" |

### P1-4 · Controlled URL fetching (SSRF) — M · **Done** (2026-09-10)
Unblocked P1-3's URL path. It is **not** the missing piece of `research()` —
that needs a search engine, and the capability still reports itself unavailable
rather than pretending to work.

**Built:** `apps/api/src/core/net/` — `ip-guard.ts` (which resolved addresses are
refusable), `url-guard.ts` (scheme, credentials, port, hostname shape),
`safe-fetch.ts` (the fetcher), `html-text.ts` (HTML to prose).

**Held by:** `ssrf-guard.test.ts` (23) and `safe-fetch.test.ts` (16).

| Criterion | Where |
| --- | --- |
| Loopback, private, link-local, unique-local, metadata refused | "refuses loopback in every notation", "refuses every metadata endpoint we know of by name" |
| **Redirect targets re-validated at every hop** | "refuses a redirect to the metadata service" — asserts the first hop was fetched and the second never dialled |
| DNS resolved, then the resolved address connected to | `pinnedLookup`; "returns the body with the metadata an evidence trail needs" asserts `connectedAddress` |
| IPv6 variants | mapped (dotted *and* hex), compatible, zone index, NAT64, Teredo, 6to4 |
| Timeout, size, redirect limits | "limits are shared across the chain" (3 tests) |
| Hostname allow-list honoured | "honours an allow-list as a narrowing, never a widening" |

**Two findings worth recording.** Node's `BlockList` treats an IPv6 subnet as
covering the IPv4 addresses it can represent, so one list containing `::/96`
refused the entire public internet — caught by a test asserting a public address
is allowed. And the guard was first wired only into the job, so
`file:///etc/passwd` came back as `202 Accepted`; it now also runs at the route,
for everything decidable without DNS.

**Acceptance:** loopback, private, link-local, unique-local and cloud-metadata
addresses blocked; **redirect targets re-validated at every hop**; DNS resolved
then the resolved address validated and connected to (rebinding closed); IPv6
variants covered; timeout, size and redirect limits enforced; optional hostname
allow-list honoured. **Tests for each** (threat T-06).

### P1-5 · Sources and research runs — L · **Partly done** (2026-09-10)
A label registers the sources it wants read; a run reads them and produces
findings, each with the source, the retrieval date and the passage it rests on.

**Built:** migration `0007_sources_research` (`sources`, `research_runs`,
`research_findings`), `modules/sources-research/`, the `research.run` job type,
and the `research.findings` prompt. Findings are handed to persona generation as
groundings. Migration `0008_research_label_integrity` adds composite references
between sources, uploads, courses and findings. Full source excerpts must match
exactly one retrieved source; unmatched or ambiguous findings are omitted.
Freshness uses the run's retrieval snapshot, and stale findings do not reach
persona generation. Running, failed and completed runs are recorded.

The **Opleidingen** screen now supports source registration, document upload,
activation, queued research with progress, reuse, forced re-runs and reviewing
findings with their passages. PDF text is parsed in a terminated-on-timeout
worker (20 MiB, 40 pages, 40,000 characters); DOCX inflation is capped at 8 MiB.
Scanned/image-only PDFs need a text version; OCR is not implemented. Sources
are label-wide; research is per course version. Up to 200 active sources are
read with a shared 60,000-character model text budget. URL discovery is separate.

**Acceptance:** **retrieved content is never executed as an instruction** —
with an explicit test (threat T-05); every `evidence` row has a source and a
retrieval date; retrieval is label-scoped and caches cannot leak across labels;
a stale run is detectable and re-runnable.

**Held by:** `sources-research.test.ts` (23), `document-text.test.ts` (4) and `prompt-rules.test.ts` (9).

| Criterion | Where |
| --- | --- |
| Source text is quoted, never obeyed | "treats an instruction in a source as quoted material, not as a command" — asserts the course card is unchanged after a page tries to set a price and an accreditation |
| Input never reaches the system message | "input never reaches the system message" (4 tests), asserted against the prompt builder |
| Source, retrieval date and passage on every finding | "gives every finding a source, a retrieval date and a passage"; the columns are `NOT NULL`, so "refuses to store a finding with no passage behind it" checks the database rather than the code |
| Label-scoped, no cross-label leak | "keeps sources, runs and findings inside one label", "does not serve one label a run belonging to another" |
| Staleness detectable, with a named reason | five tests, one per reason: content changed, source added, source removed, past its freshness window, and current |
| Re-runnable, and reuse by default | "reuses a current run instead of paying for it again", "queues a new run when the user forces one" |
| A source that cannot be read is recorded, not skipped | "records a source it could not read rather than skipping it silently" |

**Still open, and why:**

- **No automatic discovery.** Finding a page nobody named needs a search engine
  and there is none, so `research()` still reports itself unavailable rather
  than being approximated. This is the remaining half of P1-5.

**Two findings worth recording.** The universal prompt rules said "use only what
is in `<gecontroleerde_feiten>`", which is right for content that gets published
and wrong for a task whose job is to read a source — the first real run returned
**zero findings** with the explanation "the page contains no facts that also
appear in the confirmed facts". The model was obeying us correctly, on a rule
that should not have applied. The rules are now split by task kind and
`prompt-rules.test.ts` pins the split; the same run then produced seven findings.

And a correction to something stated earlier: the demo card yielding **two**
personas instead of three is *not* explained by the absence of research. With
seven findings reaching the prompt (verified in the request), the count stayed
at two — because the source used was about a law, not about who the course is
for. The mechanism works; the source has to be relevant.

### P1-6 · Personas — M · **Done**
Three proposals covering need, motivation, barriers, decision criteria, relation
to the course, and grounding vs assumptions. **Fewer than three when grounding
is insufficient** — never padded. Focus on need and behaviour, not demographic
stereotypes. Versioned per label and course; campaigns bind to specific versions;
campaign-level adaptations never silently change the stored persona.

**Acceptance:** a low-evidence input yields fewer than three personas with the
reason stated; each persona separates grounding from assumption; a campaign
records the persona *version*; editing a campaign adaptation leaves the library
persona untouched.

**Held by:** `workflow-gates.test.ts`. Verified end to end: the demo course
card yields **two** personas plus an explicit Dutch reason for the shortfall.

### P1-7 · Opportunities — M · **Done**
Three reasoned opportunities per selected persona: goal and need, core idea,
source and timing, course/brand fit, uncertainties, a small test proposal, and a
measurement approach. Ranking rationale shown.

**Acceptance:** **no numeric success score and no sales forecast** is produced;
the ranking rationale is visible; each opportunity links to the evidence it rests
on.

### P1-8 · Briefs and approval — M · **Done**
Structured brief from a chosen opportunity. Approval is required before concept
generation.

**Acceptance:** concept generation is refused without `brief_version_approved`;
an approval binds to one brief version; changing a persona version moves the
brief to `needs_rereview`.

**Held by:** `generation-gates.test.ts`, which also asserts the refusal happens
*before* a job is queued — see ADR-0016 for why that distinction was a defect
worth its own test file.

### P1-9 · Reviews and approvals module — M · **Done**
The generic approval mechanism the above depend on.

**Acceptance:** approval references `(artefact, version)`; a new version is
unapproved without any flag being cleared; a dependency change flags dependents;
restore creates a new version and preserves history; server-side authority only.

### P1-10 · Label and member administration UI — S · **Done** (2026-09-10)
Replaces seed-only membership management.

**Acceptance:** only `member:manage` holders can change memberships; a change
takes effect on the actor's next request; every change is audited.

**Built:** `modules/identity-access/members-service.ts` and
`members-routes.ts`; the member panel on `LabelsPage.tsx`.

**Held by:** `member-administration.test.ts` (18).

| Criterion | Where |
| --- | --- |
| Only `member:manage` may change anything | "refuses a caller without member:manage, however senior on the label" — `member:manage` is an **organisation** permission; `label_manager` gets `member:read` only, so a manager cannot grant themselves a second label |
| A manager may read the team without widening it | "lets a label manager read the member list without being able to change it" — the candidate list, which is organisation-scoped, returns 403 |
| Effective on the next request | two tests, one per direction: a grant is visible to the very next `/me`, and a revocation makes the next label read return 404. Nothing is cached — `resolveCurrentUser` reads memberships every request — so these assert there is no session to expire |
| Every change audited, with both sides | three tests; `membership.changed` carries `previousRole` *and* `role`, because "who could do what, when" has to be answerable afterwards |
| Cross-label reads refused as absent | "does not serve the member list of a label the caller has no part in" |

**One rule added beyond the acceptance criteria.** Removing or demoting the
**last `label_manager`** is refused. Confirming a course fact needs
`course:write`, which only a manager grants; a label with no manager is a label
whose price, dates and entry conditions can never be confirmed again — and an
unconfirmed fact blocks a publish-ready export. That is requirement 6's
accountability rule expressed as a constraint rather than as a hope.

**Note on the verb.** The role change is `PATCH`, not `PUT`. The CORS allow-list
permits `PATCH` and not `PUT`, and widening a security control for a verb
preference is the wrong trade; changing one field of a membership is a partial
update either way.

---

## Phase 2 — Social pilot

### P2-1 · Real AI provider adapter (text) — M · **Done** (2026-09-10)
OpenAI adapter (ADR-0015) with strict Structured Outputs. Exercised end to end
against the live API: the full six-step chain completed, every contract's
converted schema was accepted, and cost came back real (14 calls, €0.22 actual
against €0.84 reserved).

**Still unexercised, and recorded as such:** real 429/5xx handling, image
generation, sustained volume (R-16).

The live run found four defects that stubbed tests could not — a stale worker
destroying unknown job types, the chain drifting into undeliverable channels,
and two render-layer text-fitting bugs. All fixed with tests; see R-19 to R-21.
**Acceptance:** response schema-validated at runtime; bounded repair/retry;
`capability_unavailable` when a capability is missing; **no silent mock
fallback**; cost recorded as estimated *and* actual; prompt template and version
recorded per call; a provider outage surfaces as a failure, never as content.

### P2-2 · Verified channel specifications — S · **Done** (2026-09-10)
All three pilot channels now carry hard constraints sourced from official
documentation, each with a source URL and a check date.

**Acceptance:** every entry carries a source URL and a verification date;
`isPublishable()` returns true only for `verified_against_official_docs`; an
unsupported format is never offered as publishable; the config is versioned and
content records which version it met.

**Facebook was the blocker, and the blocker was the wrong source.** Meta's
business help centre — what a marketer is pointed at — renders client-side and
cannot be read. The *developer* reference states the same limits in plain text,
and is the better source anyway: it says what the API enforces rather than what
a help article summarises.

Sourced from `developers.facebook.com/docs/graph-api/reference/page/photos/`:

| Field | Value | Wording |
| --- | --- | --- |
| `imageFormats` | jpeg, bmp, png, gif, tiff | "File type: .jpeg, .bmp, .png, .gif, .tiff" |
| `maxImageBytes` | 10 MB | "Files can not exceed 10MB." |
| `maxImagePixels` | **null** | not stated — Facebook "resizes images to different dimensions" |
| `altTextMaxChars` | **null** | not stated for a Page photo |

Meta publishes no caption length for a Page post, so `guidance` stays
`unverified`: what is unverified is *our* guidance, and we have none from an
official source. It does not gate publishability — `isPublishable` reads `hard`
only, because that is what the platform enforces.

**The second half of the acceptance was actually unmet, and verifying Facebook
exposed it.** The config carried a version; nothing on the content did. So the
moment Facebook became verified, existing assets kept returning a stored
warning saying "cannot be exported publish-ready" while the export, reading the
current config, no longer blocked on it — the interface and the gate disagreed,
and a user would have believed the interface.

Fixed in two parts: migration `0008` adds `channel_config_version` to
`content_asset_versions` (defaulting to **1**, not the current version — rows
written before the column existed were never judged against it, and a default
claiming otherwise would be a provenance fabricated by a DDL statement), and
the operative warnings are recomputed from the current config on every read, so
the two can never disagree again.

**Held by:** `workflow-gates.test.ts` (22) and `http-surface.test.ts`. Two of
its tests had to be rewritten: they asserted that Facebook was *not*
publishable, which was true and became false — a test pinned to a channel's
current status dies of success, and the temptation is then to flip the
assertion and lose the rule. The rule is now tested on a purpose-built spec
that is unverified by construction, including that `stale` does not count as
verified; the shipped config's status is asserted separately, in one place.

### P2-3 · Concepts — M · **Done**
Three creative concepts from an approved brief: core idea, example headline,
visual approach, and why it fits the persona.

### P2-4 · Content production for LinkedIn / Instagram / Facebook — L · **Done**
Per-channel copy, correct formats and dimensions. All three supported; none
mandatory per campaign.

### P2-5 · Image generation with a controlled render layer — L · **Done**
**Acceptance:** brand rules are hard constraints; logo and brand text are
composited by our render layer, **not drawn by the model**; two design variants
per visual asset with identical message and CTA; no performance guarantee is
stated anywhere in the UI.

### P2-6 · Editing and version comparison — M · **Done**
Direct text editing, image replacement, AI revision instructions, regeneration
of the selected item only, version comparison and restore.

**Acceptance:** a user edit is never silently overwritten by a regeneration;
concurrent edits produce `stale_version`; restore creates a new version.

### P2-7 · Draft and publish-ready export — M · **Done**
**Acceptance:** a draft export is always available and visibly labelled a draft;
a publish-ready package requires every gate in `PUBLISH_READY_GATES`; the package
separates channel, variant and version; missing CTA links block publish-ready but
not draft.

---

## Phase 3 — Campaign package

### P3-1 · Landing-page copy — M · **Done** (2026-09-10)

A landing page is now a channel the chain can plan, produce and export. It
carries **structured sections** rather than one body, has no rendered image, and
is delivered as plain text — not HTML — because the export is what a person
pastes into their own CMS, and nothing this product emits should be markup the
user cannot read first.

**The design decision worth recording.** `isPublishable` requires a channel's
limits to have been verified against the platform's own documentation. A landing
page is served from the label's own site: there is no platform, so no such
document exists. Three answers were available and two of them were dishonest —
claiming `verified_against_official_docs` with an invented source URL, or
leaving it `unverified` so a publish-ready export is blocked for ever on a check
that can never pass. The third, special-casing the channel inside
`isPublishable`, hides the rule from the data. So `channelVerification` gained
**`not_platform_constrained`**: it says the question does not apply, it is not a
synonym for verified, and `checkAgainstChannel` does not warn about it —
warning would send a user looking for documentation that does not exist.
`workflow-gates.test.ts` asserts the shipped value explicitly so nobody
"tidies" it into `verified` later.

**Two latent bugs this exposed**, both of which had been silent because every
channel used to be a social image post:

- The plan intersected the brief's channel suggestions with the **social pilot**
  list, not with what the build can produce. Widening `plannableChannel` was
  therefore not enough: the schema allowed a landing page and the plan filtered
  it straight back out. The capability lived in one place and the permission in
  another.
- The content asset's `format` was hardcoded to `single_image`. For a landing
  page there is no such specification, so the check fell into its "no
  specifications recorded" branch and **blocked every publish-ready export
  containing a page** — a channel refused for lacking a spec it should never
  have been asked for. The format now follows what was actually produced, which
  also makes the `text_only` LinkedIn specification reachable; it had been
  defined and unselectable since it was written.

Verified end to end through the browser: the content package shows
*Landingspagina · 1 · nee*, the content card carries its sections and no image
variants, the draft export contains a `SECTIES` block in plain text, and the
publish-ready refusal is back to the six reasons the demo data genuinely
warrants. `landing-page.test.ts` covers the chain, the sections, the absent
image, the publishability decision and the export's contents. The mock
provider's brief now suggests a landing page, so this shape is exercised by the
ordinary test run and by every smoke run rather than only when someone pays for
a real generation.

**Not done:** sections are read-only in the interface. The inline editor edits
hook, body and CTA; a section editor is a larger piece of interface, and until
it exists a section is changed by revising the content. That is deliberate — the
alternative is an editor that silently drops the sections it cannot show.

---

### P3-2 · E-mail with preview and HTML export — M · **Done** (2026-09-10)

E-mail is produced like a landing page — a subject line, an opening paragraph
and titled sections — and additionally exported as **HTML**, with a
brand-consistent preview in the interface. Nothing is sent; there is no sending
code anywhere.

**Safe by construction, not by sanitisation.** The model never produces markup:
it returns plain text, and `core/render/email-html.ts` is the only thing that
writes tags. So there is no untrusted HTML to clean and no sanitiser to get
wrong — a design where the model returned HTML and we sanitised it would be
strictly worse, because sanitisers are a moving target and a bypass would ship
inside a file the product had signed its name to. Eight unit tests feed the
builder text that tries to be markup and assert it comes out as characters.

**Not publishable, on purpose.** Unlike a landing page, e-mail *does* have
constraints — clients clip, Outlook renders through Word's engine — and none of
them has been checked against a primary source. Marking it
`not_platform_constrained` would claim there is nothing to check. So it is
`unverified` and behaves exactly like Facebook: generated, previewed, exported
as a draft, refused by the publish-ready gate, with a note saying what is
unverified so the refusal is actionable.

**Three security findings along the way**, none of which was part of the plan:

- **`z.url()` accepts `javascript:`, `data:` and `vbscript:`.** It validates
  URL *syntax*, and those are syntactically valid. `ctaUrl` was declared that
  way and reaches an `href` in the generated mail — and `sourceUrl` in the
  market-radar and research contracts was too, while the interface renders
  those as links, where a click would execute script in our own origin. A new
  `webUrl` primitive allows http and https only, applied at the contract
  boundary so every consumer is protected by construction. Pinned per field in
  `web-url.test.ts`, because the defect was never that the primitive was wrong
  — it was that a field used the wrong one.
- **A brand font name could inject CSS.** `typography.bodyFamily` is a free
  string and lands inside a `style` attribute, where it does not need to break
  out of the attribute to do harm: `Inter; background:url(https://…)` would add
  a remote background and turn the mail into the tracking beacon the module
  documents it must never be. No tag, no quote, nothing for escaping to catch.
  Font names are now matched against a font-name character set and dropped to
  the fallback stack if they are anything else; colours are re-checked as hex
  at the line where they become CSS.
- **The preview's first CSP broke the preview.** `default-src 'none'` blocks
  inline `style` attributes, which is exactly what an e-mail is styled with —
  so the frame rendered as unstyled text, showing the user something a
  recipient would never see. The browser smoke run caught it.
  `style-src 'unsafe-inline'` is required and is safe here: no part of the CSS
  is attacker-controlled any more, and the document is origin-less and
  script-free.

**One thing that was not a bug.** The content screenshot showed the preview as
a blank rectangle, which looked like a broken frame. It was the frame caught
mid-load. The smoke driver now reads the frame's own text and waits for it — a
frame that has not painted yet and a frame that never will look identical in a
screenshot, and only one is a defect.

Also consolidated: there were **four** separate HTML-escaping implementations
in four modules, differing in which characters they covered. The SVG layer and
the e-mail builder now share one strict version in `core/render/markup.ts`; the
two in the market-radar modules are recorded below.

- **S** Two more copies of the HTML escaper live in
  `modules/market-radar/package.ts` and `modules/campaign-packages/render.ts`.
  They should use `core/render/markup.ts`. Left alone for now only because
  those files were being actively edited.

---

### P3-3 · Relative calendar — M · **Done** (2026-09-10)

Every planned piece gets an offset in days from an unnamed day zero — one per
channel per week, staggered two days apart so a week's posts do not all land on
one morning. Choosing a start date turns those offsets into dates and changes
nothing else. The date can be removed again, returning the calendar to its
relative form.

**Derived, never stored.** A calendar is a pure function of the approved plan,
the start date and the course's confirmed dates, so it is computed on read.
Storing it would add a fourth thing to keep in step with three others, and the
first edit to any of them would make it a lie. It lives in
`packages/contracts/src/calendar.ts` so the server and the interface cannot
disagree about it.

**The model is never asked for dates.** A plan says what and how many, in
words; the schedule is arithmetic. A model asked for dates invents them, and an
invented date in a marketing calendar is exactly the kind of detail nobody
re-checks.

**It refuses to read an unconfirmed course date.** `course.dates` is only
populated once a person has confirmed the date fact; the prose on the card is
deliberately not parsed. When an unconfirmed date value exists the calendar says
so — "there are dates on the card and I am not using them" — rather than either
guessing at them or pretending the course has none. It also warns when the
schedule runs past the first confirmed course date, or when the campaign starts
after the course already has, and neither is a refusal: a second run of the same
course and a rolling intake are both legitimate, and the system cannot tell
which it is looking at.

Nine tests in `calendar.test.ts` cover the arithmetic — including a month and
year boundary, because the date maths is done by hand: `new Date('2027-12-28')`
is UTC midnight, and formatting it back in a timezone behind UTC returns the
previous day, so a calendar would shift depending on where it was read. Three
more in `page-and-email.test.ts` cover the wiring over HTTP, which is where this
could go wrong invisibly — the stored plan row wraps the plan itself, and
passing the wrapper produced an empty calendar with no error anywhere.

**A flake found and mitigated, not hidden.** The smoke run failed once with
`bind message supplies 2 parameters, but prepared statement "" requires 21`.
That is the Docker-free database multiplexing connections onto one PGlite and
colliding on unnamed prepared statements — not application logic; the in-process
suite passes. A poll that fails transiently no longer kills the run, because a
poll reads and changes nothing; five consecutive failures still fail it, which
is what separates a hiccup from an outage.

---

### P3-4 · Advertising proposals — M · **Done** (2026-09-10)

LinkedIn Ads, Meta Ads and Google Search Ads are producible channels. An advert
is a set of interchangeable lines rather than prose — three headlines, two
descriptions, and for Search a list of keywords — because a platform rotates
between them, and which line is which is exactly what the person pastes into a
form field.

**No figure can exist, and that is structural.** There is no field for search
volume, cost per click, budget, reach, click-through rate or conversions
anywhere in `adProposal`. Those numbers come from an advertising account and a
measurement period; this system has neither, so any figure would be a guess
wearing the clothes of data — on precisely the kind of decision (a media
budget) that people make from a number without re-checking it. Instructing a
model not to invent one is not the control: a schema with nowhere to put one
cannot carry it, whatever a future edit to the prompt forgets.
`ad-proposal.test.ts` names each forbidden field, so adding one fails and has
to be argued for in a diff.

**No character limit is stated either.** Each platform has real, documented
limits and none has been read against a primary source, so every number in the
three specifications is `null`. Unlike a social post, where a guessed length is
cosmetic, an advert that exceeds a limit is silently truncated or rejected — a
figure recalled from memory would look checked and would not be. The note names
the platform to go and check, and `isPublishable` refuses, the same treatment
Facebook and e-mail get.

**Phase 3 completes the producible set**, so `PRODUCIBLE_CHANNELS` and
`marketingChannel` now hold the same eight members. That broke two of my own
tests, correctly: they compared *data* — feeding a proposal an undeliverable
channel and expecting a refusal — and there is no such value left. The property
was never "some channel is refused"; it is that a **proposal** is bounded by
what the build can produce while a **stored row** is bounded only by the
vocabulary. The tests now assert that wiring, which holds whether or not the
two lists coincide. Producible still is not publishable: five of the eight
refuse a publish-ready export.

**A fourth copy of "which channels exist"**, found by the advert not appearing.
The mock adapter's context parser held a hardcoded array of five channel names
— the one place nobody thinks to update — so it silently dropped the
advertising channels, the plan had three items instead of four, and the missing
advert looked like a bug in the plan filter two modules away. It validates
against `marketingChannel` now: a mock has no business holding an opinion about
which channels the product has.

The mock chain now covers one of each *shape* — a social post, a page, an
e-mail and a search advert — rather than one of each channel, so the ordinary
test run and every browser smoke run exercise all four without making every run
generate more.

---

## Phase 4 — Learning and hardening

### P4-1 · Manual outcome entry and report upload — M · **Done** (2026-09-10)

Two things a person records once the product's part is over: **that they
published** a specific content version, and **what the platform then reported**.

`publication_records` had existed since migration 0006 with no reader and no
writer — designed for this and never wired, the same shape of dead surface as
the upload purpose removed earlier. It is now written and read, and migration
`0018_outcomes` adds the measured half.

**This system measures nothing, and the schema says so.** It has no advertising
account, no analytics access and no measurement period. Every figure was
obtained by a human, and `source` records which way — read off an attached
platform export, or typed in. That column is the point: without it a number in
this table would be indistinguishable from one the product had produced, and
the product produces none. A row claiming `platform_report` **must** have the
report attached; the contract and a database check both refuse it otherwise,
because that is the one shape that would let a typed guess pass as evidence.

**Absence is not zero.** Every metric is nullable: a platform reports what it
reports, `null` is "not reported" and `0` is "reported as none". An organic post
has no spend, and recording a `0` there would be a measurement nobody made.

**No derived metric is stored.** No click-through rate, cost per click or
conversion rate. They are arithmetic on the columns beside them, so they would
go stale the moment an input is corrected — and a stored ratio invites being
read as a verdict on the campaign. Whether the campaign *caused* any of it is
not a question these numbers answer; two of them moving together is not a
cause, and P4-2 is where that gets its own guardrails. A test asserts the
response carries no such field.

**Refused, with a check in the database as well as the contract:** a period
that ends before it starts, a negative count, a row with no figure at all (it
would record nothing while looking like a measurement), a publication pointing
at content from a different campaign of the same label — which without both
predicates would silently misattribute every later figure — a `javascript:` URL
as the published address, and an image chosen as a "report". That last one uses
the stored mime type, because the purpose an upload was made for is not
recorded on the asset row.

The channel is taken from the content row rather than from the caller: it is a
property of what was published, and accepting it as input would let a LinkedIn
post be filed as an e-mail. `outcome:read` and `outcome:write` already existed
in the access matrix, so the authorisation was designed for this too.

`outcome_report` is a new upload purpose and it **arrived with its consumer**,
as the rule this repository set for itself requires: an outcome row references
the report it was read from. Eleven tests in `outcomes.test.ts`.

---

### P4-2 · Approved learnings feeding later proposals — L · **Done** (2026-09-10)

A learning is a person's conclusion, approved before it influences anything,
and handed to later proposals as **context** rather than as instruction. Both
constraints in the item's own title are structural rather than hoped for.

**No causality claims from thin data.** Three fields, not one: `observationNl`
(what was measured), `hypothesisNl` (what the author thinks it means) and
`nextTestNl` (what would confirm or refute it). A single "what we learned" box
invites a sentence that reads as a proven cause — "video works better for this
audience" — from two campaigns and a fortnight. A hypothesis nobody could test
is an opinion, and the third field is what makes that visible.

The system writes no conclusions of its own. It has four data points, not a
data set, and a correlation it computed would arrive with the authority of
arithmetic and none of the caution. What it does instead is **state the size of
the evidence** next to the claim, every time the claim is shown or handed to a
model: `summariseEvidence` counts the outcomes, the distinct campaigns and the
span in days, and names each reason it is thin — fewer than three measurements,
a single campaign, under a fortnight. Thin is never a refusal: a thin learning
is often the only one available and is still worth writing down. It travels
with the warning attached, into the prompt, because a hypothesis handed over
without its thinness reads as settled.

**No automatic persona or brand changes.** The module imports neither schema
and writes to neither table; approving a learning changes exactly one row — its
own review state. The test for this is the only kind worth having: snapshot
every persona and brand row, approve, and assert nothing moved. A comment
promising it is worth nothing next to a diff of the rows.

Feeding: only `review_state = 'approved'` learnings reach a prompt, bounded to
the ten most recent, rendered as observation → hypothesis → evidence in that
order — a hypothesis read before its evidence is a conclusion; read after it,
it is a suggestion. Prompt rule **E** tells the model they are hypotheses, never
facts, never to be named in content or presented as a result, and to weigh a
thinly-supported one lightly. `persona.propose`, `opportunity.propose` and
`brief.draft` had their versions bumped.

**Deliberately not built:** the system does not *propose* learnings. Given the
"no causality claims from thin data" constraint, a generated conclusion is the
thing most likely to breach it, and human-authored is the honest default. If
AI-proposed learnings are wanted they should arrive as drafts with the same
evidence summary and the same approval — a separate item, not a variation on
this one. There is also no screen yet: this is API-only, recorded as such.

**A debugging detour worth recording:** the test that checks what reaches the
prompt reported zero calls while personas were plainly being generated.
`mockRestore()` clears a spy's recorded calls as well as restoring the method,
and the assertion read them after the `finally`. The fix is to capture inside
the `try`; the lesson is that a spy assertion after a restore is always vacuous.

- **S** No screen for outcomes (P4-1) or learnings (P4-2). Both are API-only. A
  results view is a Phase 4 interface piece of its own; shipping half of one
  would be worse than an honest "API only" in the documentation.
- **S** AI-proposed learnings, as drafts carrying the same evidence summary and
  the same approval gate. Only worth doing once there is more than a fortnight
  of data to propose from.

---

### P4-3 · Source-change impact analysis across campaigns — M · **Done** (2026-09-10)

Per-campaign staleness already existed: a research run snapshots what it read
with a content hash, so "is this run still current" is a comparison rather than
a guess, and the publish-ready gate refuses on it. What was missing is the
**inverse and wider** question, which is the one somebody actually asks: *a
source changed this morning — what does that touch?*

`GET /labels/:labelId/source-impact` answers it across a label's campaigns at
once. Three properties make the answer worth reading:

**It reports exposure, not wrongness.** A changed page may have had a typo
fixed. The report never says a claim is false — it says which campaigns rest on
the change, and how far each got. A test asserts that no message it can produce
contains "onjuist", "verkeerd" or "klopt niet", because sending people to
retract material over a corrected comma is worse than saying nothing.

**Exposure is computed, not implied.** `assessExposure` is a function in the
contract rather than a sentence inside a service, so changing the judgement is
a visible decision: a recorded publication is high because other people are
involved in undoing it; a *produced* publish-ready package is high because this
system hands over a file and cannot know what happened to it, so it assumes it
was used; approved-but-unexported content is medium; anything else is low,
because regenerating costs a model call. Now that P4-1 records publications,
that top rung is real rather than theoretical.

**The link to the evidence is a foreign key.** `research_findings.source_id`
records which source a finding came from, so the report lists the *actual*
claims that rest on the changed source rather than matching text. That is what
makes it checkable: a reader looks at the claim and decides whether the change
matters, instead of re-reading everything.

Two smaller decisions: campaigns with nothing stale behind them are **left out
entirely**, because a report listing everything as fine is one nobody opens
twice — the emptiness is the finding. And there is deliberately **no "fix it"
action**: what to do depends on what changed, and a button would invite not
reading.

**A bug caught while writing it:** the export module records a row for every
publish-ready *attempt*, including the ones the gates refused, so a refused
attempt would have counted as "the package may have been handed on". The check
now requires the package to have bytes. That is an over-claim in the direction
that wastes attention, which is the direction this whole report has to avoid.

The report is API-only for now, like P4-1 and P4-2, and the campaign list is
capped at 100 — a label with more than that should paginate before the number
is trusted, and the cap makes that a visible decision rather than a slow page.

---


~~P4-4 Load testing with recorded numbers~~ **done early** — a measured run was
needed to size the rate limits, and it found four defects; see
`docs/architecture/load-assumptions.md`. Cost testing and the multi-replica case
remain · ### P4-5 · Rehearsed restore — M · **Done** (2026-09-10), R-10 mitigated

`docs/security/backup-restore.md` carried the line *"the procedure below is
written and reviewable. It has never been executed"*. It has now, and — more
usefully — it is executed **on every commit** rather than quarterly.

`restore-drill.test.ts` builds real data (a campaign through to an approved,
exported package with rendered images on disk), takes a backup, throws the
database away, restores from the backup alone into a fresh instance, and runs
the verification. Then it does the thing that makes the drill worth having: it
**restores the database without its file storage and asserts the verification
catches it**. That is the failure the document warns about — "a content asset
row whose rendered image is missing is a broken record" — and nothing verified
it. It is also the likeliest real mistake, because the database is the part that
feels like the system, and it fails *silently*: every row present, every page
loading, images gone.

**What is rehearsed and what is not**, stated in the document rather than left
to be discovered: the verification and a genuine dump-and-load round trip are;
`pg_dump --format=custom`, `pg_restore` and WAL point-in-time recovery are not,
because those binaries are absent here. Step 1 (stop writers) cannot be
rehearsed on a single connection either — a job claiming against a half-restored
table is the failure that produces duplicate work, and one connection cannot
produce it. R-10 moves to *mitigated* with that residual named, not closed.

**What makes it transfer.** The eight checks live in the application
(`core/db/restore-verify.ts`), not in the test, and `npm run db:verify-restore`
points them at a real restored PostgreSQL. Verified against the running
development database over the wire protocol: 20 migrations, 24 tables matched
against a baseline, 6 memberships, 73 asset files all present. Without a
baseline it says so rather than pretending — "12 labels" is a number, not a
verification.

The counted-table list is explicit rather than "every table in the schema", so
a new table appearing is a deliberate addition to the drill instead of a silent
gap. `memberships` is the one to notice: authorisation must survive intact, or a
restore quietly removes people's access.

---

### P4-6 · Security review of the accumulated surface — M · **Done** (2026-09-11)

Written up in `docs/security/surface-review.md`. A review that concludes "the
code was read and it looked correct" decays the day somebody adds a route, so
wherever a finding could be expressed as a test it was:
`surface-authz.test.ts` walks **Fastify's own route table** and calls every
label-scoped route with a label that exists and belongs to somebody else.

**Two findings, both fixed:**

1. `GET /labels/:labelId/members/candidates` answered `200` for *any* label id,
   including one in another organisation. `member:manage` is an organisation
   permission on purpose — a brand-new label has no members, so requiring
   membership would make it unmanageable — but the label id went into a
   subquery without anyone checking whose it was. The returned users are always
   the caller's own organisation, so no data crossed; the *absence* of a user
   from the candidate list is information about that label's membership, and a
   `200` confirms the id is real. Bounded to the organisation now.
2. `/metrics` carried a comment promising "no user content, no label names, no
   identifiers" that nothing verified. Now asserted for `/health`, `/ready` and
   `/metrics`: no UUID, no label name, no e-mail address.

**My own test was wrong first**, which is worth recording: it assumed every
label-scoped route requires membership. It does not, and the exception is
legitimate — so the test names the exception rather than hiding it.

**Residual, stated rather than closed:** seventeen `POST`/`PATCH` routes are
inconclusive under the walk, because a request with no body is refused by schema
validation before authorisation and a `422` proves nothing. All seventeen were
read by hand and authorise in the service they call, and the suite lists them on
every run rather than counting them as passing. What cannot be automated is the
next one somebody adds.

- **M** Authorise before validating, via a scope-level hook on `:labelId`, so
  the whole surface becomes decisively testable. It must keep the
  organisation-administration exception working — exactly the kind of exception
  that goes wrong in a hook — so it deserves its own change rather than being
  bolted onto a review.

---

## Phase 5 — Production connection

P5-1 Real trusted-header contract, verified in the environment (closes R-01) ·
P5-2 TLS, secret storage, encryption at rest · P5-3 Confirmed data and AI
policies (closes R-04) · P5-4 Monitoring and alerting · P5-5 Production controls
from `docs/security/production-readiness.md`.

---

## Cross-cutting, pick up any time

~~**M** The campaign steps are numbered 1 Doelgroepen, 2 Kansen, 3 Briefing, but
  the brief is *drafted* from inside step 1 and that is what unlocks step 2~~
  **done** — the persona selection is lifted into `CampaignChain` and the
  brief-draft button now lives in step 3, so the chain runs in the order its
  headings claim. Verified through the browser: 13 of 13 steps, 1 → 2 → 3.

  Fixing it exposed three further defects, all now closed:

  - Every **draft export answered 500**. Migration 0010 made the unique index on
    `assets` partial, which invalidated the `ON CONFLICT (label_id, sha256,
    kind)` in the export writer — PostgreSQL refuses to infer a partial index
    unless the statement repeats its predicate, and it fails at plan time, so
    every export failed, not only a colliding one. The export path had no tests
    at all; `apps/api/tests/integration/exports.test.ts` now covers it.
  - The interface **rendered no error for a failing draft export**, so the button
    returned to its idle label and the failure was invisible. Both export
    buttons now report their own error.
  - A **refused publish-ready export answered 409 with a success-shaped body**,
    so the client found no error envelope and showed "Er is een onverwachte fout
    opgetreden" — for the most specific refusal in the product, six named
    reasons deep. The route now answers in the standard envelope with the
    reasons in the message. The refusal was, and still is, recorded either way.
  - `tools/ui-smoke` **passed steps it had not performed**: it returned as soon
    as it saw an empty job queue, which is true for a moment after every click
    while the POST is still in flight, and it reported "chose 0 of 0
    doelgroepen" as a success. It now waits for the job to appear before waiting
    for it to finish, fails a click that should have queued work and did not, and
    refuses to select nothing. It also reports *which* request failed — a bare
    "500" in the console cost an hour of database archaeology.
~~**S** Wire the course-page-URL extraction into the web UI~~ **done**
  (2026-09-10) — `components/CourseFromUrlPanel.tsx` on the **Opleidingen**
  screen. Until now the only way to get a course card was the demo seed, and the
  screen said so.

  The panel is explicit about what it produces, because this is a path where the
  interface could easily imply more than it should: the result is a *concept*
  card, every field arrives `unverified` with the page as its source, and the
  extractor's own reservation about the page is shown next to it. A refused URL
  shows the server's Dutch reason under the field — the shape of the URL is
  judged before anything is queued, so no budget is reserved and no queue slot
  is spent on a URL that will never be fetched.

  Verified against the live stack: `file://`, `http://169.254.169.254/`, a URL
  with credentials and `https://localhost:8080/` are each refused with their own
  message and no job; the official CROV page produced a real card
  (`isMock: false`) in ~14 s, and re-submitting it returned the finished job
  without queueing new work.

  Three things it needed first, all of which were duplication:

  - `useJobProgress` required a campaign id, so the Kansen screen passed the
    literal string `'kansen'` and invalidated a cache key that never existed. It
    is now optional, because a course card and a research run belong to the
    label, not to a campaign.
  - `JobWatcher` lived inside `CampagneDetailPage`. It is now
    `components/JobWatcher.tsx`, so there is one job-progress behaviour rather
    than three diverging ones — the adaptive backoff and the "never poll a
    hidden tab" rule should not depend on which screen you are looking at.
  - `jobResultString` had been copied into two screens; it moved next to
    `JobWatcher`.

  **Not done, and why:** re-reading the page of an *existing* card would create
  a second card rather than a new version, because `courseKey` is a server-side
  grouping key that the contract does not expose. Adding it is a contract
  change, not a wiring change. The panel therefore creates cards; it does not
  refresh them.

  **Not covered by an automated UI test.** There is no React test harness, and
  the refusal rules themselves are already pinned on the API side by
  `generation-gates.test.ts`. What is unproven automatically is that the
  interface *renders* them; that waits on the `tools/ui-smoke` CI item below.
  It was checked by hand, with screenshots.

~~**S** `SourcesResearchPanel` polls its own job with a hand-rolled
  `useQuery`~~ **done** (2026-09-10) — it uses `useJobProgress` and
  `JobWatcher` like every other screen. Two things were actually wrong rather
  than merely duplicated:

  - The old poller asked `/jobs/:id` every 1.5 seconds with **no backoff and no
    hidden-tab rule**, so a research run left open in a background tab kept
    asking for as long as it took. It now backs off (1.2 s, 3 s, 6 s) and stops
    when the tab is hidden.
  - Job feedback was a single line of text: **no progress bar and no retry**, so
    a run that failed on a provider outage left the user with a sentence and no
    way forward, while the same failure on a campaign step offered a button.

  Verified with a real forced run through the interface: the progress bar shows
  the worker's own message, the run advanced v2 → v3, the findings refetched on
  completion, and the browser made **16 job requests to one distinct URL** —
  one shared poll from one cache entry, not two pollers.

  `isTerminalJobStatus` is now exported from `campaign-queries.ts` rather than
  each screen keeping its own status list. There were two such lists; a third
  would have been the one that forgot `cancelled`, leaving the buttons disabled
  forever after a cancelled run.

  The findings query keys on `busy` on purpose: the worker writes the findings,
  so they exist only once the job is terminal, and the key changing exactly once
  is what refetches them. Polling alone cannot be trusted for that — the last
  poll of a busy run can land before the worker has committed its rows.
~~**S** Wire the brand-logo and course-document upload endpoints into the web
  UI~~ **done** (2026-09-10), but only the course-document half was wiring. The
  brand-logo half was **not**: the endpoint accepted a logo, validated it,
  stored it and the brand profile had a column for the reference — and nothing
  read it. `loadBrandResources` returned early for any label without a Brand
  Portal link, so a locally uploaded logo reached everywhere except the
  renderer. Wiring a button to that would have been a button that appears to
  work.

  **Course documents** — `components/CourseIntakePanel.tsx` (renamed from
  `CourseFromUrlPanel`) now takes a page URL *or* a document, sharing one
  progress area. Verified through the interface: an `.md` file containing PNG
  bytes is refused with "Hier is een document nodig; dit is een
  PNG-afbeelding" — the bytes decide, not the extension — and nothing is
  queued; a real demo document produced a v2 of the card with all eight fields
  `unverified`. Re-submitting the identical file deduplicates the asset and
  returns the *existing* job rather than paying for a second extraction.

  **Brand logo** — needed three changes before a screen could be honest about
  it:

  - `logoAssetId` added to `brandProfileInput`. The id is a request, never an
    authorisation: the server re-checks that the asset is in this label, and an
    id from another label reads as **absent** rather than forbidden, so it
    cannot become an existence oracle.
  - `core/render/brand-resources.ts` — a `loadRenderResources` wrapper that
    delegates to the Portal loader for linked labels and loads a local logo
    otherwise. The Portal function is untouched; local editing is already
    refused for Portal-managed labels, so the two cases cannot both apply.
  - PNG only, refused rather than accepted-and-ignored. A JPEG passes the
    upload endpoint and would then quietly fail to draw into an exportable
    image.

  **The trap worth recording:** every upload is stored with `kind: 'upload'`
  whatever purpose it was sent for, and `kind: 'logo'` is reserved for a Portal
  release. A check for kind `logo` reads as obviously correct and rejects every
  uploaded logo. The purpose is not on the asset row at all, so the stored
  **mime type** — decided by the file's own bytes — is what separates a logo
  from a course document belonging to the same label. `brand-logo.test.ts`
  pins all four cases, including a logo whose bytes no longer match the hash
  recorded at upload, which must not be composited into an exported image.

  Verified live against a fresh API instance on a spare port (the shared dev
  API was two hours stale and had silently stripped the new field): upload →
  save → v4 draft carrying the reference; a course document's id refused with
  400 "Een logo moet een PNG-bestand zijn."; an unknown id refused with 404.
  The compositing itself is covered by `brand-logo.test.ts`, which asserts the
  rendered resources contain the exact uploaded bytes, rather than by eye.

~~**S** `brand_document` is the fifth upload purpose and still has no screen~~
  **resolved by removing it** (2026-09-10). Nothing referenced it anywhere: no
  job, no service, no screen, no test, and not the Brand Portal either. It was a
  live authenticated endpoint that accepted and stored documents no code path
  would ever read — storage and accepted-file surface in exchange for nothing.

  Removing it was the conservative option, not the ambitious one. The
  alternative was to invent a purpose for it, and the obvious candidate —
  extracting brand rules from a guidelines document — is a real feature with a
  job type, a prompt template and a screen, not a wiring task. It should arrive
  as one:

  - **If brand-rule extraction is wanted**, it follows the shape the product
    already uses three times: a document is uploaded and validated, a queued job
    proposes `rules` for the brand profile, every proposal arrives unverified
    with the document as its source, and a person confirms each one. That is a
    Phase 2-sized item, and it brings `brand_document` back with it.

  `upload-surface.test.ts` now pins the accepted purposes, so adding one fails
  until the list is updated — and the person updating it has to answer "what
  reads this?". Existing files are untouched: downloads are addressed by asset
  id, not by purpose, so nothing already stored became unreachable.
- **S** Automated `CHANGELOG.md` from commits (change management gap).
~~**S** Agree blocking severity thresholds for `npm audit` and Trivy (R-09)~~
  **done** (2026-09-10). Both scanners are now blocking:
  dependencies at **high and critical** via `npm run audit:gate`, container
  images at **CRITICAL** for findings that have a fix, on the API **and** the
  worker image — only the API was scanned before, which was an oversight rather
  than a decision. Moderate dependencies and image HIGHs are reported.

  The thresholds are engineering's proposal and still want business sign-off;
  the reasoning is written down in `docs/security/vulnerability-management.md`
  so agreeing or changing them is a decision about risk rather than about a
  number. The gate is on either way, and R-09 moves to *mitigated*.

  **Why this needed building and not just deciding.** Both scanners already
  ran, and both were wrapped so they could not fail — `|| true` on the audit,
  `exit-code: '0'` on Trivy. That is what a threshold with no exception
  mechanism turns into the first time an unfixable transitive advisory appears.
  So `tools/audit-gate/` accepts an advisory only with a reason **and an expiry
  date**, and enforces three things mechanically: an acceptance that has
  expired blocks again; an acceptance that no longer matches anything fails
  with "remove this entry", because a list nobody prunes grows until it hides
  the next real finding; and a report whose format it does not recognise fails
  rather than announcing a clean build. Eight tests in
  `tools/audit-gate/tests/evaluate.test.ts` cover exactly those three ways a
  gate quietly stops working.

  Turned on at the right moment: the tree had one advisory, a low, so enabling
  the gate blocked nothing and starts from a clean baseline rather than from a
  list of exceptions.
- **S** Confirm audit and IP-hash retention periods (data inventory).
~~**M** Turn `tools/ui-smoke` into an assertion suite in CI~~ **done**
  (2026-09-10). `npm run smoke` boots its own stack, drives all sixteen chain
  steps in a real browser and then **asserts what the campaign contains**.
  Added to CI as the `ui-smoke` job; screenshots are kept as artefacts on
  success as well as failure, because a passing run's screenshots are how a
  person notices what assertions cannot.

  **It costs nothing and needs no key.** `AI_PROVIDER=mock` inside the runner,
  so the run exercises the product — gates, queue, render layer, export —
  rather than a model. Running it against the real provider stays a deliberate
  separate act (`npx tsx tools/ui-smoke/index.ts`), because that costs roughly
  one campaign each time.

  **The ten checks.** Reaching sixteen steps only proves sixteen buttons were
  clickable; every defect this driver has found was visible in the state
  afterwards. So it reads the finished campaign back and asserts: the briefing
  exists, is approved and rests on chosen doelgroepen; three concepts with one
  chosen; the plan approved; content with two image variants; **a draft package
  with bytes** — the check nothing had, while every draft export answered 500
  for several migrations; a publicatieklaar package **refused with reasons**,
  because with unverified demo facts a pass would mean the gates had stopped
  working; no script errors; and no failed request other than that refusal.
  A shape check runs first, so a changed response cannot make the rest vacuous.

  **Four defects in the runner itself, each found by running it:**

  - Vite launched from the repository root served an empty directory, and the
    run failed on a blank page three steps from the cause. It runs in
    `apps/web` now.
  - `403 origin_not_allowed`. Every state-changing request carrying an `Origin`
    must match `CORS_ALLOWED_ORIGINS` — a real CSRF control, not a CORS
    convenience, which is why the same POST succeeded from curl (no origin
    header). A stack on a non-standard port must declare its own origin,
    exactly as a deployment must.
  - `ECONNRESET` from inside an unrelated query. `DATABASE_POOL_MAX` defaults
    to twenty **per process** and this stack runs two, against a PGlite that
    allows twelve. The values that make it fit live only in the uncommitted
    developer `.env`, so any fresh machine or CI runner would have hit this and
    been told only that a socket closed. Set explicitly now, with the
    arithmetic written down.
  - The driver failed its own check: `verifyOutcome` asked every accessible
    label for the campaign, each wrong one answered 404, and the browser logged
    those as failed resources. It reads the label the run selected. Related: the
    queue poll fetched `/api/v1/labels` on every tick to translate a slug into
    an id — hundreds of needless requests over a chain, enough to be rate
    limited, and a limiter's answer has no `items`, so the driver died on
    `Cannot read properties of undefined` and blamed the queue. The slug input
    is gone; the switcher's own value carries the id.

  Failures now explain themselves: a setup failure prints what the screen says
  in Dutch **and** which request failed, and the runner dumps the tail of each
  server's log. Before that, a 403 the API had explained in its log surfaced as
  a bare locator timeout.

- **S** `LISTEN`/`NOTIFY` on the queue if job latency ever becomes visible.

## Campaign-flow redesign — `campaign-flow-design.md`

The three decisions were taken on 2026-09-11 (three fixed stages Ontdekken /
Overwegen / Beslissen; the model may adjust a rule verdict one step with a
reason, never from ontraden to aanbevolen; the objective sits alongside the
entry mode rather than replacing it).

### F-1 · Objective and channel advice (slice 1) — L · **Done** (2026-09-11)

A campaign now knows what it is for, the plan says which channel serves which
stage and why, and content is written per stage. `docs/PLATFORM.md` has the
full account under *Campaign flow: objective, funnel stages and channel advice*.

**Built:** `funnelStage`, `campaignObjective`, `stagesForObjective`, the
guidance per stage and the `channelFit` rule table in
`packages/contracts/src/funnel.ts`; `channelAdvice` with no field for a figure
and two refinements (rule quoted exactly, one step at most); migration
`0021_funnel`; Stap 0 objective cards with no default; `content.plan` v2 with
`<funnelfasen>` and `<kanaalgeschiktheid>`, returning items with a stage and
advice per cell; `planProblems` for the checks the schema cannot make; the stage
× channel grid with *Alle creatives maken* and a size estimate; `content.generate`
v5 **one call per stage**, asset keys `${stage}-${channel}-1`, stage stored on
every version and shown as a badge, content grouped by stage; stage folders and
the advice in the export package; the mock adapter planning from the same rule
table; the browser smoke choosing *Hele funnel* and checking three stages with
advice on the plan and a stage on every asset.

**Deviations from the design, recorded:** the migration is `0021`, not `0020`
(taken meanwhile); content generation is one provider call per stage rather
than one call carrying the stage; the export already files content per stage
and prints the advice, which the design had placed in slice 2.

**Found on the way, fixed, kept as tests or checks:** the label-drift test
only read `apps/web` and `packages/ui`, so a label that comes from the contract
(*Hele funnel*) looked missing — it now reads the contract too; the API answers
validation failures with `422`, not `400`; the calendar numbered pieces per plan
item, so a staged plan showed three "first" e-mails on one day — the browser
smoke's duplicate-key warning caught it and `buildCampaignCalendar` now numbers
per channel across the plan; and with two e-mails in a full-funnel plan the
smoke's preview check had to say *which* preview it means. The driver now also
names the failed requests when a chain stalls, because the first stall read as
a locator timeout and cost a screenshot and a guess.

### F-2 · Per-stage briefing (slice 2) — M · **Done** (2026-09-11)

The briefing speaks per stage: `brief_versions.stage_messages` (migration
`0022_stage_briefing_results`), `stageMessage` in the contract (message, CTA
kind, confirmed proof *fields*), `brief.draft` v4 with `<bewijsvelden>`, the
service refusing a message outside the objective and removing unconfirmed
proof with a review note (`stageMessageProblems`, `confirmedProofOnly`), and
`content.generate` v6 receiving `<fase_boodschap>` with the proof resolved
against the course card at generation time. Stap 3 shows the *Boodschap per
funnelfase* block; Stap 6 groups content under the stage's own message.

**Held by:** `funnel-plan.test.ts` (every stage briefed, confirmed proof only,
content opens with the stage's message), the browser smoke (three stages
briefed).

### F-3 · Results by stage (slice 3) — S · **Done** (2026-09-11)

`outcome_reports.funnel_stage` (nullable), `outcomeInput.funnelStage`, the
calendar sequenced by stage (`buildCampaignCalendar`: Ontdekken from week 1,
Overwegen from week 2, Beslissen from week 3; slots carry their stage), and
the new Stap 8 *Resultaten & lessen* where publications, figures per channel
and stage, and learnings are recorded — the first interface the outcomes and
learnings modules ever had.

**Held by:** `calendar.test.ts` (staged sequencing), `funnel-plan.test.ts`
(outcome with a stage; refusal outside the vocabulary), the browser smoke
(calendar in journey order).

- **S** The plan's `count` is still advisory: generation makes one piece per
  cell. Either honour the count (`-1`, `-2` keys) or drop the field.

## Package, audience research and channel advice — `campaign-package-and-audience-research-design.md`

Design of 2026-09-11, grounded in six web-research angles with opened sources
and three code maps; the design panel and adversarial verifiers could not run
(subagent spend limit), so the document says it was synthesised by one author.
Six decisions are listed in the document with recommended answers.

### R-1 · One vocabulary and honesty fixes — S · **Done** (2026-09-11)

The content-plan gate, stage and messages say *kanaalplan* (the word
*contentpakket* also named the campaign package and the export ZIP); the
brief's *Kanalen* row and the worker's progress line use Dutch channel labels;
the advice panel prints "geen toespitsing op deze doelgroepen — het advies
volgt de regel" when a reasoning merely repeats the rule, instead of dressing
the rule up as tailoring.

### R-2 · `content.plan` v3 — M · **Done** (2026-09-11)
Advice for every producible cell (`channelFit` over stages × `PRODUCIBLE_CHANNELS`),
the brief's channels marked `<kanalen_uit_briefing>` and the only ones items are
planned for, a one-step move allowed only on a *grounded* statement in
`<doelgroep_kanalen>` or a course fact — otherwise the rule stays and the model
says "geen doelgroepbewijs over dit kanaal" — and approved learnings passed into
`content.plan` and `content.generate` (`ConceptService` and `ContentAssetService`
take the learning store). `planProblems` accepts advice on any producible channel
and checks one measurement per stage. **Held by:** `funnel-plan.test.ts`, the
browser smoke (eight channels advised).

### R-3 · Persona channel evidence — M · **Done** (2026-09-11)
`orientationSources` on a persona (statement, channel, grounding or null), the
`persona.propose` v4 rule mirroring the demographics rule, and server-side
verification (`verifyOrientationSources`): a cited source the service did not
hand the model loses its grounding and reads as an assumption. The persona step
shows every statement with *onderbouwd* or *aanname*, the grounding list and the
assumptions in full. **Held by:** `persona-orientation.test.ts`.
- **Open (S):** `research.findings` channel-presence claims and public NL
  sources (CBS 84888NED, Newcom free report, platform docs) registered per
  label — today evidence can come only from a label's own findings and
  confirmed facts.

### R-4 · Model-proposed deliverables from a catalogue — L · **Partly done** (2026-09-11)
Done: the package prompts (`campaign.deliverables` v3, `campaign.package` v4)
receive `<campagnedoel>`, `<funnelfasen>`, `<doelgroepen>`, `<fase_boodschappen>`
and the approved `<kanaalplan>`; every recommended form names the stage it
serves (`stage` on the recommendation, shown as a badge); the mock proposes one
form per stage rather than all three. The panel is the branch *Website &
interactief* beside the eight steps. **Open:** the `deliverableForm` catalogue
with stage fit, producible flag, *niet gekozen omdat* and hypothesis per form;
folding the forms into the Kanaalplan grid.

### R-5 · Questions as a research instrument — M · **Partly done** (2026-09-11)
Done: a brief pinned to a persona version moves to `needs_rereview` when that
persona gets a new version, the gate says why, and the screen offers a
re-approval (`PersonaService.createVersion`). **Open:** question-design rules
in the contract (one concept, first-person situations, no ja/nee), honest
result rules, aggregate-only `interaction_signals` entered from the host's
analytics or Studio counters, learnings citing signals, persona hypotheses as
reviewed draft versions. Thresholds n ≥ 10 / 30 / 100.

### R-6 · Information architecture — M · **Done** (2026-09-11)
Eight numbered steps from one list (`STEPS` in `CampagneDetailPage.tsx`; the
step bar numbers by position, every card takes its number from the same list),
the package as the unnumbered branch *Website & interactief*, one primary
action per step derived from server state, the *Volgende stap* notice that
jumps there, `?fase=` written on every change, `FunnelPills` in the header and
the campaign list, `FlowNavigation` rewritten on tokens, the plan grid's
argument readable without hover (`CellAdvicePanel`) and cells that deviate from
the rule marked. Codex was idle, so its files were edited directly.

### R-7 · Measurement without forecasts — M · **Partly done** (2026-09-11)
Done: `measurementPlan` on the content plan (`stageMeasurement`: indicator,
source, decision rule per stage, no field for a target or a forecast),
`FUNNEL_STAGE_INDICATOR_NL` (the evaluation ladder per stage, digit-free),
`<meetladder>` in `content.plan` v3, the *Meetplan per fase* panel in Stap 5 and
at the top of Stap 8, the plan text in the export; `outcome_reports.funnel_stage`
with F-3. **Open:** an experiment spec for paid channels, results as intervals
with n, a hypothesis block per package deliverable.
- **S** A real-provider run of the new `brief.draft`, `content.plan` and
  `content.generate` prompts, to see how often the one-step refinement or the
  stage-message check trips a repair.

### R-8 · Questionnaire filled from the system's own research — M · **Done** (2026-09-11)
Proposed personas arrive with their 36-question questionnaire filled, one
`persona.questionnaire` v1 call per persona over exactly the material the
system gathered: research findings, confirmed course facts and the campaign
input. `verifyQuestionnaire` keeps an answer as *provided* only when its quote
is found literally in that material and stores where (`sourceRef`, `sourceKind`,
`sourceRetrievedAt`); an untraceable statement becomes an assumption, the
personal-context questions stay unknown without a stated passage, the
meta-question needs no quote, conflicting answers stay unknown, and an unusable
model answer leaves the questionnaire on unknown without failing the persona.
The job result carries `questionnaireNoteNl`, shown in the Doelgroep step.
Tests: `persona-questionnaire.test.ts` (unit), `persona-auto-questionnaire.test.ts`.
**Open:** none in this slice; a real-provider run of the new prompt is the
user's to trigger, and the counter on the persona card still measures
completeness, not quality.

## Personas, campaigns list and content quality — `personas-campaigns-content-quality-design.md`

### P · Personas that accumulate and can be corrected — M · **Done** (2026-09-12)
Run-scoped persona keys, `<bestaande_doelgroepen>` and a duplicate guard in
`PersonaService.propose`; `personaKey`/`campaignId` on the contract; list
scopes; promotion to the library; the shared `PersonaEditor` in the Doelgroep
step and the library page. Tests: `persona-additions.test.ts`. **Open:**
approve/archive routes for personas; a "Nieuw" badge relies on the job result
and disappears on reload.

### K · A campaigns list that shows where each campaign stands — M · **Done** (2026-09-12)
`computeCampaignProgress` in the contracts, used by the list route (grouped
queries, keyset pagination) and the detail page; the redesigned `/campagnes`.
Tests: `campaign-progress.test.ts`, `campaign-list-progress.test.ts`.
**Open:** "Meer laden" in the interface for labels with more than a hundred
campaigns; `campaign.stage` is still written by the services though no screen
reads it as a status any more.

### C · Content that is long enough, specific, findable and shareable — L · **Done** (2026-09-12)
Length rules per channel, the website piece as a page change or an article
from the live course page, brief keywords from research or derivation,
hashtags, the quality checks with one repair round, per-piece calls,
`content.generate` v8, the new asset card. Tests: `content-quality.test.ts`
(unit and integration). **Open:** a real-provider run; HTML rendering of the
website piece; a repair for a recited fact (today a stored warning).

### P2 · Personas linked to several courses — S · **Done** (2026-09-14)
`linkedCourseVersionIds` on the persona, a checkbox dropdown in the editor,
latest-then-filter listing, links accepted for a campaign on a linked course.
Tests: `persona-course-links.test.ts`. **Open:** moving a persona's primary
course; links shown in the campaign step's persona rows.

### B · A briefing a colleague can pick up — M · **Done** (2026-09-14)
Eight new sections, word floors per section and in total, a role per channel,
no percentage in goal or measurement, one repair round, `brief.draft` v7, the
brief as a numbered document with Markdown copy. Tests:
`brief-problems.test.ts`, `brief-professional.test.ts`. **Open:** a brief
export file; budget as a section; a real-provider run.

### UI · One interface for every screen — L · **Done** (2026-09-14)
Page anatomy and components in `packages/ui` (`ui-design-system.md`); the
stepper; every screen converted; Content Studio and Doelgroepen rewritten.
**Open:** a mobile navigation drawer; a web component test runner; icons on
every button.

### C2 · The blog article as researched practice — M · **Done** (2026-09-14)
Title as the reader's question, direct answer, question headings that stand
alone, one scenario, cited facts only from handed sources, the course only in
the bridge and the path, two calls to action, no marketese, no unsourced
number; `content.generate` v9; `blog-article-practice.md`. **Open:** author
byline and dates; Article JSON-LD in an HTML export; a real-provider run.

### P3 · Every persona question answered, stored personas completed — M · **Done** (2026-09-14)
`persona.questionnaire` v2 answers all 36: *uit bron* with quote and reference,
or *door AI afgeleid* as an assumption with the model's reasoning; personal
questions answered about relevance, an estimated age replaced by the honest
sentence; open and conflicting questions become explicit system cells.
`origin` and `reasoningNl` on every answer; legend and badge per answer in the
interface. A person can complete a stored persona with one job
(`persona.fill_questionnaire`): only the open cells change, identity and
origin stay. Tests: `persona-questionnaire.test.ts`,
`persona-auto-questionnaire.test.ts`, `persona-fill-questionnaire.test.ts`.
**Open:** a real-provider run of v2 (the user's to trigger; the fill buttons
were not pressed against the dev stack); a mechanical guard for
region/circumstances beyond the prompt rule; a server-side bulk fill.

### S · Showcase readiness: destination, quiz, readable branch — M · **Done** (2026-09-15)
Every call to action gets a destination (model → radar target → course
page) in the briefing and in content; a promised keuzehulp is flagged until it
exists; the keuzehulp is a quiz with signals and three outcomes, played in a
sandboxed preview on the campaign screen with the embed code; the branch shows
its four gates as a checklist. `brief.draft` v8, `campaign.package` v6.
Tests: `quiz.test.ts`, `campaign-package-quiz.test.ts`. **Open:** a
real-provider run before the showcase (the user's to trigger); font files in
the preview; a server-side coherence gate that refuses content promising a
keuzehulp no package has.

### G · Google Ads from Google's documentation — L · **Done** (2026-09-15)
Sixty-six help pages read on 2026-09-15 (`google-ads-practice.md`); the
channel verified for its text limits; `googleAdsFrame` per stage with sourced
objective, type, conversion actions, bidding path and EEA requirements;
`content.generate` v12 writes a responsive search ad; shape and context checks
with one repair round; counts and frame in the interface; frame and a hand-off
CSV in the export. Tests: `google-ads.test.ts` (contracts),
`google-ads-quality.test.ts`. **Open:** LinkedIn Ads and Meta Ads limits from
their own documentation; Google Ads Editor's import format; a real-provider
run; a Demand Gen asset set for Ontdekken.

## Audit van 15 september 2026 — tien onderzoekers

Tien parallelle agents: acht op de markt (Adobe, Optimizely, Wrike, Sprout, Buffer,
Semrush, HubSpot, Salesforce Education Cloud, Brevo, Frontify, Google, Profound),
twee op onze eigen code. 95 marktfuncties, 73 integraties, 27 interne bevindingen.
De drie zwaarste bevindingen zijn daarna met de hand in de code geverifieerd.
Diagnose als gedeelde pagina: `claude.ai/artifact/FHv9xy3QirepGi7qvRg8Py`.
Plan voor de manager: `claude.ai/artifact/` (bouwlijst, zelfde datum).

### A-0 · Herstel: wat vandaag stukgaat — S/M elk

**Alle zeven gebouwd op 15 september 2026.** Zie de sectie in `PLATFORM.md`.
`/kalender` blijft bewust op "nog niet beschikbaar" staan tot de kalender uit
MVP-1 er is; `/resultaten` is wel gevuld. Daarnaast is de webtypecheck
gerepareerd: `RadarPage` gaf nog een `run`-prop door aan een component die in
tweeën was gesplitst.

1. **Een campagne kan niet mee met een nieuwe opleidingskaart.** `campaigns.courseVersionId`
   wordt bij `create` gezet en nooit meer verplaatst; `CourseService.approve` archiveert elke
   eerder goedgekeurde versie van dezelfde `courseKey` (service.ts rond regel 548), en de
   exportpoort leest `campaign.courseVersionId` en eist `reviewState === 'approved'`
   (exports/service.ts rond regel 84). Gevolg: één goedgekeurde kaartverbetering maakt elke
   lopende campagne permanent onexporteerbaar, met de melding "De opleidingskaart is nog niet
   goedgekeurd" — terwijl de gebruiker hem net goedkeurde. **Fix:** een route die de campagne
   herricht op de nieuwste goedgekeurde versie van dezelfde `courseKey`, en in dezelfde
   transactie brief en content op `needs_rereview` zet. Zelf geverifieerd.
2. **`flagStaleForLabel` heeft nul aanroepers** (`content-assets/service.ts` rond regel 1030;
   grep bevestigt één bestand). Merk- en cursusgoedkeuring markeren dus niets. **Fix:** aanroepen
   vanuit `CourseService.approve` en `BrandService.approve`, binnen dezelfde transactie.
3. **Bronwijzigingsanalyse heeft geen scherm.** `GET /labels/:labelId/source-impact` bestaat en
   wordt nergens getoond. **Fix:** in de Werkruimte onder "Actie nodig", met een link per campagne.
4. **De briefing is alleen-lezen in de interface.** De PATCH-route bestaat
   (`campaigns-briefs/routes.ts` rond regel 403) en heeft geen enkele aanroeper in de web-app.
   **Fix:** `BriefDocument` per sectie bewerkbaar maken; geen API-werk nodig.
5. **Openstaande onderdelen zijn niet aanklikbaar.** Eigen constatering van de producteigenaar:
   je ziet dát er iets open staat, niet waar. **Fix:** de melding koppelen aan de stap en het
   paneel openen bij klik.
6. **De stappenbalk klopt niet** voor `discover_opportunities` zonder kans en voor campagnes met
   een `radarRunId` (`computeCampaignProgress`). **Fix:** een campagne met radarherkomst telt als
   "richting gekozen"; de overslaan-knop in elke instapmodus tonen.
7. **`/kalender` en `/resultaten` staan in de navigatie als NOG NIET** terwijl stap 8 wel
   resultaten vastlegt en learnings label-breed bestaan. **Fix:** vullen of weghalen.

### A-0b · Schermindeling — gebouwd op 15 september 2026

Klacht van de producteigenaar: kaarten onder elkaar in plaats van naast elkaar,
gemaakte content niet gesplitst per kanaal, concurrenten verstopt in een
tabblad. Gebouwd, gemeten met een volledige schermafdruk op 1440 px, en
vastgelegd in `PLATFORM.md` (sectie *De schermen opnieuw ingedeeld*).

- Sub-links onder Marktradar: Marktbeeld, Bewaarde kansen, **Concurrenten**, Zoekvragen.
- `.c360-deck`: één zelfvullend kaartenraster met gelijke hoogte en knoppen op één lijn.
- Content Studio gegroepeerd per kanaal; campagne-stap 6 van 5660 naar 2463 px.
- Marktradar-marktbeeld van 4489 naar 3087 px: tellingen vooraan, alleen het gekozen inzicht open.
- Campagnes opent met vier tellingen die tegelijk het filter zijn.
- De briefing heeft een sprongindex over zeventien onderdelen.
- Verholpen: foutzin in een kolom van tien tekens, ongelijke persona-kaarten,
  dubbel getoonde AI-Visibility-bronnen.

De Marktradar kreeg daarna een tweede ronde: de acht weergaven staan als een
kolom naast het paneel, elk met één regel uitleg en een telling, en de
scaninstellingen staan eronder ingeklapt. Zie `PLATFORM.md`, sectie *Marktradar
als werkbank*.

Nog open uit deze ronde: Content Studio blijft 5622 px bij 27 stukken plus zeven
pakketten. Dat is de hoeveelheid, niet de indeling; paginering of een
compactere lijstweergave is de volgende stap.

### A-1 · Vier ontbrekende identiteiten — elk één kleine migratie

- **`course_runs`** — een training bestaat alleen als naamloos element in `course_versions.dates`
  (jsonb), opnieuw aangemaakt bij elke kaartrevisie. Niets kan naar "de januarigroep" wijzen, dus
  bezetting kan nergens staan. Nodig: id, `course_key`, start, eind, locatie, vorm, capaciteit,
  bezet, bijgewerkt-op. **Alleen aantallen, nooit deelnemersgegevens.**
- **`calendar_entries`** — de planning is een pure functie zonder rij, dus niets is te verzetten,
  toe te wijzen of te koppelen. Nodig: datum, status, campagne (nullable), asset-sleutel
  (nullable), verzet-door.
- **`tasks` + `notifications`** — er is geen enkele uitgaande melding in het systeem (grep op
  nodemailer/smtp/webhook levert niets op). Nodig: onderwerp, eigenaar, deadline, staat.
- **Losse content** — `content_asset_versions.campaign_id`, `brief_version_id` en
  `concept_version_id` zijn alle drie `NOT NULL` (migratie 0006, regels 46/60/61). Nodig: alle drie
  nullable plus `owner_scope` met een CHECK, en een asset-sleutel die label-breed uniek is.
  Zelf geverifieerd.

### A-2 · Geen enkele niet-menselijke identiteit

Er is geen API-sleutel, geen serviceprincipal, geen webhook, geen uitgaande gebeurtenis en geen
planbare taak (`EnqueueInput` kent geen `runAt`, hoewel de claimquery `run_at` al respecteert).
`outcome_reports` weigert bovendien elk geïmporteerd cijfer via
`CHECK (source IN ('platform_report','manual_entry'))`. Elke koppeling — analytics, inschrijvingen,
publiceren — loopt hierop vast. **Fix:** `api_clients` met scopes, een derde auth-adapter,
`runAt` op de wachtrij, en `connector_import` als toegestane bron.

### A-3 · Eerst te koppelen, op volgorde

Search Console (gratis, eerste partij, geen persoonsgegevens) · ICS-agendafeed (open standaard) ·
Teams-melding via Power Automate (de oude webhooks verdwijnen in mei 2026) · Buffer (API op alle
plannen, geen app-review) · GA4 Data API ·
LinkedIn Community Management API (zelf aan te vragen) · SharePoint via Microsoft Graph met
`Sites.Selected` (eigen analyse, nog niet tegen documentatie gecontroleerd).

### A-3b · Afgewezen door de producteigenaar (15 september 2026)

**EDU-DEX.** Het onderzoek droeg dit aan als goedkoopste bereikwinst: onze bevestigde
opleidingskaart doorzetten naar de Nederlandse opleidingsportals. De producteigenaar heeft
het verworpen — het is een distributiekeuze over waar het aanbod verschijnt, geen
gereedschapsvraag, en die keuze ligt niet bij dit systeem. Niet inplannen tenzij het
commercieel alsnog gewenst is.

### A-4 · Twee verplichtingen met een datum

WCAG 2.2 AA via EN 301 549, afdwingbaar sinds 28 juni 2025, en wij leveren HTML zonder enige
controle — `axe-core` of `Pa11y` past in de bestaande exportpoort. EU AI Act artikel 50 vanaf
2 augustus 2026: machine-leesbare markering van AI-uitvoer; de Nederlandse Reclame Code vraagt
bovendien een zichtbare melding in of direct naast het beeld, met een formulering als
"Deze afbeelding is gegenereerd met AI".

## Featuregaten uit de review — `feature-gap-2026-09-15.md`

Voortgekomen uit het verzoek om de opzet door AI te laten challengen
(15 september 2026). De volledige lijst met gemotiveerde afwijkingen staat in
het document; hieronder staat alleen wat als MVP-kandidaat is voorgesteld. Nog
niet met het team besloten.

### MVP-1 · Kalender — L, in drie stappen
Uitgebreid op 15 september 2026 na de tweede vraag uit het team: de kalender
moet ook de startmomenten van de trainingen tonen, met hoeveel deelnemers erin
zitten, en de momenten die voor de opleiding zelf gelden (herziening van de
opleiding, sectormomenten zoals Prinsjesdag).

**Stap 1 — tonen (M).** Eén kalender per label met twee banen: de
startmomenten uit `course.dates` (bestaat al, gecontroleerd en gestructureerd)
met de bezetting per groep, en daarnaast de berekende contentplanning. Nog
niets bewerkbaars. Bezetting is een eigen, klein record per groep: plaatsen,
ingeschreven, wanneer bijgewerkt en door wie — **alleen aantallen, nooit namen
of deelnemersgegevens**. Een groep heeft een eigen identiteit nodig die een
nieuwe opleidingskaartversie overleeft.

**Stap 2 — werken (M).** Een verzetbare datum per uiting bovenop de berekende
planning, met eigenaar en beoordelingsdeadline. Een verzette datum is een
*afspraak* en wordt bewaard; een nieuw kanaalplan overschrijft die niet, maar
laat zien welke afspraken afwijken. De bestaande publicatieregistratie wordt
het afvinkmoment op diezelfde kalender. Raakt
`packages/contracts/src/calendar.ts`, nu bewust afgeleid en niet opgeslagen.

**Stap 3 — signaleren (M).** Momenten van de opleider, handmatig vast te leggen
met een notitie; een enkele regelmatige Nederlandse datum mag berekend worden
(Prinsjesdag is de derde dinsdag van september). Een wijziging van de
opleidingspagina die de bestaande bronimpactanalyse al detecteert, verschijnt
als moment. Plus het wervingsvenster: startdatum min een doorlooptijd die het
label zelf instelt, en de vraag of er in dat venster iets gepland staat. Geen
prognose, geen verwacht aantal inschrijvingen. Sluit aan op `radar`-slice MR-3
die de publieke momentenbronnen al voorstelt, en op het scherm `/kalender` dat
op NOG NIET staat.

### MVP-2 · UTM-conventie per kanaal en campagne — S
Elke uitgaande link krijgt bron, medium en campagne volgens één afspraak, zoals
de keuzehulplink dat nu al doet. Zonder dit is handmatig meten niet per kanaal
uit elkaar te trekken.

### MVP-3 · Notificatie bij een openstaande goedkeuring — S
Een signaal als iemands goedkeuring openstaat. Er is nu geen enkele uitgaande
notificatie in het systeem. Eigenaar en deadline zitten in MVP-1 stap 2.

### MVP-4 · JSON-LD en toegankelijkheidscontrole op geproduceerde pagina's — S
Article-schema op het blogartikel (stond al open bij C2) en een basiscontrole
op koppenstructuur, taal en contrast in de HTML die wij uitleveren.

### MVP-5 · Authenticatiecontract bevestigen — M
Blokkeert livegang, niet de pilot. Risico R-01;
`docs/security/trusted-header-contract.md`.

## Market Radar — senior practice — `market-radar-senior-design.md`

Design of 2026-09-11 from two code maps and one opened research angle (the
other researchers, the design panel and the judge hit the subagent spend
limit; the document says so). Five slices.

### MR-1 · Market picture, digest, claims, objective on the hand-off, redaction, screen — L · **Done** (2026-09-11)
`radar.synthesize` v1 over the run's verified items; `verifyInsights` (cited
ids must exist, figures only quoted, no percentage/trend/significance, confidence
from independent domains, single source cannot agree); `buildDigest` change
notes vs the previous run; `competitorClaims` quoted once; `objective` accepted
and written on every radar hand-off, `campaignFromInsight` with the insight,
evidence and confidence frozen in the brief; `redactReport` for e-mail and
phone after verification; the screen in reading order with Marktbeeld first,
one primary action, denominators, URL state, tokens; demo cards and a demo
picture in the mock. **Held by:** `radar-synthesis.test.ts`,
`market-radar.test.ts`.

### MR-2 · Decision trail — M
*Opgevolgd / geparkeerd / verworpen* with reason and owner per insight and
card, shown on later scans (`radar_decisions`, migration ≥ 0023).

### MR-3 · Public Dutch market sources and the moments calendar — M
CBS StatLine, DUO, CDFD, NRTO, ROA registered per label as citable
`reference_page` sources with year and licence; PE cycle, exam periods and
budget cycles as moments the synthesis may cite. Needs the research pass that
did not run.

### MR-4 · Typed competitor attributes — M
Format, duration, price, accreditation *as stated*, with the passage per
attribute, for a positioning table; our side from confirmed facts only.

### MR-5 · Scheduled re-scan with the digest as deliverable — M
Alerting only on substantive change notes.

## Flowaudit van 15 september 2026 — bruikbare output, gesplitst websitekanaal, losse uitingen

Vijf parallelle onderzoekers; zwaarste bevindingen met de hand geverifieerd.
Diagnose: `flow-audit-2026-09-15.md`. Volgorde hieronder is de bouwvolgorde.

### FA-0 · Nu meteen: wat stuk is of onwaar — **Gebouwd 15 september 2026**

1. **Goedkeuring op campagne scopen.** `approveBrief` zoekt de briefing op
   `(id, labelId)` en archiveert daarna op `campaignId`
   (`campaigns-briefs/service.ts:973`); `concepts.select` heeft dezelfde fout.
   Een id van campagne B zet campagne A stil terug naar stap 3. Toets die het
   vastlegt.
2. **JPEG voor social.** De renderer schrijft altijd PNG
   (`core/render/renderer.ts:76`), terwijl onze eigen registratie voor Instagram
   `imageFormats: ['jpeg']` zegt (`channels.ts:320`) en de publicatie-API van
   Instagram alleen JPEG accepteert. Breedte klemmen op 1440.
3. **De harde grenzen lezen bij export.** `imageFormats`, `maxImagePixels`,
   `maxImageBytes` en `altTextMaxChars` staan in `channels.ts` en worden nergens
   in `apps/` gelezen. De poort controleert of een specificatie geverifieerd is,
   nooit of het bestand zich eraan houdt.
4. **Demo-etiket in het pakket.** In ontwikkeling schrijft een publicatieklaar
   pakket "Alle controles en goedkeuringen zijn afgerond" zonder demovermelding.
   Productie is veilig; dit is onze eigen labelregel.
5. **Verwijderroute voor content.** Er bestaat er geen. Eén e-mail of
   advertentie blokkeert daardoor voor altijd elke publicatieklare export.

### FA-1 · Het plan waarmaken — **Gebouwd 15 september 2026**

6. **`count` produceren of weghalen.** De kalender zet een moment per stuk
   (`calendar.ts:167`); de generatie maakt er precies één per fase en kanaal.
   Kies: het aantal echt produceren, of het veld uit het plan halen.
7. **Exportchecklist eerlijk maken.** Het scherm toont tien poorten, de server
   vult er vijf; vijf staan altijd open. Toon alleen wat `evaluateGates` vult,
   en geef de naamloze kanaalweigering een eigen poort-id.
8. **`hasOutcomes` doorgeven** op het detailscherm, dat het hard op onwaar zet
   terwijl de lijstroute de echte waarde kent.

### FA-2 · De advertentiekanalen echt maken — **Gebouwd 15 september 2026**

9. Beeld voor `meta_ads` (4:5, 1440 × 1800) en `linkedin_ads` (1,91:1, 1:1 en
   4:5). Bestemmings-URL verplicht. Koplengtes toetsen: 27 tekens op Facebook,
   40 op Instagram, 70 op LinkedIn vóór afkapping.
10. Het hele bericht tellen tegen de kanaalgrens, niet alleen `copy.body`:
    hook en hashtags zijn gepubliceerde tekst.
11. Markdown en HTML voor het websitestuk in de ZIP. De renderer bestaat al,
    maar alleen als kopieerknop in het scherm.
12. UTM-bouwer. **Geen enkel platform eist het**; LinkedIn noemt
    trackingparameters uitdrukkelijk optioneel. Dit is onze attributiekeuze.

### FA-3 · Websitekanaal splitsen — **Gebouwd 15 september 2026** (migratie 0028)

`course_page_update` en `blog_article` als eigen kanalen; `landing_page` blijft
in de woordenlijst maar verlaat `PRODUCIBLE_CHANNELS`. Reden: de helft van de
bestaande websiterijen draagt geen vorm en is niet automatisch in te delen, en
er bestaat nog geen enkele rij met `blog_article`.

Lost meteen het conflict op waarin het systeem een artikel bestelt dat het
daarna weigert: prompt 4 tot 7 secties van 60 tot 320 woorden, poort blokkeert
boven 6 of onder 120.

Omvang: ongeveer 30 bronbestanden, 11 testbestanden, één migratie. De
smoke-toets telt hard op acht geadviseerde kanalen en moet mee naar negen.
Productbeslissingen die erin zitten: zes fase-oordelen in `funnel.ts`, twee
lengteregimes, en of een briefing voortaan beide websitekanalen moet noemen.

### FA-4 · Losse uitingen — **Gebouwd 15 september 2026** (migratie 0029)

13. **Schema.** `campaign_id`, `brief_version_id` en `concept_version_id`
    nullable; `owner_scope` met een CHECK die hem aan `campaign_id` bindt;
    `origin_kind` en `origin_ref_id` voor herkomst. `brand_profile_version_id`
    en `course_version_id` blijven verplicht: de verankering in opleiding en
    merk is wat een uiting zonder briefing veilig maakt. De unieke sleutel op
    `campaign_id` wordt vervangen door twee partiële indexen.
14. **`generateStandalone`** naast `generate`, zonder de vier campagnepoorten,
    met een in het geheugen samengesteld plan van één item. Routes
    `POST` en `GET /labels/:labelId/content/standalone`. Nieuwe taaktypen ook in
    `IMPLEMENTED_JOB_TYPES`, anders antwoordt de API 501.
15. **Content Studio wordt ook een maakoppervlak**, met een filter
    **Zonder campagne**. Geen enkele leverancier documenteert zo'n weergave; dat
    is precies hoe een los item de dag erna onvindbaar is.
16. **Keuzescherm bij de overdracht.** De knop "maak campagne van deze kans"
    wordt een keuze tussen **Volledige campagne** en **Losse uiting**. Dezelfde
    keuze onder een AI Visibility-bevinding, waar het blogvoorstel vandaag als
    veld in een JSON-rapport blijft liggen zonder versie of beoordeling.
17. **Later koppelen, niet exclusief.** Vanuit het item zelf. Nooit zoals
    HubSpot, waar koppelen aan de ene campagne het uit de andere haalt.

**Nog open uit deze ronde**, uitgesproken in plaats van stil gelaten:

- **Export en publicatieregistratie eisen nog een campagne.** Een losse uiting
  is te maken, te bewerken, goed te keuren en als Markdown te kopiëren, maar zit
  nog niet in een ZIP. `exports.campaign_id` en `publication_records.campaign_id`
  zijn `NOT NULL`.
- **Beeld bij een losse uiting.** Vraagt de opmaak van het concept en de
  kernboodschap van de briefing; beeld en video komen uit Edumotion (FA-5).
- **AI-herziening van een losse uiting** wordt geweigerd met een reden. Met de
  hand aanpassen werkt wel.
- **De Werkruimte telt concepten op label**, dus losse uitingen tellen mee in de
  teller "klaar voor review" zodra ze bestaan. Dat klopt inhoudelijk, maar de
  link achter die teller wijst naar de Content Studio en niet naar een campagne.

### FA-5 · Video en animatie — koppelen, niet bouwen

**Besluit van de producteigenaar, 15 september 2026:** video en animatie komen
uit het eigen interne gereedschap (Edumotion). Wij bouwen geen generatie en
kopen geen clipdienst in.

Wat dat betekent voor de koppeling, wanneer die aan de beurt is: een losse
uiting van het type video is een verwijzing naar een bestand dat elders is
gemaakt, met dezelfde beoordeling, versienummering en herkomst als elk ander
stuk. Twee dingen blijven onze verantwoordelijkheid, hoe het bestand ook tot
stand komt.

Artikel 50 van de EU-AI-verordening geldt sinds 2 augustus 2026 en verplicht ons
als gebruiker synthetische video van personen zichtbaar te kenmerken bij de
eerste blootstelling. C2PA is geen ISO-norm en of de metadata een upload
overleeft is op geen primaire bron te bevestigen, dus een zichtbare Nederlandse
regel blijft nodig; ingebedde metadata is geen nalevingsmechanisme. En een
gefilmde collega als avatar vraagt gedocumenteerde, geïnformeerde en intrekbare
toestemming, wegens portretrecht en de AVG.

De koppeling zelf vraagt een aparte opdracht en hangt achter FA-4: een video is
een losse uiting, en die bestaat nog niet.

## Herontwerp van de interface — 15 september 2026

Uit `design_handoff_marketing_os_2026`, volledig gebouwd. De referentie staat in
`design-system-2026.md`, het codeverhaal in de sectie *De interface volgt het
label* van `../PLATFORM.md`.

### UI-1 · Tokenlagen, merkletters en het labelthema — **Gebouwd 15 september 2026**

De vier CSS-lagen, de drie zelf gehoste merkletters, `label-theme.ts` met de
twee contrastregels, en `palette` op `labelSummary` zodat de kleuren met de
labellijst meereizen. De oude `--c360-*`-namen zetten door naar de nieuwe laag,
waardoor elk bestaand scherm het label volgt.

### UI-2 · De shell — **Gebouwd 15 september 2026**

Icoonrail van 56px uit de inkt van het label, flyout van 232px, topbalk van 48px
die niet collapst, labelschakelaar met kleuren per label, en ⌘K om naar een
scherm te springen.

### UI-3 · Alle elf schermen op drie patronen — **Gebouwd 15 september 2026**

A (overzicht): Werkruimte, Resultaten, Merk & bronnen, Labels & toegang,
Campagnes, niet-gebouwde gebieden. B (lijst+detail): Content Studio,
Opleidingen, Doelgroepen. C (rail+werkvlak+context): Campagne, Marktradar, AI
Visibility. Nieuw in dit werk: de PALET-kolom bij Labels & toegang, de
bronnentabel met berekende aantallen bij AI Visibility, en het contextpaneel van
een campagne (buiten kader, merkregels, merkkleuren, bronnen, versies).

### UI-5 · Werk op de achtergrond, en wat je met een beeld doet — **Gebouwd 16 september 2026**

- Een losse uiting gaat de wachtrij in (`content.standalone`) in plaats van in
  het verzoek te worden geschreven; de aanvrager krijgt een bevestiging en gaat
  verder.
- Een beeldkanaal krijgt echt beeld: `storeVersion` neemt een descriptor in
  plaats van een concept, dus een los stuk kan renderen zonder een
  `concept_version_id` te verzinnen.
- De shell meldt rechtsboven wat er is geland, met een link naar het resultaat,
  en maakt de caches ongeldig die de uitkomst dragen.
- De Marktradar-scan opent als venster en draait op de wachtrij.
- Content Studio staat op nieuwste eerst, met datum per rij.
- Geen call to action in een beeld dat geen klikdoel is
  (`CLICKABLE_IMAGE_CHANNELS`); op een gerenderde variant staan downloaden en
  delen bij aanwijzen.

### UI-6 · Persona, oriëntatie en de marktscan — **Gebouwd 16 september 2026**

- `fillOrientation` onderzoekt waar één opgeslagen doelgroep zich oriënteert, uit
  hetzelfde materiaal als de vragenlijst; het voegt toe en overschrijft nooit, en
  een bron die niet in dat materiaal zat verliest zijn onderbouwing.
- Het kanaal per oriëntatie-uitspraak is met de hand instelbaar. Dat was het
  nooit — de editor schreef altijd `null`, dus een handgeschreven persona kon
  geen kanaaladvies verschuiven.
- `PERSONA_CORE_QUESTION_IDS`: de dertien vragen waaruit de persona wordt
  geschreven, met per vraag de reden dat zij er staat. De overige drieëntwintig
  blijven open en zijn later te laten invullen.
- `radarScanFocus`: de hele markt, alleen de aanbieders van deze opleiding, of
  alleen de opgeslagen concurrenten.
- Een formulier dat elders op de pagina opengaat, scrolt zichzelf in beeld en zet
  de focus in het eerste veld (concurrenteneditor).

### UI-4 · Wat open blijft

- **Een echte zoekfunctie.** ⌘K vindt schermen. Campagnes, opleidingen en
  bronnen doorzoeken vraagt een endpoint dat er niet is; tot die er is, belooft
  het veld niet meer dan het waarmaakt.
- **WCAG-doorloop op schermniveau.** De tokens zijn op contrast gemeten en de
  focusring staat overal, maar een volledige toetsenbord- en
  schermlezerdoorloop van elf schermen is niet gedaan.
- **`generated-visuals.test.ts` valt om onder parallelle belasting.** Los draait
  hij 11/11 groen. Het bestand hoort bij het werk van de andere agent; het is
  niet door dit herontwerp geraakt.

## Explicitly not now

M&A workspace, connectors, SEO/GEO, Website Assurance, journeys
and cross-sell. Expansion paths are documented in
`docs/architecture/extension-roadmap.md`.

## Öneri — araştırma izi, motor cevapları ve sosyal dağıtım (11 Eylül 2026)

Durum: raporlandı; uygulanmadı. [Veri/API değerlendirmesi](../pilot/platform-data-integrations-tr.md).

- Araştırma günlüğünde gerçek sağlayıcı/model, kaynak seçimi/okuma, arama kapsamı ve bilinen/tahmini maliyet ayrımı. Eski raporlarda olmayan sorgu/motor cevabı geri üretilmez.
- Ayrı motor cevabı matrisi: yöntem, ülke/dil, tarih, ham cevap, alıntılar, marka eşleşmeleri, ölçülmedi/engellendi/hata ayrımı. Consumer/API verileri karıştırılmaz.
- GEO bulgusundan sosyal dağıtım önerileri: kanal gerekçesi, içerik taslağı/brief, CTA, konu/hashtag adayının kaynağı ve belirsizliği, UTM/KPI; normal kampanya ve insan onayı korunur.
- Veri bağlantılarını sırayla pilotla: site envanteri/GSC/GA4 → kendi sosyal hesapları → seçilmiş SERP/keyword kaynağı → sınırlı çok-motor baseline → gerekirse sosyal dinleme/hashtag verisi. Yeni abonelikten önce toplam maliyet ve çıktı kalitesi karşılaştırılır.

## DB-1 — Fontsubsetting en koptekst als vectorcontouren

Twee problemen, één ingreep. **Subsetting**: de merkletter reist nu mee als heel
fontbestand, en twee commerciële snedes zijn samen ~74 kB gzip — dat past op
300x250 en 300x600, maar niet op 320x50, dat daarom terugvalt op een
systeemletter. Terugbrengen tot de gebruikte glyphs brengt een Latijnse snede
doorgaans naar enkele kB's en haalt de afweging weg. **Vectorcontouren**: op
Google Ads mag een fontbestand helemaal niet mee, dus daar is omzetten van de kop
naar SVG-outlines de enige route; dat vermijdt meteen de vraag of de
desktoplicentie van de klant herdistributie dekt. Let op de Google Ads-eis dat
inline SVG expliciete sluittags heeft — of zet de SVG in een eigen bestand.

## DB-1b — Oorspronkelijke notitie over vectorcontouren

De merkletter kan niet als fontbestand mee naar Google Ads en een desktoplicentie
dekt herdistributie meestal niet. Omzetten van de kop naar SVG-outlines lost
beide op; het is wat de commerciële platforms doen. Nu valt een niet-Google
familie terug op een systeemletter met een notitie. Nodig: een font-naar-pad stap
(opentype.js of gelijkwaardig), met de Google Ads-eis dat inline SVG expliciete
sluittags heeft — of de SVG in een eigen bestand.

## DB-2 — Tekst meten in plaats van tellen

De regel- en tekenbudgetten in `BANNER_SIZES.fits` zijn arithmetiek op een
gemiddelde glyphbreedte. Meet de getekende regel in headless Chrome na
`document.fonts.ready` en bak het resultaat als statische CSS in het bestand;
dan verdwijnt het gokken én de passing-JS uit de banner. Playwright zit al in de
repo. Zichtbaar probleem: 160x600 brak een kop van 33 tekens naar vier regels
terwijl het budget drie regels zei.

## DB-3 — Het bannerpakket als achtergrondtaak en als opgeslagen oplevering

De set wordt nu bij elk verzoek opnieuw gebouwd en nergens bewaard. Dat kan
omdat de bouw deterministisch is, maar het betekent ook dat een gemaakte set
niet in de contentbibliotheek staat en niet aan een campagne hangt. Overweeg een
`banner.render` jobtype (inclusief `IMPLEMENTED_JOB_TYPES`) en een oplevering
naast de exports.

## DB-4 — Meer bestemmingen

`BANNER_PLATFORM_RULES` kent nu Google Ads en de eigen site. Ad Manager (1 MB,
altijd SafeFrame, geen SVG-tags binnen HTML), DV360 (100 bestanden, fontbestanden
wél toegestaan) en CM360 (10 MB) hebben elk eigen regels en een eigen manier om
de klik af te handelen. Dat is precies de matrix waar de commerciële tools geld
voor vragen; voeg er pas een toe als er een campagne op wacht.

## DB-5 — Een gegenereerde achtergrond in de banner

De screenplay draagt al een `backgroundBriefEn`, de bouwer accepteert al een
achtergrondbestand, en het sjabloon heeft de scrim-laag om tekst leesbaar te
houden. Wat ontbreekt is de koppeling naar `VisualGenerationService` en een
gezette `AI_IMAGE_ENABLED`. Let op de formaatverhoudingen: één beeld voor zes
formaten werkt niet — een 160x600 en een 728x90 vragen een andere uitsnede van
dezelfde scène.

## DB-6 — Een quiz als bannerinhoud

Gevraagd op 2026-09-16: een reeks die eindigt in een uitkomst plus CTA, zoals de
keuzehulp. Er staat al een quizbouwer in `campaign-packages/quiz.ts` voor de
site-variant. In een banner gelden andere regels: geen opslag-API, één uitgang,
en alles binnen het bestandsgewicht. Waarschijnlijk twee vragen, maximaal vier
antwoorden, uitkomst als eindbeeld.

## DB-7 — De bannerset als opgeslagen oplevering

De set wordt bij elk verzoek opnieuw gebouwd en nergens bewaard; dat kan omdat de
bouw deterministisch is, maar het betekent ook dat een gemaakte set niet aan de
campagne hangt en niet in de bibliotheek staat. De provenance (briefing,
doelgroepen, richting) wordt al teruggegeven maar nergens opgeslagen, dus een
verouderde banner is nu niet zichtbaar.

## DB-8 — Een eigen korte regel voor de mobiele strip

320x50 heeft ruimte voor ongeveer twintig tekens op één regel tussen logo en
knop. Een kop die op een 300x250 werkt past daar vrijwel nooit, dus het formaat
wordt regelmatig geweigerd — met een leesbare reden, maar toch. Een bureau
schrijft voor dat formaat een eigen regel. Overweeg een korte variant in de
screenplay (er stond er eerder een als `headlineShort`), of laat de prompt er
expliciet om vragen.
