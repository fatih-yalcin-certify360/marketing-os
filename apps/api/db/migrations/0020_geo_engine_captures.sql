CREATE TABLE geo_engine_captures (
 job_id uuid PRIMARY KEY REFERENCES jobs(id), label_id uuid NOT NULL REFERENCES labels(id),
 snapshot_id text, state text NOT NULL CHECK(state IN ('submitted','ready')),
 answers jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
