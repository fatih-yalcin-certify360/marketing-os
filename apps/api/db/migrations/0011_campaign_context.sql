ALTER TABLE persona_versions ADD COLUMN campaign_id uuid REFERENCES campaigns(id);
CREATE INDEX persona_campaign_idx ON persona_versions(campaign_id);
ALTER TABLE brief_versions ADD COLUMN review_notes jsonb NOT NULL DEFAULT '[]';
