import { BadRequestException, ConflictException } from '@nestjs/common';
import type { CabinClass } from '../../common/database/cabin-class.js';
import type { ErrorDetail } from '../../common/errors/error-body.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { FlightView } from '../flights/flights.types.js';
import type {
  FlightBookingStatus,
  SegmentDirection,
} from './schemas/flight-booking.schema.js';

/** What the change rules need from one booked segment. */
export interface ChangeableSegment {
  direction: SegmentDirection;
  flightId: string;
  departureAirportId: string;
  arrivalAirportId: string;
  cabinClass: CabinClass;
  departureAt: Date;
  arrivalAt: Date;
}

/** What the change rules need from the booking. */
export interface ChangeableBooking {
  status: FlightBookingStatus;
  /** True while an earlier change waits for its payment. */
  hasPendingChange: boolean;
  segments: readonly ChangeableSegment[];
}

/** What the change rules need from the flight the user wants instead. */
export interface NewFlight {
  flightId: string;
  status: FlightView['status'];
  departureAirportId: string;
  arrivalAirportId: string;
  /** The classes of the flight's cabins. */
  cabinClasses: readonly CabinClass[];
  departureAt: Date;
  arrivalAt: Date;
}

/**
 * Checks the booking can be changed in `direction` (FLT-27): it is confirmed,
 * no other change is waiting for payment, and that segment hasn't departed
 * (at departure is too late, as for FLT-26). Throws 409
 * INVALID_STATUS_TRANSITION for those, and 400 VALIDATION_FAILED if the booking
 * has no segment in that direction (e.g. the return of a one-way booking).
 */
export function assertChangeable(
  booking: ChangeableBooking,
  direction: SegmentDirection,
  now: Date,
): void {
  if (booking.status !== 'confirmed') {
    throw notChangeable('Only confirmed bookings can be changed');
  }
  if (booking.hasPendingChange) {
    throw notChangeable(
      'This booking already has a change waiting for payment',
    );
  }
  const segment = booking.segments.find((s) => s.direction === direction);
  if (!segment) {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Validation failed',
      details: [
        {
          field: 'direction',
          message: `The booking has no ${direction} flight`,
        },
      ],
    });
  }
  if (segment.departureAt <= now) {
    throw notChangeable(`The ${direction} flight has already departed`);
  }
}

/**
 * Every rule the new flight must meet (FLT-27), checked at once: another
 * flight, on the same route, with the booked cabin class, scheduled and in the
 * future, and still in order with the booking's other segment (the return
 * departs after the outbound arrives). Returns one `{ field, message }` per
 * broken rule, for 400 VALIDATION_FAILED; empty means the flight is fine.
 * Call `assertChangeable` first, so the segment in `direction` exists.
 */
export function checkNewFlight(
  segments: readonly ChangeableSegment[],
  direction: SegmentDirection,
  flight: NewFlight,
  now: Date,
): ErrorDetail[] {
  const problems: string[] = [];
  const current = segments.find((s) => s.direction === direction);
  if (!current) {
    throw new Error(`The booking has no ${direction} segment`);
  }

  if (flight.flightId === current.flightId) {
    problems.push('The booking is already on this flight');
  }
  if (
    flight.departureAirportId !== current.departureAirportId ||
    flight.arrivalAirportId !== current.arrivalAirportId
  ) {
    problems.push(
      `The new flight must fly the same route (${current.departureAirportId} to ${current.arrivalAirportId})`,
    );
  }
  if (!flight.cabinClasses.includes(current.cabinClass)) {
    problems.push(`The new flight has no ${current.cabinClass} cabin`);
  }
  if (flight.status !== 'scheduled' || flight.departureAt <= now) {
    problems.push('The new flight must be scheduled and not yet departed');
  }

  const outbound = segments.find((s) => s.direction === 'outbound');
  const inbound = segments.find((s) => s.direction === 'return');
  if (direction === 'outbound' && inbound) {
    if (flight.arrivalAt >= inbound.departureAt) {
      problems.push('The new flight must arrive before the return departs');
    }
  }
  if (direction === 'return' && outbound) {
    if (flight.departureAt <= outbound.arrivalAt) {
      problems.push('The new flight must depart after the outbound arrives');
    }
  }

  return problems.map((message) => ({ field: 'flightId', message }));
}

function notChangeable(message: string): ConflictException {
  return new ConflictException({
    code: ErrorCode.InvalidStatusTransition,
    message,
  });
}
