import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { FlightsModule } from './flights.module.js';
import { FlightsService } from './flights.service.js';
import { Flight } from './schemas/flight.schema.js';

describe('Mark flights departed job (FLT-30)', () => {
  let testApp: TestApp;
  let flights: FlightsService;
  let flightModel: Model<Flight>;

  beforeAll(async () => {
    testApp = await createTestApp({
      imports: [FlightsModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(new FakeReferenceDataService()),
    });
    flights = testApp.moduleRef.get(FlightsService);
    flightModel = testApp.moduleRef.get<Model<Flight>>(
      getModelToken(Flight.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T12:00:00.000Z'));
    await clearCollections(testApp.connection);
  });

  afterEach(() => vi.useRealTimers());
  afterAll(async () => await testApp.close(), HOOK_TIMEOUT);

  it('is idempotent and marks only scheduled flights at or after the departure boundary', async () => {
    await flightModel.create([
      flightSeed('MS-PAST', '2026-11-20T11:59:59.999Z'),
      flightSeed('MS-NOW', '2026-11-20T12:00:00.000Z'),
      flightSeed('MS-FUTURE', '2026-11-20T12:00:00.001Z'),
      { ...flightSeed('MS-CANCELLED', '2026-11-20T11:00:00.000Z'), status: 'cancelled' },
    ]);

    await expect(flights.markFlightsDeparted()).resolves.toBe(2);
    await expect(flights.markFlightsDeparted()).resolves.toBe(0);

    const statuses = await flightModel
      .find({}, { flightNumber: 1, status: 1 })
      .lean()
      .exec();
    expect(Object.fromEntries(statuses.map((flight) => [flight.flightNumber, flight.status]))).toEqual({
      'MS-PAST': 'departed',
      'MS-NOW': 'departed',
      'MS-FUTURE': 'scheduled',
      'MS-CANCELLED': 'cancelled',
    });
  });
});

function flightSeed(flightNumber: string, departureAt: string) {
  const departure = new Date(departureAt);
  return {
    airlineId: new Types.ObjectId(),
    flightNumber,
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAt: departure,
    arrivalAt: new Date(departure.getTime() + 60_000),
    departureLocalDate: '2026-11-20',
    durationMinutes: 1,
    status: 'scheduled',
  };
}
