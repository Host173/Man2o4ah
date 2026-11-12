import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsService } from './payments.service.js';
import { PayableBookingRegistry } from './ports/payable-booking.registry.js';
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
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';
import { StripeGatewayStub } from './stripe/stripe-gateway.stub.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
      { name: StripeWebhookEvent.name, schema: StripeWebhookEventSchema },
    ]),
  ],
  providers: [
    PaymentsService,
    PayableBookingRegistry,
    { provide: STRIPE_GATEWAY, useClass: StripeGatewayStub },
  ],
  exports: [PaymentsService, PayableBookingRegistry],
})
export class PaymentsModule {}
