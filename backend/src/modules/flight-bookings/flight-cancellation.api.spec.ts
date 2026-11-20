import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeFlightsData } from '../../../test/fakes/flights-data.fake.js';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakePaymentsService } from '../../../test/fakes/payments.fake.js';
import { FakeSeatInventory } from '../../../test/fakes/seat-inventory.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { FlightsService } from '../flights/flights.service.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { PaymentsService } from '../payments/payments.service.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { FlightBooking } from './schemas/flight-booking.schema.js';

const URL = '/api/flight-bookings';
const AIRLINE = '6553a1f0c2b4e8a9d0f1b001';
const FLIGHT = '6553a1f0c2b4e8a9d0f1b002';
const CABIN = '6553a1f0c2b4e8a9d0f1b003';
const DEPARTS = new Date('2027-03-10T08:00:00.000Z');
const HOUR = 3_600_000;

function seedFlights(): FakeFlightsData {
  const data = new FakeFlightsData();
  data.addAirline({ id: AIRLINE, code: 'MS' });
  data.addFlight({
    id: FLIGHT,
    airlineId: AIRLINE,
    flightNumber: 'MS100',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAt: DEPARTS,
    arrivalAt: new Date(DEPARTS.getTime() + 4 * HOUR),
    cabins: [
      { id: CABIN, cabinClass: 'economy', totalSeats: 50, priceMinor: 20_000 },
    ],
  });
  return data;
}

describe('flight cancellation endpoints (FLT-26)', () => {
  let t: TestApp;
  let bookings: Model<FlightBooking>;
  const flights = new FakeFlightsService();
  const seats = new FakeSeatInventory();
  const payments = new FakePaymentsService();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FlightBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightsService)
          .useValue(flights)
          .overrideProvider(SeatInventory)
          .useValue(seats)
          .overrideProvider(PaymentsService)
          .useValue(payments),
    });
    bookings = t.moduleRef.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    const data = seedFlights();
    Object.assign(flights, new FakeFlightsService(data));
    Object.assign(seats, new FakeSeatInventory(data));
    payments.refunds.length = 0;
    await clearCollections(t.connection);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-01T00:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());
  afterAll(() => t.close(), HOOK_TIMEOUT);

  /** A confirmed one-way booking (2 seats) with its seats booked. */
  async function seed(userId: string, status = 'confirmed' as const) {
    const booking = await bookings.create({
      userId,
      reference: 'FBAPI001',
      status,
      tripType: 'one_way',
      segments: [
        {
          direction: 'outbound',
          flightId: FLIGHT,
          cabinId: CABIN,
          cabinClass: 'economy',
          airlineId: AIRLINE,
          flightNumber: 'MS100',
          departureAirportId: 'CAI',
          arrivalAirportId: 'DXB',
          departureAt: DEPARTS,
          arrivalAt: new Date(DEPARTS.getTime() + 4 * HOUR),
          fareMinor: 20_000,
          policy: {
            cancellationTiers: [{ daysBefore: 3, refundPercent: 50 }],
            freeBags: 1,
            maxBagWeightKg: 23,
            extraBagPriceMinor: 0,
            maxExtraBagsPerPassenger: 0,
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
        {
          type: 'adult',
          fullName: 'Jana Test',
          dateOfBirth: new Date('1991-02-02T00:00:00.000Z'),
          documentNumber: 'B7654321',
          extraBagCount: 0,
        },
      ],
      seatCount: 2,
      pricing: {
        fareTotalMinor: 40_000,
        baggageTotalMinor: 0,
        totalMinor: 40_000,
        currency: 'USD',
      },
      holdExpiresAt: new Date('2027-03-01T00:10:00.000Z'),
      firstDepartureAt: DEPARTS,
      lastDepartureAt: DEPARTS,
    });
    if (status === 'confirmed') {
      const items = [{ flightId: FLIGHT, cabinId: CABIN, seats: 2 }];
      await seats.hold(items);
      await seats.confirm(items);
    }
    return booking;
  }

  it('previews then cancels the whole booking with typed public responses', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    const preview = await t
      .http()
      .get(`${URL}/${booking.id}/refund-preview`)
      .set('Cookie', user.cookie);
    expect(preview.status).toBe(200);
    expect(preview.headers['cache-control']).toBe('private, no-store');
    expect(preview.body).toEqual({
      percent: 50,
      amountMinor: 20_000,
      currency: 'USD',
    });
    // Previewing changes nothing.
    expect(seats.counters(FLIGHT, CABIN)).toMatchObject({ bookedSeats: 2 });

    const result = await t
      .http()
      .post(`${URL}/${booking.id}/cancel`)
      .set('Cookie', user.cookie)
      .send({});
    expect(result.status).toBe(200);
    expect(Object.keys(result.body).sort()).toEqual([
      '_id',
      'cancellation',
      'reference',
      'refund',
      'status',
    ]);
    expect(result.body).toMatchObject({
      _id: booking.id,
      reference: 'FBAPI001',
      status: 'cancelled',
      cancellation: {
        cancelledAt: '2027-03-01T00:00:00.000Z',
        cancelledBy: 'user',
        refundPercent: 50,
        refundAmountMinor: 20_000,
      },
      refund: { status: 'pending', amountMinor: 20_000, currency: 'USD' },
    });
    expect(result.body.refund.refundId).toMatch(/^[0-9a-f]{24}$/);
    expect((await bookings.findById(booking.id).lean())?.status).toBe(
      'cancelled',
    );
    expect(seats.counters(FLIGHT, CABIN)).toMatchObject({
      bookedSeats: 0,
      availableSeats: 50,
    });
  });

  it('answers a second cancellation with 409 and refunds only once', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);
    const cancel = () =>
      t
        .http()
        .post(`${URL}/${booking.id}/cancel`)
        .set('Cookie', user.cookie)
        .send({});

    expect((await cancel()).status).toBe(200);
    const again = await cancel();

    expect(again.status).toBe(409);
    expect(again.body.code).toBe(ErrorCode.InvalidStatusTransition);
    expect(payments.refunds).toHaveLength(1);
  });

  it.each(['refund-preview', 'cancel'])(
    '%s requires login, the user role and ownership',
    async (action) => {
      const user = await loginAs(t.connection, UserRole.USER);
      const booking = await seed(user.id);
      const call = (id = booking.id) =>
        action === 'cancel'
          ? t.http().post(`${URL}/${id}/${action}`).send({})
          : t.http().get(`${URL}/${id}/${action}`);

      const anonymous = await call();
      expect(anonymous.status).toBe(401);
      expect(anonymous.body.code).toBe(ErrorCode.NotAuthenticated);

      for (const role of [
        UserRole.ADMIN,
        UserRole.HOTEL_MODERATOR,
        UserRole.AIRLINE_MODERATOR,
      ]) {
        const other = await loginAs(t.connection, role);
        const result = await call().set('Cookie', other.cookie);
        expect(result.status).toBe(403);
        expect(result.body.code).toBe(ErrorCode.ForbiddenRole);
      }

      const stranger = await loginAs(t.connection, UserRole.USER);
      const hidden = await call().set('Cookie', stranger.cookie);
      expect(hidden.status).toBe(404);
      expect(hidden.body.code).toBe(ErrorCode.NotFound);

      for (const id of [new Types.ObjectId().toHexString(), 'not-an-id']) {
        const missing = await call(id).set('Cookie', user.cookie);
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBe(ErrorCode.NotFound);
      }
      expect((await bookings.findById(booking.id).lean())?.status).toBe(
        'confirmed',
      );
    },
  );

  it('rejects a body that is not empty, and an array, without cancelling', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    for (const body of [
      { amountMinor: 1 },
      { userId: user.id },
      { seats: 1 },
      [],
    ]) {
      const result = await t
        .http()
        .post(`${URL}/${booking.id}/cancel`)
        .set('Cookie', user.cookie)
        .send(body);
      expect(result.status).toBe(400);
      expect(result.body.code).toBe(ErrorCode.ValidationFailed);
    }
    expect((await bookings.findById(booking.id).lean())?.status).toBe(
      'confirmed',
    );
    expect(seats.counters(FLIGHT, CABIN)).toMatchObject({ bookedSeats: 2 });
    expect(payments.refunds).toHaveLength(0);
  });

  it.each(['refund-preview', 'cancel'])(
    '%s blocks the departure moment and a booking that is not confirmed',
    async (action) => {
      // Access tokens are short-lived: log in just before the moment under test.
      vi.setSystemTime(new Date('2027-03-10T07:59:59.999Z'));
      const user = await loginAs(t.connection, UserRole.USER);
      const booking = await seed(user.id);
      const call = () =>
        (action === 'cancel'
          ? t.http().post(`${URL}/${booking.id}/cancel`).send({})
          : t.http().get(`${URL}/${booking.id}/refund-preview`)
        ).set('Cookie', user.cookie);

      vi.setSystemTime(DEPARTS);
      let result = await call();
      expect(result.status).toBe(409);
      expect(result.body.code).toBe(ErrorCode.InvalidStatusTransition);

      vi.setSystemTime(new Date('2027-03-10T07:59:59.999Z'));
      await bookings.updateOne(
        { _id: booking.id },
        { $set: { status: 'cancelled' } },
      );
      result = await call();
      expect(result.status).toBe(409);
      expect(result.body.code).toBe(ErrorCode.InvalidStatusTransition);
    },
  );

  it('documents both operations, public response types and auth errors in Swagger', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    for (const [route, method] of [
      ['refund-preview', 'get'],
      ['cancel', 'post'],
    ] as const) {
      const operation = document.paths[`${URL}/{id}/${route}`]?.[method];
      expect(operation?.summary).toMatch(/^FLT-26 /);
      expect(operation?.responses['200']).toMatchObject({
        content: {
          'application/json': { schema: { $ref: expect.any(String) } },
        },
      });
      for (const code of ['401', '403', '404', '409']) {
        expect(operation?.responses[code]).toBeDefined();
      }
    }
    expect(
      document.paths[`${URL}/{id}/cancel`]?.post?.responses['400'],
    ).toBeDefined();
  });
});
