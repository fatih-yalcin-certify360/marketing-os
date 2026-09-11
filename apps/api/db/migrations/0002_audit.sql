-- 0002_audit
--
-- Security audit trail, kept deliberately separate from application/content
-- logging (requirement 13: "Güvenlik audit kayıtlarını içerik loglarından
-- ayır"). This table records *who attempted what and whether it was allowed*.
-- It must never contain prompt text, document contents, tokens or raw IPs.
--
-- `metadata` is a bounded JSONB field for a handful of identifiers only; the
-- application enforces a size limit before writing.

CREATE TABLE audit_events (
  id              bigserial   PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  label_id        uuid        REFERENCES labels (id) ON DELETE SET NULL,
  actor_kind      text        NOT NULL,
  actor_user_id   uuid        REFERENCES users (id) ON DELETE SET NULL,
  action          text        NOT NULL,
  resource_type   text        NOT NULL,
  resource_id     text,
  outcome         text        NOT NULL,
  -- Reason code for a denial, e.g. 'missing_permission', 'label_not_member'.
  reason          text,
  request_id      text,
  -- Salted hash of the client address. Enough to correlate abuse, not enough
  -- to be a stored personal identifier.
  ip_hash         text,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_actor_kind_valid CHECK (actor_kind IN ('user', 'system', 'worker')),
  CONSTRAINT audit_outcome_valid CHECK (outcome IN ('allowed', 'denied', 'error')),
  CONSTRAINT audit_metadata_is_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX audit_events_org_created_idx ON audit_events (organization_id, created_at DESC);
CREATE INDEX audit_events_label_created_idx ON audit_events (label_id, created_at DESC)
  WHERE label_id IS NOT NULL;
CREATE INDEX audit_events_actor_created_idx ON audit_events (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
-- Supports "show me every denial in the last day" without scanning the table.
CREATE INDEX audit_events_denied_idx ON audit_events (organization_id, created_at DESC)
  WHERE outcome = 'denied';
