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
  describe('room edits and availability (HTL-04 / HTL-05)', () => {
    it('edits only numeric fields and keeps earlier room views detached', async () => {
      const quoted = (await hotels.getRooms(ids.hotel1))[0];
      const supplied = {
        beds: 2,
        pricePerNightMinor: 12000,
        isActive: false,
        availability: [],
      };
      const updated = await hotels.updateRoom(
        ids.hotel1,
        ids.room1,
        supplied,
        ids.hotel1,
      );
      expect(updated).toEqual({
        ...quoted,
        beds: 2,
        pricePerNightMinor: 12000,
      });
      expect(quoted.pricePerNightMinor).toBe(10000);
      await expect(
        hotels.updateRoom(
          ids.hotel1,
          ids.room1,
          { beds: 3, maxOccupancy: 0 },
          ids.hotel1,
        ),
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect((await hotels.getRooms(ids.hotel1))[0]).toEqual(updated);
    });

    it('reuses inclusive normalization and protects pending reservation nights', async () => {
      await inventory.reserve(
        ids.hotel1,
        [ids.room1],
        checkIn,
        checkOut,
        ids.reservation1,
      );
      const added = await hotels.addRoomAvailability(
        ids.hotel1,
        ids.room1,
        { fromDate: '2026-12-01', toDate: '2026-12-01' },
        ids.hotel1,
      );
      expect(added.availability).toEqual([
        {
          fromDate: toDateOnly('2026-11-12'),
          toDate: toDateOnly('2026-12-01'),
        },
      ]);
      await expect(
        hotels.setRoomAvailability(
          ids.hotel1,
          ids.room1,
          { op: 'SET_RANGES', ranges: [] },
          ids.hotel1,
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: ErrorCode.AvailabilityHasReservations },
      });
      await expect(
        hotels.addRoomAvailability(
          ids.hotel1,
          ids.room1,
          { fromDate: '2026-12-01', toDate: '2026-12-02' },
          ids.hotel1,
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: ErrorCode.ValidationFailed },
      });
      const replaced = await hotels.setRoomAvailability(
        ids.hotel1,
        ids.room2,
        {
          op: 'SET_RANGES',
          ranges: [{ fromDate: '2026-12-01', toDate: '2026-12-01' }],
        },
        ids.hotel1,
      );
      expect(replaced.availability).toEqual([
        {
          fromDate: toDateOnly('2026-12-01'),
          toDate: toDateOnly('2026-12-01'),
        },
      ]);
      replaced.availability.length = 0;
      expect((await hotels.getRooms(ids.hotel1))[1].availability).toHaveLength(
        1,
      );
    });

    it('enforces the assigned hotel and room membership on every mutation', async () => {
      hotels.data.hotels.push(hotel(ids.hotel2));
      for (const change of [
        (hotelId: string, roomId: string, assigned: string) =>
          hotels.updateRoom(hotelId, roomId, { beds: 2 }, assigned),
        (hotelId: string, roomId: string, assigned: string) =>
          hotels.addRoomAvailability(
            hotelId,
            roomId,
            { fromDate: '2026-12-01', toDate: '2026-12-01' },
            assigned,
          ),
        (hotelId: string, roomId: string, assigned: string) =>
          hotels.setRoomAvailability(
            hotelId,
            roomId,
            { op: 'SET_RANGES', ranges: [] },
            assigned,
          ),
      ]) {
        await expect(
          change(ids.hotel1, ids.room1, ids.hotel2),
        ).rejects.toMatchObject({ status: 404 });
        await expect(
          change(ids.hotel2, ids.room1, ids.hotel2),
        ).rejects.toMatchObject({ status: 404 });
        await expect(
          change(ids.hotel1, ids.missing, ids.hotel1),
        ).rejects.toMatchObject({ status: 404 });
        await expect(
          change(ids.hotel1, 'invalid', ids.hotel1),
        ).rejects.toMatchObject({
          status: 400,
          response: { code: ErrorCode.ValidationFailed },
        });
      }
    });
  });

  describe('room creation and listing (HTL-03)', () => {
    const input = {
      name: ' Room A ',
      type: ' Deluxe King ',
      beds: 1,
      maxOccupancy: 2,
      pricePerNightMinor: 10000,
    };

    it('creates detached room views, preserves safe defaults, and lists only assigned rooms', async () => {
      const supplied = {
        ...input,
        hotelId: ids.hotel2,
        isActive: false,
        availability: [],
        hasEverBeenReserved: true,
      };
      const created = await hotels.createRoom(
        ids.hotel1.toUpperCase(),
        supplied,
        ids.hotel1,
      );
      expect(created).toEqual({
        ...input,
        name: 'room a',
        type: 'Deluxe King',
        id: expect.stringMatching(/^[a-f0-9]{24}$/),
        hotelId: ids.hotel1,
        isActive: true,
        availability: [],
        hasEverBeenReserved: false,
      });
      created.name = 'Changed response';
      const all = await hotels.getRooms(ids.hotel1);
      expect(all.find((item) => item.id === created.id)?.name).toBe('room a');
      expect(
        await hotels.listRooms(ids.hotel1, { page: 2, limit: 2 }, ids.hotel1),
      ).toEqual({
        items: all.slice(2, 4),
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      hotels.data.hotels.push(hotel(ids.hotel2));
      expect(
        await hotels.listRooms(ids.hotel2, { page: 1, limit: 10 }, ids.hotel2),
      ).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });

    it('rejects case-variant trimmed names under concurrency but permits the same name in another hotel', async () => {
      const outcomes = await Promise.allSettled(
        ['Room A', ' ROOM a ', 'room A'].map((name) =>
          hotels.createRoom(ids.hotel1, { ...input, name }, ids.hotel1),
        ),
      );
      expect(
        outcomes.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      for (const result of outcomes) {
        if (result.status === 'rejected')
          expect(result.reason).toMatchObject({
            status: 409,
            response: { code: ErrorCode.Conflict },
          });
      }
      hotels.data.hotels.push(hotel(ids.hotel2));
      expect(
        await hotels.createRoom(ids.hotel2, input, ids.hotel2),
      ).toMatchObject({
        name: 'room a',
        hotelId: ids.hotel2,
      });
    });

    it('matches legacy mixed-case name collisions literally without rewriting inactive fixtures', async () => {
      hotels.data.rooms.push(
        room(ids.room3, {
          name: 'Suite [A].* (East)?$',
          isActive: false,
        }),
      );
      await expect(
        hotels.createRoom(
          ids.hotel1,
          { ...input, name: ' suite [a].* (east)?$ ' },
          ids.hotel1,
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: ErrorCode.Conflict },
      });
      expect(hotels.data.rooms).toHaveLength(3);
      expect(
        hotels.data.rooms.find((item) => item.id === ids.room3)?.name,
      ).toBe('Suite [A].* (East)?$');
      for (const name of [
        'Suite A East',
        'Prefix Suite [A].* (East)?$ Suffix',
      ]) {
        expect(
          await hotels.createRoom(ids.hotel1, { ...input, name }, ids.hotel1),
        ).toMatchObject({ name: name.toLowerCase() });
      }
    });

    it('matches assignment, missing-hotel and schema-validation failures without inserting rooms', async () => {
      for (const assignment of [undefined, 'invalid', ids.hotel2]) {
        await expect(
          hotels.createRoom(ids.hotel1, input, assignment),
        ).rejects.toMatchObject({
          status: 404,
          response: { code: ErrorCode.NotFound },
        });
        await expect(
          hotels.listRooms(ids.hotel1, { page: 1, limit: 10 }, assignment),
        ).rejects.toMatchObject({
          status: 404,
          response: { code: ErrorCode.NotFound },
        });
      }
      await expect(
        hotels.createRoom(ids.missing, input, ids.missing),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.NotFound },
      });
      for (const invalid of [
        { name: ' ' },
        { type: 'x'.repeat(51) },
        { beds: 0 },
        { maxOccupancy: 0 },
        { pricePerNightMinor: 1.5 },
      ]) {
        await expect(
          hotels.createRoom(ids.hotel1, { ...input, ...invalid }, ids.hotel1),
        ).rejects.toMatchObject({
          name: 'ValidationError',
        });
      }
      expect(hotels.data.rooms).toHaveLength(2);
    });
  });

  const policies = {
    checkInTime: '15:30',
    checkOutTime: '11:00',
    cancellationPolicy: { tiers: [{ daysBefore: 2, refundPercent: 50 }] },
  };

  it('replaces policies with detached input and output and permits clearing tiers', async () => {
    const before = (await hotels.getHotel(ids.hotel1))!;
    const input = structuredClone(policies);
    const updated = await hotels.updatePolicies(ids.hotel1, input, ids.hotel1);
    expect(updated).toEqual({ ...before, ...policies });
    input.cancellationPolicy.tiers.length = 0;
    updated.cancellationPolicy.tiers.length = 0;
    expect(await hotels.getHotel(ids.hotel1)).toEqual({
      ...before,
      ...policies,
    });
    const cleared = { ...policies, cancellationPolicy: { tiers: [] } };
    expect(
      await hotels.updatePolicies(ids.hotel1, cleared, ids.hotel1),
    ).toEqual({ ...before, ...cleared });
  });

  it('enforces policy scope and validation without partially updating stored fields', async () => {
    const before = await hotels.getHotel(ids.hotel1);
    for (const assignment of [undefined, ids.hotel2, 'invalid']) {
      await expect(
        hotels.updatePolicies(ids.hotel1, policies, assignment),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: ErrorCode.NotFound },
      });
    }
    for (const input of [policies, { ...policies, checkInTime: '24:00' }]) {
      await expect(
        hotels.updatePolicies(ids.missing, input, ids.missing),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: ErrorCode.NotFound },
      });
    }
    for (const input of [
      { ...policies, checkInTime: '24:00' },
      {
        ...policies,
        cancellationPolicy: {
          tiers: [
            { daysBefore: 2, refundPercent: 50 },
            { daysBefore: 2, refundPercent: 100 },
          ],
        },
      },
    ]) {
      await expect(
        hotels.updatePolicies(ids.hotel1, input, ids.hotel1),
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect(await hotels.getHotel(ids.hotel1)).toEqual(before);
    }
  });

  it('rejects malformed hotel IDs with the same validation errors as the real service', async () => {
    const calls = [
      () => hotels.getHotel('invalid'),
      () => hotels.getRooms('invalid'),
      () =>
        hotels.createRoom(
          'invalid',
          {
            name: '101',
            type: 'Single',
            beds: 1,
            maxOccupancy: 1,
            pricePerNightMinor: 1,
          },
          'invalid',
        ),
      () => hotels.listRooms('invalid', { page: 1, limit: 10 }, 'invalid'),
      () => hotels.update('invalid', {}, 'invalid'),
      () => hotels.updatePolicies('invalid', policies, 'invalid'),
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
    expect(await hotels.getHotel(ids.hotel1.toUpperCase())).toEqual(
      await hotels.getHotel(ids.hotel1),
    );
    expect(await hotels.getHotel(ids.missing)).toBeNull();
    expect(
      await hotels.update(ids.hotel1.toUpperCase(), {}, ids.hotel1),
    ).toEqual(await hotels.getHotel(ids.hotel1));
  });

  it('stores detached photo views, enforces five under concurrency, and removes files', async () => {
    const storage = new FakeStorageService();
    const fake = new FakeHotelsService(
      { hotels: [hotel(ids.hotel1)] },
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
      Array.from({ length: 7 }, () =>
        fake.addPhoto(ids.hotel1, image, ids.hotel1),
      ),
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
    const photos = (await fake.getHotel(ids.hotel1))!.photos;
    expect(photos).toHaveLength(5);
    expect(storage.keys().sort()).toEqual(
      photos.map((photo) => photo.key).sort(),
    );
    successful[0]!.value.photos.length = 0;
    expect((await fake.getHotel(ids.hotel1))!.photos).toHaveLength(5);
    await fake.removePhoto(ids.hotel1, photos[0]!.id, ids.hotel1);
    expect(storage.has(photos[0]!.key)).toBe(false);
    expect((await fake.getHotel(ids.hotel1))!.photos).toHaveLength(4);
    expect(
      (await fake.addPhoto(ids.hotel1, image, ids.hotel1)).photos,
    ).toHaveLength(5);
  });

  it('applies photo scope and validation before changing stored data', async () => {
    const image = {
      buffer: Buffer.from('image'),
      originalname: 'hotel.jpg',
      mimetype: 'image/jpeg',
      size: 5,
    };
    const photo = (await hotels.addPhoto(ids.hotel1, image, ids.hotel1))
      .photos[0]!;
    await expect(
      hotels.addPhoto(ids.hotel1, image, undefined),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    await expect(
      hotels.removePhoto(ids.hotel1, photo.id, ids.hotel2),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    await expect(
      hotels.addPhoto(ids.hotel1, undefined, ids.hotel1),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    await expect(
      hotels.addPhoto(
        ids.hotel1,
        { ...image, mimetype: 'application/pdf' },
        ids.hotel1,
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    await expect(
      hotels.removePhoto(ids.hotel1, 'invalid', ids.hotel1),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    await hotels.removePhoto(ids.hotel1, photo.id, ids.hotel1);
    await expect(
      hotels.removePhoto(ids.hotel1, photo.id, ids.hotel1),
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
    const previous = await hotels.getHotel(ids.hotel1);
    const updated = await hotels.update(
      ids.hotel1,
      {
        name: '  Edited  ',
        address: '  New Address  ',
        cityId: 'dubai',
        description: '',
        starRating: 4,
        amenities: ['  Wi-Fi  '],
      },
      ids.hotel1,
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
    expect(await hotels.update(ids.hotel1, {}, ids.hotel1)).toEqual(updated);
    await hotels.update(ids.hotel1, { amenities: [] }, ids.hotel1);
    updated.amenities.push('Detached');
    expect((await hotels.getHotel(ids.hotel1))?.amenities).toEqual([]);
  });

  it.each([
    { field: 'name', input: { name: '   ' } },
    { field: 'name', input: { name: 'x'.repeat(151) } },
    { field: 'address', input: { address: '   ' } },
    { field: 'address', input: { address: 'x'.repeat(301) } },
    { field: 'description', input: { description: 'x'.repeat(5001) } },
    { field: 'starRating', input: { starRating: 9 } },
    { field: 'starRating', input: { starRating: 0 } },
    { field: 'starRating', input: { starRating: 2.5 } },
    { field: 'amenities.0', input: { amenities: ['   '] } },
    { field: 'amenities.0', input: { amenities: ['x'.repeat(51)] } },
    { field: 'amenities', input: { amenities: [' Pool ', 'Pool'] } },
  ])(
    'rejects invalid profile $field on creation and editing without partial writes',
    async ({ field, input }) => {
      const previous = await hotels.getHotel(ids.hotel1);
      const failure = {
        name: 'ValidationError',
        errors: { [field]: expect.anything() },
      };
      await expect(
        hotels.create({
          name: 'Valid hotel',
          address: '1 Test Street',
          cityId: 'cairo',
          ...input,
        }),
      ).rejects.toMatchObject(failure);
      await expect(
        hotels.update(ids.hotel1, { cityId: 'dubai', ...input }, ids.hotel1),
      ).rejects.toMatchObject(failure);
      expect(hotels.data.hotels).toHaveLength(1);
      expect(await hotels.getHotel(ids.hotel1)).toEqual(previous);
    },
  );

  it.each([
    { field: 'count', summary: { average: 4, count: -1 } },
    { field: 'count', summary: { average: 4, count: 1.5 } },
  ])(
    'rejects invalid rating $field without replacing the previous summary',
    async ({ field, summary }) => {
      await hotels.setRatingSummary(ids.hotel1, { average: 4.5, count: 2 });
      await expect(
        hotels.setRatingSummary(ids.hotel1, summary),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        errors: { [`ratingSummary.${field}`]: expect.anything() },
      });
      expect((await hotels.getHotel(ids.hotel1))?.ratingSummary).toEqual({
        average: 4.5,
        count: 2,
      });
    },
  );

  it.each([
    { field: 'count', summary: { average: 4, count: NaN } },
    { field: 'average', summary: { average: NaN, count: 1 } },
  ])(
    'preserves the real rating $field cast error without changing the summary',
    async ({ field, summary }) => {
      const previous = await hotels.getHotel(ids.hotel1);
      await expect(
        hotels.setRatingSummary(ids.hotel1, summary),
      ).rejects.toMatchObject({ name: 'CastError', path: field });
      expect(await hotels.getHotel(ids.hotel1)).toEqual(previous);
    },
  );

  it('rejects unassigned hotel edits and unknown cities without partial changes', async () => {
    const previous = await hotels.getHotel(ids.hotel1);
    await expect(
      hotels.update(ids.hotel1, { name: 'Forbidden' }, ids.hotel2),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    await expect(
      hotels.update(ids.missing, {}, ids.missing),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    await expect(
      hotels.update(
        ids.hotel1,
        { name: 'Invalid', cityId: 'missing' },
        ids.hotel1,
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    await expect(
      hotels.create({ name: 'Invalid', address: 'Address', cityId: 'missing' }),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    expect(await hotels.getHotel(ids.hotel1)).toEqual(previous);
    expect(hotels.data.hotels).toHaveLength(1);
  });

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
    expect(await hotels.getHotel(ids.missing)).toBeNull();
  });

  it('includes inactive rooms for booking validation, scoped to the hotel', async () => {
    await inventory.deactivate(ids.room1);
    expect(await hotels.getRooms(ids.hotel1)).toEqual([
      expect.objectContaining({ id: ids.room1, isActive: false }),
      expect.objectContaining({ id: ids.room2, isActive: true }),
    ]);
    expect(await hotels.getRooms(ids.missing)).toEqual([]);
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
    await expect(hotels.setActive(ids.missing, false)).rejects.toMatchObject({
      response: { code: ErrorCode.NotFound },
    });
    await expect(
      hotels.setRatingSummary(ids.missing, { average: null, count: 0 }),
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

  it('rejects overlapping availability before checking whether the room exists', async () => {
    await expect(
      inventory.setAvailability(ids.missing, [
        { fromDate: checkIn, toDate: checkOut },
        { fromDate: checkOut, toDate: checkOut },
      ]),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: ErrorCode.ValidationFailed },
    });
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
