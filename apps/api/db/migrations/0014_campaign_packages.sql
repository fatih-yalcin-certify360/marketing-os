ALTER TABLE campaigns ADD COLUMN radar_run_id uuid REFERENCES radar_runs(id);
ALTER TABLE campaigns ADD CONSTRAINT campaigns_id_label_org_unique UNIQUE (id, label_id, organization_id);
CREATE TABLE campaign_packages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 label_id uuid NOT NULL, campaign_id uuid NOT NULL, job_id uuid UNIQUE REFERENCES jobs(id),
 report jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (campaign_id, label_id, organization_id) REFERENCES campaigns(id, label_id, organization_id) ON DELETE CASCADE
);
CREATE INDEX campaign_packages_campaign_time ON campaign_packages(label_id, campaign_id, created_at DESC);
