-- One registry: AI Visibility and competitor research share the same identities.
-- Existing rows acquire profile defaults on read; no companies are duplicated.
ALTER TABLE visibility_entities
  ADD COLUMN profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT visibility_entity_profile_object CHECK (jsonb_typeof(profile) = 'object');
