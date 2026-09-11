import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../core/db/types.js';
import { usageRecords } from '../../core/db/schema.js';

/**
 * AI usage and cost accounting.
 *
 * Estimated and actual cost are kept in separate columns because they answer
 * different questions and must not be conflated (requirement 12: "Gerçek
 * maliyet ile tahmini maliyeti ayır"). Estimates drive budget reservations;
 * actuals drive reporting.
 *
 * Idempotency: one row per (job, attempt, kind, unit key), enforced by a unique index.
 * `onConflictDoNothing` therefore makes a replayed attempt a no-op rather than
 * a second charge — the direct answer to "retry sırasında çift maliyet işlemi
 * oluşmaması".
 */
export interface UsageInput {
  unitKey?: string;
  organizationId: string;
  labelId: string | null;
  jobId: string | null;
  attempt: number;
  kind: 'ai_text' | 'ai_image' | 'ai_research' | 'storage';
  provider: string;
  model?: string | null;
  promptTemplate?: string | null;
  promptVersion?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  imageCount?: number | null;
  estimatedCostCents: number;
  actualCostCents?: number | null;
  latencyMs?: number | null;
}

export class UsageRecorder {
  /** @returns true when a new row was written, false when it already existed. */
  async record(db: DbOrTx, input: UsageInput): Promise<boolean> {
    const rows = await db
      .insert(usageRecords)
      .values({
        unitKey: input.unitKey ?? '',
        organizationId: input.organizationId,
        labelId: input.labelId,
        jobId: input.jobId,
        attempt: input.attempt,
        kind: input.kind,
        provider: input.provider,
        model: input.model ?? null,
        promptTemplate: input.promptTemplate ?? null,
        promptVersion: input.promptVersion ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        imageCount: input.imageCount ?? null,
        estimatedCostCents: input.estimatedCostCents,
        actualCostCents: input.actualCostCents ?? null,
        latencyMs: input.latencyMs ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: usageRecords.id });

    return rows.length > 0;
  }

  /**
   * What one job attempt actually cost.
   *
   * Read back from the usage rows rather than threaded through every service
   * signature: the rows are already the single source of truth for cost, and
   * summing them keeps a handler from having to carry a running total.
   */
  /** Budget settlement retains an estimate for images with missing provider usage.
   * Actual reporting remains null in the underlying record. */
  async budgetCostForAttempt(db: DbOrTx, jobId: string, attempt: number): Promise<number> {
    const rows = await db.select({ total: sql<number | null>`sum(case when ${usageRecords.kind} in ('ai_image', 'ai_research') then coalesce(${usageRecords.actualCostCents}, ${usageRecords.estimatedCostCents}) else ${usageRecords.actualCostCents} end)` })
      .from(usageRecords).where(and(eq(usageRecords.jobId, jobId), eq(usageRecords.attempt, attempt)));
    return rows[0]?.total ?? 0;
  }

  async actualCostForAttempt(db: DbOrTx, jobId: string, attempt: number): Promise<number> {
    const rows = await db
      .select({ total: sql<number | null>`sum(${usageRecords.actualCostCents})` })
      .from(usageRecords)
      .where(and(eq(usageRecords.jobId, jobId), eq(usageRecords.attempt, attempt)));
    return rows[0]?.total ?? 0;
  }
}
