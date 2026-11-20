import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsController } from './payments.controller.js';
import { PaymentExpiryListener } from './payment-expiry.listener.js';
import { PaymentIntentsService } from './payment-intents.service.js';
import { PaymentsService } from './payments.service.js';
import { PoliciesController } from './policies.controller.js';
import { PolicyAcceptancesService } from './policy-acceptances.service.js';
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
import {
  createStripeClient,
  STRIPE_CLIENT,
  StripeApiGateway,
} from './stripe/stripe-api.gateway.js';
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
      { name: StripeWebhookEvent.name, schema: StripeWebhookEventSchema },
    ]),
  ],
  controllers: [PaymentsController, PoliciesController],
  providers: [
    PaymentsService,
    PaymentIntentsService,
    PolicyAcceptancesService,
    PaymentExpiryListener,
    PayableBookingRegistry,
    {
      provide: STRIPE_CLIENT,
      useFactory: createStripeClient,
      inject: [ConfigService],
    },
    { provide: STRIPE_GATEWAY, useClass: StripeApiGateway },
  ],
  exports: [PaymentsService, PayableBookingRegistry],
})
export class PaymentsModule {}
