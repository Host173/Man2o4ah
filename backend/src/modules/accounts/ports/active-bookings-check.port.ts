import type { BookingType } from '../../../common/database/booking-type.js';

/**
 * Owned by accounts; implemented by flight-bookings and hotel-bookings
 * (data model §6.2). Self-deactivation is blocked with 409
 * ACTIVE_BOOKINGS_EXIST while any implementer answers `true` (ACC-12).
 * Accounts never imports the booking modules: they register themselves in
 * `ActiveBookingsCheckRegistry`.
 */
export interface ActiveBookingsCheck {
  readonly bookingType: BookingType;
  /** True if the user has a `confirmed` booking whose trip or stay hasn't started yet. */
  hasUpcomingConfirmed(userId: string): Promise<boolean>;
}
