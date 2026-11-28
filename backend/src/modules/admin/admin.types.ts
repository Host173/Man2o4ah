import type { FlightBookingAdminView } from '../flight-bookings/flight-bookings.types.js';
import type { HotelReservationAdminView } from '../hotel-bookings/hotel-bookings.types.js';
import { FlightBookingStatus } from '../flight-bookings/schemas/flight-booking.schema.js';
import { HotelReservationStatus } from '../hotel-bookings/schemas/hotel-reservation.schema.js';

const HOTEL_STATUSES = new Set<string>(Object.values(HotelReservationStatus));

/** Statuses shared by both flight bookings and hotel reservations (`ACC-17`, `CTR-04`). */
export const ADMIN_BOOKING_STATUSES: readonly (FlightBookingStatus &
  HotelReservationStatus)[] = Object.values(FlightBookingStatus).filter(
  (status): status is FlightBookingStatus & HotelReservationStatus =>
    HOTEL_STATUSES.has(status),
);

export type AdminBookingStatus = (typeof ADMIN_BOOKING_STATUSES)[number];

/** Read-only row returned by `GET /api/admin/bookings` (`ACC-17`, `CTR-04`). */
export type AdminBookingView =
  FlightBookingAdminView | HotelReservationAdminView;

export const ProviderStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const;
export type ProviderStatus =
  (typeof ProviderStatus)[keyof typeof ProviderStatus];

export interface AdminAirlineProviderView {
  _id: string;
  type: 'airline';
  name: string;
  status: ProviderStatus;
  moderatorCount: number;
  code: string;
}

export interface AdminHotelProviderView {
  _id: string;
  type: 'hotel';
  name: string;
  status: ProviderStatus;
  moderatorCount: number;
  cityId: string;
  countryCode: string;
}

/** Provider row returned by `GET /api/admin/providers` (`BE-01`). */
export type AdminProviderView =
  | AdminAirlineProviderView
  | AdminHotelProviderView;
