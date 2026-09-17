ALTER TABLE persona_versions ADD COLUMN questionnaire jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(questionnaire) = 'object');
