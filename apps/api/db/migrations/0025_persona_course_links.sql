-- 0025_persona_course_links
--
-- A persona linked to more than one course (personas-campaigns-content-quality
-- follow-up, 2026-09-14). `course_version_id` stays the course the persona was
-- made for; this column lists the other course versions it is also relevant
-- for, so the same audience appears under each of them without a copy.
-- Defaulted to an empty list: every existing row reads back unchanged.
ALTER TABLE persona_versions
  ADD COLUMN IF NOT EXISTS linked_course_version_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
