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
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { PaymentsService } from '../payments/payments.service.js';
import { transitionStatus } from './booking-lifecycle.js';
import type {
  CancelledHotelReservation,
  HotelRefundPreview,
} from './hotel-bookings.types.js';
import { refundFor } from './refund-tiers.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

@Injectable()
export class HotelCancellationService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservation>,
    private readonly roomNights: RoomNightInventory,
    private readonly payments: PaymentsService,
    private readonly events: AppEvents,
  ) {}

  /** HTL-21: read-only preview for the owner of a confirmed, not-yet-started stay. */
  async refundPreview(id: string, userId: string): Promise<HotelRefundPreview> {
    const reservation = await this.findOwned(id, userId);
    const now = new Date();
    this.assertCancellable(reservation, now);
    return {
      ...refundFor(
        reservation.policySnapshot.cancellationTiers,
        reservation.totalMinor,
        reservation.checkInDate,
        now,
      ),
      currency: reservation.currency,
    };
  }

  /**
   * HTL-21: cancel every room or none, recomputing the snapshot refund at cancellation
   * time. Only a positive amount goes to PAY-03, after the inventory transaction.
   * A post-commit refund error propagates; it cannot undo cancellation.
   */
  async cancel(id: string, userId: string): Promise<CancelledHotelReservation> {
    const session = await this.connection.startSession();
    let cancelled: Omit<CancelledHotelReservation, 'refund'> & {
      currency: string;
    };
    try {
      cancelled = await session.withTransaction(async () => {
        const reservation = await this.findOwned(id, userId, session);
        const now = new Date();
        this.assertCancellable(reservation, now);
        if (!reservation.reference) {
          throw new InternalServerErrorException({
            code: ErrorCode.InternalError,
            message: 'Confirmed reservation has no reference',
          });
        }
        const refund = refundFor(
          reservation.policySnapshot.cancellationTiers,
          reservation.totalMinor,
          reservation.checkInDate,
          now,
        );
        const cancellation: CancelledHotelReservation['cancellation'] = {
          cancelledAt: now,
          cancelledBy: 'user',
          refundPercent: refund.percent,
          refundAmountMinor: refund.amountMinor,
        };
        await transitionStatus(
          this.reservations,
          reservation._id,
          HotelReservationStatus.CONFIRMED,
          HotelReservationStatus.CANCELLED,
          { cancellation },
          { session },
        );
        await this.roomNights.release(reservation._id.toHexString(), {
          session,
        });
        return {
          _id: reservation._id.toHexString(),
          reference: reservation.reference,
          status: HotelReservationStatus.CANCELLED,
          cancellation,
          currency: reservation.currency,
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
              bookingType: BookingType.HOTEL,
              bookingId: result._id,
              userId,
              amountMinor: result.cancellation.refundAmountMinor,
              currency,
              reason: 'user_cancellation',
            })
          : null;
      return { ...result, refund };
    } finally {
      // A committed cancellation still needs its notification if PAY-03 fails.
      this.events.emit(Events.HotelReservationCancelled, {
        bookingId: result._id,
        userId,
        reference: result.reference,
      });
    }
  }

  private async findOwned(id: string, userId: string, session?: ClientSession) {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) {
      throw this.notFound();
    }
    const reservation = await this.reservations
      .findOne({ _id: id, userId })
      .session(session ?? null)
      .lean();
    if (!reservation) throw this.notFound();
    return reservation;
  }

  private assertCancellable(reservation: HotelReservation, now: Date): void {
    if (
      reservation.status !== HotelReservationStatus.CONFIRMED ||
      reservation.checkInDate <= now
    ) {
      throw new ConflictException({
        code: ErrorCode.InvalidStatusTransition,
        message:
          'Only confirmed reservations before the check-in date can be cancelled',
      });
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCode.NotFound,
      message: 'Reservation not found',
    });
  }
}
