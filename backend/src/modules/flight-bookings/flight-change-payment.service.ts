import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { BookingType } from '../../common/database/booking-type.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import type { PayloadOf } from '../../common/events/event-payloads.js';
import { Events } from '../../common/events/events.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { dropPendingChange, isSeatsUnavailable } from './pending-change.js';
import {
  FlightBooking,
  FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

/** The booking moved on between the read and the write: look at it again. */
class LostRace extends Error {}

/**
 * Applies a flight change once its price difference is paid (FLT-27). Payments
 * emits `payment.succeeded` with the `changeId` only after verifying the Stripe
 * webhook (PAY-01). In one transaction the booking is updated in place (the
 * change's segment, pricing and departure dates; the change moves from
 * `pendingChange` to `changes`) and the seats move: the held seats on the new
 * flight become booked, the old flight's are returned. The booking stays
 * `confirmed` and keeps its reference. Idempotent: a repeated event applies once.
 * If the change is no longer waiting (dropped as unpaid, or by a cancellation),
 * or the new flight left the schedule, payments is told to refund the payment.
 */
@Injectable()
export class FlightChangePaymentService {
  private readonly logger = new Logger(FlightChangePaymentService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly seatInventory: SeatInventory,
    private readonly events: AppEvents,
  ) {}

  @OnEvent(Events.PaymentSucceeded)
  async onPaymentSucceeded(
    payload: PayloadOf<typeof Events.PaymentSucceeded>,
  ): Promise<void> {
    // Only a flight change's payment; FlightConfirmationService handles the rest.
    if (payload.bookingType !== BookingType.FLIGHT || !payload.changeId) return;
    try {
      await this.apply(payload.bookingId, payload.changeId, new Date());
    } catch (error) {
      // A listener must not throw: log it so the payment can be followed up.
      this.logger.error(
        `Could not apply change ${payload.changeId} of flight booking ${payload.bookingId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** `retried`: true on the second look after a lost race, so it can't loop. */
  private async apply(
    bookingId: string,
    changeId: string,
    now: Date,
    retried = false,
  ): Promise<void> {
    if (
      !Types.ObjectId.isValid(bookingId) ||
      !Types.ObjectId.isValid(changeId)
    ) {
      return;
    }
    const booking = await this.bookings.findById(bookingId).lean();
    if (!booking) return;
    // Already applied: a repeated event.
    if (booking.changes?.some((c) => c._id.toString() === changeId)) return;

    const pending = booking.pendingChange;
    if (!pending || pending._id.toString() !== changeId) {
      // Paid too late: the change was dropped. Payments refunds it in full.
      this.tellPayments(bookingId, booking.userId, changeId);
      return;
    }

    const index = booking.segments.findIndex(
      (s) => s.direction === pending.direction,
    );
    const old = booking.segments[index];
    const segmentsAfter = booking.segments.map((s, i) =>
      i === index ? pending.segment : s,
    );
    const seats = booking.seatCount;

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const result = await this.bookings.updateOne(
          {
            _id: booking._id,
            status: FlightBookingStatus.CONFIRMED,
            'pendingChange._id': pending._id,
          },
          {
            $set: {
              [`segments.${index}`]: pending.segment,
              pricing: pending.pricing,
              firstDepartureAt: segmentsAfter[0].departureAt,
              lastDepartureAt:
                segmentsAfter[segmentsAfter.length - 1].departureAt,
            },
            $unset: { pendingChange: 1 },
            $push: {
              changes: {
                _id: pending._id,
                direction: pending.direction,
                previousSegment: old,
                newFlightId: pending.segment.flightId,
                previousTotalMinor: booking.pricing.totalMinor,
                newTotalMinor: pending.pricing.totalMinor,
                differenceMinor: pending.differenceMinor,
                changedAt: now,
              },
            },
          },
          { session, runValidators: true },
        );
        if (result.modifiedCount !== 1) throw new LostRace();
        // The held seats become booked; SEATS_UNAVAILABLE if the new flight
        // left the schedule, which rolls the booking update back too.
        await this.seatInventory.confirm(
          [
            {
              flightId: pending.segment.flightId.toString(),
              cabinId: pending.segment.cabinId.toString(),
              seats,
            },
          ],
          { session },
        );
        await this.seatInventory.returnBooked(
          [
            {
              flightId: old.flightId.toString(),
              cabinId: old.cabinId.toString(),
              seats,
            },
          ],
          { session },
        );
      });
    } catch (error) {
      // Something else changed the booking first (a cancellation, the expiry
      // job, a parallel delivery): look once more to see what is left to do.
      if (error instanceof LostRace && !retried) {
        return this.apply(bookingId, changeId, now, true);
      }
      if (isSeatsUnavailable(error)) {
        return this.dropUnapplicable(booking, changeId);
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /** The new flight can't take the passengers any more: drop the change, then refund. */
  private async dropUnapplicable(
    booking: FlightBooking & { _id: Types.ObjectId },
    changeId: string,
  ): Promise<void> {
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(() =>
        dropPendingChange(this.bookings, this.seatInventory, booking, session),
      );
    } finally {
      await session.endSession();
    }
    this.tellPayments(booking._id.toString(), booking.userId, changeId);
  }

  /** Payments cancels the change's payment, or refunds it in full if it succeeded. */
  private tellPayments(
    bookingId: string,
    userId: Types.ObjectId,
    changeId: string,
  ): void {
    this.events.emit(Events.FlightBookingChangeExpired, {
      bookingId,
      userId: userId.toString(),
      changeId,
    });
  }
}
