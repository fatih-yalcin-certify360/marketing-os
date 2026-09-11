import { and, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../../core/db/types.js';
import { labels } from '../../core/db/schema.js';

export interface LabelRecord {
  id: string;
  slug: string;
  name: string;
  origin: string;
  isActive: boolean;
  createdAt: Date;
}

/** Owns the `labels` table. Other modules read labels through the service. */
export class LabelRepository {
  /**
   * Loads labels by id, always additionally filtered by organisation.
   *
   * The redundant `organization_id` predicate is deliberate: it means a bug
   * that lets a foreign id reach this method still cannot return another
   * organisation's row.
   */
  async findManyByIds(
    db: DbOrTx,
    organizationId: string,
    ids: readonly string[],
  ): Promise<LabelRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await db
      .select({
        id: labels.id,
        slug: labels.slug,
        name: labels.name,
        origin: labels.origin,
        isActive: labels.isActive,
        createdAt: labels.createdAt,
      })
      .from(labels)
      .where(
        and(
          eq(labels.organizationId, organizationId),
          inArray(labels.id, [...ids]),
          eq(labels.isActive, true),
        ),
      )
      .orderBy(labels.name);
    return rows;
  }

  async findById(
    db: DbOrTx,
    organizationId: string,
    id: string,
  ): Promise<LabelRecord | undefined> {
    const rows = await this.findManyByIds(db, organizationId, [id]);
    return rows[0];
  }
}
