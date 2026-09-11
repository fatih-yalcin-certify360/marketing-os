import { z } from 'zod';

/**
 * Authorisation model.
 *
 * Two scopes exist and they are deliberately not interchangeable:
 *  - organisation-scoped roles govern org-wide administration;
 *  - label-scoped roles govern everything inside one label.
 *
 * A user has one membership row per (organisation, label?) pair. Access to a
 * label is granted **only** by a membership row for that label — never by an
 * org role alone, except for the explicit org administration permissions
 * listed in `ORG_ROLE_PERMISSIONS`.
 *
 * This table is the single source of truth and is evaluated server-side only.
 * Role or label claims arriving from the client are ignored; see
 * docs/security/access-matrix.md.
 */

export const orgRole = z.enum(['org_owner', 'org_admin', 'org_member']);
export type OrgRole = z.infer<typeof orgRole>;

export const labelRole = z.enum([
  /** Runs a label end to end, including brand and course truth. */
  'label_manager',
  /** Creates and edits, may request review, may not approve. */
  'label_editor',
  /** Reviews and approves content versions. */
  'label_approver',
  /** Read-only. */
  'label_viewer',
]);
export type LabelRole = z.infer<typeof labelRole>;

export const permission = z.enum([
  // organisations & labels
  'org:read',
  'org:manage',
  'member:read',
  'member:manage',
  'label:read',
  'label:manage',
  // brand & course truth
  'brand:read',
  'brand:write',
  'brand:approve',
  'course:read',
  'course:write',
  'course:approve',
  // research & personas
  'source:read',
  'source:write',
  'research:read',
  'research:run',
  'persona:read',
  'persona:write',
  'persona:approve',
  // campaign chain
  'opportunity:read',
  'opportunity:write',
  'campaign:read',
  'campaign:write',
  'brief:read',
  'brief:write',
  'brief:approve',
  'concept:read',
  'concept:write',
  'content:read',
  'content:write',
  'content:approve',
  // downstream
  'export:read',
  'export:create_draft',
  /** Separate from `export:create_draft` on purpose: a publish-ready package
   *  asserts that every gate passed, so it is a distinct privilege. */
  'export:create_publish_ready',
  'publication:record',
  'outcome:read',
  'outcome:write',
  'learning:read',
  'learning:approve',
  // platform
  'job:read',
  'job:cancel',
  'job:retry',
  'usage:read',
  'budget:manage',
  'audit:read',
]);
export type Permission = z.infer<typeof permission>;

const READ_ONLY: readonly Permission[] = [
  'label:read',
  'brand:read',
  'course:read',
  'source:read',
  'research:read',
  'persona:read',
  'opportunity:read',
  'campaign:read',
  'brief:read',
  'concept:read',
  'content:read',
  'export:read',
  'outcome:read',
  'learning:read',
  'job:read',
];

const EDITOR: readonly Permission[] = [
  ...READ_ONLY,
  'source:write',
  'research:run',
  'persona:write',
  'opportunity:write',
  'campaign:write',
  'brief:write',
  'concept:write',
  'content:write',
  'export:create_draft',
  'publication:record',
  'outcome:write',
  'job:cancel',
  'job:retry',
];

const APPROVER: readonly Permission[] = [
  ...READ_ONLY,
  'brand:approve',
  'course:approve',
  'persona:approve',
  'brief:approve',
  'content:approve',
  'export:create_draft',
  'export:create_publish_ready',
  'learning:approve',
];

const MANAGER: readonly Permission[] = [
  ...EDITOR,
  ...APPROVER,
  'label:manage',
  'brand:write',
  'course:write',
  'member:read',
  'usage:read',
  'budget:manage',
  'audit:read',
];

function frozenSet(permissions: readonly Permission[]): ReadonlySet<Permission> {
  return Object.freeze(new Set(permissions));
}

/** Permissions granted by a label-scoped role, within that label only. */
export const LABEL_ROLE_PERMISSIONS: Readonly<Record<LabelRole, ReadonlySet<Permission>>> =
  Object.freeze({
    label_manager: frozenSet(MANAGER),
    label_editor: frozenSet(EDITOR),
    label_approver: frozenSet(APPROVER),
    label_viewer: frozenSet(READ_ONLY),
  });

/**
 * Permissions granted by an organisation-scoped role. Note what is absent:
 * no org role grants read access to a label's campaigns or content. Reading
 * label data always requires a label membership, so an org admin cannot
 * quietly read another label's material.
 */
export const ORG_ROLE_PERMISSIONS: Readonly<Record<OrgRole, ReadonlySet<Permission>>> =
  Object.freeze({
    org_owner: frozenSet([
      'org:read',
      'org:manage',
      'member:read',
      'member:manage',
      'label:read',
      'label:manage',
      'usage:read',
      'budget:manage',
      'audit:read',
    ]),
    org_admin: frozenSet([
      'org:read',
      'member:read',
      'member:manage',
      'label:read',
      'usage:read',
      'audit:read',
    ]),
    org_member: frozenSet(['org:read']),
  });

/** Roles that may act as an approver, used to validate approver assignment. */
export const APPROVER_ROLES: readonly LabelRole[] = Object.freeze([
  'label_approver',
  'label_manager',
]);

export const membership = z.object({
  labelId: z.uuid(),
  labelSlug: z.string(),
  labelName: z.string(),
  role: labelRole,
});
export type Membership = z.infer<typeof membership>;

export const currentUser = z.object({
  userId: z.uuid(),
  organizationId: z.uuid(),
  organizationName: z.string(),
  displayName: z.string(),
  email: z.string(),
  orgRole,
  memberships: z.array(membership),
  /** Which identity adapter authenticated this request. Surfaced so the UI can
   *  show unmistakably that a local development identity is in use. */
  authMode: z.enum(['local', 'trusted-header']),
  /** Permissions valid without a label context (org administration only). */
  orgPermissions: z.array(permission),
});
export type CurrentUser = z.infer<typeof currentUser>;
