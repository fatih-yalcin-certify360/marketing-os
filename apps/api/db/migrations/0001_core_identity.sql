-- 0001_core_identity
--
-- Organisations, labels, users and memberships.
--
-- Tenant isolation is enforced declaratively, not only in application code:
-- `users` and `labels` both carry a UNIQUE (id, organization_id) key, and
-- `memberships` references both via a COMPOSITE foreign key that includes
-- organization_id. A membership therefore cannot join a user of one
-- organisation to a label of another, even if application code is wrong.
-- See docs/security/threat-model.md T-02 (cross-label access).

CREATE TABLE organizations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text        NOT NULL UNIQUE,
  name         text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE labels (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  slug            text        NOT NULL,
  name            text        NOT NULL,
  -- Provenance of the row itself. 'demo' rows are surfaced in the UI as Demo
  -- data and are never eligible for a publish-ready export.
  origin          text        NOT NULL DEFAULT 'user',
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT labels_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT labels_origin_valid CHECK (origin IN ('demo', 'user', 'extracted', 'external', 'ai_generated')),
  CONSTRAINT labels_org_slug_unique UNIQUE (organization_id, slug),
  -- Target for the composite foreign key from memberships.
  CONSTRAINT labels_id_org_unique UNIQUE (id, organization_id)
);

CREATE INDEX labels_organization_id_idx ON labels (organization_id) WHERE is_active;

CREATE TABLE users (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  -- Stable subject identifier supplied by the authenticating proxy (Entra ID
  -- object id in production). Never supplied by the browser.
  external_subject text       NOT NULL,
  email           text        NOT NULL,
  display_name    text        NOT NULL,
  org_role        text        NOT NULL DEFAULT 'org_member',
  -- Which identity adapter first created this row. A row created by the local
  -- development adapter is refused in production; see 0001 note and
  -- apps/api/src/core/auth/resolve.ts.
  auth_source     text        NOT NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  last_seen_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_org_role_valid CHECK (org_role IN ('org_owner', 'org_admin', 'org_member')),
  CONSTRAINT users_auth_source_valid CHECK (auth_source IN ('local', 'trusted-header')),
  CONSTRAINT users_subject_unique UNIQUE (organization_id, external_subject),
  CONSTRAINT users_id_org_unique UNIQUE (id, organization_id)
);

-- Case-insensitive uniqueness of e-mail within an organisation.
CREATE UNIQUE INDEX users_org_email_unique ON users (organization_id, lower(email));

CREATE TABLE memberships (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  user_id         uuid        NOT NULL,
  label_id        uuid        NOT NULL,
  role            text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_role_valid
    CHECK (role IN ('label_manager', 'label_editor', 'label_approver', 'label_viewer')),
  CONSTRAINT memberships_user_label_unique UNIQUE (user_id, label_id),
  -- The two guards that make cross-organisation membership impossible.
  CONSTRAINT memberships_user_fk
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT memberships_label_fk
    FOREIGN KEY (label_id, organization_id) REFERENCES labels (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX memberships_user_idx ON memberships (user_id);
CREATE INDEX memberships_label_idx ON memberships (label_id);
