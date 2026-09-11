import { and, eq, sql } from 'drizzle-orm';
import type { LabelRole, OrgRole } from '@c360/contracts';
import type { DbOrTx } from '../../core/db/types.js';
import { labels, memberships, organizations, users } from '../../core/db/schema.js';

export interface UserRecord {
  id: string;
  organizationId: string;
  organizationName: string;
  externalSubject: string;
  email: string;
  displayName: string;
  orgRole: OrgRole;
  isActive: boolean;
}

export interface MembershipRecord {
  labelId: string;
  labelSlug: string;
  labelName: string;
  role: LabelRole;
}

/**
 * Data access for identity. This module owns `organizations`, `users` and
 * `memberships`; no other module writes to them (requirement 3: modules must
 * not reach into each other's tables).
 */
export class IdentityRepository {
  async findUserBySubject(
    db: DbOrTx,
    organizationId: string,
    externalSubject: string,
  ): Promise<UserRecord | undefined> {
    const rows = await db
      .select({
        id: users.id,
        organizationId: users.organizationId,
        organizationName: organizations.name,
        externalSubject: users.externalSubject,
        email: users.email,
        displayName: users.displayName,
        orgRole: users.orgRole,
        isActive: users.isActive,
      })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .where(
        and(eq(users.organizationId, organizationId), eq(users.externalSubject, externalSubject)),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? undefined : (row as UserRecord);
  }

  /** Loads a user by primary key, for jobs that act on their behalf. */
  async findUserById(db: DbOrTx, userId: string): Promise<UserRecord | undefined> {
    const rows = await db
      .select({
        id: users.id,
        organizationId: users.organizationId,
        organizationName: organizations.name,
        externalSubject: users.externalSubject,
        email: users.email,
        displayName: users.displayName,
        orgRole: users.orgRole,
        isActive: users.isActive,
      })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .where(eq(users.id, userId))
      .limit(1);

    const row = rows[0];
    return row === undefined ? undefined : (row as UserRecord);
  }

  /**
   * Provisions or refreshes a user from the authenticated subject.
   *
   * `ON CONFLICT` on (organization_id, external_subject) makes this safe under
   * concurrent first requests from the same user, which is common right after
   * a deploy. Only directory-owned fields are refreshed — never `org_role`,
   * which is assigned inside the product and must not be overwritten by a
   * proxy header.
   */
  async upsertFromSubject(
    db: DbOrTx,
    input: {
      organizationId: string;
      externalSubject: string;
      email: string;
      displayName: string;
      authSource: 'local' | 'trusted-header';
    },
  ): Promise<UserRecord> {
    await db
      .insert(users)
      .values({
        organizationId: input.organizationId,
        externalSubject: input.externalSubject,
        email: input.email,
        displayName: input.displayName,
        authSource: input.authSource,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [users.organizationId, users.externalSubject],
        set: {
          email: sql`excluded.email`,
          displayName: sql`excluded.display_name`,
          lastSeenAt: sql`excluded.last_seen_at`,
          updatedAt: new Date(),
        },
      });

    const record = await this.findUserBySubject(db, input.organizationId, input.externalSubject);
    if (record === undefined) {
      throw new Error('User upsert did not yield a row');
    }
    return record;
  }

  /** Memberships are the sole source of label access. Inactive labels are omitted. */
  async listMemberships(db: DbOrTx, userId: string): Promise<MembershipRecord[]> {
    const rows = await db
      .select({
        labelId: labels.id,
        labelSlug: labels.slug,
        labelName: labels.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(labels, eq(labels.id, memberships.labelId))
      .where(and(eq(memberships.userId, userId), eq(labels.isActive, true)))
      .orderBy(labels.name);

    return rows as MembershipRecord[];
  }

  async findDefaultOrganizationId(db: DbOrTx): Promise<string | undefined> {
    const rows = await db
      .select({ id: organizations.id })
      .from(organizations)
      .orderBy(organizations.createdAt)
      .limit(1);
    return rows[0]?.id;
  }
}
