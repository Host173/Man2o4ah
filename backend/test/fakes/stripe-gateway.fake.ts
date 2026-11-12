import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type {
  CreatePaymentIntentInput,
  CreateRefundInput,
  GatewayEvent,
  GatewayPaymentIntent,
  GatewayRefund,
  GatewayRefundStatus,
  StripeGateway,
} from '../../src/modules/payments/stripe/stripe-gateway.js';

/** The only signature `FakeStripeGateway.parseWebhook` accepts. */
export const FAKE_STRIPE_SIGNATURE = 'fake-stripe-signature';

export type GatewayMethod = keyof StripeGateway;

/** A working `StripeGateway`: idempotent like Stripe, with a call log and failures on demand. */
export class FakeStripeGateway implements StripeGateway {
  /** Every call, in order. */
  readonly calls: { method: GatewayMethod; input: unknown }[] = [];
  /** The status of the next refunds created. */
  nextRefundStatus: GatewayRefundStatus = 'pending';

  private readonly intents = new Map<string, GatewayPaymentIntent>();
  private readonly refunds = new Map<string, GatewayRefund>();
  private readonly failing = new Set<GatewayMethod>();
  private intentCount = 0;
  private refundCount = 0;

  /** Makes the next call of `method` throw an `Error`, once. */
  failNext(method: GatewayMethod): void {
    this.failing.add(method);
  }

  // The async methods reject the promise when a failure is set with failNext.
  async createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<GatewayPaymentIntent> {
    this.record('createPaymentIntent', input);
    const existing = this.intents.get(input.idempotencyKey);
    if (existing) return existing;
    this.intentCount += 1;
    const id = `pi_fake_${this.intentCount}`;
    const intent = {
      id,
      clientSecret: `${id}_secret`,
      status: 'requires_payment_method',
    };
    this.intents.set(input.idempotencyKey, intent);
    return intent;
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<void> {
    this.record('cancelPaymentIntent', paymentIntentId);
  }

  async createRefund(input: CreateRefundInput): Promise<GatewayRefund> {
    this.record('createRefund', input);
    const existing = this.refunds.get(input.idempotencyKey);
    if (existing) return existing;
    this.refundCount += 1;
    const refund = {
      id: `re_fake_${this.refundCount}`,
      status: this.nextRefundStatus,
    };
    this.refunds.set(input.idempotencyKey, refund);
    return refund;
  }

  parseWebhook(rawBody: Buffer, signature: string): GatewayEvent {
    this.record('parseWebhook', { rawBody, signature });
    if (signature !== FAKE_STRIPE_SIGNATURE) {
      throw new BadRequestException({
        code: ErrorCode.BadSignature,
        message: 'Invalid webhook signature',
      });
    }
    return JSON.parse(rawBody.toString('utf8')) as GatewayEvent;
  }

  private record(method: GatewayMethod, input: unknown): void {
    this.calls.push({ method, input });
    if (this.failing.delete(method)) {
      throw new Error(`FakeStripeGateway: ${method} failed on purpose`);
    }
  }
}
