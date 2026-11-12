import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  CreatePaymentIntentInput,
  CreateRefundInput,
  GatewayEvent,
  GatewayPaymentIntent,
  GatewayRefund,
  StripeGateway,
} from './stripe-gateway.js';

/** Placeholder bound to `STRIPE_GATEWAY` until the real gateway lands in PAY-01. */
@Injectable()
export class StripeGatewayStub implements StripeGateway {
  /** Creates the PaymentIntent (PAY-01). Implemented in PAY-01. */
  createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<GatewayPaymentIntent> {
    void input;
    throw new NotImplementedException(
      'createPaymentIntent: implemented in PAY-01',
    );
  }

  /** Cancels a PaymentIntent (PAY-01). Implemented in PAY-01. */
  cancelPaymentIntent(paymentIntentId: string): Promise<void> {
    void paymentIntentId;
    throw new NotImplementedException(
      'cancelPaymentIntent: implemented in PAY-01',
    );
  }

  /** Creates a refund at Stripe (PAY-03). Implemented in PAY-01. */
  createRefund(input: CreateRefundInput): Promise<GatewayRefund> {
    void input;
    throw new NotImplementedException('createRefund: implemented in PAY-01');
  }

  /** Verifies and reduces a webhook (PAY-01). Implemented in PAY-01. */
  parseWebhook(rawBody: Buffer, signature: string): GatewayEvent {
    void rawBody;
    void signature;
    throw new NotImplementedException('parseWebhook: implemented in PAY-01');
  }
}
