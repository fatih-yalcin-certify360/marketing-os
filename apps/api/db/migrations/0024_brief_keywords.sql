-- 0024_brief_keywords
--
-- Search phrases on a briefing (personas-campaigns-content-quality-design.md,
-- slice C). A briefing names the phrases the content should carry — from the
-- radar's keyword research when the campaign came from a scan, otherwise
-- derived from the course name and its confirmed facts and labelled as such.
-- No volume, difficulty or position travels with them: nothing was measured.
--
-- Defaulted to an empty list, so every existing briefing reads back unchanged.
ALTER TABLE brief_versions
  ADD COLUMN IF NOT EXISTS keywords jsonb NOT NULL DEFAULT '[]'::jsonb;
