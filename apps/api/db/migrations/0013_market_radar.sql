CREATE TABLE radar_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 label_id uuid NOT NULL, course_version_id uuid NOT NULL, job_id uuid UNIQUE REFERENCES jobs(id),
 report jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (course_version_id, label_id, organization_id) REFERENCES course_versions(id, label_id, organization_id) ON DELETE CASCADE
);
CREATE INDEX radar_runs_course_time ON radar_runs(label_id, course_version_id, created_at DESC);
