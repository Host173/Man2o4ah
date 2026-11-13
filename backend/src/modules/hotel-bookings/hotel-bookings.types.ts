import type { HotelReservationStatus } from './schemas/hotel-reservation.schema.js';

/**
 * Internal service input for the admin booking list (ACC-17), not an HTTP DTO.
 * `from` and `to` filter on the reservation's `createdAt`, both ends inclusive.
 */
export interface AdminHotelReservationQuery {
  status?: HotelReservationStatus;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

/** One row of the admin booking list (ACC-17). Read-only; amounts in minor units. */
export interface HotelReservationAdminView {
  bookingType: 'hotel';
  bookingId: string;
  /** Set only once the reservation is confirmed (HTL-17). */
  reference?: string;
  userId: string;
  /** The reservation's hotel (`hotelId`). */
  providerId: string;
  /** Check-in date (`checkInDate`), a UTC DateOnly. */
  startAt: Date;
  /** Check-out date (`checkOutDate`), a UTC DateOnly. */
  endAt: Date;
  totalMinor: number;
  currency: string;
  status: HotelReservationStatus;
  createdAt: Date;
}
