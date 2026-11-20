import { Injectable } from '@nestjs/common';
import { BookingType } from '../../../common/database/booking-type.js';
import type {
  ActiveBookingsCheck,
  ActiveBookingsCheckOptions,
} from './active-bookings-check.port.js';

const BOOKING_TYPES: readonly BookingType[] = Object.values(BookingType);

/**
 * Where booking modules plug in as `ActiveBookingsCheck` (ACC-12). Each one
 * registers itself in `onModuleInit`, so accounts never imports them:
 *
 * ```ts
 * @Injectable()
 * export class FlightActiveBookings implements ActiveBookingsCheck, OnModuleInit {
 *   readonly bookingType = BookingType.FLIGHT;
 *   constructor(private readonly registry: ActiveBookingsCheckRegistry) {}
 *   onModuleInit() { this.registry.register(this); }
 *   hasUpcomingConfirmed(userId: string) { … }
 * }
 * ```
 */
@Injectable()
export class ActiveBookingsCheckRegistry {
  private readonly checks = new Map<BookingType, ActiveBookingsCheck>();

  /** A second implementer for the same type, or an unknown type, is a wiring bug. */
  register(check: ActiveBookingsCheck): void {
    if (!BOOKING_TYPES.includes(check.bookingType)) {
      throw new Error(`Unknown booking type "${String(check.bookingType)}".`);
    }
    if (this.checks.has(check.bookingType)) {
      throw new Error(
        `An ActiveBookingsCheck for "${check.bookingType}" is already registered.`,
      );
    }
    this.checks.set(check.bookingType, check);
  }

  /**
   * True if any booking type reports an upcoming confirmed booking. Every
   * booking type must be registered: answering "no bookings" because one
   * module isn't wired would let a user with bookings deactivate.
   */
  async hasUpcomingConfirmed(
    userId: string,
    options?: ActiveBookingsCheckOptions,
  ): Promise<boolean> {
    const missing = BOOKING_TYPES.filter((type) => !this.checks.has(type));
    if (missing.length > 0) {
      throw new Error(
        `No ActiveBookingsCheck is registered for: ${missing.join(', ')}.`,
      );
    }
    // MongoDB does not support parallel operations on one transaction session.
    let upcoming = false;
    for (const check of this.checks.values()) {
      const answer = await check.hasUpcomingConfirmed(userId, options);
      upcoming = upcoming || answer;
    }
    return upcoming;
  }
}
