import { z } from 'zod';

/**
 * Every collection endpoint is paginated and bounded. Keyset pagination is
 * used rather than offset so that page cost stays constant as tables grow.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  /** Opaque keyset cursor returned by the previous page. */
  cursor: z.string().max(256).optional(),
});
export type PageQuery = z.infer<typeof pageQuery>;

export function pageResult<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
