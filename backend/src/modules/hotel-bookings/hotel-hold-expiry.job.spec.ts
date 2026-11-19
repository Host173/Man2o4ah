import { ConflictException, Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import { FakeRoomNightInventory } from '../../../test/fakes/room-night-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { FakeEvents } from '../../../test/support/fake-events.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { HotelsService } from '../hotels/hotels.service.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import { transitionStatus } from './booking-lifecycle.js';
import type { HotelHoldRequestDto } from './dto/hotel-hold.dto.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import { HotelHoldExpiryJob } from './hotel-hold-expiry.job.js';
import { HotelHoldService } from './hotel-hold.service.js';
import { HotelReservation } from './schemas/hotel-reservation.schema.js';

const HOTEL = '6553a1f0c2b4e8a9d0f1a601';
const ROOM_101 = '6553a1f0c2b4e8a9d0f1a602';
const ROOM_102 = '6553a1f0c2b4e8a9d0f1a603';
const USER = '6553a1f0c2b4e8a9d0f1a699';

const room = (id: string, name: string) => ({
  id,
  hotelId: HOTEL,
  name,
  type: 'Double',
  beds: 1,
  maxOccupancy: 2,
  pricePerNightMinor: 10_000,
  isActive: true,
  availability: [
    { fromDate: toDateOnly('2027-01-01'), toDate: toDateOnly('2027-12-31') },
  ],
  hasEverBeenReserved: false,
});

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
        cancellationPolicy: { tiers: [] },
        isActive: true,
        ratingSummary: { average: null, count: 0 },
      },
    ],
    rooms: [room(ROOM_101, '101'), room(ROOM_102, '102')],
    roomNights: [],
  });
}

/** A 2-night stay (the 10th to the 12th) in the given month, in room 101 by default. */
const stay = (month = '03', roomIds = [ROOM_101]): HotelHoldRequestDto => ({
  hotelId: HOTEL,
  checkInDate: `2027-${month}-10`,
  checkOutDate: `2027-${month}-12`,
  rooms: roomIds.map((roomId) => ({ roomId, adults: 1, childAges: [] })),
});

/** `ms` milliseconds after `date`. */
const plus = (date: Date, ms: number) => new Date(date.getTime() + ms);

describe('HotelHoldExpiryJob (HTL-18, GEN-11)', () => {
  let t: TestApp;
  let holds: HotelHoldService;
  let job: HotelHoldExpiryJob;
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
    job = t.moduleRef.get(HotelHoldExpiryJob);
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
    vi.restoreAllMocks();
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  const nightsOf = (reservationId: string) =>
    hotels.data.roomNights.filter(
      (n) => n.kind === 'reservation' && n.reservationId === reservationId,
    );
  const statusOf = async (id: string) =>
    (await reservations.findById(id).lean())?.status;

  it('expires a hold exactly at holdExpiresAt and releases its nights', async () => {
    const hold = await holds.hold(stay('03', [ROOM_101, ROOM_102]), USER);
    expect(nightsOf(hold.reservationId)).toHaveLength(4);

    await expect(job.expireDueHolds(hold.holdExpiresAt)).resolves.toBe(1);

    expect(
      await reservations.findById(hold.reservationId).lean(),
    ).toMatchObject({ status: 'expired', expiredAt: hold.holdExpiresAt });
    expect(nightsOf(hold.reservationId)).toHaveLength(0);
  });

  it('emits HotelReservationExpired once, after the change', async () => {
    const hold = await holds.hold(stay(), USER);
    await job.expireDueHolds(hold.holdExpiresAt);

    expect(events.payloadsOf(Events.HotelReservationExpired)).toEqual([
      { bookingId: hold.reservationId, userId: USER },
    ]);
  });

  it('leaves a hold alone 1 ms before it expires', async () => {
    const hold = await holds.hold(stay(), USER);

    await expect(
      job.expireDueHolds(plus(hold.holdExpiresAt, -1)),
    ).resolves.toBe(0);

    expect(await statusOf(hold.reservationId)).toBe('pending_payment');
    expect(nightsOf(hold.reservationId)).toHaveLength(2);
    expect(events.emitted).toEqual([]);
  });

  it('expires every due hold in one run, and only their nights', async () => {
    const first = await holds.hold(stay('03'), USER);
    await holds.hold(stay('04'), USER);
    await holds.hold(stay('05'), USER);

    await expect(
      job.expireDueHolds(plus(first.holdExpiresAt, 60_000)),
    ).resolves.toBe(3);
    expect(await reservations.countDocuments({ status: 'expired' })).toBe(3);
    expect(hotels.data.roomNights).toHaveLength(0);
  });

  it('never touches a reservation that is no longer pending', async () => {
    const hold = await holds.hold(stay(), USER);
    await transitionStatus(
      reservations,
      hold.reservationId,
      'pending_payment',
      'confirmed',
      { confirmedAt: new Date() },
    );

    await expect(
      job.expireDueHolds(plus(hold.holdExpiresAt, 60_000)),
    ).resolves.toBe(0);

    expect(await statusOf(hold.reservationId)).toBe('confirmed');
    expect(nightsOf(hold.reservationId)).toHaveLength(2);
  });

  it('is safe to run twice: no second event', async () => {
    const hold = await holds.hold(stay(), USER);
    await job.expireDueHolds(hold.holdExpiresAt);

    await expect(job.expireDueHolds(hold.holdExpiresAt)).resolves.toBe(0);

    expect(events.payloadsOf(Events.HotelReservationExpired)).toHaveLength(1);
  });

  it('lets exactly one of payment and expiry win when they race', async () => {
    const hold = await holds.hold(stay(), USER);

    // The webhook confirming (HTL-17) and the job expiring, at the same moment.
    await Promise.allSettled([
      transitionStatus(
        reservations,
        hold.reservationId,
        'pending_payment',
        'confirmed',
        { confirmedAt: new Date() },
      ),
      job.expireDueHolds(plus(hold.holdExpiresAt, 1)),
    ]);

    // Assert the invariant, never which one won.
    const status = await statusOf(hold.reservationId);
    expect(['confirmed', 'expired']).toContain(status);
    // Nights are released only if the expiry won.
    expect(nightsOf(hold.reservationId)).toHaveLength(
      status === 'expired' ? 0 : 2,
    );
    expect(events.payloadsOf(Events.HotelReservationExpired)).toHaveLength(
      status === 'expired' ? 1 : 0,
    );
  });

  describe('review #148', () => {
    let logged: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // These tests make releases fail on purpose; record the error logs quietly.
      logged = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });

    it('logs a release failure, even a 409, instead of treating it as a lost race', async () => {
      const hold = await holds.hold(stay(), USER);
      vi.spyOn(
        t.moduleRef.get(RoomNightInventory),
        'release',
      ).mockRejectedValueOnce(
        new ConflictException({
          code: ErrorCode.RoomsUnavailable,
          message: 'inventory conflict',
        }),
      );

      await expect(job.expireDueHolds(hold.holdExpiresAt)).resolves.toBe(0);

      expect(logged).toHaveBeenCalledTimes(1);
      // Rolled back with the failed release: still pending, nights still held.
      expect(await statusOf(hold.reservationId)).toBe('pending_payment');
      expect(nightsOf(hold.reservationId)).toHaveLength(2);
    });

    it('does not log a lost race (INVALID_STATUS_TRANSITION)', async () => {
      const hold = await holds.hold(stay(), USER);
      await transitionStatus(
        reservations,
        hold.reservationId,
        'pending_payment',
        'confirmed',
        { confirmedAt: new Date() },
      );
      // The job read the hold just before it was confirmed.
      vi.spyOn(reservations, 'find').mockReturnValueOnce({
        sort: () => ({
          limit: () => ({
            lean: () =>
              Promise.resolve([{ _id: hold.reservationId, userId: USER }]),
          }),
        }),
      } as never);

      await expect(job.expireDueHolds(hold.holdExpiresAt)).resolves.toBe(0);

      expect(logged).not.toHaveBeenCalled();
      expect(await statusOf(hold.reservationId)).toBe('confirmed');
    });

    it('does not get stuck behind 100 holds that keep failing', async () => {
      // 101 one-night holds of room 101, on 101 different nights.
      let last = await holds.hold(oneNight(0), USER);
      for (let day = 1; day < 101; day += 1) {
        last = await holds.hold(oneNight(day), USER);
      }

      // Releasing fails for the first 100 holds the job tries, then works.
      const inventory = t.moduleRef.get(RoomNightInventory);
      const release = inventory.release.bind(inventory);
      let calls = 0;
      vi.spyOn(inventory, 'release').mockImplementation(
        async (reservationId, options) => {
          calls += 1;
          if (calls <= 100) throw new Error('inventory down');
          return release(reservationId, options);
        },
      );

      await job.expireDueHolds(last.holdExpiresAt);

      // The 101st hold was still reached and expired in the same run.
      expect(calls).toBe(101);
      expect(await reservations.countDocuments({ status: 'expired' })).toBe(1);
      expect(
        await reservations.countDocuments({ status: 'pending_payment' }),
      ).toBe(100);
    });
  });
});

/** A one-night stay in room 101, `day` days after 1 June 2027. */
function oneNight(day: number): HotelHoldRequestDto {
  const checkIn = new Date(Date.UTC(2027, 5, 1 + day));
  const checkOut = new Date(Date.UTC(2027, 5, 2 + day));
  return {
    hotelId: HOTEL,
    checkInDate: checkIn.toISOString().slice(0, 10),
    checkOutDate: checkOut.toISOString().slice(0, 10),
    rooms: [{ roomId: ROOM_101, adults: 1, childAges: [] }],
  };
}
