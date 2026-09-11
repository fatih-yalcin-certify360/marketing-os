# Backup, restore and recovery

**Status (2026-09-10): the restore is rehearsed on every commit, and the part
that is *not* rehearsed is named below.** An untested backup is not a backup —
and the part that goes wrong is almost never the dump.

`apps/api/tests/integration/restore-drill.test.ts` builds real data (a campaign
through to an approved, exported package with rendered images on disk), takes a
backup, throws the database away, restores from the backup alone into a fresh
instance, and runs the verification. It also **restores the database without its
file storage and asserts that the verification catches it** — the failure this
document warns about, proved to be caught rather than trusted because it is
written down.

**What is rehearsed:** the verification, and a genuine dump-and-load round trip
of the same bytes.

**What is not:** `pg_dump --format=custom` and `pg_restore`. Those binaries are
not present in the development environment, so the production transport remains
unexercised, as does WAL point-in-time recovery, and step 1 (stopping writers)
cannot be rehearsed on a single connection — a job claiming against a
half-restored table is the failure that produces duplicate work, and no drill on
one connection can produce it. The drill runs against PGlite; it proves the
checks work, not that a production restore worked.

**What makes it transfer:** the checks live in the application
(`apps/api/src/core/db/restore-verify.ts`), not in the test, and

```bash
DATABASE_URL=<the restored scratch database> npm run db:verify-restore
```

points the same eight checks at a real PostgreSQL. Take a baseline while the
system is healthy (`-- --write-baseline before.json`) or the row counts can only
be reported, not verified — "12 labels" is a number, not a verification. Run it
against the **scratch** database, per step 2, never the live one.

## What must be backed up

| Store | Contents | Backup |
| --- | --- | --- |
| PostgreSQL | Everything transactional: organisations, labels, users, memberships, versions, approvals, jobs, usage, audit | `pg_dump` (logical) + WAL archiving for point-in-time recovery |
| Object/file storage (`STORAGE_ROOT`) | Uploaded documents, brand assets, generated images, export packages | Filesystem or object-store snapshot |
| Configuration & secrets | Environment values | **Not** in the database. Held in the platform's secret store; backed up per that system's policy |

The container images are rebuildable from the repository and are not part of
the backup scope. Database and file storage must be restored to a **consistent
pair** — a content asset row whose rendered image is missing is a broken record.

## Development

```bash
# Backup
docker compose exec -T postgres pg_dump -U c360 -d c360_dev --format=custom > backup.dump

# Restore into a scratch database first
docker compose exec -T postgres createdb -U c360 c360_restore_test
docker compose exec -T postgres pg_restore -U c360 -d c360_restore_test --clean --if-exists < backup.dump
```

## Production requirements — to be agreed with IT

Placeholders, not commitments; the business must set them:

| Parameter | Proposed | Status |
| --- | --- | --- |
| RPO (acceptable data loss) | 15 minutes via WAL archiving | *to confirm* |
| RTO (acceptable downtime) | 4 hours | *to confirm* |
| Full backup frequency | Daily | *to confirm* |
| Retention | 30 daily, 12 monthly | *to confirm* |
| Encryption at rest | Required for backups and storage | Requirement stated; not implemented — no production environment yet |
| Off-site / separate-account copy | Required, so one compromised account cannot destroy both | *to confirm* |
| Restore rehearsal | Quarterly, documented | **Runs on every commit** for the verification and the round trip; the production `pg_dump`/`pg_restore` path still needs one real rehearsal in a production-like environment |

## Restore procedure

1. **Stop writers.** Scale the API and worker to zero. Restoring underneath a
   running worker risks a job claiming against a half-restored table.
2. **Restore to a scratch database**, never directly over the live one.
3. **Verify** — `npm run db:verify-restore`, which runs these checks rather
   than leaving them to be typed by hand at three in the morning:

   | Check | Why |
   | --- | --- |
   | The migration ledger is identical | Schema level before contents |
   | Every counted table has the same row count | 24 tables, listed explicitly in `restore-verify.ts` so a new table is a deliberate addition rather than a silent gap |
   | Memberships unchanged | Authorisation must survive intact, or the restore quietly removes people's access |
   | The job status distribution is unchanged | |
   | No job restored mid-flight | Not corruption: the reaper requeues them once the heartbeat times out. Reported because step 6 says to check it rather than assume it |
   | No row belongs to a label/organisation pair that does not exist | A restore is exactly when a mismatched pair surfaces — a partial restore, or two dumps from different moments |
   | Every content approval still points at a version that exists | |
   | **Every asset row has its file** | The consistent-pair requirement above. Restoring the database and forgetting `STORAGE_ROOT` is the most likely real mistake, because the database is the part that feels like the system — and it fails *silently*: every row is present, every page loads, and the images are gone |

   Budget reconciliation (step 6) is still manual: the drill asserts the job
   distribution matches, and whether a reservation matches its job's state is a
   judgement this check does not make.
4. **Run migrations.** If the backup predates the current code, `npm run
   db:migrate` brings it forward. The checksum ledger will refuse a divergent
   history, which is the intended safety net.
5. **Reconcile file storage** to the same point in time.
6. **Requeue or fail interrupted jobs.** Jobs restored as `running` have no live
   worker; the reaper requeues them once their heartbeat times out. Verify that
   budget reservations match job states rather than assuming it.
7. **Restart** the worker first, then the API.
8. **Record** what was restored, from when, and how much data was lost.

## After any restore

- Confirm no label can see another label's data — a restore is exactly when a
  mismatched `organization_id` would surface. Run the isolation suite against a
  copy if in doubt.
- Confirm approvals still bind to the versions they were granted for.
- Note in the audit trail that a restore happened, and when.
