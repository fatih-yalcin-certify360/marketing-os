-- 0029 — content that belongs to no campaign (2026-09-15)
--
-- Every piece of content had to be born inside a campaign: `campaign_id`,
-- `brief_version_id` and `concept_version_id` were all NOT NULL (0006, lines
-- 46, 60 and 61). So a blog article that came straight out of an AI-visibility
-- finding, or one supporting image, could not exist at all — the AI-visibility
-- research already wrote a blog proposal, but it stayed a field in a JSON
-- report with no version, no review state and no export.
--
-- Three columns become nullable. Two stay NOT NULL on purpose:
-- `brand_profile_version_id` and `course_version_id`. A loose piece still
-- belongs to a brand and a course, and that grounding is exactly what makes it
-- safe to write without a briefing.

-- `owner_scope` is the discriminator, and the CHECK below is what keeps the
-- invariant in the database rather than in every query that forgets it.
ALTER TABLE content_asset_versions
  ALTER COLUMN campaign_id DROP NOT NULL,
  ALTER COLUMN brief_version_id DROP NOT NULL,
  ALTER COLUMN concept_version_id DROP NOT NULL,
  ADD COLUMN owner_scope text NOT NULL DEFAULT 'campaign',
  -- Where the piece came from, so a draft can point back at the finding that
  -- prompted it. Every vendor we looked at drops this at the hand-off; it is
  -- the one thing we are ahead on, so it is a column and not a note.
  ADD COLUMN origin_kind text,
  ADD COLUMN origin_ref_id uuid;

ALTER TABLE content_asset_versions
  ADD CONSTRAINT content_owner_scope_valid CHECK (owner_scope IN ('campaign', 'standalone')),
  ADD CONSTRAINT content_owner_scope_matches_campaign
    CHECK ((owner_scope = 'campaign') = (campaign_id IS NOT NULL)),
  ADD CONSTRAINT content_origin_kind_valid CHECK (origin_kind IS NULL OR origin_kind IN
    ('manual', 'geo_report', 'radar_card', 'radar_insight')),
  -- A reference without a kind, or a kind without a reference, is a half-told
  -- provenance. `manual` is the exception: nothing to point at.
  ADD CONSTRAINT content_origin_paired CHECK (
    origin_ref_id IS NULL OR origin_kind IS NOT NULL
  );

-- The old uniqueness keyed on `campaign_id`, and NULLs never collide — so the
-- moment the column became nullable it stopped enforcing anything for exactly
-- the rows it now had to cover. Two partial indexes, one per scope.
ALTER TABLE content_asset_versions DROP CONSTRAINT content_key_version_unique;

CREATE UNIQUE INDEX content_key_version_campaign_unique
  ON content_asset_versions (campaign_id, asset_key, version)
  WHERE campaign_id IS NOT NULL;

CREATE UNIQUE INDEX content_key_version_standalone_unique
  ON content_asset_versions (label_id, asset_key, version)
  WHERE campaign_id IS NULL;

-- Drives the "zonder campagne" list, which has no campaign to filter on.
CREATE INDEX content_standalone_by_label_idx
  ON content_asset_versions (label_id, created_at DESC)
  WHERE campaign_id IS NULL;
