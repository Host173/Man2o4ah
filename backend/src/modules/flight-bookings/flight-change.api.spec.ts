import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
/** The booked flight, CAI → DXB. */
const FLIGHT = '6553a1f0c2b4e8a9d0f1b002';
const CABIN = '6553a1f0c2b4e8a9d0f1b003';
/** Same route a day later, dearer. */
const LATER = '6553a1f0c2b4e8a9d0f1b004';
const LATER_CABIN = '6553a1f0c2b4e8a9d0f1b005';
/** Same route two days later, cheaper. */
const CHEAPER = '6553a1f0c2b4e8a9d0f1b006';
const CHEAPER_CABIN = '6553a1f0c2b4e8a9d0f1b007';
/** Another route, CAI → AUH. */
const ELSEWHERE = '6553a1f0c2b4e8a9d0f1b008';
const ELSEWHERE_CABIN = '6553a1f0c2b4e8a9d0f1b009';
/** Same route, but only one economy seat left. */
const FULL = '6553a1f0c2b4e8a9d0f1b00a';
const FULL_CABIN = '6553a1f0c2b4e8a9d0f1b00b';
/** Same route three days later, same fare. */
const SAME_FARE = '6553a1f0c2b4e8a9d0f1b00c';
const SAME_FARE_CABIN = '6553a1f0c2b4e8a9d0f1b00d';
const DEPARTS = new Date('2027-03-10T08:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function seedFlights(): FakeFlightsData {
  const data = new FakeFlightsData();
  data.addAirline({ id: AIRLINE, code: 'MS' });
  const flight = (
    id: string,
    cabinId: string,
    departureAt: Date,
    priceMinor: number,
    overrides: { arrivalAirportId?: string; availableSeats?: number } = {},
  ) =>
    data.addFlight({
      id,
      airlineId: AIRLINE,
      flightNumber: `MS${id.slice(-3)}`,
      departureAirportId: 'CAI',
      arrivalAirportId: overrides.arrivalAirportId ?? 'DXB',
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 4 * HOUR),
      cabins: [
        {
          id: cabinId,
          cabinClass: 'economy',
          totalSeats: 50,
          availableSeats: overrides.availableSeats,
          bookedSeats:
            overrides.availableSeats === undefined
              ? undefined
              : 50 - overrides.availableSeats,
          priceMinor,
        },
      ],
    });
  // The booking's 2 seats are booked on FLIGHT.
  flight(FLIGHT, CABIN, DEPARTS, 20_000, { availableSeats: 48 });
  flight(LATER, LATER_CABIN, new Date(DEPARTS.getTime() + DAY), 25_000);
  flight(CHEAPER, CHEAPER_CABIN, new Date(DEPARTS.getTime() + 2 * DAY), 15_000);
  flight(
    ELSEWHERE,
    ELSEWHERE_CABIN,
    new Date(DEPARTS.getTime() + DAY),
    20_000,
    {
      arrivalAirportId: 'AUH',
    },
  );
  flight(FULL, FULL_CABIN, new Date(DEPARTS.getTime() + DAY), 20_000, {
    availableSeats: 1,
  });
  flight(
    SAME_FARE,
    SAME_FARE_CABIN,
    new Date(DEPARTS.getTime() + 3 * DAY),
    20_000,
  );
  return data;
}

describe('flight change endpoints (FLT-27)', () => {
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

  /** A one-way booking for two adults on FLIGHT, paid 40 000. */
  async function seed(
    userId: string,
    status: 'confirmed' | 'cancelled' = 'confirmed',
  ) {
    const passenger = (fullName: string, dateOfBirth: string) => ({
      type: 'adult' as const,
      fullName,
      dateOfBirth: new Date(`${dateOfBirth}T00:00:00.000Z`),
      documentNumber: 'A1234567',
      extraBagCount: 0,
    });
    return bookings.create({
      userId,
      reference: 'FBCHG001',
      status,
      tripType: 'one_way',
      segments: [
        {
          direction: 'outbound',
          flightId: FLIGHT,
          cabinId: CABIN,
          cabinClass: 'economy',
          airlineId: AIRLINE,
          flightNumber: 'MS002',
          departureAirportId: 'CAI',
          arrivalAirportId: 'DXB',
          departureAt: DEPARTS,
          arrivalAt: new Date(DEPARTS.getTime() + 4 * HOUR),
          fareMinor: 20_000,
          policy: {
            cancellationTiers: [],
            freeBags: 1,
            maxBagWeightKg: 23,
            extraBagPriceMinor: 0,
            maxExtraBagsPerPassenger: 0,
          },
        },
      ],
      passengers: [
        passenger('Aya Amr', '1990-01-01'),
        passenger('Jana Test', '1991-02-02'),
      ],
      seatCount: 2,
      pricing: {
        fareTotalMinor: 40_000,
        baggageTotalMinor: 0,
        totalMinor: 40_000,
        currency: 'USD',
      },
      holdExpiresAt: new Date('2027-02-20T00:10:00.000Z'),
      firstDepartureAt: DEPARTS,
      lastDepartureAt: DEPARTS,
    });
  }

  const preview = (id: string, cookie: string, query: object) =>
    t
      .http()
      .get(`${URL}/${id}/change-preview`)
      .query(query)
      .set('Cookie', cookie);

  it('previews a dearer flight: the difference to pay, the new snapshot and pricing', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    const res = await preview(booking.id, user.cookie, {
      direction: 'outbound',
      flightId: LATER,
    });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toMatchObject({
      direction: 'outbound',
      segment: {
        direction: 'outbound',
        flightId: LATER,
        cabinId: LATER_CABIN,
        cabinClass: 'economy',
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureAt: new Date(DEPARTS.getTime() + DAY).toISOString(),
        fareMinor: 25_000,
      },
      pricing: {
        fareTotalMinor: 50_000,
        baggageTotalMinor: 0,
        totalMinor: 50_000,
        currency: 'USD',
      },
      differenceMinor: 10_000,
    });
    // A preview changes nothing: no seats held, booking untouched.
    expect(seats.counters(LATER, LATER_CABIN)).toMatchObject({
      heldSeats: 0,
      availableSeats: 50,
    });
    const stored = await bookings.findById(booking.id).lean();
    expect(stored?.pendingChange).toBeUndefined();
    expect(stored?.segments[0]?.flightId.toString()).toBe(FLIGHT);
  });

  it('previews a cheaper flight with a negative difference (a refund)', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    const res = await preview(booking.id, user.cookie, {
      direction: 'outbound',
      flightId: CHEAPER,
    });

    expect(res.status).toBe(200);
    expect(res.body.differenceMinor).toBe(-10_000);
    expect(res.body.pricing.totalMinor).toBe(30_000);
  });

  it('answers 404 for another user’s booking', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const stranger = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(owner.id);

    const res = await preview(booking.id, stranger.cookie, {
      direction: 'outbound',
      flightId: LATER,
    });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.NotFound);
  });

  it('answers 409 for a booking that is not confirmed', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id, 'cancelled');

    const res = await preview(booking.id, user.cookie, {
      direction: 'outbound',
      flightId: LATER,
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.InvalidStatusTransition);
  });

  it('answers 400 for the same flight or another route', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    for (const flightId of [FLIGHT, ELSEWHERE]) {
      const res = await preview(booking.id, user.cookie, {
        direction: 'outbound',
        flightId,
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ErrorCode.ValidationFailed);
      expect(res.body.details).toEqual([
        { field: 'flightId', message: expect.any(String) },
      ]);
    }
  });

  it('answers 400 for the return of a one-way booking', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    const res = await preview(booking.id, user.cookie, {
      direction: 'return',
      flightId: LATER,
    });

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([
      { field: 'direction', message: expect.any(String) },
    ]);
  });

  it('answers 400 for an unknown flight', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    const res = await preview(booking.id, user.cookie, {
      direction: 'outbound',
      flightId: '6553a1f0c2b4e8a9d0f1bfff',
    });

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([
      { field: 'flightId', message: expect.any(String) },
    ]);
  });

  it('answers 409 SEATS_UNAVAILABLE when the new flight lacks seats for everyone', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    const res = await preview(booking.id, user.cookie, {
      direction: 'outbound',
      flightId: FULL,
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.SeatsUnavailable);
  });

  it('validates the query', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    for (const query of [
      {},
      { direction: 'sideways', flightId: LATER },
      { direction: 'outbound', flightId: 'not-an-id' },
    ]) {
      const res = await preview(booking.id, user.cookie, query);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ErrorCode.ValidationFailed);
    }
  });

  const change = (id: string, cookie: string, body: object) =>
    t
      .http()
      .patch(`${URL}/${id}/change-flight`)
      .set('Cookie', cookie)
      .send(body);

  it('changes to a cheaper flight at once: moves the seats, updates the booking and refunds the difference', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    const res = await change(booking.id, user.cookie, {
      direction: 'outbound',
      flightId: CHEAPER,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      bookingId: booking.id,
      reference: 'FBCHG001',
      status: 'confirmed',
      direction: 'outbound',
      segment: { flightId: CHEAPER, cabinId: CHEAPER_CABIN, fareMinor: 15_000 },
      pricing: { totalMinor: 30_000, currency: 'USD' },
      differenceMinor: -10_000,
      refund: {
        amountMinor: 10_000,
        currency: 'USD',
        reason: 'booking_change',
        status: 'pending',
      },
    });
    expect(res.body.changeId).toMatch(/^[0-9a-f]{24}$/);

    // The seats moved from the old flight to the new one.
    expect(seats.counters(FLIGHT, CABIN)).toMatchObject({
      bookedSeats: 0,
      availableSeats: 50,
    });
    expect(seats.counters(CHEAPER, CHEAPER_CABIN)).toMatchObject({
      bookedSeats: 2,
      heldSeats: 0,
      availableSeats: 48,
    });

    // The booking was updated in place, with the change in its history.
    const stored = await bookings.findById(booking.id).lean();
    expect(stored?.status).toBe('confirmed');
    expect(stored?.segments[0]?.flightId.toString()).toBe(CHEAPER);
    expect(stored?.segments[0]?.fareMinor).toBe(15_000);
    expect(stored?.pricing.totalMinor).toBe(30_000);
    const newDeparture = new Date(DEPARTS.getTime() + 2 * DAY);
    expect(stored?.firstDepartureAt).toEqual(newDeparture);
    expect(stored?.lastDepartureAt).toEqual(newDeparture);
    expect(stored?.changes).toHaveLength(1);
    expect(stored?.changes?.[0]).toMatchObject({
      direction: 'outbound',
      previousTotalMinor: 40_000,
      newTotalMinor: 30_000,
      differenceMinor: -10_000,
    });
    expect(stored?.changes?.[0]?._id.toString()).toBe(res.body.changeId);
    expect(stored?.changes?.[0]?.previousSegment.flightId.toString()).toBe(
      FLIGHT,
    );
    expect(stored?.changes?.[0]?.newFlightId.toString()).toBe(CHEAPER);

    // The refund belongs to this change, not to a cancellation.
    expect(payments.refunds).toHaveLength(1);
    expect(payments.changeIds.get(res.body.refund.refundId)).toBe(
      res.body.changeId,
    );
  });

  it('changes to a flight with the same fare without a refund', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    const res = await change(booking.id, user.cookie, {
      direction: 'outbound',
      flightId: SAME_FARE,
    });

    expect(res.status).toBe(200);
    expect(res.body.differenceMinor).toBe(0);
    expect(res.body.refund).toBeNull();
    expect(payments.refunds).toHaveLength(0);
  });

  it('lets exactly one of two parallel changes win, and keeps every seat counted', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    const results = await Promise.all([
      change(booking.id, user.cookie, {
        direction: 'outbound',
        flightId: CHEAPER,
      }),
      change(booking.id, user.cookie, {
        direction: 'outbound',
        flightId: SAME_FARE,
      }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const stored = await bookings.findById(booking.id).lean();
    expect(stored?.changes).toHaveLength(1);
    // Two seats are booked in total, on whichever flight won.
    const booked = [
      seats.counters(FLIGHT, CABIN),
      seats.counters(CHEAPER, CHEAPER_CABIN),
      seats.counters(SAME_FARE, SAME_FARE_CABIN),
    ].map((c) => c.bookedSeats + c.heldSeats);
    expect(booked.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('changes nothing when the new flight lacks seats (409 SEATS_UNAVAILABLE)', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    const res = await change(booking.id, user.cookie, {
      direction: 'outbound',
      flightId: FULL,
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.SeatsUnavailable);
    const stored = await bookings.findById(booking.id).lean();
    expect(stored?.segments[0]?.flightId.toString()).toBe(FLIGHT);
    expect(stored?.changes).toBeUndefined();
    expect(seats.counters(FLIGHT, CABIN).bookedSeats).toBe(2);
  });

  it('answers 404 for another user’s booking and 409 for one that is not confirmed', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const stranger = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(owner.id);
    const body = { direction: 'outbound', flightId: CHEAPER };

    const notYours = await change(booking.id, stranger.cookie, body);
    expect(notYours.status).toBe(404);

    await bookings.updateOne({ _id: booking._id }, { status: 'cancelled' });
    const cancelled = await change(booking.id, owner.cookie, body);
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.code).toBe(ErrorCode.InvalidStatusTransition);
  });

  it('does not take payment yet: a dearer change answers 409 and changes nothing', async () => {
    // Paid changes (pendingChange + Stripe) come in the next FLT-27 step.
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    const res = await change(booking.id, user.cookie, {
      direction: 'outbound',
      flightId: LATER,
    });

    expect(res.status).toBe(409);
    const stored = await bookings.findById(booking.id).lean();
    expect(stored?.segments[0]?.flightId.toString()).toBe(FLIGHT);
    expect(seats.counters(LATER, LATER_CABIN).heldSeats).toBe(0);
  });

  it('validates the body', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const booking = await seed(user.id);

    for (const body of [
      {},
      { direction: 'sideways', flightId: CHEAPER },
      { direction: 'outbound', flightId: 'not-an-id' },
      { direction: 'outbound', flightId: CHEAPER, extra: true },
    ]) {
      const res = await change(booking.id, user.cookie, body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ErrorCode.ValidationFailed);
    }
  });

  it('documents the change operation in Swagger', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    const operation = document.paths[`${URL}/{id}/change-flight`]?.patch;
    expect(operation?.summary).toMatch(/^FLT-27 /);
    expect(operation?.requestBody).toBeDefined();
    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/json': { schema: { $ref: expect.any(String) } },
      },
    });
    for (const code of ['400', '401', '403', '404', '409']) {
      expect(operation?.responses[code]).toBeDefined();
    }
  });

  it('documents the operation, its response type and errors in Swagger', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    const operation = document.paths[`${URL}/{id}/change-preview`]?.get;
    expect(operation?.summary).toMatch(/^FLT-27 /);
    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/json': { schema: { $ref: expect.any(String) } },
      },
    });
    for (const code of ['400', '401', '403', '404', '409']) {
      expect(operation?.responses[code]).toBeDefined();
    }
  });
});
