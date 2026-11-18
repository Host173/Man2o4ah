import { Types } from 'mongoose';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { loginAs } from '../../../test/support/auth.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { FlightsModule } from './flights.module.js';

describe('Flights HTTP API (FLT-03)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FlightsModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(new FakeReferenceDataService()),
    });
  }, HOOK_TIMEOUT);
  beforeEach(() => clearCollections(t.connection));
  afterAll(() => t.close(), HOOK_TIMEOUT);

  const flight = {
    flightNumber: 'ms 123',
    departureAirportId: 'JFK',
    arrivalAirportId: 'CAI',
    departureLocal: '2027-03-14T03:30',
    arrivalLocal: '2027-03-14T10:00',
  };

  async function moderator(providerId = new Types.ObjectId().toString()) {
    return loginAs(t.connection, UserRole.AIRLINE_MODERATOR, { providerId });
  }

  it('creates a flight with normalized number, UTC instants, and airport zones', async () => {
    const user = await moderator();
    const response = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);

    expect(response.body).toMatchObject({
      airlineId: user.providerId,
      flightNumber: 'MS 123',
      departureAirportId: 'JFK',
      arrivalAirportId: 'CAI',
      departureAt: '2027-03-14T07:30:00.000Z',
      arrivalAt: '2027-03-14T08:00:00.000Z',
      departureLocalDate: '2027-03-14',
      durationMinutes: 30,
      departureTimeZone: 'America/New_York',
      arrivalTimeZone: 'Africa/Cairo',
      status: 'scheduled',
      cabins: [],
    });
  });

  it('rejects unknown airports, identical airports, invalid ordering, and past departures', async () => {
    const user = await moderator();
    const invalidRequests = [
      { ...flight, departureAirportId: 'ZZZ' },
      { ...flight, arrivalAirportId: 'JFK' },
      {
        ...flight,
        departureLocal: '2027-01-10T12:00',
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        arrivalLocal: '2027-01-10T13:30',
      },
      {
        ...flight,
        departureLocal: '2020-01-10T12:00',
        arrivalLocal: '2020-01-10T14:00',
      },
    ];

    for (const body of invalidRequests) {
      const response = await t
        .http()
        .post('/api/flights')
        .set('Cookie', user.cookie)
        .send(body)
        .expect(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
    }
  });

  it('rejects duplicate numbers for the same airline and local departure date', async () => {
    const user = await moderator();
    await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);

    const duplicate = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send({ ...flight, flightNumber: 'MS 123' })
      .expect(409);
    expect(duplicate.body.code).toBe(ErrorCode.Conflict);
  });

  it('lists only the moderator airline flights with the standard page shape', async () => {
    const user = await moderator();
    await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);

    const response = await t
      .http()
      .get(`/api/airlines/${user.providerId}/flights?page=1&limit=5`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(response.body).toMatchObject({
      page: 1,
      limit: 5,
      total: 1,
      totalPages: 1,
    });
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      airlineId: user.providerId,
      flightNumber: 'MS 123',
      departureTimeZone: 'America/New_York',
      arrivalTimeZone: 'Africa/Cairo',
    });

    await t
      .http()
      .get(`/api/airlines/${new Types.ObjectId()}/flights`)
      .set('Cookie', user.cookie)
      .expect(404);
  });

  it('requires an airline moderator for creation and the own-airline list', async () => {
    const admin = await loginAs(t.connection, UserRole.ADMIN);
    await t
      .http()
      .post('/api/flights')
      .set('Cookie', admin.cookie)
      .send(flight)
      .expect(403);
    await t.http().post('/api/flights').send(flight).expect(401);
  });
});
