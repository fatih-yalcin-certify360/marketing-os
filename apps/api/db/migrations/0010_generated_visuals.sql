ALTER TABLE assets DROP CONSTRAINT assets_kind_valid;
ALTER TABLE assets ADD CONSTRAINT assets_kind_valid CHECK (kind IN ('logo','font','rendered_image','generated_image','upload','export'));
ALTER TABLE assets ADD COLUMN ai_job_id uuid REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE assets ADD COLUMN ai_request_key text;
ALTER TABLE assets ADD COLUMN ai_provenance jsonb;
CREATE UNIQUE INDEX assets_ai_job_request_unique ON assets(label_id, ai_job_id, ai_request_key) WHERE ai_job_id IS NOT NULL;
ALTER TABLE usage_records ADD COLUMN unit_key text NOT NULL DEFAULT '';
DROP INDEX usage_records_job_attempt_kind_unique;
CREATE UNIQUE INDEX usage_records_job_attempt_kind_unique ON usage_records(job_id, attempt, kind, unit_key) WHERE job_id IS NOT NULL;
-- Generated calls retain their own provenance even if two calls return identical bytes.
DROP INDEX assets_label_sha_kind_unique;
CREATE UNIQUE INDEX assets_label_sha_kind_unique ON assets(label_id, sha256, kind) WHERE kind <> 'generated_image';
