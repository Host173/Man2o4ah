import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { vi } from 'vitest';
import { FakePayableBooking } from '../../../test/fakes/payable-booking.fake.js';
import {
  FAKE_STRIPE_SIGNATURE,
  FakeStripeGateway,
} from '../../../test/fakes/stripe-gateway.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import type { LoggedInUser } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { BookingType } from '../../common/database/booking-type.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { Events } from '../../common/events/events.js';
import { Role } from '../accounts/auth/auth.types.js';
import { PaymentsModule } from './payments.module.js';
import { PaymentsService } from './payments.service.js';
import { PayableBookingRegistry } from './ports/payable-booking.registry.js';
import { Payment } from './schemas/payment.schema.js';
import { PolicyAcceptance } from './schemas/policy-acceptance.schema.js';
import { Refund } from './schemas/refund.schema.js';
import type { RefundStatus } from './schemas/refund.schema.js';
import { StripeWebhookEvent } from './schemas/stripe-webhook-event.schema.js';
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';
import type { GatewayRefundStatus } from './stripe/stripe-gateway.js';

const WEBHOOK = '/api/payments/webhook';

describe('refunds API and webhook (PAY-03)', () => {
  const gateway = new FakeStripeGateway();
  const flights = new FakePayableBooking(BookingType.FLIGHT);
  const updated = vi.fn();
  let t: TestApp;
  let user: LoggedInUser;
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let webhookEvents: Model<StripeWebhookEvent>;
  let service: PaymentsService;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [PaymentsModule],
      override: (builder) =>
        builder.overrideProvider(STRIPE_GATEWAY).useValue(gateway),
    });
    t.moduleRef.get(PayableBookingRegistry).register(flights);
    payments = t.moduleRef.get<Model<Payment>>(getModelToken(Payment.name));
    refunds = t.moduleRef.get<Model<Refund>>(getModelToken(Refund.name));
    webhookEvents = t.moduleRef.get<Model<StripeWebhookEvent>>(
      getModelToken(StripeWebhookEvent.name),
    );
    service = t.moduleRef.get(PaymentsService);
    t.moduleRef.get(EventEmitter2).on(Events.RefundUpdated, updated);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    gateway.calls.length = 0;
    gateway.nextRefundStatus = 'pending';
    updated.mockClear();
    // Log in after the clear: it wipes the users and sessions too.
    user = await loginAs(t.connection, Role.USER);
  });

  /** A succeeded payment of the logged-in user, then a pending refund of 10000 for it. */
  async function pendingRefund(owner: LoggedInUser = user) {
    const bookingId = new Types.ObjectId();
    await payments.create({
      bookingType: 'flight',
      bookingId,
      userId: new Types.ObjectId(owner.id),
      stripePaymentIntentId: `pi_test_${bookingId.toHexString()}`,
      amountMinor: 25_000,
      currency: 'USD',
      status: 'succeeded',
    });
    const view = await service.refund({
      bookingType: 'flight',
      bookingId: bookingId.toHexString(),
      userId: owner.id,
      amountMinor: 10_000,
      currency: 'USD',
      reason: 'user_cancellation',
    });
    const doc = await refunds.findById(view.refundId).lean();
    updated.mockClear();
    return { view, stripeRefundId: doc?.stripeRefundId ?? '' };
  }

  function webhook(event: unknown) {
    return t
      .http()
      .post(WEBHOOK)
      .set('Content-Type', 'application/json')
      .set('stripe-signature', FAKE_STRIPE_SIGNATURE)
      .send(JSON.stringify(event));
  }

  function refundEvent(
    id: string,
    type: 'refund.updated' | 'refund.failed',
    refund: {
      id: string;
      status: GatewayRefundStatus;
      metadata?: Record<string, string>;
    },
  ) {
    return { id, type, refund: { metadata: {}, ...refund } };
  }

  const statusOf = async (
    refundId: string,
  ): Promise<RefundStatus | undefined> =>
    (await refunds.findById(refundId).lean())?.status;

  describe('GET /api/refunds/:id', () => {
    it('returns the owner exactly the refund view', async () => {
      const { view } = await pendingRefund();

      const res = await t
        .http()
        .get(`/api/refunds/${view.refundId}`)
        .set('Cookie', user.cookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(view);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          'amountMinor',
          'bookingId',
          'bookingType',
          'currency',
          'reason',
          'refundId',
          'status',
        ].sort(),
      );
    });

    it("404 NOT_FOUND for another user's refund", async () => {
      const { view } = await pendingRefund();
      const other = await loginAs(t.connection, Role.USER);

      const res = await t
        .http()
        .get(`/api/refunds/${view.refundId}`)
        .set('Cookie', other.cookie);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ErrorCode.NotFound);
    });

    it('404 for an unknown id', async () => {
      const res = await t
        .http()
        .get(`/api/refunds/${new Types.ObjectId().toHexString()}`)
        .set('Cookie', user.cookie);
      expect(res.status).toBe(404);
    });

    it('400 VALIDATION_FAILED for a malformed id', async () => {
      const res = await t
        .http()
        .get('/api/refunds/abc')
        .set('Cookie', user.cookie);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ErrorCode.ValidationFailed);
    });

    it('401 without a login', async () => {
      const res = await t
        .http()
        .get(`/api/refunds/${new Types.ObjectId().toHexString()}`);
      expect(res.status).toBe(401);
    });

    it.each([Role.ADMIN, Role.HOTEL_MODERATOR, Role.AIRLINE_MODERATOR])(
      '403 for a %s',
      async (role) => {
        const other = await loginAs(t.connection, role);
        const res = await t
          .http()
          .get(`/api/refunds/${new Types.ObjectId().toHexString()}`)
          .set('Cookie', other.cookie);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe(ErrorCode.ForbiddenRole);
      },
    );
  });

  describe('refund webhook events', () => {
    it('marks a pending refund refunded, announces it and records the event', async () => {
      const { view, stripeRefundId } = await pendingRefund();

      const res = await webhook(
        refundEvent('evt_r1', 'refund.updated', {
          id: stripeRefundId,
          status: 'succeeded',
          metadata: { refundId: view.refundId },
        }),
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
      expect(await statusOf(view.refundId)).toBe('refunded');
      expect(updated).toHaveBeenCalledTimes(1);
      expect(updated).toHaveBeenCalledWith({
        refundId: view.refundId,
        userId: user.id,
        status: 'refunded',
      });
      const recorded = await webhookEvents.find().lean();
      expect(recorded.map((e) => e._id)).toEqual(['evt_r1']);
    });

    it('processes a repeated event once', async () => {
      const { view, stripeRefundId } = await pendingRefund();
      const event = refundEvent('evt_r1', 'refund.updated', {
        id: stripeRefundId,
        status: 'succeeded',
      });

      expect((await webhook(event)).status).toBe(200);
      expect((await webhook(event)).status).toBe(200);

      expect(await statusOf(view.refundId)).toBe('refunded');
      expect(updated).toHaveBeenCalledTimes(1);
      expect(await webhookEvents.countDocuments()).toBe(1);
    });

    it('applies 5 parallel deliveries of one failing event once', async () => {
      const { view, stripeRefundId } = await pendingRefund();
      await webhook(
        refundEvent('evt_ok', 'refund.updated', {
          id: stripeRefundId,
          status: 'succeeded',
        }),
      );
      updated.mockClear();
      const failing = refundEvent('evt_fail', 'refund.failed', {
        id: stripeRefundId,
        status: 'failed',
      });

      const results = await Promise.all(
        Array.from({ length: 5 }, () => webhook(failing)),
      );

      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(await statusOf(view.refundId)).toBe('failed');
      expect(updated).toHaveBeenCalledTimes(1);
      expect(updated).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('marks a pending refund failed on refund.failed', async () => {
      const { view, stripeRefundId } = await pendingRefund();

      await webhook(
        refundEvent('evt_f', 'refund.failed', {
          id: stripeRefundId,
          status: 'failed',
        }),
      );

      expect(await statusOf(view.refundId)).toBe('failed');
      expect(updated).toHaveBeenCalledTimes(1);
    });

    it('records a pending update without changing or announcing anything', async () => {
      const { view, stripeRefundId } = await pendingRefund();

      const res = await webhook(
        refundEvent('evt_p', 'refund.updated', {
          id: stripeRefundId,
          status: 'pending',
        }),
      );

      expect(res.status).toBe(200);
      expect(await statusOf(view.refundId)).toBe('pending');
      expect(updated).not.toHaveBeenCalled();
      expect(await webhookEvents.countDocuments()).toBe(1);
    });

    it("finds a refund by our id in the event's metadata and stores Stripe's id", async () => {
      const refundDoc = await refunds.create({
        paymentId: new Types.ObjectId(),
        bookingType: 'flight',
        bookingId: new Types.ObjectId(),
        userId: new Types.ObjectId(user.id),
        amountMinor: 10_000,
        currency: 'USD',
        reason: 'user_cancellation',
        status: 'pending',
      });
      const refundId = refundDoc._id.toString();

      await webhook(
        refundEvent('evt_m', 'refund.updated', {
          id: 're_other',
          status: 'succeeded',
          metadata: { refundId },
        }),
      );

      const stored = await refunds.findById(refundId).lean();
      expect(stored?.status).toBe('refunded');
      expect(stored?.stripeRefundId).toBe('re_other');
      expect(updated).toHaveBeenCalledWith({
        refundId,
        userId: user.id,
        status: 'refunded',
      });
    });

    it('answers 200 and changes nothing for an unknown refund', async () => {
      const { view } = await pendingRefund();

      const res = await webhook(
        refundEvent('evt_n', 'refund.updated', {
          id: 're_nope',
          status: 'succeeded',
        }),
      );

      expect(res.status).toBe(200);
      expect(await statusOf(view.refundId)).toBe('pending');
      expect(updated).not.toHaveBeenCalled();
    });

    it('still marks a payment succeeded (the routing did not break PAY-01)', async () => {
      const bookingId = new Types.ObjectId().toHexString();
      flights.set(
        bookingId,
        user.id,
        {
          amountMinor: 25_000,
          currency: 'USD',
          status: 'pending_payment',
          holdExpiresAt: new Date(Date.now() + 600_000),
        },
        { bookingType: 'flight', segments: [] },
      );
      await t.connection.model(PolicyAcceptance.name).create({
        bookingType: 'flight',
        bookingId: new Types.ObjectId(bookingId),
        userId: new Types.ObjectId(user.id),
        acceptedAt: new Date(),
      });
      const start = await t
        .http()
        .post('/api/payments')
        .set('Cookie', user.cookie)
        .send({ bookingType: 'flight', bookingId });
      const doc = await payments.findById(start.body.paymentId).lean();

      const res = await webhook({
        id: 'evt_pay',
        type: 'payment_intent.succeeded',
        paymentIntent: { id: doc?.stripePaymentIntentId, metadata: {} },
      });

      expect(res.status).toBe(200);
      expect(
        (await payments.findById(start.body.paymentId).lean())?.status,
      ).toBe('succeeded');
    });
  });

  it('is documented in Swagger with its requirement ID', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    const operation = document.paths['/api/refunds/{id}']?.get;
    expect(operation?.summary).toContain('PAY-03');
    expect(operation?.tags).toEqual(['payments']);
    expect(operation?.parameters).toContainEqual(
      expect.objectContaining({
        name: 'id',
        in: 'path',
        schema: { type: 'string' },
      }),
    );
  });
});
