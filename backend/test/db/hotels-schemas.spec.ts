import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { toDateOnly } from '../../src/common/dates/date-only.js';
import {
  Hotel,
  HotelSchema,
} from '../../src/modules/hotels/schemas/hotel.schema.js';
import {
  RoomNight,
  RoomNightSchema,
} from '../../src/modules/hotels/schemas/room-night.schema.js';
import {
  Room,
  RoomSchema,
} from '../../src/modules/hotels/schemas/room.schema.js';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

function hotelDoc(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Nile View Hotel',
    address: '1 Corniche El Nil, Garden City',
    cityId: 'cairo',
    countryCode: 'EG',
    ...overrides,
  };
}

function range(fromDate: string, toDate: string) {
  return { fromDate: toDateOnly(fromDate), toDate: toDateOnly(toDate) };
}

function roomDoc(overrides: Record<string, unknown> = {}) {
  return {
    hotelId: new Types.ObjectId(),
    name: '101',
    type: 'Deluxe King',
    beds: 1,
    maxOccupancy: 2,
    pricePerNightMinor: 12_000,
    ...overrides,
  };
}

function nightDoc(
  kind: 'reservation' | 'blocked',
  overrides: Record<string, unknown> = {},
) {
  return {
    roomId: new Types.ObjectId(),
    hotelId: new Types.ObjectId(),
    date: toDateOnly('2027-03-01'),
    kind,
    ...(kind === 'reservation'
      ? { reservationId: new Types.ObjectId() }
      : { blockId: new Types.ObjectId() }),
    ...overrides,
  };
}

function indexSummary(indexes: { key: unknown; unique?: boolean }[]) {
  return indexes.map((index) => ({
    key: index.key,
    unique: index.unique ?? false,
  }));
}

describe('hotels schemas', () => {
  let db: TestDatabase;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let nights: Model<RoomNight>;

  beforeAll(async () => {
    db = await startTestDatabase('hotels');
    hotels = db.connection.model(Hotel.name, HotelSchema);
    rooms = db.connection.model(Room.name, RoomSchema);
    nights = db.connection.model(RoomNight.name, RoomNightSchema);
    await Promise.all([hotels.init(), rooms.init(), nights.init()]);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await Promise.all([
      hotels.deleteMany({}),
      rooms.deleteMany({}),
      nights.deleteMany({}),
    ]);
  });

  it('uses the hotels, rooms and room_nights collections', () => {
    expect(hotels.collection.collectionName).toBe('hotels');
    expect(rooms.collection.collectionName).toBe('rooms');
    expect(nights.collection.collectionName).toBe('room_nights');
  });

  describe('hotels', () => {
    it('applies the defaults', async () => {
      const hotel = await hotels.create(hotelDoc());
      expect(hotel.photos).toHaveLength(0);
      expect(hotel.amenities).toEqual([]);
      expect(hotel.checkInTime).toBe('14:00');
      expect(hotel.checkOutTime).toBe('12:00');
      expect(hotel.cancellationPolicy.tiers).toHaveLength(0);
      expect(hotel.isActive).toBe(true);
      expect(hotel.ratingSummary.average).toBeNull();
      expect(hotel.ratingSummary.count).toBe(0);
      expect(hotel.description).toBeUndefined();
      expect(hotel.starRating).toBeUndefined();
      expect(hotel.createdAt).toBeInstanceOf(Date);
    });

    it('trims and limits name and address', async () => {
      const invalid = [
        { name: '   ' },
        { name: 'x'.repeat(151) },
        { address: '' },
        { address: 'x'.repeat(301) },
        { cityId: undefined },
        { countryCode: undefined },
        { description: 'x'.repeat(5001) },
      ];
      for (const overrides of invalid) {
        await expect(
          new hotels(hotelDoc(overrides)).validate(),
        ).rejects.toThrow(new RegExp(Object.keys(overrides)[0]));
      }
      const hotel = new hotels(
        hotelDoc({
          name: `  ${'x'.repeat(150)}  `,
          address: 'x'.repeat(300),
          description: 'x'.repeat(5000),
        }),
      );
      await expect(hotel.validate()).resolves.toBeUndefined();
      expect(hotel.name).toBe('x'.repeat(150));
    });

    it('accepts 5 photos but rejects 6', async () => {
      const photos = (count: number) =>
        Array.from({ length: count }, (_, i) => ({ key: `photo-${i}.jpg` }));
      await expect(
        new hotels(hotelDoc({ photos: photos(6) })).validate(),
      ).rejects.toThrow(/photos must have at most 5 items/);
      const hotel = await hotels.create(hotelDoc({ photos: photos(5) }));
      expect(hotel.photos).toHaveLength(5);
      expect(hotel.photos[0]).toHaveProperty('_id');
    });

    it('validates the star rating as an integer 1-5', async () => {
      for (const starRating of [0, 6, 3.5]) {
        await expect(
          new hotels(hotelDoc({ starRating })).validate(),
        ).rejects.toThrow(/starRating/);
      }
      for (const starRating of [1, 5]) {
        await expect(
          new hotels(hotelDoc({ starRating })).validate(),
        ).resolves.toBeUndefined();
      }
    });

    it('rejects duplicate amenities, after trimming', async () => {
      for (const amenities of [
        ['wifi', 'wifi'],
        ['wifi', '  wifi '],
      ]) {
        await expect(
          new hotels(hotelDoc({ amenities })).validate(),
        ).rejects.toThrow(/amenities must not contain duplicates/);
      }
      const hotel = new hotels(hotelDoc({ amenities: [' wifi ', 'pool'] }));
      await expect(hotel.validate()).resolves.toBeUndefined();
      expect(hotel.amenities).toEqual(['wifi', 'pool']);
    });

    it('limits each amenity to 1-50 chars', async () => {
      for (const amenity of ['', '   ', 'x'.repeat(51)]) {
        await expect(
          new hotels(hotelDoc({ amenities: [amenity] })).validate(),
        ).rejects.toThrow(/amenities/);
      }
      await expect(
        new hotels(hotelDoc({ amenities: ['x', 'y'.repeat(50)] })).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects bad HH:mm check-in and check-out times', async () => {
      for (const time of ['24:00', '9:5', '09:60', '9:00', '12:00:00']) {
        await expect(
          new hotels(hotelDoc({ checkInTime: time })).validate(),
        ).rejects.toThrow(/checkInTime/);
        await expect(
          new hotels(hotelDoc({ checkOutTime: time })).validate(),
        ).rejects.toThrow(/checkOutTime/);
      }
      await expect(
        new hotels(
          hotelDoc({ checkInTime: '00:00', checkOutTime: '23:59' }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects duplicate daysBefore in the cancellation policy', async () => {
      await expect(
        new hotels(
          hotelDoc({
            cancellationPolicy: {
              tiers: [
                { daysBefore: 7, refundPercent: 50 },
                { daysBefore: 7, refundPercent: 100 },
              ],
            },
          }),
        ).validate(),
      ).rejects.toThrow(/daysBefore/);
      await expect(
        new hotels(
          hotelDoc({
            cancellationPolicy: {
              tiers: [
                { daysBefore: 7, refundPercent: 50 },
                { daysBefore: 14, refundPercent: 100 },
              ],
            },
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('validates the rating summary count', async () => {
      for (const count of [-1, 1.5]) {
        await expect(
          new hotels(
            hotelDoc({ ratingSummary: { average: 4.5, count } }),
          ).validate(),
        ).rejects.toThrow(/ratingSummary\.count/);
      }
      await expect(
        new hotels(
          hotelDoc({ ratingSummary: { average: 4.5, count: 2 } }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('has exactly the indexes from the data model', async () => {
      const indexes = await hotels.collection.indexes();
      expect(indexSummary(indexes)).toEqual(
        expect.arrayContaining([
          { key: { _id: 1 }, unique: false },
          { key: { cityId: 1, isActive: 1 }, unique: false },
          { key: { countryCode: 1, isActive: 1 }, unique: false },
          { key: { 'ratingSummary.average': -1 }, unique: false },
        ]),
      );
      expect(indexes).toHaveLength(4);
    });
  });

  describe('rooms', () => {
    it('applies the defaults', async () => {
      const room = await rooms.create(roomDoc());
      expect(room.isActive).toBe(true);
      expect(room.availability).toHaveLength(0);
      expect(room.hasEverBeenReserved).toBe(false);
      expect(room.inventoryVersion).toBe(0);
      expect(room.createdAt).toBeInstanceOf(Date);
    });

    it('validates the room fields', async () => {
      const invalid = [
        { name: '  ' },
        { type: '' },
        { type: 'x'.repeat(51) },
        { beds: 0 },
        { maxOccupancy: 0 },
        { maxOccupancy: 1.5 },
        { pricePerNightMinor: 0 },
        { pricePerNightMinor: 99.5 },
        { inventoryVersion: -1 },
      ];
      for (const overrides of invalid) {
        await expect(new rooms(roomDoc(overrides)).validate()).rejects.toThrow(
          new RegExp(Object.keys(overrides)[0]),
        );
      }
      const room = new rooms(
        roomDoc({
          name: ' 101 ',
          type: 'x'.repeat(50),
          beds: 1,
          maxOccupancy: 1,
          pricePerNightMinor: 1,
        }),
      );
      await expect(room.validate()).resolves.toBeUndefined();
      expect(room.name).toBe('101');
    });

    it('rejects a duplicate room name in the same hotel only', async () => {
      const hotelId = new Types.ObjectId();
      await rooms.create(roomDoc({ hotelId, name: '101' }));
      await expect(
        rooms.create(roomDoc({ hotelId, name: '101' })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        rooms.create(roomDoc({ hotelId, name: '102' })),
      ).resolves.toBeDefined();
      await expect(
        rooms.create(roomDoc({ hotelId: new Types.ObjectId(), name: '101' })),
      ).resolves.toBeDefined();
    });

    it('rejects an availability range with fromDate after toDate', async () => {
      await expect(
        new rooms(
          roomDoc({ availability: [range('2027-03-10', '2027-03-09')] }),
        ).validate(),
      ).rejects.toThrow(/toDate must not be before fromDate/);
      const room = await rooms.create(
        roomDoc({ availability: [range('2027-03-10', '2027-03-10')] }),
      );
      expect(room.availability[0]).toHaveProperty('_id');
    });

    it('rejects overlapping availability ranges', async () => {
      const overlapping = [
        [range('2027-03-01', '2027-03-10'), range('2027-03-10', '2027-03-20')],
        [range('2027-03-05', '2027-03-20'), range('2027-03-01', '2027-03-06')],
        [range('2027-03-01', '2027-03-31'), range('2027-03-10', '2027-03-12')],
      ];
      for (const availability of overlapping) {
        await expect(
          new rooms(roomDoc({ availability })).validate(),
        ).rejects.toThrow(/availability ranges must not overlap/);
      }
      const separate = [
        [range('2027-03-01', '2027-03-10'), range('2027-03-11', '2027-03-20')],
        [range('2027-04-01', '2027-04-05'), range('2027-03-01', '2027-03-05')],
      ];
      for (const availability of separate) {
        await expect(
          new rooms(roomDoc({ availability })).validate(),
        ).resolves.toBeUndefined();
      }
    });

    it('rejects availability dates with a time part', async () => {
      await expect(
        new rooms(
          roomDoc({
            availability: [
              {
                fromDate: new Date('2027-03-01T12:00:00.000Z'),
                toDate: toDateOnly('2027-03-05'),
              },
            ],
          }),
        ).validate(),
      ).rejects.toThrow(/availability\.0\.fromDate/);
      await expect(
        new rooms(
          roomDoc({ availability: [range('2027-03-01', '2027-03-05')] }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('has exactly the indexes from the data model', async () => {
      const indexes = await rooms.collection.indexes();
      expect(indexSummary(indexes)).toEqual(
        expect.arrayContaining([
          { key: { _id: 1 }, unique: false },
          { key: { hotelId: 1, name: 1 }, unique: true },
          { key: { hotelId: 1, isActive: 1 }, unique: false },
        ]),
      );
      expect(indexes).toHaveLength(3);
    });
  });

  describe('room_nights', () => {
    it('saves a reservation night and a blocked night', async () => {
      const reserved = await nights.create(nightDoc('reservation'));
      expect(reserved.blockId).toBeUndefined();
      expect(reserved.createdAt).toBeInstanceOf(Date);
      const blocked = await nights.create(nightDoc('blocked'));
      expect(blocked.reservationId).toBeUndefined();
    });

    it('rejects a second night for the same room and date, whatever the kind', async () => {
      const roomId = new Types.ObjectId();
      const date = toDateOnly('2027-03-01');
      await nights.create(nightDoc('reservation', { roomId, date }));
      await expect(
        nights.create(nightDoc('reservation', { roomId, date })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        nights.create(nightDoc('blocked', { roomId, date })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        nights.create(
          nightDoc('blocked', { roomId, date: toDateOnly('2027-03-02') }),
        ),
      ).resolves.toBeDefined();
      await expect(
        nights.create(
          nightDoc('reservation', { roomId: new Types.ObjectId(), date }),
        ),
      ).resolves.toBeDefined();
    });

    it('requires reservationId for a reservation night, and no blockId', async () => {
      await expect(
        new nights(
          nightDoc('reservation', { reservationId: undefined }),
        ).validate(),
      ).rejects.toThrow(/reservationId/);
      await expect(
        new nights(
          nightDoc('reservation', { blockId: new Types.ObjectId() }),
        ).validate(),
      ).rejects.toThrow(/blockId must be absent/);
      await expect(
        new nights(nightDoc('reservation')).validate(),
      ).resolves.toBeUndefined();
    });

    it('requires blockId for a blocked night, and no reservationId', async () => {
      await expect(
        new nights(nightDoc('blocked', { blockId: undefined })).validate(),
      ).rejects.toThrow(/blockId/);
      await expect(
        new nights(
          nightDoc('blocked', { reservationId: new Types.ObjectId() }),
        ).validate(),
      ).rejects.toThrow(/reservationId must be absent/);
      await expect(
        new nights(nightDoc('blocked')).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects an unknown kind and a date with a time part', async () => {
      await expect(
        new nights(nightDoc('blocked', { kind: 'maintenance' })).validate(),
      ).rejects.toThrow(/kind/);
      await expect(
        new nights(
          nightDoc('blocked', { date: new Date('2027-03-01T00:00:01.000Z') }),
        ).validate(),
      ).rejects.toThrow(/date/);
      await expect(
        new nights(
          nightDoc('blocked', { date: toDateOnly('2027-03-01') }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('has exactly the indexes from the data model', async () => {
      const indexes = await nights.collection.indexes();
      expect(indexSummary(indexes)).toEqual(
        expect.arrayContaining([
          { key: { _id: 1 }, unique: false },
          { key: { roomId: 1, date: 1 }, unique: true },
          { key: { hotelId: 1, date: 1 }, unique: false },
          { key: { reservationId: 1 }, unique: false },
          { key: { blockId: 1 }, unique: false },
        ]),
      );
      expect(indexes).toHaveLength(5);
    });
  });
});
