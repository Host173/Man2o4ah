import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakePayableBooking } from '../../../test/fakes/payable-booking.fake.js';
import { FakeStripeGateway } from '../../../test/fakes/stripe-gateway.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import type { LoggedInUser } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { BookingType } from '../../common/database/booking-type.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { Role } from '../accounts/auth/auth.types.js';
import { PaymentsModule } from './payments.module.js';
import type { BookingPolicies, Payable } from './ports/payable-booking.port.js';
import { PayableBookingRegistry } from './ports/payable-booking.registry.js';
import { PolicyAcceptance } from './schemas/policy-acceptance.schema.js';
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';

const MINUTE_MS = 60_000;

const SEGMENT = {
  cancellationTiers: [
    { daysBefore: 7, refundPercent: 100 },
    { daysBefore: 1, refundPercent: 50 },
  ],
  freeBags: 1,
  maxBagWeightKg: 23,
  extraBagPriceMinor: 5000,
  maxExtraBagsPerPassenger: 2,
};

const FLIGHT_POLICIES: BookingPolicies = {
  bookingType: 'flight',
  segments: [
    { direction: 'outbound', flightNumber: 'MS 777', ...SEGMENT },
    { direction: 'return', flightNumber: 'MS 778', ...SEGMENT },
  ],
};

const HOTEL_POLICIES: BookingPolicies = {
  bookingType: 'hotel',
  cancellationTiers: [{ daysBefore: 3, refundPercent: 100 }],
  checkInTime: '14:00',
  checkOutTime: '11:00',
};

describe('policies API (PAY-02)', () => {
  const gateway = new FakeStripeGateway();
  const flights = new FakePayableBooking(BookingType.FLIGHT);
  const hotels = new FakePayableBooking(BookingType.HOTEL);
  let t: TestApp;
  let user: LoggedInUser;
  let acceptances: Model<PolicyAcceptance>;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [PaymentsModule],
      override: (builder) =>
        builder.overrideProvider(STRIPE_GATEWAY).useValue(gateway),
    });
    const registry = t.moduleRef.get(PayableBookingRegistry);
    registry.register(flights);
    registry.register(hotels);
    acceptances = t.moduleRef.get<Model<PolicyAcceptance>>(
      getModelToken(PolicyAcceptance.name),
    );
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    gateway.calls.length = 0;
    // Log in after the clear: it wipes the users and sessions too.
    user = await loginAs(t.connection, Role.USER);
  });

  function payableOf(overrides: Partial<Payable>): Payable {
    return {
      amountMinor: 25_000,
      currency: 'USD',
      status: 'pending_payment',
      holdExpiresAt: new Date(Date.now() + 10 * MINUTE_MS),
      ...overrides,
    };
  }

  function flightBooking(userId: string, overrides: Partial<Payable> = {}) {
    const id = new Types.ObjectId().toHexString();
    flights.set(id, userId, payableOf(overrides), FLIGHT_POLICIES);
    return id;
  }

  function hotelBooking(userId: string, overrides: Partial<Payable> = {}) {
    const id = new Types.ObjectId().toHexString();
    hotels.set(id, userId, payableOf(overrides), HOTEL_POLICIES);
    return id;
  }

  function getPolicies(type: string, id: string, who = user) {
    return t
      .http()
      .get(`/api/bookings/${type}/${id}/policies`)
      .set('Cookie', who.cookie);
  }

  function accept(
    type: string,
    id: string,
    body: unknown = { accepted: true },
    who = user,
  ) {
    return t
      .http()
      .post(`/api/bookings/${type}/${id}/accept-policies`)
      .set('Cookie', who.cookie)
      .send(body as object);
  }

  describe('GET /api/bookings/:type/:id/policies', () => {
    it('returns the flight snapshot unchanged: every segment, tier and baggage field', async () => {
      const id = flightBooking(user.id);

      const res = await getPolicies('flight', id);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ...FLIGHT_POLICIES,
        bookingId: id,
        accepted: false,
        acceptedAt: null,
      });
    });

    it('returns the hotel snapshot', async () => {
      const id = hotelBooking(user.id);

      const res = await getPolicies('hotel', id);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ...HOTEL_POLICIES,
        bookingId: id,
        accepted: false,
        acceptedAt: null,
      });
    });

    it.each(['confirmed', 'expired'] as const)(
      'works for a %s booking',
      async (status) => {
        const id = flightBooking(user.id, { status });
        expect((await getPolicies('flight', id)).status).toBe(200);
      },
    );

    it("404 NOT_FOUND for another user's booking", async () => {
      const id = flightBooking(user.id);
      const other = await loginAs(t.connection, Role.USER);

      const res = await getPolicies('flight', id, other);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ErrorCode.NotFound);
    });

    it('shows the acceptance after accepting, with the time POST returned', async () => {
      const id = flightBooking(user.id);
      const accepted = await accept('flight', id);

      const res = await getPolicies('flight', id);

      expect(res.body.accepted).toBe(true);
      expect(res.body.acceptedAt).toBe(accepted.body.acceptedAt);
    });

    it('never returns the user or a document id', async () => {
      const id = flightBooking(user.id);
      await accept('flight', id);

      const res = await getPolicies('flight', id);

      expect(res.body).not.toHaveProperty('userId');
      expect(res.body).not.toHaveProperty('_id');
    });
  });

  describe('POST /api/bookings/:type/:id/accept-policies', () => {
    it("answers 200 and stores one acceptance with the server's time", async () => {
      const id = flightBooking(user.id);
      const before = Date.now();

      const res = await accept('flight', id);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        bookingType: 'flight',
        bookingId: id,
        accepted: true,
        acceptedAt: expect.any(String),
      });
      const at = new Date(res.body.acceptedAt).getTime();
      expect(at).toBeGreaterThanOrEqual(before);
      expect(at).toBeLessThanOrEqual(Date.now());
      const docs = await acceptances.find().lean();
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({ bookingType: 'flight' });
      expect(docs[0]?.bookingId.toString()).toBe(id);
      expect(docs[0]?.userId.toString()).toBe(user.id);
      expect(docs[0]?.acceptedAt.getTime()).toBe(at);
      expect(res.body).not.toHaveProperty('userId');
      expect(res.body).not.toHaveProperty('_id');
    });

    it('keeps the first timestamp when accepted again', async () => {
      const id = flightBooking(user.id);

      const first = await accept('flight', id);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = await accept('flight', id);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.acceptedAt).toBe(first.body.acceptedAt);
      expect(await acceptances.countDocuments()).toBe(1);
    });

    it('stores one acceptance for 5 parallel requests, all with the same time', async () => {
      const id = flightBooking(user.id);

      const results = await Promise.all(
        Array.from({ length: 5 }, () => accept('flight', id)),
      );

      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(new Set(results.map((r) => r.body.acceptedAt)).size).toBe(1);
      expect(await acceptances.countDocuments()).toBe(1);
    });

    it('accepts the policies of a hotel reservation', async () => {
      const id = hotelBooking(user.id);

      const res = await accept('hotel', id);

      expect(res.status).toBe(200);
      expect(res.body.bookingType).toBe('hotel');
      expect((await acceptances.findOne().lean())?.bookingType).toBe('hotel');
    });

    it.each([
      ['accepted false', { accepted: false }],
      ['an empty body', {}],
      ['accepted as a string', { accepted: 'true' }],
      ['accepted as a number', { accepted: 1 }],
      [
        'an extra field',
        { accepted: true, acceptedAt: '2020-01-01T00:00:00Z' },
      ],
    ])(
      '400 VALIDATION_FAILED for %s, and stores nothing',
      async (_name, body) => {
        const id = flightBooking(user.id);

        const res = await accept('flight', id, body);

        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ErrorCode.ValidationFailed);
        expect(await acceptances.countDocuments()).toBe(0);
      },
    );

    describe('refusals store nothing', () => {
      async function expectRefused(
        id: string,
        status: number,
        code: string,
        who = user,
      ) {
        const res = await accept('flight', id, { accepted: true }, who);
        expect(res.status).toBe(status);
        expect(res.body.code).toBe(code);
        expect(await acceptances.countDocuments()).toBe(0);
      }

      it("404 NOT_FOUND for another user's booking", async () => {
        const id = flightBooking(user.id);
        const other = await loginAs(t.connection, Role.USER);
        await expectRefused(id, 404, ErrorCode.NotFound, other);
      });

      it('404 NOT_FOUND for a booking nobody created', async () => {
        await expectRefused(
          new Types.ObjectId().toHexString(),
          404,
          ErrorCode.NotFound,
        );
      });

      it.each(['confirmed', 'completed'] as const)(
        '409 INVALID_STATUS_TRANSITION for a %s booking',
        async (status) => {
          await expectRefused(
            flightBooking(user.id, { status }),
            409,
            ErrorCode.InvalidStatusTransition,
          );
        },
      );

      it.each(['expired', 'cancelled'] as const)(
        '409 HOLD_EXPIRED for an %s booking',
        async (status) => {
          await expectRefused(
            flightBooking(user.id, { status }),
            409,
            ErrorCode.HoldExpired,
          );
        },
      );

      it('409 HOLD_EXPIRED when the hold ended a second ago', async () => {
        await expectRefused(
          flightBooking(user.id, {
            holdExpiresAt: new Date(Date.now() - 1000),
          }),
          409,
          ErrorCode.HoldExpired,
        );
      });
    });
  });

  describe('params validation', () => {
    const id = new Types.ObjectId().toHexString();

    it.each([
      ['an unknown type', 'train', id],
      ['a malformed id', 'flight', 'abc'],
    ])(
      '400 VALIDATION_FAILED on both routes for %s',
      async (_name, type, bad) => {
        const read = await getPolicies(type, bad);
        const write = await accept(type, bad);

        expect(read.status).toBe(400);
        expect(read.body.code).toBe(ErrorCode.ValidationFailed);
        expect(write.status).toBe(400);
        expect(write.body.code).toBe(ErrorCode.ValidationFailed);
      },
    );
  });

  describe('access', () => {
    const id = new Types.ObjectId().toHexString();

    it('401 without a login on both routes', async () => {
      expect(
        (await t.http().get(`/api/bookings/flight/${id}/policies`)).status,
      ).toBe(401);
      expect(
        (
          await t
            .http()
            .post(`/api/bookings/flight/${id}/accept-policies`)
            .send({ accepted: true })
        ).status,
      ).toBe(401);
    });

    it.each([Role.ADMIN, Role.HOTEL_MODERATOR, Role.AIRLINE_MODERATOR])(
      '403 for a %s on both routes',
      async (role) => {
        const other = await loginAs(t.connection, role);

        const read = await getPolicies('flight', id, other);
        const write = await accept('flight', id, { accepted: true }, other);

        expect(read.status).toBe(403);
        expect(read.body.code).toBe(ErrorCode.ForbiddenRole);
        expect(write.status).toBe(403);
        expect(write.body.code).toBe(ErrorCode.ForbiddenRole);
      },
    );
  });

  it('blocks payment until the policies are accepted (end to end)', async () => {
    const id = flightBooking(user.id);
    const pay = () =>
      t
        .http()
        .post('/api/payments')
        .set('Cookie', user.cookie)
        .send({ bookingType: 'flight', bookingId: id });

    const blocked = await pay();
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe(ErrorCode.PoliciesNotAccepted);
    expect(gateway.calls).toEqual([]);

    expect((await accept('flight', id)).status).toBe(200);

    const paid = await pay();
    expect(paid.status).toBe(201);
    expect(typeof paid.body.clientSecret).toBe('string');
  });

  it('is documented in Swagger with its requirement ID', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    const read = document.paths['/api/bookings/{type}/{id}/policies']?.get;
    const write =
      document.paths['/api/bookings/{type}/{id}/accept-policies']?.post;
    for (const operation of [read, write]) {
      expect(operation?.summary).toContain('PAY-02');
      expect(operation?.tags).toEqual(['payments']);
    }
    const schemas = Object.keys(document.components?.schemas ?? {});
    expect(schemas).toEqual(
      expect.arrayContaining([
        'FlightPoliciesResponseDto',
        'HotelPoliciesResponseDto',
        'PolicyAcceptanceResponseDto',
      ]),
    );
  });
});
