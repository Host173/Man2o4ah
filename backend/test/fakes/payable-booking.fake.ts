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
 * `setChange(...)` adds a change waiting for payment (FLT-27), returned by
 * `getPayable` with its `changeId`.
 */
export class FakePayableBooking implements PayableBooking {
  private readonly entries = new Map<string, Entry>();
  private readonly changes = new Map<string, Entry>();

  constructor(readonly bookingType: BookingType) {}

  set(
    bookingId: string,
    userId: string,
    payable: Payable,
    policies: BookingPolicies,
  ): void {
    this.entries.set(bookingId, { userId, payable, policies });
  }

  setChange(
    bookingId: string,
    changeId: string,
    userId: string,
    payable: Payable,
  ): void {
    this.changes.set(`${bookingId}/${changeId}`, {
      userId,
      payable,
      policies: { bookingType: 'flight', segments: [] },
    });
  }

  // The methods are async so a 404 rejects the promise, like the real implementers.
  async getPayable(
    bookingId: string,
    userId: string,
    changeId?: string,
  ): Promise<Payable> {
    if (changeId === undefined) return this.find(bookingId, userId).payable;
    const entry = this.changes.get(`${bookingId}/${changeId}`);
    if (!entry || entry.userId !== userId) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Booking not found',
      });
    }
    return entry.payable;
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
