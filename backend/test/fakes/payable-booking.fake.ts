import { NotFoundException } from '@nestjs/common';
import type { BookingType } from '../../src/common/database/booking-type.js';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type {
  BookingPolicies,
  Payable,
  PayableBooking,
} from '../../src/modules/payments/ports/payable-booking.port.js';

interface Entry {
  userId: string;
  payable: Payable;
  policies: BookingPolicies;
}

/**
 * A working `PayableBooking`: `set(...)` a booking, then `getPayable` and
 * `getPolicies` return it to its owner and throw 404 NOT_FOUND to anyone else.
 */
export class FakePayableBooking implements PayableBooking {
  private readonly entries = new Map<string, Entry>();

  constructor(readonly bookingType: BookingType) {}

  set(
    bookingId: string,
    userId: string,
    payable: Payable,
    policies: BookingPolicies,
  ): void {
    this.entries.set(bookingId, { userId, payable, policies });
  }

  // The methods are async so a 404 rejects the promise, like the real implementers.
  async getPayable(bookingId: string, userId: string): Promise<Payable> {
    return this.find(bookingId, userId).payable;
  }

  async getPolicies(
    bookingId: string,
    userId: string,
  ): Promise<BookingPolicies> {
    return this.find(bookingId, userId).policies;
  }

  private find(bookingId: string, userId: string): Entry {
    const entry = this.entries.get(bookingId);
    if (!entry || entry.userId !== userId) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Booking not found',
      });
    }
    return entry;
  }
}
