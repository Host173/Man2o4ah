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
import type { Payable } from './ports/payable-booking.port.js';
import { PayableBookingRegistry } from './ports/payable-booking.registry.js';
import { Payment } from './schemas/payment.schema.js';
import type { PaymentStatus } from './schemas/payment.schema.js';
import { PolicyAcceptance } from './schemas/policy-acceptance.schema.js';
import { StripeWebhookEvent } from './schemas/stripe-webhook-event.schema.js';
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';

const MINUTE_MS = 60_000;
const START = '/api/payments';
const WEBHOOK = '/api/payments/webhook';

describe('payments API (PAY-01)', () => {
  const gateway = new FakeStripeGateway();
  const flights = new FakePayableBooking(BookingType.FLIGHT);
  const hotels = new FakePayableBooking(BookingType.HOTEL);
  const succeeded = vi.fn();
  let t: TestApp;
  let user: LoggedInUser;
  let payments: Model<Payment>;
  let acceptances: Model<PolicyAcceptance>;
  let webhookEvents: Model<StripeWebhookEvent>;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [PaymentsModule],
      override: (builder) =>
        builder.overrideProvider(STRIPE_GATEWAY).useValue(gateway),
    });
    const registry = t.moduleRef.get(PayableBookingRegistry);
    registry.register(flights);
    registry.register(hotels);
    t.moduleRef.get(EventEmitter2).on(Events.PaymentSucceeded, succeeded);
    payments = t.moduleRef.get<Model<Payment>>(getModelToken(Payment.name));
    acceptances = t.moduleRef.get<Model<PolicyAcceptance>>(
      getModelToken(PolicyAcceptance.name),
    );
    webhookEvents = t.moduleRef.get<Model<StripeWebhookEvent>>(
      getModelToken(StripeWebhookEvent.name),
    );
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    gateway.calls.length = 0;
    succeeded.mockClear();
    // Log in after the clear: it wipes the users and sessions too.
    user = await loginAs(t.connection, Role.USER);
  });

  /** A booking of `userId` waiting for payment, with a 10-minute hold. */
  function pending(
    bookingId: string,
    userId: string,
    overrides: Partial<Payable> = {},
    type: BookingType = BookingType.FLIGHT,
  ): void {
    const payable: Payable = {
      amountMinor: 25_000,
      currency: 'USD',
      status: 'pending_payment',
      holdExpiresAt: new Date(Date.now() + 10 * MINUTE_MS),
      ...overrides,
    };
    if (type === BookingType.FLIGHT) {
      flights.set(bookingId, userId, payable, {
        bookingType: 'flight',
        segments: [],
      });
    } else {
      hotels.set(bookingId, userId, payable, {
        bookingType: 'hotel',
        cancellationTiers: [],
        checkInTime: '14:00',
        checkOutTime: '11:00',
      });
    }
  }

  async function accept(
    type: BookingType,
    bookingId: string,
    userId: string,
  ): Promise<void> {
    await acceptances.create({
      bookingType: type,
      bookingId: new Types.ObjectId(bookingId),
      userId: new Types.ObjectId(userId),
      acceptedAt: new Date(),
    });
  }

  /** A pending, accepted flight booking of the logged-in user. */
  async function readyFlight(overrides: Partial<Payable> = {}) {
    const bookingId = new Types.ObjectId().toHexString();
    pending(bookingId, user.id, overrides);
    await accept(BookingType.FLIGHT, bookingId, user.id);
    return bookingId;
  }

  function startPayment(bookingId: string, who: LoggedInUser = user) {
    return t
      .http()
      .post(START)
      .set('Cookie', who.cookie)
      .send({ bookingType: 'flight', bookingId });
  }

  function webhook(event: unknown, signature: string = FAKE_STRIPE_SIGNATURE) {
    return t
      .http()
      .post(WEBHOOK)
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(JSON.stringify(event));
  }

  const intentEvent = (
    id: string,
    type: 'payment_intent.succeeded' | 'payment_intent.payment_failed',
    intentId: string,
  ) => ({ id, type, paymentIntent: { id: intentId, metadata: {} } });

  /** Starts a payment and returns its payment ID and PaymentIntent ID. */
  async function started(bookingId: string) {
    const res = await startPayment(bookingId);
    expect(res.status).toBe(201);
    const doc = await payments.findById(res.body.paymentId).lean();
    return {
      paymentId: res.body.paymentId as string,
      clientSecret: res.body.clientSecret as string,
      intentId: doc?.stripePaymentIntentId as string,
    };
  }

  async function statusOf(
    paymentId: string,
  ): Promise<PaymentStatus | undefined> {
    return (await payments.findById(paymentId).lean())?.status;
  }

  describe('POST /api/payments', () => {
    it('answers 201 with the payment session and saves only id, amount, currency and status', async () => {
      const bookingId = await readyFlight();

      const res = await startPayment(bookingId);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        amountMinor: 25_000,
        currency: 'USD',
      });
      expect(res.body.paymentId).toMatch(/^[0-9a-f]{24}$/);
      expect(typeof res.body.holdExpiresAt).toBe('string');

      const docs = await payments.find().lean();
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        status: 'pending',
        amountMinor: 25_000,
        currency: 'USD',
      });
      expect(docs[0]?.userId.toString()).toBe(user.id);
      expect(docs[0]?.stripePaymentIntentId).toMatch(/^pi_fake_\d+$/);
      expect(res.body.clientSecret).toBe(
        `${docs[0]?.stripePaymentIntentId}_secret`,
      );
      // The client secret is never stored.
      expect(JSON.stringify(docs[0])).not.toContain('_secret');

      expect(gateway.calls).toEqual([
        {
          method: 'createPaymentIntent',
          input: {
            amountMinor: 25_000,
            currency: 'USD',
            metadata: { bookingType: 'flight', bookingId },
            idempotencyKey: `pi-flight-${bookingId}`,
          },
        },
      ]);
    });

    it('returns the same payment and client secret on a second call', async () => {
      const bookingId = await readyFlight();

      const first = await startPayment(bookingId);
      const second = await startPayment(bookingId);

      expect(second.status).toBe(201);
      expect(second.body.paymentId).toBe(first.body.paymentId);
      expect(second.body.clientSecret).toBe(first.body.clientSecret);
      expect(await payments.countDocuments()).toBe(1);
    });

    it('creates one payment for 5 parallel requests', async () => {
      const bookingId = await readyFlight();

      const results = await Promise.all(
        Array.from({ length: 5 }, () => startPayment(bookingId)),
      );

      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(results.map((r) => r.body.paymentId)).size).toBe(1);
      expect(new Set(results.map((r) => r.body.clientSecret)).size).toBe(1);
      expect(await payments.countDocuments()).toBe(1);
    });

    it('pays a hotel reservation with its own idempotency key', async () => {
      const bookingId = new Types.ObjectId().toHexString();
      pending(bookingId, user.id, {}, BookingType.HOTEL);
      await accept(BookingType.HOTEL, bookingId, user.id);

      const res = await t
        .http()
        .post(START)
        .set('Cookie', user.cookie)
        .send({ bookingType: 'hotel', bookingId });

      expect(res.status).toBe(201);
      expect(gateway.calls[0]).toMatchObject({
        method: 'createPaymentIntent',
        input: {
          idempotencyKey: `pi-hotel-${bookingId}`,
          metadata: { bookingType: 'hotel', bookingId },
        },
      });
      expect((await payments.findOne().lean())?.bookingType).toBe('hotel');
    });

    describe('refusals write nothing and never call Stripe', () => {
      async function expectRefused(
        bookingId: string,
        status: number,
        code: string,
        who: LoggedInUser = user,
      ) {
        const res = await startPayment(bookingId, who);
        expect(res.status).toBe(status);
        expect(res.body.code).toBe(code);
        expect(await payments.countDocuments()).toBe(0);
        expect(gateway.calls).toEqual([]);
      }

      it("404 NOT_FOUND for another user's booking", async () => {
        const bookingId = await readyFlight();
        const other = await loginAs(t.connection, Role.USER);
        await expectRefused(bookingId, 404, ErrorCode.NotFound, other);
      });

      it('409 POLICIES_NOT_ACCEPTED when the policies were not accepted', async () => {
        const bookingId = new Types.ObjectId().toHexString();
        pending(bookingId, user.id);
        await expectRefused(bookingId, 409, ErrorCode.PoliciesNotAccepted);
      });

      it('409 HOLD_EXPIRED when the hold ended a second ago', async () => {
        const bookingId = await readyFlight({
          holdExpiresAt: new Date(Date.now() - 1000),
        });
        await expectRefused(bookingId, 409, ErrorCode.HoldExpired);
      });

      it('409 HOLD_EXPIRED for an expired booking', async () => {
        const bookingId = await readyFlight({ status: 'expired' });
        await expectRefused(bookingId, 409, ErrorCode.HoldExpired);
      });

      it('409 INVALID_STATUS_TRANSITION for a confirmed booking', async () => {
        const bookingId = await readyFlight({ status: 'confirmed' });
        await expectRefused(bookingId, 409, ErrorCode.InvalidStatusTransition);
      });
    });

    describe('validation and access', () => {
      const bookingId = new Types.ObjectId().toHexString();

      it.each([
        ['an unknown bookingType', { bookingType: 'train', bookingId }],
        ['a malformed bookingId', { bookingType: 'flight', bookingId: 'abc' }],
        ['a missing bookingId', { bookingType: 'flight' }],
        ['a missing bookingType', { bookingId }],
        ['an extra field', { bookingType: 'flight', bookingId, amount: 1 }],
      ])('400 VALIDATION_FAILED for %s', async (_name, body) => {
        const res = await t
          .http()
          .post(START)
          .set('Cookie', user.cookie)
          .send(body);

        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ErrorCode.ValidationFailed);
      });

      it('401 without a login', async () => {
        const res = await t
          .http()
          .post(START)
          .send({ bookingType: 'flight', bookingId });
        expect(res.status).toBe(401);
      });

      it.each([Role.ADMIN, Role.HOTEL_MODERATOR, Role.AIRLINE_MODERATOR])(
        '403 for a %s',
        async (role) => {
          const other = await loginAs(t.connection, role);
          const res = await startPayment(bookingId, other);
          expect(res.status).toBe(403);
          expect(res.body.code).toBe(ErrorCode.ForbiddenRole);
        },
      );
    });
  });

  describe('POST /api/payments/webhook', () => {
    it('marks the payment succeeded, emits payment.succeeded once and records the event', async () => {
      const bookingId = await readyFlight();
      const { paymentId, intentId } = await started(bookingId);

      const res = await webhook(
        intentEvent('evt_1', 'payment_intent.succeeded', intentId),
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
      expect(await statusOf(paymentId)).toBe('succeeded');
      expect(succeeded).toHaveBeenCalledTimes(1);
      expect(succeeded).toHaveBeenCalledWith({
        bookingType: 'flight',
        bookingId,
      });
      const recorded = await webhookEvents.find().lean();
      expect(recorded.map((e) => e._id)).toEqual(['evt_1']);
    });

    it('processes a repeated event once', async () => {
      const bookingId = await readyFlight();
      const { intentId } = await started(bookingId);
      const event = intentEvent('evt_1', 'payment_intent.succeeded', intentId);

      expect((await webhook(event)).status).toBe(200);
      expect((await webhook(event)).status).toBe(200);

      expect(succeeded).toHaveBeenCalledTimes(1);
      expect(await webhookEvents.countDocuments()).toBe(1);
    });

    it('processes 5 parallel deliveries of one event once', async () => {
      const bookingId = await readyFlight();
      const { intentId } = await started(bookingId);
      const event = intentEvent(
        'evt_par',
        'payment_intent.succeeded',
        intentId,
      );

      const results = await Promise.all(
        Array.from({ length: 5 }, () => webhook(event)),
      );

      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(succeeded).toHaveBeenCalledTimes(1);
      expect(await webhookEvents.countDocuments()).toBe(1);
    });

    it('records a failure, lets the user retry, then records the payment', async () => {
      const bookingId = await readyFlight();
      const { paymentId, clientSecret, intentId } = await started(bookingId);

      await webhook(
        intentEvent('evt_f', 'payment_intent.payment_failed', intentId),
      );
      expect(await statusOf(paymentId)).toBe('failed');
      expect(succeeded).not.toHaveBeenCalled();

      const retried = await t
        .http()
        .post(`${START}/${paymentId}/retry`)
        .set('Cookie', user.cookie);
      expect(retried.status).toBe(200);
      expect(retried.body.clientSecret).toBe(clientSecret);
      expect(retried.body.paymentId).toBe(paymentId);
      expect(await statusOf(paymentId)).toBe('pending');

      await webhook(intentEvent('evt_s', 'payment_intent.succeeded', intentId));
      expect(await statusOf(paymentId)).toBe('succeeded');
      expect(succeeded).toHaveBeenCalledTimes(1);
    });

    it('400 BAD_SIGNATURE for a wrong signature, and writes nothing', async () => {
      const bookingId = await readyFlight();
      const { paymentId, intentId } = await started(bookingId);

      const res = await webhook(
        intentEvent('evt_1', 'payment_intent.succeeded', intentId),
        'not-the-signature',
      );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ErrorCode.BadSignature);
      expect(await webhookEvents.countDocuments()).toBe(0);
      expect(await statusOf(paymentId)).toBe('pending');
      expect(succeeded).not.toHaveBeenCalled();
    });

    it('400 BAD_SIGNATURE without the signature header', async () => {
      const res = await t
        .http()
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ id: 'evt_1' }));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ErrorCode.BadSignature);
      expect(await webhookEvents.countDocuments()).toBe(0);
    });

    it('answers 200 and changes nothing for an unknown PaymentIntent', async () => {
      const bookingId = await readyFlight();
      const { paymentId } = await started(bookingId);

      const res = await webhook(
        intentEvent('evt_x', 'payment_intent.succeeded', 'pi_not_ours'),
      );

      expect(res.status).toBe(200);
      expect(await statusOf(paymentId)).toBe('pending');
      expect(succeeded).not.toHaveBeenCalled();
    });

    it('answers 200 for an event type it ignores', async () => {
      const res = await webhook({
        id: 'evt_x',
        type: 'ignored',
        originalType: 'customer.created',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
      expect(succeeded).not.toHaveBeenCalled();
    });

    it('records a late payment on a canceled payment and still emits', async () => {
      const bookingId = await readyFlight();
      const { paymentId, intentId } = await started(bookingId);
      await payments.updateOne({ _id: paymentId }, { status: 'canceled' });

      await webhook(
        intentEvent('evt_late', 'payment_intent.succeeded', intentId),
      );

      expect(await statusOf(paymentId)).toBe('succeeded');
      expect(succeeded).toHaveBeenCalledTimes(1);
    });

    it('does not move a succeeded payment back to failed', async () => {
      const bookingId = await readyFlight();
      const { paymentId, intentId } = await started(bookingId);
      await webhook(intentEvent('evt_1', 'payment_intent.succeeded', intentId));

      await webhook(
        intentEvent('evt_2', 'payment_intent.payment_failed', intentId),
      );

      expect(await statusOf(paymentId)).toBe('succeeded');
      expect(succeeded).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /api/payments/:id/retry', () => {
    it("404 for another user's payment", async () => {
      const { paymentId } = await started(await readyFlight());
      const other = await loginAs(t.connection, Role.USER);

      const res = await t
        .http()
        .post(`${START}/${paymentId}/retry`)
        .set('Cookie', other.cookie);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ErrorCode.NotFound);
    });

    it('409 INVALID_STATUS_TRANSITION for a succeeded payment', async () => {
      const { paymentId, intentId } = await started(await readyFlight());
      await webhook(intentEvent('evt_1', 'payment_intent.succeeded', intentId));

      const res = await t
        .http()
        .post(`${START}/${paymentId}/retry`)
        .set('Cookie', user.cookie);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.InvalidStatusTransition);
    });

    it('409 HOLD_EXPIRED when the hold is over, and leaves a failed payment failed', async () => {
      const bookingId = await readyFlight();
      const { paymentId, intentId } = await started(bookingId);
      await webhook(
        intentEvent('evt_1', 'payment_intent.payment_failed', intentId),
      );
      pending(bookingId, user.id, {
        holdExpiresAt: new Date(Date.now() - 1000),
      });

      const res = await t
        .http()
        .post(`${START}/${paymentId}/retry`)
        .set('Cookie', user.cookie);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCode.HoldExpired);
      expect(await statusOf(paymentId)).toBe('failed');
    });

    it('400 VALIDATION_FAILED for a malformed id', async () => {
      const res = await t
        .http()
        .post(`${START}/abc/retry`)
        .set('Cookie', user.cookie);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ErrorCode.ValidationFailed);
    });
  });

  describe('GET /api/payments/:id', () => {
    it('returns the owner the payment without Stripe ids or secrets', async () => {
      const bookingId = await readyFlight();
      const { paymentId } = await started(bookingId);

      const res = await t
        .http()
        .get(`${START}/${paymentId}`)
        .set('Cookie', user.cookie);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          '_id',
          'amountMinor',
          'bookingId',
          'bookingType',
          'createdAt',
          'currency',
          'status',
        ].sort(),
      );
      expect(res.body).toMatchObject({
        _id: paymentId,
        bookingType: 'flight',
        bookingId,
        amountMinor: 25_000,
        currency: 'USD',
        status: 'pending',
      });
    });

    it("404 for another user's payment", async () => {
      const { paymentId } = await started(await readyFlight());
      const other = await loginAs(t.connection, Role.USER);

      const res = await t
        .http()
        .get(`${START}/${paymentId}`)
        .set('Cookie', other.cookie);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ErrorCode.NotFound);
    });

    it('400 for a malformed id and 401 without a login', async () => {
      const bad = await t.http().get(`${START}/abc`).set('Cookie', user.cookie);
      expect(bad.status).toBe(400);
      const anonymous = await t
        .http()
        .get(`${START}/${new Types.ObjectId().toHexString()}`);
      expect(anonymous.status).toBe(401);
    });
  });

  it('is documented in Swagger with its requirement ID', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    const operations = [
      document.paths['/api/payments']?.post,
      document.paths['/api/payments/webhook']?.post,
      document.paths['/api/payments/{id}/retry']?.post,
      document.paths['/api/payments/{id}']?.get,
    ];
    for (const operation of operations) {
      expect(operation?.summary).toContain('PAY-01');
      expect(operation?.tags).toEqual(['payments']);
    }
    for (const operation of [operations[2], operations[3]]) {
      expect(operation?.parameters).toContainEqual(
        expect.objectContaining({
          name: 'id',
          in: 'path',
          schema: { type: 'string' },
        }),
      );
    }
  });
});
