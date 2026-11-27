import type { BookingType } from '../../../common/database/booking-type.js';

/** Injection token of the `StripeGateway` (PAY-01). */
export const STRIPE_GATEWAY = Symbol('STRIPE_GATEWAY');

/** The input of `StripeGateway.createPaymentIntent` (PAY-01). */
export interface CreatePaymentIntentInput {
  amountMinor: number;
  currency: string;
  /** `changeId` only for a flight change (FLT-27). */
  metadata: { bookingType: BookingType; bookingId: string; changeId?: string };
  /** pi-<type>-<bookingId>, or pi-<type>-<bookingId>-<changeId> for a change */
  idempotencyKey: string;
}

/** A PaymentIntent, reduced to what payments uses (PAY-01). */
export interface GatewayPaymentIntent {
  id: string;
  clientSecret: string;
  status: string;
}

/** A Stripe refund status (PAY-03). */
export type GatewayRefundStatus =
  'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled';

/** The input of `StripeGateway.createRefund` (PAY-03). */
export interface CreateRefundInput {
  paymentIntentId: string;
  amountMinor: number;
  /** refund-<refundId> */
  idempotencyKey: string;
  metadata: { refundId: string };
}

/** A Stripe refund, reduced to what payments uses (PAY-03). */
export interface GatewayRefund {
  id: string;
  status: GatewayRefundStatus;
}

/** A verified webhook event, reduced to what payments uses (PAY-01, PAY-03). */
export type GatewayEvent =
  | {
      id: string;
      type: 'payment_intent.succeeded' | 'payment_intent.payment_failed';
      paymentIntent: { id: string; metadata: Record<string, string> };
    }
  | {
      id: string;
      type: 'refund.updated' | 'refund.failed';
      refund: {
        id: string;
        status: GatewayRefundStatus;
        metadata: Record<string, string>;
      };
    }
  | { id: string; type: 'ignored'; originalType: string };

/** The only code that talks to Stripe (PAY-01). Tests use FakeStripeGateway. */
export interface StripeGateway {
  /** Creates the PaymentIntent; the same idempotency key returns the same one (PAY-01). */
  createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<GatewayPaymentIntent>;
  /** Cancels an unpaid PaymentIntent, e.g. after the hold expired (PAY-01). */
  cancelPaymentIntent(paymentIntentId: string): Promise<void>;
  /** Asks Stripe for the refund; the same idempotency key returns the same one (PAY-03). */
  createRefund(input: CreateRefundInput): Promise<GatewayRefund>;
  /** Verifies the signature; throws 400 BAD_SIGNATURE if it doesn't match (PAY-01). */
  parseWebhook(rawBody: Buffer, signature: string): GatewayEvent;
}
