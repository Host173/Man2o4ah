import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { BookingType } from '../../common/database/booking-type.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import type { PayloadOf } from '../../common/events/event-payloads.js';
import { Events } from '../../common/events/events.js';
import { PaymentsService } from '../payments/payments.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { isInvalidTransition, transitionStatus } from './booking-lifecycle.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

/**
 * The injection token for the reference maker (`newReservationReference` in
 * the app). Injected, so tests can choose the references, e.g. to force a clash.
 */
export const RESERVATION_REFERENCE = Symbol('RESERVATION_REFERENCE');

/** A clash between random references is rare; a few tries are plenty. */
const MAX_REFERENCE_TRIES = 5;

/** MongoDB's duplicate-key error: here, the reference is already used. */
function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 11000;
}

/**
 * Confirms hotel reservations when their payment succeeds (HTL-17). Payments
 * emits `payment.succeeded` only after verifying the Stripe webhook (PAY-01);
 * this module never trusts the frontend. Idempotent: an event that arrives
 * twice confirms once.
 */
@Injectable()
export class HotelConfirmationService {
  private readonly logger = new Logger(HotelConfirmationService.name);

  constructor(
    @InjectModel(HotelReservation.name)
    private readonly reservationModel: Model<HotelReservation>,
    private readonly events: AppEvents,
    @Inject(RESERVATION_REFERENCE)
    private readonly newReference: () => string,
    private readonly payments: PaymentsService,
    private readonly accounts: AccountsService,
    private readonly roomNights: RoomNightInventory,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  @OnEvent(Events.PaymentSucceeded)
  async onPaymentSucceeded(
    payload: PayloadOf<typeof Events.PaymentSucceeded>,
  ): Promise<void> {
    // Both booking modules listen to this event; flights are not ours.
    if (payload.bookingType !== BookingType.HOTEL) return;
    try {
      await this.confirm(payload.bookingId, new Date());
    } catch (error) {
      // A listener must not throw: log it so the payment can be followed up.
      this.logger.error(
        `Could not confirm hotel reservation ${payload.bookingId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** pending_payment → confirmed with a new reference; nothing if it isn't pending. */
  private async confirm(reservationId: string, now: Date): Promise<void> {
    if (!Types.ObjectId.isValid(reservationId)) return;
    const reservation = await this.reservationModel
      .findById(reservationId, { userId: 1 })
      .lean();
    if (!reservation) return;
    const userId = reservation.userId.toString();

    for (let attempt = 1; attempt <= MAX_REFERENCE_TRIES; attempt += 1) {
      const reference = this.newReference();
      const session = await this.connection.startSession();
      let confirmed: boolean;
      try {
        confirmed = await session.withTransaction(async () => {
          const canConfirm = await this.accounts.tryLockForBookingConfirmation(
            userId,
            {
              session,
            },
          );
          if (!canConfirm) {
            await transitionStatus(
              this.reservationModel,
              reservationId,
              HotelReservationStatus.PENDING_PAYMENT,
              HotelReservationStatus.EXPIRED,
              { expiredAt: now },
              { session },
            );
            await this.roomNights.release(reservationId, { session });
            return false;
          }
          await transitionStatus(
            this.reservationModel,
            reservationId,
            HotelReservationStatus.PENDING_PAYMENT,
            HotelReservationStatus.CONFIRMED,
            { confirmedAt: now, reference },
            { session },
          );
          return true;
        });
      } catch (error) {
        if (isDuplicateKey(error)) continue; // reference taken: try another
        // Not pending any more: already confirmed (a duplicate event, nothing
        // to do), unknown, or expired before the payment arrived (late payment).
        if (isInvalidTransition(error)) return this.refundIfLate(reservationId);
        throw error;
      } finally {
        await session.endSession();
      }

      if (!confirmed) {
        this.events.emit(Events.HotelReservationExpired, {
          bookingId: reservationId,
          userId,
        });
        await this.refundIfLate(reservationId);
        return;
      }
      this.events.emit(Events.HotelReservationConfirmed, {
        bookingId: reservationId,
        userId,
        reference,
      });
      return;
    }
    throw new Error(
      `No free reference after ${MAX_REFERENCE_TRIES} tries for ${reservationId}`,
    );
  }

  /**
   * The confirmation came after the hold ended (§8.6, data-model §8 #14,
   * ACC-12 deactivation): the
   * rooms may already be someone else's, so the reservation is not confirmed
   * and the whole amount is refunded. Payments keeps one refund per booking,
   * so a repeated event can't refund twice. Only `expired` qualifies: a
   * confirmed reservation is never refunded here.
   */
  private async refundIfLate(reservationId: string): Promise<void> {
    const reservation = await this.reservationModel
      .findById(reservationId, {
        status: 1,
        userId: 1,
        totalMinor: 1,
        currency: 1,
      })
      .lean();
    if (reservation?.status !== HotelReservationStatus.EXPIRED) return;

    await this.payments.refund({
      bookingType: BookingType.HOTEL,
      bookingId: reservationId,
      userId: reservation.userId.toString(),
      amountMinor: reservation.totalMinor,
      currency: reservation.currency,
      reason: 'late_payment',
    });
  }
}
