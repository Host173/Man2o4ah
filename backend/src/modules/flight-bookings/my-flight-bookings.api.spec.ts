import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakePaymentsService } from '../../../test/fakes/payments.fake.js';
import { FakeSeatInventory } from '../../../test/fakes/seat-inventory.fake.js';
import { loginAs, type LoggedInUser } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { FlightsService } from '../flights/flights.service.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { PaymentsService } from '../payments/payments.service.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import {
  FlightBooking,
  type FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('my flight bookings (FLT-25)', () => {
  let t: TestApp;
  let model: Model<FlightBooking>;
  let owner: LoggedInUser;
  let references = 0;
  const payments = new FakePaymentsService();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FlightBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightsService)
          .useValue(new FakeFlightsService())
          .overrideProvider(SeatInventory)
          .useValue(new FakeSeatInventory())
          .overrideProvider(PaymentsService)
          .useValue(payments),
    });
    model = t.moduleRef.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    payments.refunds.length = 0;
    owner = await loginAs(t.connection, UserRole.USER);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  /** Saves a one-way booking departing `departsIn` ms from now (negative = already left). */
  async function seed(
    status: FlightBookingStatus,
    departsIn: number,
    user: LoggedInUser = owner,
  ): Promise<string> {
    const departureAt = new Date(Date.now() + departsIn);
    const booked = status !== 'pending_payment' && status !== 'expired';
    const doc = await model.create({
      userId: new Types.ObjectId(user.id),
      reference: booked
        ? `FBLST${String((references += 1)).padStart(3, '0')}`
        : undefined,
      status,
      tripType: 'one_way',
      segments: [
        {
          direction: 'outbound',
          flightId: new Types.ObjectId(),
          cabinId: new Types.ObjectId(),
          cabinClass: 'economy',
          airlineId: new Types.ObjectId(),
          flightNumber: 'MS100',
          departureAirportId: 'CAI',
          arrivalAirportId: 'DXB',
          departureAt,
          arrivalAt: new Date(departureAt.getTime() + 4 * HOUR),
          fareMinor: 20_000,
          policy: {
            cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
            freeBags: 1,
            maxBagWeightKg: 23,
            extraBagPriceMinor: 3_000,
            maxExtraBagsPerPassenger: 2,
          },
        },
      ],
      passengers: [
        {
          type: 'adult',
          fullName: 'Aya Amr',
          dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
          documentNumber: 'A1234567',
          extraBagCount: 0,
        },
      ],
      seatCount: 1,
      pricing: {
        fareTotalMinor: 20_000,
        baggageTotalMinor: 0,
        totalMinor: 20_000,
        currency: 'USD',
      },
      holdExpiresAt: new Date(Date.now() + 10 * 60_000),
      firstDepartureAt: departureAt,
      lastDepartureAt: departureAt,
      cancellation:
        status === 'cancelled'
          ? {
              cancelledAt: new Date(),
              cancelledBy: 'user',
              refundPercent: 50,
              refundAmountMinor: 10_000,
            }
          : undefined,
    });
    return doc._id.toHexString();
  }

  const list = (query: string, user: LoggedInUser = owner) =>
    t.http().get(`/api/flight-bookings?${query}`).set('Cookie', user.cookie);

  const details = (id: string, user: LoggedInUser = owner) =>
    t.http().get(`/api/flight-bookings/${id}`).set('Cookie', user.cookie);

  const ids = (body: { items: { _id: string }[] }) =>
    body.items.map((item) => item._id);

  describe('GET /api/flight-bookings', () => {
    /** One booking of every kind, plus a stranger's; returns the owner's ids by name. */
    async function seedEveryKind() {
      const stranger = await loginAs(t.connection, UserRole.USER);
      const booking = {
        upcomingLater: await seed('confirmed', 30 * DAY),
        upcomingSoon: await seed('confirmed', 2 * DAY),
        departedNotCompleted: await seed('confirmed', -1 * HOUR),
        completedOld: await seed('completed', -30 * DAY),
        cancelled: await seed('cancelled', 5 * DAY),
        cancelledEarlier: await seed('cancelled', -10 * DAY),
        pending: await seed('pending_payment', 3 * DAY),
        expired: await seed('expired', 3 * DAY),
      };
      await seed('confirmed', 4 * DAY, stranger);
      await seed('completed', -4 * DAY, stranger);
      await seed('cancelled', 4 * DAY, stranger);
      return booking;
    }

    it('upcoming: my confirmed bookings not departed yet, soonest first', async () => {
      const b = await seedEveryKind();

      const res = await list('group=upcoming').expect(200);

      expect(ids(res.body)).toEqual([b.upcomingSoon, b.upcomingLater]);
      expect(res.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });
    });

    it('past: completed, or confirmed whose flight has left, most recent first', async () => {
      const b = await seedEveryKind();

      const res = await list('group=past').expect(200);

      expect(ids(res.body)).toEqual([b.departedNotCompleted, b.completedOld]);
    });

    it('cancelled: my cancelled bookings, most recent departure first', async () => {
      const b = await seedEveryKind();

      const res = await list('group=cancelled').expect(200);

      expect(ids(res.body)).toEqual([b.cancelled, b.cancelledEarlier]);
    });

    it('never lists pending or expired bookings', async () => {
      const b = await seedEveryKind();

      const all = await Promise.all(
        ['upcoming', 'past', 'cancelled'].map((g) =>
          list(`group=${g}`).expect(200),
        ),
      );

      const listed = all.flatMap((res) => ids(res.body));
      expect(listed).not.toContain(b.pending);
      expect(listed).not.toContain(b.expired);
      expect(listed).toHaveLength(6);
    });

    it('shows reference, flight, date, passengers, cabin and status, without document numbers', async () => {
      const id = await seed('confirmed', 2 * DAY);

      const res = await list('group=upcoming').expect(200);

      const [row] = res.body.items;
      expect(row).toMatchObject({
        _id: id,
        reference: expect.stringMatching(/^FB[A-Z0-9]{6}$/),
        status: 'confirmed',
        tripType: 'one_way',
        firstDepartureAt: expect.any(String),
        seatCount: 1,
        passengers: [{ type: 'adult', fullName: 'Aya Amr' }],
        segments: [
          {
            direction: 'outbound',
            flightNumber: 'MS100',
            departureAirportId: 'CAI',
            arrivalAirportId: 'DXB',
            cabinClass: 'economy',
          },
        ],
        pricing: { totalMinor: 20_000, currency: 'USD' },
      });
      expect(row.passengers[0]).not.toHaveProperty('documentNumber');
      expect(row.segments[0]).not.toHaveProperty('policy');
    });

    it('pages through a group', async () => {
      const soon = await seed('confirmed', 1 * DAY);
      const middle = await seed('confirmed', 2 * DAY);
      const late = await seed('confirmed', 3 * DAY);

      const first = await list('group=upcoming&limit=2&page=1').expect(200);
      const second = await list('group=upcoming&limit=2&page=2').expect(200);

      expect(ids(first.body)).toEqual([soon, middle]);
      expect(ids(second.body)).toEqual([late]);
      expect(second.body).toMatchObject({ total: 3, totalPages: 2, page: 2 });
    });

    it('answers an empty page when I have no bookings', async () => {
      const res = await list('group=past').expect(200);

      expect(res.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });

    it.each([
      ['a missing group', ''],
      ['an unknown group', 'group=pending'],
      ['a page below 1', 'group=upcoming&page=0'],
      ['a limit above 50', 'group=upcoming&limit=51'],
    ])('answers 400 VALIDATION_FAILED for %s', async (_label, query) => {
      const res = await list(query).expect(400);
      expect(res.body.code).toBe(ErrorCode.ValidationFailed);
    });

    it('answers 401 NOT_AUTHENTICATED without a login', async () => {
      const res = await t
        .http()
        .get('/api/flight-bookings?group=upcoming')
        .expect(401);
      expect(res.body.code).toBe(ErrorCode.NotAuthenticated);
    });
  });

  describe('GET /api/flight-bookings/:id', () => {
    it('shows the full booking to its owner', async () => {
      const id = await seed('cancelled', 5 * DAY);

      const res = await details(id).expect(200);

      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body).toMatchObject({
        _id: id,
        status: 'cancelled',
        passengers: [
          {
            fullName: 'Aya Amr',
            dateOfBirth: '1990-01-01',
            documentNumber: 'A1234567',
          },
        ],
        segments: [
          {
            flightNumber: 'MS100',
            fareMinor: 20_000,
            policy: {
              cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
            },
          },
        ],
        pricing: {
          fareTotalMinor: 20_000,
          baggageTotalMinor: 0,
          totalMinor: 20_000,
          currency: 'USD',
        },
        cancellation: { cancelledBy: 'user', refundPercent: 50 },
        createdAt: expect.any(String),
      });
      expect(res.body).not.toHaveProperty('userId');
    });

    it('shows a pending booking too (it is in no list group)', async () => {
      const id = await seed('pending_payment', 3 * DAY);

      const res = await details(id).expect(200);

      expect(res.body.status).toBe('pending_payment');
      expect(res.body).not.toHaveProperty('reference');
    });

    it('answers 404 NOT_FOUND for another user’s booking (ACC-11)', async () => {
      const id = await seed('confirmed', 2 * DAY);
      const stranger = await loginAs(t.connection, UserRole.USER);

      const res = await details(id, stranger).expect(404);
      expect(res.body.code).toBe(ErrorCode.NotFound);
    });

    it.each([
      ['an unknown id', () => new Types.ObjectId().toHexString()],
      ['a malformed id', () => 'not-an-id'],
    ])('answers 404 NOT_FOUND for %s', async (_label, id) => {
      const res = await details(id()).expect(404);
      expect(res.body.code).toBe(ErrorCode.NotFound);
    });

    it('answers 401 NOT_AUTHENTICATED without a login', async () => {
      const id = await seed('confirmed', 2 * DAY);

      const res = await t.http().get(`/api/flight-bookings/${id}`).expect(401);
      expect(res.body.code).toBe(ErrorCode.NotAuthenticated);
    });
  });

  describe('the refund on the details (PAY-03)', () => {
    it('shows a failed refund on a cancelled booking', async () => {
      const id = await seed('cancelled', 30 * DAY);
      const refund = await payments.refund({
        bookingType: 'flight',
        bookingId: id,
        amountMinor: 10_000,
        currency: 'USD',
        reason: 'user_cancellation',
      });
      payments.setStatus(refund.refundId, 'failed');

      const res = await details(id).expect(200);
      expect(res.body.refund).toEqual({ ...refund, status: 'failed' });
    });

    it('shows a late-payment refund on an expired booking with no cancellation', async () => {
      const id = await seed('expired', 30 * DAY);
      await payments.refund({
        bookingType: 'flight',
        bookingId: id,
        amountMinor: 20_000,
        currency: 'USD',
        reason: 'late_payment',
      });

      const res = await details(id).expect(200);
      expect(res.body.refund).toMatchObject({
        reason: 'late_payment',
        status: 'pending',
      });
      expect(res.body.cancellation).toBeUndefined();
    });

    it('shows a refunded provider cancellation', async () => {
      const id = await seed('cancelled', 30 * DAY);
      const refund = await payments.refund({
        bookingType: 'flight',
        bookingId: id,
        amountMinor: 20_000,
        currency: 'USD',
        reason: 'provider_cancellation',
      });
      payments.setStatus(refund.refundId, 'refunded');

      const res = await details(id).expect(200);
      expect(res.body.refund).toMatchObject({
        reason: 'provider_cancellation',
        status: 'refunded',
      });
    });

    it('answers refund null when none was issued', async () => {
      const id = await seed('confirmed', 30 * DAY);

      const res = await details(id).expect(200);
      expect(res.body).toHaveProperty('refund', null);
    });
  });

  it('documents both routes in Swagger with their requirement ID', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    expect(document.paths['/api/flight-bookings']?.get?.summary).toMatch(
      /^FLT-25 /,
    );
    expect(document.paths['/api/flight-bookings/{id}']?.get?.summary).toMatch(
      /^FLT-25 /,
    );
    expect(
      document.components?.schemas?.MyFlightBookingResponseDto,
    ).toHaveProperty('properties.refund');
  });
});
