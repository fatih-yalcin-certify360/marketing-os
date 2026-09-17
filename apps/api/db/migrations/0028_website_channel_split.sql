-- 0028 — the website becomes two channels (2026-09-15)
--
-- `landing_page` carried two different deliverables: a change proposal for the
-- existing course page, and a new blog article. They have different schemas,
-- different quality rules, different reviewers and different publication
-- routes, and the shared configuration actively damaged the article — the
-- prompt commissioned four to seven sections of sixty to 320 words while the
-- gate refused anything above six sections or below 120 words each.
--
-- Two things this migration does NOT do, on purpose:
--
--  * It does not drop `landing_page`. Half the stored website rows carry no
--    `copy.website.form` at all — content from before the two forms existed —
--    and there is no rule that can classify them after the fact. Guessing would
--    turn a readable piece into a wrongly labelled one.
--  * It does not touch the jsonb columns that mention a channel
--    (`brief_versions.channel_suggestions`, `channel_roles`,
--    `content_plans.channel_advice`, persona orientation sources). Those are
--    advice about a channel, not a piece on one; leaving them is safe exactly
--    because the old value stays in the vocabulary.
--
-- Order matters: the CHECK is dropped, the rows are moved, and only then is the
-- CHECK added back. Adding a validating constraint before the backfill fails
-- against the rows it is meant to describe.
--
-- No explicit transaction: the runner wraps each migration in one.

-- ---------------------------------------------------------------- content ---
ALTER TABLE content_asset_versions DROP CONSTRAINT content_channel_valid;

-- The stored form is the truth. A row without one keeps `landing_page`.
UPDATE content_asset_versions
   SET channel = copy -> 'website' ->> 'form'
 WHERE channel = 'landing_page'
   AND copy -> 'website' ->> 'form' IN ('course_page_update', 'blog_article');

ALTER TABLE content_asset_versions ADD CONSTRAINT content_channel_valid CHECK (channel IN
  ('linkedin_organic', 'instagram_organic', 'facebook_organic',
   'landing_page', 'course_page_update', 'blog_article', 'email',
   'linkedin_ads', 'meta_ads', 'google_search_ads'));

-- ----------------------------------------------------------- publications ---
ALTER TABLE publication_records DROP CONSTRAINT publication_channel_valid;

-- A publication record points at the piece it published, so it can follow it.
UPDATE publication_records p
   SET channel = c.channel
  FROM content_asset_versions c
 WHERE p.content_asset_version_id = c.id
   AND p.channel = 'landing_page'
   AND c.channel <> 'landing_page';

ALTER TABLE publication_records ADD CONSTRAINT publication_channel_valid CHECK (channel IN
  ('linkedin_organic', 'instagram_organic', 'facebook_organic',
   'landing_page', 'course_page_update', 'blog_article', 'email',
   'linkedin_ads', 'meta_ads', 'google_search_ads'));

-- --------------------------------------------------------------- outcomes ---
-- Outcome rows are channel-level figures from a platform report with no piece
-- to join to, so they cannot be moved. They keep `landing_page`, which is why
-- the value has to stay valid here too.
ALTER TABLE outcome_reports DROP CONSTRAINT outcome_channel_valid;
ALTER TABLE outcome_reports ADD CONSTRAINT outcome_channel_valid CHECK (channel IN
  ('linkedin_organic', 'instagram_organic', 'facebook_organic',
   'landing_page', 'course_page_update', 'blog_article', 'email',
   'linkedin_ads', 'meta_ads', 'google_search_ads'));
