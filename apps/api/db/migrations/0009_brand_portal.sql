ALTER TABLE labels ADD COLUMN brand_portal_slug text;
ALTER TABLE labels ADD COLUMN brand_portal_checked_at timestamptz;
ALTER TABLE labels ADD COLUMN brand_portal_error text;
ALTER TABLE labels ADD CONSTRAINT labels_portal_slug_valid CHECK (brand_portal_slug IS NULL OR brand_portal_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE brand_profile_versions ADD COLUMN portal jsonb;
ALTER TABLE assets DROP CONSTRAINT assets_kind_valid;
ALTER TABLE assets ADD CONSTRAINT assets_kind_valid CHECK (kind IN ('logo', 'font', 'rendered_image', 'upload', 'export'));
