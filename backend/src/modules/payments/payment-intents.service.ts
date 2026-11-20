import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import type { BookingType } from '../../common/database/booking-type.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { decidePaymentStart, paymentStatusAfter } from './payment-rules.js';
import type { PaymentSession, PaymentView } from './payments.types.js';
import type { Payable } from './ports/payable-booking.port.js';
import { PayableBookingRegistry } from './ports/payable-booking.registry.js';
import { RefundsService } from './refunds.service.js';
import { Payment } from './schemas/payment.schema.js';
import type { PaymentStatus } from './schemas/payment.schema.js';
import { PolicyAcceptance } from './schemas/policy-acceptance.schema.js';
import { StripeWebhookEvent } from './schemas/stripe-webhook-event.schema.js';
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';
import type { StripeGateway } from './stripe/stripe-gateway.js';

/** MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/** A payment as read from the database (timestamps are added by the schema). */
interface PaymentRecord {
  _id: Types.ObjectId;
  bookingType: BookingType;
  bookingId: Types.ObjectId;
  userId: Types.ObjectId;
  stripePaymentIntentId: string;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  createdAt: Date;
}

/** The PaymentIntent of a booking, as `start` and `retry` need it. */
interface Intent {
  id: string;
  clientSecret: string;
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === DUPLICATE_KEY
  );
}

/** The Stripe idempotency key of a booking's PaymentIntent: one per booking (PAY-01). */
export function idempotencyKey(
  bookingType: BookingType,
  bookingId: string,
): string {
  return `pi-${bookingType}-${bookingId}`;
}

/**
 * Starts, retries and confirms payments (PAY-01). Internal to payments: other
 * modules reach payments only through `PaymentsService`. A booking is confirmed
 * only by `handleWebhook`, after Stripe's signature is verified.
 */
@Injectable()
export class PaymentIntentsService {
  private readonly logger = new Logger(PaymentIntentsService.name);

  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(PolicyAcceptance.name)
    private readonly acceptances: Model<PolicyAcceptance>,
    @InjectModel(StripeWebhookEvent.name)
    private readonly webhookEvents: Model<StripeWebhookEvent>,
    @InjectConnection() private readonly connection: Connection,
    private readonly registry: PayableBookingRegistry,
    @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway,
    private readonly events: AppEvents,
    private readonly refunds: RefundsService,
  ) {}

  /**
   * Creates the booking's PaymentIntent, or reuses it (one payment per booking),
   * and returns what the browser needs to pay. The client secret is never
   * stored: Stripe returns the same one for the same idempotency key.
   */
  async start(
    userId: string,
    bookingType: BookingType,
    bookingId: string,
  ): Promise<PaymentSession> {
    // 404 NOT_FOUND passes through: the booking doesn't exist or isn't the user's.
    const payable = await this.registry
      .get(bookingType)
      .getPayable(bookingId, userId);
    const bookingObjectId = new Types.ObjectId(bookingId);
    const [accepted, existing] = await Promise.all([
      this.acceptances.exists({ bookingType, bookingId: bookingObjectId }),
      this.payments
        .findOne({ bookingType, bookingId: bookingObjectId })
        .lean<PaymentRecord>(),
    ]);

    const decision = decidePaymentStart({
      payable,
      now: new Date(),
      policiesAccepted: accepted !== null,
      existing: existing
        ? { id: existing._id.toString(), status: existing.status }
        : null,
    });

    const intent = await this.intentOf(bookingType, bookingId, payable);
    if (decision.action === 'reuse') {
      return this.session(decision.paymentId, intent, payable);
    }

    try {
      const [created] = await this.payments.create([
        {
          bookingType,
          bookingId: bookingObjectId,
          userId: new Types.ObjectId(userId),
          stripePaymentIntentId: intent.id,
          amountMinor: payable.amountMinor,
          currency: payable.currency,
          status: 'pending',
        },
      ]);
      return this.session(created._id.toString(), intent, payable);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Another request for the same booking won the race: continue as a reuse.
      const winner = await this.payments
        .findOne({ bookingType, bookingId: bookingObjectId }, { _id: 1 })
        .lean<{ _id: Types.ObjectId }>();
      if (!winner) throw error;
      return this.session(winner._id.toString(), intent, payable);
    }
  }

  /**
   * Lets the user pay again after a failed attempt: `failed` goes back to
   * `pending` and the same client secret is returned. Nothing changes if the
   * payment is paid, cancelled or its hold is over.
   */
  async retry(userId: string, paymentId: string): Promise<PaymentSession> {
    const payment = await this.findOwn(userId, paymentId);
    const bookingId = payment.bookingId.toString();
    const payable = await this.registry
      .get(payment.bookingType)
      .getPayable(bookingId, userId);
    const accepted = await this.acceptances.exists({
      bookingType: payment.bookingType,
      bookingId: payment.bookingId,
    });
    // Checked before anything changes: 409 for a paid, cancelled or expired payment.
    decidePaymentStart({
      payable,
      now: new Date(),
      policiesAccepted: accepted !== null,
      existing: { id: paymentId, status: payment.status },
    });

    if (payment.status === 'failed') {
      await this.payments.updateOne(
        { _id: payment._id, status: 'failed' },
        { $set: { status: 'pending' } },
      );
    }

    const intent = await this.intentOf(payment.bookingType, bookingId, payable);
    return this.session(paymentId, intent, payable);
  }

  /** The user's payment; another user's payment is a 404, never a 403. */
  async get(userId: string, paymentId: string): Promise<PaymentView> {
    const payment = await this.findOwn(userId, paymentId);
    return {
      _id: payment._id.toString(),
      bookingType: payment.bookingType,
      bookingId: payment.bookingId.toString(),
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      status: payment.status,
      createdAt: payment.createdAt,
    };
  }

  /**
   * Handles a Stripe webhook (PAY-01). The event is recorded and the payment
   * updated in one transaction, so a crash between the two can't make Stripe's
   * retry look like a duplicate. `payment.succeeded` is emitted after the commit.
   */
  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<void> {
    if (!rawBody || !signature) {
      throw new BadRequestException({
        code: ErrorCode.BadSignature,
        message: 'Invalid webhook signature',
      });
    }
    const event = this.gateway.parseWebhook(rawBody, signature);
    if (!('paymentIntent' in event)) {
      // Refund events are handled by the refunds service (PAY-03).
      if ('refund' in event) {
        await this.refunds.handleWebhookEvent(event);
        return;
      }
      this.logger.debug(`Ignoring webhook event ${event.originalType}`);
      return;
    }

    let confirmed: { bookingType: BookingType; bookingId: string } | null =
      null;
    try {
      await this.connection.transaction(async (session) => {
        // The helper may run this function again after a write conflict.
        confirmed = null;
        await this.webhookEvents.create(
          [{ _id: event.id, type: event.type, receivedAt: new Date() }],
          { session },
        );
        const payment = await this.payments
          .findOne({ stripePaymentIntentId: event.paymentIntent.id }, null, {
            session,
          })
          .lean<PaymentRecord>();
        if (!payment) {
          this.logger.warn(
            `Webhook event ${event.id}: no payment for its PaymentIntent`,
          );
          return;
        }
        const next = paymentStatusAfter(event.type, payment.status);
        if (next === null) return;
        const result = await this.payments.updateOne(
          { _id: payment._id, status: payment.status },
          { $set: { status: next } },
          { session },
        );
        if (result.modifiedCount === 1 && next === 'succeeded') {
          confirmed = {
            bookingType: payment.bookingType,
            bookingId: payment.bookingId.toString(),
          };
        }
      });
    } catch (error) {
      // The event was already processed (also after the helper's retry).
      if (isDuplicateKey(error)) return;
      throw error;
    }

    // After the commit: an event can't be rolled back. The IDs come from our
    // payment document, never from the event's metadata.
    if (confirmed) this.events.emit(Events.PaymentSucceeded, confirmed);
  }

  /** The user's payment, or 404 `Payment not found`. */
  private async findOwn(
    userId: string,
    paymentId: string,
  ): Promise<PaymentRecord> {
    const payment = await this.payments
      .findOne({
        _id: new Types.ObjectId(paymentId),
        userId: new Types.ObjectId(userId),
      })
      .lean<PaymentRecord>();
    if (!payment) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Payment not found',
      });
    }
    return payment;
  }

  /** The booking's PaymentIntent: the same call with the same key returns the same one. */
  private async intentOf(
    bookingType: BookingType,
    bookingId: string,
    payable: Payable,
  ): Promise<Intent> {
    const intent = await this.gateway.createPaymentIntent({
      amountMinor: payable.amountMinor,
      currency: payable.currency,
      metadata: { bookingType, bookingId },
      idempotencyKey: idempotencyKey(bookingType, bookingId),
    });
    return { id: intent.id, clientSecret: intent.clientSecret };
  }

  private session(
    paymentId: string,
    intent: Intent,
    payable: Payable,
  ): PaymentSession {
    return {
      paymentId,
      clientSecret: intent.clientSecret,
      amountMinor: payable.amountMinor,
      currency: payable.currency,
      holdExpiresAt: payable.holdExpiresAt,
    };
  }
}
