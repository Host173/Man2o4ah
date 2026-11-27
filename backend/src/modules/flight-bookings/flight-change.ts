import { percentOfMinor } from '../../common/money/money.js';
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

/** How a cancellation refund is taken from a booking's payments (FLT-27). */
export interface CancellationRefundSplit {
  /** From the booking's first payment (no changeId). */
  firstPaymentMinor: number;
  /** From the paid change's own payment (its changeId); 0 without a paid change. */
  changePaymentMinor: number;
}

/**
 * Splits a cancellation refund between the booking's first payment and the
 * payment of its paid change, if any (one change per booking). The change's
 * payment is refunded by the same `percent` (rounded half up), and the first
 * payment gives the rest, so the two parts always add up to `refundAmountMinor`.
 */
export function splitCancellationRefund(
  refundAmountMinor: number,
  percent: number,
  paidChangeMinor: number,
): CancellationRefundSplit {
  const changePaymentMinor = Math.min(
    percentOfMinor(paidChangeMinor, percent),
    refundAmountMinor,
  );
  return {
    firstPaymentMinor: refundAmountMinor - changePaymentMinor,
    changePaymentMinor,
  };
}
