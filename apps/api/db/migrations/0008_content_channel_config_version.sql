-- 0008_content_channel_config_version
--
-- Records which channel-specification version a content asset was made
-- against.
--
-- P2-2 asks that "the config is versioned and content records which version it
-- met". The config carried a version; nothing on the content did — so the
-- second half was unmet, and it showed the moment Facebook's limits were
-- sourced: a stored warning said "cannot be exported publish-ready" while the
-- export, reading the current config, no longer blocked on it. The interface
-- and the gate disagreed.
--
-- With the version recorded, the row says what it was judged against, and the
-- operative warnings can be recomputed from the current config on every read.
-- History stays answerable; the user never sees a verdict the export does not
-- apply.
--
-- The default is 1 rather than the current version: existing rows were made
-- before this column existed, and claiming they met version 3 would be a
-- fabricated provenance.

ALTER TABLE content_asset_versions
  ADD COLUMN channel_config_version integer NOT NULL DEFAULT 1;

ALTER TABLE content_asset_versions
  ADD CONSTRAINT content_asset_channel_config_version_positive
    CHECK (channel_config_version > 0);
