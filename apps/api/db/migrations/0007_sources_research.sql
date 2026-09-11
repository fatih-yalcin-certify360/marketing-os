-- 0007_sources_research
--
-- Sources a label has decided are worth reading, the runs that read them, and
-- the findings those runs produced.
--
-- Three properties this migration exists to guarantee:
--
--  1. **A finding cannot exist without its provenance.** `source_ref`,
--     `retrieved_at` and `excerpt` are all NOT NULL. A claim with no passage
--     behind it cannot be checked by a reviewer, so the schema refuses to hold
--     one.
--
--  2. **Staleness is computable.** A run stores the exact sources it read and
--     the content hash of each in `sources_snapshot`. Whether the run is still
--     current is then a comparison against the live `sources` rows, and the
--     reason it went stale can be named rather than guessed.
--
--  3. **Nothing crosses a label.** Every table carries `organization_id` and
--     `label_id` with the composite foreign key the rest of the schema uses, so
--     a finding from one label cannot be attached to another's run. This is the
--     "caches cannot leak across labels" requirement, held by the database
--     rather than by a query remembering a predicate.

CREATE TABLE sources (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  label_id        uuid        NOT NULL,
  kind            text        NOT NULL,
  -- Exactly one of url / asset_id, enforced below.
  url             text,
  asset_id        uuid        REFERENCES assets (id) ON DELETE SET NULL,
  title           text        NOT NULL,
  time_sensitivity text       NOT NULL DEFAULT 'medium',
  -- SHA-256 of the text last read. Null until the first successful read.
  content_sha256  text,
  last_retrieved_at timestamptz,
  last_failure_nl text,
  is_active       boolean     NOT NULL DEFAULT true,
  created_by_user_id uuid     REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sources_kind_valid CHECK (kind IN
    ('course_page', 'brand_page', 'user_document', 'reference_page')),
  CONSTRAINT sources_time_sensitivity_valid CHECK (time_sensitivity IN ('high', 'medium', 'low')),
  -- A source is a page or a document, never both and never neither.
  CONSTRAINT sources_target_exclusive CHECK (
    (url IS NOT NULL AND asset_id IS NULL) OR (url IS NULL AND asset_id IS NOT NULL)
  ),
  CONSTRAINT sources_sha_length CHECK (content_sha256 IS NULL OR length(content_sha256) = 64),
  CONSTRAINT sources_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT sources_id_org_unique UNIQUE (id, organization_id)
);

-- The same page registered twice for one label is a mistake, not two sources.
-- Partial, because a document source has a null url.
CREATE UNIQUE INDEX sources_label_url_unique
  ON sources (label_id, url) WHERE url IS NOT NULL;
CREATE UNIQUE INDEX sources_label_asset_unique
  ON sources (label_id, asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX sources_label_active_idx ON sources (label_id) WHERE is_active;

CREATE TABLE research_runs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  label_id          uuid        NOT NULL,
  course_version_id uuid        NOT NULL REFERENCES course_versions (id) ON DELETE CASCADE,
  version           integer     NOT NULL,
  status            text        NOT NULL DEFAULT 'running',
  -- What was read, and what it contained. The basis of staleness detection.
  sources_snapshot  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  finding_count     integer     NOT NULL DEFAULT 0,
  shortfall_reason_nl text,
  prompt_version    text,
  failure_nl        text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  created_by_user_id uuid       REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT research_runs_status_valid CHECK (status IN ('running', 'completed', 'failed')),
  CONSTRAINT research_runs_snapshot_array CHECK (jsonb_typeof(sources_snapshot) = 'array'),
  CONSTRAINT research_runs_version_positive CHECK (version > 0),
  CONSTRAINT research_runs_count_non_negative CHECK (finding_count >= 0),
  CONSTRAINT research_runs_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT research_runs_id_org_unique UNIQUE (id, organization_id),
  -- One version number per course, so "the current run" is unambiguous.
  CONSTRAINT research_runs_course_version_unique UNIQUE (course_version_id, version)
);

CREATE INDEX research_runs_label_course_idx
  ON research_runs (label_id, course_version_id, version DESC);

CREATE TABLE research_findings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  label_id        uuid        NOT NULL,
  run_id          uuid        NOT NULL REFERENCES research_runs (id) ON DELETE CASCADE,
  -- Null when the source row was later deleted; the reference text survives.
  source_id       uuid        REFERENCES sources (id) ON DELETE SET NULL,
  claim           text        NOT NULL,
  kind            text        NOT NULL,
  -- Provenance. None of these three may be absent: a claim without a passage
  -- behind it is an assertion, and a research run exists to produce the
  -- opposite.
  source_ref      text        NOT NULL,
  retrieved_at    timestamptz NOT NULL,
  excerpt         text        NOT NULL,
  uncertainty_nl  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT research_findings_kind_valid CHECK (kind IN
    ('user_document', 'course_fact', 'brand_profile', 'external_source', 'observed_outcome')),
  CONSTRAINT research_findings_ref_present CHECK (length(trim(source_ref)) > 0),
  CONSTRAINT research_findings_excerpt_present CHECK (length(trim(excerpt)) > 0),
  CONSTRAINT research_findings_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX research_findings_run_idx ON research_findings (run_id);
CREATE INDEX research_findings_label_idx ON research_findings (label_id);
