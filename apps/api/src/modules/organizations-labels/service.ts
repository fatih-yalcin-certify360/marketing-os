import type { CurrentUser, LabelReadiness, LabelSummary } from '@c360/contracts';
import { dataOrigin } from '@c360/contracts';
import type { Db } from '../../core/db/types.js';
import { AppError } from '../../core/errors/app-error.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import { LabelRepository } from './repository.js';

export class LabelService {
  constructor(private readonly repository = new LabelRepository()) {}

  /**
   * Lists only the labels the caller is a member of.
   *
   * The list is derived from the caller's memberships, so it is a projection of
   * their access rather than a full table read that is then filtered — there is
   * no query here that could return a label they cannot see.
   */
  async listAccessible(db: Db, user: CurrentUser): Promise<LabelSummary[]> {
    const roleByLabelId = new Map(user.memberships.map((m) => [m.labelId, m.role]));
    const records = await this.repository.findManyByIds(db, user.organizationId, [
      ...roleByLabelId.keys(),
    ]);

    const summaries: LabelSummary[] = [];
    for (const record of records) {
      const role = roleByLabelId.get(record.id);
      if (role === undefined) {
        continue;
      }
      const parsedOrigin = dataOrigin.safeParse(record.origin);
      summaries.push({
        id: record.id,
        slug: record.slug,
        name: record.name,
        origin: parsedOrigin.success ? parsedOrigin.data : 'user',
        role,
        isActive: record.isActive,
        createdAt: record.createdAt.toISOString(),
      });
    }
    return summaries;
  }

  async requireAccessible(db: Db, user: CurrentUser, labelId: string): Promise<LabelSummary> {
    requireLabelPermission(user, labelId, 'label:read');
    const record = await this.repository.findById(db, user.organizationId, labelId);
    if (record === undefined) {
      throw AppError.notFoundOrForbidden('label', labelId);
    }
    const membership = user.memberships.find((m) => m.labelId === labelId);
    if (membership === undefined) {
      throw AppError.notFoundOrForbidden('label', labelId);
    }
    const parsedOrigin = dataOrigin.safeParse(record.origin);
    return {
      id: record.id,
      slug: record.slug,
      name: record.name,
      origin: parsedOrigin.success ? parsedOrigin.data : 'user',
      role: membership.role,
      isActive: record.isActive,
      createdAt: record.createdAt.toISOString(),
    };
  }

  /**
   * Foundational-data readiness for a label.
   *
   * Phase 0 reports structural zeroes: the brand, course, persona and
   * content-asset tables arrive in Phase 1, so there is nothing to count yet.
   * They are returned as real zeroes rather than omitted so the Werkruimte can
   * render the same shape now and later, and so no card ever displays a number
   * that was invented.
   */
  async readiness(db: Db, user: CurrentUser, labelId: string): Promise<LabelReadiness> {
    await this.requireAccessible(db, user, labelId);
    return {
      labelId,
      hasApprovedBrandProfile: false,
      confirmedCourseCount: 0,
      unconfirmedCourseCount: 0,
      approvedPersonaCount: 0,
      activeCampaignCount: 0,
      assetsAwaitingReviewCount: 0,
      assetsNeedingRereviewCount: 0,
    };
  }
}
