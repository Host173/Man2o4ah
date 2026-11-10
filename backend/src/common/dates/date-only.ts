const MS_PER_DAY = 24 * 60 * 60 * 1000;
const YYYY_MM_DD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `value` is a valid Date at exactly 00:00:00.000Z. */
export function isDateOnly(value: unknown): value is Date {
  return (
    value instanceof Date &&
    !Number.isNaN(value.getTime()) &&
    value.getTime() % MS_PER_DAY === 0
  );
}

/** Converts 'YYYY-MM-DD' to a DateOnly. Throws on a malformed or impossible date. */
export function toDateOnly(yyyyMmDd: string): Date {
  const match = YYYY_MM_DD.exec(yyyyMmDd);
  if (!match) {
    throw new Error(`Invalid date "${yyyyMmDd}": expected YYYY-MM-DD.`);
  }
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC maps years 0-99 to 1900-1999, so assert the round trip.
  date.setUTCFullYear(year);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date "${yyyyMmDd}": no such calendar day.`);
  }
  return date;
}

/** Returns a new DateOnly `days` days after `date` (negative goes back). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Whole days from `from` to `to` (both DateOnly). Negative when `to` is earlier. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** Mongoose validator object for DateOnly fields. */
export const dateOnlyValidator = {
  validator: isDateOnly,
  message: '{PATH} must be a date at 00:00:00.000Z (DateOnly).',
};
