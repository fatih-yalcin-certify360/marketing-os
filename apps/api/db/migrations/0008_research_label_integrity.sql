-- References between research resources must preserve both tenant and label.
ALTER TABLE assets ADD CONSTRAINT assets_id_label_org_unique UNIQUE (id, label_id, organization_id);
ALTER TABLE course_versions ADD CONSTRAINT course_versions_id_label_org_unique UNIQUE (id, label_id, organization_id);
ALTER TABLE sources ADD CONSTRAINT sources_id_label_org_unique UNIQUE (id, label_id, organization_id);
ALTER TABLE research_runs ADD CONSTRAINT research_runs_id_label_org_unique UNIQUE (id, label_id, organization_id);
ALTER TABLE sources DROP CONSTRAINT sources_asset_id_fkey;
ALTER TABLE sources ADD CONSTRAINT sources_asset_label_fk
  FOREIGN KEY (asset_id, label_id, organization_id) REFERENCES assets (id, label_id, organization_id) ON DELETE RESTRICT;
ALTER TABLE sources ADD CONSTRAINT sources_kind_target_valid CHECK ((kind = 'user_document') = (asset_id IS NOT NULL));
ALTER TABLE research_runs ADD CONSTRAINT research_runs_course_label_fk
  FOREIGN KEY (course_version_id, label_id, organization_id) REFERENCES course_versions (id, label_id, organization_id) ON DELETE CASCADE;
ALTER TABLE research_findings ADD CONSTRAINT research_findings_run_label_fk
  FOREIGN KEY (run_id, label_id, organization_id) REFERENCES research_runs (id, label_id, organization_id) ON DELETE CASCADE;
ALTER TABLE research_findings ADD CONSTRAINT research_findings_source_label_fk
  FOREIGN KEY (source_id, label_id, organization_id) REFERENCES sources (id, label_id, organization_id) ON DELETE SET NULL (source_id);
