import { toDateOnly } from '../../src/common/dates/date-only.js';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import type {
  HotelSearchQuery,
  HotelView,
  RoomView,
} from '../../src/modules/hotels/hotels.types.js';
import { FakeHotelsService, FakeRoomNightInventory } from './index.js';
import { FakeReferenceDataService } from './reference-data.fake.js';
import { FakeStorageService } from './storage.fake.js';

const checkIn = toDateOnly('2026-11-15');
const checkOut = toDateOnly('2026-11-17');
const HOTEL_ID = '507f1f77bcf86cd799439011';
const OTHER_HOTEL_ID = '507f1f77bcf86cd799439012';
const MISSING_HOTEL_ID = '507f1f77bcf86cd799439013';

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
    hotelId: HOTEL_ID,
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
    hotels: [hotel(HOTEL_ID)],
    rooms: [room('room-1'), room('room-2')],
  });
  inventory = new FakeRoomNightInventory(hotels);
});

afterEach(() => vi.useRealTimers());

describe('FakeHotelsService', () => {
  it('rejects malformed hotel IDs with the same validation errors as the real service', async () => {
    const calls = [
      () => hotels.getHotel('invalid'),
      () => hotels.update('invalid', {}, 'invalid'),
      () => hotels.addPhoto('invalid', undefined, 'invalid'),
      () => hotels.removePhoto('invalid', 'invalid', 'invalid'),
      () => hotels.setActive('invalid', false),
      () => hotels.setRatingSummary('invalid', { average: null, count: 0 }),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({
        status: 400,
        response: {
          code: ErrorCode.ValidationFailed,
          details: [{ field: 'hotelId', message: expect.any(String) }],
        },
      });
    }
  });

  it('normalizes valid ObjectIds without confusing malformed and missing hotel IDs', async () => {
    expect(await hotels.getHotel(HOTEL_ID.toUpperCase())).toEqual(
      await hotels.getHotel(HOTEL_ID),
    );
    expect(await hotels.getHotel(MISSING_HOTEL_ID)).toBeNull();
    expect(await hotels.update(HOTEL_ID.toUpperCase(), {}, HOTEL_ID)).toEqual(
      await hotels.getHotel(HOTEL_ID),
    );
  });

  it('stores detached photo views, enforces five under concurrency, and removes files', async () => {
    const storage = new FakeStorageService();
    const fake = new FakeHotelsService(
      { hotels: [hotel(HOTEL_ID)] },
      new FakeReferenceDataService(),
      storage,
    );
    const image = {
      buffer: Buffer.from('image'),
      originalname: 'hotel.jpg',
      mimetype: 'image/jpeg',
      size: 5,
    };
    const results = await Promise.allSettled(
      Array.from({ length: 7 }, () => fake.addPhoto(HOTEL_ID, image, HOTEL_ID)),
    );
    const successful = results.filter(
      (result) => result.status === 'fulfilled',
    );
    expect(successful).toHaveLength(5);
    for (const result of results) {
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({
          status: 400,
          response: { code: ErrorCode.LimitExceeded },
        });
    }
    const photos = (await fake.getHotel(HOTEL_ID))!.photos;
    expect(photos).toHaveLength(5);
    expect(storage.keys().sort()).toEqual(
      photos.map((photo) => photo.key).sort(),
    );
    successful[0]!.value.photos.length = 0;
    expect((await fake.getHotel(HOTEL_ID))!.photos).toHaveLength(5);
    await fake.removePhoto(HOTEL_ID, photos[0]!.id, HOTEL_ID);
    expect(storage.has(photos[0]!.key)).toBe(false);
    expect((await fake.getHotel(HOTEL_ID))!.photos).toHaveLength(4);
    expect(
      (await fake.addPhoto(HOTEL_ID, image, HOTEL_ID)).photos,
    ).toHaveLength(5);
  });

  it('applies photo scope and validation before changing stored data', async () => {
    const image = {
      buffer: Buffer.from('image'),
      originalname: 'hotel.jpg',
      mimetype: 'image/jpeg',
      size: 5,
    };
    const photo = (await hotels.addPhoto(HOTEL_ID, image, HOTEL_ID)).photos[0]!;
    await expect(
      hotels.addPhoto(HOTEL_ID, image, undefined),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    await expect(
      hotels.removePhoto(HOTEL_ID, photo.id, OTHER_HOTEL_ID),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    await expect(
      hotels.addPhoto(HOTEL_ID, undefined, HOTEL_ID),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    await expect(
      hotels.addPhoto(
        HOTEL_ID,
        { ...image, mimetype: 'application/pdf' },
        HOTEL_ID,
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    await expect(
      hotels.removePhoto(HOTEL_ID, 'invalid', HOTEL_ID),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    await hotels.removePhoto(HOTEL_ID, photo.id, HOTEL_ID);
    await expect(
      hotels.removePhoto(HOTEL_ID, photo.id, HOTEL_ID),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
  });

  it('creates hotel profiles with reference-derived countries and detached defaults', async () => {
    const created = await hotels.create({
      name: '  Dubai Hotel  ',
      address: '  1 Test Street  ',
      cityId: 'dubai',
      description: 'A new hotel',
      starRating: 5,
      amenities: ['  Pool  '],
    });
    expect(created).toMatchObject({
      name: 'Dubai Hotel',
      address: '1 Test Street',
      cityId: 'dubai',
      countryCode: 'AE',
      description: 'A new hotel',
      starRating: 5,
      amenities: ['Pool'],
      photos: [],
      cancellationPolicy: { tiers: [] },
      isActive: true,
      ratingSummary: { average: null, count: 0 },
    });
    created.amenities.length = 0;
    expect((await hotels.getHotel(created.id))?.amenities).toEqual(['Pool']);
    const minimal = await hotels.create({
      name: 'Minimal',
      address: 'Address',
      cityId: 'cairo',
    });
    expect(minimal.amenities).toEqual([]);
    expect(minimal).not.toHaveProperty('description');
    expect(minimal).not.toHaveProperty('starRating');
  });

  it('updates only supplied profile fields and derives the new country', async () => {
    const previous = await hotels.getHotel(HOTEL_ID);
    const updated = await hotels.update(
      HOTEL_ID,
      {
        name: '  Edited  ',
        address: '  New Address  ',
        cityId: 'dubai',
        description: '',
        starRating: 4,
        amenities: ['  Wi-Fi  '],
      },
      HOTEL_ID,
    );
    expect(updated).toEqual({
      ...previous,
      name: 'Edited',
      address: 'New Address',
      cityId: 'dubai',
      countryCode: 'AE',
      description: '',
      starRating: 4,
      amenities: ['Wi-Fi'],
    });
    expect(await hotels.update(HOTEL_ID, {}, HOTEL_ID)).toEqual(updated);
    await hotels.update(HOTEL_ID, { amenities: [] }, HOTEL_ID);
    updated.amenities.push('Detached');
    expect((await hotels.getHotel(HOTEL_ID))?.amenities).toEqual([]);
  });

  it('rejects unassigned hotel edits and unknown cities without partial changes', async () => {
    const previous = await hotels.getHotel(HOTEL_ID);
    await expect(
      hotels.update(HOTEL_ID, { name: 'Forbidden' }, OTHER_HOTEL_ID),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    await expect(
      hotels.update(MISSING_HOTEL_ID, {}, MISSING_HOTEL_ID),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    await expect(
      hotels.update(HOTEL_ID, { name: 'Invalid', cityId: 'missing' }, HOTEL_ID),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    await expect(
      hotels.create({ name: 'Invalid', address: 'Address', cityId: 'missing' }),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    expect(await hotels.getHotel(HOTEL_ID)).toEqual(previous);
    expect(hotels.data.hotels).toHaveLength(1);
  });

  const query: HotelSearchQuery = {
    cityId: 'cairo',
    checkIn,
    checkOut,
    guests: 2,
  };

  it('returns detached hotel data, including booking policies, and null for a missing hotel', async () => {
    const found = await hotels.getHotel(HOTEL_ID);
    expect(found?.cancellationPolicy.tiers).toEqual([
      { daysBefore: 7, refundPercent: 100 },
    ]);
    if (!found) throw new Error('Expected fixture hotel');
    found.cancellationPolicy.tiers.length = 0;
    expect(
      (await hotels.getHotel(HOTEL_ID))?.cancellationPolicy.tiers,
    ).toHaveLength(1);
    expect(await hotels.getHotel(MISSING_HOTEL_ID)).toBeNull();
  });

  it('includes inactive rooms for booking validation, scoped to the hotel', async () => {
    await inventory.deactivate('room-1');
    expect(await hotels.getRooms(HOTEL_ID)).toEqual([
      expect.objectContaining({ id: 'room-1', isActive: false }),
      expect.objectContaining({ id: 'room-2', isActive: true }),
    ]);
    expect(await hotels.getRooms('missing')).toEqual([]);
  });

  it('exposes reservations and blocks over inclusive dates without exposing other hotels', async () => {
    await inventory.reserve(
      HOTEL_ID,
      ['room-1'],
      checkIn,
      checkOut,
      'reservation-1',
    );
    await inventory.block('room-2', checkIn, checkIn);
    const nights = await hotels.getRoomNights(HOTEL_ID, checkIn, checkIn);
    expect(nights).toEqual([
      expect.objectContaining({
        kind: 'reservation',
        roomId: 'room-1',
        reservationId: 'reservation-1',
        date: checkIn,
      }),
      expect.objectContaining({
        kind: 'blocked',
        roomId: 'room-2',
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
      HOTEL_ID,
      ['room-1'],
      checkIn,
      checkOut,
      'reservation-1',
    );
    expect((await hotels.search({ ...query, rooms: 2 })).total).toBe(0);
    await inventory.block(
      'room-2',
      toDateOnly('2026-11-16'),
      toDateOnly('2026-11-16'),
    );
    expect((await hotels.search(query)).total).toBe(0);
  });

  it('reflects provider activation without deleting existing reservations', async () => {
    await inventory.reserve(
      HOTEL_ID,
      ['room-1'],
      checkIn,
      checkOut,
      'reservation-1',
    );
    await hotels.setActive(HOTEL_ID, false);
    expect((await hotels.search(query)).total).toBe(0);
    expect(await hotels.getHotel(HOTEL_ID)).toMatchObject({ isActive: false });
    expect(
      await hotels.getRoomNights(HOTEL_ID, checkIn, checkOut),
    ).toHaveLength(2);
    await hotels.setActive(HOTEL_ID, true);
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
    await hotels.setRatingSummary(HOTEL_ID, { average: 4.5, count: 2 });
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
      hotel(OTHER_HOTEL_ID, { ratingSummary: { average: 5, count: 1 } }),
    );
    hotels.data.rooms.push(
      room('room-3', { hotelId: OTHER_HOTEL_ID, pricePerNightMinor: 5000 }),
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
    expect(result.items.map((item) => item.id)).toEqual([HOTEL_ID]);
    const rated = await hotels.search({
      ...query,
      sortBy: 'rating',
      sortOrder: 'desc',
    });
    expect(rated.items.map((item) => item.id)).toEqual([
      OTHER_HOTEL_ID,
      HOTEL_ID,
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
    await expect(
      hotels.setActive(MISSING_HOTEL_ID, false),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.NotFound },
    });
    await expect(
      hotels.setRatingSummary(MISSING_HOTEL_ID, { average: null, count: 0 }),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.NotFound },
    });
  });
});

describe('FakeRoomNightInventory', () => {
  it('reserves every selected room for check-in through check-out minus one night', async () => {
    await inventory.reserve(
      HOTEL_ID,
      ['room-1', 'room-2'],
      checkIn,
      checkOut,
      'reservation-1',
    );
    const nights = await hotels.getRoomNights(HOTEL_ID, checkIn, checkOut);
    expect(nights).toHaveLength(4);
    expect(
      nights.every((night) => night.date >= checkIn && night.date < checkOut),
    ).toBe(true);
    expect(
      (await hotels.getRooms(HOTEL_ID)).every(
        (item) => item.hasEverBeenReserved,
      ),
    ).toBe(true);
  });

  it('rejects an overlapping reservation without holding any other requested room', async () => {
    await inventory.reserve(
      HOTEL_ID,
      ['room-1'],
      checkIn,
      checkOut,
      'reservation-1',
    );
    await expect(
      inventory.reserve(
        HOTEL_ID,
        ['room-2', 'room-1'],
        checkIn,
        checkOut,
        'reservation-2',
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.RoomsUnavailable } });
    expect(
      await hotels.getRoomNights(HOTEL_ID, checkIn, checkOut),
    ).toHaveLength(2);
    expect(
      (await hotels.getRooms(HOTEL_ID)).find((item) => item.id === 'room-2')
        ?.hasEverBeenReserved,
    ).toBe(false);
  });

  it('allows a new stay starting on the previous stay checkout date', async () => {
    await inventory.reserve(
      HOTEL_ID,
      ['room-1'],
      checkIn,
      checkOut,
      'reservation-1',
    );
    await inventory.reserve(
      HOTEL_ID,
      ['room-1'],
      checkOut,
      toDateOnly('2026-11-18'),
      'reservation-2',
    );
    expect(hotels.data.roomNights).toHaveLength(3);
  });

  it('allows exactly one of two simultaneous overlapping requests', async () => {
    const results = await Promise.allSettled(
      ['reservation-1', 'reservation-2'].map((id) =>
        inventory.reserve(HOTEL_ID, ['room-1'], checkIn, checkOut, id),
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
      if (scenario === 'inactive') await inventory.deactivate('room-1');
      if (scenario === 'other hotel')
        hotels.data.rooms[0].hotelId = OTHER_HOTEL_ID;
      if (scenario === 'outside availability') {
        await inventory.setAvailability('room-1', [
          { fromDate: checkIn, toDate: checkIn },
        ]);
      }
      await expect(
        inventory.reserve(
          HOTEL_ID,
          [scenario === 'missing' ? 'missing' : 'room-1'],
          checkIn,
          checkOut,
          'reservation-1',
        ),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.RoomsUnavailable },
      });
      expect(hotels.data.roomNights).toEqual([]);
    },
  );

  it('rejects reservations in inactive hotels', async () => {
    await hotels.setActive(HOTEL_ID, false);
    await expect(
      inventory.reserve(
        HOTEL_ID,
        ['room-1'],
        checkIn,
        checkOut,
        'reservation-1',
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.RoomsUnavailable } });
  });

  it.each([{ roomIds: [] }, { roomIds: ['room-1', 'room-1'] }])(
    'rejects empty or repeated room selections: %j',
    async ({ roomIds }) => {
      await expect(
        inventory.reserve(
          HOTEL_ID,
          roomIds,
          checkIn,
          checkOut,
          'reservation-1',
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
      inventory.reserve(HOTEL_ID, ['room-1'], from, to, 'reservation-1'),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    expect(hotels.data.roomNights).toEqual([]);
  });

  it('releases only the selected reservation, is repeatable, and leaves room history and blocks intact', async () => {
    await inventory.reserve(
      HOTEL_ID,
      ['room-1'],
      checkIn,
      checkOut,
      'reservation-1',
    );
    await inventory.reserve(
      HOTEL_ID,
      ['room-2'],
      checkIn,
      checkOut,
      'reservation-2',
    );
    await inventory.block('room-1', checkOut, checkOut);
    await inventory.release('reservation-1');
    await inventory.release('reservation-1');
    expect(hotels.data.roomNights).toHaveLength(3);
    expect((await hotels.getRooms(HOTEL_ID))[0].hasEverBeenReserved).toBe(true);
    await inventory.reserve(
      HOTEL_ID,
      ['room-1'],
      checkIn,
      checkOut,
      'reservation-3',
    );
  });

  it('blocks inclusive nights and rejects overlaps with either reservations or blocks atomically', async () => {
    const blockId = await inventory.block(
      'room-1',
      checkIn,
      toDateOnly('2026-11-16'),
    );
    expect(hotels.data.roomNights).toHaveLength(2);
    await expect(
      inventory.reserve(
        HOTEL_ID,
        ['room-1'],
        checkIn,
        checkOut,
        'reservation-1',
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.RoomsUnavailable } });
    await expect(
      inventory.block('room-1', toDateOnly('2026-11-16'), checkOut),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.OverlapsReservationOrBlock },
    });
    expect(hotels.data.roomNights).toHaveLength(2);
    await inventory.unblock(blockId);
    await inventory.unblock(blockId);
    await inventory.reserve(
      HOTEL_ID,
      ['room-1'],
      checkIn,
      checkOut,
      'reservation-1',
    );
    await expect(
      inventory.block('room-1', checkIn, checkOut),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.OverlapsReservationOrBlock },
    });
    expect(hotels.data.roomNights).toHaveLength(2);
  });

  it('normalizes adjacent availability ranges, rejecting overlaps without changing existing availability', async () => {
    await inventory.setAvailability('room-1', [
      { fromDate: checkOut, toDate: checkOut },
      { fromDate: checkIn, toDate: toDateOnly('2026-11-16') },
    ]);
    expect((await hotels.getRooms(HOTEL_ID))[0].availability).toEqual([
      { fromDate: checkIn, toDate: checkOut },
    ]);
    await expect(
      inventory.setAvailability('room-1', [
        { fromDate: checkIn, toDate: checkOut },
        { fromDate: checkOut, toDate: checkOut },
      ]),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    expect((await hotels.getRooms(HOTEL_ID))[0].availability).toEqual([
      { fromDate: checkIn, toDate: checkOut },
    ]);
  });

  it('protects reserved nights when editing, deactivating, or deleting a room', async () => {
    await inventory.reserve(
      HOTEL_ID,
      ['room-1'],
      checkIn,
      checkOut,
      'reservation-1',
    );
    await expect(inventory.setAvailability('room-1', [])).rejects.toMatchObject(
      { response: { code: ErrorCode.AvailabilityHasReservations } },
    );
    await expect(inventory.deactivate('room-1')).rejects.toMatchObject({
      response: { code: ErrorCode.RoomHasReservations },
    });
    await expect(inventory.delete('room-1')).rejects.toMatchObject({
      response: { code: ErrorCode.RoomHasReservations },
    });
    await inventory.release('reservation-1');
    await inventory.setAvailability('room-1', []);
    await inventory.deactivate('room-1');
    await expect(inventory.delete('room-1')).rejects.toMatchObject({
      response: { code: ErrorCode.RoomWasReserved },
    });
  });

  it('protects today in UTC, but permits availability changes and deactivation after reserved nights have passed', async () => {
    const today = toDateOnly('2026-11-12');
    await inventory.reserve(
      HOTEL_ID,
      ['room-1'],
      today,
      toDateOnly('2026-11-13'),
      'reservation-1',
    );
    await expect(inventory.deactivate('room-1')).rejects.toMatchObject({
      response: { code: ErrorCode.RoomHasReservations },
    });
    vi.setSystemTime(new Date('2026-11-13T00:00:00Z'));
    await inventory.setAvailability('room-1', []);
    await inventory.deactivate('room-1');
    await expect(inventory.delete('room-1')).rejects.toMatchObject({
      response: { code: ErrorCode.RoomWasReserved },
    });
  });

  it('deletes never-reserved rooms and their blocks, without deleting another room', async () => {
    await inventory.block('room-1', checkIn, checkOut);
    await inventory.delete('room-1');
    expect(await hotels.getRooms(HOTEL_ID)).toEqual([
      expect.objectContaining({ id: 'room-2' }),
    ]);
    expect(hotels.data.roomNights).toEqual([]);
  });

  it('reports missing rooms rather than pretending that updates succeeded', async () => {
    for (const call of [
      () => inventory.block('missing', checkIn, checkOut),
      () => inventory.setAvailability('missing', []),
      () => inventory.deactivate('missing'),
      () => inventory.delete('missing'),
    ]) {
      await expect(call()).rejects.toMatchObject({
        response: { code: ErrorCode.NotFound },
      });
    }
  });
});
