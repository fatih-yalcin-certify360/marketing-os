-- 0026_brief_sections
--
-- The sections of a professional campaign brief (2026-09-14): context, the
-- audience insight, the proposition, tone of voice, mandatories, a role per
-- channel, timing, risks. Every column defaulted, so a brief written before
-- reads back unchanged and the screen says "niet uitgewerkt" where it is silent.
ALTER TABLE brief_versions
  ADD COLUMN IF NOT EXISTS context_nl text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS audience_insight_nl text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS proposition_nl text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tone_of_voice_nl text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mandatories jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS channel_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS timing_nl text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS risks jsonb NOT NULL DEFAULT '[]'::jsonb;
