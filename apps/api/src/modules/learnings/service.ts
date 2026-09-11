import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  summariseEvidence,
  type CurrentUser,
  type Learning,
  type LearningInput,
  type LearningWithEvidence,
} from '@c360/contracts';
import type { Db } from '../../core/db/types.js';
import { learningEvidence, learnings, outcomeReports } from '../../core/db/schema.js';
import { AppError } from '../../core/errors/app-error.js';
import { requireLabelPermission } from '../../core/authz/policy.js';

/**
 * Learnings: a person's conclusion, approved before it influences anything.
 *
 * The two constraints of P4-2 are both held here rather than hoped for:
 *
 *  - **No causality claims from thin data.** Nothing in this service computes a
 *    conclusion. It stores what a person wrote, records which measured
 *    outcomes it rests on, and reports how much that is — see
 *    `summariseEvidence`. A thin learning is not refused; it travels with the
 *    reason it is thin, all the way into the prompt.
 *  - **No automatic persona or brand changes.** This module imports neither the
 *    persona nor the brand schema and writes to neither table. Approving a
 *    learning changes exactly one row: the learning's own review state. What it
 *    then affects is the *context* of a later proposal, which a person reviews
 *    like any other.
 */
/**
 * Turns approved learnings into the shape the prompt builder wants.
 *
 * One function rather than three call sites, because the evidence sentence is
 * the part that must not drift: if one proposal step describes thin evidence
 * and another omits it, the model is told the same hypothesis with two
 * different weights. It is also the sentence a reviewer will look for when
 * asking why a proposal leaned the way it did.
 */
export function learningsForPrompt(
  items: readonly LearningWithEvidence[],
): { observationNl: string; hypothesisNl: string; evidenceNl: string }[] {
  return items.map(({ learning, evidence }) => ({
    observationNl: learning.observationNl,
    hypothesisNl: learning.hypothesisNl,
    evidenceNl: evidence.isThin
      ? `Dun onderbouwd. ${evidence.reasonsNl.join(' ')}`
      : `${String(evidence.outcomeCount)} metingen uit ${String(evidence.campaignCount)} campagnes over ${String(evidence.periodDays)} dagen.`,
  }));
}

export class LearningService {
  /**
   * Records a learning as a draft.
   *
   * Draft on purpose: nothing a person has just typed should influence the
   * next proposal before anyone else has read it.
   */
  async create(
    db: Db,
    user: CurrentUser,
    labelId: string,
    input: LearningInput,
  ): Promise<Learning> {
    requireLabelPermission(user, labelId, 'outcome:write');

    /*
     * Every cited outcome must belong to this label.
     *
     * Checked as a set rather than one at a time so a partially valid list is
     * refused whole: a learning resting on three outcomes of which one belongs
     * elsewhere is not "mostly right", it is a claim about data we cannot see.
     */
    if (input.outcomeReportIds.length > 0) {
      const found = await db
        .select({ id: outcomeReports.id })
        .from(outcomeReports)
        .where(
          and(
            eq(outcomeReports.labelId, labelId),
            inArray(outcomeReports.id, [...new Set(input.outcomeReportIds)]),
          ),
        );
      if (found.length !== new Set(input.outcomeReportIds).size) {
        throw AppError.notFoundOrForbidden('outcome', input.outcomeReportIds.join(', '));
      }
    }

    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(learnings)
        .values({
          organizationId: user.organizationId,
          labelId,
          originCampaignId: input.originCampaignId,
          observationNl: input.observationNl,
          hypothesisNl: input.hypothesisNl,
          nextTestNl: input.nextTestNl,
          reviewState: 'draft',
          createdByUserId: user.userId,
        })
        .returning();

      const row = inserted[0];
      if (row === undefined) {
        throw new AppError('internal_error', { internalDetail: 'learning insert yielded no row' });
      }

      const ids = [...new Set(input.outcomeReportIds)];
      if (ids.length > 0) {
        await tx
          .insert(learningEvidence)
          .values(ids.map((outcomeReportId) => ({ learningId: row.id, outcomeReportId })));
      }

      return toLearning(row);
    });
  }

  /**
   * Approves one learning, and only that.
   *
   * The single write is this row's review state. No persona is edited, no brand
   * rule is added, nothing is regenerated — an approved learning becomes
   * *context* for the next proposal, and a person still reviews that proposal.
   */
  async approve(db: Db, user: CurrentUser, labelId: string, learningId: string): Promise<Learning> {
    requireLabelPermission(user, labelId, 'outcome:write');

    const now = new Date();
    const updated = await db
      .update(learnings)
      .set({ reviewState: 'approved', approvedAt: now, approvedByUserId: user.userId, updatedAt: now })
      .where(and(eq(learnings.id, learningId), eq(learnings.labelId, labelId)))
      .returning();

    const row = updated[0];
    if (row === undefined) {
      throw AppError.notFoundOrForbidden('learning', learningId);
    }
    return toLearning(row);
  }

  async list(db: Db, user: CurrentUser, labelId: string): Promise<LearningWithEvidence[]> {
    requireLabelPermission(user, labelId, 'outcome:read');

    const rows = await db
      .select()
      .from(learnings)
      .where(eq(learnings.labelId, labelId))
      .orderBy(desc(learnings.createdAt));

    return Promise.all(
      rows.map(async (row) => ({
        learning: toLearning(row),
        evidence: await this.evidenceFor(db, row.id),
      })),
    );
  }

  /**
   * The approved learnings a later proposal may be told about.
   *
   * `review_state = 'approved'` is the filter, and it is the whole gate: a
   * draft learning influences nothing. Each one carries its evidence summary,
   * because the size of what is behind a claim has to travel with the claim —
   * a model told "video works better" without being told it rests on one
   * fortnight will treat it as settled.
   */
  async approvedForPrompt(db: Db, labelId: string): Promise<LearningWithEvidence[]> {
    const rows = await db
      .select()
      .from(learnings)
      .where(and(eq(learnings.labelId, labelId), eq(learnings.reviewState, 'approved')))
      .orderBy(desc(learnings.approvedAt))
      // Bounded: the prompt is a budget, and the ten most recently approved
      // learnings are the ones a proposal can actually act on.
      .limit(10);

    return Promise.all(
      rows.map(async (row) => ({
        learning: toLearning(row),
        evidence: await this.evidenceFor(db, row.id),
      })),
    );
  }

  private async evidenceFor(db: Db, learningId: string) {
    const rows = await db
      .select({
        campaignId: outcomeReports.campaignId,
        periodStart: outcomeReports.periodStart,
        periodEnd: outcomeReports.periodEnd,
      })
      .from(learningEvidence)
      .innerJoin(outcomeReports, eq(outcomeReports.id, learningEvidence.outcomeReportId))
      .where(eq(learningEvidence.learningId, learningId));

    return summariseEvidence({ outcomes: rows });
  }
}

interface LearningRow {
  id: string;
  labelId: string;
  originCampaignId: string | null;
  observationNl: string;
  hypothesisNl: string;
  nextTestNl: string;
  reviewState: string;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}

function toLearning(row: LearningRow): Learning {
  return {
    id: row.id,
    labelId: row.labelId,
    originCampaignId: row.originCampaignId,
    observationNl: row.observationNl,
    hypothesisNl: row.hypothesisNl,
    nextTestNl: row.nextTestNl,
    reviewState: row.reviewState as Learning['reviewState'],
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedByUserId: row.approvedByUserId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}
