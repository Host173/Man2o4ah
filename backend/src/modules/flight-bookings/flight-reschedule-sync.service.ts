import { Injectable, NotImplementedException } from '@nestjs/common';
import type { PayloadOf } from '../../common/events/event-payloads.js';
import type { Events } from '../../common/events/events.js';

/**
 * FLT-05, bookings side: when a moderator moves a flight, the bookings that
 * contain it copy the new times and the confirmed passengers are notified.
 */
@Injectable()
export class FlightRescheduleSyncService {
  /** Handles `flight.rescheduled`. A listener must not throw. */
  onFlightRescheduled(
    payload: PayloadOf<typeof Events.FlightRescheduled>,
  ): Promise<void> {
    void payload;
    throw new NotImplementedException(
      'onFlightRescheduled: implemented in FLT-26',
    );
  }

  /** Syncs every active booking of the flight to the new times. Idempotent. */
  sync(payload: PayloadOf<typeof Events.FlightRescheduled>): Promise<void> {
    void payload;
    throw new NotImplementedException('sync: implemented in FLT-26');
  }
}
