import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { HotelBookingsService } from './hotel-bookings.service.js';
import type { HotelReservationAdminView } from './hotel-bookings.types.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import {
  HotelReservation,
  type HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

const USER_ID = new Types.ObjectId();
const HOTEL_ID = new Types.ObjectId();
const CHECK_IN = new Date('2027-03-10T00:00:00.000Z');
const CHECK_OUT = new Date('2027-03-13T00:00:00.000Z');

/** A saved reservation with an exact `createdAt`, inserted below Mongoose's timestamps. */
function rawReservation(
  bookingId: string,
  createdAt: string,
  status: HotelReservationStatus = 'confirmed',
) {
  return {
    _id: new Types.ObjectId(bookingId),
    userId: USER_ID,
    hotelId: HOTEL_ID,
    ...(status === 'pending_payment'
      ? {}
      : { reference: `HR${bookingId.slice(-6).toUpperCase()}` }),
    status,
    checkInDate: CHECK_IN,
    checkOutDate: CHECK_OUT,
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
    totalMinor: 24_000,
    currency: 'USD',
    policySnapshot: {
      cancellationTiers: [],
      checkInTime: '14:00',
      checkOutTime: '11:00',
    },
    holdExpiresAt: new Date('2027-03-01T00:10:00.000Z'),
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    __v: 0,
  };
}

const SEED = [
  rawReservation('6736f0b2c5a1b2c3d4e60001', '2026-11-01T10:00:00.000Z'),
  rawReservation(
    '6736f0b2c5a1b2c3d4e60002',
    '2026-11-02T10:00:00.000Z',
    'cancelled',
  ),
  rawReservation(
    '6736f0b2c5a1b2c3d4e60003',
    '2026-11-03T10:00:00.000Z',
    'pending_payment',
  ),
];

const ids = (items: HotelReservationAdminView[]) =>
  items.map((item) => item.bookingId);

describe('HotelBookingsService.listForAdmin (integration, ACC-11/ACC-17)', () => {
  let t: TestApp;
  let service: HotelBookingsService;
  let reservations: Model<HotelReservation>;

  beforeAll(async () => {
    t = await createTestApp({ imports: [HotelBookingsModule] });
    service = t.moduleRef.get(HotelBookingsService);
    reservations = t.connection.model<HotelReservation>(HotelReservation.name);
  }, HOOK_TIMEOUT);
  beforeEach(() => clearCollections(t.connection));
  afterAll(() => t.close(), HOOK_TIMEOUT);

  async function seed(
    ...docs: ReturnType<typeof rawReservation>[]
  ): Promise<void> {
    await reservations.collection.insertMany(docs);
  }

  it('returns an empty page when there are no reservations', async () => {
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

  it('maps a reservation to the sanitized read-only admin row', async () => {
    await seed(SEED[0]);
    const page = await service.listForAdmin({ page: 1, limit: 10 });
    expect(page.items).toEqual([
      {
        bookingType: 'hotel',
        bookingId: '6736f0b2c5a1b2c3d4e60001',
        reference: 'HRE60001',
        userId: USER_ID.toHexString(),
        providerId: HOTEL_ID.toHexString(),
        startAt: CHECK_IN,
        endAt: CHECK_OUT,
        totalMinor: 24_000,
        currency: 'USD',
        status: 'confirmed',
        createdAt: new Date('2026-11-01T10:00:00.000Z'),
      },
    ]);
  });

  it('lists every reservation, newest createdAt first', async () => {
    await seed(...SEED);
    const page = await service.listForAdmin({ page: 1, limit: 10 });
    expect(ids(page.items)).toEqual([
      '6736f0b2c5a1b2c3d4e60003',
      '6736f0b2c5a1b2c3d4e60002',
      '6736f0b2c5a1b2c3d4e60001',
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
    expect(ids(page.items)).toEqual(['6736f0b2c5a1b2c3d4e60002']);
    expect(page.total).toBe(1);
  });

  it('includes reservations created exactly at from and to', async () => {
    await seed(...SEED);
    const page = await service.listForAdmin({
      from: new Date('2026-11-01T10:00:00.000Z'),
      to: new Date('2026-11-02T10:00:00.000Z'),
      page: 1,
      limit: 10,
    });
    expect(ids(page.items)).toEqual([
      '6736f0b2c5a1b2c3d4e60002',
      '6736f0b2c5a1b2c3d4e60001',
    ]);
    expect(page.total).toBe(2);
  });

  it('excludes reservations one millisecond outside the inclusive range', async () => {
    await seed(...SEED);
    const page = await service.listForAdmin({
      from: new Date('2026-11-01T10:00:00.001Z'),
      to: new Date('2026-11-03T09:59:59.999Z'),
      page: 1,
      limit: 10,
    });
    expect(ids(page.items)).toEqual(['6736f0b2c5a1b2c3d4e60002']);
  });

  it('supports an open-ended date range (from only)', async () => {
    await seed(...SEED);
    const page = await service.listForAdmin({
      from: new Date('2026-11-03T10:00:00.000Z'),
      page: 1,
      limit: 10,
    });
    expect(ids(page.items)).toEqual(['6736f0b2c5a1b2c3d4e60003']);
  });

  it('supports an open-ended date range (to only)', async () => {
    await seed(...SEED);
    const page = await service.listForAdmin({
      to: new Date('2026-11-01T10:00:00.000Z'),
      page: 1,
      limit: 10,
    });
    expect(ids(page.items)).toEqual(['6736f0b2c5a1b2c3d4e60001']);
  });

  it('paginates, keeps the total and returns no items past the last page', async () => {
    await seed(...SEED);
    const second = await service.listForAdmin({ page: 2, limit: 2 });
    expect(ids(second.items)).toEqual(['6736f0b2c5a1b2c3d4e60001']);
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

  it('orders reservations tied on createdAt deterministically (newest _id first)', async () => {
    const tied = '2026-11-11T12:00:00.000Z';
    await seed(
      rawReservation('6736f0b2c5a1b2c3d4e60011', tied),
      rawReservation('6736f0b2c5a1b2c3d4e60010', tied),
    );
    const page = await service.listForAdmin({ page: 1, limit: 10 });
    expect(ids(page.items)).toEqual([
      '6736f0b2c5a1b2c3d4e60011',
      '6736f0b2c5a1b2c3d4e60010',
    ]);
  });

  it('never mutates a reservation: the admin list is read-only', async () => {
    await seed(SEED[0]);
    await service.listForAdmin({ page: 1, limit: 10 });
    const stored = await reservations
      .findById('6736f0b2c5a1b2c3d4e60001')
      .lean<Record<string, unknown>>();
    expect(stored).toMatchObject({
      status: 'confirmed',
      reference: 'HRE60001',
      totalMinor: 24_000,
      policySnapshot: { checkInTime: '14:00', checkOutTime: '11:00' },
    });
  });
});
