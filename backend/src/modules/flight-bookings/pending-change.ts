import { ConflictException } from '@nestjs/common';
import type { ClientSession, Model, Types } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { SeatInventory } from '../flights/seat-inventory.js';
import type { FlightBooking } from './schemas/flight-booking.schema.js';

/** What dropping a waiting change needs from the booking (FLT-27). */
export interface BookingWithPendingChange {
  _id: Types.ObjectId;
  seatCount: number;
  pendingChange?: {
    _id: Types.ObjectId;
    segment: { flightId: Types.ObjectId; cabinId: Types.ObjectId };
  } | null;
}

/**
 * Drops the booking's change that waits for payment (FLT-27): removes exactly
 * that `pendingChange` and releases the seats it held. Returns false, and
 * changes nothing, when there is no such change any more (paid, dropped or
 * replaced meanwhile). Call it inside the caller's transaction, so the booking
 * and the seats change together; after the commit, the caller emits
 * `flight-booking.change-expired` so payments cancels (or refunds) its payment.
 */
export async function dropPendingChange(
  bookings: Model<FlightBooking>,
  seatInventory: SeatInventory,
  booking: BookingWithPendingChange,
  session: ClientSession,
): Promise<boolean> {
  const pending = booking.pendingChange;
  if (!pending) return false;
  const result = await bookings.updateOne(
    { _id: booking._id, 'pendingChange._id': pending._id },
    { $unset: { pendingChange: 1 } },
    { session },
  );
  if (result.modifiedCount !== 1) return false;
  await seatInventory.release(
    [
      {
        flightId: pending.segment.flightId.toString(),
        cabinId: pending.segment.cabinId.toString(),
        seats: booking.seatCount,
      },
    ],
    { session },
  );
  return true;
}

/** `SeatInventory` refuses with this when a flight is no longer scheduled or bookable. */
export function isSeatsUnavailable(error: unknown): boolean {
  if (!(error instanceof ConflictException)) return false;
  const response = error.getResponse();
  return (
    typeof response === 'object' &&
    (response as { code?: unknown }).code === ErrorCode.SeatsUnavailable
  );
}
