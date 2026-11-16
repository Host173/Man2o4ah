/**
 * Booking lifecycle rules shared by flight-bookings and hotel-bookings (GEN-11).
 * Lives here until the team leader decides where shared booking rules belong;
 * hotel-bookings imports it from this file.
 */
import { ConflictException } from '@nestjs/common';
import type {
  ClientSession,
  Model,
  QueryFilter,
  Types,
  UpdateQuery,
} from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { FlightBookingStatus } from './schemas/flight-booking.schema.js';

/** Flight bookings and hotel reservations share the same five statuses (GEN-11). */
export type BookingStatus = FlightBookingStatus;

/** GEN-11: the only legal moves. A status missing from a list can't be reached from that key. */
const ALLOWED: Record<BookingStatus, readonly BookingStatus[]> = {
  pending_payment: ['confirmed', 'expired'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  expired: [],
  cancelled: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED[from].includes(to);
}

function invalidTransition(from: BookingStatus, to: BookingStatus) {
  return new ConflictException({
    code: ErrorCode.InvalidStatusTransition,
    message: `The booking can't move from ${from} to ${to}`,
  });
}

/**
 * Moves one booking from `from` to `to` with a conditional update, so racing
 * writers (webhook, expiry job, user cancel) can't both win (GEN-11).
 * `set` holds the fields that change with the status (e.g. `confirmedAt`).
 * Throws 409 INVALID_STATUS_TRANSITION if the move is illegal, or if the
 * booking doesn't exist or is no longer in `from`. Pass `{ session }` inside a transaction.
 */
export async function transitionStatus<T extends { status: BookingStatus }>(
  model: Model<T>,
  id: string | Types.ObjectId,
  from: BookingStatus,
  to: BookingStatus,
  set: Record<string, unknown> = {},
  options: { session?: ClientSession } = {},
): Promise<void> {
  if (!canTransition(from, to)) {
    throw invalidTransition(from, to);
  }
  const result = await model.updateOne(
    { _id: id, status: from } as QueryFilter<T>,
    { $set: { ...set, status: to } } as UpdateQuery<T>,
    { session: options.session },
  );
  if (result.modifiedCount !== 1) {
    throw invalidTransition(from, to);
  }
}
