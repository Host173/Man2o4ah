import { Injectable, NotImplementedException } from '@nestjs/common';
import type { PayloadOf } from '../../common/events/event-payloads.js';
import type { Events } from '../../common/events/events.js';

/**
 * FLT-06, bookings side: when a moderator cancels a flight, every confirmed
 * booking containing it is cancelled at 100% and every pending one expires.
 */
@Injectable()
export class FlightProviderCancellationService {
  /** Handles `flight.cancelled`. A listener must not throw. */
  onFlightCancelled(
    payload: PayloadOf<typeof Events.FlightCancelled>,
  ): Promise<void> {
    void payload;
    throw new NotImplementedException(
      'onFlightCancelled: implemented in FLT-26',
    );
  }

  /** Cancels or expires every active booking of the flight; returns how many were handled. */
  cancelBookingsOf(flightId: string, now: Date): Promise<number> {
    void flightId;
    void now;
    throw new NotImplementedException(
      'cancelBookingsOf: implemented in FLT-26',
    );
  }
}
