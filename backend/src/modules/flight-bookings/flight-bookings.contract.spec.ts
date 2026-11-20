import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { FlightBookingsService } from './flight-bookings.service.js';
import type { FlightBookingAdminView } from './flight-bookings.types.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import {
  FlightBooking,
  type FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

const USER_ID = new Types.ObjectId();
const AIRLINE_ID = new Types.ObjectId();

/** A saved booking with an exact `createdAt`, inserted below Mongoose's timestamps. */
function rawBooking(
  bookingId: string,
  createdAt: string,
  status: FlightBookingStatus = 'confirmed',
) {
  const departure = new Date('2027-03-10T08:00:00.000Z');
  return {
    _id: new Types.ObjectId(bookingId),
    userId: USER_ID,
    ...(status === 'pending_payment'
      ? {}
      : { reference: `FB${bookingId.slice(-6).toUpperCase()}` }),
    status,
    tripType: 'one_way',
    segments: [
      {
        direction: 'outbound',
        flightId: new Types.ObjectId(),
        cabinId: new Types.ObjectId(),
        cabinClass: 'economy',
        airlineId: AIRLINE_ID,
        flightNumber: 'MS985',
        departureAirportId: 'CAI',
        arrivalAirportId: 'JFK',
        departureAt: departure,
        arrivalAt: new Date(departure.getTime() + 3_600_000),
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
      totalMinor: 25_000,
      currency: 'USD',
    },
    holdExpiresAt: new Date('2027-03-01T00:10:00.000Z'),
    firstDepartureAt: departure,
    lastDepartureAt: departure,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    __v: 0,
  };
}

const SEED = [
  rawBooking('6736f0b2c5a1b2c3d4e50001', '2026-11-01T10:00:00.000Z'),
  rawBooking(
    '6736f0b2c5a1b2c3d4e50002',
    '2026-11-02T10:00:00.000Z',
    'cancelled',
  ),
  rawBooking(
    '6736f0b2c5a1b2c3d4e50003',
    '2026-11-03T10:00:00.000Z',
    'pending_payment',
  ),
];

const ids = (items: FlightBookingAdminView[]) =>
  items.map((item) => item.bookingId);

describe('FlightBookingsService.listForAdmin (integration, ACC-11/ACC-17)', () => {
  let t: TestApp;
  let service: FlightBookingsService;
  let bookings: Model<FlightBooking>;

  beforeAll(async () => {
    t = await createTestApp({ imports: [FlightBookingsModule] });
    service = t.moduleRef.get(FlightBookingsService);
    bookings = t.connection.model<FlightBooking>(FlightBooking.name);
  }, HOOK_TIMEOUT);
  beforeEach(() => clearCollections(t.connection));
  afterAll(() => t.close(), HOOK_TIMEOUT);

  async function seed(...docs: ReturnType<typeof rawBooking>[]): Promise<void> {
    await bookings.collection.insertMany(docs);
  }

  it('returns an empty page when there are no bookings', async () => {
    await expect(service.listForAdmin({ page: 1, limit: 10 })).resolves.toEqual(
      {
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      },
    );
  });

  it('maps a booking to the sanitized read-only admin row', async () => {
    await seed(SEED[0]);
    const page = await service.listForAdmin({ page: 1, limit: 10 });
    expect(page.items).toEqual([
      {
        bookingType: 'flight',
        bookingId: '6736f0b2c5a1b2c3d4e50001',
        reference: 'FBE50001',
        userId: USER_ID.toHexString(),
        providerId: AIRLINE_ID.toHexString(),
        startAt: new Date('2027-03-10T08:00:00.000Z'),
        endAt: new Date('2027-03-10T08:00:00.000Z'),
        totalMinor: 25_000,
        currency: 'USD',
        status: 'confirmed',
        createdAt: new Date('2026-11-01T10:00:00.000Z'),
      },
    ]);
  });

  it('lists every booking, newest createdAt first', async () => {
    await seed(...SEED);
    const page = await service.listForAdmin({ page: 1, limit: 10 });
    expect(ids(page.items)).toEqual([
      '6736f0b2c5a1b2c3d4e50003',
      '6736f0b2c5a1b2c3d4e50002',
      '6736f0b2c5a1b2c3d4e50001',
    ]);
    expect(page.total).toBe(3);
    expect(page.totalPages).toBe(1);
  });

  it('filters by status', async () => {
    await seed(...SEED);
    const page = await service.listForAdmin({
      status: 'cancelled',
      page: 1,
      limit: 10,
    });
    expect(ids(page.items)).toEqual(['6736f0b2c5a1b2c3d4e50002']);
    expect(page.total).toBe(1);
  });

  it('includes bookings created exactly at from and to', async () => {
    await seed(...SEED);
    const page = await service.listForAdmin({
      from: new Date('2026-11-01T10:00:00.000Z'),
      to: new Date('2026-11-02T10:00:00.000Z'),
      page: 1,
      limit: 10,
    });
    expect(ids(page.items)).toEqual([
      '6736f0b2c5a1b2c3d4e50002',
      '6736f0b2c5a1b2c3d4e50001',
    ]);
    expect(page.total).toBe(2);
  });

  it('excludes bookings one millisecond outside the inclusive range', async () => {
    await seed(...SEED);
    const page = await service.listForAdmin({
      from: new Date('2026-11-01T10:00:00.001Z'),
      to: new Date('2026-11-03T09:59:59.999Z'),
      page: 1,
      limit: 10,
    });
    expect(ids(page.items)).toEqual(['6736f0b2c5a1b2c3d4e50002']);
  });

  it('supports an open-ended date range (from only)', async () => {
    await seed(...SEED);
    const page = await service.listForAdmin({
      from: new Date('2026-11-03T10:00:00.000Z'),
      page: 1,
      limit: 10,
    });
    expect(ids(page.items)).toEqual(['6736f0b2c5a1b2c3d4e50003']);
  });

  it('supports an open-ended date range (to only)', async () => {
    await seed(...SEED);
    const page = await service.listForAdmin({
      to: new Date('2026-11-01T10:00:00.000Z'),
      page: 1,
      limit: 10,
    });
    expect(ids(page.items)).toEqual(['6736f0b2c5a1b2c3d4e50001']);
  });

  it('paginates, keeps the total and returns no items past the last page', async () => {
    await seed(...SEED);
    const second = await service.listForAdmin({ page: 2, limit: 2 });
    expect(ids(second.items)).toEqual(['6736f0b2c5a1b2c3d4e50001']);
    expect(second).toMatchObject({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
    });

    const past = await service.listForAdmin({ page: 3, limit: 2 });
    expect(past.items).toEqual([]);
    expect(past.total).toBe(3);
  });

  it('orders bookings tied on createdAt deterministically (newest _id first)', async () => {
    const tied = '2026-11-11T12:00:00.000Z';
    await seed(
      rawBooking('6736f0b2c5a1b2c3d4e50011', tied),
      rawBooking('6736f0b2c5a1b2c3d4e50010', tied),
    );
    const page = await service.listForAdmin({ page: 1, limit: 10 });
    expect(ids(page.items)).toEqual([
      '6736f0b2c5a1b2c3d4e50011',
      '6736f0b2c5a1b2c3d4e50010',
    ]);
  });

  it('never mutates a booking: the admin list is read-only', async () => {
    await seed(SEED[0]);
    await service.listForAdmin({ page: 1, limit: 10 });
    const stored = await bookings
      .findById('6736f0b2c5a1b2c3d4e50001')
      .lean<Record<string, unknown>>();
    expect(stored).toMatchObject({
      status: 'confirmed',
      reference: 'FBE50001',
      pricing: { totalMinor: 25_000, currency: 'USD' },
    });
  });
});
