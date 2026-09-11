-- 0021_funnel
--
-- A campaign that knows what it is for, and a plan that says why these
-- channels (campaign-flow-design.md, slice 1).
--
-- Three additions, all nullable or defaulted, so nothing existing is
-- back-filled with a guess:
--
--  1. `campaigns.objective` — what the campaign must achieve. It decides which
--     funnel stages the plan covers. Campaigns from before this column read as
--     "geen doel vastgelegd" and plan as a full funnel until someone sets one;
--     inventing an objective for them would put words in a marketer's mouth.
--
--  2. `content_plans.channel_advice` — the argument per stage × channel cell:
--     the editorial rule verdict, the model's advised verdict for this campaign,
--     and the reasoning. Stored on the plan version it belongs to, so an
--     approval binds to the advice the user saw. The shape carries no field for
--     a reach, cost or conversion figure; the contract (and its test) is where
--     that is enforced, this column is jsonb like the plan items beside it.
--
--  3. `content_asset_versions.funnel_stage` — which stage a piece of content
--     was written for. Every version of one asset key shares it. Null for
--     content made before stages existed or from a stage-less plan.
--
-- The stage vocabulary is fixed on purpose (three values) — it is what makes
-- advice, results and learnings comparable across campaigns — and is checked
-- here as well as in the contract, so a row cannot carry a fourth stage
-- whatever code wrote it.

ALTER TABLE campaigns
  ADD COLUMN objective text;

ALTER TABLE campaigns
  ADD CONSTRAINT campaign_objective_valid CHECK (
    objective IS NULL OR objective IN ('awareness', 'consideration', 'conversion', 'full_funnel')
  );

ALTER TABLE content_plans
  ADD COLUMN channel_advice jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE content_asset_versions
  ADD COLUMN funnel_stage text;

ALTER TABLE content_asset_versions
  ADD CONSTRAINT content_funnel_stage_valid CHECK (
    funnel_stage IS NULL OR funnel_stage IN ('discover', 'consider', 'decide')
  );
