import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { FakeFlightsData } from '../../../test/fakes/flights-data.fake.js';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { MAX_PRICE_MINOR } from '../../common/money/money.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { FlightsService } from '../flights/flights.service.js';
import { FlightBookingsModule } from './flight-bookings.module.js';

// The API validates ids as Mongo ids, so the fake uses real-looking ones.
const AIRLINE = '6553a1f0c2b4e8a9d0f1a201';
const FLIGHT = '6553a1f0c2b4e8a9d0f1a202';
const CABIN = '6553a1f0c2b4e8a9d0f1a203';
const FULL_FLIGHT = '6553a1f0c2b4e8a9d0f1a204';
const FULL_CABIN = '6553a1f0c2b4e8a9d0f1a205';
const RETURN_FLIGHT = '6553a1f0c2b4e8a9d0f1a206';
const RETURN_CABIN = '6553a1f0c2b4e8a9d0f1a207';
const HUGE_FLIGHT = '6553a1f0c2b4e8a9d0f1a208';
const HUGE_CABIN = '6553a1f0c2b4e8a9d0f1a209';
const DEAR_OUT_FLIGHT = '6553a1f0c2b4e8a9d0f1a20a';
const DEAR_OUT_CABIN = '6553a1f0c2b4e8a9d0f1a20b';
const DEAR_BACK_FLIGHT = '6553a1f0c2b4e8a9d0f1a20c';
const DEAR_BACK_CABIN = '6553a1f0c2b4e8a9d0f1a20d';

function seedFlights(): FakeFlightsData {
  const data = new FakeFlightsData();
  data.addAirline({
    id: AIRLINE,
    code: 'MS',
    name: 'Nile Air',
    baggagePolicy: { extraBagPriceMinor: 3_000, maxExtraBagsPerPassenger: 2 },
  });
  const flight = (id: string, cabinId: string, availableSeats: number) =>
    data.addFlight({
      id,
      airlineId: AIRLINE,
      flightNumber: 'MS100',
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureAt: new Date('2027-03-10T08:00:00.000Z'),
      arrivalAt: new Date('2027-03-10T12:00:00.000Z'),
      cabins: [
        {
          id: cabinId,
          cabinClass: 'economy',
          totalSeats: 50,
          availableSeats,
          heldSeats: 50 - availableSeats,
          priceMinor: 20_000,
        },
      ],
    });
  flight(FLIGHT, CABIN, 50);
  flight(FULL_FLIGHT, FULL_CABIN, 0);
  data.addFlight({
    id: RETURN_FLIGHT,
    airlineId: AIRLINE,
    flightNumber: 'MS101',
    departureAirportId: 'DXB',
    arrivalAirportId: 'CAI',
    departureAt: new Date('2027-03-15T08:00:00.000Z'),
    arrivalAt: new Date('2027-03-15T12:00:00.000Z'),
    cabins: [
      {
        id: RETURN_CABIN,
        cabinClass: 'economy',
        totalSeats: 50,
        availableSeats: 50,
        heldSeats: 0,
        priceMinor: 15_000,
      },
    ],
  });
  // A cabin priced past the cap (as old data could be) and two at the cap.
  const priced = (
    id: string,
    cabinId: string,
    from: string,
    to: string,
    date: string,
    priceMinor: number,
  ) =>
    data.addFlight({
      id,
      airlineId: AIRLINE,
      flightNumber: 'MS200',
      departureAirportId: from,
      arrivalAirportId: to,
      departureAt: new Date(`${date}T08:00:00.000Z`),
      arrivalAt: new Date(`${date}T12:00:00.000Z`),
      cabins: [
        {
          id: cabinId,
          cabinClass: 'economy',
          totalSeats: 50,
          availableSeats: 50,
          heldSeats: 0,
          priceMinor,
        },
      ],
    });
  priced(
    HUGE_FLIGHT,
    HUGE_CABIN,
    'CAI',
    'DXB',
    '2027-03-10',
    Number.MAX_SAFE_INTEGER,
  );
  priced(
    DEAR_OUT_FLIGHT,
    DEAR_OUT_CABIN,
    'CAI',
    'DXB',
    '2027-03-10',
    MAX_PRICE_MINOR,
  );
  priced(
    DEAR_BACK_FLIGHT,
    DEAR_BACK_CABIN,
    'DXB',
    'CAI',
    '2027-03-15',
    MAX_PRICE_MINOR,
  );
  return data;
}

const body = (flightId = FLIGHT, cabinId = CABIN) => ({
  tripType: 'one_way',
  segments: [{ flightId, cabinId }],
  passengers: [
    {
      type: 'adult',
      fullName: 'Aya Amr',
      dateOfBirth: '1990-01-01',
      documentNumber: 'A12345678',
      extraBagCount: 1,
      extraBagWeightKg: 20,
    },
  ],
});

describe('POST /api/flight-bookings (FLT-19, FLT-21)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FlightBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightsService)
          .useValue(new FakeFlightsService(seedFlights())),
    });
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  it('returns 200 with the priced summary for a logged-in user', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const res = await t
      .http()
      .post('/api/flight-bookings')
      .set('Cookie', user.cookie)
      .send(body());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tripType: 'one_way',
      seatCount: 1,
      pricing: {
        fareTotalMinor: 20_000,
        baggageTotalMinor: 3_000,
        totalMinor: 23_000,
        currency: 'USD',
      },
    });
    expect(res.body.segments[0]).toMatchObject({
      flightId: FLIGHT,
      direction: 'outbound',
      departureAt: '2027-03-10T08:00:00.000Z', // instants travel as ISO-8601 UTC
    });
  });

  it('charges the extra-bag fee once per airline on a same-airline round trip', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const roundTripBody = {
      tripType: 'round_trip',
      segments: [
        { flightId: FLIGHT, cabinId: CABIN },
        { flightId: RETURN_FLIGHT, cabinId: RETURN_CABIN },
      ],
      passengers: [
        {
          type: 'adult',
          fullName: 'Aya Amr',
          dateOfBirth: '1990-01-01',
          documentNumber: 'A12345678',
          extraBagCount: 2,
          extraBagWeightKg: 20,
        },
      ],
    };

    const res = await t
      .http()
      .post('/api/flight-bookings')
      .set('Cookie', user.cookie)
      .send(roundTripBody);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tripType: 'round_trip',
      seatCount: 1,
      pricing: {
        fareTotalMinor: 35_000,
        baggageTotalMinor: 6_000, // 2 extra bags × 3 000 once per airline
        totalMinor: 41_000,
        currency: 'USD',
      },
    });
  });

  it('answers 401 NOT_AUTHENTICATED without a login', async () => {
    const res = await t.http().post('/api/flight-bookings').send(body());
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.NotAuthenticated);
  });

  it('answers 400 with field details for a malformed body', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const res = await t
      .http()
      .post('/api/flight-bookings')
      .set('Cookie', user.cookie)
      .send({ ...body(), tripType: 'one-way', totalMinor: 1 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.ValidationFailed);
    const fields = (res.body.details as { field: string }[]).map(
      (d) => d.field,
    );
    expect(fields).toEqual(expect.arrayContaining(['tripType', 'totalMinor']));
  });

  it('answers 400 with field details when a passenger rule is broken', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const child = { ...body().passengers[0], type: 'child' };
    const res = await t
      .http()
      .post('/api/flight-bookings')
      .set('Cookie', user.cookie)
      .send({ ...body(), passengers: [child] });

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'passengers[0].type' }),
      ]),
    );
  });

  it('answers 409 SEATS_UNAVAILABLE when the cabin is full', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const res = await t
      .http()
      .post('/api/flight-bookings')
      .set('Cookie', user.cookie)
      .send(body(FULL_FLIGHT, FULL_CABIN));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.SeatsUnavailable);
  });

  it('answers 400, not 500, when the fare total overflows a safe integer', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const base = body(HUGE_FLIGHT, HUGE_CABIN);
    const res = await t
      .http()
      .post('/api/flight-bookings')
      .set('Cookie', user.cookie)
      .send({
        ...base,
        passengers: [base.passengers[0], base.passengers[0]],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.ValidationFailed);
  });

  it('answers 400 on the passengers field when the total is more than one payment can be', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const adults = Array.from({ length: 9 }, () => body().passengers[0]);
    const res = await t
      .http()
      .post('/api/flight-bookings')
      .set('Cookie', user.cookie)
      .send({
        tripType: 'round_trip',
        segments: [
          { flightId: DEAR_OUT_FLIGHT, cabinId: DEAR_OUT_CABIN },
          { flightId: DEAR_BACK_FLIGHT, cabinId: DEAR_BACK_CABIN },
        ],
        passengers: adults,
      });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([
      expect.objectContaining({ field: 'passengers' }),
    ]);
  });

  it('is documented in Swagger with its requirement ID', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    const operation = document.paths['/api/flight-bookings']?.post;
    expect(operation?.summary).toMatch(/^FLT-19 /);
    expect(operation?.responses['200']).toBeDefined();
  });
});
