import { and, asc, eq, sql } from 'drizzle-orm';
import {
  labelRole,
  type CurrentUser,
  type LabelRole,
  type OrgRole,
} from '@c360/contracts';
import { requireLabelPermission, requireOrgPermission } from '../../core/authz/policy.js';
import { labels, memberships, users } from '../../core/db/schema.js';
import type { Db, DbOrTx } from '../../core/db/types.js';
import { AppError } from '../../core/errors/app-error.js';
import type { AuditService } from '../audit/service.js';

/**
 * Who may work on which label.
 *
 * Replaces seed-only membership management. Four rules shape it, and each one
 * follows from the access matrix rather than from taste:
 *
 *  - **Granting access is an organisation-level act.** `member:manage` is held
 *    by `org_owner` and `org_admin` only. A `label_manager` has `member:read`
 *    — they can see who works on their label and cannot widen it. Otherwise a
 *    label manager could grant themselves a second label, which would make the
 *    label boundary self-serve.
 *  - **Reading the list is label-scoped.** `member:read` within the label, so a
 *    manager sees their own team without seeing the whole organisation.
 *  - **A change takes effect on the actor's next request.** Nothing is cached:
 *    `resolveCurrentUser` reads memberships from the database every request, so
 *    a revoked membership stops working immediately rather than at the end of a
 *    session. That is a property of the identity design, and it is asserted
 *    here because it is the reason this module needs no invalidation step.
 *  - **A label always keeps someone accountable.** Removing or demoting the
 *    last `label_manager` is refused. Requirement 6 puts a person behind the
 *    correctness of course conditions, price and dates, and confirming a course
 *    fact needs `course:write` — which only a manager has. A label with no
 *    manager is a label whose facts can never be confirmed again.
 *
 * Every change is audited, with the role before and after.
 */

export interface MemberRow {
  userId: string;
  displayName: string;
  /** Work e-mail. Shown because a name alone does not identify a colleague. */
  email: string;
  orgRole: OrgRole;
  role: LabelRole;
  isActive: boolean;
  createdAt: string;
}

export interface CandidateRow {
  userId: string;
  displayName: string;
  email: string;
  orgRole: OrgRole;
  isActive: boolean;
  /** Labels this person already works on, so the UI need not ask twice. */
  labelCount: number;
}

export class MembersService {
  constructor(private readonly audit: AuditService) {}

  /** Everyone working on one label. */
  async listForLabel(db: DbOrTx, user: CurrentUser, labelId: string): Promise<MemberRow[]> {
    requireLabelPermission(user, labelId, 'member:read');

    const rows = await db
      .select({
        userId: users.id,
        displayName: users.displayName,
        email: users.email,
        orgRole: users.orgRole,
        role: memberships.role,
        isActive: users.isActive,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.labelId, labelId))
      .orderBy(asc(users.displayName))
      .limit(200);

    return rows.map((row) => ({
      userId: row.userId,
      displayName: row.displayName,
      email: row.email,
      orgRole: row.orgRole as OrgRole,
      role: row.role as LabelRole,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * People who could be added to a label.
   *
   * Organisation-scoped, so it needs `member:manage` rather than a label
   * membership: listing everyone in the organisation is exactly the thing a
   * label manager should not be able to do.
   */
  /**
   * The label must belong to the caller's organisation.
   *
   * `member:manage` is an **organisation** permission, deliberately: a
   * brand-new label has no members, so requiring membership to manage members
   * would make a new label unmanageable by anyone. An org administrator
   * therefore administers every label in their organisation, and seeing the
   * candidate list for a label they are not a member of is inside that
   * authority rather than a leak.
   *
   * What was missing is the boundary of that authority. The label id arrived
   * from the client and was used in a subquery without checking whose it was,
   * so an id belonging to another organisation answered 200 — and the
   * *absence* of a user from the candidate list is itself information about
   * that label's membership. This makes the authority explicit and stops at
   * the organisation.
   *
   * Found by `surface-authz.test.ts` walking the route table (P4-6).
   */
  private async requireLabelInOrganisation(
    db: DbOrTx,
    user: CurrentUser,
    labelId: string,
  ): Promise<void> {
    const rows = await db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.id, labelId), eq(labels.organizationId, user.organizationId)))
      .limit(1);
    if (rows[0] === undefined) {
      // Absent and not-yours read the same, as everywhere else.
      throw AppError.notFoundOrForbidden('label', labelId);
    }
  }

  async listCandidates(db: DbOrTx, user: CurrentUser, labelId: string): Promise<CandidateRow[]> {
    requireOrgPermission(user, 'member:manage');
    await this.requireLabelInOrganisation(db, user, labelId);

    const existing = db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.labelId, labelId));

    const rows = await db
      .select({
        userId: users.id,
        displayName: users.displayName,
        email: users.email,
        orgRole: users.orgRole,
        isActive: users.isActive,
        labelCount: sql<number>`(
          SELECT count(*)::int FROM ${memberships} AS m WHERE m.user_id = ${users.id}
        )`,
      })
      .from(users)
      .where(
        and(
          eq(users.organizationId, user.organizationId),
          eq(users.isActive, true),
          sql`${users.id} NOT IN ${existing}`,
        ),
      )
      .orderBy(asc(users.displayName))
      .limit(200);

    return rows.map((row) => ({
      userId: row.userId,
      displayName: row.displayName,
      email: row.email,
      orgRole: row.orgRole as OrgRole,
      isActive: row.isActive,
      labelCount: Number(row.labelCount),
    }));
  }

  /**
   * Grants or changes a label role.
   *
   * One method for both, because "add" and "change" differ only in whether a
   * row existed — and treating them separately invites a caller to add where it
   * meant to change, silently creating a second membership.
   */
  async setRole(
    db: Db,
    actor: CurrentUser,
    input: {
      labelId: string;
      userId: string;
      role: LabelRole;
      requestId?: string | undefined;
      clientAddress?: string | undefined;
    },
  ): Promise<MemberRow> {
    requireOrgPermission(actor, 'member:manage');
    const role = labelRole.parse(input.role);

    return db.transaction(async (tx) => {
      const label = await tx
        .select({ id: labels.id })
        .from(labels)
        .where(and(eq(labels.id, input.labelId), eq(labels.organizationId, actor.organizationId)))
        .limit(1);
      if (label[0] === undefined) {
        throw AppError.notFoundOrForbidden('label', input.labelId);
      }

      // The composite foreign key would refuse a cross-organisation membership
      // anyway; checking here turns a constraint violation into a clear answer.
      const target = await tx
        .select({ id: users.id, displayName: users.displayName, email: users.email, orgRole: users.orgRole, isActive: users.isActive })
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.organizationId, actor.organizationId)))
        .limit(1);
      const person = target[0];
      if (person === undefined) {
        throw AppError.notFoundOrForbidden('user', input.userId);
      }

      const before = await tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.labelId, input.labelId), eq(memberships.userId, input.userId)))
        .limit(1);
      const previousRole = before[0]?.role as LabelRole | undefined;

      if (previousRole === 'label_manager' && role !== 'label_manager') {
        await this.assertNotLastManager(tx, input.labelId, input.userId);
      }

      const now = new Date();
      const upserted = await tx
        .insert(memberships)
        .values({
          organizationId: actor.organizationId,
          userId: input.userId,
          labelId: input.labelId,
          role,
        })
        .onConflictDoUpdate({
          target: [memberships.userId, memberships.labelId],
          set: { role, updatedAt: now },
        })
        .returning({ createdAt: memberships.createdAt });

      await this.audit.record(tx, {
        organizationId: actor.organizationId,
        labelId: input.labelId,
        actorKind: 'user',
        actorUserId: actor.userId,
        action: previousRole === undefined ? 'membership.granted' : 'membership.changed',
        resourceType: 'membership',
        resourceId: input.userId,
        outcome: 'allowed',
        // The role before and after, which is the whole point of the record:
        // "who could do what, when" has to be answerable afterwards.
        metadata: { role, ...(previousRole === undefined ? {} : { previousRole }) },
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
        ...(input.clientAddress === undefined ? {} : { clientAddress: input.clientAddress }),
      });

      return {
        userId: person.id,
        displayName: person.displayName,
        email: person.email,
        orgRole: person.orgRole as OrgRole,
        role,
        isActive: person.isActive,
        createdAt: (upserted[0]?.createdAt ?? now).toISOString(),
      };
    });
  }

  /** Revokes a label membership. */
  async revoke(
    db: Db,
    actor: CurrentUser,
    input: {
      labelId: string;
      userId: string;
      requestId?: string | undefined;
      clientAddress?: string | undefined;
    },
  ): Promise<{ revoked: true }> {
    requireOrgPermission(actor, 'member:manage');

    return db.transaction(async (tx) => {
      const before = await tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(
            eq(memberships.labelId, input.labelId),
            eq(memberships.userId, input.userId),
            eq(memberships.organizationId, actor.organizationId),
          ),
        )
        .limit(1);

      const previousRole = before[0]?.role as LabelRole | undefined;
      if (previousRole === undefined) {
        // Not "forbidden": confirming the pair exists elsewhere is the
        // enumeration channel this closes.
        throw AppError.notFoundOrForbidden('membership', input.userId);
      }

      if (previousRole === 'label_manager') {
        await this.assertNotLastManager(tx, input.labelId, input.userId);
      }

      await tx
        .delete(memberships)
        .where(and(eq(memberships.labelId, input.labelId), eq(memberships.userId, input.userId)));

      await this.audit.record(tx, {
        organizationId: actor.organizationId,
        labelId: input.labelId,
        actorKind: 'user',
        actorUserId: actor.userId,
        action: 'membership.revoked',
        resourceType: 'membership',
        resourceId: input.userId,
        outcome: 'allowed',
        metadata: { previousRole },
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
        ...(input.clientAddress === undefined ? {} : { clientAddress: input.clientAddress }),
      });

      return { revoked: true };
    });
  }

  /**
   * Refuses to leave a label without a manager.
   *
   * Confirming a course fact needs `course:write`, which only `label_manager`
   * grants. A label with no manager is a label whose price, dates and entry
   * conditions can never be confirmed again — and an unconfirmed fact blocks a
   * publish-ready export. So this is not tidiness; it is the accountability
   * requirement (§6) expressed as a constraint.
   */
  private async assertNotLastManager(
    tx: DbOrTx,
    labelId: string,
    userId: string,
  ): Promise<void> {
    const others = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.labelId, labelId), eq(memberships.role, 'label_manager')))
      .limit(50);

    const remaining = others.filter((row) => row.userId !== userId);
    if (remaining.length === 0) {
      throw new AppError('conflict', {
        publicMessage:
          'Dit label zou dan geen labelbeheerder meer hebben. Wijs eerst iemand anders als beheerder aan.',
        internalDetail: `removing the last label_manager of ${labelId}`,
        context: { labelId },
      });
    }
  }
}
