import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import { AppEvents } from '../../src/common/events/app-events.service.js';
import { Events } from '../../src/common/events/events.js';
import { UserRole } from '../../src/modules/accounts/schemas/user.schema.js';
import { FlightsModule } from '../../src/modules/flights/flights.module.js';
import { Airline } from '../../src/modules/flights/schemas/airline.schema.js';
import { ReferenceDataService } from '../../src/modules/reference-data/reference-data.service.js';
import { FakeReferenceDataService } from '../fakes/reference-data.fake.js';
import { loginAs } from '../support/auth.js';
import { clearCollections } from '../support/clear-collections.js';
import { FakeEvents } from '../support/fake-events.js';
import { HOOK_TIMEOUT } from '../support/mongo-memory.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

describe('Moderator flight cancellation journey (FLT-06)', () => {
  let t: TestApp;
  const events = new FakeEvents();
  let airlineSequence = 0;

  beforeAll(async () => {
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
    await clearCollections(t.connection);
    events.clear();
    airlineSequence = 0;
  });
  afterAll(() => t.close(), HOOK_TIMEOUT);

  async function moderator() {
    const providerId = new Types.ObjectId().toHexString();
    const user = await loginAs(t.connection, UserRole.AIRLINE_MODERATOR, {
      providerId,
    });
    const airlines = t.moduleRef.get<Model<Airline>>(
      getModelToken(Airline.name),
    );
    await airlines.create({
      _id: new Types.ObjectId(providerId),
      name: 'Journey Airline',
      code: `J${++airlineSequence}`,
    });
    return { ...user, providerId };
  }

  async function createFlight(cookie: string) {
    const departure = new Date(Date.now() + 86_400_000);
    const arrival = new Date(departure.getTime() + 10_800_000);
    return t
      .http()
      .post('/api/flights')
      .set('Cookie', cookie)
      .send({
        flightNumber: 'J 194',
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureLocal: departure.toISOString().slice(0, 16),
        arrivalLocal: arrival.toISOString().slice(0, 16),
      })
      .expect(201);
  }

  it('creates, lists and cancels an owned flight without emitting twice on retry', async () => {
    const owner = await moderator();
    const created = await createFlight(owner.cookie);
    const before = await t
      .http()
      .get(`/api/airlines/${owner.providerId}/flights`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(before.body.items).toEqual([
      expect.objectContaining({ _id: created.body._id, status: 'scheduled' }),
    ]);

    await t
      .http()
      .post(`/api/flights/${created.body._id}/cancel`)
      .set('Cookie', owner.cookie)
      .expect(204);
    const after = await t
      .http()
      .get(`/api/airlines/${owner.providerId}/flights`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(after.body.items).toEqual([
      expect.objectContaining({ _id: created.body._id, status: 'cancelled' }),
    ]);
    const repeated = await t
      .http()
      .post(`/api/flights/${created.body._id}/cancel`)
      .set('Cookie', owner.cookie)
      .expect(409);
    expect(repeated.body.code).toBe(ErrorCode.InvalidStatusTransition);
    expect(events.payloadsOf(Events.FlightCancelled)).toEqual([
      { flightId: created.body._id },
    ]);
  });

  it('rejects another airline moderator and leaves the owner able to cancel', async () => {
    const owner = await moderator();
    const created = await createFlight(owner.cookie);
    const other = await moderator();
    const denied = await t
      .http()
      .post(`/api/flights/${created.body._id}/cancel`)
      .set('Cookie', other.cookie)
      .expect(404);
    expect(denied.body.code).toBe(ErrorCode.NotFound);
    expect(events.payloadsOf(Events.FlightCancelled)).toEqual([]);

    const unchanged = await t
      .http()
      .get(`/api/airlines/${owner.providerId}/flights`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(unchanged.body.items).toEqual([
      expect.objectContaining({ _id: created.body._id, status: 'scheduled' }),
    ]);
    await t
      .http()
      .post(`/api/flights/${created.body._id}/cancel`)
      .set('Cookie', owner.cookie)
      .expect(204);
    expect(events.payloadsOf(Events.FlightCancelled)).toEqual([
      { flightId: created.body._id },
    ]);
  });
});
