/** The list shape of every paginated endpoint (api-contract.md §3). */
export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** `totalPages` is 0 when `total` is 0. */
export function toPage<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): Paginated<T> {
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}
