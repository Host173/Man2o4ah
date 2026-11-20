import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { FlightsModule } from './flights.module.js';
import { FlightsService } from './flights.service.js';
import { Airline } from './schemas/airline.schema.js';
import { Flight } from './schemas/flight.schema.js';
import { FlightStatus } from './schemas/flight.schema.js';
import { Cabin } from './schemas/flight.schema.js';
import { CabinClass } from '../../common/database/cabin-class.js';

describe('Flight details and booking contract integration (FLT-17)', () => {
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

  it('returns details and booking-facing timezone data, and omits unknown flights', async () => {
    const airline = await airlines.create({
      name: 'EgyptAir',
      code: 'MS',
      isActive: true,
      baggagePolicy: {
        extraBagPriceMinor: 5000,
        maxExtraBagsPerPassenger: 2,
      },
      cancellationPolicy: {
        tiers: [{ daysBefore: 7, refundPercent: 100 }],
      },
    });
    const flight = await flights.create(seed(airline._id, 'MS-1'));
    const details = await service.getFlightDetails(flight._id.toHexString());
    expect(details.flight).toMatchObject({
      id: flight._id.toHexString(),
      departureTimeZone: 'America/New_York',
      arrivalTimeZone: 'Africa/Cairo',
    });
    expect(details.airline).toMatchObject({
      id: airline._id.toHexString(),
      baggagePolicy: {
        extraBagPriceMinor: 5000,
        maxExtraBagsPerPassenger: 2,
      },
      cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }],
    });
    const found = await service.getFlightsForBooking([
      flight._id.toHexString(),
      new Types.ObjectId().toHexString(),
      'not-an-id',
    ]);
    expect([...found.keys()]).toEqual([flight._id.toHexString()]);
    expect(found.get(flight._id.toHexString())?.flight).toMatchObject({
      departureTimeZone: 'America/New_York',
      arrivalTimeZone: 'Africa/Cairo',
    });
  });

  it('checks all bookability reasons and enough remaining seats', async () => {
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
    const future = await flights.create(seed(active._id, 'MS-FUTURE'));
    const cabinId = (future.cabins[0] as Cabin & { _id: Types.ObjectId })._id;
    await expect(
      service.checkBookable(future._id.toHexString(), cabinId.toHexString(), 2),
    ).resolves.toEqual({ bookable: true });
    await flights.updateOne(
      { _id: future._id },
      { $set: { 'cabins.0.availableSeats': 1 } },
    );
    await expect(
      service.checkBookable(future._id.toHexString(), cabinId.toHexString(), 2),
    ).resolves.toEqual({ bookable: false, reason: 'not_enough_seats' });
    await expect(
      service.checkBookable(future._id.toHexString(), cabinId.toHexString(), 0),
    ).resolves.toEqual({ bookable: false, reason: 'not_enough_seats' });
    await expect(
      service.checkBookable(
        future._id.toHexString(),
        new Types.ObjectId().toHexString(),
        1,
      ),
    ).resolves.toEqual({ bookable: false, reason: 'cabin_not_found' });

    await flights.updateOne(
      { _id: future._id },
      { $set: { status: 'cancelled' } },
    );
    await expect(
      service.checkBookable(future._id.toHexString(), cabinId.toHexString(), 1),
    ).resolves.toEqual({ bookable: false, reason: 'flight_not_scheduled' });

    const inactiveFlight = await flights.create({
      ...seed(inactive._id, 'IN-1'),
      flightNumber: 'IN-1',
    });
    await expect(
      service.checkBookable(
        inactiveFlight._id.toHexString(),
        (
          inactiveFlight.cabins[0] as Cabin & { _id: Types.ObjectId }
        )._id.toHexString(),
        1,
      ),
    ).resolves.toEqual({ bookable: false, reason: 'airline_inactive' });

    await expect(
      service.checkBookable(
        new Types.ObjectId().toHexString(),
        new Types.ObjectId().toHexString(),
        1,
      ),
    ).resolves.toEqual({ bookable: false, reason: 'flight_not_found' });
  });

  it('blocks booking when departure is at or before now and rejects unknown details', async () => {
    const airline = await airlines.create({
      name: 'EgyptAir',
      code: 'MS',
      isActive: true,
    });
    const past = await flights.create({
      ...seed(airline._id, 'MS-PAST'),
      departureAt: new Date('2026-11-12T10:00:00.000Z'),
      arrivalAt: new Date('2026-11-12T11:00:00.000Z'),
    });
    await expect(
      service.checkBookable(
        past._id.toHexString(),
        (past.cabins[0] as Cabin & { _id: Types.ObjectId })._id.toHexString(),
        1,
      ),
    ).resolves.toEqual({ bookable: false, reason: 'departure_passed' });
    await expect(
      service.getFlightDetails(new Types.ObjectId().toHexString()),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND' },
    });
  });
});

function seed(airlineId: Types.ObjectId, flightNumber: string) {
  return {
    airlineId,
    flightNumber,
    departureAirportId: 'JFK',
    arrivalAirportId: 'CAI',
    departureAt: new Date('2027-03-14T07:30:00.000Z'),
    arrivalAt: new Date('2027-03-14T08:00:00.000Z'),
    departureLocalDate: '2027-03-14',
    durationMinutes: 30,
    status: FlightStatus.SCHEDULED,
    hasBookings: false,
    cabins: [
      {
        cabinClass: CabinClass.ECONOMY,
        totalSeats: 5,
        availableSeats: 5,
        heldSeats: 0,
        bookedSeats: 0,
        priceMinor: 30000,
        freeBags: 1,
        maxBagWeightKg: 23,
      },
    ],
  };
}
