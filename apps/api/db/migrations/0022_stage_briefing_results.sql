-- 0022_stage_briefing_results
--
-- The funnel, connected end to end (campaign-flow-design.md slices 2 and 3;
-- campaign-package-and-audience-research-design.md R-2, R-3, R-7).
--
-- Four additions, every one nullable or defaulted, so nothing existing is
-- back-filled with a guess:
--
--  1. `brief_versions.stage_messages` — the briefing's message per funnel
--     stage: what the campaign thesis says to a reader in that stage, the kind
--     of call to action, and which confirmed course-card *fields* may serve as
--     proof. Fields, not values: the values are read from the course card when
--     content is generated, so a fact withdrawn later is not quoted from a
--     stale copy. Empty for briefs from before stages existed; those generate
--     from the generic stage guidance, as they did.
--
--  2. `content_plans.measurement_plan` — one leading indicator, its source and
--     a decision rule per stage, approved with the channel plan. The shape has
--     no field for a target or a forecast; the contract holds that, this
--     column is jsonb like the advice beside it.
--
--  3. `persona_versions.orientation_sources` — where and when the audience
--     orients (search, employer, colleagues, LinkedIn, trade media), each
--     statement with the channel it bears on and its evidence, or null for an
--     assumption. This is what lets channel advice rest on the audience rather
--     than on the rule alone; the service nulls the evidence of any statement
--     whose source it did not itself hand the model.
--
--  4. `outcome_reports.funnel_stage` — which stage a measured figure belongs
--     to, when the report splits by stage. Nullable on purpose: a platform
--     report usually covers a channel, not a stage, and forcing one would make
--     a person guess. With it, a learning can say "e-mail in Overwegen".
--
-- The stage vocabulary stays the same three values, checked here as well as in
-- the contract, so a row cannot carry a fourth stage whatever code wrote it.

ALTER TABLE brief_versions
  ADD COLUMN stage_messages jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE content_plans
  ADD COLUMN measurement_plan jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE persona_versions
  ADD COLUMN orientation_sources jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE outcome_reports
  ADD COLUMN funnel_stage text;

ALTER TABLE outcome_reports
  ADD CONSTRAINT outcome_funnel_stage_valid CHECK (
    funnel_stage IS NULL OR funnel_stage IN ('discover', 'consider', 'decide')
  );
