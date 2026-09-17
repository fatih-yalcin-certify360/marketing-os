# Data inventory and retention

Personal data is minimised: the application stores what is needed to identify a
user and record who did what. It stores no learner records, no exam results, no
dates of birth, no national identifiers and no payment data.

**Last reviewed:** 2026-09-11. Retention periods marked *to confirm* need a
decision from the business before Phase 5.

## Personal data

| Data | Table | Source | Purpose | Retention |
| --- | --- | --- | --- | --- |
| Display name | `users.display_name` | Entra ID via proxy | Attribution in the UI | Life of the account |
| Work e-mail | `users.email` | Entra ID via proxy | Identification, uniqueness | Life of the account |
| External subject id | `users.external_subject` | Entra ID via proxy | Stable account key | Life of the account |
| Organisation role | `users.org_role` | Assigned in-product | Authorisation | Life of the account |
| Label membership + role | `memberships` | Assigned in-product | Authorisation | Until removed |
| Last seen | `users.last_seen_at` | Derived | Identify dormant accounts | Life of the account |
| Actor id on an action | `audit_events.actor_user_id` | Derived | Security audit | *to confirm* (proposed 12 months) |
| Salted hash of client IP | `audit_events.ip_hash` | Derived | Correlate abuse | *to confirm* (proposed 90 days) |
| Job creator | `jobs.created_by_user_id` | Derived | Attribution, retry rights | With the job row |
| Who recorded a publication | `publication_records.recorded_by_user_id` | Derived | "We published this" is a human claim and has to be attributable | With the campaign |
| Who recorded a figure | `outcome_reports.recorded_by_user_id` | Derived | The system measures nothing, so every figure names the person who obtained it | With the campaign |
| Who wrote a learning | `learnings.created_by_user_id` | Derived | A conclusion is somebody's, and later proposals lean on it | Life of the label |
| Who approved a learning | `learnings.approved_by_user_id` | Derived | Approval is what lets a learning influence later work | Life of the label |

Deliberately **not** stored: raw IP addresses, passwords or password hashes
(there is no password store), browser fingerprints, analytics identifiers.

## Non-personal business data

| Data | Notes |
| --- | --- |
| Labels, brand profiles, course versions | Commercially sensitive, not personal |
| Label palette on the labels list (`labelSummary.palette`) | Three hex colours — primary, accent, ink — read from that label's *approved* brand profile, so the interface can be painted in the label's own colours (2026-09-15). Brand data, no personal data. It leaves the server only to labels the caller is a member of, along the same projection as the rest of the list, and it is `null` when the label has no approved profile — the interface then says it is using the Certify360 house palette rather than showing a colour nobody approved |
| Sources, evidence, research runs | May quote third-party pages; source URL and retrieval date recorded |
| Personas | Deliberately need/behaviour based, **not** demographic stereotypes |
| Briefs, concepts, content assets, exports | Business content |
| Campaign objective, funnel stage per plan item and content version, channel advice | Planning metadata and the model's reasoning about channel fit, stored on the plan version it belongs to. No personal data and, by shape, no performance figure |
| Stage messages on a brief (`brief_versions.stage_messages`), measurement plan on a content plan (`content_plans.measurement_plan`), funnel stage on an outcome (`outcome_reports.funnel_stage`) | Planning metadata (2026-09-11). The measurement plan has no field for a target or a forecast; the stage on an outcome is nullable because a platform report may not split by stage |
| Persona orientation sources (`persona_versions.orientation_sources`) | Where an *audience* orients (search, employer, LinkedIn, trade media), each statement with its evidence or marked as an assumption. About a segment, never about a person; the same demographic-free rule as the rest of the persona |
| Persona questionnaire (`persona_versions.questionnaire`) | Thirty-six answers about a *segment*, each `provided`, `assumption` or `unknown`. Since 2026-09-11 the system fills it during persona generation from its own material only: research findings, confirmed course facts and the campaign input. A provided answer carries the literal passage, the source reference (public URL, course-card field or `campagne-input`) and the retrieval time. Since 2026-09-14 every answer also carries `origin` (`ai_source`, `ai_inference`, `system`, `user`) and, for an inferred answer, `reasoningNl` — the model's reasoning about a *segment*, no personal data by shape. The personal-context questions (age, region, personal circumstances) are answered about relevance for the learning need, never as an estimate: an age stated without a passage is replaced by the statement that age is not derivable, and preferences or budget are never derived from age, gender or residence. A stored persona can be completed by a job that changes only its open cells. Names of persons are refused at the prompt; a quoted public passage is the only place one could still appear, and the same label-scoped access as the rest of the persona applies |
| Persona identity and scope (`persona_versions.persona_key`, `campaign_id`, now exposed on the contract) | Which campaign a proposed persona belongs to and which versions form one identity. Planning metadata about a segment, no personal data; a promoted copy records `campagne:<id>` as provenance |
| Persona course links (`persona_versions.linked_course_version_ids`) | Which other course versions of the same label a persona is relevant for; ids only, verified against the label on write. No personal data |
| Campaign package quiz (`campaign_packages.report.content.reflection[].options[].signal`, `outcomes`) | Which of three signals an answer option carries and the three outcome texts, about a *segment*; the produced page stores nothing, sets no cookie and sends nothing — the reader's answers exist only in their browser tab. The link carries `utm_source=keuzehulp`, an attribution tag, no identifier (2026-09-15) |
| Package readiness and preview (computed on read, not stored) | Which of four gates is open and the produced pages as inline HTML; brand logo as a data URI. No personal data; same label-scoped access as the package |
| Google Search ad fields (`content_asset_versions.copy.ads.paths`, `negativeKeywords`, `matchTypeAdviceNl`, `finalUrl`) and the Google Ads frame (computed) | Advertising copy and set-up advice about a course; the frame is fixed text with Google's help-page URLs. No personal data; by shape no volume, price, bid or conversion figure (2026-09-15) |
| Brief sections (`brief_versions.context_nl`, `audience_insight_nl`, `proposition_nl`, `tone_of_voice_nl`, `mandatories`, `channel_roles`, `timing_nl`, `risks`) | Business content about a course and a segment, written from the course card, the personas and the brand rules (2026-09-14). The audience insight is about a segment, never a person; the same demographic-free rule as the personas it rests on |
| Brief keywords (`brief_versions.keywords`) | Search phrases with where they were found (a public URL from the radar or a course-card field). No volume, difficulty or position exists in the shape (2026-09-12) |
| Live course page text | Read once per content job through the SSRF-guarded fetch, bounded to twelve thousand characters, handed to the prompt as untrusted material and **not stored**; only the passages a change proposal quotes are kept, on the piece, after they were verified against the page |
| Competitor social pages (`visibility_entities.profile.linkedinUrl`, `facebookUrl`, `instagramUrl`) | Organisation pages an organisation publishes on its own website, read from that website (2026-09-15). About an organisation, not a person: a LinkedIn profile under `/in/`, an Instagram post and a Facebook share link are refused by shape, so a named individual cannot end up in these fields. The page each link was found on is returned to the screen but not stored |
| Standalone content provenance (`content_asset_versions.owner_scope`, `origin_kind`, `origin_ref_id`) | Which surface a loose piece came from — a manual request, an AI-visibility report, a radar card or a radar insight — and the id of that report. Business provenance about a course and a market finding; no personal data by shape, and the reference points at a row of this label only (2026-09-15) |
| Standalone content request (`angleNl`, supplied by the user) | What the piece should be about, in the requester's own words. Free text a person types, so it is theirs to control; it reaches the AI provider as task input like any other instruction, and is not stored beyond the resulting piece's prompt provenance |
| Content quality warnings (`content_asset_versions.warnings`) | House-style verdicts about a piece; the context ones name another piece of the same campaign or a passage of the public course page. No personal data |
| Radar reports (`radar_runs.report`) | Passages quoted from public pages about offerings, roles and organisations. **E-mail addresses and phone numbers are redacted** from every stored passage after verification (2026-09-11, `redactReport`); names of persons are refused at the prompt but cannot be redacted reliably — a vacancy or alumni passage may still carry one. The screen says so; a report is label-scoped and never public |
| Outcomes, learnings | Aggregate campaign performance, entered by a person. No derived ratio is stored, and nothing is measured by this system |
| **Uploaded platform reports** | `assets` with purpose `outcome_report`. A file whose contents we do not control: a platform export is normally aggregate, but nothing stops a user attaching a document that contains personal data. Treated like every other upload — validated by its bytes, stored content-addressed, served only to authorised members of its own label, never inline — and **not parsed**: the figures are typed in by the person, so the file is evidence rather than input. Worth naming in a data-protection review because the risk is the user's choice of file, not our processing of it |
| Jobs, usage records, budgets | Operational and cost data |

## Logging discipline

| Sink | Contains | Never contains |
| --- | --- | --- |
| Application log (pino) | Request id, route, status, error code, internal error detail | Prompt text, document contents, tokens, secrets, raw personal data |
| `audit_events` | Who attempted what, and whether it was allowed | Any user content — enforced by `sanitiseMetadata`, which drops anything that is not a short scalar |
| Usage records | Token counts, cost, model, prompt template + version | Prompt or response text |

Content logging and security audit are separate stores by design, so an audit
export does not carry marketing content and a content debug session does not
carry access history.

## Subject requests

- **Access / export:** a user's rows are reachable by `users.id` across
  `memberships`, `audit_events`, `jobs` and `usage_records`.
- **Erasure:** deleting a `users` row cascades memberships and nulls the actor
  reference on audit rows (`ON DELETE SET NULL`), which preserves the integrity
  of the audit trail while removing the identifier. Whether audit attribution
  must be retained for a fixed period is a business decision — *to confirm*.
- **Backups:** an erasure does not retroactively alter existing backups.
  Backups age out on their own schedule; see
  [backup-restore.md](backup-restore.md). This must be stated in any privacy
  notice rather than implied.

## AI provider data flow — to confirm before Phase 2

Recorded as an open item, not an answer:

- What is sent: task input only, minimised to what the task needs.
- Processing region: **to confirm against company policy.**
- Provider-side retention and training use: **to confirm.**
- Whether label data may leave the EU: **to confirm.**

Tracked as **R-04** in [risk-register.md](risk-register.md). Phase 2 must not
send real label data to a provider before these are answered.
