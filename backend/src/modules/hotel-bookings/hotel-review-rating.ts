import type { HotelRatingSummary } from './hotel-bookings.types.js';

export function toHotelRatingSummary(
  average: number | null,
  count: number,
): HotelRatingSummary {
  if (count === 0) return { average: null, count: 0 };
  if (average === null) {
    throw new Error('A non-empty review aggregate must include an average.');
  }
  return { average: Math.round(average * 10) / 10, count };
}
