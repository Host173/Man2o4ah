import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { vi } from 'vitest';
import { createStripeClient, StripeApiGateway } from './stripe-api.gateway.js';

const WEBHOOK_SECRET = 'whsec_test';

function configWith(values: Record<string, string>): ConfigService {
  return new ConfigService(values);
}

/** A stub client: no test ever calls Stripe. */
function stubClient() {
  const paymentIntents = {
    create: vi.fn(),
    cancel: vi.fn(),
    retrieve: vi.fn(),
  };
  const refunds = { create: vi.fn() };
  return {
    paymentIntents,
    refunds,
    client: { paymentIntents, refunds } as unknown as Stripe,
  };
}

function unexpectedState(): Error {
  return new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    code: 'payment_intent_unexpected_state',
    message: 'cannot cancel',
  });
}

describe('createStripeClient (PAY-01)', () => {
  it('is null when STRIPE_SECRET_KEY is not set', () => {
    expect(createStripeClient(configWith({}))).toBeNull();
  });

  it('builds a client when STRIPE_SECRET_KEY is set', () => {
    expect(
      createStripeClient(configWith({ STRIPE_SECRET_KEY: 'sk_test_dummy' })),
    ).toBeInstanceOf(Stripe);
  });
});

describe('StripeApiGateway.createPaymentIntent (PAY-01)', () => {
  it('sends the exact params and the idempotency key, and maps the result', async () => {
    const { client, paymentIntents } = stubClient();
    paymentIntents.create.mockResolvedValue({
      id: 'pi_1',
      client_secret: 'pi_1_secret_x',
      status: 'requires_payment_method',
    });
    const gateway = new StripeApiGateway(client, configWith({}));

    const result = await gateway.createPaymentIntent({
      amountMinor: 25_000,
      currency: 'USD',
      metadata: { bookingType: 'flight', bookingId: 'b1' },
      idempotencyKey: 'pi-flight-b1',
    });

    expect(paymentIntents.create).toHaveBeenCalledExactlyOnceWith(
      {
        amount: 25_000,
        currency: 'usd',
        metadata: { bookingType: 'flight', bookingId: 'b1' },
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: 'pi-flight-b1' },
    );
    expect(result).toEqual({
      id: 'pi_1',
      clientSecret: 'pi_1_secret_x',
      status: 'requires_payment_method',
    });
  });

  it('throws when Stripe returns no client secret', async () => {
    const { client, paymentIntents } = stubClient();
    paymentIntents.create.mockResolvedValue({
      id: 'pi_1',
      client_secret: null,
      status: 'requires_payment_method',
    });
    const gateway = new StripeApiGateway(client, configWith({}));

    await expect(
      gateway.createPaymentIntent({
        amountMinor: 100,
        currency: 'USD',
        metadata: { bookingType: 'hotel', bookingId: 'b2' },
        idempotencyKey: 'pi-hotel-b2',
      }),
    ).rejects.toThrow(/client secret/);
  });
});

describe('StripeApiGateway.cancelPaymentIntent (PAY-01)', () => {
  it('cancels the PaymentIntent', async () => {
    const { client, paymentIntents } = stubClient();
    paymentIntents.cancel.mockResolvedValue({ id: 'pi_1' });
    const gateway = new StripeApiGateway(client, configWith({}));

    await gateway.cancelPaymentIntent('pi_1');

    expect(paymentIntents.cancel).toHaveBeenCalledExactlyOnceWith('pi_1');
    expect(paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('resolves when Stripe says the state is unexpected but it is already canceled', async () => {
    const { client, paymentIntents } = stubClient();
    paymentIntents.cancel.mockRejectedValue(unexpectedState());
    paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1',
      status: 'canceled',
    });
    const gateway = new StripeApiGateway(client, configWith({}));

    await expect(gateway.cancelPaymentIntent('pi_1')).resolves.toBeUndefined();
    expect(paymentIntents.retrieve).toHaveBeenCalledExactlyOnceWith('pi_1');
  });

  it('rejects with the original error when the PaymentIntent already succeeded', async () => {
    const { client, paymentIntents } = stubClient();
    const original = unexpectedState();
    paymentIntents.cancel.mockRejectedValue(original);
    paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1',
      status: 'succeeded',
    });
    const gateway = new StripeApiGateway(client, configWith({}));

    await expect(gateway.cancelPaymentIntent('pi_1')).rejects.toBe(original);
  });

  it('rejects on any other error without looking the PaymentIntent up', async () => {
    const { client, paymentIntents } = stubClient();
    const boom = new Error('network down');
    paymentIntents.cancel.mockRejectedValue(boom);
    const gateway = new StripeApiGateway(client, configWith({}));

    await expect(gateway.cancelPaymentIntent('pi_1')).rejects.toBe(boom);
    expect(paymentIntents.retrieve).not.toHaveBeenCalled();
  });
});

describe('StripeApiGateway.createRefund (PAY-03, implemented here)', () => {
  it('sends the exact params and the idempotency key, and maps the result', async () => {
    const { client, refunds } = stubClient();
    refunds.create.mockResolvedValue({ id: 're_1', status: 'succeeded' });
    const gateway = new StripeApiGateway(client, configWith({}));

    const result = await gateway.createRefund({
      paymentIntentId: 'pi_1',
      amountMinor: 5_000,
      idempotencyKey: 'refund-r1',
      metadata: { refundId: 'r1' },
    });

    expect(refunds.create).toHaveBeenCalledExactlyOnceWith(
      {
        payment_intent: 'pi_1',
        amount: 5_000,
        metadata: { refundId: 'r1' },
      },
      { idempotencyKey: 'refund-r1' },
    );
    expect(result).toEqual({ id: 're_1', status: 'succeeded' });
  });

  it.each([
    ['requires_action', 'requires_action'],
    ['failed', 'failed'],
    ['canceled', 'canceled'],
    ['something_new', 'pending'],
    [null, 'pending'],
  ])('maps the Stripe status %j to %s', async (stripeStatus, expected) => {
    const { client, refunds } = stubClient();
    refunds.create.mockResolvedValue({ id: 're_1', status: stripeStatus });
    const gateway = new StripeApiGateway(client, configWith({}));

    const result = await gateway.createRefund({
      paymentIntentId: 'pi_1',
      amountMinor: 1,
      idempotencyKey: 'refund-r1',
      metadata: { refundId: 'r1' },
    });

    expect(result.status).toBe(expected);
  });
});

describe('StripeApiGateway.parseWebhook (PAY-01)', () => {
  // A real client: signature checking is local and needs no network.
  const real = new Stripe('sk_test_dummy');
  const gateway = new StripeApiGateway(
    real,
    configWith({ STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
  );

  function signed(
    event: Record<string, unknown>,
    secret = WEBHOOK_SECRET,
  ): { body: Buffer; header: string } {
    const payload = JSON.stringify(event);
    return {
      body: Buffer.from(payload),
      header: real.webhooks.generateTestHeaderString({ payload, secret }),
    };
  }

  function expectBadSignature(run: () => unknown): void {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'BAD_SIGNATURE',
        message: 'Invalid webhook signature',
      });
      return;
    }
    throw new Error('parseWebhook did not throw');
  }

  it.each(['payment_intent.succeeded', 'payment_intent.payment_failed'])(
    'maps %s and drops metadata values that are not strings',
    (type) => {
      const { body, header } = signed({
        id: 'evt_1',
        object: 'event',
        type,
        data: {
          object: {
            id: 'pi_1',
            object: 'payment_intent',
            metadata: { bookingType: 'flight', bookingId: 'b1', n: 5 },
          },
        },
      });

      expect(gateway.parseWebhook(body, header)).toEqual({
        id: 'evt_1',
        type,
        paymentIntent: {
          id: 'pi_1',
          metadata: { bookingType: 'flight', bookingId: 'b1' },
        },
      });
    },
  );

  it.each(['refund.updated', 'refund.failed'])('maps %s', (type) => {
    const { body, header } = signed({
      id: 'evt_2',
      object: 'event',
      type,
      data: {
        object: {
          id: 're_1',
          object: 'refund',
          status: 'failed',
          metadata: { refundId: 'r1' },
        },
      },
    });

    expect(gateway.parseWebhook(body, header)).toEqual({
      id: 'evt_2',
      type,
      refund: { id: 're_1', status: 'failed', metadata: { refundId: 'r1' } },
    });
  });

  it('marks any other event as ignored and keeps its original type', () => {
    const { body, header } = signed({
      id: 'evt_3',
      object: 'event',
      type: 'customer.created',
      data: { object: { id: 'cus_1', object: 'customer' } },
    });

    expect(gateway.parseWebhook(body, header)).toEqual({
      id: 'evt_3',
      type: 'ignored',
      originalType: 'customer.created',
    });
  });

  it('rejects a tampered body with 400 BAD_SIGNATURE', () => {
    const { body, header } = signed({
      id: 'evt_4',
      object: 'event',
      type: 'customer.created',
      data: { object: {} },
    });
    const tampered = Buffer.from(body.toString().replace('evt_4', 'evt_5'));

    expectBadSignature(() => gateway.parseWebhook(tampered, header));
  });

  it('rejects a signature made with another secret with 400 BAD_SIGNATURE', () => {
    const { body, header } = signed(
      {
        id: 'evt_6',
        object: 'event',
        type: 'customer.created',
        data: { object: {} },
      },
      'whsec_other',
    );

    expectBadSignature(() => gateway.parseWebhook(body, header));
  });

  it('throws a setup error when STRIPE_WEBHOOK_SECRET is not set', () => {
    const unconfigured = new StripeApiGateway(real, configWith({}));

    expect(() => unconfigured.parseWebhook(Buffer.from('{}'), 'x')).toThrow(
      'STRIPE_WEBHOOK_SECRET is not set',
    );
  });
});

describe('StripeApiGateway without a Stripe client (PAY-01)', () => {
  const gateway = new StripeApiGateway(
    null,
    configWith({ STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
  );
  const notConfigured = /Stripe is not configured/;

  it('createPaymentIntent throws', async () => {
    await expect(
      gateway.createPaymentIntent({
        amountMinor: 100,
        currency: 'USD',
        metadata: { bookingType: 'flight', bookingId: 'b1' },
        idempotencyKey: 'pi-flight-b1',
      }),
    ).rejects.toThrow(notConfigured);
  });

  it('cancelPaymentIntent throws', async () => {
    await expect(gateway.cancelPaymentIntent('pi_1')).rejects.toThrow(
      notConfigured,
    );
  });

  it('createRefund throws', async () => {
    await expect(
      gateway.createRefund({
        paymentIntentId: 'pi_1',
        amountMinor: 1,
        idempotencyKey: 'refund-r1',
        metadata: { refundId: 'r1' },
      }),
    ).rejects.toThrow(notConfigured);
  });

  it('parseWebhook throws', () => {
    expect(() => gateway.parseWebhook(Buffer.from('{}'), 'x')).toThrow(
      notConfigured,
    );
  });
});
