-- 0019_learnings
--
-- Conclusions a person drew from measured results, and which later proposals
-- may be told about (P4-2).
--
-- The backlog states two constraints for this item and both are structural
-- here rather than left to a prompt or a reviewer:
--
--  1. **No causality claims from thin data.** A learning is written by a
--     person, never computed. It is stored as two separate fields —
--     `observation_nl`, what was measured, and `hypothesis_nl`, what the
--     author thinks it means — because a single "conclusion" field invites a
--     sentence that reads as a proven cause. It must also cite the outcome
--     rows it rests on (`learning_evidence`), so a reader can see how much
--     data is behind it. Two numbers moving together is not a cause, and four
--     data points are not a trend.
--
--  2. **No automatic persona or brand changes.** Nothing here references a
--     persona or a brand profile, and nothing in the module can write one.
--     An approved learning is *context handed to a later proposal*, which a
--     person then reviews like any other proposal. There is deliberately no
--     path from a learning to a stored persona or brand rule.
--
-- Approval works like every other artefact: a learning influences nothing
-- until someone approves that specific version of it, and `review_state` is
-- what the query filters on when assembling prompt context.

CREATE TABLE learnings (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  label_id            uuid        NOT NULL,
  -- Label-scoped, not campaign-scoped: a learning outlives the campaign that
  -- produced it, and that is the whole point of recording one. The campaign it
  -- came from is recorded, and may be gone later.
  origin_campaign_id  uuid        REFERENCES campaigns (id) ON DELETE SET NULL,
  observation_nl      text        NOT NULL,
  hypothesis_nl       text        NOT NULL,
  -- What the author says would confirm or refute it. A hypothesis nobody could
  -- test is an opinion, and this column is what makes the difference visible.
  next_test_nl        text        NOT NULL,
  review_state        text        NOT NULL DEFAULT 'draft',
  approved_at         timestamptz,
  approved_by_user_id uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_by_user_id  uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT learning_review_state_valid CHECK (review_state IN ('draft', 'approved', 'archived')),
  -- Blank prose is not an observation. The length floors are deliberate: a
  -- three-word "worked well" is exactly the kind of learning that misleads a
  -- later reader who no longer remembers the campaign.
  CONSTRAINT learning_observation_present CHECK (length(btrim(observation_nl)) >= 20),
  CONSTRAINT learning_hypothesis_present  CHECK (length(btrim(hypothesis_nl))  >= 20),
  CONSTRAINT learning_next_test_present   CHECK (length(btrim(next_test_nl))   >= 10),
  -- An approved row must say who approved it and when; a draft must not claim
  -- either. Same shape as every other approval in the schema.
  CONSTRAINT learning_approval_complete CHECK (
    (review_state = 'approved') = (approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL)
  ),
  CONSTRAINT learning_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX learning_label_idx ON learnings (label_id, review_state, created_at DESC);

-- The evidence a learning rests on: which measured outcomes.
--
-- A separate table rather than an array column, so the reference is a real
-- foreign key. If an outcome row is deleted the link goes with it, and the
-- learning is then visibly resting on less than it claimed rather than
-- pointing at an id that no longer exists.
CREATE TABLE learning_evidence (
  learning_id       uuid NOT NULL REFERENCES learnings (id) ON DELETE CASCADE,
  outcome_report_id uuid NOT NULL REFERENCES outcome_reports (id) ON DELETE CASCADE,
  PRIMARY KEY (learning_id, outcome_report_id)
);
