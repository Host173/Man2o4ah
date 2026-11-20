/**
 * FLT-25: how "my flight bookings" are grouped. Decided with Kareem (20 Nov):
 * - upcoming: `confirmed` and `firstDepartureAt > now` (same rule as `ActiveBookingsCheck`)
 * - past: `completed`, or `confirmed` whose first departure has passed
 * - cancelled: `cancelled`
 * `pending_payment` and `expired` bookings are in no group.
 */
import type { QueryFilter, SortOrder } from 'mongoose';
import { FlightBookingStatus } from './schemas/flight-booking.schema.js';
import type { FlightBooking } from './schemas/flight-booking.schema.js';

export const BOOKING_GROUPS = ['upcoming', 'past', 'cancelled'] as const;
export type BookingGroup = (typeof BOOKING_GROUPS)[number];

export interface GroupQuery {
  filter: QueryFilter<FlightBooking>;
  sort: Record<string, SortOrder>;
}

/** The Mongo filter and sort for one group, as of `now`. `_id` breaks ties so paging is stable. */
export function groupQuery(group: BookingGroup, now: Date): GroupQuery {
  switch (group) {
    case 'upcoming':
      return {
        filter: {
          status: FlightBookingStatus.CONFIRMED,
          firstDepartureAt: { $gt: now },
        },
        sort: { firstDepartureAt: 1, _id: 1 },
      };
    case 'past':
      return {
        filter: {
          $or: [
            { status: FlightBookingStatus.COMPLETED },
            {
              status: FlightBookingStatus.CONFIRMED,
              firstDepartureAt: { $lte: now },
            },
          ],
        },
        sort: { firstDepartureAt: -1, _id: -1 },
      };
    case 'cancelled':
      return {
        filter: { status: FlightBookingStatus.CANCELLED },
        sort: { firstDepartureAt: -1, _id: -1 },
      };
  }
}
