import {
  multiplyMinor,
  percentOfMinor,
  sumMinor,
} from '../../common/money/money.js';
import type { PassengerType } from './schemas/flight-booking.schema.js';

/** Infants pay this percent of the cabin fare and take no seat (FLT-12). */
const INFANT_FARE_PERCENT = 10;

/** What pricing needs from one segment, snapshotted at quote/hold time. */
export interface PricedSegment {
  /** The cabin's price per seat. */
  fareMinor: number;
  /** That segment airline's price per extra bag (0 if it sells none). */
  extraBagPriceMinor: number;
}

/** What pricing needs from one passenger. */
export interface PricedPassenger {
  type: PassengerType;
  extraBagCount: number;
}

/** Same fields as the booking's `pricing` (minus `currency`, which the service adds). */
export interface FlightPrice {
  /** Adults + children; the same on every segment. */
  seatCount: number;
  fareTotalMinor: number;
  baggageTotalMinor: number;
  totalMinor: number;
}

/**
 * Prices a flight booking on the server (FLT-12, FLT-19). Per segment:
 * fares = seats × fare + infants × round(fare × 10%); baggage = extra bags × that
 * airline's price. Passenger and baggage limits are checked before this is called.
 */
export function priceFlightBooking(
  segments: readonly PricedSegment[],
  passengers: readonly PricedPassenger[],
): FlightPrice {
  const infants = passengers.filter((p) => p.type === 'infant').length;
  const seatCount = passengers.length - infants;
  const extraBags = sumMinor(...passengers.map((p) => p.extraBagCount));

  const fares = segments.map((segment) =>
    sumMinor(
      multiplyMinor(segment.fareMinor, seatCount),
      multiplyMinor(
        percentOfMinor(segment.fareMinor, INFANT_FARE_PERCENT),
        infants,
      ),
    ),
  );
  const baggage = segments.map((segment) =>
    multiplyMinor(segment.extraBagPriceMinor, extraBags),
  );

  const fareTotalMinor = sumMinor(...fares);
  const baggageTotalMinor = sumMinor(...baggage);
  return {
    seatCount,
    fareTotalMinor,
    baggageTotalMinor,
    totalMinor: sumMinor(fareTotalMinor, baggageTotalMinor),
  };
}
