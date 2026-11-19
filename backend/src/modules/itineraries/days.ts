import { addDays } from '../../common/dates/date-only.js';
import type { CityGroupView } from './itineraries.types.js';

/**
 * A day's number: its position in the `days` array + 1 (ITN-05). Neither the
 * number nor the date is stored, so adding or reordering days can't leave them
 * stale.
 */
export function dayNumber(index: number): number {
  return index + 1;
}

/** A day's calendar date: `startDate` + `index` days, as `YYYY-MM-DD` (ITN-05). */
export function dayDate(startDate: Date, index: number): string {
  return addDays(startDate, index).toISOString().slice(0, 10);
}

/**
 * The derived `cityIds` field: the distinct cities of the days, sorted, so a
 * search by city is stable. Recomputed on every write that changes `days`
 * (data-model.md §3.8).
 */
export function cityIdsOf(days: readonly { cityId: string }[]): string[] {
  return [...new Set(days.map((day) => day.cityId))].sort();
}

/**
 * ITN-09: consecutive days in the same city form one group, in chronological
 * order. `checkOut` is the day after the group's last day, which is the
 * check-in/check-out pair ITN-25 reuses for the hotel search. The budget
 * subtotal is added by ITN-14, which owns amounts and currency conversion.
 */
export function cityGroups(
  days: readonly { cityId: string }[],
  startDate: Date,
): CityGroupView[] {
  const groups: CityGroupView[] = [];

  days.forEach((day, index) => {
    const last = groups[groups.length - 1];
    if (last && last.cityId === day.cityId) {
      last.toDay = dayNumber(index);
      last.dayCount += 1;
      last.checkOut = dayDate(startDate, index + 1);
      return;
    }
    groups.push({
      cityId: day.cityId,
      fromDay: dayNumber(index),
      toDay: dayNumber(index),
      dayCount: 1,
      checkIn: dayDate(startDate, index),
      checkOut: dayDate(startDate, index + 1),
    });
  });

  return groups;
}
