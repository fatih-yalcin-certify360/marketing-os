import {
  LABEL_ROLE_PERMISSIONS,
  ORG_ROLE_PERMISSIONS,
  type CurrentUser,
  type LabelRole,
  type OrgRole,
  type Permission,
} from '@c360/contracts';
import { AppError } from '../errors/app-error.js';

/**
 * Deny-by-default authorisation.
 *
 * Every decision is a pure function of (a) the user's persisted memberships and
 * (b) the static matrix in `@c360/contracts`. Nothing here reads a request
 * header, body or query parameter, which is what makes it impossible for a
 * client to nominate its own role or label set.
 *
 * Two distinct questions are kept separate on purpose:
 *  - `requireOrgPermission` — org administration, no label context;
 *  - `requireLabelPermission` — everything inside a label, and it fails unless
 *    the user holds a membership row for *that* label.
 */

export interface AuthorizationDecision {
  allowed: boolean;
  /** Machine-readable reason, recorded in the audit trail on denial. */
  reason:
    | 'granted'
    | 'missing_permission'
    | 'not_label_member'
    | 'label_inactive'
    | 'user_inactive';
}

export function orgPermissionsFor(role: OrgRole): ReadonlySet<Permission> {
  return ORG_ROLE_PERMISSIONS[role];
}

export function labelPermissionsFor(role: LabelRole): ReadonlySet<Permission> {
  return LABEL_ROLE_PERMISSIONS[role];
}

export function evaluateOrgPermission(
  user: Pick<CurrentUser, 'orgRole'>,
  permission: Permission,
): AuthorizationDecision {
  return orgPermissionsFor(user.orgRole).has(permission)
    ? { allowed: true, reason: 'granted' }
    : { allowed: false, reason: 'missing_permission' };
}

/**
 * A label decision never falls back to the org role. An org admin who is not a
 * member of a label gets `not_label_member`, so administration privilege does
 * not leak into another label's content.
 */
export function evaluateLabelPermission(
  user: Pick<CurrentUser, 'memberships'>,
  labelId: string,
  permission: Permission,
): AuthorizationDecision {
  const membership = user.memberships.find((entry) => entry.labelId === labelId);
  if (membership === undefined) {
    return { allowed: false, reason: 'not_label_member' };
  }
  return labelPermissionsFor(membership.role).has(permission)
    ? { allowed: true, reason: 'granted' }
    : { allowed: false, reason: 'missing_permission' };
}

export function requireOrgPermission(
  user: Pick<CurrentUser, 'orgRole'>,
  permission: Permission,
): void {
  const decision = evaluateOrgPermission(user, permission);
  if (!decision.allowed) {
    throw AppError.forbidden(decision.reason, { permission });
  }
}

/**
 * Throws `not_found` rather than `forbidden` when the caller is not a member of
 * the label. Distinguishing the two would let an attacker enumerate which label
 * ids exist — the BOLA channel called out in requirement 13.
 */
export function requireLabelPermission(
  user: Pick<CurrentUser, 'memberships'>,
  labelId: string,
  permission: Permission,
): void {
  const decision = evaluateLabelPermission(user, labelId, permission);
  if (decision.allowed) {
    return;
  }
  if (decision.reason === 'not_label_member') {
    throw AppError.notFoundOrForbidden('label', labelId);
  }
  throw AppError.forbidden(decision.reason, { permission, labelId });
}

/** All permissions a user currently holds in one label. Used to drive the UI. */
export function effectiveLabelPermissions(
  user: Pick<CurrentUser, 'memberships'>,
  labelId: string,
): Permission[] {
  const membership = user.memberships.find((entry) => entry.labelId === labelId);
  return membership === undefined ? [] : [...labelPermissionsFor(membership.role)];
}
