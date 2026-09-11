-- 0005_personas_campaigns
--
-- Personas, opportunities, campaigns, briefs and concepts.
--
-- Every step in the chain references the *version* of what it was built from,
-- not the entity. That is what lets the system answer "which briefs rest on the
-- old course version?" and flag them, instead of relying on someone to
-- remember. See docs/architecture/overview.md.

CREATE TABLE persona_versions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  label_id          uuid        NOT NULL,
  -- Stable across versions: the identity of "this persona".
  persona_key       text        NOT NULL,
  version           integer     NOT NULL,
  -- A persona is always about one specific course version.
  course_version_id uuid        NOT NULL REFERENCES course_versions (id) ON DELETE CASCADE,
  name              text        NOT NULL,
  summary           text        NOT NULL,
  need              text        NOT NULL,
  motivation        text        NOT NULL,
  barriers          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  decision_criteria jsonb       NOT NULL DEFAULT '[]'::jsonb,
  relation_to_course text       NOT NULL,
  -- Grounding and assumptions are kept apart so a reader can always see which
  -- is which. There are deliberately no demographic columns.
  grounding         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  assumptions       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  review_state      text        NOT NULL DEFAULT 'draft',
  origin            text        NOT NULL DEFAULT 'ai_generated',
  prompt_version    text,
  created_by_user_id uuid       REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT persona_review_state_valid CHECK (review_state IN
    ('draft', 'in_review', 'changes_requested', 'approved', 'needs_rereview', 'archived')),
  CONSTRAINT persona_origin_valid CHECK (origin IN
    ('demo', 'user', 'extracted', 'external', 'ai_generated')),
  CONSTRAINT persona_version_positive CHECK (version >= 1),
  CONSTRAINT persona_arrays CHECK (
    jsonb_typeof(barriers) = 'array' AND jsonb_typeof(decision_criteria) = 'array'
    AND jsonb_typeof(grounding) = 'array' AND jsonb_typeof(assumptions) = 'array'),
  CONSTRAINT persona_key_version_unique UNIQUE (label_id, persona_key, version),
  CONSTRAINT persona_id_version_unique UNIQUE (id, version),
  CONSTRAINT persona_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX persona_label_course_idx ON persona_versions (label_id, course_version_id);
CREATE INDEX persona_label_created_idx ON persona_versions (label_id, created_at DESC);

CREATE TABLE opportunities (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  label_id            uuid        NOT NULL,
  course_version_id   uuid        NOT NULL REFERENCES course_versions (id) ON DELETE CASCADE,
  -- Groups the set of proposals produced together, so "the three options I was
  -- shown" stays reconstructable after one is chosen.
  proposal_set_id     uuid        NOT NULL,
  persona_version_ids jsonb       NOT NULL,
  title               text        NOT NULL,
  goal_and_need       text        NOT NULL,
  core_idea           text        NOT NULL,
  source_and_timing   text        NOT NULL,
  fit_notes           text        NOT NULL,
  uncertainties       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  small_test_proposal text        NOT NULL,
  measurement_approach text       NOT NULL,
  -- Order plus a stated reason. There is deliberately no score column: the
  -- requirement forbids unfounded success scores and sales forecasts.
  rank                integer     NOT NULL,
  rank_rationale_nl   text        NOT NULL,
  grounding           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  selected            boolean     NOT NULL DEFAULT false,
  origin              text        NOT NULL DEFAULT 'ai_generated',
  prompt_version      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_rank_bounded CHECK (rank >= 1 AND rank <= 10),
  CONSTRAINT opportunity_arrays CHECK (
    jsonb_typeof(persona_version_ids) = 'array' AND jsonb_typeof(uncertainties) = 'array'
    AND jsonb_typeof(grounding) = 'array'),
  CONSTRAINT opportunity_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX opportunity_set_rank_idx ON opportunities (proposal_set_id, rank);
CREATE INDEX opportunity_label_created_idx ON opportunities (label_id, created_at DESC);

CREATE TABLE campaigns (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  label_id                 uuid        NOT NULL,
  name                     text        NOT NULL,
  entry_mode               text        NOT NULL,
  stage                    text        NOT NULL DEFAULT 'label_course',
  content_language         text        NOT NULL DEFAULT 'nl',
  course_version_id        uuid        NOT NULL REFERENCES course_versions (id) ON DELETE RESTRICT,
  brand_profile_version_id uuid        NOT NULL REFERENCES brand_profile_versions (id) ON DELETE RESTRICT,
  opportunity_id           uuid        REFERENCES opportunities (id) ON DELETE SET NULL,
  -- The user's own starting point for the "develop my idea" / "start from a
  -- briefing" entry modes. Kept so the origin of a campaign stays visible.
  user_idea                text,
  supplied_brief           text,
  owner_user_id            uuid        REFERENCES users (id) ON DELETE SET NULL,
  -- Optional: without a start date the calendar is produced relatively.
  start_date               date,
  budget_cents             integer,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_entry_mode_valid CHECK (entry_mode IN
    ('discover_opportunities', 'develop_my_idea', 'start_from_briefing')),
  CONSTRAINT campaign_stage_valid CHECK (stage IN
    ('label_course', 'research', 'persona_selection', 'opportunity_selection',
     'brief_approval', 'concept_selection', 'content_plan_approval', 'production',
     'editing', 'final_approval', 'export', 'results', 'learnings')),
  CONSTRAINT campaign_language_valid CHECK (content_language IN ('nl', 'en', 'de', 'fr')),
  CONSTRAINT campaign_budget_non_negative CHECK (budget_cents IS NULL OR budget_cents >= 0),
  CONSTRAINT campaign_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX campaign_label_created_idx ON campaigns (label_id, created_at DESC);

CREATE TABLE brief_versions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  label_id            uuid        NOT NULL,
  campaign_id         uuid        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  version             integer     NOT NULL,
  goal                text        NOT NULL,
  -- Bound to persona *versions*, so a later persona revision is detectable.
  persona_version_ids jsonb       NOT NULL,
  core_message        text        NOT NULL,
  evidence            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  usable_claims       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- What this campaign may NOT claim, derived from brand rules and from course
  -- facts nobody has confirmed. Carried into every generation prompt.
  off_limits          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  cta                 text        NOT NULL,
  cta_url             text,
  channel_suggestions jsonb       NOT NULL DEFAULT '[]'::jsonb,
  content_scope       text        NOT NULL,
  measurement         text        NOT NULL,
  stop_conditions     text        NOT NULL,
  owner_user_id       uuid        REFERENCES users (id) ON DELETE SET NULL,
  budget_cents        integer,
  start_date          date,
  review_state        text        NOT NULL DEFAULT 'draft',
  origin              text        NOT NULL DEFAULT 'ai_generated',
  prompt_version      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brief_review_state_valid CHECK (review_state IN
    ('draft', 'in_review', 'changes_requested', 'approved', 'needs_rereview', 'archived')),
  CONSTRAINT brief_version_positive CHECK (version >= 1),
  CONSTRAINT brief_arrays CHECK (
    jsonb_typeof(persona_version_ids) = 'array' AND jsonb_typeof(evidence) = 'array'
    AND jsonb_typeof(usable_claims) = 'array' AND jsonb_typeof(off_limits) = 'array'
    AND jsonb_typeof(channel_suggestions) = 'array'),
  CONSTRAINT brief_campaign_version_unique UNIQUE (campaign_id, version),
  CONSTRAINT brief_id_version_unique UNIQUE (id, version),
  CONSTRAINT brief_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

-- At most one approved brief per campaign: the gate the concept stage reads.
CREATE UNIQUE INDEX brief_one_approved_per_campaign
  ON brief_versions (campaign_id) WHERE review_state = 'approved';

CREATE TABLE concept_versions (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL,
  label_id               uuid        NOT NULL,
  campaign_id            uuid        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  brief_version_id       uuid        NOT NULL REFERENCES brief_versions (id) ON DELETE CASCADE,
  concept_key            text        NOT NULL,
  version                integer     NOT NULL,
  name                   text        NOT NULL,
  core_idea              text        NOT NULL,
  example_headline       text        NOT NULL,
  visual_approach        text        NOT NULL,
  -- Maps the described approach onto a layout our render layer implements, so
  -- the visual idea is executable rather than only descriptive.
  visual_layout          text        NOT NULL,
  persona_fit_rationale_nl text      NOT NULL,
  selected               boolean     NOT NULL DEFAULT false,
  review_state           text        NOT NULL DEFAULT 'draft',
  origin                 text        NOT NULL DEFAULT 'ai_generated',
  prompt_version         text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT concept_layout_valid CHECK (visual_layout IN
    ('bold_statement', 'split_panel', 'quiet_editorial')),
  CONSTRAINT concept_review_state_valid CHECK (review_state IN
    ('draft', 'in_review', 'changes_requested', 'approved', 'needs_rereview', 'archived')),
  CONSTRAINT concept_version_positive CHECK (version >= 1),
  CONSTRAINT concept_key_version_unique UNIQUE (campaign_id, concept_key, version),
  CONSTRAINT concept_id_version_unique UNIQUE (id, version),
  CONSTRAINT concept_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX concept_one_selected_per_campaign
  ON concept_versions (campaign_id) WHERE selected;
CREATE INDEX concept_campaign_idx ON concept_versions (campaign_id, created_at DESC);
