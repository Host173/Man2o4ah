import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { BookingType } from '../../common/database/booking-type.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { PaymentsService } from '../payments/payments.service.js';
import { transitionStatus } from './booking-lifecycle.js';
import type {
  CancelledFlightBooking,
  FlightRefundPreview,
} from './flight-bookings.types.js';
import { splitCancellationRefund } from './flight-change.js';
import { dropPendingChange } from './pending-change.js';
import { refundFor } from './refund-tiers.js';
import {
  FlightBooking,
  FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

/** The refund and its start date come from the outbound segment (FLT-12a, FLT-26). */
function outbound(booking: FlightBooking) {
  return booking.segments[0];
}

/**
 * FLT-26: the owner cancels a whole confirmed booking before the outbound
 * flight departs. The refund uses the booking's snapshot tiers and the full
 * days left until the outbound departure (FLT-09), recalculated when the user
 * confirms. HTL-21's `HotelCancellationService` has the same shape.
 */
@Injectable()
export class FlightCancellationService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly seatInventory: SeatInventory,
    private readonly payments: PaymentsService,
    private readonly events: AppEvents,
  ) {}

  /** Read-only: the refund the owner would get now, for a confirmed booking that hasn't departed. */
  async refundPreview(
    id: string,
    userId: string,
  ): Promise<FlightRefundPreview> {
    const booking = await this.findOwned(id, userId);
    const now = new Date();
    this.assertCancellable(booking, now);
    return {
      ...refundFor(
        outbound(booking).policy.cancellationTiers,
        booking.pricing.totalMinor,
        booking.firstDepartureAt,
        now,
      ),
      currency: booking.pricing.currency,
    };
  }

  /**
   * Cancels the whole booking: the status change and the seats returning to
   * inventory happen in one transaction. Only after it commits is the refund
   * requested (PAY-03, only for an amount above 0) and the user notified. A
   * refund error propagates, but it can't undo the committed cancellation, and
   * the notification is still sent.
   */
  async cancel(id: string, userId: string): Promise<CancelledFlightBooking> {
    const session = await this.connection.startSession();
    let cancelled: Omit<CancelledFlightBooking, 'refund'> & {
      currency: string;
      /** The booking's paid change (FLT-27): its payment is refunded too. */
      paidChange: { changeId: string; amountMinor: number } | null;
      /** A change that waited for payment and was dropped here (FLT-27). */
      droppedChangeId: string | null;
    };
    try {
      // The booking is read again inside the transaction, so a cancellation
      // that won a race is seen here and answers 409 instead of acting twice.
      cancelled = await session.withTransaction(async () => {
        const booking = await this.findOwned(id, userId, session);
        const now = new Date();
        this.assertCancellable(booking, now);
        if (!booking.reference) {
          throw new InternalServerErrorException({
            code: ErrorCode.InternalError,
            message: 'Confirmed booking has no reference',
          });
        }
        const refund = refundFor(
          outbound(booking).policy.cancellationTiers,
          booking.pricing.totalMinor,
          booking.firstDepartureAt,
          now,
        );
        const cancellation: CancelledFlightBooking['cancellation'] = {
          cancelledAt: now,
          cancelledBy: 'user',
          refundPercent: refund.percent,
          refundAmountMinor: refund.amountMinor,
        };
        await transitionStatus(
          this.bookings,
          booking._id,
          FlightBookingStatus.CONFIRMED,
          FlightBookingStatus.CANCELLED,
          { cancellation },
          { session },
        );
        await this.seatInventory.returnBooked(
          booking.segments.map((segment) => ({
            flightId: segment.flightId.toString(),
            cabinId: segment.cabinId.toString(),
            seats: booking.seatCount,
          })),
          { session },
        );
        // FLT-27: a change waiting for payment goes too, with its held seats.
        const dropped = await dropPendingChange(
          this.bookings,
          this.seatInventory,
          booking,
          session,
        );
        const paid = booking.changes?.find((c) => c.differenceMinor > 0);
        return {
          _id: booking._id.toHexString(),
          reference: booking.reference,
          status: FlightBookingStatus.CANCELLED,
          cancellation,
          currency: booking.pricing.currency,
          paidChange: paid
            ? {
                changeId: paid._id.toHexString(),
                amountMinor: paid.differenceMinor,
              }
            : null,
          droppedChangeId:
            dropped && booking.pendingChange
              ? booking.pendingChange._id.toHexString()
              : null,
        };
      });
    } finally {
      await session.endSession();
    }

    const { currency, paidChange, droppedChangeId, ...result } = cancelled;
    if (droppedChangeId) {
      // Payments cancels the dropped change's PaymentIntent (or refunds it).
      this.events.emit(Events.FlightBookingChangeExpired, {
        bookingId: result._id,
        userId,
        changeId: droppedChangeId,
      });
    }
    // FLT-27: after a paid change the refund comes from both payments, each by
    // the same percent (one change per booking).
    const split = splitCancellationRefund(
      result.cancellation.refundAmountMinor,
      result.cancellation.refundPercent,
      paidChange?.amountMinor ?? 0,
    );
    // Known gap, decided for FLT-26: a Stripe failure is recorded by PAY-03 as a
    // `failed` refund, but any other error thrown here (e.g. the database) leaves
    // a cancelled booking with no refund record. HTL-21 behaves the same, and the
    // two booking modules must follow the same rule, so a fix (PAY-03 retrying, or
    // a job re-requesting refunds for cancelled bookings without one) is its own
    // ticket. Until then the error propagates and the user is still notified.
    try {
      const refund =
        split.firstPaymentMinor > 0
          ? await this.payments.refund({
              bookingType: BookingType.FLIGHT,
              bookingId: result._id,
              userId,
              amountMinor: split.firstPaymentMinor,
              currency,
              reason: 'user_cancellation',
            })
          : null;
      if (paidChange && split.changePaymentMinor > 0) {
        await this.payments.refund({
          bookingType: BookingType.FLIGHT,
          bookingId: result._id,
          userId,
          amountMinor: split.changePaymentMinor,
          currency,
          reason: 'user_cancellation',
          changeId: paidChange.changeId,
        });
      }
      return { ...result, refund };
    } finally {
      // The cancellation is committed, so the user is told even if PAY-03 failed.
      this.events.emit(Events.FlightBookingCancelled, {
        bookingId: result._id,
        userId,
        reference: result.reference,
      });
    }
  }

  /** The user's own booking; someone else's, an unknown id and a malformed id all look the same (ACC-11). */
  private async findOwned(id: string, userId: string, session?: ClientSession) {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) {
      throw this.notFound();
    }
    const booking = await this.bookings
      .findOne({ _id: id, userId })
      .session(session ?? null)
      .lean();
    if (!booking) throw this.notFound();
    return booking;
  }

  /** Only a confirmed booking whose outbound flight hasn't departed (at departure is too late). */
  private assertCancellable(booking: FlightBooking, now: Date): void {
    if (
      booking.status !== FlightBookingStatus.CONFIRMED ||
      booking.firstDepartureAt <= now
    ) {
      throw new ConflictException({
        code: ErrorCode.InvalidStatusTransition,
        message:
          'Only confirmed bookings whose first flight has not departed can be cancelled',
      });
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Flight booking not found',
    });
  }
}
