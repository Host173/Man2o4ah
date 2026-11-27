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
  flight(FLIGHT, CABIN, DEPARTS, 20_000);
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
  return data;
}

describe('flight change preview (FLT-27)', () => {
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
