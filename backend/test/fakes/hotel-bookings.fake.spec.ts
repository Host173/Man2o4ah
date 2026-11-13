import type { HotelReservationAdminView } from '../../src/modules/hotel-bookings/hotel-bookings.types.js';
import { FakeHotelBookingsService } from './hotel-bookings.fake.js';

function booking(
  bookingId: string,
  createdAt: string,
  status: HotelReservationAdminView['status'] = 'confirmed',
): HotelReservationAdminView {
  return {
    bookingType: 'hotel',
    bookingId,
    reference: status === 'pending_payment' ? undefined : 'HRABC123',
    userId: 'user-1',
    providerId: 'hotel-1',
    startAt: new Date('2026-12-01T00:00:00.000Z'),
    endAt: new Date('2026-12-04T00:00:00.000Z'),
    totalMinor: 25000,
    currency: 'USD',
    status,
    createdAt: new Date(createdAt),
  };
}

const seed = [
  booking('b-1', '2026-11-01T10:00:00.000Z'),
  booking('b-2', '2026-11-02T10:00:00.000Z', 'cancelled'),
  booking('b-3', '2026-11-03T10:00:00.000Z', 'pending_payment'),
];

const ids = (items: HotelReservationAdminView[]) =>
  items.map((item) => item.bookingId);

describe('FakeHotelBookingsService.listForAdmin', () => {
  it('returns an empty page when nothing is seeded', async () => {
    const bookings = new FakeHotelBookingsService();
    await expect(
      bookings.listForAdmin({ page: 1, limit: 10 }),
    ).resolves.toEqual({
      items: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  });

  it('lists every booking, newest createdAt first', async () => {
    const bookings = new FakeHotelBookingsService(seed);
    const page = await bookings.listForAdmin({ page: 1, limit: 10 });
    expect(ids(page.items)).toEqual(['b-3', 'b-2', 'b-1']);
    expect(page.total).toBe(3);
  });

  it('filters by status', async () => {
    const bookings = new FakeHotelBookingsService(seed);
    const page = await bookings.listForAdmin({
      status: 'cancelled',
      page: 1,
      limit: 10,
    });
    expect(ids(page.items)).toEqual(['b-2']);
    expect(page.total).toBe(1);
  });

  it('includes bookings created exactly at from and to', async () => {
    const bookings = new FakeHotelBookingsService(seed);
    const page = await bookings.listForAdmin({
      from: new Date('2026-11-01T10:00:00.000Z'),
      to: new Date('2026-11-02T10:00:00.000Z'),
      page: 1,
      limit: 10,
    });
    expect(ids(page.items)).toEqual(['b-2', 'b-1']);
  });

  it('excludes bookings one millisecond outside the range', async () => {
    const bookings = new FakeHotelBookingsService(seed);
    const page = await bookings.listForAdmin({
      from: new Date('2026-11-01T10:00:00.001Z'),
      to: new Date('2026-11-03T09:59:59.999Z'),
      page: 1,
      limit: 10,
    });
    expect(ids(page.items)).toEqual(['b-2']);
  });

  it('paginates and keeps the total', async () => {
    const bookings = new FakeHotelBookingsService(seed);
    const second = await bookings.listForAdmin({ page: 2, limit: 2 });
    expect(ids(second.items)).toEqual(['b-1']);
    expect(second).toMatchObject({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
  });

  it('returns no items past the last page', async () => {
    const bookings = new FakeHotelBookingsService(seed);
    const page = await bookings.listForAdmin({ page: 3, limit: 2 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(3);
  });

  it('copies its data, so callers and fixtures cannot change each other', async () => {
    const fixtures = [booking('b-1', '2026-11-01T10:00:00.000Z')];
    const bookings = new FakeHotelBookingsService(fixtures);
    fixtures[0].status = 'cancelled';
    const first = await bookings.listForAdmin({ page: 1, limit: 10 });
    first.items[0].totalMinor = 0;
    const second = await bookings.listForAdmin({ page: 1, limit: 10 });
    expect(second.items[0]).toMatchObject({
      status: 'confirmed',
      totalMinor: 25000,
    });
  });
});
