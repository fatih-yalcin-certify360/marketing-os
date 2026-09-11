import { and, eq, sql } from 'drizzle-orm';
import type { LabelBudget } from '@c360/contracts';
import type { DbOrTx } from '../../core/db/types.js';
import { labelBudgets } from '../../core/db/schema.js';
import { AppError } from '../../core/errors/app-error.js';

/**
 * Per-label AI budget with reservations.
 *
 * The concurrency-critical property (requirement 15: "Maliyet limitinin
 * eşzamanlı isteklerde korunması") is achieved with a single conditional
 * UPDATE:
 *
 *   UPDATE ... SET reserved = reserved + n
 *   WHERE budget - spent - reserved >= n
 *
 * One statement means one row lock. Under READ COMMITTED, a second concurrent
 * transaction blocks on that lock and then **re-evaluates** the WHERE clause
 * against the committed row, so it cannot reserve against a stale balance.
 * A read-then-write pair in application code would not have this property.
 *
 * Reservations are held for queued *and* running jobs, so pending work counts
 * against the budget before it is spent.
 */

export interface BudgetPeriod {
  periodStart: string;
  periodEnd: string;
}

/** Monthly periods, computed in UTC to stay stable regardless of server locale. */
export function currentPeriod(now: Date = new Date()): BudgetPeriod {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart: toDateString(start), periodEnd: toDateString(end) };
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class BudgetService {
  constructor(private readonly defaultBudgetCents: number) {}

  /** Creates the period row if absent. Concurrency-safe via ON CONFLICT. */
  async ensurePeriod(
    db: DbOrTx,
    organizationId: string,
    labelId: string,
    now = new Date(),
  ): Promise<BudgetPeriod> {
    const period = currentPeriod(now);
    await db
      .insert(labelBudgets)
      .values({
        organizationId,
        labelId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        budgetCents: this.defaultBudgetCents,
      })
      .onConflictDoNothing({ target: [labelBudgets.labelId, labelBudgets.periodStart] });
    return period;
  }

  /**
   * Holds `amountCents` against the label's remaining budget.
   *
   * @throws AppError('budget_exceeded') when the reservation would exceed it.
   *   The caller surfaces this to the user for explicit confirmation rather
   *   than proceeding — requirement 12: "Limit aşımı öncesi kullanıcı onayı".
   */
  async reserve(
    db: DbOrTx,
    organizationId: string,
    labelId: string,
    amountCents: number,
    now = new Date(),
  ): Promise<void> {
    if (amountCents === 0) {
      return;
    }
    const period = await this.ensurePeriod(db, organizationId, labelId, now);

    const updated = await db
      .update(labelBudgets)
      .set({
        reservedCents: sql`${labelBudgets.reservedCents} + ${amountCents}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(labelBudgets.labelId, labelId),
          eq(labelBudgets.periodStart, period.periodStart),
          sql`${labelBudgets.budgetCents} - ${labelBudgets.spentCents} - ${labelBudgets.reservedCents} >= ${amountCents}`,
        ),
      )
      .returning({ id: labelBudgets.id });

    if (updated.length === 0) {
      throw new AppError('budget_exceeded', {
        publicMessage:
          'Het AI-budget van dit label is niet toereikend voor deze actie. Verhoog het budget of wacht op de volgende periode.',
        context: { labelId, amountCents },
      });
    }
  }

  /**
   * Releases a reservation and optionally commits actual spend.
   *
   * `GREATEST(0, ...)` is not cosmetic: it keeps the row valid against the
   * non-negative CHECK constraint if a reservation is ever settled twice, so a
   * double-settle degrades into a no-op rather than a constraint violation
   * that would fail the whole job-completion transaction.
   */
  async settle(
    db: DbOrTx,
    labelId: string,
    releaseCents: number,
    spendCents: number,
    now = new Date(),
  ): Promise<void> {
    if (releaseCents === 0 && spendCents === 0) {
      return;
    }
    const period = currentPeriod(now);
    await db
      .update(labelBudgets)
      .set({
        reservedCents: sql`GREATEST(0, ${labelBudgets.reservedCents} - ${releaseCents})`,
        spentCents: sql`${labelBudgets.spentCents} + ${spendCents}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(labelBudgets.labelId, labelId),
          eq(labelBudgets.periodStart, period.periodStart),
        ),
      );
  }

  async get(
    db: DbOrTx,
    organizationId: string,
    labelId: string,
    now = new Date(),
  ): Promise<LabelBudget> {
    const period = await this.ensurePeriod(db, organizationId, labelId, now);
    const rows = await db
      .select({
        labelId: labelBudgets.labelId,
        periodStart: labelBudgets.periodStart,
        periodEnd: labelBudgets.periodEnd,
        budgetCents: labelBudgets.budgetCents,
        spentCents: labelBudgets.spentCents,
        reservedCents: labelBudgets.reservedCents,
      })
      .from(labelBudgets)
      .where(
        and(eq(labelBudgets.labelId, labelId), eq(labelBudgets.periodStart, period.periodStart)),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      throw new AppError('internal_error', { internalDetail: 'budget period row missing' });
    }

    return {
      labelId: row.labelId,
      periodStart: `${row.periodStart}T00:00:00.000Z`,
      periodEnd: `${row.periodEnd}T00:00:00.000Z`,
      budgetCents: row.budgetCents,
      spentCents: row.spentCents,
      reservedCents: row.reservedCents,
      availableCents: Math.max(0, row.budgetCents - row.spentCents - row.reservedCents),
    };
  }
}
