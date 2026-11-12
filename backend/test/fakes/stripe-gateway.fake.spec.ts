import { BookingType } from '../../src/common/database/booking-type.js';
import type { GatewayEvent } from '../../src/modules/payments/stripe/stripe-gateway.js';
import {
  FAKE_STRIPE_SIGNATURE,
  FakeStripeGateway,
} from './stripe-gateway.fake.js';

const intentInput = (bookingId: string) => ({
  amountMinor: 1000,
  currency: 'USD',
  metadata: { bookingType: BookingType.FLIGHT, bookingId },
  idempotencyKey: `pi-flight-${bookingId}`,
});

const refundInput = (refundId: string) => ({
  paymentIntentId: 'pi_fake_1',
  amountMinor: 500,
  idempotencyKey: `refund-${refundId}`,
  metadata: { refundId },
});

describe('FakeStripeGateway', () => {
  it('returns the same PaymentIntent for the same idempotency key', async () => {
    const stripe = new FakeStripeGateway();
    const first = await stripe.createPaymentIntent(intentInput('b-1'));
    const again = await stripe.createPaymentIntent(intentInput('b-1'));
    expect(again).toBe(first);
    expect(first.id).toBe('pi_fake_1');
    expect(first.clientSecret).toBe('pi_fake_1_secret');
  });

  it('creates a new PaymentIntent for a different key', async () => {
    const stripe = new FakeStripeGateway();
    const first = await stripe.createPaymentIntent(intentInput('b-1'));
    const other = await stripe.createPaymentIntent(intentInput('b-2'));
    expect(other.id).not.toBe(first.id);
    expect(other.id).toBe('pi_fake_2');
  });

  it('creates refunds idempotently, with the next status', async () => {
    const stripe = new FakeStripeGateway();
    stripe.nextRefundStatus = 'succeeded';
    const first = await stripe.createRefund(refundInput('r-1'));
    expect(first).toEqual({ id: 're_fake_1', status: 'succeeded' });
    expect(await stripe.createRefund(refundInput('r-1'))).toBe(first);
    expect((await stripe.createRefund(refundInput('r-2'))).id).toBe(
      're_fake_2',
    );
  });

  it('records the cancelled PaymentIntent and every call', async () => {
    const stripe = new FakeStripeGateway();
    await stripe.cancelPaymentIntent('pi_fake_1');
    expect(stripe.calls).toEqual([
      { method: 'cancelPaymentIntent', input: 'pi_fake_1' },
    ]);
  });

  it('failNext makes the next call throw once, then works again', async () => {
    const stripe = new FakeStripeGateway();
    stripe.failNext('createRefund');
    await expect(stripe.createRefund(refundInput('r-1'))).rejects.toThrow(
      /createRefund failed on purpose/,
    );
    await expect(stripe.createRefund(refundInput('r-1'))).resolves.toEqual({
      id: 're_fake_1',
      status: 'pending',
    });
  });

  it('parseWebhook returns the event for the good signature', () => {
    const stripe = new FakeStripeGateway();
    const event: GatewayEvent = {
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      paymentIntent: { id: 'pi_fake_1', metadata: { bookingId: 'b-1' } },
    };
    const parsed = stripe.parseWebhook(
      Buffer.from(JSON.stringify(event)),
      FAKE_STRIPE_SIGNATURE,
    );
    expect(parsed).toEqual(event);
  });

  it('parseWebhook answers 400 BAD_SIGNATURE for a bad signature', () => {
    const stripe = new FakeStripeGateway();
    expect(() => stripe.parseWebhook(Buffer.from('{}'), 'wrong')).toThrow(
      expect.objectContaining({
        status: 400,
        response: expect.objectContaining({ code: 'BAD_SIGNATURE' }),
      }),
    );
  });
});
