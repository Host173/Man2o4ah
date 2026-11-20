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
        return {
          _id: booking._id.toHexString(),
          reference: booking.reference,
          status: FlightBookingStatus.CANCELLED,
          cancellation,
          currency: booking.pricing.currency,
        };
      });
    } finally {
      await session.endSession();
    }

    const { currency, ...result } = cancelled;
    try {
      const refund =
        result.cancellation.refundAmountMinor > 0
          ? await this.payments.refund({
              bookingType: BookingType.FLIGHT,
              bookingId: result._id,
              userId,
              amountMinor: result.cancellation.refundAmountMinor,
              currency,
              reason: 'user_cancellation',
            })
          : null;
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
