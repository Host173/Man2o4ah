import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeStripeGateway } from '../../../test/fakes/stripe-gateway.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { BookingType } from '../../common/database/booking-type.js';
import { Events } from '../../common/events/events.js';
import { PaymentsModule } from './payments.module.js';
import { Payment } from './schemas/payment.schema.js';
import type { PaymentStatus } from './schemas/payment.schema.js';
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';

describe('PaymentExpiryListener (PAY-01)', () => {
  const gateway = new FakeStripeGateway();
  let t: TestApp;
  let payments: Model<Payment>;
  let emitter: EventEmitter2;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [PaymentsModule],
      override: (builder) =>
        builder.overrideProvider(STRIPE_GATEWAY).useValue(gateway),
    });
    payments = t.moduleRef.get<Model<Payment>>(getModelToken(Payment.name));
    emitter = t.moduleRef.get(EventEmitter2);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    gateway.calls.length = 0;
  });

  async function payment(
    status: PaymentStatus,
    bookingType: BookingType = BookingType.FLIGHT,
  ) {
    const bookingId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    await payments.create({
      bookingType,
      bookingId,
      userId,
      stripePaymentIntentId: 'pi_fake_1',
      amountMinor: 25_000,
      currency: 'USD',
      status,
    });
    return { bookingId: bookingId.toString(), userId: userId.toString() };
  }

  const statusOf = async () => (await payments.findOne().lean())?.status;
  const cancelCalls = () =>
    gateway.calls.filter((c) => c.method === 'cancelPaymentIntent');

  it.each<PaymentStatus>(['pending', 'failed'])(
    'cancels the PaymentIntent of a %s payment when a flight booking expires',
    async (status) => {
      const ids = await payment(status);

      await emitter.emitAsync(Events.FlightBookingExpired, ids);

      expect(cancelCalls()).toEqual([
        { method: 'cancelPaymentIntent', input: 'pi_fake_1' },
      ]);
      expect(await statusOf()).toBe('canceled');
    },
  );

  it('cancels the PaymentIntent when a hotel reservation expires', async () => {
    const ids = await payment('pending', BookingType.HOTEL);

    await emitter.emitAsync(Events.HotelReservationExpired, ids);

    expect(cancelCalls()).toHaveLength(1);
    expect(await statusOf()).toBe('canceled');
  });

  it('does not mix up a flight and a hotel booking with the same id', async () => {
    const ids = await payment('pending', BookingType.HOTEL);

    await emitter.emitAsync(Events.FlightBookingExpired, ids);

    expect(cancelCalls()).toEqual([]);
    expect(await statusOf()).toBe('pending');
  });

  it.each<PaymentStatus>(['succeeded', 'canceled'])(
    'leaves a %s payment alone and does not call Stripe',
    async (status) => {
      const ids = await payment(status);

      await emitter.emitAsync(Events.FlightBookingExpired, ids);

      expect(gateway.calls).toEqual([]);
      expect(await statusOf()).toBe(status);
    },
  );

  it('does nothing and does not throw when the booking has no payment', async () => {
    await expect(
      emitter.emitAsync(Events.FlightBookingExpired, {
        bookingId: new Types.ObjectId().toString(),
        userId: new Types.ObjectId().toString(),
      }),
    ).resolves.toBeDefined();
    expect(gateway.calls).toEqual([]);
  });

  it('keeps the status and does not throw when Stripe refuses to cancel', async () => {
    const ids = await payment('pending');
    gateway.failNext('cancelPaymentIntent');

    await expect(
      emitter.emitAsync(Events.FlightBookingExpired, ids),
    ).resolves.toBeDefined();

    expect(cancelCalls()).toHaveLength(1);
    expect(await statusOf()).toBe('pending');
  });
});
