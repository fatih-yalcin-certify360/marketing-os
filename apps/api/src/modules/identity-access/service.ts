import {
  ORG_ROLE_PERMISSIONS,
  type CurrentUser,
  type Membership,
  type OrgRole,
} from '@c360/contracts';
import type { Db } from '../../core/db/types.js';
import type { AuthenticatedSubject } from '../../core/auth/types.js';
import { AppError } from '../../core/errors/app-error.js';
import { IdentityRepository } from './repository.js';

export interface IdentityServiceOptions {
  /**
   * Organisation the caller belongs to.
   *
   * Phase 0 runs a single organisation, resolved from the database. When the
   * real Entra ID header contract arrives (Phase 5) this becomes a mapping
   * from a tenant/group claim, which is why it is a lookup rather than a
   * hard-coded constant.
   */
  resolveOrganizationId(db: Db): Promise<string | undefined>;
}

export class IdentityService {
  constructor(
    private readonly repository = new IdentityRepository(),
    private readonly options: IdentityServiceOptions = {
      resolveOrganizationId: (db) => new IdentityRepository().findDefaultOrganizationId(db),
    },
  ) {}

  /**
   * Rebuilds the authorisation context for a stored user id.
   *
   * Used by background jobs: a job must not inherit the permissions its
   * enqueuer had, because a membership can be revoked in between. Loading
   * fresh memberships here means a revoked user's queued work fails instead of
   * running with stale authority.
   */
  async resolveById(db: Db, userId: string): Promise<CurrentUser | undefined> {
    const record = await this.repository.findUserById(db, userId);
    if (record?.isActive !== true) {
      return undefined;
    }

    const membershipRecords = await this.repository.listMemberships(db, record.id);
    const orgRole: OrgRole = record.orgRole;

    return {
      userId: record.id,
      organizationId: record.organizationId,
      organizationName: record.organizationName,
      displayName: record.displayName,
      email: record.email,
      orgRole,
      memberships: membershipRecords.map((entry) => ({
        labelId: entry.labelId,
        labelSlug: entry.labelSlug,
        labelName: entry.labelName,
        role: entry.role,
      })),
      // A job acts on behalf of a user whose session is not present; the
      // adapter that originally authenticated them is recorded on the user row.
      authMode: 'trusted-header',
      orgPermissions: [...ORG_ROLE_PERMISSIONS[orgRole]],
    };
  }

  /**
   * Turns an authenticated subject into the full authorisation context.
   *
   * This is the *only* place a `CurrentUser` is built. Roles and memberships
   * come from the database every request — never from a header, a cookie or a
   * cached client claim — so revoking a membership takes effect immediately.
   */
  async resolveCurrentUser(db: Db, subject: AuthenticatedSubject): Promise<CurrentUser> {
    const organizationId = await this.options.resolveOrganizationId(db);
    if (organizationId === undefined) {
      throw new AppError('internal_error', {
        internalDetail: 'no organization row present; run db:seed',
      });
    }

    const user = await this.repository.upsertFromSubject(db, {
      organizationId,
      externalSubject: subject.externalSubject,
      email: subject.email,
      displayName: subject.displayName,
      authSource: subject.authMode,
    });

    if (!user.isActive) {
      throw AppError.forbidden('user_inactive');
    }

    const membershipRecords = await this.repository.listMemberships(db, user.id);
    const memberships: Membership[] = membershipRecords.map((record) => ({
      labelId: record.labelId,
      labelSlug: record.labelSlug,
      labelName: record.labelName,
      role: record.role,
    }));

    const orgRole: OrgRole = user.orgRole;

    return {
      userId: user.id,
      organizationId: user.organizationId,
      organizationName: user.organizationName,
      displayName: user.displayName,
      email: user.email,
      orgRole,
      memberships,
      authMode: subject.authMode,
      orgPermissions: [...ORG_ROLE_PERMISSIONS[orgRole]],
    };
  }
}
