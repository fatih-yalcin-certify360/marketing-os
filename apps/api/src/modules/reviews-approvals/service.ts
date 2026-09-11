import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  APPROVABLE_LABEL_NL,
  type Approval,
  type ApprovableArtefact,
  type CurrentUser,
  type Permission,
  type ReviewState,
} from '@c360/contracts';
import type { Db, DbOrTx } from '../../core/db/types.js';
import { approvals } from '../../core/db/schema.js';
import { AppError } from '../../core/errors/app-error.js';
import { requireLabelPermission } from '../../core/authz/policy.js';

/**
 * Approvals.
 *
 * One mechanism for every reviewable artefact, because the rule is identical
 * everywhere: **an approval is bound to one exact version.** The unique
 * constraint on (artefact_type, artefact_id, artefact_version) plus append-only
 * version tables mean a new version is unapproved by construction — no flag has
 * to be cleared, so none can be forgotten (ADR-0012).
 *
 * This module owns the `approvals` table and nothing else. Domain modules ask
 * it whether a version is approved; they never write approvals themselves.
 */

/** Which permission approving each artefact requires. */
const APPROVE_PERMISSION: Readonly<Record<ApprovableArtefact, Permission>> = Object.freeze({
  brand_profile: 'brand:approve',
  course: 'course:approve',
  persona: 'persona:approve',
  brief: 'brief:approve',
  concept: 'content:approve',
  content_asset: 'content:approve',
  content_plan: 'content:approve',
});

export interface ApprovalRow {
  id: string;
  labelId: string;
  artefactType: string;
  artefactId: string;
  artefactVersion: number;
  approvedByUserId: string;
  approvedAt: Date;
  noteNl: string | null;
}

export class ApprovalService {
  /**
   * Records an approval for one specific version.
   *
   * Idempotent: approving the same version twice returns the existing row
   * rather than creating a second, which would make "who approved this"
   * ambiguous.
   */
  async approve(
    db: DbOrTx,
    user: CurrentUser,
    input: {
      labelId: string;
      artefactType: ApprovableArtefact;
      artefactId: string;
      artefactVersion: number;
      noteNl?: string | null;
    },
  ): Promise<Approval> {
    requireLabelPermission(user, input.labelId, APPROVE_PERMISSION[input.artefactType]);

    const inserted = await db
      .insert(approvals)
      .values({
        organizationId: user.organizationId,
        labelId: input.labelId,
        artefactType: input.artefactType,
        artefactId: input.artefactId,
        artefactVersion: input.artefactVersion,
        approvedByUserId: user.userId,
        noteNl: input.noteNl ?? null,
      })
      .onConflictDoNothing({
        target: [approvals.artefactType, approvals.artefactId, approvals.artefactVersion],
      })
      .returning();

    const row = inserted[0] ?? (await this.find(db, input.artefactType, input.artefactId, input.artefactVersion));
    if (row === undefined) {
      throw new AppError('internal_error', { internalDetail: 'approval insert yielded no row' });
    }
    return toApproval(row);
  }

  async find(
    db: DbOrTx,
    artefactType: ApprovableArtefact,
    artefactId: string,
    artefactVersion: number,
  ): Promise<ApprovalRow | undefined> {
    const rows = await db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.artefactType, artefactType),
          eq(approvals.artefactId, artefactId),
          eq(approvals.artefactVersion, artefactVersion),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /** True only for this exact version. A later version is not covered. */
  async isApproved(
    db: DbOrTx,
    artefactType: ApprovableArtefact,
    artefactId: string,
    artefactVersion: number,
  ): Promise<boolean> {
    return (await this.find(db, artefactType, artefactId, artefactVersion)) !== undefined;
  }

  /** Approvals for a set of artefact ids, for list screens. */
  async findManyFor(
    db: DbOrTx,
    artefactType: ApprovableArtefact,
    artefactIds: readonly string[],
  ): Promise<Map<string, ApprovalRow>> {
    if (artefactIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.artefactType, artefactType),
          inArray(approvals.artefactId, [...artefactIds]),
        ),
      );
    return new Map(rows.map((row) => [row.artefactId, row]));
  }

  async recentForLabel(db: Db, user: CurrentUser, labelId: string, limit: number): Promise<Approval[]> {
    requireLabelPermission(user, labelId, 'content:read');
    const rows = await db
      .select()
      .from(approvals)
      .where(eq(approvals.labelId, labelId))
      .orderBy(desc(approvals.approvedAt))
      .limit(limit);
    return rows.map(toApproval);
  }

  /**
   * The Dutch reason a version is not approved, for display.
   *
   * Distinguishes "never approved" from "was approved, then a dependency
   * changed" — a distinction the user needs in order to know whether to review
   * or to re-review.
   */
  static notApprovedReasonNl(
    artefactType: ApprovableArtefact,
    reviewState: ReviewState,
  ): string {
    const label = APPROVABLE_LABEL_NL[artefactType];
    switch (reviewState) {
      case 'needs_rereview':
        return `${label}: een onderliggende bron is gewijzigd. Beoordeel deze versie opnieuw.`;
      case 'changes_requested':
        return `${label}: er zijn wijzigingen gevraagd.`;
      case 'in_review':
        return `${label}: ligt ter beoordeling.`;
      case 'archived':
        return `${label}: deze versie is gearchiveerd.`;
      case 'draft':
      case 'approved':
      default:
        return `${label}: nog niet goedgekeurd.`;
    }
  }
}

function toApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    labelId: row.labelId,
    artefactType: row.artefactType as ApprovableArtefact,
    artefactId: row.artefactId,
    artefactVersion: row.artefactVersion,
    approvedByUserId: row.approvedByUserId,
    approvedAt: row.approvedAt.toISOString(),
    noteNl: row.noteNl,
  };
}
