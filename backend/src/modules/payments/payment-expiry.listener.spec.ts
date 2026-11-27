import { Logger } from '@nestjs/common';
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
import { RefundsService } from './refunds.service.js';
import { Payment } from './schemas/payment.schema.js';
import type { PaymentStatus } from './schemas/payment.schema.js';
import { Refund } from './schemas/refund.schema.js';
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';

describe('PaymentExpiryListener (PAY-01)', () => {
  const gateway = new FakeStripeGateway();
  let t: TestApp;
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let emitter: EventEmitter2;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [PaymentsModule],
      override: (builder) =>
        builder.overrideProvider(STRIPE_GATEWAY).useValue(gateway),
    });
    payments = t.moduleRef.get<Model<Payment>>(getModelToken(Payment.name));
    refunds = t.moduleRef.get<Model<Refund>>(getModelToken(Refund.name));
    emitter = t.moduleRef.get(EventEmitter2);
  }, HOOK_TIMEOUT);

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  describe('flight changes (FLT-27)', () => {
    /** The booking's first payment (succeeded) and a change payment with `status`. */
    async function withChangePayment(status: PaymentStatus) {
      const ids = await payment('succeeded');
      const changeId = new Types.ObjectId();
      await payments.create({
        bookingType: BookingType.FLIGHT,
        bookingId: new Types.ObjectId(ids.bookingId),
        changeId,
        userId: new Types.ObjectId(ids.userId),
        stripePaymentIntentId: 'pi_fake_change',
        amountMinor: 10_000,
        currency: 'USD',
        status,
      });
      return { ...ids, changeId: changeId.toString() };
    }
    const changePayment = (changeId: string) =>
      payments.findOne({ changeId: new Types.ObjectId(changeId) }).lean();

    it('cancels only the change PaymentIntent when an unpaid change is dropped', async () => {
      const ids = await withChangePayment('pending');

      await emitter.emitAsync(Events.FlightBookingChangeExpired, ids);

      expect(cancelCalls()).toEqual([
        { method: 'cancelPaymentIntent', input: 'pi_fake_change' },
      ]);
      expect((await changePayment(ids.changeId))?.status).toBe('canceled');
      expect(
        (await payments.findOne({ changeId: { $exists: false } }).lean())
          ?.status,
      ).toBe('succeeded');
    });

    it('refunds a change paid after it was dropped, in full as a late payment', async () => {
      const ids = await withChangePayment('succeeded');

      await emitter.emitAsync(Events.FlightBookingChangeExpired, ids);

      const stored = await refunds.find().lean();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        amountMinor: 10_000,
        reason: 'late_payment',
      });
      expect(stored[0]?.changeId?.toString()).toBe(ids.changeId);
      expect(cancelCalls()).toEqual([]);
    });

    it('a booking expiry never touches its change payments', async () => {
      const ids = await withChangePayment('pending');
      await payments.updateOne(
        { changeId: { $exists: false } },
        { $set: { status: 'pending' } },
      );

      await emitter.emitAsync(Events.FlightBookingExpired, {
        bookingId: ids.bookingId,
        userId: ids.userId,
      });

      expect(cancelCalls()).toEqual([
        { method: 'cancelPaymentIntent', input: 'pi_fake_1' },
      ]);
      expect((await changePayment(ids.changeId))?.status).toBe('pending');
    });
  });

  it('leaves a canceled payment alone and does not call Stripe', async () => {
    const ids = await payment('canceled');

    await emitter.emitAsync(Events.FlightBookingExpired, ids);

    expect(gateway.calls).toEqual([]);
    expect(await statusOf()).toBe('canceled');
  });

  // S-07: the payment succeeded but the booking was never confirmed and has now
  // expired for good, so the whole payment goes back to the payer.
  describe.each([
    [Events.FlightBookingExpired, BookingType.FLIGHT],
    [Events.HotelReservationExpired, BookingType.HOTEL],
  ] as const)('a succeeded payment when %s fires', (event, bookingType) => {
    const createRefundCalls = () =>
      gateway.calls.filter((c) => c.method === 'createRefund');

    it('refunds the whole payment as a late payment, without cancelling the PaymentIntent', async () => {
      const ids = await payment('succeeded', bookingType);

      await emitter.emitAsync(event, ids);

      const refund = await refunds.find().lean();
      expect(refund).toHaveLength(1);
      expect(refund[0]).toMatchObject({
        bookingType,
        bookingId: new Types.ObjectId(ids.bookingId),
        userId: new Types.ObjectId(ids.userId),
        amountMinor: 25_000,
        currency: 'USD',
        reason: 'late_payment',
      });
      expect(createRefundCalls()).toHaveLength(1);
      expect(cancelCalls()).toEqual([]);
      expect(await statusOf()).toBe('succeeded');
    });

    it('refunds once when the expiry event arrives twice', async () => {
      const ids = await payment('succeeded', bookingType);

      await emitter.emitAsync(event, ids);
      await emitter.emitAsync(event, ids);

      expect(await refunds.countDocuments()).toBe(1);
      expect(createRefundCalls()).toHaveLength(1);
    });

    it('does not refund again when the booking module already asked', async () => {
      const ids = await payment('succeeded', bookingType);
      await t.moduleRef.get(RefundsService).refund({
        bookingType,
        bookingId: ids.bookingId,
        userId: ids.userId,
        amountMinor: 25_000,
        currency: 'USD',
        reason: 'late_payment',
      });

      await emitter.emitAsync(event, ids);

      expect(await refunds.countDocuments()).toBe(1);
      expect(createRefundCalls()).toHaveLength(1);
    });

    it('does not let a failing refund escape', async () => {
      const ids = await payment('succeeded', bookingType);
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      vi.spyOn(t.moduleRef.get(RefundsService), 'refund').mockRejectedValueOnce(
        new Error('refunds down'),
      );

      await expect(emitter.emitAsync(event, ids)).resolves.toBeDefined();
    });
  });

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
