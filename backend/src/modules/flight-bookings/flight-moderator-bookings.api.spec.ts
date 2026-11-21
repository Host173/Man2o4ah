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
import {
  AIRLINE,
  OTHER as OTHER_SAME_AIRLINE,
  OUT as FLIGHT,
  seedBooking,
  seedFlights,
} from '../../../test/support/flight-booking-fixtures.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { FlightsService } from '../flights/flights.service.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { PaymentsService } from '../payments/payments.service.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { FlightBooking } from './schemas/flight-booking.schema.js';

const OTHER_AIRLINE = '6553a1f0c2b4e8a9d0f1f010';
const OTHER_FLIGHT = '6553a1f0c2b4e8a9d0f1f011';
const OTHER_CABIN = '6553a1f0c2b4e8a9d0f1f012';

describe('airline moderator flight bookings (FLT-29)', () => {
  let t: TestApp;
  let bookings: Model<FlightBooking>;
  let moderator: LoggedInUser;
  const flights = new FakeFlightsService();
  const seats = new FakeSeatInventory();

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
          .useValue(new FakePaymentsService()),
    });
    bookings = t.moduleRef.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    const data = seedFlights();
    data.addAirline({ id: OTHER_AIRLINE, code: 'OA' });
    data.addFlight({
      id: OTHER_FLIGHT,
      airlineId: OTHER_AIRLINE,
      flightNumber: 'OA200',
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureAt: new Date('2027-03-10T08:00:00.000Z'),
      arrivalAt: new Date('2027-03-10T12:00:00.000Z'),
      cabins: [
        {
          id: OTHER_CABIN,
          cabinClass: 'economy',
          totalSeats: 20,
          priceMinor: 15_000,
        },
      ],
    });
    Object.assign(flights, new FakeFlightsService(data));
    Object.assign(seats, new FakeSeatInventory(data));
    await clearCollections(t.connection);
    moderator = await loginAs(t.connection, UserRole.AIRLINE_MODERATOR, {
      providerId: AIRLINE,
    });
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  const list = (flightId: string, user: LoggedInUser = moderator) =>
    t
      .http()
      .get(`/api/flights/${flightId}/bookings`)
      .set('Cookie', user.cookie);

  const exportPassengers = (flightId: string, user: LoggedInUser = moderator) =>
    t
      .http()
      .get(`/api/flights/${flightId}/passengers/export`)
      .set('Cookie', user.cookie);

  it('lists only confirmed and cancelled bookings for the flight', async () => {
    const confirmed = await seedBooking(bookings, seats, {
      status: 'confirmed',
    });
    const cancelled = await seedBooking(bookings, seats, {
      status: 'cancelled',
    });
    await seedBooking(bookings, seats, {
      status: 'completed',
    });
    await seedBooking(bookings, seats, { status: 'pending_payment' });
    await seedBooking(bookings, seats, { status: 'expired' });
    await seedBooking(bookings, seats, {
      status: 'confirmed',
      outbound: OTHER_SAME_AIRLINE,
    });

    const first = await list(FLIGHT).query({ page: 1, limit: 1 }).expect(200);
    const second = await list(FLIGHT).query({ page: 2, limit: 1 }).expect(200);
    const items = [...first.body.items, ...second.body.items];

    const expectedReferences = [confirmed, cancelled]
      .map((booking) => booking.reference ?? '')
      .sort((a, b) => a.localeCompare(b));
    expect(
      items.map((item) => item.reference).sort((a, b) => a.localeCompare(b)),
    ).toEqual(expectedReferences);
    expect(items[0]).toMatchObject({
      passengerNames: ['Aya Amr', 'Jana Test'],
      cabinClass: 'economy',
      seatCount: 2,
    });
    expect(
      items.map((item) => item.status).sort((a, b) => a.localeCompare(b)),
    ).toEqual(['cancelled', 'confirmed']);
    expect(first.body).toMatchObject({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
      seatsRemainingPerCabin: [{ cabinClass: 'economy', availableSeats: 46 }],
    });
  });

  it('exports escaped passenger names as downloadable CSV', async () => {
    const booking = await seedBooking(bookings, seats, {
      status: 'confirmed',
    });
    const completed = await seedBooking(bookings, seats, {
      status: 'completed',
    });
    const passengerName = '=1+1, "Ada"\nSecond line';
    await bookings.updateOne(
      { _id: booking._id },
      { $set: { 'passengers.0.fullName': passengerName } },
    );

    const response = await exportPassengers(FLIGHT).expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="flight-passengers.csv"',
    );
    expect(response.text.split('\r\n')[0]).toBe(
      'Reference,Passenger Name,Cabin,Seats,Status',
    );
    const escapedName = `"${"'"}=1+1, ""Ada""\nSecond line"`;
    expect(response.text).toContain(
      `${booking.reference},${escapedName},economy,2,confirmed`,
    );
    expect(response.text).toContain(
      `${booking.reference},Jana Test,economy,2,confirmed`,
    );
    expect(response.text).not.toContain(completed.reference);
  });

  it('returns a header-only CSV when the flight has no reportable bookings', async () => {
    const response = await exportPassengers(FLIGHT).expect(200);

    expect(response.text).toBe('Reference,Passenger Name,Cabin,Seats,Status');
  });

  it('hides another airline’s flight and unknown flights with 404', async () => {
    const otherModerator = await loginAs(
      t.connection,
      UserRole.AIRLINE_MODERATOR,
      { providerId: OTHER_AIRLINE },
    );

    for (const id of [FLIGHT, new Types.ObjectId().toHexString()]) {
      const response = await list(id, otherModerator).expect(404);
      expect(response.body.code).toBe(ErrorCode.NotFound);
    }

    const hiddenExport = await exportPassengers(FLIGHT, otherModerator).expect(
      404,
    );
    expect(hiddenExport.body.code).toBe(ErrorCode.NotFound);
  });

  it('rejects a malformed flight ID with 400 on both routes', async () => {
    const listed = await list('not-an-object-id').expect(400);
    expect(listed.body.code).toBe(ErrorCode.ValidationFailed);

    const exported = await exportPassengers('not-an-object-id').expect(400);
    expect(exported.body.code).toBe(ErrorCode.ValidationFailed);
  });

  it('requires an airline moderator and a login', async () => {
    const user = await loginAs(t.connection, UserRole.USER);
    const forbidden = await list(FLIGHT, user).expect(403);
    expect(forbidden.body.code).toBe(ErrorCode.ForbiddenRole);

    const anonymous = await t
      .http()
      .get(`/api/flights/${FLIGHT}/bookings`)
      .expect(401);
    expect(anonymous.body.code).toBe(ErrorCode.NotAuthenticated);
  });

  it('returns an internal error for a reportable booking missing its reference', async () => {
    const booking = await seedBooking(bookings, seats, {
      status: 'confirmed',
    });
    await bookings.updateOne(
      { _id: booking._id },
      { $unset: { reference: 1 } },
    );

    const response = await list(FLIGHT).expect(500);
    expect(response.body.code).toBe(ErrorCode.InternalError);
  });

  it('documents both FLT-29 routes in Swagger', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    expect(document.paths['/api/flights/{id}/bookings']?.get?.summary).toMatch(
      /^FLT-29 /,
    );
    expect(
      document.paths['/api/flights/{id}/passengers/export']?.get?.summary,
    ).toMatch(/^FLT-29 /);
    expect(
      document.paths['/api/flights/{id}/passengers/export']?.get?.responses[
        '200'
      ],
    ).toMatchObject({
      content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
    });
    expect(
      document.components?.schemas?.FlightModeratorBookingResponseDto,
    ).toMatchObject({
      properties: {
        status: { enum: ['confirmed', 'cancelled'] },
      },
    });
    for (const path of [
      '/api/flights/{id}/bookings',
      '/api/flights/{id}/passengers/export',
    ]) {
      expect(document.paths[path]?.get?.responses).toHaveProperty('400');
    }
  });
});
