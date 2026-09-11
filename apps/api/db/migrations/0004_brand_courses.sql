-- 0004_brand_courses
--
-- Brand profiles and course cards. Both are append-only version tables
-- (ADR-0012): a revision inserts version n+1 and nothing is updated in place,
-- so an approval bound to a version stays bound to exactly what was approved.
--
-- Both carry the composite foreign key to labels (id, organization_id), which
-- is what makes a cross-organisation row impossible at the storage layer.

CREATE TABLE assets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  label_id        uuid        NOT NULL,
  kind            text        NOT NULL,
  mime_type       text        NOT NULL,
  byte_size       integer     NOT NULL,
  -- Content hash: lets an identical render be reused instead of re-rendered,
  -- and detects a file changing underneath a version that referenced it.
  sha256          text        NOT NULL,
  -- Path relative to STORAGE_ROOT. Served only via an authorised endpoint;
  -- there is deliberately no publicly guessable URL.
  storage_path    text        NOT NULL,
  original_name   text,
  width_px        integer,
  height_px       integer,
  created_by_user_id uuid     REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assets_kind_valid CHECK (kind IN ('logo', 'rendered_image', 'upload', 'export')),
  CONSTRAINT assets_size_positive CHECK (byte_size > 0),
  CONSTRAINT assets_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX assets_label_created_idx ON assets (label_id, created_at DESC);
-- Reuse an identical rendered image rather than producing it twice.
CREATE UNIQUE INDEX assets_label_sha_kind_unique ON assets (label_id, sha256, kind);

CREATE TABLE brand_profile_versions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  label_id        uuid        NOT NULL,
  version         integer     NOT NULL,
  brand_name      text        NOT NULL,
  -- Colour, typography and tone are small closed structures; kept as JSONB so
  -- adding a token later is not a migration, while the shape is enforced by
  -- Zod at every boundary.
  colors          jsonb       NOT NULL,
  typography      jsonb       NOT NULL,
  tone            jsonb       NOT NULL,
  rules           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  example_content text        NOT NULL DEFAULT '',
  logo_text       text,
  logo_asset_id   uuid        REFERENCES assets (id) ON DELETE SET NULL,
  image_usage_note text,
  review_state    text        NOT NULL DEFAULT 'draft',
  origin          text        NOT NULL DEFAULT 'user',
  prompt_version  text,
  created_by_user_id uuid     REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_review_state_valid CHECK (review_state IN
    ('draft', 'in_review', 'changes_requested', 'approved', 'needs_rereview', 'archived')),
  CONSTRAINT brand_origin_valid CHECK (origin IN
    ('demo', 'user', 'extracted', 'external', 'ai_generated')),
  CONSTRAINT brand_version_positive CHECK (version >= 1),
  CONSTRAINT brand_objects CHECK (
    jsonb_typeof(colors) = 'object' AND jsonb_typeof(typography) = 'object'
    AND jsonb_typeof(tone) = 'object' AND jsonb_typeof(rules) = 'array'),
  -- One version number per label: the append-only guarantee.
  CONSTRAINT brand_label_version_unique UNIQUE (label_id, version),
  CONSTRAINT brand_id_version_unique UNIQUE (id, version),
  CONSTRAINT brand_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

-- At most one approved brand profile per label. A partial unique index states
-- the rule the application relies on when it resolves "the" brand profile.
CREATE UNIQUE INDEX brand_one_approved_per_label
  ON brand_profile_versions (label_id) WHERE review_state = 'approved';
CREATE INDEX brand_label_version_idx ON brand_profile_versions (label_id, version DESC);

CREATE TABLE course_versions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  label_id        uuid        NOT NULL,
  -- Stable across versions: the identity of "this course".
  course_key      text        NOT NULL,
  version         integer     NOT NULL,
  name            text        NOT NULL,
  external_code   text,
  source_kind     text        NOT NULL DEFAULT 'manual',
  source_ref      text,
  course_url      text,
  -- One object per factual field: value, verification state, source and the
  -- extractor's uncertainty. Per-field rather than one overall flag, because
  -- conditions, duration, price and dates are individually accountable.
  facts           jsonb       NOT NULL,
  -- Structured values, only populated once the matching fact is confirmed.
  price_cents     integer,
  price_note      text,
  dates           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  review_state    text        NOT NULL DEFAULT 'draft',
  origin          text        NOT NULL DEFAULT 'user',
  prompt_version  text,
  created_by_user_id uuid     REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_review_state_valid CHECK (review_state IN
    ('draft', 'in_review', 'changes_requested', 'approved', 'needs_rereview', 'archived')),
  CONSTRAINT course_origin_valid CHECK (origin IN
    ('demo', 'user', 'extracted', 'external', 'ai_generated')),
  CONSTRAINT course_source_kind_valid CHECK (source_kind IN
    ('manual', 'document', 'course_page_url')),
  CONSTRAINT course_version_positive CHECK (version >= 1),
  CONSTRAINT course_price_non_negative CHECK (price_cents IS NULL OR price_cents >= 0),
  CONSTRAINT course_facts_object CHECK (jsonb_typeof(facts) = 'object'),
  CONSTRAINT course_dates_array CHECK (jsonb_typeof(dates) = 'array'),
  CONSTRAINT course_key_version_unique UNIQUE (label_id, course_key, version),
  CONSTRAINT course_id_version_unique UNIQUE (id, version),
  CONSTRAINT course_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX course_one_approved_per_key
  ON course_versions (label_id, course_key) WHERE review_state = 'approved';
CREATE INDEX course_label_created_idx ON course_versions (label_id, created_at DESC);
