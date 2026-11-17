import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Model } from 'mongoose';
import { FakeFlightsData } from '../../../test/fakes/flights-data.fake.js';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakeSeatInventory } from '../../../test/fakes/seat-inventory.fake.js';
import { loginAs } from '../../../test/support/auth.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { FlightsService } from '../flights/flights.service.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { FlightBooking } from './schemas/flight-booking.schema.js';

const AIRLINE = '6553a1f0c2b4e8a9d0f1e001';
const FLIGHT = '6553a1f0c2b4e8a9d0f1e002';
const CABIN = '6553a1f0c2b4e8a9d0f1e003';
const LAST_SEAT = '6553a1f0c2b4e8a9d0f1e004';
const LAST_SEAT_CABIN = '6553a1f0c2b4e8a9d0f1e005';

function seedFlights(): FakeFlightsData {
  const data = new FakeFlightsData();
  data.addAirline({ id: AIRLINE, code: 'MS', name: 'Nile Air' });
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
  flight(LAST_SEAT, LAST_SEAT_CABIN, 1);
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
      extraBagCount: 0,
    },
  ],
});

const URL = '/api/flight-bookings/hold';

describe('POST /api/flight-bookings/hold (FLT-22)', () => {
  let t: TestApp;
  let bookings: Model<FlightBooking>;
  const data = seedFlights();
  const seats = new FakeSeatInventory(data);

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FlightBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightsService)
          .useValue(new FakeFlightsService(data))
          .overrideProvider(SeatInventory)
          .useValue(seats),
    });
    bookings = t.moduleRef.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  it('answers 201 with the hold, owned by the logged-in user', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const res = await t
      .http()
      .post(URL)
      .set('Cookie', user.cookie)
      .send(body());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'pending_payment',
      tripType: 'one_way',
      seatCount: 1,
      pricing: { totalMinor: 20_000, currency: 'USD' },
    });
    expect(res.body.bookingId).toMatch(/^[0-9a-f]{24}$/);
    // Ten minutes after creation, as an ISO-8601 string.
    expect(new Date(res.body.holdExpiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );

    const saved = await bookings.findById(res.body.bookingId).lean();
    expect(saved?.userId.toString()).toBe(user.id);
    expect(saved?.status).toBe('pending_payment');
  });

  it('rejects a userId in the body: the owner comes only from the session', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const res = await t
      .http()
      .post(URL)
      .set('Cookie', user.cookie)
      .send({ ...body(), userId: '6553a1f0c2b4e8a9d0f1e0ff' });

    // The DTO doesn't know userId, so the whole request is rejected.
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.ValidationFailed);
  });

  it('answers 401 NOT_AUTHENTICATED without a login', async () => {
    const res = await t.http().post(URL).send(body());
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.NotAuthenticated);
  });

  it('answers 400 with field details for a broken rule', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const child = { ...body().passengers[0], type: 'child' };
    const res = await t
      .http()
      .post(URL)
      .set('Cookie', user.cookie)
      .send({ ...body(), passengers: [child] });

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'passengers[0].type' }),
      ]),
    );
  });

  it('answers 409 SEATS_UNAVAILABLE when the last seat is already taken', async () => {
    const first = await loginAs(t.connection, UserRole.USER);
    const second = await loginAs(t.connection, UserRole.USER);
    const lastSeat = body(LAST_SEAT, LAST_SEAT_CABIN);

    const won = await t
      .http()
      .post(URL)
      .set('Cookie', first.cookie)
      .send(lastSeat);
    const lost = await t
      .http()
      .post(URL)
      .set('Cookie', second.cookie)
      .send(lastSeat);

    expect(won.status).toBe(201);
    expect(lost.status).toBe(409);
    expect(lost.body.code).toBe(ErrorCode.SeatsUnavailable);
    // The cabin started with 49 held seats and 1 free; now all 50 are held.
    expect(seats.counters(LAST_SEAT, LAST_SEAT_CABIN)).toMatchObject({
      availableSeats: 0,
      heldSeats: 50,
    });
  });

  it('is documented in Swagger with its requirement ID', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    const operation = document.paths['/api/flight-bookings/hold']?.post;
    expect(operation?.summary).toMatch(/^FLT-22 /);
    expect(operation?.responses['201']).toBeDefined();
  });
});
