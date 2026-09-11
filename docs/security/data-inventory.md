# Data inventory and retention

Personal data is minimised: the application stores what is needed to identify a
user and record who did what. It stores no learner records, no exam results, no
dates of birth, no national identifiers and no payment data.

**Last reviewed:** 2026-09-10. Retention periods marked *to confirm* need a
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
| Sources, evidence, research runs | May quote third-party pages; source URL and retrieval date recorded |
| Personas | Deliberately need/behaviour based, **not** demographic stereotypes |
| Briefs, concepts, content assets, exports | Business content |
| Campaign objective, funnel stage per plan item and content version, channel advice | Planning metadata and the model's reasoning about channel fit, stored on the plan version it belongs to. No personal data and, by shape, no performance figure |
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
