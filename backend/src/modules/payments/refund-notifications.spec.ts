import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { vi } from 'vitest';
import {
  FAKE_STRIPE_SIGNATURE,
  FakeStripeGateway,
} from '../../../test/fakes/stripe-gateway.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { Notification } from '../notifications/schemas/notification.schema.js';
import { PaymentIntentsService } from './payment-intents.service.js';
import { PaymentsModule } from './payments.module.js';
import { PaymentsService } from './payments.service.js';
import { Payment } from './schemas/payment.schema.js';
import { Refund } from './schemas/refund.schema.js';
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';

describe('refund notifications, end to end with GEN-01 (PAY-03)', () => {
  const gateway = new FakeStripeGateway();
  let t: TestApp;
  let notifications: Model<Notification>;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [PaymentsModule, NotificationsModule],
      override: (builder) =>
        builder.overrideProvider(STRIPE_GATEWAY).useValue(gateway),
    });
    notifications = t.moduleRef.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    gateway.nextRefundStatus = 'pending';
  });

  it('notifies the user when the refund is created and again when it completes', async () => {
    const userId = new Types.ObjectId();
    const bookingId = new Types.ObjectId();
    await t.moduleRef.get<Model<Payment>>(getModelToken(Payment.name)).create({
      bookingType: 'flight',
      bookingId,
      userId,
      stripePaymentIntentId: 'pi_test_1',
      amountMinor: 25_000,
      currency: 'USD',
      status: 'succeeded',
    });

    const view = await t.moduleRef.get(PaymentsService).refund({
      bookingType: 'flight',
      bookingId: bookingId.toHexString(),
      userId: userId.toHexString(),
      amountMinor: 10_000,
      currency: 'USD',
      reason: 'user_cancellation',
    });

    await vi.waitFor(async () => {
      expect(await notifications.countDocuments({ userId })).toBe(1);
    });
    const first = await notifications.findOne({ userId }).lean();
    expect(first).toMatchObject({
      type: 'refund_updated',
      message: 'Your refund is being processed.',
    });
    expect(first?.entity?.id).toBe(view.refundId);

    const stored = await t.moduleRef
      .get<Model<Refund>>(getModelToken(Refund.name))
      .findById(view.refundId)
      .lean();
    const event = {
      id: 'evt_r1',
      type: 'refund.updated',
      refund: {
        id: stored?.stripeRefundId,
        status: 'succeeded',
        metadata: { refundId: view.refundId },
      },
    };
    await t.moduleRef
      .get(PaymentIntentsService)
      .handleWebhook(Buffer.from(JSON.stringify(event)), FAKE_STRIPE_SIGNATURE);

    await vi.waitFor(async () => {
      expect(await notifications.countDocuments({ userId })).toBe(2);
    });
    const messages = (await notifications.find({ userId }).lean()).map(
      (n) => n.message,
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        'Your refund is being processed.',
        'Your refund is complete.',
      ]),
    );
  });
});
