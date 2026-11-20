import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import { FakeRoomNightInventory } from '../../../test/fakes/room-night-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { FakeEvents } from '../../../test/support/fake-events.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { HotelsService } from '../hotels/hotels.service.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { transitionStatus } from './booking-lifecycle.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import { HotelHoldService } from './hotel-hold.service.js';
import { HotelStayCompletionJob } from './hotel-stay-completion.job.js';
import {
  HotelReservation,
  HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

const HOTEL = '6553a1f0c2b4e8a9d0f1a801';
const ROOM_101 = '6553a1f0c2b4e8a9d0f1a802';
const USER = '6553a1f0c2b4e8a9d0f1a899';

function seededHotels(): FakeHotelsService {
  return new FakeHotelsService({
    hotels: [
      {
        id: HOTEL,
        name: 'Nile View',
        address: '1 Corniche',
        cityId: 'cairo',
        countryCode: 'EG',
        photos: [],
        amenities: [],
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationPolicy: {
          tiers: [{ daysBefore: 3, refundPercent: 50 }],
        },
        isActive: true,
        ratingSummary: { average: null, count: 0 },
      },
    ],
    rooms: [
      {
        id: ROOM_101,
        hotelId: HOTEL,
        name: '101',
        type: 'Double',
        beds: 1,
        maxOccupancy: 2,
        pricePerNightMinor: 10_000,
        isActive: true,
        availability: [
          {
            fromDate: toDateOnly('2026-01-01'),
            toDate: toDateOnly('2027-12-31'),
          },
        ],
        hasEverBeenReserved: false,
      },
    ],
    roomNights: [],
  });
}

describe('HotelStayCompletionJob (HTL-20, GEN-11)', () => {
  let t: TestApp;
  let holds: HotelHoldService;
  let job: HotelStayCompletionJob;
  let reservations: Model<HotelReservation>;
  const hotels = new FakeHotelsService();
  const inventory = new FakeRoomNightInventory(hotels);
  const events = new FakeEvents();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HotelBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(HotelsService)
          .useValue(hotels)
          .overrideProvider(RoomNightInventory)
          .useValue(inventory)
          .overrideProvider(AppEvents)
          .useValue(events),
    });
    holds = t.moduleRef.get(HotelHoldService);
    job = t.moduleRef.get(HotelStayCompletionJob);
    reservations = t.moduleRef.get<Model<HotelReservation>>(
      getModelToken(HotelReservation.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    Object.assign(hotels, seededHotels());
    events.clear();
    await clearCollections(t.connection);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  async function seedReservation(
    overrides: Partial<{
      status: HotelReservationStatus;
      checkInDate: string;
      checkOutDate: string;
      reference: string;
      confirmedAt: Date;
      expiredAt: Date;
      completedAt: Date;
      cancellation: {
        cancelledAt: Date;
        cancelledBy: 'user';
        refundPercent: number;
        refundAmountMinor: number;
      };
    }> = {},
  ) {
    const checkIn = toDateOnly(overrides.checkInDate ?? '2027-03-10');
    const checkOut = toDateOnly(overrides.checkOutDate ?? '2027-03-12');
    const nights = Math.round(
      (checkOut.getTime() - checkIn.getTime()) / (24 * 60 * 60 * 1000),
    );
    return reservations.create({
      userId: new Types.ObjectId(USER),
      hotelId: new Types.ObjectId(HOTEL),
      status: overrides.status ?? HotelReservationStatus.CONFIRMED,
      ...(overrides.reference ? { reference: overrides.reference } : {}),
      checkInDate: checkIn,
      checkOutDate: checkOut,
      nights,
      rooms: [
        {
          roomId: new Types.ObjectId(ROOM_101),
          roomName: '101',
          roomType: 'Double',
          pricePerNightMinor: 10_000,
          adults: 2,
          childAges: [5],
          subtotalMinor: nights * 10_000,
        },
      ],
      totalMinor: nights * 10_000,
      currency: 'USD',
      policySnapshot: {
        cancellationTiers: [{ daysBefore: 3, refundPercent: 50 }],
        checkInTime: '14:00',
        checkOutTime: '12:00',
      },
      holdExpiresAt: new Date('2027-03-01T10:10:00.000Z'),
      ...(overrides.confirmedAt ? { confirmedAt: overrides.confirmedAt } : {}),
      ...(overrides.expiredAt ? { expiredAt: overrides.expiredAt } : {}),
      ...(overrides.completedAt ? { completedAt: overrides.completedAt } : {}),
      ...(overrides.cancellation
        ? { cancellation: overrides.cancellation }
        : {}),
    });
  }

  it('enforces the strict UTC checkout boundary: checkout today stays confirmed, day after completes', async () => {
    const stay = await seedReservation({
      checkInDate: '2027-03-10',
      checkOutDate: '2027-03-12',
      reference: 'HRBND001',
      confirmedAt: new Date('2027-03-01T10:05:00.000Z'),
    });

    // Day before checkout and end of checkout day in UTC: equality is not enough.
    await expect(
      job.completeDueStays(new Date('2027-03-11T23:59:59.999Z')),
    ).resolves.toBe(0);
    await expect(
      job.completeDueStays(new Date('2027-03-12T00:00:00.000Z')),
    ).resolves.toBe(0);
    await expect(
      job.completeDueStays(new Date('2027-03-12T23:59:59.999Z')),
    ).resolves.toBe(0);

    expect(await reservations.findById(stay._id).lean()).toMatchObject({
      status: 'confirmed',
    });
    expect((await reservations.findById(stay._id).lean())?.completedAt).toBe(
      undefined,
    );

    // Exactly at 00:00:00.000Z the day after checkout: checkOutDate < today holds.
    const completedAt = new Date('2027-03-13T00:00:00.000Z');
    await expect(job.completeDueStays(completedAt)).resolves.toBe(1);

    expect(await reservations.findById(stay._id).lean()).toMatchObject({
      status: 'completed',
      completedAt,
    });
  });

  it('never completes pending_payment, expired, or cancelled reservations even after checkout', async () => {
    const pending = await seedReservation({
      status: HotelReservationStatus.PENDING_PAYMENT,
      checkInDate: '2027-03-01',
      checkOutDate: '2027-03-03',
    });
    const expired = await seedReservation({
      status: HotelReservationStatus.EXPIRED,
      checkInDate: '2027-03-04',
      checkOutDate: '2027-03-06',
      expiredAt: new Date('2027-03-01T10:15:00.000Z'),
    });
    const cancelled = await seedReservation({
      status: HotelReservationStatus.CANCELLED,
      checkInDate: '2027-03-07',
      checkOutDate: '2027-03-09',
      reference: 'HRCAN001',
      confirmedAt: new Date('2027-03-01T10:05:00.000Z'),
      cancellation: {
        cancelledAt: new Date('2027-03-02T10:00:00.000Z'),
        cancelledBy: 'user',
        refundPercent: 50,
        refundAmountMinor: 10_000,
      },
    });

    await expect(
      job.completeDueStays(new Date('2027-03-20T00:00:00.000Z')),
    ).resolves.toBe(0);

    expect((await reservations.findById(pending._id).lean())?.status).toBe(
      'pending_payment',
    );
    expect((await reservations.findById(expired._id).lean())?.status).toBe(
      'expired',
    );
    expect((await reservations.findById(cancelled._id).lean())?.status).toBe(
      'cancelled',
    );
  });

  it('preserves reference, snapshots, guests, inventory nights, and emits no completion event', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-09T12:00:00.000Z'));

    const hold = await holds.hold(
      {
        hotelId: HOTEL,
        checkInDate: '2027-03-10',
        checkOutDate: '2027-03-12',
        rooms: [{ roomId: ROOM_101, adults: 1, childAges: [8] }],
      },
      USER,
    );
    await transitionStatus(
      reservations,
      hold.reservationId,
      'pending_payment',
      'confirmed',
      {
        confirmedAt: new Date('2027-03-09T12:02:00.000Z'),
        reference: 'HRKEEP99',
      },
    );

    vi.setSystemTime(new Date('2027-03-13T01:00:00.000Z'));
    await expect(job.completeDueStays(new Date())).resolves.toBe(1);

    const completed = await reservations.findById(hold.reservationId).lean();
    expect(completed).toMatchObject({
      status: 'completed',
      reference: 'HRKEEP99',
      totalMinor: 20_000,
      currency: 'USD',
      completedAt: new Date('2027-03-13T01:00:00.000Z'),
      policySnapshot: {
        cancellationTiers: [{ daysBefore: 3, refundPercent: 50 }],
        checkInTime: '14:00',
        checkOutTime: '12:00',
      },
    });
    expect(completed?.rooms[0]).toMatchObject({
      roomName: '101',
      roomType: 'Double',
      pricePerNightMinor: 10_000,
      adults: 1,
      childAges: [8],
      subtotalMinor: 20_000,
    });
    expect(
      hotels.data.roomNights.filter(
        (n) =>
          n.kind === 'reservation' && n.reservationId === hold.reservationId,
      ),
    ).toHaveLength(2);
    expect(hotels.data.hotels[0].isActive).toBe(true);
    expect(hotels.data.rooms[0].isActive).toBe(true);
    expect(events.emitted).toEqual([]);
  });

  it('is idempotent on repeated runs and preserves original completedAt', async () => {
    const stay = await seedReservation({
      checkInDate: '2027-03-10',
      checkOutDate: '2027-03-12',
      reference: 'HRIDEMP1',
      confirmedAt: new Date('2027-03-01T10:05:00.000Z'),
    });
    const firstRunAt = new Date('2027-03-13T01:00:00.000Z');
    const secondRunAt = new Date('2027-03-13T02:00:00.000Z');

    await expect(job.completeDueStays(firstRunAt)).resolves.toBe(1);
    await expect(job.completeDueStays(secondRunAt)).resolves.toBe(0);

    expect(await reservations.findById(stay._id).lean()).toMatchObject({
      status: 'completed',
      completedAt: firstRunAt,
    });
  });

  it('handles concurrent job instances idempotently without duplicate transitions or error logs', async () => {
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const first = await seedReservation({
      checkInDate: '2027-03-01',
      checkOutDate: '2027-03-03',
      reference: 'HRCONC01',
    });
    const second = await seedReservation({
      checkInDate: '2027-03-04',
      checkOutDate: '2027-03-06',
      reference: 'HRCONC02',
    });
    const runAt = new Date('2027-03-10T01:00:00.000Z');

    const results = await Promise.allSettled([
      job.completeDueStays(runAt),
      job.completeDueStays(runAt),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const totalCompleted = results.reduce(
      (sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0),
      0,
    );
    expect(totalCompleted).toBe(2);
    expect(logged).not.toHaveBeenCalled();
    expect(await reservations.findById(first._id).lean()).toMatchObject({
      status: 'completed',
      completedAt: runAt,
    });
    expect(await reservations.findById(second._id).lean()).toMatchObject({
      status: 'completed',
      completedAt: runAt,
    });
  });

  it('lets only one transition succeed when completion races with cancellation or checkout changes', async () => {
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const stay = await seedReservation({
      checkInDate: '2027-03-01',
      checkOutDate: '2027-03-03',
      reference: 'HRRACE01',
    });
    const now = new Date('2027-03-10T01:00:00.000Z');

    await Promise.allSettled([
      transitionStatus(reservations, stay._id, 'confirmed', 'cancelled', {
        cancellation: {
          cancelledAt: now,
          cancelledBy: 'user',
          refundPercent: 0,
          refundAmountMinor: 0,
        },
      }),
      job.completeDueStays(now),
    ]);

    const finalDoc = await reservations.findById(stay._id).lean();
    expect(['completed', 'cancelled']).toContain(finalDoc?.status);
    if (finalDoc?.status === 'completed') {
      expect(finalDoc.completedAt).toEqual(now);
      expect(finalDoc.cancellation).toBeUndefined();
    } else {
      expect(finalDoc?.completedAt).toBeUndefined();
      expect(finalDoc?.cancellation?.cancelledBy).toBe('user');
    }
    expect(logged).not.toHaveBeenCalled();

    // Also test stale batch candidate whose checkOutDate moved to >= today before write.
    const moved = await seedReservation({
      checkInDate: '2027-03-10',
      checkOutDate: '2027-03-15',
      reference: 'HRMOVE01',
    });
    vi.spyOn(reservations, 'find').mockReturnValueOnce({
      sort: () => ({
        limit: () => ({
          lean: () => Promise.resolve([{ _id: moved._id }]),
        }),
      }),
    } as never);

    await expect(job.completeDueStays(now)).resolves.toBe(0);
    expect((await reservations.findById(moved._id).lean())?.status).toBe(
      'confirmed',
    );
    expect(logged).not.toHaveBeenCalled();
  });

  it('logs genuine failures and still completes eligible reservations in later batches', async () => {
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    for (let i = 0; i < 101; i += 1) {
      await seedReservation({
        checkInDate: '2027-03-01',
        checkOutDate: '2027-03-03',
        reference: `HRBT${String(i).padStart(4, '0')}`,
      });
    }

    const originalUpdateOne = reservations.updateOne.bind(reservations);
    let calls = 0;
    vi.spyOn(reservations, 'updateOne').mockImplementation(((
      ...args: Parameters<typeof originalUpdateOne>
    ) => {
      calls += 1;
      if (calls <= 100) {
        return Promise.reject(new Error('transient write failure'));
      }
      return originalUpdateOne(...args);
    }) as typeof reservations.updateOne);

    const runAt = new Date('2027-03-10T01:00:00.000Z');
    await expect(job.completeDueStays(runAt)).resolves.toBe(1);

    expect(calls).toBe(101);
    expect(logged).toHaveBeenCalledTimes(100);
    expect(await reservations.countDocuments({ status: 'completed' })).toBe(1);
    expect(await reservations.countDocuments({ status: 'confirmed' })).toBe(
      100,
    );
  });

  it('run() completes stays due at current UTC time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-15T01:00:00.000Z'));

    const due = await seedReservation({
      checkInDate: '2027-03-10',
      checkOutDate: '2027-03-12',
      reference: 'HRRUN001',
    });

    await job.run();

    expect(await reservations.findById(due._id).lean()).toMatchObject({
      status: 'completed',
      completedAt: new Date('2027-03-15T01:00:00.000Z'),
    });
  });
});
