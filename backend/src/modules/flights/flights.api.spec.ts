import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { loginAs } from '../../../test/support/auth.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { CabinClass } from '../../common/database/cabin-class.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { FakeEvents } from '../../../test/support/fake-events.js';
import { TEST_JWT_ACCESS_SECRET } from '../../../test/support/test-config.js';
import { FlightsModule } from './flights.module.js';
import { Airline } from './schemas/airline.schema.js';
import { Flight } from './schemas/flight.schema.js';

describe('Flights HTTP API (FLT-03, FLT-04, FLT-05, FLT-06)', () => {
  let t: TestApp;
  let events: FakeEvents;
  let airlineSequence = 0;

  beforeAll(async () => {
    events = new FakeEvents();
    t = await createTestApp({
      imports: [FlightsModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(new FakeReferenceDataService())
          .overrideProvider(AppEvents)
          .useValue(events),
    });
  }, HOOK_TIMEOUT);
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T12:00:00.000Z'));
    await clearCollections(t.connection);
    events.clear();
    airlineSequence = 0;
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => t.close(), HOOK_TIMEOUT);

  const flight = {
    flightNumber: 'ms 123',
    departureAirportId: 'JFK',
    arrivalAirportId: 'CAI',
    departureLocal: '2027-03-14T03:30',
    arrivalLocal: '2027-03-14T10:00',
  };
  const cabin = {
    cabinClass: CabinClass.ECONOMY,
    totalSeats: 2,
    priceMinor: 30000,
    freeBags: 1,
    maxBagWeightKg: 23,
  };

  async function moderator(providerId = new Types.ObjectId().toString()) {
    const user = await loginAs(t.connection, UserRole.AIRLINE_MODERATOR, {
      providerId,
    });
    const airlines = t.moduleRef.get<Model<Airline>>(
      getModelToken(Airline.name),
    );
    await airlines.create({
      _id: new Types.ObjectId(providerId),
      name: 'Test Airline',
      code: `T${String(++airlineSequence).padStart(2, '0')}`,
    });
    return user;
  }

  async function createFlight(user: Awaited<ReturnType<typeof moderator>>) {
    return t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);
  }

  it('creates a flight with normalized number, UTC instants, and airport zones', async () => {
    const user = await moderator();
    const response = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);

    expect(response.body._id).toMatch(/^[a-f0-9]{24}$/);
    expect(response.body).not.toHaveProperty('id');
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

  it('accepts a 10-character flight number after trimming and uppercasing', async () => {
    const user = await moderator();
    const response = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send({ ...flight, flightNumber: ' abcd 12345 ' })
      .expect(201);

    expect(response.body.flightNumber).toBe('ABCD 12345');
  });

  it('rejects unknown airports, identical airports, invalid ordering, and past departures', async () => {
    const user = await moderator();
    const invalidRequests = [
      { ...flight, flightNumber: 'ABCDEFGHIJK' },
      { ...flight, flightNumber: 'MS-123' },
      { ...flight, flightNumber: 'MS😀123' },
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

    await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send({
        ...flight,
        departureLocal: '2027-03-15T03:30',
        arrivalLocal: '2027-03-15T10:00',
      })
      .expect(201);
  });

  it('lists only the moderator airline flights with the standard page shape', async () => {
    const user = await moderator();
    const created = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);

    const flights = t.moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    const flightDocument = await flights.findById(created.body._id).exec();
    if (!flightDocument) throw new Error('Created flight was not persisted');
    flightDocument.cabins.push({
      cabinClass: 'economy',
      totalSeats: 2,
      availableSeats: 2,
      heldSeats: 0,
      bookedSeats: 0,
      priceMinor: 30000,
      freeBags: 1,
      maxBagWeightKg: 23,
    });
    await flightDocument.save();

    const otherProviderId = new Types.ObjectId().toHexString();
    const otherModerator = await loginAs(
      t.connection,
      UserRole.AIRLINE_MODERATOR,
      { providerId: otherProviderId },
    );
    const airlines = t.moduleRef.get<Model<Airline>>(
      getModelToken(Airline.name),
    );
    await airlines.create({
      _id: new Types.ObjectId(otherProviderId),
      name: 'Other Airline',
      code: 'OA',
    });
    await t
      .http()
      .post('/api/flights')
      .set('Cookie', otherModerator.cookie)
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
      _id: created.body._id,
      airlineId: user.providerId,
      flightNumber: 'MS 123',
      departureTimeZone: 'America/New_York',
      arrivalTimeZone: 'Africa/Cairo',
      cabins: [
        {
          _id: expect.stringMatching(/^[a-f0-9]{24}$/),
          cabinClass: 'economy',
        },
      ],
    });
    expect(response.body.items[0]).not.toHaveProperty('id');
    expect(response.body.items[0].cabins[0]).not.toHaveProperty('id');

    const forbiddenAirline = await t
      .http()
      .get(`/api/airlines/${otherProviderId}/flights`)
      .set('Cookie', user.cookie)
      .expect(404);
    expect(forbiddenAirline.body.code).toBe(ErrorCode.NotFound);
  });

  it('requires an airline moderator for creation and the own-airline list', async () => {
    const admin = await loginAs(t.connection, UserRole.ADMIN);
    const airlineId = new Types.ObjectId().toHexString();
    await t
      .http()
      .post('/api/flights')
      .set('Cookie', admin.cookie)
      .send(flight)
      .expect(403);
    await t.http().post('/api/flights').send(flight).expect(401);
    await t.http().get(`/api/airlines/${airlineId}/flights`).expect(401);
    await t
      .http()
      .get(`/api/airlines/${airlineId}/flights`)
      .set('Cookie', admin.cookie)
      .expect(403);
  });

  it('does not accept an airline ID from the moderator request body', async () => {
    const user = await moderator();
    const response = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send({ ...flight, airlineId: new Types.ObjectId().toString() })
      .expect(400);

    expect(response.body.code).toBe(ErrorCode.ValidationFailed);
  });

  it('documents the cabin creation route and validated request fields in Swagger', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder()
        .setTitle('Man2o4ah API')
        .setVersion('0.0.1')
        .build(),
    );
    const operation = document.paths['/api/flights/{id}/cabins']?.post;

    expect(operation).toBeDefined();
    expect(operation?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/AddFlightCabinDto' },
        },
      },
    });
    expect(operation?.responses['201']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/FlightResponseDto' },
        },
      },
    });
    expect(document.components?.schemas?.AddFlightCabinDto).toMatchObject({
      properties: {
        cabinClass: { enum: Object.values(CabinClass) },
        totalSeats: { type: 'integer', minimum: 1 },
        priceMinor: { type: 'integer', minimum: 1 },
        freeBags: { type: 'integer', minimum: 0 },
        maxBagWeightKg: { type: 'number', exclusiveMinimum: true },
      },
    });
  });

  it('adds every supported cabin once and initializes all seats as available', async () => {
    const user = await moderator();
    const created = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);
    let updated = created;

    for (const cabinClass of Object.values(CabinClass)) {
      updated = await t
        .http()
        .post(`/api/flights/${created.body._id}/cabins`)
        .set('Cookie', user.cookie)
        .send({ ...cabin, cabinClass })
        .expect(201);

      const added = updated.body.cabins.find(
        (item: { cabinClass: string }) => item.cabinClass === cabinClass,
      );
      expect(added).toMatchObject({
        _id: expect.stringMatching(/^[a-f0-9]{24}$/),
        cabinClass,
        totalSeats: 2,
        availableSeats: 2,
        heldSeats: 0,
        bookedSeats: 0,
        priceMinor: 30000,
        freeBags: 1,
        maxBagWeightKg: 23,
      });
      expect(added).not.toHaveProperty('id');
      expect(updated.body).not.toHaveProperty('id');
    }

    expect(
      updated.body.cabins.map(
        (item: { cabinClass: string }) => item.cabinClass,
      ),
    ).toEqual(Object.values(CabinClass));
    expect(updated.body.cabins).toHaveLength(4);

    const duplicate = await t
      .http()
      .post(`/api/flights/${created.body._id}/cabins`)
      .set('Cookie', user.cookie)
      .send(cabin)
      .expect(409);
    expect(duplicate.body.code).toBe(ErrorCode.Conflict);

    const flights = t.moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    const persisted = await flights.findById(created.body._id).lean().exec();
    expect(persisted?.cabins).toHaveLength(4);

    const anotherFlight = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send({ ...flight, flightNumber: 'MS 124' })
      .expect(201);
    const reusedClass = await t
      .http()
      .post(`/api/flights/${anotherFlight.body._id}/cabins`)
      .set('Cookie', user.cookie)
      .send(cabin)
      .expect(201);
    expect(
      reusedClass.body.cabins.map(
        (item: { cabinClass: string }) => item.cabinClass,
      ),
    ).toEqual([CabinClass.ECONOMY]);
  });

  it('rejects malformed or out-of-range cabin fields without changing the flight', async () => {
    const user = await moderator();
    const created = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);
    const invalidCabins = [
      { body: { ...cabin, cabinClass: 'luxury' }, field: 'cabinClass' },
      { body: { ...cabin, totalSeats: 0 }, field: 'totalSeats' },
      { body: { ...cabin, totalSeats: 1.5 }, field: 'totalSeats' },
      {
        body: { ...cabin, totalSeats: Number.MAX_SAFE_INTEGER + 1 },
        field: 'totalSeats',
      },
      { body: { ...cabin, priceMinor: 0 }, field: 'priceMinor' },
      { body: { ...cabin, priceMinor: 1.5 }, field: 'priceMinor' },
      {
        body: { ...cabin, priceMinor: Number.MAX_SAFE_INTEGER + 1 },
        field: 'priceMinor',
      },
      { body: { ...cabin, freeBags: -1 }, field: 'freeBags' },
      { body: { ...cabin, freeBags: 1.5 }, field: 'freeBags' },
      { body: { ...cabin, maxBagWeightKg: 0 }, field: 'maxBagWeightKg' },
      { body: { ...cabin, maxBagWeightKg: '23' }, field: 'maxBagWeightKg' },
      { body: { ...cabin, unexpected: true }, field: 'unexpected' },
      { body: { cabinClass: cabin.cabinClass }, field: 'totalSeats' },
    ];

    for (const { body, field } of invalidCabins) {
      const response = await t
        .http()
        .post(`/api/flights/${created.body._id}/cabins`)
        .set('Cookie', user.cookie)
        .send(body)
        .expect(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field, message: expect.any(String) }),
        ]),
      );
    }

    const flights = t.moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    const persisted = await flights.findById(created.body._id).lean().exec();
    expect(persisted?.cabins).toHaveLength(0);
  });

  it('requires a moderator assigned to the scheduled flight', async () => {
    const user = await moderator();
    const created = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);
    const path = `/api/flights/${created.body._id}/cabins`;
    const regularUser = await loginAs(t.connection, UserRole.USER);
    const anotherModerator = await loginAs(
      t.connection,
      UserRole.AIRLINE_MODERATOR,
      { providerId: new Types.ObjectId().toHexString() },
    );

    const guest = await t.http().post(path).send(cabin).expect(401);
    expect(guest.body.code).toBe(ErrorCode.NotAuthenticated);
    const forbidden = await t
      .http()
      .post(path)
      .set('Cookie', regularUser.cookie)
      .send(cabin)
      .expect(403);
    expect(forbidden.body.code).toBe(ErrorCode.ForbiddenRole);
    const wrongAirline = await t
      .http()
      .post(path)
      .set('Cookie', anotherModerator.cookie)
      .send(cabin)
      .expect(404);
    expect(wrongAirline.body.code).toBe(ErrorCode.NotFound);

    const missing = await t
      .http()
      .post(`/api/flights/${new Types.ObjectId().toHexString()}/cabins`)
      .set('Cookie', user.cookie)
      .send(cabin)
      .expect(404);
    expect(missing.body.code).toBe(ErrorCode.NotFound);

    const invalidId = await t
      .http()
      .post('/api/flights/not-an-id/cabins')
      .set('Cookie', user.cookie)
      .send(cabin)
      .expect(400);
    expect(invalidId.body.code).toBe(ErrorCode.ValidationFailed);
  });

  it('rejects adding a cabin to a flight that is no longer scheduled', async () => {
    const user = await moderator();
    const created = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);
    const flights = t.moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    await flights
      .updateOne(
        { _id: new Types.ObjectId(created.body._id) },
        { $set: { status: 'cancelled' } },
      )
      .exec();

    const response = await t
      .http()
      .post(`/api/flights/${created.body._id}/cabins`)
      .set('Cookie', user.cookie)
      .send(cabin)
      .expect(409);
    expect(response.body.code).toBe(ErrorCode.InvalidStatusTransition);
  });

  it('prevents concurrent duplicate cabins from being stored', async () => {
    const user = await moderator();
    const created = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);
    const requests = [0, 1].map(() =>
      t
        .http()
        .post(`/api/flights/${created.body._id}/cabins`)
        .set('Cookie', user.cookie)
        .send(cabin),
    );
    const results = await Promise.allSettled(requests);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const responses = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );

    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    expect(
      responses.find((response) => response.status === 409)?.body.code,
    ).toBe(ErrorCode.Conflict);
    const flights = t.moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    const persisted = await flights.findById(created.body._id).lean().exec();
    expect(persisted?.cabins).toHaveLength(1);
    expect(persisted?.cabins[0]?.cabinClass).toBe(CabinClass.ECONOMY);
    const storedCabin = persisted?.cabins[0];
    expect(storedCabin).toMatchObject({
      totalSeats: cabin.totalSeats,
      availableSeats: cabin.totalSeats,
      heldSeats: 0,
      bookedSeats: 0,
    });
    expect(storedCabin?.totalSeats).toBe(
      storedCabin!.availableSeats +
        storedCabin!.heldSeats +
        storedCabin!.bookedSeats,
    );
  });

  it('cancels an owned scheduled flight and emits flight.cancelled once', async () => {
    const user = await moderator();
    const created = await createFlight(user);

    await t
      .http()
      .post(`/api/flights/${created.body._id}/cancel`)
      .set('Cookie', user.cookie)
      .expect(204);

    const flights = t.moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    const stored = await flights.findById(created.body._id).lean().exec();
    expect(stored).toMatchObject({
      status: 'cancelled',
      cancelledAt: new Date('2026-11-19T12:00:00.000Z'),
    });
    expect(events.payloadsOf(Events.FlightCancelled)).toEqual([
      { flightId: created.body._id },
    ]);

    const repeated = await t
      .http()
      .post(`/api/flights/${created.body._id}/cancel`)
      .set('Cookie', user.cookie)
      .expect(409);
    expect(repeated.body.code).toBe(ErrorCode.InvalidStatusTransition);
    expect(events.payloadsOf(Events.FlightCancelled)).toHaveLength(1);
  });

  it('documents the cancellation ID as a string path parameter', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    const operation = document.paths['/api/flights/{id}/cancel']?.post;

    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'id',
          in: 'path',
          required: true,
          schema: expect.objectContaining({ type: 'string' }),
        }),
      ]),
    );
  });

  it('requires authentication and the airline moderator role to cancel', async () => {
    const id = new Types.ObjectId().toHexString();
    await t.http().post(`/api/flights/${id}/cancel`).expect(401);

    const user = await loginAs(t.connection, UserRole.USER);
    const forbidden = await t
      .http()
      .post(`/api/flights/${id}/cancel`)
      .set('Cookie', user.cookie)
      .expect(403);
    expect(forbidden.body.code).toBe(ErrorCode.ForbiddenRole);
  });

  it('returns 400 for a malformed ID and 404 for an unknown or other-airline flight', async () => {
    const owner = await moderator();
    const created = await createFlight(owner);
    const otherModerator = await moderator();

    const malformed = await t
      .http()
      .post('/api/flights/not-an-id/cancel')
      .set('Cookie', owner.cookie)
      .expect(400);
    expect(malformed.body.code).toBe(ErrorCode.ValidationFailed);

    const unknown = await t
      .http()
      .post(`/api/flights/${new Types.ObjectId().toHexString()}/cancel`)
      .set('Cookie', owner.cookie)
      .expect(404);
    expect(unknown.body.code).toBe(ErrorCode.NotFound);

    const notOwned = await t
      .http()
      .post(`/api/flights/${created.body._id}/cancel`)
      .set('Cookie', otherModerator.cookie)
      .expect(404);
    expect(notOwned.body.code).toBe(ErrorCode.NotFound);
    expect(events.payloadsOf(Events.FlightCancelled)).toEqual([]);
  });

  it('returns 404 without changing the flight when the moderator token has no assigned airline', async () => {
    const owner = await moderator();
    const created = await createFlight(owner);
    const token = await new JwtService({
      secret: TEST_JWT_ACCESS_SECRET,
    }).signAsync(
      { sub: owner.id, role: owner.role, sid: owner.sid },
      { algorithm: 'HS256', expiresIn: '15m' },
    );

    const response = await t
      .http()
      .post(`/api/flights/${created.body._id}/cancel`)
      .set('Cookie', `access_token=${token}`)
      .expect(404);

    expect(response.body.code).toBe(ErrorCode.NotFound);
    const flights = t.moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    expect(
      await flights.findById(created.body._id).lean().exec(),
    ).toMatchObject({
      status: 'scheduled',
    });
    expect(events.payloadsOf(Events.FlightCancelled)).toEqual([]);
  });

  it('does not cancel a departed flight or emit an event', async () => {
    const user = await moderator();
    const created = await createFlight(user);
    const flights = t.moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    await flights
      .updateOne({ _id: created.body._id }, { $set: { status: 'departed' } })
      .exec();

    const response = await t
      .http()
      .post(`/api/flights/${created.body._id}/cancel`)
      .set('Cookie', user.cookie)
      .expect(409);
    expect(response.body.code).toBe(ErrorCode.InvalidStatusTransition);
    expect(events.payloadsOf(Events.FlightCancelled)).toEqual([]);
  });

  it('returns public flight details with zones, cabins and airline policies', async () => {
    const user = await moderator();
    const created = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);
    const flights = t.moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    const document = await flights.findById(created.body._id).exec();
    if (!document) throw new Error('Created flight was not persisted');
    document.cabins.push({
      cabinClass: CabinClass.ECONOMY,
      totalSeats: 8,
      availableSeats: 5,
      heldSeats: 2,
      bookedSeats: 1,
      priceMinor: 30000,
      freeBags: 2,
      maxBagWeightKg: 23,
    });
    await document.save();

    const response = await t
      .http()
      .get(`/api/flights/${created.body._id}`)
      .expect(200);
    expect(response.body).toMatchObject({
      _id: created.body._id,
      flightNumber: 'MS 123',
      departureTimeZone: 'America/New_York',
      arrivalTimeZone: 'Africa/Cairo',
      departureAt: '2027-03-14T07:30:00.000Z',
      arrivalAt: '2027-03-14T08:00:00.000Z',
      durationMinutes: 30,
      cabins: [
        {
          cabinClass: 'economy',
          totalSeats: 8,
          availableSeats: 5,
          heldSeats: 2,
          bookedSeats: 1,
          priceMinor: 30000,
          freeBags: 2,
          maxBagWeightKg: 23,
        },
      ],
      airline: {
        _id: user.providerId,
        name: 'Test Airline',
        isActive: true,
      },
    });
    expect(response.body.airline).not.toHaveProperty('id');
  });

  it('returns 400 for a malformed details ID and 404 for unknown flights', async () => {
    const malformed = await t.http().get('/api/flights/not-an-id').expect(400);
    expect(malformed.body.code).toBe(ErrorCode.ValidationFailed);
    const missing = await t
      .http()
      .get(`/api/flights/${new Types.ObjectId().toHexString()}`)
      .expect(404);
    expect(missing.body.code).toBe(ErrorCode.NotFound);
  });  });

  it('edits scheduled flight times and emits one reschedule event after the update', async () => {
    const user = await moderator();
    const created = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);
    const events = t.moduleRef.get(AppEvents);
    const emit = vi.spyOn(events, 'emit');

    const response = await t
      .http()
      .patch(`/api/flights/${created.body._id}`)
      .set('Cookie', user.cookie)
      .send({
        departureLocal: '2027-03-14T04:30',
        arrivalLocal: '2027-03-14T11:00',
      })
      .expect(200);

    expect(response.body).toMatchObject({
      departureAt: '2027-03-14T08:30:00.000Z',
      arrivalAt: '2027-03-14T09:00:00.000Z',
      departureLocalDate: '2027-03-14',
      durationMinutes: 30,
      status: 'scheduled',
    });
    expect(emit).toHaveBeenCalledWith(Events.FlightRescheduled, {
      flightId: created.body._id,
      departureAt: new Date('2027-03-14T08:30:00.000Z'),
      arrivalAt: new Date('2027-03-14T09:00:00.000Z'),
    });
  });

  it('rejects past, reversed, empty, unknown-airport and booked-airport flight edits', async () => {
    const user = await moderator();
    const created = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);

    for (const body of [
      {},
      { departureLocal: '2020-01-10T12:00' },
      {
        departureLocal: '2027-03-14T12:00',
        arrivalLocal: '2027-03-14T11:00',
      },
      { departureAirportId: 'ZZZ' },
    ]) {
      const response = await t
        .http()
        .patch(`/api/flights/${created.body._id}`)
        .set('Cookie', user.cookie)
        .send(body)
        .expect(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
    }

    const flights = t.moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    await flights
      .updateOne(
        { _id: new Types.ObjectId(created.body._id) },
        { $set: { hasBookings: true } },
      )
      .exec();
    const locked = await t
      .http()
      .patch(`/api/flights/${created.body._id}`)
      .set('Cookie', user.cookie)
      .send({ departureAirportId: 'LHR' })
      .expect(409);
    expect(locked.body.code).toBe(ErrorCode.Conflict);
  });

  it('enforces edit ownership and role checks', async () => {
    const user = await moderator();
    const created = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);
    const path = `/api/flights/${created.body._id}`;

    await t
      .http()
      .patch(path)
      .send({ departureLocal: '2027-03-14T04:30' })
      .expect(401);
    const regular = await loginAs(t.connection, UserRole.USER);
    await t
      .http()
      .patch(path)
      .set('Cookie', regular.cookie)
      .send({ departureLocal: '2027-03-14T04:30' })
      .expect(403);
    const another = await loginAs(t.connection, UserRole.AIRLINE_MODERATOR, {
      providerId: new Types.ObjectId().toHexString(),
    });
    await t
      .http()
      .patch(path)
      .set('Cookie', another.cookie)
      .send({ departureLocal: '2027-03-14T04:30' })
      .expect(404);
  });

  it('edits cabin price and seat count, and rejects cuts below reserved seats', async () => {
    const user = await moderator();
    const created = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);
    const cabinResponse = await t
      .http()
      .post(`/api/flights/${created.body._id}/cabins`)
      .set('Cookie', user.cookie)
      .send(cabin)
      .expect(201);
    const cabinId = cabinResponse.body.cabins[0]._id;

    const updated = await t
      .http()
      .patch(`/api/flights/${created.body._id}/cabins/${cabinId}`)
      .set('Cookie', user.cookie)
      .send({ priceMinor: 42000, totalSeats: 8 })
      .expect(200);
    expect(updated.body.cabins[0]).toMatchObject({
      _id: cabinId,
      priceMinor: 42000,
      totalSeats: 8,
      availableSeats: 8,
    });

    const flights = t.moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    await flights
      .updateOne(
        { _id: new Types.ObjectId(created.body._id) },
        {
          $set: {
            'cabins.0.totalSeats': 8,
            'cabins.0.availableSeats': 5,
            'cabins.0.heldSeats': 2,
            'cabins.0.bookedSeats': 1,
          },
        },
      )
      .exec();
    const cut = await t
      .http()
      .patch(`/api/flights/${created.body._id}/cabins/${cabinId}`)
      .set('Cookie', user.cookie)
      .send({ totalSeats: 2 })
      .expect(409);
    expect(cut.body.code).toBe(ErrorCode.CapacityBelowReserved);
  });

  it('rejects invalid cabin edits and edits to cancelled flights', async () => {
    const user = await moderator();
    const created = await t
      .http()
      .post('/api/flights')
      .set('Cookie', user.cookie)
      .send(flight)
      .expect(201);
    const cabinResponse = await t
      .http()
      .post(`/api/flights/${created.body._id}/cabins`)
      .set('Cookie', user.cookie)
      .send(cabin)
      .expect(201);
    const cabinId = cabinResponse.body.cabins[0]._id;
    const path = `/api/flights/${created.body._id}/cabins/${cabinId}`;

    await t.http().patch(path).set('Cookie', user.cookie).send({}).expect(400);
    await t
      .http()
      .patch(path)
      .set('Cookie', user.cookie)
      .send({ priceMinor: 0 })
      .expect(400);
    await t
      .http()
      .patch(path)
      .set('Cookie', user.cookie)
      .send({ totalSeats: 1.5 })
      .expect(400);

    const flights = t.moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    await flights
      .updateOne(
        { _id: new Types.ObjectId(created.body._id) },
        { $set: { status: 'cancelled' } },
      )
      .exec();
    const cancelled = await t
      .http()
      .patch(path)
      .set('Cookie', user.cookie)
      .send({ priceMinor: 42000 })
      .expect(409);
    expect(cancelled.body.code).toBe(ErrorCode.InvalidStatusTransition);
  });
});
