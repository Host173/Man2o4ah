import { daysBetween } from '../../common/dates/date-only.js';
import { multiplyMinor, sumMinor } from '../../common/money/money.js';

/** What pricing needs from one room: its price per night now (the snapshot). */
export interface PricedRoom {
  pricePerNightMinor: number;
}

/** Same fields as the reservation stores: `nights`, each room's subtotal, the total. */
export interface StayPrice {
  nights: number;
  /** One per room, in the order of the rooms. */
  subtotalsMinor: number[];
  totalMinor: number;
}

/**
 * Prices a hotel stay (HTL-16): the sum over rooms of nights × that room's
 * price per night. Nights run from check-in up to but excluding check-out.
 * Both dates are UTC DateOnly values, already checked (check-out after check-in).
 */
export function priceStay(
  checkInDate: Date,
  checkOutDate: Date,
  rooms: readonly PricedRoom[],
): StayPrice {
  const nights = daysBetween(checkInDate, checkOutDate);
  const subtotalsMinor = rooms.map((room) =>
    multiplyMinor(room.pricePerNightMinor, nights),
  );
  return { nights, subtotalsMinor, totalMinor: sumMinor(...subtotalsMinor) };
}
