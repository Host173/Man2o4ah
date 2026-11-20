import { Inject, Injectable, Logger } from '@nestjs/common';
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
import {
  FlightBooking,
  FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

/**
 * The injection token for the reference maker (`newBookingReference` in the
 * app). Injected, so tests can choose the references, e.g. to force a clash.
 */
export const BOOKING_REFERENCE = Symbol('BOOKING_REFERENCE');

/** A clash between random references is rare; a few tries are plenty. */
const MAX_REFERENCE_TRIES = 5;

/** MongoDB's duplicate-key error: here, the reference is already used. */
function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 11000;
}

/**
 * Confirms flight bookings when their payment succeeds (FLT-23). Payments emits
 * `payment.succeeded` only after verifying the Stripe webhook (PAY-01). In one
 * transaction the booking becomes `confirmed` with a new reference and its held
 * seats become booked. Idempotent: an event that arrives twice confirms once.
 * A payment that arrives after the hold expired is refunded in full instead.
 */
@Injectable()
export class FlightConfirmationService {
  private readonly logger = new Logger(FlightConfirmationService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    private readonly seatInventory: SeatInventory,
    private readonly events: AppEvents,
    private readonly payments: PaymentsService,
    @Inject(BOOKING_REFERENCE)
    private readonly newReference: () => string,
  ) {}

  @OnEvent(Events.PaymentSucceeded)
  async onPaymentSucceeded(
    payload: PayloadOf<typeof Events.PaymentSucceeded>,
  ): Promise<void> {
    // Both booking modules listen to this event; hotels are not ours.
    if (payload.bookingType !== BookingType.FLIGHT) return;
    try {
      await this.confirm(payload.bookingId, new Date());
    } catch (error) {
      // A listener must not throw: log it so the payment can be followed up.
      this.logger.error(
        `Could not confirm flight booking ${payload.bookingId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** pending_payment → confirmed with a new reference, held seats → booked. */
  private async confirm(bookingId: string, now: Date): Promise<void> {
    if (!Types.ObjectId.isValid(bookingId)) return;
    const booking = await this.bookingModel
      .findById(bookingId, {
        userId: 1,
        seatCount: 1,
        'segments.flightId': 1,
        'segments.cabinId': 1,
      })
      .lean();
    if (!booking) return;

    for (let attempt = 1; attempt <= MAX_REFERENCE_TRIES; attempt += 1) {
      const reference = this.newReference();
      const session = await this.connection.startSession();
      try {
        // The status and the seat counters change together, or not at all.
        await session.withTransaction(async () => {
          await transitionStatus(
            this.bookingModel,
            bookingId,
            FlightBookingStatus.PENDING_PAYMENT,
            FlightBookingStatus.CONFIRMED,
            { confirmedAt: now, reference },
            { session },
          );
          await this.seatInventory.confirm(
            booking.segments.map((s) => ({
              flightId: s.flightId.toString(),
              cabinId: s.cabinId.toString(),
              seats: booking.seatCount,
            })),
            { session },
          );
        });
      } catch (error) {
        if (isDuplicateKey(error)) continue; // reference taken: try another
        // Not pending any more: already confirmed (a duplicate event, nothing
        // to do) or expired before the payment arrived (late payment).
        if (isInvalidTransition(error)) return this.refundIfLate(bookingId);
        throw error;
      } finally {
        await session.endSession();
      }

      // After the commit: an event can't be rolled back.
      this.events.emit(Events.FlightBookingConfirmed, {
        bookingId,
        userId: booking.userId.toString(),
        reference,
      });
      return;
    }
    throw new Error(
      `No free reference after ${MAX_REFERENCE_TRIES} tries for ${bookingId}`,
    );
  }

  /**
   * The payment came after the hold expired (§8.6, data-model §8 #14): the
   * seats may already be someone else's, so the booking is not confirmed and
   * the whole amount is refunded. Payments keeps one refund per booking, so a
   * repeated event can't refund twice. Only `expired` qualifies: a confirmed
   * booking is never refunded here.
   */
  private async refundIfLate(bookingId: string): Promise<void> {
    const booking = await this.bookingModel
      .findById(bookingId, { status: 1, userId: 1, pricing: 1 })
      .lean();
    if (booking?.status !== FlightBookingStatus.EXPIRED) return;

    await this.payments.refund({
      bookingType: BookingType.FLIGHT,
      bookingId,
      userId: booking.userId.toString(),
      amountMinor: booking.pricing.totalMinor,
      currency: booking.pricing.currency,
      reason: 'late_payment',
    });
  }
}
