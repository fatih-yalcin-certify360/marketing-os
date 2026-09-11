# Incident response

A short, usable runbook for one maintainer. It assumes no dedicated on-call.
Contact details and escalation paths must be filled in by IT / the Information
Security Officer before production.

## Severity

| Level | Meaning | Examples |
| --- | --- | --- |
| **S1** | Confidentiality breach or authentication bypass | Cross-label data leak; identity spoofing; credential exposure |
| **S2** | Integrity or availability loss | Published content wrong because course data was corrupted; API down; jobs stuck |
| **S3** | Contained problem, no data exposure | One job type failing; provider outage handled correctly |
| **S4** | Cosmetic or documentation | Wrong label in the UI |

## First 30 minutes

1. **Record the time and what you observed.** Start an append-only note; do not
   rely on memory or chat scrollback.
2. **Preserve evidence before changing anything.** Capture the relevant
   `audit_events` rows and application logs. Do not `db:reset` and do not delete
   job rows — the audit trail is the only reconstruction available.
3. **Contain.**
   - Suspected identity bypass: block the path at the proxy/network layer, not by
     editing app configuration. If the app is reachable past the proxy, that is
     the finding.
   - Suspected cross-label leak: identify affected labels via `audit_events`
     (`organization_id`, `label_id`, `outcome`).
   - Cost abuse: set the affected label's `budget_cents` to `0` — pending work
     cannot reserve, and running jobs can be cancelled individually.
   - Provider compromise: rotate `ANTHROPIC_API_KEY`, set `AI_PROVIDER` to a
     value the deployment refuses, and let jobs fail visibly rather than
     silently degrade.
4. **Notify.** S1/S2 → Information Security Officer and management immediately.
   Personal-data breach: the statutory notification clock starts at *awareness*,
   so record that timestamp precisely.

## Investigation

Useful queries:

```sql
-- Every denial in the last day
SELECT created_at, actor_user_id, action, resource_type, resource_id, reason
FROM audit_events
WHERE outcome = 'denied' AND created_at > now() - interval '1 day'
ORDER BY created_at DESC;

-- Everything one actor did
SELECT * FROM audit_events WHERE actor_user_id = $1 ORDER BY created_at DESC;

-- Cost anomalies per label
SELECT label_id, sum(actual_cost_cents) AS cents, count(*) AS calls
FROM usage_records WHERE created_at > now() - interval '7 days'
GROUP BY label_id ORDER BY cents DESC;

-- Jobs stuck running
SELECT id, type, label_id, attempt, heartbeat_at FROM jobs
WHERE status IN ('running','cancelling') AND heartbeat_at < now() - interval '10 minutes';
```

Note the audit trail deliberately contains no user content, so it answers *who
did what* but not *what the content said*. That is the intended trade-off.

## Recovery

- Schema problem: a **new forward migration**. Never edit a released migration —
  the checksum check will refuse it, which is the desired behaviour.
- Data problem: restore per [backup-restore.md](backup-restore.md). Restore to a
  scratch database first and verify before touching the live one.
- Stuck jobs: the reaper requeues abandoned jobs automatically once the
  heartbeat times out. If a job type is fundamentally broken, cancel affected
  jobs; committed partial results are preserved.

## Afterwards

Within five working days, write up: timeline, root cause, what detected it, what
delayed detection, and the concrete change made. Then:

- add a **regression test** — an incident without one will recur;
- update the [threat model](threat-model.md) if a new threat surfaced;
- update the [risk register](risk-register.md);
- if a decision changed, write a decision record.

## Gaps to close before production

- [ ] Named contacts and out-of-hours escalation (IT / ISO).
- [ ] Log retention and alerting: nothing currently *alerts*; incidents would be
      noticed by a person.
- [ ] Statutory breach-notification process confirmed with the business.
- [ ] One rehearsed dry run of an S1.
