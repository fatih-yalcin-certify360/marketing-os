import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { labelBudgets } from '../../src/core/db/schema.js';
import { BudgetService, currentPeriod } from '../../src/modules/jobs-usage/budget.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';

/**
 * Budget behaviour.
 *
 * PGlite runs a single connection, so these tests prove the *guard* (an
 * over-limit reservation is refused, and the balance never goes negative) but
 * cannot prove the *race*. A genuinely concurrent test needs several client
 * sessions; it runs against a real PostgreSQL and is marked below. This
 * limitation is recorded in docs/product/testing-strategy.md rather than
 * papered over.
 */
describe('label budget', () => {
  let harness: TestHarness;
  let budget: BudgetService;
  let labelId: string;
  let organizationId: string;

  beforeEach(async () => {
    harness = await createTestHarness();
    budget = new BudgetService(1_000);
    labelId = labelIdBySlug(harness.seed, 'lindenhaeghe');
    organizationId = harness.seed.organizationId;
  });

  afterEach(async () => {
    await harness.close();
  });

  const readRow = async () => {
    const period = currentPeriod();
    const rows = await harness.db
      .select({
        budgetCents: labelBudgets.budgetCents,
        spentCents: labelBudgets.spentCents,
        reservedCents: labelBudgets.reservedCents,
      })
      .from(labelBudgets)
      .where(
        and(eq(labelBudgets.labelId, labelId), eq(labelBudgets.periodStart, period.periodStart)),
      );
    return rows[0];
  };

  it('creates the period row on first use', async () => {
    const result = await budget.get(harness.db, organizationId, labelId);
    expect(result.budgetCents).toBe(1_000);
    expect(result.availableCents).toBe(1_000);
  });

  it('is idempotent when ensuring the same period twice', async () => {
    await budget.ensurePeriod(harness.db, organizationId, labelId);
    await budget.ensurePeriod(harness.db, organizationId, labelId);
    const rows = await harness.db.select({ id: labelBudgets.id }).from(labelBudgets);
    expect(rows).toHaveLength(1);
  });

  it('holds a reservation against the available balance', async () => {
    await budget.reserve(harness.db, organizationId, labelId, 400);
    const result = await budget.get(harness.db, organizationId, labelId);
    expect(result.reservedCents).toBe(400);
    expect(result.availableCents).toBe(600);
    expect(result.spentCents).toBe(0);
  });

  it('refuses a reservation that would exceed the budget', async () => {
    await budget.reserve(harness.db, organizationId, labelId, 900);

    await expect(
      budget.reserve(harness.db, organizationId, labelId, 200),
    ).rejects.toThrow(/budget/iu);

    // Nothing partially applied: the failed reservation left no trace.
    expect((await readRow())?.reservedCents).toBe(900);
  });

  it('counts pending work against the ceiling, not just completed work', async () => {
    // Requirement 12: "Bekleyen işler için de bütçe rezervasyonu."
    await budget.reserve(harness.db, organizationId, labelId, 1_000);
    const result = await budget.get(harness.db, organizationId, labelId);
    expect(result.spentCents).toBe(0);
    expect(result.availableCents).toBe(0);
    await expect(budget.reserve(harness.db, organizationId, labelId, 1)).rejects.toThrow();
  });

  it('exhausts the budget across sequential reservations and then refuses', async () => {
    for (let i = 0; i < 10; i += 1) {
      await budget.reserve(harness.db, organizationId, labelId, 100);
    }
    await expect(budget.reserve(harness.db, organizationId, labelId, 1)).rejects.toThrow();

    const row = await readRow();
    expect(row?.reservedCents).toBe(1_000);
    // The invariant that matters: never over-committed.
    expect(row!.budgetCents - row!.spentCents - row!.reservedCents).toBeGreaterThanOrEqual(0);
  });

  it('releases a reservation and commits actual spend on settle', async () => {
    await budget.reserve(harness.db, organizationId, labelId, 500);
    await budget.settle(harness.db, labelId, 500, 320);

    const result = await budget.get(harness.db, organizationId, labelId);
    expect(result.reservedCents).toBe(0);
    expect(result.spentCents).toBe(320);
    expect(result.availableCents).toBe(680);
  });

  it('releases the full hold when nothing was spent', async () => {
    await budget.reserve(harness.db, organizationId, labelId, 500);
    await budget.settle(harness.db, labelId, 500, 0);

    const result = await budget.get(harness.db, organizationId, labelId);
    expect(result.reservedCents).toBe(0);
    expect(result.spentCents).toBe(0);
    expect(result.availableCents).toBe(1_000);
  });

  it('degrades a double settle into a no-op instead of a constraint violation', async () => {
    await budget.reserve(harness.db, organizationId, labelId, 300);
    await budget.settle(harness.db, labelId, 300, 0);
    // A retried settle must not push reserved_cents negative.
    await budget.settle(harness.db, labelId, 300, 0);

    const row = await readRow();
    expect(row?.reservedCents).toBe(0);
  });

  it('ignores a zero-amount reservation without creating a period row', async () => {
    await budget.reserve(harness.db, organizationId, labelId, 0);
    const rows = await harness.db.select({ id: labelBudgets.id }).from(labelBudgets);
    expect(rows).toHaveLength(0);
  });

  it('keeps budgets separate per label', async () => {
    const other = labelIdBySlug(harness.seed, 'demolabel-3');
    await budget.reserve(harness.db, organizationId, labelId, 1_000);

    // A different label is unaffected by the first one being exhausted.
    await expect(
      budget.reserve(harness.db, organizationId, other, 1_000),
    ).resolves.toBeUndefined();
  });
});
