-- 0003_jobs_usage
--
-- Job queue, AI usage accounting and per-label budgets.
--
-- The queue lives in our own schema (ADR-0006) because a job, its idempotency
-- key, its budget reservation and its partial results must all commit in one
-- transaction. Claiming uses SELECT ... FOR UPDATE SKIP LOCKED so several
-- workers can run without a broker.

CREATE TABLE jobs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  label_id            uuid        REFERENCES labels (id) ON DELETE CASCADE,
  type                text        NOT NULL,
  status              text        NOT NULL DEFAULT 'queued',
  -- Lower runs first.
  priority            integer     NOT NULL DEFAULT 100,

  -- Caller-supplied payload, validated against a per-type Zod schema before
  -- insert. Kept as JSONB because payload shape varies by job type; it is
  -- never used as a dumping ground for provider responses.
  payload             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Structured result of a successful run.
  result              jsonb,
  -- Progress + partial results, written during the run so that a cancelled or
  -- failed job does not lose completed work.
  progress            jsonb,

  attempt             integer     NOT NULL DEFAULT 0,
  max_attempts        integer     NOT NULL DEFAULT 3,

  -- Deduplicates retries and double submits: the same key never produces a
  -- second job, so a retried enqueue cannot create duplicate assets or a
  -- duplicate charge.
  idempotency_key     text        NOT NULL,

  run_at              timestamptz NOT NULL DEFAULT now(),
  claimed_at          timestamptz,
  claimed_by          text,
  heartbeat_at        timestamptz,
  started_at          timestamptz,
  finished_at         timestamptz,

  -- Cooperative cancellation: the API sets the flag, the worker observes it at
  -- the next checkpoint and stops, keeping whatever it already committed.
  cancel_requested    boolean     NOT NULL DEFAULT false,

  failure_kind        text,
  -- Dutch, user-facing, no internal detail. Internal detail goes to the log
  -- under the request/job id only.
  failure_message     text,

  reserved_cost_cents integer     NOT NULL DEFAULT 0,
  actual_cost_cents   integer,

  created_by_user_id  uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT jobs_status_valid CHECK (status IN
    ('queued', 'running', 'succeeded', 'failed', 'dead', 'cancelling', 'cancelled')),
  CONSTRAINT jobs_failure_kind_valid CHECK (failure_kind IS NULL OR failure_kind IN
    ('provider_unavailable', 'provider_invalid_output', 'timeout', 'budget_exceeded',
     'validation_failed', 'internal_error')),
  CONSTRAINT jobs_attempt_bounded CHECK (attempt >= 0 AND attempt <= max_attempts),
  CONSTRAINT jobs_payload_is_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT jobs_costs_non_negative
    CHECK (reserved_cost_cents >= 0 AND (actual_cost_cents IS NULL OR actual_cost_cents >= 0)),
  CONSTRAINT jobs_idempotency_unique UNIQUE (organization_id, type, idempotency_key)
);

-- Claim path: only queued rows are indexed, so the hot query stays small
-- regardless of how much history the table accumulates.
CREATE INDEX jobs_claim_idx ON jobs (priority, run_at, id) WHERE status = 'queued';
-- Reaper path: find running jobs whose worker stopped heartbeating.
CREATE INDEX jobs_stale_running_idx ON jobs (heartbeat_at) WHERE status IN ('running', 'cancelling');
-- Listing path, bounded and label-scoped.
CREATE INDEX jobs_label_created_idx ON jobs (label_id, created_at DESC) WHERE label_id IS NOT NULL;
CREATE INDEX jobs_org_created_idx ON jobs (organization_id, created_at DESC);

CREATE TABLE label_budgets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  label_id        uuid        NOT NULL,
  -- One row per label per budget period.
  period_start    date        NOT NULL,
  period_end      date        NOT NULL,
  budget_cents    integer     NOT NULL,
  -- Committed to finished work.
  spent_cents     integer     NOT NULL DEFAULT 0,
  -- Held for queued/running jobs; released when they finish, fail or cancel.
  reserved_cents  integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT label_budgets_period_valid CHECK (period_end > period_start),
  CONSTRAINT label_budgets_non_negative
    CHECK (budget_cents >= 0 AND spent_cents >= 0 AND reserved_cents >= 0),
  CONSTRAINT label_budgets_label_period_unique UNIQUE (label_id, period_start),
  CONSTRAINT label_budgets_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE usage_records (
  id                    bigserial   PRIMARY KEY,
  organization_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  label_id              uuid        REFERENCES labels (id) ON DELETE CASCADE,
  job_id                uuid        REFERENCES jobs (id) ON DELETE SET NULL,
  -- Which attempt produced this record. Combined with the unique index below
  -- this makes accounting idempotent: replaying an attempt cannot double-charge.
  attempt               integer     NOT NULL DEFAULT 0,
  kind                  text        NOT NULL,
  provider              text        NOT NULL,
  model                 text,
  -- Traceability of what produced an output (requirement 11).
  prompt_template       text,
  prompt_version        text,
  input_tokens          integer,
  output_tokens         integer,
  image_count           integer,
  -- Estimated at reservation time; actual filled in after the call returns.
  estimated_cost_cents  integer     NOT NULL DEFAULT 0,
  actual_cost_cents     integer,
  latency_ms            integer,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_kind_valid CHECK (kind IN ('ai_text', 'ai_image', 'ai_research', 'storage')),
  CONSTRAINT usage_costs_non_negative
    CHECK (estimated_cost_cents >= 0 AND (actual_cost_cents IS NULL OR actual_cost_cents >= 0))
);

-- One usage row per (job, attempt, kind): the guard against double-charging a
-- retry. Manual/non-job usage is unconstrained.
CREATE UNIQUE INDEX usage_records_job_attempt_kind_unique
  ON usage_records (job_id, attempt, kind) WHERE job_id IS NOT NULL;
CREATE INDEX usage_records_label_created_idx ON usage_records (label_id, created_at DESC)
  WHERE label_id IS NOT NULL;
