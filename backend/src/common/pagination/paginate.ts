import type { Model, ProjectionType, QueryFilter, SortOrder } from 'mongoose';
import { toPage } from './paginated.js';

export interface PaginateOptions<T> {
  sort?: Record<string, SortOrder>;
  projection?: ProjectionType<T>;
}

/**
 * Runs the page query and the count query with the same filter, in parallel,
 * and returns the list shape of api-contract.md §3.
 */
export async function paginate<T>(
  model: Model<T>,
  filter: QueryFilter<T>,
  { page, limit }: { page: number; limit: number },
  options: PaginateOptions<T> = {},
) {
  const [items, total] = await Promise.all([
    model
      .find(filter, options.projection)
      .sort(options.sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    // An unfiltered count would scan the whole collection; the stored count is exact here.
    Object.keys(filter).length === 0
      ? model.estimatedDocumentCount()
      : model.countDocuments(filter),
  ]);
  return toPage(items, total, page, limit);
}
