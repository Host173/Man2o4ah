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
import { Airline } from './schemas/airline.schema.js';
import { Flight } from './schemas/flight.schema.js';

describe('Flight search integration (FLT-11, FLT-12, FLT-15)', () => {
  let testApp: TestApp;
  let service: FlightsService;
  let airlines: Model<Airline>;
  let flights: Model<Flight>;

  beforeAll(async () => {
    testApp = await createTestApp({
      imports: [FlightsModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(new FakeReferenceDataService()),
    });
    service = testApp.moduleRef.get(FlightsService);
    airlines = testApp.moduleRef.get<Model<Airline>>(
      getModelToken(Airline.name),
    );
    flights = testApp.moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00.000Z'));
    await clearCollections(testApp.connection);
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => await testApp.close(), HOOK_TIMEOUT);

  it('filters by route, local date, active airline, future departure and seat counters', async () => {
    const active = await airlines.create({
      name: 'EgyptAir',
      code: 'MS',
      isActive: true,
    });
    const inactive = await airlines.create({
      name: 'Inactive',
      code: 'IN',
      isActive: false,
    });
    await flights.create([
      seed(active._id, 'MS-1', '2026-11-20T06:00:00.000Z', [
        cabin('economy', 2, 30000, 1, 1),
      ]),
      seed(active._id, 'MS-2', '2026-11-20T08:00:00.000Z', [
        cabin('economy', 5, 25000, 1, 0),
        cabin('business', 3, 90000, 0, 0),
      ]),
      seed(inactive._id, 'IN-1', '2026-11-20T09:00:00.000Z', [
        cabin('economy', 5, 10000, 0, 0),
      ]),
      seed(
        active._id,
        'MS-CANCELLED',
        '2026-11-20T10:00:00.000Z',
        [cabin('economy', 5, 10000, 0, 0)],
        'cancelled',
      ),
      seed(active._id, 'MS-PAST', '2026-11-12T09:00:00.000Z', [
        cabin('economy', 5, 10000, 0, 0),
      ]),
    ]);

    const page = await service.search({
      from: 'CAI',
      to: 'DXB',
      date: '2026-11-20',
      adults: 2,
      children: 0,
      infants: 0,
      sortBy: 'price',
      page: 1,
      limit: 10,
    });
    expect(page.items.map((item) => item.flight.flightNumber)).toEqual([
      'MS-2',
    ]);
  });

  it('applies inclusive price, cabin class, sorting and pagination', async () => {
    const active = await airlines.create({
      name: 'EgyptAir',
      code: 'MS',
      isActive: true,
    });
    await flights.create([
      seed(active._id, 'MS-A', '2026-11-20T08:00:00.000Z', [
        cabin('economy', 5, 30000, 0, 0),
        cabin('business', 5, 90000, 0, 0),
      ]),
      seed(active._id, 'MS-B', '2026-11-20T06:00:00.000Z', [
        cabin('economy', 5, 25000, 0, 0),
      ]),
      seed(active._id, 'MS-C', '2026-11-20T12:00:00.000Z', [
        cabin('economy', 5, 40000, 0, 0),
      ]),
    ]);

    const page = await service.search({
      from: 'CAI',
      to: 'DXB',
      date: '2026-11-20',
      adults: 1,
      children: 0,
      infants: 0,
      cabinClass: 'economy',
      minPriceMinor: 30000,
      maxPriceMinor: 40000,
      sortBy: 'departure',
      page: 1,
      limit: 2,
    });
    expect(page.items.map((item) => item.flight.flightNumber)).toEqual([
      'MS-A',
      'MS-C',
    ]);
    expect(page).toMatchObject({ total: 2, totalPages: 1, page: 1, limit: 2 });
  });

  it('returns outbound and inbound paginated lists for round trips', async () => {
    const active = await airlines.create({
      name: 'EgyptAir',
      code: 'MS',
      isActive: true,
    });
    await flights.create([
      seed(active._id, 'OUT', '2026-11-20T08:00:00.000Z', [
        cabin('economy', 5, 30000, 0, 0),
      ]),
      seed(
        active._id,
        'IN',
        '2026-11-27T09:00:00.000Z',
        [cabin('economy', 5, 35000, 0, 0)],
        'scheduled',
        'DXB',
        'CAI',
        '2026-11-27',
      ),
    ]);
    const result = await service.search({
      from: 'CAI',
      to: 'DXB',
      date: '2026-11-20',
      returnDate: '2026-11-27',
      adults: 1,
      children: 0,
      infants: 0,
      sortBy: 'price',
      page: 1,
      limit: 10,
    });
    expect(
      result.outbound.items.map((item) => item.flight.flightNumber),
    ).toEqual(['OUT']);
    expect(
      result.inbound.items.map((item) => item.flight.flightNumber),
    ).toEqual(['IN']);
  });

  it('rejects invalid passenger counts and inverted or reversed prices/dates', async () => {
    let caught: unknown;
    try {
      await service.search({
        from: 'CAI',
        to: 'DXB',
        date: '2026-11-20',
        adults: 1,
        children: 0,
        infants: 2,
        sortBy: 'departure',
        page: 1,
        limit: 10,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      status: 400,
      response: { code: 'VALIDATION_FAILED' },
    });
    caught = undefined;
    try {
      await service.search({
        from: 'CAI',
        to: 'DXB',
        date: '2026-11-20',
        adults: 1,
        children: 0,
        infants: 0,
        minPriceMinor: 40000,
        maxPriceMinor: 30000,
        sortBy: 'departure',
        page: 1,
        limit: 10,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      status: 400,
      response: { code: 'VALIDATION_FAILED' },
    });
  });
});

function cabin(
  cabinClass: 'economy' | 'business',
  totalSeats: number,
  priceMinor: number,
  heldSeats: number,
  bookedSeats: number,
) {
  return {
    cabinClass,
    totalSeats,
    availableSeats: totalSeats - heldSeats - bookedSeats,
    heldSeats,
    bookedSeats,
    priceMinor,
    freeBags: 1,
    maxBagWeightKg: 23,
  };
}

function seed(
  airlineId: Types.ObjectId,
  flightNumber: string,
  departureAt: string,
  cabins: ReturnType<typeof cabin>[],
  status: 'scheduled' | 'cancelled' | 'departed' = 'scheduled',
  departureAirportId = 'CAI',
  arrivalAirportId = 'DXB',
  departureLocalDate = '2026-11-20',
) {
  const departure = new Date(departureAt);
  return {
    airlineId,
    flightNumber,
    departureAirportId,
    arrivalAirportId,
    departureAt: departure,
    arrivalAt: new Date(departure.getTime() + 180 * 60_000),
    departureLocalDate,
    durationMinutes: 180,
    status,
    hasBookings: false,
    cabins,
  };
}
