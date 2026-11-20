import { Types } from 'mongoose';
import { FakeFlightBookingsService } from '../../../test/fakes/flight-bookings.fake.js';
import { FakeHotelBookingsService } from '../../../test/fakes/hotel-bookings.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { FlightBookingsService } from './flight-bookings.service.js';
import type {
  AdminFlightBookingQuery,
  FlightBookingAdminView,
} from './flight-bookings.types.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module.js';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service.js';
import type { HotelReservationAdminView } from '../hotel-bookings/hotel-bookings.types.js';

const USER = new Types.ObjectId();
const PROVIDER = new Types.ObjectId();

function flightView(
  id: string,
  createdAt: string,
  status: FlightBookingAdminView['status'] = 'confirmed',
): FlightBookingAdminView {
  return {
    bookingType: 'flight',
    bookingId: id,
    reference:
      status === 'pending_payment'
        ? undefined
        : `FB${id.slice(-6).toUpperCase()}`,
    userId: USER.toHexString(),
    providerId: PROVIDER.toHexString(),
    startAt: new Date('2027-03-10T08:00:00.000Z'),
    endAt: new Date('2027-03-10T11:00:00.000Z'),
    totalMinor: 25_000,
    currency: 'USD',
    status,
    createdAt: new Date(createdAt),
  };
}

function hotelView(
  id: string,
  createdAt: string,
  status: HotelReservationAdminView['status'] = 'confirmed',
): HotelReservationAdminView {
  return {
    bookingType: 'hotel',
    bookingId: id,
    reference:
      status === 'pending_payment'
        ? undefined
        : `HR${id.slice(-6).toUpperCase()}`,
    userId: USER.toHexString(),
    providerId: PROVIDER.toHexString(),
    startAt: new Date('2027-03-10T00:00:00.000Z'),
    endAt: new Date('2027-03-13T00:00:00.000Z'),
    totalMinor: 24_000,
    currency: 'USD',
    status,
    createdAt: new Date(createdAt),
  };
}

const flightIds = [
  '6736f0b2c5a1b2c3d4e70001',
  '6736f0b2c5a1b2c3d4e70002',
  '6736f0b2c5a1b2c3d4e70003',
];
const hotelIds = [
  '6736f0b2c5a1b2c3d4e80001',
  '6736f0b2c5a1b2c3d4e80002',
  '6736f0b2c5a1b2c3d4e80003',
];
const flights = [
  flightView(flightIds[0], '2026-11-01T10:00:00.000Z'),
  flightView(flightIds[1], '2026-11-02T10:00:00.000Z', 'cancelled'),
  flightView(flightIds[2], '2026-11-03T10:00:00.000Z', 'pending_payment'),
];
const hotels = [
  hotelView(hotelIds[0], '2026-11-01T10:00:00.000Z'),
  hotelView(hotelIds[1], '2026-11-02T10:00:00.000Z', 'cancelled'),
  hotelView(hotelIds[2], '2026-11-03T10:00:00.000Z', 'pending_payment'),
];

function rawFlight(v: FlightBookingAdminView) {
  const departure = v.startAt;
  return {
    _id: new Types.ObjectId(v.bookingId),
    userId: new Types.ObjectId(v.userId),
    ...(v.reference ? { reference: v.reference } : {}),
    status: v.status,
    tripType: 'one_way',
    segments: [
      {
        direction: 'outbound',
        flightId: new Types.ObjectId(),
        cabinId: new Types.ObjectId(),
        cabinClass: 'economy',
        airlineId: new Types.ObjectId(v.providerId),
        flightNumber: 'MS985',
        departureAirportId: 'CAI',
        arrivalAirportId: 'JFK',
        departureAt: departure,
        arrivalAt: v.endAt,
        fareMinor: 10_000,
        policy: {
          cancellationTiers: [],
          freeBags: 1,
          maxBagWeightKg: 23,
          extraBagPriceMinor: 0,
          maxExtraBagsPerPassenger: 0,
        },
      },
    ],
    passengers: [
      {
        type: 'adult',
        fullName: 'Test User',
        dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
        documentNumber: 'A12345678',
        extraBagCount: 0,
      },
    ],
    seatCount: 1,
    pricing: {
      fareTotalMinor: 10_000,
      baggageTotalMinor: 0,
      totalMinor: v.totalMinor,
      currency: v.currency,
    },
    holdExpiresAt: new Date('2027-03-01T00:10:00.000Z'),
    firstDepartureAt: departure,
    lastDepartureAt: v.endAt,
    createdAt: v.createdAt,
    updatedAt: v.createdAt,
    __v: 0,
  };
}

function rawHotel(v: HotelReservationAdminView) {
  return {
    _id: new Types.ObjectId(v.bookingId),
    userId: new Types.ObjectId(v.userId),
    hotelId: new Types.ObjectId(v.providerId),
    ...(v.reference ? { reference: v.reference } : {}),
    status: v.status,
    checkInDate: v.startAt,
    checkOutDate: v.endAt,
    nights: 3,
    rooms: [
      {
        roomId: new Types.ObjectId(),
        roomName: 'Deluxe',
        roomType: 'double',
        pricePerNightMinor: 8_000,
        adults: 2,
        childAges: [],
        subtotalMinor: 24_000,
      },
    ],
    totalMinor: v.totalMinor,
    currency: v.currency,
    policySnapshot: {
      cancellationTiers: [],
      checkInTime: '14:00',
      checkOutTime: '11:00',
    },
    holdExpiresAt: new Date('2027-03-01T00:10:00.000Z'),
    createdAt: v.createdAt,
    updatedAt: v.createdAt,
    __v: 0,
  };
}

/**
 * The fakes are the contract the other modules build against. This pins the
 * real services and the fakes to the same results for the same fixtures.
 */
describe('booking admin list: real services match the fakes (ACC-11/ACC-17)', () => {
  let t: TestApp;
  let realFlights: FlightBookingsService;
  let realHotels: HotelBookingsService;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FlightBookingsModule, HotelBookingsModule],
    });
    realFlights = t.moduleRef.get(FlightBookingsService);
    realHotels = t.moduleRef.get(HotelBookingsService);
  }, HOOK_TIMEOUT);
  beforeEach(async () => {
    await clearCollections(t.connection);
    await t.connection
      .collection('flight_bookings')
      .insertMany(flights.map(rawFlight));
    await t.connection
      .collection('hotel_reservations')
      .insertMany(hotels.map(rawHotel));
  });
  afterAll(() => t.close(), HOOK_TIMEOUT);

  const queries: AdminFlightBookingQuery[] = [
    { page: 1, limit: 10 },
    { page: 1, limit: 10, status: 'confirmed' as const },
    {
      page: 1,
      limit: 10,
      from: new Date('2026-11-02T00:00:00.000Z'),
      to: new Date('2026-11-03T23:59:59.999Z'),
    },
    { page: 2, limit: 2 },
    { page: 4, limit: 2 },
  ];

  it.each(queries)('flight list matches the fake for %o', async (query) => {
    const fake = new FakeFlightBookingsService(flights);
    await expect(realFlights.listForAdmin(query)).resolves.toEqual(
      await fake.listForAdmin(query),
    );
  });

  it.each(queries)('hotel list matches the fake for %o', async (query) => {
    const fake = new FakeHotelBookingsService(hotels);
    await expect(realHotels.listForAdmin(query)).resolves.toEqual(
      await fake.listForAdmin(query),
    );
  });

  it('matches on equal-createdAt ties regardless of seed order', async () => {
    const tiedAt = '2026-11-11T12:00:00.000Z';
    const tiedFlightViews = [
      flightView('6736f0b2c5a1b2c3d4e70001', tiedAt),
      flightView('6736f0b2c5a1b2c3d4e70003', tiedAt),
      flightView('6736f0b2c5a1b2c3d4e70002', tiedAt),
    ];
    await clearCollections(t.connection);
    await t.connection
      .collection('flight_bookings')
      .insertMany(tiedFlightViews.map(rawFlight));

    const fake = new FakeFlightBookingsService(tiedFlightViews);
    await expect(
      realFlights.listForAdmin({ page: 1, limit: 10 }),
    ).resolves.toEqual(await fake.listForAdmin({ page: 1, limit: 10 }));
  });
});
