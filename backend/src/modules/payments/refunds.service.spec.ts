import { BadRequestException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { vi } from 'vitest';
import { FakeStripeGateway } from '../../../test/fakes/stripe-gateway.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { BookingType } from '../../common/database/booking-type.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { Events } from '../../common/events/events.js';
import { PaymentsModule } from './payments.module.js';
import { PaymentsService } from './payments.service.js';
import type { RefundRequest } from './payments.types.js';
import { Payment } from './schemas/payment.schema.js';
import type { PaymentStatus } from './schemas/payment.schema.js';
import { Refund } from './schemas/refund.schema.js';
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';

describe('PaymentsService refunds (PAY-03)', () => {
  const gateway = new FakeStripeGateway();
  const updated = vi.fn();
  let t: TestApp;
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let service: PaymentsService;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [PaymentsModule],
      override: (builder) =>
        builder.overrideProvider(STRIPE_GATEWAY).useValue(gateway),
    });
    payments = t.moduleRef.get<Model<Payment>>(getModelToken(Payment.name));
    refunds = t.moduleRef.get<Model<Refund>>(getModelToken(Refund.name));
    service = t.moduleRef.get(PaymentsService);
    t.moduleRef.get(EventEmitter2).on(Events.RefundUpdated, updated);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    gateway.calls.length = 0;
    gateway.nextRefundStatus = 'pending';
    updated.mockClear();
  });

  /** A payment of 25000 USD, inserted directly; returns the ids as strings. */
  async function paid(
    overrides: Partial<{
      status: PaymentStatus;
      bookingType: BookingType;
    }> = {},
  ) {
    const bookingId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const payment = await payments.create({
      bookingType: overrides.bookingType ?? BookingType.FLIGHT,
      bookingId,
      userId,
      stripePaymentIntentId: 'pi_test_1',
      amountMinor: 25_000,
      currency: 'USD',
      status: overrides.status ?? 'succeeded',
    });
    return {
      paymentId: payment._id.toString(),
      bookingId: bookingId.toString(),
      userId: userId.toString(),
      bookingType: overrides.bookingType ?? BookingType.FLIGHT,
    };
  }

  function requestFor(
    p: Awaited<ReturnType<typeof paid>>,
    overrides: Partial<RefundRequest> = {},
  ): RefundRequest {
    return {
      bookingType: p.bookingType,
      bookingId: p.bookingId,
      userId: p.userId,
      amountMinor: 10_000,
      currency: 'USD',
      reason: 'user_cancellation',
      ...overrides,
    };
  }

  const refundCalls = () =>
    gateway.calls.filter((call) => call.method === 'createRefund');

  it('creates a pending refund, asks Stripe for it and tells the user', async () => {
    const p = await paid();

    const view = await service.refund(requestFor(p));

    expect(view).toEqual({
      refundId: expect.stringMatching(/^[0-9a-f]{24}$/),
      bookingType: 'flight',
      bookingId: p.bookingId,
      amountMinor: 10_000,
      currency: 'USD',
      reason: 'user_cancellation',
      status: 'pending',
    });
    const docs = await refunds.find().lean();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.stripeRefundId).toMatch(/^re_fake_\d+$/);
    expect(docs[0]?.paymentId.toString()).toBe(p.paymentId);
    expect(docs[0]?.userId.toString()).toBe(p.userId);
    expect(docs[0]?.status).toBe('pending');
    expect(refundCalls()).toEqual([
      {
        method: 'createRefund',
        input: {
          paymentIntentId: 'pi_test_1',
          amountMinor: 10_000,
          idempotencyKey: `refund-${view.refundId}`,
          metadata: { refundId: view.refundId },
        },
      },
    ]);
    expect(updated).toHaveBeenCalledTimes(1);
    expect(updated).toHaveBeenCalledWith({
      refundId: view.refundId,
      userId: p.userId,
      status: 'pending',
    });
  });

  it('stores refunded when Stripe already succeeded', async () => {
    gateway.nextRefundStatus = 'succeeded';
    const p = await paid();

    const view = await service.refund(requestFor(p));

    expect(view.status).toBe('refunded');
    expect((await refunds.findOne().lean())?.status).toBe('refunded');
    expect(updated).toHaveBeenCalledTimes(1);
    expect(updated).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'refunded' }),
    );
  });

  it('stores failed when Stripe already failed', async () => {
    gateway.nextRefundStatus = 'failed';
    const p = await paid();

    const view = await service.refund(requestFor(p));

    expect(view.status).toBe('failed');
    expect(updated).toHaveBeenCalledTimes(1);
    expect(updated).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('resolves with a failed refund when the Stripe call throws, and never loses it', async () => {
    const p = await paid();
    gateway.failNext('createRefund');

    const view = await service.refund(requestFor(p));

    expect(view.status).toBe('failed');
    const doc = await refunds.findOne().lean();
    expect(doc?.status).toBe('failed');
    expect(doc?.stripeRefundId).toBeUndefined();
    expect(updated).toHaveBeenCalledTimes(1);
    expect(updated).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('keeps one refund per booking: a second call returns the first, whatever its arguments', async () => {
    const p = await paid();
    const first = await service.refund(requestFor(p));

    const second = await service.refund(requestFor(p, { amountMinor: 5_000 }));

    expect(second).toEqual(first);
    expect(await refunds.countDocuments()).toBe(1);
    expect(refundCalls()).toHaveLength(1);
    expect(updated).toHaveBeenCalledTimes(1);
  });

  it('creates one refund for 5 parallel calls', async () => {
    const p = await paid();

    const views = await Promise.all(
      Array.from({ length: 5 }, () => service.refund(requestFor(p))),
    );

    expect(new Set(views.map((v) => v.refundId)).size).toBe(1);
    expect(await refunds.countDocuments()).toBe(1);
    expect(refundCalls()).toHaveLength(1);
    expect(updated).toHaveBeenCalledTimes(1);
  });

  describe('refusals create nothing, never call Stripe and emit nothing', () => {
    async function expectRefusal(
      run: () => Promise<unknown>,
      error: typeof BadRequestException | typeof ConflictException,
      response: unknown,
    ) {
      let caught: unknown;
      try {
        await run();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(error);
      expect((caught as BadRequestException).getResponse()).toEqual(response);
      expect(await refunds.countDocuments()).toBe(0);
      expect(gateway.calls).toEqual([]);
      expect(updated).not.toHaveBeenCalled();
    }

    const invalid = (field: string, message: string) => ({
      code: ErrorCode.ValidationFailed,
      message: 'Invalid refund',
      details: [{ field, message }],
    });
    const noPayment = {
      code: ErrorCode.InvalidStatusTransition,
      message: 'The booking has no succeeded payment',
    };

    it('400 for an amount of 0, before reading anything', async () => {
      const p = await paid();
      await expectRefusal(
        () => service.refund(requestFor(p, { amountMinor: 0 })),
        BadRequestException,
        invalid('amountMinor', 'must be greater than 0'),
      );
    });

    it('409 when the booking has no payment', async () => {
      const p = await paid();
      await expectRefusal(
        () =>
          service.refund(
            requestFor(p, { bookingId: new Types.ObjectId().toString() }),
          ),
        ConflictException,
        noPayment,
      );
    });

    it.each<PaymentStatus>(['pending', 'canceled'])(
      '409 when the payment is %s',
      async (status) => {
        const p = await paid({ status });
        await expectRefusal(
          () => service.refund(requestFor(p)),
          ConflictException,
          noPayment,
        );
      },
    );

    it('400 for an amount above the amount paid', async () => {
      const p = await paid();
      await expectRefusal(
        () => service.refund(requestFor(p, { amountMinor: 25_001 })),
        BadRequestException,
        invalid('amountMinor', 'must not exceed the amount paid'),
      );
    });

    it('400 for another currency', async () => {
      const p = await paid();
      await expectRefusal(
        () => service.refund(requestFor(p, { currency: 'EUR' })),
        BadRequestException,
        invalid('currency', 'must match the payment currency'),
      );
    });

    it('400 for someone who did not pay', async () => {
      const p = await paid();
      await expectRefusal(
        () =>
          service.refund(
            requestFor(p, { userId: new Types.ObjectId().toString() }),
          ),
        BadRequestException,
        invalid('userId', 'must be the payer'),
      );
    });
  });

  it('allows a full refund for a provider cancellation', async () => {
    const p = await paid();

    const view = await service.refund(
      requestFor(p, {
        amountMinor: 25_000,
        reason: 'provider_cancellation',
      }),
    );

    expect(view.amountMinor).toBe(25_000);
    expect(view.reason).toBe('provider_cancellation');
  });

  it('refunds a late payment in full, stored with its reason', async () => {
    // PAY-01 records a payment that arrives after the hold as `succeeded`.
    const p = await paid({ status: 'succeeded' });

    const view = await service.refund(
      requestFor(p, { amountMinor: 25_000, reason: 'late_payment' }),
    );

    expect(view.reason).toBe('late_payment');
    expect((await refunds.findOne().lean())?.reason).toBe('late_payment');
  });

  it('returns the booking’s refund from getRefund, or null when there is none', async () => {
    const p = await paid();
    const view = await service.refund(requestFor(p));

    await expect(service.getRefund('flight', p.bookingId)).resolves.toEqual(
      view,
    );
    await expect(
      service.getRefund('flight', new Types.ObjectId().toString()),
    ).resolves.toBeNull();
  });

  it('refunds a hotel reservation too', async () => {
    const p = await paid({ bookingType: BookingType.HOTEL });

    const view = await service.refund(requestFor(p));

    expect(view.bookingType).toBe('hotel');
    expect((await refunds.findOne().lean())?.bookingType).toBe('hotel');
  });
});
