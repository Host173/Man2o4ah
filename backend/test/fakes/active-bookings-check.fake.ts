import type { BookingType } from '../../src/common/database/booking-type.js';
import type { ActiveBookingsCheck } from '../../src/modules/accounts/ports/active-bookings-check.port.js';

/**
 * A working `ActiveBookingsCheck` (ACC-12): users passed to the constructor
 * or `set(userId, true)` have upcoming confirmed bookings; everyone else has none.
 */
export class FakeActiveBookingsCheck implements ActiveBookingsCheck {
  private readonly withBookings: Set<string>;

  constructor(
    readonly bookingType: BookingType,
    userIdsWithUpcoming: string[] = [],
  ) {
    this.withBookings = new Set(userIdsWithUpcoming);
  }

  set(userId: string, hasUpcoming: boolean): void {
    if (hasUpcoming) this.withBookings.add(userId);
    else this.withBookings.delete(userId);
  }

  async hasUpcomingConfirmed(userId: string): Promise<boolean> {
    return this.withBookings.has(userId);
  }
}
