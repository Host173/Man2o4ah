import type { FlightBookingStatus } from './schemas/flight-booking.schema.js';

/**
 * Internal service input for the admin booking list (ACC-17), not an HTTP DTO.
 * `from` and `to` filter on the booking's `createdAt`, both ends inclusive.
 */
export interface AdminFlightBookingQuery {
  status?: FlightBookingStatus;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

/** One row of the admin booking list (ACC-17). Read-only; amounts in minor units. */
export interface FlightBookingAdminView {
  bookingType: 'flight';
  bookingId: string;
  /** Set only once the booking is confirmed (FLT-23). */
  reference?: string;
  userId: string;
  /** The outbound segment's airline. */
  providerId: string;
  /** Outbound departure (`firstDepartureAt`). */
  startAt: Date;
  /** Last segment's departure (`lastDepartureAt`). */
  endAt: Date;
  totalMinor: number;
  currency: string;
  status: FlightBookingStatus;
  createdAt: Date;
}
