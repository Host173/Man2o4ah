import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import { FakeHotelsService } from '../../../test/fakes/hotels.fake.js';
import type { HotelDataset } from '../../../test/fakes/hotels.fake.js';
import { FakeRoomNightInventory } from '../../../test/fakes/room-night-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { HotelsService } from '../hotels/hotels.service.js';
import type { HotelView, RoomView } from '../hotels/hotels.types.js';
import { RoomNightInventory } from '../hotels/room-night-inventory.js';
import type { HotelHoldRequestDto } from './dto/hotel-hold.dto.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import { HotelHoldService } from './hotel-hold.service.js';
import { HotelReservation } from './schemas/hotel-reservation.schema.js';

// Ids are stored as ObjectIds, so the fake hotels use real-looking ones.
const HOTEL = '6553a1f0c2b4e8a9d0f1f001';
const CLOSED_HOTEL = '6553a1f0c2b4e8a9d0f1f002';
const ROOM_101 = '6553a1f0c2b4e8a9d0f1f101';
const ROOM_102 = '6553a1f0c2b4e8a9d0f1f102';
const OTHER_HOTEL_ROOM = '6553a1f0c2b4e8a9d0f1f201';
const USER = '6553a1f0c2b4e8a9d0f1f099';

const hotelView = (id: string, isActive = true): HotelView => ({
  id,
  name: 'Nile View',
  address: '1 Corniche',
  cityId: 'cairo',
  countryCode: 'EG',
  photos: [],
  amenities: [],
  checkInTime: '15:00',
  checkOutTime: '11:00',
  cancellationPolicy: { tiers: [{ daysBefore: 3, refundPercent: 50 }] },
  isActive,
  ratingSummary: { average: null, count: 0 },
});

const roomView = (
  id: string,
  hotelId: string,
  name: string,
  pricePerNightMinor: number,
  maxOccupancy: number,
): RoomView => ({
  id,
  hotelId,
  name,
  type: 'Double',
  beds: 1,
  maxOccupancy,
  pricePerNightMinor,
  isActive: true,
  // Bookable all of 2027.
  availability: [
    { fromDate: toDateOnly('2027-01-01'), toDate: toDateOnly('2027-12-31') },
  ],
  hasEverBeenReserved: false,
});

function dataset(): HotelDataset {
  return {
    hotels: [hotelView(HOTEL), hotelView(CLOSED_HOTEL, false)],
    rooms: [
      roomView(ROOM_101, HOTEL, '101', 10_000, 2),
      roomView(ROOM_102, HOTEL, '102', 15_000, 4),
      roomView(OTHER_HOTEL_ROOM, CLOSED_HOTEL, '201', 9_000, 2),
    ],
    roomNights: [],
  };
}

/** A stay from 10 to 13 March 2027: three nights. */
const request = (
  changes: Partial<HotelHoldRequestDto> = {},
): HotelHoldRequestDto => ({
  hotelId: HOTEL,
  checkInDate: '2027-03-10',
  checkOutDate: '2027-03-13',
  rooms: [
    { roomId: ROOM_101, adults: 2, childAges: [] },
    { roomId: ROOM_102, adults: 1, childAges: [6, 9] },
  ],
  ...changes,
});

/** Matches a 400 VALIDATION_FAILED whose details include `field`. */
const invalid = (field: string) => ({
  status: 400,
  response: {
    code: 'VALIDATION_FAILED',
    details: expect.arrayContaining([expect.objectContaining({ field })]),
  },
});

const TEN_MINUTES = 10 * 60 * 1000;

describe('HotelHoldService.hold (HTL-16, HTL-18)', () => {
  let t: TestApp;
  let holds: HotelHoldService;
  let reservations: Model<HotelReservation>;
  // One fake of each, re-seeded before every test. The inventory reads the
  // hotels fake's data, so re-seeding the hotels fake resets both.
  const hotels = new FakeHotelsService();
  const inventory = new FakeRoomNightInventory(hotels);

  beforeAll(async () => {
    t = await createTestApp({
      imports: [HotelBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(HotelsService)
          .useValue(hotels)
          .overrideProvider(RoomNightInventory)
          .useValue(inventory),
    });
    holds = t.moduleRef.get(HotelHoldService);
    reservations = t.moduleRef.get<Model<HotelReservation>>(
      getModelToken(HotelReservation.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    Object.assign(hotels, new FakeHotelsService(dataset()));
    await clearCollections(t.connection);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  /** The nights the fake inventory holds for a reservation. */
  const nightsOf = (reservationId: string) =>
    hotels.data.roomNights.filter(
      (n) => n.kind === 'reservation' && n.reservationId === reservationId,
    );

  it('saves one pending_payment reservation with every snapshot', async () => {
    const hold = await holds.hold(request(), USER);

    const saved = await reservations.findById(hold.reservationId).lean();
    expect(saved).toMatchObject({
      status: 'pending_payment',
      checkInDate: toDateOnly('2027-03-10'),
      checkOutDate: toDateOnly('2027-03-13'),
      nights: 3,
      totalMinor: 3 * 10_000 + 3 * 15_000,
      currency: 'USD',
      policySnapshot: {
        cancellationTiers: [{ daysBefore: 3, refundPercent: 50 }],
        checkInTime: '15:00',
        checkOutTime: '11:00',
      },
    });
    expect(saved?.reference).toBeUndefined(); // set only on confirmation (HTL-17)
    expect(saved?.userId.toString()).toBe(USER);
    expect(saved?.hotelId.toString()).toBe(HOTEL);
    expect(saved?.rooms).toHaveLength(2);
    expect(saved?.rooms[1]).toMatchObject({
      roomName: '102',
      roomType: 'Double',
      pricePerNightMinor: 15_000,
      adults: 1,
      childAges: [6, 9],
      subtotalMinor: 45_000,
    });
    expect(saved?.rooms[1].roomId.toString()).toBe(ROOM_102);
  });

  it('returns the summary with the dates as YYYY-MM-DD', async () => {
    const hold = await holds.hold(request(), USER);

    expect(hold).toMatchObject({
      status: 'pending_payment',
      hotelId: HOTEL,
      hotelName: 'Nile View',
      checkInDate: '2027-03-10',
      checkOutDate: '2027-03-13',
      nights: 3,
      totalMinor: 75_000,
      currency: 'USD',
    });
    expect(hold.reservationId).toMatch(/^[0-9a-f]{24}$/);
    expect(hold.rooms.map((r) => r.subtotalMinor)).toEqual([30_000, 45_000]);
  });

  it('reserves every night of every room for this reservation', async () => {
    const hold = await holds.hold(request(), USER);
    // 2 rooms × 3 nights (the check-out night is free).
    expect(nightsOf(hold.reservationId)).toHaveLength(6);
  });

  it('expires the hold exactly 10 minutes after the reservation is created', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T09:00:00.000Z'));

    const hold = await holds.hold(request(), USER);

    // `timestamps: true` adds createdAt; the schema class doesn't declare it.
    const saved = await reservations
      .findById(hold.reservationId)
      .lean<HotelReservation & { createdAt: Date }>();
    const createdAt = new Date('2026-12-01T09:00:00.000Z');
    expect(saved?.createdAt).toEqual(createdAt);
    expect(saved?.holdExpiresAt).toEqual(
      new Date(createdAt.getTime() + TEN_MINUTES),
    );
    expect(hold.holdExpiresAt).toEqual(saved?.holdExpiresAt);
  });

  it('answers 409 ROOMS_UNAVAILABLE and saves nothing when one room is taken (HTL-18)', async () => {
    // Someone already has room 102 on the 12th.
    await holds.hold(
      request({
        checkInDate: '2027-03-12',
        checkOutDate: '2027-03-14',
        rooms: [{ roomId: ROOM_102, adults: 1, childAges: [] }],
      }),
      USER,
    );

    await expect(holds.hold(request(), USER)).rejects.toMatchObject({
      status: 409,
      response: { code: 'ROOMS_UNAVAILABLE' },
    });

    // The transaction rolled the new reservation back; room 101 wasn't held either.
    expect(await reservations.countDocuments()).toBe(1);
    expect(
      hotels.data.roomNights.filter((n) => n.roomId === ROOM_101),
    ).toHaveLength(0);
  });

  describe('invalid requests: 400, nothing touched', () => {
    it.each([
      [
        'an unknown hotel',
        request({ hotelId: '6553a1f0c2b4e8a9d0f1f0ff' }),
        'hotelId',
      ],
      [
        'an inactive hotel',
        request({
          hotelId: CLOSED_HOTEL,
          rooms: [{ roomId: OTHER_HOTEL_ROOM, adults: 1, childAges: [] }],
        }),
        'hotelId',
      ],
      [
        'a room of another hotel',
        request({
          rooms: [{ roomId: OTHER_HOTEL_ROOM, adults: 1, childAges: [] }],
        }),
        'rooms[0].roomId',
      ],
      [
        'too many guests in a room',
        request({ rooms: [{ roomId: ROOM_101, adults: 3, childAges: [] }] }),
        'rooms[0]',
      ],
      [
        'no adult at all',
        request({ rooms: [{ roomId: ROOM_101, adults: 0, childAges: [8] }] }),
        'rooms',
      ],
      [
        'a check-in in the past',
        request({ checkInDate: '2020-01-01' }),
        'checkInDate',
      ],
      [
        'a check-out before check-in',
        request({ checkOutDate: '2027-03-09' }),
        'checkOutDate',
      ],
      [
        'a date that does not exist',
        request({ checkInDate: '2027-02-30' }),
        'checkInDate',
      ],
    ])('%s', async (_label, body, field) => {
      await expect(holds.hold(body, USER)).rejects.toMatchObject(
        invalid(field),
      );
      expect(await reservations.countDocuments()).toBe(0);
      expect(hotels.data.roomNights).toHaveLength(0);
    });
  });

  it('lets exactly one of several overlapping holds on a room win', async () => {
    const sameRoom = request({
      rooms: [{ roomId: ROOM_101, adults: 1, childAges: [] }],
    });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => holds.hold(sameRoom, USER)),
    );

    // Assert the invariant, never which request won.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await reservations.countDocuments()).toBe(1);
    expect(
      hotels.data.roomNights.filter((n) => n.roomId === ROOM_101),
    ).toHaveLength(3);
  });

  // HTL-18: only an unexpired hold blocks a room; never assume the job already ran.
  describe('an overdue hold (review #148)', () => {
    const sameRoom = request({
      rooms: [{ roomId: ROOM_101, adults: 1, childAges: [] }],
    });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-12-01T09:00:00.000Z'));
    });

    it('no longer blocks its room: it is expired and released first', async () => {
      const old = await holds.hold(sameRoom, USER);
      // 11 minutes later, before the expiry job has run.
      vi.setSystemTime(new Date('2026-12-01T09:11:00.000Z'));

      const fresh = await holds.hold(sameRoom, USER);

      expect(fresh.status).toBe('pending_payment');
      expect(
        (await reservations.findById(old.reservationId).lean())?.status,
      ).toBe('expired');
      expect(nightsOf(old.reservationId)).toHaveLength(0);
      expect(nightsOf(fresh.reservationId)).toHaveLength(3);
    });

    it('still blocks while it is within its 10 minutes', async () => {
      await holds.hold(sameRoom, USER);
      vi.setSystemTime(new Date('2026-12-01T09:09:59.999Z'));

      await expect(holds.hold(sameRoom, USER)).rejects.toMatchObject({
        status: 409,
        response: { code: 'ROOMS_UNAVAILABLE' },
      });
    });

    it('leaves overdue holds of other rooms alone', async () => {
      const other = await holds.hold(
        request({ rooms: [{ roomId: ROOM_102, adults: 1, childAges: [] }] }),
        USER,
      );
      vi.setSystemTime(new Date('2026-12-01T09:11:00.000Z'));

      await holds.hold(sameRoom, USER);

      // The expiry job will deal with it; the hold only frees what it needs.
      expect(
        (await reservations.findById(other.reservationId).lean())?.status,
      ).toBe('pending_payment');
    });
  });
});
