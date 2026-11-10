import { Types } from 'mongoose';
import type { Model, Schema } from 'mongoose';
import { getPlatformCurrency } from '../../src/common/money/platform-currency.js';
import {
  Payment,
  PaymentSchema,
} from '../../src/modules/payments/schemas/payment.schema.js';
import {
  PolicyAcceptance,
  PolicyAcceptanceSchema,
} from '../../src/modules/payments/schemas/policy-acceptance.schema.js';
import {
  Refund,
  RefundSchema,
} from '../../src/modules/payments/schemas/refund.schema.js';
import {
  StripeWebhookEvent,
  StripeWebhookEventSchema,
} from '../../src/modules/payments/schemas/stripe-webhook-event.schema.js';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

function paymentDoc(overrides: Record<string, unknown> = {}) {
  return {
    bookingType: 'flight' as const,
    bookingId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    stripePaymentIntentId: `pi_${new Types.ObjectId().toHexString()}`,
    amountMinor: 45_000,
    currency: 'USD',
    status: 'pending' as const,
    ...overrides,
  };
}

function refundDoc(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: new Types.ObjectId(),
    bookingType: 'hotel' as const,
    bookingId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    amountMinor: 18_000,
    currency: 'USD',
    reason: 'user_cancellation' as const,
    status: 'pending' as const,
    ...overrides,
  };
}

function acceptanceDoc(overrides: Record<string, unknown> = {}) {
  return {
    bookingType: 'flight' as const,
    bookingId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    acceptedAt: new Date(),
    ...overrides,
  };
}

function eventDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: `evt_${new Types.ObjectId().toHexString()}`,
    type: 'payment_intent.succeeded',
    receivedAt: new Date(),
    ...overrides,
  };
}

function indexSummary(
  indexes: {
    key: unknown;
    unique?: boolean;
    partialFilterExpression?: unknown;
    expireAfterSeconds?: number;
  }[],
) {
  return indexes.map((index) => ({
    key: index.key,
    unique: index.unique ?? false,
    partialFilterExpression: index.partialFilterExpression,
    expireAfterSeconds: index.expireAfterSeconds,
  }));
}

function plain(key: Record<string, number>, unique = false) {
  return {
    key,
    unique,
    partialFilterExpression: undefined,
    expireAfterSeconds: undefined,
  };
}

describe('payments schemas', () => {
  let db: TestDatabase;
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let acceptances: Model<PolicyAcceptance>;
  let events: Model<StripeWebhookEvent>;

  beforeAll(async () => {
    db = await startTestDatabase('payments');
    payments = db.connection.model<Payment>(Payment.name, PaymentSchema);
    refunds = db.connection.model<Refund>(Refund.name, RefundSchema);
    acceptances = db.connection.model<PolicyAcceptance>(
      PolicyAcceptance.name,
      PolicyAcceptanceSchema,
    );
    events = db.connection.model<StripeWebhookEvent>(
      StripeWebhookEvent.name,
      StripeWebhookEventSchema,
    );
    await Promise.all([
      payments.init(),
      refunds.init(),
      acceptances.init(),
      events.init(),
    ]);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await Promise.all([
      payments.deleteMany({}),
      refunds.deleteMany({}),
      acceptances.deleteMany({}),
      events.deleteMany({}),
    ]);
  });

  it('uses the payments, refunds, policy_acceptances and stripe_webhook_events collections', () => {
    expect(payments.collection.collectionName).toBe('payments');
    expect(refunds.collection.collectionName).toBe('refunds');
    expect(acceptances.collection.collectionName).toBe('policy_acceptances');
    expect(events.collection.collectionName).toBe('stripe_webhook_events');
  });

  it('declares no ref on any path', () => {
    const schemas: Schema[] = [
      PaymentSchema,
      RefundSchema,
      PolicyAcceptanceSchema,
      StripeWebhookEventSchema,
    ];
    const checked: string[] = [];
    for (const schema of schemas) {
      schema.eachPath((path, type) => {
        const options = type.options as { ref?: unknown; refPath?: unknown };
        expect(options.ref, path).toBeUndefined();
        expect(options.refPath, path).toBeUndefined();
        checked.push(path);
      });
    }
    expect(checked).toEqual(
      expect.arrayContaining(['paymentId', 'bookingId', 'userId']),
    );
  });

  describe('payments', () => {
    it('saves a valid payment', async () => {
      const payment = await payments.create(paymentDoc());
      expect(payment.currency).toBe('USD');
      expect(payment.status).toBe('pending');
      expect(payment.get('createdAt')).toBeInstanceOf(Date);
    });

    it('defaults currency to the platform currency when it is not given', async () => {
      const payment = await payments.create(
        paymentDoc({ currency: undefined }),
      );
      expect(payment.currency).toBe(getPlatformCurrency());
      const stored = await payments.collection.findOne({ _id: payment._id });
      expect(stored?.currency).toBe(getPlatformCurrency());
      await expect(
        new payments(paymentDoc({ currency: '' })).validate(),
      ).rejects.toThrow(/currency.*required/);
    });

    it('requires every field, with no default for status', async () => {
      for (const field of [
        'bookingType',
        'bookingId',
        'userId',
        'stripePaymentIntentId',
        'amountMinor',
        'status',
      ]) {
        await expect(
          new payments(paymentDoc({ [field]: undefined })).validate(),
        ).rejects.toThrow(new RegExp(`${field}.*required`));
      }
      await expect(
        new payments(paymentDoc()).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects invalid enum values', async () => {
      for (const overrides of [
        { bookingType: 'train' },
        { status: 'paid' },
        { status: 'cancelled' },
      ]) {
        await expect(
          new payments(paymentDoc(overrides)).validate(),
        ).rejects.toThrow(new RegExp(Object.keys(overrides)[0]));
      }
      for (const bookingType of ['flight', 'hotel']) {
        for (const status of ['pending', 'failed', 'succeeded', 'canceled']) {
          await expect(
            new payments(paymentDoc({ bookingType, status })).validate(),
          ).resolves.toBeUndefined();
        }
      }
    });

    it('requires amountMinor to be a non-negative integer', async () => {
      for (const amountMinor of [-1, 10.5]) {
        await expect(
          new payments(paymentDoc({ amountMinor })).validate(),
        ).rejects.toThrow(/amountMinor/);
      }
      await expect(
        new payments(paymentDoc({ amountMinor: 0 })).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects a second payment for the same booking', async () => {
      const bookingId = new Types.ObjectId();
      await payments.create(paymentDoc({ bookingType: 'flight', bookingId }));
      await expect(
        payments.create(paymentDoc({ bookingType: 'flight', bookingId })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        payments.create(paymentDoc({ bookingType: 'hotel', bookingId })),
      ).resolves.toBeDefined();
    });

    it('rejects a duplicate stripePaymentIntentId', async () => {
      await payments.create(paymentDoc({ stripePaymentIntentId: 'pi_123' }));
      await expect(
        payments.create(paymentDoc({ stripePaymentIntentId: 'pi_123' })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        payments.create(paymentDoc({ stripePaymentIntentId: 'pi_456' })),
      ).resolves.toBeDefined();
    });

    it('has exactly the indexes from the data model', async () => {
      const indexes = await payments.collection.indexes();
      expect(indexSummary(indexes)).toEqual(
        expect.arrayContaining([
          plain({ _id: 1 }),
          plain({ stripePaymentIntentId: 1 }, true),
          plain({ bookingType: 1, bookingId: 1 }, true),
          plain({ userId: 1 }),
        ]),
      );
      expect(indexes).toHaveLength(4);
    });
  });

  describe('refunds', () => {
    it('saves a valid refund without a stripeRefundId', async () => {
      const refund = await refunds.create(refundDoc());
      expect(refund.stripeRefundId).toBeUndefined();
      expect(refund.currency).toBe('USD');
      expect(refund.get('createdAt')).toBeInstanceOf(Date);
      const stored = await refunds.collection.findOne({ _id: refund._id });
      expect(stored).not.toHaveProperty('stripeRefundId');
    });

    it('defaults currency to the platform currency when it is not given', async () => {
      const refund = await refunds.create(refundDoc({ currency: undefined }));
      expect(refund.currency).toBe(getPlatformCurrency());
      const stored = await refunds.collection.findOne({ _id: refund._id });
      expect(stored?.currency).toBe(getPlatformCurrency());
      await expect(
        new refunds(refundDoc({ currency: '' })).validate(),
      ).rejects.toThrow(/currency.*required/);
    });

    it('requires every field but stripeRefundId, with no default for status', async () => {
      for (const field of [
        'paymentId',
        'bookingType',
        'bookingId',
        'userId',
        'amountMinor',
        'reason',
        'status',
      ]) {
        await expect(
          new refunds(refundDoc({ [field]: undefined })).validate(),
        ).rejects.toThrow(new RegExp(`${field}.*required`));
      }
      await expect(
        new refunds(refundDoc({ stripeRefundId: 're_123' })).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects invalid enum values', async () => {
      for (const overrides of [
        { bookingType: 'train' },
        { reason: 'changed_mind' },
        { status: 'succeeded' },
      ]) {
        await expect(
          new refunds(refundDoc(overrides)).validate(),
        ).rejects.toThrow(new RegExp(Object.keys(overrides)[0]));
      }
      for (const reason of [
        'user_cancellation',
        'provider_cancellation',
        'late_payment',
      ]) {
        for (const status of ['pending', 'refunded', 'failed']) {
          await expect(
            new refunds(refundDoc({ reason, status })).validate(),
          ).resolves.toBeUndefined();
        }
      }
    });

    it('requires amountMinor to be an integer greater than 0', async () => {
      for (const amountMinor of [0, -1, 10.5]) {
        await expect(
          new refunds(refundDoc({ amountMinor })).validate(),
        ).rejects.toThrow(/amountMinor/);
      }
      await expect(
        new refunds(refundDoc({ amountMinor: 1 })).validate(),
      ).resolves.toBeUndefined();
    });

    it('allows many refunds without a stripeRefundId but no duplicate stripeRefundId', async () => {
      await refunds.create(refundDoc());
      await expect(refunds.create(refundDoc())).resolves.toBeDefined();

      await refunds.create(refundDoc({ stripeRefundId: 're_123' }));
      await expect(
        refunds.create(refundDoc({ stripeRefundId: 're_123' })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        refunds.create(refundDoc({ stripeRefundId: 're_456' })),
      ).resolves.toBeDefined();
    });

    it('rejects a second refund for the same booking', async () => {
      const bookingId = new Types.ObjectId();
      await refunds.create(refundDoc({ bookingType: 'hotel', bookingId }));
      await expect(
        refunds.create(refundDoc({ bookingType: 'hotel', bookingId })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        refunds.create(refundDoc({ bookingType: 'flight', bookingId })),
      ).resolves.toBeDefined();
    });

    it('has exactly the indexes from the data model', async () => {
      const indexes = await refunds.collection.indexes();
      expect(indexSummary(indexes)).toEqual(
        expect.arrayContaining([
          plain({ _id: 1 }),
          plain({ bookingType: 1, bookingId: 1 }, true),
          {
            ...plain({ stripeRefundId: 1 }, true),
            partialFilterExpression: { stripeRefundId: { $type: 'string' } },
          },
          plain({ userId: 1 }),
        ]),
      );
      expect(indexes).toHaveLength(4);
    });
  });

  describe('policy_acceptances', () => {
    it('saves a valid acceptance', async () => {
      const acceptance = await acceptances.create(acceptanceDoc());
      expect(acceptance.acceptedAt).toBeInstanceOf(Date);
      expect(acceptance.get('createdAt')).toBeInstanceOf(Date);
    });

    it('requires every field and a valid bookingType', async () => {
      for (const overrides of [
        { bookingType: undefined },
        { bookingType: 'train' },
        { bookingId: undefined },
        { userId: undefined },
        { acceptedAt: undefined },
      ]) {
        await expect(
          new acceptances(acceptanceDoc(overrides)).validate(),
        ).rejects.toThrow(new RegExp(Object.keys(overrides)[0]));
      }
      await expect(
        new acceptances(acceptanceDoc({ bookingType: 'hotel' })).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects a second acceptance for the same booking', async () => {
      const bookingId = new Types.ObjectId();
      await acceptances.create(acceptanceDoc({ bookingId }));
      await expect(
        acceptances.create(acceptanceDoc({ bookingId })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        acceptances.create(acceptanceDoc({ bookingType: 'hotel', bookingId })),
      ).resolves.toBeDefined();
    });

    it('has exactly the indexes from the data model', async () => {
      const indexes = await acceptances.collection.indexes();
      expect(indexSummary(indexes)).toEqual(
        expect.arrayContaining([
          plain({ _id: 1 }),
          plain({ bookingType: 1, bookingId: 1 }, true),
        ]),
      );
      expect(indexes).toHaveLength(2);
    });
  });

  describe('stripe_webhook_events', () => {
    it('saves an event with the Stripe event ID as its string _id', async () => {
      const event = await events.create(eventDoc({ _id: 'evt_1' }));
      expect(event._id).toBe('evt_1');
      const stored = await events.collection.conn.db
        ?.collection<{ _id: string }>('stripe_webhook_events')
        .findOne({ _id: 'evt_1' });
      expect(stored?._id).toBe('evt_1');
      expect(event.get('createdAt')).toBeInstanceOf(Date);
    });

    it('requires _id, type and receivedAt', async () => {
      for (const field of ['_id', 'type', 'receivedAt']) {
        await expect(
          new events(eventDoc({ [field]: undefined })).validate(),
        ).rejects.toThrow(new RegExp(`${field}.*required`));
      }
      await expect(new events(eventDoc()).validate()).resolves.toBeUndefined();
    });

    it('rejects the same Stripe event inserted twice', async () => {
      await events.create(eventDoc({ _id: 'evt_1' }));
      await expect(
        events.create(eventDoc({ _id: 'evt_1' })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        events.create(eventDoc({ _id: 'evt_2' })),
      ).resolves.toBeDefined();
    });

    it('expires events 30 days after receivedAt', async () => {
      const indexes = await events.collection.indexes();
      expect(indexSummary(indexes)).toEqual(
        expect.arrayContaining([
          plain({ _id: 1 }),
          { ...plain({ receivedAt: 1 }), expireAfterSeconds: 2_592_000 },
        ]),
      );
      expect(indexes).toHaveLength(2);
    });
  });
});
