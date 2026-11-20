import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { FakeEvents } from '../../../test/support/fake-events.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { FlightsService } from './flights.service.js';
import { FlightsModule } from './flights.module.js';
import { Airline } from './schemas/airline.schema.js';
import { Flight, FlightStatus } from './schemas/flight.schema.js';

describe('FlightsService cancellation integration (FLT-06)', () => {
  let testApp: TestApp;
  let flights: FlightsService;
  let airlineModel: Model<Airline>;
  let flightModel: Model<Flight>;
  let events: FakeEvents;
  let airlineSequence = 0;

  beforeAll(async () => {
    events = new FakeEvents();
    testApp = await createTestApp({
      imports: [FlightsModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(new FakeReferenceDataService())
          .overrideProvider(AppEvents)
          .useValue(events),
    });
    flights = testApp.moduleRef.get(FlightsService);
    airlineModel = testApp.moduleRef.get<Model<Airline>>(
      getModelToken(Airline.name),
    );
    flightModel = testApp.moduleRef.get<Model<Flight>>(
      getModelToken(Flight.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(testApp.connection);
    events.clear();
    airlineSequence = 0;
  });

  afterAll(async () => {
    await testApp.close();
  }, HOOK_TIMEOUT);

  async function seedFlight(status: Flight['status'] = FlightStatus.SCHEDULED) {
    const code = `T${String(++airlineSequence).padStart(2, '0')}`;
    const airline = await airlineModel.create({
      name: 'Test Airline',
      code,
    });
    const flight = await flightModel.create({
      airlineId: airline._id,
      flightNumber: `${code} 100`,
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureAt: new Date('2027-01-01T10:00:00.000Z'),
      arrivalAt: new Date('2027-01-01T13:00:00.000Z'),
      departureLocalDate: '2027-01-01',
      durationMinutes: 180,
      status,
    });
    return { airline, flight };
  }

  it('conditionally cancels an owned scheduled flight and emits its ID', async () => {
    const { airline, flight } = await seedFlight();
    const before = new Date();

    await flights.cancelFlight(flight._id.toString(), airline._id.toString());

    const saved = await flightModel.findById(flight._id).lean().exec();
    expect(saved?.status).toBe(FlightStatus.CANCELLED);
    expect(saved?.cancelledAt).toBeInstanceOf(Date);
    expect(saved?.cancelledAt?.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    expect(events.payloadsOf(Events.FlightCancelled)).toEqual([
      { flightId: flight._id.toString() },
    ]);
  });

  it('allows only one concurrent cancellation and emits once', async () => {
    const { airline, flight } = await seedFlight();

    const results = await Promise.allSettled([
      flights.cancelFlight(flight._id.toString(), airline._id.toString()),
      flights.cancelFlight(flight._id.toString(), airline._id.toString()),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(events.payloadsOf(Events.FlightCancelled)).toEqual([
      { flightId: flight._id.toString() },
    ]);
  });

  it('returns 404 for an unknown or unowned flight and 409 for a non-scheduled flight', async () => {
    const { airline, flight } = await seedFlight();
    const otherAirline = await airlineModel.create({
      name: 'Other Airline',
      code: 'OA',
    });

    await expect(
      flights.cancelFlight(flight._id.toString(), otherAirline._id.toString()),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: ErrorCode.NotFound },
    });
    await expect(
      flights.cancelFlight(
        new Types.ObjectId().toString(),
        airline._id.toString(),
      ),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: ErrorCode.NotFound },
    });
    await expect(
      flights.cancelFlight('invalid', airline._id.toString()),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: ErrorCode.NotFound },
    });
    expect(events.payloadsOf(Events.FlightCancelled)).toEqual([]);

    const departed = await seedFlight(FlightStatus.DEPARTED);
    await expect(
      flights.cancelFlight(
        departed.flight._id.toString(),
        departed.airline._id.toString(),
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: ErrorCode.InvalidStatusTransition },
    });
    expect(events.payloadsOf(Events.FlightCancelled)).toEqual([]);
  });
});
