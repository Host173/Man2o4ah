import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import type { BookingType } from '../../common/database/booking-type.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import type { RefundRequest, RefundView } from './payments.types.js';
import {
  assertRefundAmount,
  assertRefundIds,
  checkRefundRequest,
  refundStatusAfter,
  refundStatusFromGateway,
} from './refund-rules.js';
import type { PaymentStatus } from './schemas/payment.schema.js';
import { Payment } from './schemas/payment.schema.js';
import { Refund } from './schemas/refund.schema.js';
import type { RefundReason, RefundStatus } from './schemas/refund.schema.js';
import { StripeWebhookEvent } from './schemas/stripe-webhook-event.schema.js';
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';
import type {
  GatewayEvent,
  GatewayRefund,
  StripeGateway,
} from './stripe/stripe-gateway.js';

/** MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/** The refund branch of a verified webhook event. */
export type RefundWebhookEvent = Extract<GatewayEvent, { refund: unknown }>;

/** A refund as read from the database. */
interface RefundRecord {
  _id: Types.ObjectId;
  paymentId: Types.ObjectId;
  bookingType: BookingType;
  bookingId: Types.ObjectId;
  userId: Types.ObjectId;
  stripeRefundId?: string;
  amountMinor: number;
  currency: string;
  reason: RefundReason;
  status: RefundStatus;
}

/** The payment fields a refund needs. */
interface PaymentRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  stripePaymentIntentId: string;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === DUPLICATE_KEY
  );
}

/**
 * Creates refunds, asks Stripe for them and follows their status through the
 * webhook (PAY-03). Internal to payments: other modules call it through
 * `PaymentsService`. One refund per booking; a Stripe failure is stored as
 * `failed`, never thrown, because the caller's cancellation is already committed.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(StripeWebhookEvent.name)
    private readonly webhookEvents: Model<StripeWebhookEvent>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway,
    private readonly events: AppEvents,
  ) {}

  /** See `PaymentsService.refund`. */
  async refund(request: RefundRequest): Promise<RefundView> {
    // Nothing is read before these checks.
    assertRefundAmount(request.amountMinor);
    assertRefundIds(request);
    const booking = {
      bookingType: request.bookingType,
      bookingId: new Types.ObjectId(request.bookingId),
    };
    const changeId =
      request.changeId === undefined
        ? undefined
        : new Types.ObjectId(request.changeId);
    // `changeId: null` also matches refunds without the field: the cancellation one.
    const filter = { ...booking, changeId: changeId ?? null };

    // One refund per booking (and per change): a second call returns the first,
    // whatever its arguments.
    const existing = await this.refunds.findOne(filter).lean<RefundRecord>();
    if (existing) return this.toView(existing);

    const payment = await this.payments.findOne(booking).lean<PaymentRecord>();
    const paid = payment
      ? {
          status: payment.status,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          userId: payment.userId.toString(),
          id: payment._id,
          paymentIntentId: payment.stripePaymentIntentId,
        }
      : null;
    checkRefundRequest(request, paid);

    let created: { _id: Types.ObjectId };
    try {
      [created] = await this.refunds.create([
        {
          paymentId: paid.id,
          ...booking,
          ...(changeId ? { changeId } : {}),
          userId: new Types.ObjectId(request.userId),
          amountMinor: request.amountMinor,
          currency: request.currency,
          reason: request.reason,
          status: 'pending',
        },
      ]);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Another call won the race: it asks Stripe and emits, this one doesn't.
      const winner = await this.refunds.findOne(filter).lean<RefundRecord>();
      if (!winner) throw error;
      return this.toView(winner);
    }

    const refundId = created._id.toString();
    let result: GatewayRefund | null = null;
    try {
      result = await this.gateway.createRefund({
        paymentIntentId: paid.paymentIntentId,
        amountMinor: request.amountMinor,
        idempotencyKey: `refund-${refundId}`,
        metadata: { refundId },
      });
    } catch (error) {
      // The cancellation is already committed: keep the refund, visible as failed.
      this.logger.warn(
        `Stripe did not accept refund ${refundId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    // Conditional on `pending`: a webhook may already have moved it.
    const written = await this.refunds.updateOne(
      { _id: created._id, status: 'pending' },
      {
        $set: result
          ? {
              stripeRefundId: result.id,
              status: refundStatusFromGateway(result.status),
            }
          : { status: 'failed' },
      },
    );

    // Read the stored status back: it is the one to show and to announce.
    const stored = await this.refunds
      .findById(created._id)
      .lean<RefundRecord>();
    if (!stored) throw new Error(`Refund ${refundId} disappeared after saving`);
    // Announce it only if this call wrote the status: when a webhook got there
    // first, the webhook already announced it.
    if (written.modifiedCount === 1) {
      this.events.emit(Events.RefundUpdated, {
        refundId,
        userId: stored.userId.toString(),
        status: stored.status,
      });
    }
    return this.toView(stored);
  }

  /** See `PaymentsService.getRefund`. */
  async getRefund(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<RefundView | null> {
    // The cancellation refund only; a change refund (FLT-27) has a changeId.
    const refund = await this.refunds
      .findOne({
        bookingType,
        bookingId: new Types.ObjectId(bookingId),
        changeId: null,
      })
      .lean<RefundRecord>();
    return refund ? this.toView(refund) : null;
  }

  /** The user's refund; another user's refund is a 404, never a 403. */
  async getOwn(userId: string, refundId: string): Promise<RefundView> {
    const refund = await this.refunds
      .findOne({
        _id: new Types.ObjectId(refundId),
        userId: new Types.ObjectId(userId),
      })
      .lean<RefundRecord>();
    if (!refund) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Refund not found',
      });
    }
    return this.toView(refund);
  }

  /**
   * Follows a refund's status through Stripe's webhook (PAY-03). The event is
   * recorded and the refund updated in one transaction, so a crash between the
   * two can't make Stripe's retry look like a duplicate. `refund.updated` is
   * emitted after the commit.
   */
  async handleWebhookEvent(event: RefundWebhookEvent): Promise<void> {
    let moved: {
      refundId: string;
      userId: string;
      status: RefundStatus;
    } | null = null;
    try {
      await this.connection.transaction(async (session) => {
        // The helper may run this function again after a write conflict.
        moved = null;
        await this.webhookEvents.create(
          [{ _id: event.id, type: event.type, receivedAt: new Date() }],
          { session },
        );
        const refund = await this.findForEvent(event, session);
        if (!refund) {
          this.logger.warn(`Webhook event ${event.id}: no matching refund`);
          return;
        }
        const next = refundStatusAfter(event.refund.status, refund.status);
        // Our link to Stripe's refund is stored once, when it is still missing.
        const set = {
          ...(refund.stripeRefundId ? {} : { stripeRefundId: event.refund.id }),
          ...(next === null ? {} : { status: next }),
        };
        if (Object.keys(set).length === 0) return;
        const result = await this.refunds.updateOne(
          { _id: refund._id, status: refund.status },
          { $set: set },
          { session },
        );
        if (next !== null && result.modifiedCount === 1) {
          moved = {
            refundId: refund._id.toString(),
            userId: refund.userId.toString(),
            status: next,
          };
        }
      });
    } catch (error) {
      // The event was already processed (also after the helper's retry).
      if (isDuplicateKey(error)) return;
      throw error;
    }

    // After the commit: an event can't be rolled back. The IDs come from our
    // refund document, never from the event.
    if (moved) this.events.emit(Events.RefundUpdated, moved);
  }

  /** The refund of an event: by Stripe's id, else by our id in its metadata. */
  private async findForEvent(
    event: RefundWebhookEvent,
    session: ClientSession,
  ): Promise<RefundRecord | null> {
    const byStripeId = await this.refunds
      .findOne({ stripeRefundId: event.refund.id }, null, { session })
      .lean<RefundRecord>();
    if (byStripeId) return byStripeId;
    // Stripe's event can arrive before our own update stored its id.
    const ourId = event.refund.metadata.refundId;
    if (typeof ourId !== 'string' || !/^[0-9a-f]{24}$/.test(ourId)) {
      return null;
    }
    return this.refunds
      .findById(new Types.ObjectId(ourId), null, { session })
      .lean<RefundRecord>();
  }

  private toView(refund: RefundRecord): RefundView {
    return {
      refundId: refund._id.toString(),
      bookingType: refund.bookingType,
      bookingId: refund.bookingId.toString(),
      amountMinor: refund.amountMinor,
      currency: refund.currency,
      reason: refund.reason,
      status: refund.status,
    };
  }
}
