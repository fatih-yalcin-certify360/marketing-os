-- 0006_content_approvals_exports
--
-- Content assets, the content plan, approvals and export packages.
--
-- The two properties this migration exists to guarantee:
--
--  1. **An approval is bound to one exact version.** `approvals` is unique on
--     (artefact_type, artefact_id, artefact_version), and a revision inserts a
--     new version row — so a new version is unapproved by construction rather
--     than by someone remembering to clear a flag.
--
--  2. **Staleness is computable.** Every content asset version stores the ids
--     of the brief, concept, brand, course and persona versions it was made
--     from. A changed dependency is then a query, not a guess.

CREATE TABLE content_plans (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid      NOT NULL,
  label_id      uuid        NOT NULL,
  campaign_id   uuid        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  version       integer     NOT NULL,
  items         jsonb       NOT NULL,
  cadence_nl    text        NOT NULL,
  rationale_nl  text        NOT NULL,
  review_state  text        NOT NULL DEFAULT 'draft',
  origin        text        NOT NULL DEFAULT 'ai_generated',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_plan_items_array CHECK (jsonb_typeof(items) = 'array'),
  CONSTRAINT content_plan_review_state_valid CHECK (review_state IN
    ('draft', 'in_review', 'changes_requested', 'approved', 'needs_rereview', 'archived')),
  CONSTRAINT content_plan_version_positive CHECK (version >= 1),
  CONSTRAINT content_plan_campaign_version_unique UNIQUE (campaign_id, version),
  CONSTRAINT content_plan_id_version_unique UNIQUE (id, version),
  CONSTRAINT content_plan_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

-- The gate the production stage reads.
CREATE UNIQUE INDEX content_plan_one_approved_per_campaign
  ON content_plans (campaign_id) WHERE review_state = 'approved';

CREATE TABLE content_asset_versions (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  label_id                 uuid        NOT NULL,
  campaign_id              uuid        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  -- Stable across versions: the identity of "this piece of content".
  asset_key                text        NOT NULL,
  version                  integer     NOT NULL,
  channel                  text        NOT NULL,
  format                   text        NOT NULL DEFAULT 'single_image',
  language                 text        NOT NULL DEFAULT 'nl',
  -- One copy record shared by both design variants, which is what enforces
  -- "same message and CTA, different visual approach".
  copy                     jsonb       NOT NULL,
  -- Per-variant render spec plus the rendered image it produced.
  variants                 jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- Provenance. Nullable only where the stage genuinely may not exist yet.
  brief_version_id         uuid        NOT NULL REFERENCES brief_versions (id) ON DELETE CASCADE,
  concept_version_id       uuid        NOT NULL REFERENCES concept_versions (id) ON DELETE CASCADE,
  brand_profile_version_id uuid        NOT NULL REFERENCES brand_profile_versions (id) ON DELETE RESTRICT,
  course_version_id        uuid        NOT NULL REFERENCES course_versions (id) ON DELETE RESTRICT,
  persona_version_ids      jsonb       NOT NULL DEFAULT '[]'::jsonb,

  warnings                 jsonb       NOT NULL DEFAULT '[]'::jsonb,
  review_state             text        NOT NULL DEFAULT 'draft',
  origin                   text        NOT NULL DEFAULT 'ai_generated',
  prompt_version           text,
  -- Set when a person edited the text. Regeneration warns before discarding it,
  -- so a hand-written edit is never silently overwritten.
  edited_by_user_id        uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_by_user_id       uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT content_channel_valid CHECK (channel IN
    ('linkedin_organic', 'instagram_organic', 'facebook_organic', 'landing_page', 'email',
     'linkedin_ads', 'meta_ads', 'google_search_ads')),
  CONSTRAINT content_format_valid CHECK (format IN
    ('single_image', 'carousel', 'text_only', 'video')),
  CONSTRAINT content_language_valid CHECK (language IN ('nl', 'en', 'de', 'fr')),
  CONSTRAINT content_review_state_valid CHECK (review_state IN
    ('draft', 'in_review', 'changes_requested', 'approved', 'needs_rereview', 'archived')),
  CONSTRAINT content_origin_valid CHECK (origin IN
    ('demo', 'user', 'extracted', 'external', 'ai_generated')),
  CONSTRAINT content_version_positive CHECK (version >= 1),
  CONSTRAINT content_copy_object CHECK (jsonb_typeof(copy) = 'object'),
  CONSTRAINT content_variants_array CHECK (jsonb_typeof(variants) = 'array'),
  CONSTRAINT content_key_version_unique UNIQUE (campaign_id, asset_key, version),
  CONSTRAINT content_id_version_unique UNIQUE (id, version),
  CONSTRAINT content_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX content_campaign_key_version_idx
  ON content_asset_versions (campaign_id, asset_key, version DESC);
-- Drives the Werkruimte "ready for review" and "needs re-review" counters.
CREATE INDEX content_label_review_state_idx
  ON content_asset_versions (label_id, review_state);
-- Answers "which assets rest on this course/brand version?" for change impact.
CREATE INDEX content_course_version_idx ON content_asset_versions (course_version_id);
CREATE INDEX content_brand_version_idx ON content_asset_versions (brand_profile_version_id);

CREATE TABLE approvals (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  label_id         uuid        NOT NULL,
  artefact_type    text        NOT NULL,
  artefact_id      uuid        NOT NULL,
  -- The version this approval is for, and no other.
  artefact_version integer     NOT NULL,
  approved_by_user_id uuid     NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  approved_at      timestamptz NOT NULL DEFAULT now(),
  note_nl          text,
  CONSTRAINT approval_artefact_type_valid CHECK (artefact_type IN
    ('brand_profile', 'course', 'persona', 'brief', 'concept', 'content_asset', 'content_plan')),
  CONSTRAINT approval_version_positive CHECK (artefact_version >= 1),
  -- One approval per artefact version. Re-approving is idempotent rather than
  -- producing a second row that would make "who approved this" ambiguous.
  CONSTRAINT approval_unique UNIQUE (artefact_type, artefact_id, artefact_version),
  CONSTRAINT approval_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX approval_label_created_idx ON approvals (label_id, approved_at DESC);
CREATE INDEX approval_artefact_idx ON approvals (artefact_type, artefact_id);

CREATE TABLE exports (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL,
  label_id           uuid        NOT NULL,
  campaign_id        uuid        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  kind               text        NOT NULL,
  manifest           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Why a publish-ready package was refused, in Dutch, for display.
  blocked_reasons_nl jsonb       NOT NULL DEFAULT '[]'::jsonb,
  asset_id           uuid        REFERENCES assets (id) ON DELETE SET NULL,
  size_bytes         integer     NOT NULL DEFAULT 0,
  created_by_user_id uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT export_kind_valid CHECK (kind IN ('draft', 'publish_ready')),
  CONSTRAINT export_arrays CHECK (
    jsonb_typeof(manifest) = 'array' AND jsonb_typeof(blocked_reasons_nl) = 'array'),
  CONSTRAINT export_size_non_negative CHECK (size_bytes >= 0),
  CONSTRAINT export_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX export_campaign_created_idx ON exports (campaign_id, created_at DESC);

-- Publication is recorded by a person. The system never publishes, and
-- "approved" is deliberately not the same thing as "published".
CREATE TABLE publication_records (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  label_id                 uuid        NOT NULL,
  campaign_id              uuid        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  content_asset_version_id uuid        NOT NULL REFERENCES content_asset_versions (id) ON DELETE CASCADE,
  channel                  text        NOT NULL,
  published_at             timestamptz NOT NULL,
  external_url             text,
  note_nl                  text,
  recorded_by_user_id      uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publication_channel_valid CHECK (channel IN
    ('linkedin_organic', 'instagram_organic', 'facebook_organic', 'landing_page', 'email',
     'linkedin_ads', 'meta_ads', 'google_search_ads')),
  CONSTRAINT publication_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX publication_campaign_idx ON publication_records (campaign_id, published_at DESC);
