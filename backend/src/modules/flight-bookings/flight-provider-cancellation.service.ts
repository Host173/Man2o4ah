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
import { PaymentsService } from '../payments/payments.service.js';
import { isInvalidTransition, transitionStatus } from './booking-lifecycle.js';
import { splitCancellationRefund } from './flight-change.js';
import { dropPendingChange } from './pending-change.js';
import type { BookingWithPendingChange } from './pending-change.js';
import {
  FlightBooking,
  FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

const BATCH_SIZE = 100;

/** The fields the handler needs from a booking of the cancelled flight. */
interface ActiveBooking {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  status: FlightBookingStatus;
  reference?: string;
  seatCount: number;
  pricing: { totalMinor: number; currency: string };
  segments: { flightId: Types.ObjectId; cabinId: Types.ObjectId }[];
  /** FLT-27: a change waiting for payment, dropped with the booking. */
  pendingChange?: BookingWithPendingChange['pendingChange'];
  /** FLT-27: applied changes; a paid one has its own payment to refund. */
  changes?: { _id: Types.ObjectId; differenceMinor: number }[];
}

/** The fields needed to drop a change waiting on the cancelled flight (FLT-27). */
interface WaitingChange extends BookingWithPendingChange {
  userId: Types.ObjectId;
}

/** `done`: changed by this call. `skipped`: it moved on meanwhile (look again). `failed`: gave up after a retry. */
type Outcome = 'done' | 'skipped' | 'failed';

/**
 * FLT-06, bookings side (GEN-11): when a moderator cancels a flight, every
 * `confirmed` booking containing it (round trips included) is cancelled at
 * 100% with `cancelledBy: 'provider'` and refunded, and every
 * `pending_payment` one expires. A change waiting for payment on the
 * cancelled flight is dropped (FLT-27), and so is any change waiting on a
 * cancelled booking. Each booking is handled in its own
 * transaction, so one failure doesn't block the others (a failed booking is
 * retried once, as the event is never redelivered), and the handler is
 * idempotent: it only touches bookings still confirmed or pending.
 */
@Injectable()
export class FlightProviderCancellationService {
  private readonly logger = new Logger(FlightProviderCancellationService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly seatInventory: SeatInventory,
    private readonly payments: PaymentsService,
    private readonly events: AppEvents,
  ) {}

  /** Handles `flight.cancelled`. A listener must not throw: it logs instead. */
  @OnEvent(Events.FlightCancelled)
  async onFlightCancelled(
    payload: PayloadOf<typeof Events.FlightCancelled>,
  ): Promise<void> {
    try {
      await this.cancelBookingsOf(payload.flightId, new Date());
    } catch (error) {
      this.logger.error(
        `Could not cancel the bookings of flight ${payload.flightId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Cancels or expires every active booking of the flight, then drops the
   * changes waiting on it (FLT-27); returns how many bookings this call handled.
   */
  async cancelBookingsOf(flightId: string, now: Date): Promise<number> {
    if (!Types.ObjectId.isValid(flightId)) return 0;
    const handled = await this.cancelActiveBookings(flightId, now);
    await this.dropChangesWaitingOn(flightId);
    return handled;
  }

  /**
   * FLT-27: a change that waits for payment on the cancelled flight can't
   * happen any more. Each one is dropped (its held seats released) in its own
   * transaction, then payments cancels or refunds its payment. The booking
   * keeps its current flight. A failure is logged; the expiry job drops the
   * change anyway within 10 minutes.
   */
  private async dropChangesWaitingOn(flightId: string): Promise<void> {
    const waiting = await this.bookings
      .find(
        { 'pendingChange.segment.flightId': new Types.ObjectId(flightId) },
        {
          userId: 1,
          seatCount: 1,
          'pendingChange._id': 1,
          'pendingChange.segment.flightId': 1,
          'pendingChange.segment.cabinId': 1,
        },
      )
      .lean<WaitingChange[]>();
    for (const booking of waiting) {
      const session = await this.connection.startSession();
      try {
        const dropped = await session.withTransaction(() =>
          dropPendingChange(
            this.bookings,
            this.seatInventory,
            booking,
            session,
          ),
        );
        if (dropped && booking.pendingChange) {
          this.events.emit(Events.FlightBookingChangeExpired, {
            bookingId: booking._id.toString(),
            userId: booking.userId.toString(),
            changeId: booking.pendingChange._id.toString(),
          });
        }
      } catch (error) {
        this.logger.error(
          `Could not drop the waiting change of flight booking ${booking._id.toString()}`,
          error instanceof Error ? error.stack : undefined,
        );
      } finally {
        await session.endSession();
      }
    }
  }

  private async cancelActiveBookings(
    flightId: string,
    now: Date,
  ): Promise<number> {
    let handled = 0;
    // Bookings that failed twice in this run: left out of the next batches.
    const failed: Types.ObjectId[] = [];
    for (;;) {
      const batch = await this.bookings
        .find(
          {
            _id: { $nin: failed },
            'segments.flightId': new Types.ObjectId(flightId),
            status: {
              $in: [
                FlightBookingStatus.CONFIRMED,
                FlightBookingStatus.PENDING_PAYMENT,
              ],
            },
          },
          {
            userId: 1,
            status: 1,
            reference: 1,
            seatCount: 1,
            'pricing.totalMinor': 1,
            'pricing.currency': 1,
            'segments.flightId': 1,
            'segments.cabinId': 1,
            'pendingChange._id': 1,
            'pendingChange.segment.flightId': 1,
            'pendingChange.segment.cabinId': 1,
            'changes._id': 1,
            'changes.differenceMinor': 1,
          },
        )
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .lean<ActiveBooking[]>();

      let skippedInBatch = 0;
      for (const booking of batch) {
        let outcome = await this.handle(booking, now);
        // S-08: flight.cancelled is never redelivered; try once more now.
        if (outcome === 'failed') outcome = await this.handle(booking, now);
        if (outcome === 'done') handled += 1;
        if (outcome === 'failed') failed.push(booking._id);
        if (outcome === 'skipped') skippedInBatch += 1;
      }

      // A skipped booking changed status after the scan (e.g. a payment
      // confirmed it), so scan again: it is found with its new status unless it
      // is finished. This ends: a skip means the booking moved forward in GEN-11
      // (at most two steps), and `failed` ones stay out of the scan.
      if (batch.length < BATCH_SIZE && skippedInBatch === 0) return handled;
    }
  }

  private async handle(booking: ActiveBooking, now: Date): Promise<Outcome> {
    const confirmed = booking.status === FlightBookingStatus.CONFIRMED;
    const items = booking.segments.map((segment) => ({
      flightId: segment.flightId.toString(),
      cabinId: segment.cabinId.toString(),
      seats: booking.seatCount,
    }));
    const session = await this.connection.startSession();
    let droppedChange = false;
    try {
      await session.withTransaction(async () => {
        droppedChange = false; // the callback may run again after a transient error
        if (confirmed) {
          await transitionStatus(
            this.bookings,
            booking._id,
            FlightBookingStatus.CONFIRMED,
            FlightBookingStatus.CANCELLED,
            {
              cancellation: {
                cancelledAt: now,
                cancelledBy: 'provider',
                refundPercent: 100,
                refundAmountMinor: booking.pricing.totalMinor,
              },
            },
            { session },
          );
          await this.seatInventory.returnBooked(items, { session });
          // FLT-27: a change waiting for payment goes too, with its held seats.
          droppedChange = await dropPendingChange(
            this.bookings,
            this.seatInventory,
            booking,
            session,
          );
        } else {
          await transitionStatus(
            this.bookings,
            booking._id,
            FlightBookingStatus.PENDING_PAYMENT,
            FlightBookingStatus.EXPIRED,
            { expiredAt: now },
            { session },
          );
          await this.seatInventory.release(items, { session });
        }
      });
    } catch (error) {
      // Lost a race (the user cancelled, a payment confirmed it, the expiry job ran).
      if (isInvalidTransition(error)) return 'skipped';
      this.logger.error(
        `Could not ${confirmed ? 'cancel' : 'expire'} flight booking ${booking._id.toString()}`,
        error instanceof Error ? error.stack : undefined,
      );
      return 'failed';
    } finally {
      await session.endSession();
    }

    // After the commit: a refund or an event can't be rolled back.
    const bookingId = booking._id.toString();
    const userId = booking.userId.toString();
    if (!confirmed) {
      this.events.emit(Events.FlightBookingExpired, { bookingId, userId });
      return 'done';
    }
    if (droppedChange && booking.pendingChange) {
      this.events.emit(Events.FlightBookingChangeExpired, {
        bookingId,
        userId,
        changeId: booking.pendingChange._id.toString(),
      });
    }
    try {
      // FLT-27: after a paid change, each payment is refunded in full.
      const paid = booking.changes?.find((c) => c.differenceMinor > 0);
      const split = splitCancellationRefund(
        booking.pricing.totalMinor,
        100,
        paid?.differenceMinor ?? 0,
      );
      if (split.firstPaymentMinor > 0) {
        await this.payments.refund({
          bookingType: BookingType.FLIGHT,
          bookingId,
          userId,
          amountMinor: split.firstPaymentMinor,
          currency: booking.pricing.currency,
          reason: 'provider_cancellation',
        });
      }
      if (paid && split.changePaymentMinor > 0) {
        await this.payments.refund({
          bookingType: BookingType.FLIGHT,
          bookingId,
          userId,
          amountMinor: split.changePaymentMinor,
          currency: booking.pricing.currency,
          reason: 'provider_cancellation',
          changeId: paid._id.toString(),
        });
      }
    } catch (error) {
      // The cancellation is committed and the passenger is told; the refund for
      // this booking needs following up. This is the same known gap as in
      // `FlightCancellationService.cancel`: a non-Stripe error here leaves no
      // refund record, and retrying belongs to its own ticket (see there).
      this.logger.error(
        `Could not request the refund of flight booking ${bookingId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
    if (booking.reference) {
      this.events.emit(Events.FlightBookingCancelled, {
        bookingId,
        userId,
        reference: booking.reference,
      });
    }
    return 'done';
  }
}
