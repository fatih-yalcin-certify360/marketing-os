-- 0018_outcomes
--
-- What actually happened after a campaign left the building (P4-1).
--
-- `publication_records` has existed since 0006 with no reader and no writer: it
-- was designed for this and never wired. It records that a person published a
-- specific content version, when, and where. This migration adds the second
-- half — the measured results — and the properties below are the reason it
-- looks the way it does.
--
--  1. **Every figure carries its provenance.** `source` says how the number was
--     obtained: read off a platform report that is attached here, or typed in
--     by hand. Without that, a figure in this table is indistinguishable from
--     one this system produced — and this system produces none. It has no
--     advertising account and no measurement period, so a number it invented
--     would be a guess acted on with money.
--
--  2. **A figure without a period means nothing.** `period_start` and
--     `period_end` are NOT NULL and ordered by a check. "412 clicks" is not a
--     fact until it says over which days.
--
--  3. **Every metric is nullable, and none is derived.** A platform reports
--     what it reports; a missing number stays missing rather than becoming a
--     zero, because zero is a measurement and NULL is an absence. No
--     click-through rate, cost per click or conversion rate is stored: those
--     are arithmetic on the columns beside them, would go stale the moment an
--     input is corrected, and a stored ratio invites being read as a verdict on
--     the campaign. Whether the campaign *caused* any of this is not a question
--     this table answers, and P4-2 is where that gets its own guardrails.
--
--  4. **Nothing crosses a label**, by the same composite foreign key the rest
--     of the schema uses.

CREATE TABLE outcome_reports (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL,
  label_id               uuid        NOT NULL,
  campaign_id            uuid        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  -- Optional: a platform report often covers a whole channel rather than one
  -- post. When it does name one, this points at the publication it belongs to.
  publication_record_id  uuid        REFERENCES publication_records (id) ON DELETE SET NULL,
  channel                text        NOT NULL,
  period_start           date        NOT NULL,
  period_end             date        NOT NULL,
  -- Every metric nullable: a platform reports what it reports. NULL is "not
  -- reported"; 0 is "reported as none".
  impressions            integer,
  clicks                 integer,
  signups                integer,
  spend_cents            integer,
  source                 text        NOT NULL,
  -- The uploaded platform report, when there is one. `SET NULL` rather than
  -- cascade: losing the file must not silently delete the figures a person
  -- read off it and can still vouch for.
  report_asset_id        uuid        REFERENCES assets (id) ON DELETE SET NULL,
  note_nl                text,
  recorded_by_user_id    uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT outcome_channel_valid CHECK (channel IN
    ('linkedin_organic', 'instagram_organic', 'facebook_organic', 'landing_page', 'email',
     'linkedin_ads', 'meta_ads', 'google_search_ads')),
  CONSTRAINT outcome_source_valid CHECK (source IN ('platform_report', 'manual_entry')),
  CONSTRAINT outcome_period_ordered CHECK (period_end >= period_start),
  -- Negative impressions are not a measurement, they are a mistake.
  CONSTRAINT outcome_impressions_valid CHECK (impressions IS NULL OR impressions >= 0),
  CONSTRAINT outcome_clicks_valid      CHECK (clicks      IS NULL OR clicks      >= 0),
  CONSTRAINT outcome_signups_valid     CHECK (signups     IS NULL OR signups     >= 0),
  CONSTRAINT outcome_spend_valid       CHECK (spend_cents IS NULL OR spend_cents >= 0),
  -- A report that says it came from a platform report must have the report.
  CONSTRAINT outcome_report_present CHECK (source <> 'platform_report' OR report_asset_id IS NOT NULL),
  -- At least one figure, or the row records nothing at all.
  CONSTRAINT outcome_has_a_figure CHECK (
    impressions IS NOT NULL OR clicks IS NOT NULL OR signups IS NOT NULL OR spend_cents IS NOT NULL
  ),
  CONSTRAINT outcome_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX outcome_campaign_idx ON outcome_reports (campaign_id, period_start DESC);
CREATE INDEX outcome_label_idx ON outcome_reports (label_id, created_at DESC);
