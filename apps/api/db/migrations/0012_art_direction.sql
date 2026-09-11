ALTER TABLE campaigns ADD COLUMN visual_reference_asset_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE concept_versions ADD COLUMN art_direction jsonb;
