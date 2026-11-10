import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from './schemas/payment.schema.js';
import {
  PolicyAcceptance,
  PolicyAcceptanceSchema,
} from './schemas/policy-acceptance.schema.js';
import { Refund, RefundSchema } from './schemas/refund.schema.js';
import {
  StripeWebhookEvent,
  StripeWebhookEventSchema,
} from './schemas/stripe-webhook-event.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
      { name: StripeWebhookEvent.name, schema: StripeWebhookEventSchema },
    ]),
  ],
})
export class PaymentsModule {}
