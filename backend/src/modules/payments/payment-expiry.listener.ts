import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { BookingType } from '../../common/database/booking-type.js';
import type { PayloadOf } from '../../common/events/event-payloads.js';
import { Events } from '../../common/events/events.js';
import { Payment } from './schemas/payment.schema.js';
import type { PaymentStatus } from './schemas/payment.schema.js';
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';
import type { StripeGateway } from './stripe/stripe-gateway.js';

/**
 * Cancels the PaymentIntent of a booking whose hold expired (PAY-01). A failure
 * is logged and never rethrown: an event handler must not break the booking
 * module's expiry job.
 */
@Injectable()
export class PaymentExpiryListener {
  private readonly logger = new Logger(PaymentExpiryListener.name);

  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway,
  ) {}

  @OnEvent(Events.FlightBookingExpired)
  async onFlightBookingExpired(
    event: PayloadOf<typeof Events.FlightBookingExpired>,
  ): Promise<void> {
    await this.cancel(BookingType.FLIGHT, event.bookingId);
  }

  @OnEvent(Events.HotelReservationExpired)
  async onHotelReservationExpired(
    event: PayloadOf<typeof Events.HotelReservationExpired>,
  ): Promise<void> {
    await this.cancel(BookingType.HOTEL, event.bookingId);
  }

  private async cancel(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<void> {
    try {
      const payment = await this.payments
        .findOne({ bookingType, bookingId: new Types.ObjectId(bookingId) })
        .lean<{
          _id: Types.ObjectId;
          stripePaymentIntentId: string;
          status: PaymentStatus;
        }>();
      if (!payment) return;
      if (payment.status !== 'pending' && payment.status !== 'failed') return;

      try {
        await this.gateway.cancelPaymentIntent(payment.stripePaymentIntentId);
      } catch {
        // E.g. the payment succeeded at the last second: leave the status. The
        // payment_intent.succeeded webhook records it and the booking module refunds it.
        this.logger.warn(
          `Could not cancel the PaymentIntent of ${bookingType} booking ${bookingId}`,
        );
        return;
      }
      await this.payments.updateOne(
        { _id: payment._id, status: payment.status },
        { $set: { status: 'canceled' } },
      );
    } catch (error) {
      this.logger.error(
        `Could not cancel the payment of ${bookingType} booking ${bookingId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
