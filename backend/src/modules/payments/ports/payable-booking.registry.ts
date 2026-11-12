import { Injectable } from '@nestjs/common';
import type { BookingType } from '../../../common/database/booking-type.js';
import type { PayableBooking } from './payable-booking.port.js';

/**
 * Where booking modules plug in as `PayableBooking` (PAY-01). Booking modules
 * import `PaymentsModule`, so payments must never import them: each one
 * registers itself in `onModuleInit`.
 *
 * ```ts
 * @Injectable()
 * export class FlightPayableBooking implements PayableBooking, OnModuleInit {
 *   readonly bookingType = BookingType.FLIGHT;
 *   constructor(private readonly registry: PayableBookingRegistry) {}
 *   onModuleInit() { this.registry.register(this); }
 *   // getPayable, getPolicies …
 * }
 * ```
 */
@Injectable()
export class PayableBookingRegistry {
  private readonly bookings = new Map<BookingType, PayableBooking>();

  /** Registers the implementer of its `bookingType`; a second one for the same type is a wiring bug. */
  register(booking: PayableBooking): void {
    if (this.bookings.has(booking.bookingType)) {
      throw new Error(
        `A PayableBooking for "${booking.bookingType}" is already registered.`,
      );
    }
    this.bookings.set(booking.bookingType, booking);
  }

  /** The implementer of `type`; none registered is a wiring bug (500). */
  get(type: BookingType): PayableBooking {
    const booking = this.bookings.get(type);
    if (!booking) {
      throw new Error(`No PayableBooking is registered for "${type}".`);
    }
    return booking;
  }
}
