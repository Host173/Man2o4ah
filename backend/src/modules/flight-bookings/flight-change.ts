import { priceFlightBooking } from './flight-pricing.js';
import type {
  FlightPrice,
  PricedPassenger,
  PricedSegment,
} from './flight-pricing.js';
import type { SegmentDirection } from './schemas/flight-booking.schema.js';

/** A priced segment that also knows its direction (FLT-27). */
export interface ChangeSegment extends PricedSegment {
  direction: SegmentDirection;
}

/** The price of a booking after a change, and what moves between user and platform. */
export interface FlightChangeQuote {
  newPrice: FlightPrice;
  /** > 0 the user pays it, < 0 the user is refunded it, 0 nothing moves. */
  differenceMinor: number;
}

/**
 * Prices a flight change (FLT-27). The whole booking is repriced with the
 * replacement segment swapped in, because extra-bag fees are charged once per
 * airline across the booking (FLT-19). The difference is measured against what
 * the user already paid. Throws if the booking has no segment in that direction.
 */
export function quoteFlightChange(
  current: readonly ChangeSegment[],
  passengers: readonly PricedPassenger[],
  currentTotalMinor: number,
  replacement: ChangeSegment,
): FlightChangeQuote {
  if (!current.some((s) => s.direction === replacement.direction)) {
    throw new Error(
      `The booking has no ${replacement.direction} segment to change`,
    );
  }

  const newSegments = current.map((s) =>
    s.direction === replacement.direction ? replacement : s,
  );
  const newPrice = priceFlightBooking(newSegments, passengers);
  return {
    newPrice,
    differenceMinor: newPrice.totalMinor - currentTotalMinor,
  };
}
