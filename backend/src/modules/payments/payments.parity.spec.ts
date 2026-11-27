import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakePaymentsService } from '../../../test/fakes/payments.fake.js';
import { FakeStripeGateway } from '../../../test/fakes/stripe-gateway.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { PaymentsModule } from './payments.module.js';
import { PaymentsService } from './payments.service.js';
import type { RefundRequest } from './payments.types.js';
import { Payment } from './schemas/payment.schema.js';
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';

/** `FakePaymentsService` is what other modules test against: it must agree with the real service. */
describe('PaymentsService and FakePaymentsService agree (PAY-03)', () => {
  const gateway = new FakeStripeGateway();
  let t: TestApp;
  let real: PaymentsService;
  const fake = new FakePaymentsService();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [PaymentsModule],
      override: (builder) =>
        builder.overrideProvider(STRIPE_GATEWAY).useValue(gateway),
    });
    real = t.moduleRef.get(PaymentsService);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    gateway.nextRefundStatus = 'pending';
  });

  /** A succeeded payment, and a request that matches it. */
  async function request(
    overrides: Partial<RefundRequest> = {},
  ): Promise<RefundRequest> {
    const bookingId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    await t.moduleRef.get<Model<Payment>>(getModelToken(Payment.name)).create({
      bookingType: 'flight',
      bookingId,
      userId,
      stripePaymentIntentId: `pi_${bookingId.toHexString()}`,
      amountMinor: 25_000,
      currency: 'USD',
      status: 'succeeded',
    });
    return {
      bookingType: 'flight',
      bookingId: bookingId.toHexString(),
      userId: userId.toHexString(),
      amountMinor: 10_000,
      currency: 'USD',
      reason: 'user_cancellation',
      ...overrides,
    };
  }

  const services = [
    ['real', () => real],
    ['fake', () => fake],
  ] as const;

  async function rejection(run: () => Promise<unknown>): Promise<unknown> {
    try {
      await run();
    } catch (error) {
      return error;
    }
    throw new Error('did not reject');
  }

  it('reject an amount of 0 with the same 400', async () => {
    const req = await request({ amountMinor: 0 });

    const errors = await Promise.all(
      services.map(([, get]) => rejection(() => get().refund(req))),
    );

    for (const error of errors) {
      expect(error).toBeInstanceOf(BadRequestException);
    }
    expect((errors[0] as BadRequestException).getResponse()).toEqual(
      (errors[1] as BadRequestException).getResponse(),
    );
  });

  it.each(services)(
    '%s: two calls for one booking return the same refund',
    async (_name, get) => {
      const req = await request();

      const first = await get().refund(req);
      const second = await get().refund({ ...req, amountMinor: 5_000 });

      expect(second.refundId).toBe(first.refundId);
    },
  );

  it.each(services)(
    '%s: each change gets its own refund, apart from the cancellation refund (FLT-27)',
    async (_name, get) => {
      const req = await request();
      const change = {
        ...req,
        amountMinor: 2_000,
        reason: 'booking_change' as const,
        changeId: new Types.ObjectId().toHexString(),
      };

      const changeRefund = await get().refund(change);
      const sameChange = await get().refund(change);
      const cancellation = await get().refund(req);

      expect(sameChange.refundId).toBe(changeRefund.refundId);
      expect(cancellation.refundId).not.toBe(changeRefund.refundId);
      await expect(
        get().getRefund('flight', req.bookingId),
      ).resolves.toMatchObject({ refundId: cancellation.refundId });
    },
  );

  it.each(services)(
    '%s: getRefund is null for a booking without a refund',
    async (_name, get) => {
      await expect(
        get().getRefund('flight', new Types.ObjectId().toHexString()),
      ).resolves.toBeNull();
    },
  );

  it('start with the same pending view', async () => {
    const req = await request();

    const [realView, fakeView] = await Promise.all([
      real.refund(req),
      fake.refund(req),
    ]);

    const shape = (v: typeof realView) => ({
      status: v.status,
      bookingType: v.bookingType,
      bookingId: v.bookingId,
      amountMinor: v.amountMinor,
      currency: v.currency,
      reason: v.reason,
    });
    expect(shape(realView)).toEqual(shape(fakeView));
    expect(realView.status).toBe('pending');
  });
});
