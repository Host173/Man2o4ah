import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type {
  CreatePaymentIntentInput,
  CreateRefundInput,
  GatewayEvent,
  GatewayPaymentIntent,
  GatewayRefund,
  GatewayRefundStatus,
  StripeGateway,
} from './stripe-gateway.js';

/** Injection token of the Stripe client (null when no key is configured). */
export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

/** The Stripe client, or null when STRIPE_SECRET_KEY isn't set (tests, offline development). */
export function createStripeClient(config: ConfigService): Stripe | null {
  const key = config.get<string>('STRIPE_SECRET_KEY');
  // `new Stripe` makes no network call; the package pins its own API version.
  return key ? new Stripe(key) : null;
}

const REFUND_STATUSES: readonly GatewayRefundStatus[] = [
  'pending',
  'requires_action',
  'succeeded',
  'failed',
  'canceled',
];

/** An unknown Stripe refund status is treated as still pending. */
function toRefundStatus(status: string | null): GatewayRefundStatus {
  return REFUND_STATUSES.find((known) => known === status) ?? 'pending';
}

/** Keeps only the metadata values that are strings. */
function stringMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

/** The only code that talks to Stripe (PAY-01). Card data never reaches it: the browser pays with the client secret. */
@Injectable()
export class StripeApiGateway implements StripeGateway {
  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe | null,
    private readonly config: ConfigService,
  ) {}

  async createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<GatewayPaymentIntent> {
    const intent = await this.client().paymentIntents.create(
      {
        amount: input.amountMinor,
        currency: input.currency.toLowerCase(),
        metadata: input.metadata,
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (!intent.client_secret) {
      throw new Error(
        'Stripe returned a PaymentIntent without a client secret',
      );
    }
    return {
      id: intent.id,
      clientSecret: intent.client_secret,
      status: intent.status,
    };
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<void> {
    const client = this.client();
    try {
      await client.paymentIntents.cancel(paymentIntentId);
    } catch (error) {
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === 'payment_intent_unexpected_state'
      ) {
        const current = await client.paymentIntents.retrieve(paymentIntentId);
        // Already cancelled: nothing left to do. Anything else (e.g. succeeded) is a real error.
        if (current.status === 'canceled') return;
      }
      throw error;
    }
  }

  async createRefund(input: CreateRefundInput): Promise<GatewayRefund> {
    const refund = await this.client().refunds.create(
      {
        payment_intent: input.paymentIntentId,
        amount: input.amountMinor,
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { id: refund.id, status: toRefundStatus(refund.status) };
  }

  parseWebhook(rawBody: Buffer, signature: string): GatewayEvent {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');

    // Outside the try: a missing client is a setup error (500), not a bad signature.
    const client = this.client();
    let event: Stripe.Event;
    try {
      event = client.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException({
        code: ErrorCode.BadSignature,
        message: 'Invalid webhook signature',
      });
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed': {
        const intent = event.data.object;
        return {
          id: event.id,
          type: event.type,
          paymentIntent: {
            id: intent.id,
            metadata: stringMetadata(intent.metadata),
          },
        };
      }
      case 'refund.updated':
      case 'refund.failed': {
        const refund = event.data.object;
        return {
          id: event.id,
          type: event.type,
          refund: {
            id: refund.id,
            status: toRefundStatus(refund.status),
            metadata: stringMetadata(refund.metadata),
          },
        };
      }
      default:
        return { id: event.id, type: 'ignored', originalType: event.type };
    }
  }

  /** The client, or a setup error (a 500: the server isn't configured, the user did nothing wrong). */
  private client(): Stripe {
    if (!this.stripe) {
      throw new Error(
        'Stripe is not configured: set STRIPE_SECRET_KEY in backend/.env',
      );
    }
    return this.stripe;
  }
}
