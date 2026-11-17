export const MAX_TAGS_PER_POST = 5;
export const MIN_TAG_LENGTH = 1;
export const MAX_TAG_LENGTH = 30;

/**
 * BLG-08: normalises a single tag by trimming surrounding whitespace and
 * lowercasing (`data-model.md` §3.10, `domain-rules.md` §6).
 */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * BLG-08: normalises a list of tags (trim + lowercase) and removes duplicates
 * that normalise to the same value while preserving first-seen order.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const normalized = normalizeTag(raw);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

/**
 * `class-transformer` helper for optional `tags` arrays on post DTOs (`BLG-08`).
 * Leaves non-arrays and arrays containing non-string items untouched so
 * `class-validator` reports the appropriate validation error.
 */
export function normalizeTagsTransform(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (!value.every((item): item is string => typeof item === 'string')) {
    return value;
  }
  return normalizeTags(value);
}

