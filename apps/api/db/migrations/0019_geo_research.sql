CREATE TABLE geo_course_settings (
 label_id uuid NOT NULL REFERENCES labels(id), course_version_id uuid NOT NULL REFERENCES course_versions(id),
 course_url text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(label_id,course_version_id)
);
CREATE TABLE geo_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label_id uuid NOT NULL REFERENCES labels(id),
 course_version_id uuid NOT NULL REFERENCES course_versions(id), job_id uuid NOT NULL UNIQUE REFERENCES jobs(id),
 report jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX geo_reports_label_history ON geo_reports(label_id,created_at DESC);
CREATE TABLE geo_research_sources (
 job_id uuid PRIMARY KEY REFERENCES jobs(id), label_id uuid NOT NULL REFERENCES labels(id),
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
