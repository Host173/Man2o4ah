import { toDateOnly } from '../../src/common/dates/date-only.js';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type {
  HotelSearchQuery,
  HotelView,
  RoomView,
} from '../../src/modules/hotels/hotels.types.js';
import { FakeHotelsService, FakeRoomNightInventory } from './index.js';

const checkIn = toDateOnly('2026-11-15');
const checkOut = toDateOnly('2026-11-17');
const ids = {
  hotel1: 'aaaaaaaaaaaaaaaaaaaaaaa1',
  hotel2: 'aaaaaaaaaaaaaaaaaaaaaaa2',
  room1: 'bbbbbbbbbbbbbbbbbbbbbbb1',
  room2: 'bbbbbbbbbbbbbbbbbbbbbbb2',
  room3: 'bbbbbbbbbbbbbbbbbbbbbbb3',
  reservation1: 'ccccccccccccccccccccccc1',
  reservation2: 'ccccccccccccccccccccccc2',
  reservation3: 'ccccccccccccccccccccccc3',
  missing: 'ddddddddddddddddddddddd1',
};

function hotel(id: string, overrides: Partial<HotelView> = {}): HotelView {
  return {
    id,
    name: id,
    address: '1 Test Street',
    cityId: 'cairo',
    countryCode: 'EG',
    photos: [],
    amenities: [],
    checkInTime: '14:00',
    checkOutTime: '12:00',
    cancellationPolicy: { tiers: [{ daysBefore: 7, refundPercent: 100 }] },
    isActive: true,
    ratingSummary: { average: null, count: 0 },
    ...overrides,
  };
}

function room(id: string, overrides: Partial<RoomView> = {}): RoomView {
  return {
    id,
    hotelId: ids.hotel1,
    name: id,
    type: 'Double',
    beds: 1,
    maxOccupancy: 2,
    pricePerNightMinor: 10000,
    isActive: true,
    availability: [
      {
        fromDate: toDateOnly('2026-11-12'),
        toDate: toDateOnly('2026-11-30'),
      },
    ],
    hasEverBeenReserved: false,
    ...overrides,
  };
}

let hotels: FakeHotelsService;
let inventory: FakeRoomNightInventory;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  hotels = new FakeHotelsService({
    hotels: [hotel(ids.hotel1)],
    rooms: [room(ids.room1), room(ids.room2)],
  });
  inventory = new FakeRoomNightInventory(hotels);
});

afterEach(() => vi.useRealTimers());

describe('FakeHotelsService', () => {
  const query: HotelSearchQuery = {
    cityId: 'cairo',
    checkIn,
    checkOut,
    guests: 2,
  };

  it('returns detached hotel data, including booking policies, and null for a missing hotel', async () => {
    const found = await hotels.getHotel(ids.hotel1);
    expect(found?.cancellationPolicy.tiers).toEqual([
      { daysBefore: 7, refundPercent: 100 },
    ]);
    if (!found) throw new Error('Expected fixture hotel');
    found.cancellationPolicy.tiers.length = 0;
    expect(
      (await hotels.getHotel(ids.hotel1))?.cancellationPolicy.tiers,
    ).toHaveLength(1);
    expect(await hotels.getHotel('missing')).toBeNull();
  });

  it('includes inactive rooms for booking validation, scoped to the hotel', async () => {
    await inventory.deactivate(ids.room1);
    expect(await hotels.getRooms(ids.hotel1)).toEqual([
      expect.objectContaining({ id: ids.room1, isActive: false }),
      expect.objectContaining({ id: ids.room2, isActive: true }),
    ]);
    expect(await hotels.getRooms('missing')).toEqual([]);
  });

  it('exposes reservations and blocks over inclusive dates without exposing other hotels', async () => {
    await inventory.reserve(
      ids.hotel1,
      [ids.room1],
      checkIn,
      checkOut,
      ids.reservation1,
    );
    await inventory.block(ids.room2, checkIn, checkIn);
    const nights = await hotels.getRoomNights(ids.hotel1, checkIn, checkIn);
    expect(nights).toEqual([
      expect.objectContaining({
        kind: 'reservation',
        roomId: ids.room1,
        reservationId: ids.reservation1,
        date: checkIn,
      }),
      expect.objectContaining({
        kind: 'blocked',
        roomId: ids.room2,
        date: checkIn,
      }),
    ]);
    expect(await hotels.getRoomNights('missing', checkIn, checkOut)).toEqual(
      [],
    );
  });

  it('searches only active hotels with enough free rooms and capacity for the entire stay', async () => {
    expect((await hotels.search({ ...query, rooms: 2, guests: 4 })).total).toBe(
      1,
    );
    expect((await hotels.search({ ...query, rooms: 1, guests: 3 })).total).toBe(
      0,
    );
    expect((await hotels.search({ ...query, rooms: 3 })).total).toBe(0);
    await inventory.reserve(
      ids.hotel1,
      [ids.room1],
      checkIn,
      checkOut,
      ids.reservation1,
    );
    expect((await hotels.search({ ...query, rooms: 2 })).total).toBe(0);
    await inventory.block(
      ids.room2,
      toDateOnly('2026-11-16'),
      toDateOnly('2026-11-16'),
    );
    expect((await hotels.search(query)).total).toBe(0);
  });

  it('reflects provider activation without deleting existing reservations', async () => {
    await inventory.reserve(
      ids.hotel1,
      [ids.room1],
      checkIn,
      checkOut,
      ids.reservation1,
    );
    await hotels.setActive(ids.hotel1, false);
    expect((await hotels.search(query)).total).toBe(0);
    expect(await hotels.getHotel(ids.hotel1)).toMatchObject({
      isActive: false,
    });
    expect(
      await hotels.getRoomNights(ids.hotel1, checkIn, checkOut),
    ).toHaveLength(2);
    await hotels.setActive(ids.hotel1, true);
    expect((await hotels.search(query)).total).toBe(1);
  });

  it('filters by location, inclusive nightly price, and updated rating; unrated hotels are excluded by rating filters', async () => {
    expect(
      (
        await hotels.search({
          ...query,
          minPriceMinor: 10000,
          maxPriceMinor: 10000,
        })
      ).total,
    ).toBe(1);
    expect(
      (await hotels.search({ ...query, minPriceMinor: 10001 })).total,
    ).toBe(0);
    expect((await hotels.search({ ...query, maxPriceMinor: 9999 })).total).toBe(
      0,
    );
    expect((await hotels.search({ ...query, minRating: 1 })).total).toBe(0);
    await hotels.setRatingSummary(ids.hotel1, { average: 4.5, count: 2 });
    expect((await hotels.search({ ...query, minRating: 4.5 })).total).toBe(1);
    expect((await hotels.search({ ...query, minRating: 5 })).total).toBe(0);
    expect((await hotels.search({ ...query, cityId: 'dubai' })).total).toBe(0);
    expect(
      (await hotels.search({ ...query, cityId: undefined, countryCode: 'EG' }))
        .total,
    ).toBe(1);
    expect(
      (await hotels.search({ ...query, cityId: undefined, countryCode: 'AE' }))
        .total,
    ).toBe(0);
  });

  it('sorts and paginates qualifying hotels using the shared response shape', async () => {
    hotels.data.hotels.push(
      hotel(ids.hotel2, { ratingSummary: { average: 5, count: 1 } }),
    );
    hotels.data.rooms.push(
      room(ids.room3, { hotelId: ids.hotel2, pricePerNightMinor: 5000 }),
    );
    const result = await hotels.search({
      ...query,
      sortBy: 'price',
      page: 2,
      limit: 1,
    });
    expect(result).toMatchObject({
      total: 2,
      page: 2,
      limit: 1,
      totalPages: 2,
    });
    expect(result.items.map((item) => item.id)).toEqual([ids.hotel1]);
    const rated = await hotels.search({
      ...query,
      sortBy: 'rating',
      sortOrder: 'desc',
    });
    expect(rated.items.map((item) => item.id)).toEqual([
      ids.hotel2,
      ids.hotel1,
    ]);
  });

  it.each([
    { checkIn: toDateOnly('2026-11-11') },
    { checkOut: checkIn },
    { checkIn: new Date('2026-11-15T12:00:00Z') },
    { cityId: undefined },
    { guests: 0 },
    { rooms: 0 },
    { limit: 51 },
    { minPriceMinor: 200, maxPriceMinor: 100 },
  ])('rejects invalid search input: %o', async (changes) => {
    await expect(hotels.search({ ...query, ...changes })).rejects.toMatchObject(
      {
        response: { code: ErrorCode.ValidationFailed },
      },
    );
  });

  it('reports missing hotels when updating activation or ratings', async () => {
    await expect(hotels.setActive('missing', false)).rejects.toMatchObject({
      response: { code: ErrorCode.NotFound },
    });
    await expect(
      hotels.setRatingSummary('missing', { average: null, count: 0 }),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.NotFound },
    });
  });
});

describe('FakeRoomNightInventory', () => {
  it.each([
    {
      hotelId: 'invalid',
      roomIds: [ids.room1],
      reservationId: ids.reservation1,
    },
    {
      hotelId: ids.hotel1,
      roomIds: ['invalid'],
      reservationId: ids.reservation1,
    },
    { hotelId: ids.hotel1, roomIds: [ids.room1], reservationId: 'nope' },
  ])(
    'rejects invalid reservation identifiers without changing inventory: %j',
    async (input) => {
      await expect(
        inventory.reserve(
          input.hotelId,
          input.roomIds,
          checkIn,
          checkOut,
          input.reservationId,
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: ErrorCode.ValidationFailed },
      });
      expect(hotels.data.roomNights).toEqual([]);
      expect(hotels.data.rooms.every((room) => !room.hasEverBeenReserved)).toBe(
        true,
      );
    },
  );

  it('rejects the same room selected in different letter cases', async () => {
    await expect(
      inventory.reserve(
        ids.hotel1,
        [ids.room1, ids.room1.toUpperCase()],
        checkIn,
        checkOut,
        ids.reservation1,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: ErrorCode.ValidationFailed },
    });
    expect(hotels.data.roomNights).toEqual([]);
    expect(hotels.data.rooms.every((room) => !room.hasEverBeenReserved)).toBe(
      true,
    );
  });

  it.each([
    ['release', () => inventory.release('bad')],
    ['block', () => inventory.block('bad', checkIn, checkOut)],
    ['unblock', () => inventory.unblock('bad')],
    ['setAvailability', () => inventory.setAvailability('bad', [])],
    ['deactivate', () => inventory.deactivate('bad')],
    ['delete', () => inventory.delete('bad')],
  ] as const)(
    'rejects an invalid identifier for %s',
    async (_operation, call) => {
      await expect(call()).rejects.toMatchObject({
        status: 400,
        response: { code: ErrorCode.ValidationFailed },
      });
      expect(hotels.data.roomNights).toEqual([]);
      expect(hotels.data.rooms).toHaveLength(2);
    },
  );

  it('uses canonical IDs across reservations, releases and moderator operations', async () => {
    await inventory.reserve(
      ids.hotel1.toUpperCase(),
      [ids.room1.toUpperCase()],
      checkIn,
      checkOut,
      ids.reservation1.toUpperCase(),
    );
    expect(hotels.data.roomNights).toEqual([
      expect.objectContaining({
        hotelId: ids.hotel1,
        roomId: ids.room1,
        reservationId: ids.reservation1,
      }),
      expect.objectContaining({
        hotelId: ids.hotel1,
        roomId: ids.room1,
        reservationId: ids.reservation1,
      }),
    ]);
    await inventory.release(ids.reservation1.toUpperCase());
    const blockId = await inventory.block(
      ids.room1.toUpperCase(),
      checkIn,
      checkOut,
    );
    await inventory.unblock(blockId.toUpperCase());
    await inventory.setAvailability(ids.room1.toUpperCase(), []);
    await inventory.deactivate(ids.room1.toUpperCase());
    await inventory.delete(ids.room2.toUpperCase());
    expect(hotels.data.roomNights).toEqual([]);
    expect(hotels.data.rooms).toEqual([
      expect.objectContaining({
        id: ids.room1,
        isActive: false,
        availability: [],
      }),
    ]);
  });

  it('reserves every selected room for check-in through check-out minus one night', async () => {
    await inventory.reserve(
      ids.hotel1,
      [ids.room1, ids.room2],
      checkIn,
      checkOut,
      ids.reservation1,
    );
    const nights = await hotels.getRoomNights(ids.hotel1, checkIn, checkOut);
    expect(nights).toHaveLength(4);
    expect(
      nights.every((night) => night.date >= checkIn && night.date < checkOut),
    ).toBe(true);
    expect(
      (await hotels.getRooms(ids.hotel1)).every(
        (item) => item.hasEverBeenReserved,
      ),
    ).toBe(true);
  });

  it('rejects an overlapping reservation without holding any other requested room', async () => {
    await inventory.reserve(
      ids.hotel1,
      [ids.room1],
      checkIn,
      checkOut,
      ids.reservation1,
    );
    await expect(
      inventory.reserve(
        ids.hotel1,
        [ids.room2, ids.room1],
        checkIn,
        checkOut,
        ids.reservation2,
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.RoomsUnavailable } });
    expect(
      await hotels.getRoomNights(ids.hotel1, checkIn, checkOut),
    ).toHaveLength(2);
    expect(
      (await hotels.getRooms(ids.hotel1)).find((item) => item.id === ids.room2)
        ?.hasEverBeenReserved,
    ).toBe(false);
  });

  it('allows a new stay starting on the previous stay checkout date', async () => {
    await inventory.reserve(
      ids.hotel1,
      [ids.room1],
      checkIn,
      checkOut,
      ids.reservation1,
    );
    await inventory.reserve(
      ids.hotel1,
      [ids.room1],
      checkOut,
      toDateOnly('2026-11-18'),
      ids.reservation2,
    );
    expect(hotels.data.roomNights).toHaveLength(3);
  });

  it('allows exactly one of two simultaneous overlapping requests', async () => {
    const results = await Promise.allSettled(
      [ids.reservation1, ids.reservation2].map((id) =>
        inventory.reserve(ids.hotel1, [ids.room1], checkIn, checkOut, id),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(hotels.data.roomNights).toHaveLength(2);
  });

  it.each(['missing', 'inactive', 'other hotel', 'outside availability'])(
    'rejects a room that is %s',
    async (scenario) => {
      if (scenario === 'inactive') await inventory.deactivate(ids.room1);
      if (scenario === 'other hotel') hotels.data.rooms[0].hotelId = ids.hotel2;
      if (scenario === 'outside availability') {
        await inventory.setAvailability(ids.room1, [
          { fromDate: checkIn, toDate: checkIn },
        ]);
      }
      await expect(
        inventory.reserve(
          ids.hotel1,
          [scenario === 'missing' ? ids.missing : ids.room1],
          checkIn,
          checkOut,
          ids.reservation1,
        ),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.RoomsUnavailable },
      });
      expect(hotels.data.roomNights).toEqual([]);
    },
  );

  it('rejects reservations in inactive hotels', async () => {
    await hotels.setActive(ids.hotel1, false);
    await expect(
      inventory.reserve(
        ids.hotel1,
        [ids.room1],
        checkIn,
        checkOut,
        ids.reservation1,
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.RoomsUnavailable } });
  });

  it.each([{ roomIds: [] }, { roomIds: [ids.room1, ids.room1] }])(
    'rejects empty or repeated room selections: %j',
    async ({ roomIds }) => {
      await expect(
        inventory.reserve(
          ids.hotel1,
          roomIds,
          checkIn,
          checkOut,
          ids.reservation1,
        ),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.ValidationFailed },
      });
    },
  );

  it.each([
    [checkIn, checkIn],
    [checkOut, checkIn],
    [toDateOnly('2026-11-11'), checkOut],
    [new Date('invalid'), checkOut],
    [new Date('2026-11-15T01:00:00Z'), checkOut],
  ])('rejects invalid stay dates: %s to %s', async (from, to) => {
    await expect(
      inventory.reserve(ids.hotel1, [ids.room1], from, to, ids.reservation1),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    expect(hotels.data.roomNights).toEqual([]);
  });

  it('releases only the selected reservation, is repeatable, and leaves room history and blocks intact', async () => {
    await inventory.reserve(
      ids.hotel1,
      [ids.room1],
      checkIn,
      checkOut,
      ids.reservation1,
    );
    await inventory.reserve(
      ids.hotel1,
      [ids.room2],
      checkIn,
      checkOut,
      ids.reservation2,
    );
    await inventory.block(ids.room1, checkOut, checkOut);
    await inventory.release(ids.reservation1);
    await inventory.release(ids.reservation1);
    expect(hotels.data.roomNights).toHaveLength(3);
    expect((await hotels.getRooms(ids.hotel1))[0].hasEverBeenReserved).toBe(
      true,
    );
    await inventory.reserve(
      ids.hotel1,
      [ids.room1],
      checkIn,
      checkOut,
      ids.reservation3,
    );
  });

  it('blocks inclusive nights and rejects overlaps with either reservations or blocks atomically', async () => {
    const blockId = await inventory.block(
      ids.room1,
      checkIn,
      toDateOnly('2026-11-16'),
    );
    expect(hotels.data.roomNights).toHaveLength(2);
    await expect(
      inventory.reserve(
        ids.hotel1,
        [ids.room1],
        checkIn,
        checkOut,
        ids.reservation1,
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.RoomsUnavailable } });
    await expect(
      inventory.block(ids.room1, toDateOnly('2026-11-16'), checkOut),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.OverlapsReservationOrBlock },
    });
    expect(hotels.data.roomNights).toHaveLength(2);
    await inventory.unblock(blockId);
    await inventory.unblock(blockId);
    await inventory.reserve(
      ids.hotel1,
      [ids.room1],
      checkIn,
      checkOut,
      ids.reservation1,
    );
    await expect(
      inventory.block(ids.room1, checkIn, checkOut),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.OverlapsReservationOrBlock },
    });
    expect(hotels.data.roomNights).toHaveLength(2);
  });

  it('normalizes adjacent availability ranges, rejecting overlaps without changing existing availability', async () => {
    await inventory.setAvailability(ids.room1, [
      { fromDate: checkOut, toDate: checkOut },
      { fromDate: checkIn, toDate: toDateOnly('2026-11-16') },
    ]);
    expect((await hotels.getRooms(ids.hotel1))[0].availability).toEqual([
      { fromDate: checkIn, toDate: checkOut },
    ]);
    await expect(
      inventory.setAvailability(ids.room1, [
        { fromDate: checkIn, toDate: checkOut },
        { fromDate: checkOut, toDate: checkOut },
      ]),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    expect((await hotels.getRooms(ids.hotel1))[0].availability).toEqual([
      { fromDate: checkIn, toDate: checkOut },
    ]);
  });

  it('protects reserved nights when editing, deactivating, or deleting a room', async () => {
    await inventory.reserve(
      ids.hotel1,
      [ids.room1],
      checkIn,
      checkOut,
      ids.reservation1,
    );
    await expect(
      inventory.setAvailability(ids.room1, []),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.AvailabilityHasReservations },
    });
    await expect(inventory.deactivate(ids.room1)).rejects.toMatchObject({
      response: { code: ErrorCode.RoomHasReservations },
    });
    await expect(inventory.delete(ids.room1)).rejects.toMatchObject({
      response: { code: ErrorCode.RoomHasReservations },
    });
    await inventory.release(ids.reservation1);
    await inventory.setAvailability(ids.room1, []);
    await inventory.deactivate(ids.room1);
    await expect(inventory.delete(ids.room1)).rejects.toMatchObject({
      response: { code: ErrorCode.RoomWasReserved },
    });
  });

  it('protects today in UTC, but permits availability changes and deactivation after reserved nights have passed', async () => {
    const today = toDateOnly('2026-11-12');
    await inventory.reserve(
      ids.hotel1,
      [ids.room1],
      today,
      toDateOnly('2026-11-13'),
      ids.reservation1,
    );
    await expect(inventory.deactivate(ids.room1)).rejects.toMatchObject({
      response: { code: ErrorCode.RoomHasReservations },
    });
    vi.setSystemTime(new Date('2026-11-13T00:00:00Z'));
    await inventory.setAvailability(ids.room1, []);
    await inventory.deactivate(ids.room1);
    await expect(inventory.delete(ids.room1)).rejects.toMatchObject({
      response: { code: ErrorCode.RoomWasReserved },
    });
  });

  it('deletes never-reserved rooms and their blocks, without deleting another room', async () => {
    await inventory.block(ids.room1, checkIn, checkOut);
    await inventory.delete(ids.room1);
    expect(await hotels.getRooms(ids.hotel1)).toEqual([
      expect.objectContaining({ id: ids.room2 }),
    ]);
    expect(hotels.data.roomNights).toEqual([]);
  });

  it('reports missing rooms rather than pretending that updates succeeded', async () => {
    for (const call of [
      () => inventory.block(ids.missing, checkIn, checkOut),
      () => inventory.setAvailability(ids.missing, []),
      () => inventory.deactivate(ids.missing),
      () => inventory.delete(ids.missing),
    ]) {
      await expect(call()).rejects.toMatchObject({
        response: { code: ErrorCode.NotFound },
      });
    }
  });
});
