import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { FakeStorageService } from '../../../test/fakes/storage.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { addDays, toDateOnly } from '../../common/dates/date-only.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { MAX_IMAGE_BYTES } from '../storage/image-rules.js';
import type { UploadedImage } from '../storage/image-rules.js';
import { StorageService } from '../storage/storage.service.js';
import { HotelsModule } from './hotels.module.js';
import { HotelsService } from './hotels.service.js';
import type { HotelSearchQuery } from './hotels.types.js';
import { RoomNightInventory } from './room-night-inventory.js';
import { RoomNight } from './schemas/room-night.schema.js';
import { Hotel } from './schemas/hotel.schema.js';
import { Room } from './schemas/room.schema.js';

const profile = {
  name: 'Nile View Hotel',
  address: '1 Corniche El Nil',
  cityId: 'cairo',
  description: 'A hotel by the Nile',
  starRating: 4,
  amenities: ['Wi-Fi', 'Pool'],
};

describe('HotelsService (HTL-01 / HTL-03 / HTL-06 integration)', () => {
  let t: TestApp;
  let service: HotelsService;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let nights: Model<RoomNight>;
  let inventory: RoomNightInventory;
  let referenceData: FakeReferenceDataService;
  const storage = new FakeStorageService();

  beforeAll(async () => {
    referenceData = new FakeReferenceDataService();
    t = await createTestApp({
      imports: [HotelsModule],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(referenceData)
          .overrideProvider(StorageService)
          .useValue(storage),
    });
    service = t.moduleRef.get(HotelsService);
    hotels = t.moduleRef.get<Model<Hotel>>(getModelToken(Hotel.name));
    rooms = t.moduleRef.get<Model<Room>>(getModelToken(Room.name));
    nights = t.moduleRef.get<Model<RoomNight>>(getModelToken(RoomNight.name));
    inventory = t.moduleRef.get(RoomNightInventory);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    vi.restoreAllMocks();
    await Promise.all(storage.keys().map((key) => storage.delete(key)));
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  describe('hotel search (HTL-11 / HTL-12)', () => {
    const checkIn = toDateOnly('2099-12-01');
    const checkOut = toDateOnly('2099-12-04');
    const query: HotelSearchQuery = {
      cityId: 'cairo',
      checkIn,
      checkOut,
      guests: 2,
    };

    async function seedHotel(
      fields: Partial<Hotel> = {},
      roomFields: Partial<Room>[] = [{}],
    ) {
      const hotel = await hotels.create({
        name: 'Search hotel',
        address: '1 Test Street',
        cityId: 'cairo',
        countryCode: 'EG',
        ...fields,
      });
      const seededRooms = await rooms.create(
        roomFields.map((fields, index) => ({
          hotelId: hotel._id,
          name: String(index + 1),
          type: 'Double',
          beds: 1,
          maxOccupancy: 2,
          pricePerNightMinor: 10000,
          availability: [{ fromDate: checkIn, toDate: addDays(checkOut, -1) }],
          ...fields,
        })),
      );
      return { hotel, seededRooms };
    }

    it('matches active hotels by city or country and returns plain service views', async () => {
      const cairo = await seedHotel();
      const luxor = await seedHotel({ cityId: 'luxor' });
      await seedHotel({ cityId: 'rome', countryCode: 'IT' });
      await seedHotel({ isActive: false });
      await seedHotel({}, []);

      const byCity = await service.search(query);
      expect(byCity).toMatchObject({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      expect(byCity.items).toMatchObject([
        { id: cairo.hotel._id.toHexString(), pricePerNightMinor: 10000 },
      ]);
      expect(byCity.items[0]).not.toHaveProperty('_id');
      expect(byCity.items[0]).not.toHaveProperty('__v');
      const byCountry = await service.search({
        ...query,
        cityId: undefined,
        countryCode: 'EG',
      });
      expect(byCountry.items.map((hotel) => hotel.id).sort()).toEqual(
        [cairo.hotel._id.toHexString(), luxor.hotel._id.toHexString()].sort(),
      );
      expect(await service.search({ ...query, countryCode: 'IT' })).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
      expect(
        await service.search({ ...query, cityId: 'unknown-city' }),
      ).toEqual({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 });
    });

    it('uses only the requested number of largest room occupancies, defaulting to one room', async () => {
      await seedHotel(
        {},
        [4, 2, 1].map((maxOccupancy) => ({ maxOccupancy })),
      );
      expect(
        (await service.search({ ...query, guests: 6, rooms: 2 })).total,
      ).toBe(1);
      expect(
        (await service.search({ ...query, guests: 7, rooms: 2 })).total,
      ).toBe(0);
      expect(
        (await service.search({ ...query, guests: 7, rooms: 3 })).total,
      ).toBe(1);
      expect((await service.search({ ...query, rooms: 4 })).total).toBe(0);
      expect((await service.search({ ...query, guests: 4 })).total).toBe(1);
      expect((await service.search({ ...query, guests: 5 })).total).toBe(0);
    });

    it.each(['reservation', 'blocked'] as const)(
      'excludes rooms with a %s night anywhere in the stay (holds use reservation nights too)',
      async (kind) => {
        const { hotel, seededRooms } = await seedHotel({}, [{}, {}]);
        await nights.create({
          hotelId: hotel._id,
          roomId: seededRooms[0]._id,
          date: addDays(checkIn, 1),
          kind,
          ...(kind === 'reservation'
            ? { reservationId: new Types.ObjectId() }
            : { blockId: new Types.ObjectId() }),
        });
        expect((await service.search({ ...query, rooms: 2 })).total).toBe(0);
        expect((await service.search(query)).total).toBe(1);
        expect(await nights.countDocuments()).toBe(1);
        expect(
          (await rooms.findById(seededRooms[0]._id).lean())?.inventoryVersion,
        ).toBe(0);
      },
    );

    it('includes the first night and excludes checkout when reading busy nights and availability', async () => {
      const { hotel, seededRooms } = await seedHotel();
      for (const date of [addDays(checkIn, -1), checkOut]) {
        await nights.create({
          hotelId: hotel._id,
          roomId: seededRooms[0]._id,
          date,
          kind: 'blocked',
          blockId: new Types.ObjectId(),
        });
      }
      expect((await service.search(query)).total).toBe(1);
      await nights.create({
        hotelId: hotel._id,
        roomId: seededRooms[0]._id,
        date: checkIn,
        kind: 'blocked',
        blockId: new Types.ObjectId(),
      });
      expect((await service.search(query)).total).toBe(0);
    });

    it('rejects inactive rooms, gaps in availability and switching rooms during the stay', async () => {
      await seedHotel({}, [
        { isActive: false },
        { availability: [] },
        {
          availability: [
            { fromDate: checkIn, toDate: checkIn },
            { fromDate: addDays(checkIn, 2), toDate: checkOut },
          ],
        },
        {
          availability: [{ fromDate: addDays(checkIn, 1), toDate: checkOut }],
        },
      ]);
      expect((await service.search(query)).total).toBe(0);
    });

    it.each([
      { occupancies: [1, 2], guests: 2, count: 1, price: 20000 },
      { occupancies: [1, 2, 4], guests: 6, count: 2, price: 20000 },
      { occupancies: [1, 2, 4], guests: 5, count: 2, price: 10000 },
      { occupancies: [2, 2, 4], guests: 6, count: 2, price: 10000 },
      { occupancies: [1, 2, 4], guests: 7, count: 3, price: 10000 },
    ])(
      'prices only rooms that fit $guests guests with $count rooms of capacities $occupancies',
      async ({ occupancies, guests, count, price }) => {
        await seedHotel(
          {},
          occupancies.map((maxOccupancy, index) => ({
            maxOccupancy,
            pricePerNightMinor: (index + 1) * 10000,
          })),
        );
        const search = { ...query, guests, rooms: count };
        const result = await service.search(search);
        expect(result.items[0]?.pricePerNightMinor).toBe(price);
        expect(
          (await service.search({ ...search, maxPriceMinor: price - 1 })).total,
        ).toBe(0);
        expect(
          (
            await service.search({
              ...search,
              minPriceMinor: price,
              maxPriceMinor: price,
            })
          ).total,
        ).toBe(1);
      },
    );

    it('sorts and paginates using the capacity-qualified nightly price', async () => {
      const misleading = await seedHotel({}, [
        { maxOccupancy: 1, pricePerNightMinor: 100 },
        { maxOccupancy: 2, pricePerNightMinor: 20000 },
      ]);
      const cheaper = await seedHotel({}, [{ pricePerNightMinor: 10000 }]);
      const result = await service.search({
        ...query,
        sortBy: 'price',
        limit: 1,
      });
      expect(result.items.map((hotel) => hotel.id)).toEqual([
        cheaper.hotel._id.toHexString(),
      ]);
      expect(result.total).toBe(2);
      expect(
        (
          await service.search({
            ...query,
            sortBy: 'price',
            page: 2,
            limit: 1,
          })
        ).items.map((hotel) => hotel.id),
      ).toEqual([misleading.hotel._id.toHexString()]);
    });

    it('filters inclusively on the cheapest qualifying whole-stay room, not room sums or stay totals', async () => {
      const { hotel, seededRooms } = await seedHotel({}, [
        { maxOccupancy: 4, pricePerNightMinor: 10000 },
        { pricePerNightMinor: 20000 },
        { pricePerNightMinor: 1 },
        { pricePerNightMinor: 2, isActive: false },
        { pricePerNightMinor: 3, availability: [] },
      ]);
      await nights.create({
        hotelId: hotel._id,
        roomId: seededRooms[2]._id,
        date: checkIn,
        kind: 'reservation',
        reservationId: new Types.ObjectId(),
      });
      const matching = await service.search({
        ...query,
        guests: 6,
        rooms: 2,
        minPriceMinor: 10000,
        maxPriceMinor: 10000,
      });
      expect(matching.total).toBe(1);
      expect(matching.items[0].pricePerNightMinor).toBe(10000);
      expect(
        (await service.search({ ...query, maxPriceMinor: 9999 })).total,
      ).toBe(0);
      expect(
        (await service.search({ ...query, minPriceMinor: 10001 })).total,
      ).toBe(0);
    });

    it('filters and sorts by guest averages rather than stars, keeping unrated hotels last', async () => {
      const unrated = await seedHotel({ starRating: 5 });
      const lower = await seedHotel(
        { starRating: 1, ratingSummary: { average: 3.5, count: 2 } },
        [{ pricePerNightMinor: 30000 }],
      );
      const higher = await seedHotel(
        { starRating: 2, ratingSummary: { average: 4.8, count: 10 } },
        [{ pricePerNightMinor: 20000 }],
      );
      expect((await service.search(query)).total).toBe(3);
      const rated = await service.search({ ...query, minRating: 3.5 });
      expect(rated.total).toBe(2);
      expect(
        rated.items.every((hotel) => hotel.ratingSummary.average !== null),
      ).toBe(true);
      expect((await service.search({ ...query, minRating: 5 })).total).toBe(0);

      for (const sortOrder of ['asc', 'desc'] as const) {
        const result = await service.search({
          ...query,
          sortBy: 'rating',
          sortOrder,
        });
        expect(result.items.map((hotel) => hotel.id)).toEqual([
          ...(sortOrder === 'asc'
            ? [lower.hotel._id.toHexString(), higher.hotel._id.toHexString()]
            : [higher.hotel._id.toHexString(), lower.hotel._id.toHexString()]),
          unrated.hotel._id.toHexString(),
        ]);
      }
      const ascending = await service.search({ ...query, sortBy: 'price' });
      expect(ascending.items.map((hotel) => hotel.pricePerNightMinor)).toEqual([
        10000, 20000, 30000,
      ]);
      const descending = await service.search({
        ...query,
        sortBy: 'price',
        sortOrder: 'desc',
      });
      expect(descending.items.map((hotel) => hotel.pricePerNightMinor)).toEqual(
        [30000, 20000, 10000],
      );
    });

    it('paginates after qualification and sorting, including ties and out-of-range pages', async () => {
      await Promise.all(Array.from({ length: 12 }, () => seedHotel()));
      await seedHotel({ isActive: false });
      const first = await service.search({ ...query, sortBy: 'price' });
      const second = await service.search({
        ...query,
        sortBy: 'price',
        page: 2,
      });
      expect(first).toMatchObject({
        page: 1,
        limit: 10,
        total: 12,
        totalPages: 2,
      });
      expect(first.items).toHaveLength(10);
      expect(second.items).toHaveLength(2);
      expect(
        new Set([...first.items, ...second.items].map((hotel) => hotel.id))
          .size,
      ).toBe(12);
      expect(await service.search({ ...query, page: 3 })).toEqual({
        items: [],
        page: 3,
        limit: 10,
        total: 12,
        totalPages: 2,
      });
    });

    it('allows check-in today in UTC', async () => {
      const today = toDateOnly(new Date().toISOString().slice(0, 10));
      await seedHotel({}, [
        { availability: [{ fromDate: today, toDate: today }] },
      ]);
      expect(
        (
          await service.search({
            ...query,
            checkIn: today,
            checkOut: addDays(today, 1),
          })
        ).total,
      ).toBe(1);
    });

    it.each<[string, Partial<HotelSearchQuery>]>([
      ['cityId', { cityId: undefined }],
      ['checkIn', { checkIn: toDateOnly('2000-01-01') }],
      ['checkIn', { checkIn: new Date('invalid') }],
      ['checkOut', { checkOut: checkIn }],
      ['checkOut', { checkOut: addDays(checkIn, -1) }],
      ['guests', { guests: 0 }],
      ['rooms', { rooms: 1.5 }],
      ['page', { page: 0 }],
      ['limit', { limit: 51 }],
      ['minPrice', { minPriceMinor: -1 }],
      ['maxPrice', { maxPriceMinor: 1.5 }],
      ['maxPrice', { minPriceMinor: 200, maxPriceMinor: 100 }],
      ['minRating', { minRating: 0 }],
    ])('rejects invalid %s at the service boundary', async (field, invalid) => {
      await expect(
        service.search({ ...query, ...invalid }),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: ErrorCode.ValidationFailed,
          details: expect.arrayContaining([expect.objectContaining({ field })]),
        },
      });
    });
  });

  describe('room blocks, deactivation and deletion (HTL-06)', () => {
    let hotelId: string;
    let roomId: string;
    let today: Date;
    let fromDate: Date;
    let toDate: Date;

    beforeEach(async () => {
      today = toDateOnly(new Date().toISOString().slice(0, 10));
      fromDate = addDays(today, 2);
      toDate = addDays(today, 4);
      hotelId = (await service.create(profile)).id;
      const room = await rooms.create({
        hotelId,
        name: '101',
        type: 'Double',
        beds: 1,
        maxOccupancy: 2,
        pricePerNightMinor: 10000,
        availability: [{ fromDate: today, toDate: addDays(today, 30) }],
      });
      roomId = room._id.toHexString();
    });

    function blockInput(from = fromDate, to = toDate) {
      return {
        op: 'BLOCK' as const,
        fromDate: from.toISOString().slice(0, 10),
        toDate: to.toISOString().slice(0, 10),
      };
    }

    async function reserve(from = fromDate, to = addDays(toDate, 1)) {
      const reservationId = new Types.ObjectId().toHexString();
      await t.connection.transaction((session) =>
        inventory.reserve(hotelId, [roomId], from, to, reservationId, {
          session,
        }),
      );
      return reservationId;
    }

    it('blocks inclusive nights and rolls back an entire overlapping block, including its room version', async () => {
      const { blockId } = await service.manageRoomBlock(
        hotelId.toUpperCase(),
        roomId.toUpperCase(),
        blockInput(),
        hotelId,
      );
      expect(
        await nights.find({ blockId }).sort({ date: 1 }).distinct('date'),
      ).toEqual([fromDate, addDays(fromDate, 1), toDate]);
      const before = await rooms.findById(roomId).lean();
      await expect(
        service.manageRoomBlock(
          hotelId,
          roomId,
          blockInput(toDate, addDays(toDate, 2)),
          hotelId,
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: ErrorCode.OverlapsReservationOrBlock },
      });
      expect(await nights.countDocuments()).toBe(3);
      expect(await rooms.findById(roomId).lean()).toEqual(before);
      await service.manageRoomBlock(
        hotelId,
        roomId,
        blockInput(addDays(toDate, 1), addDays(toDate, 1)),
        hotelId,
      );
      expect(await nights.countDocuments()).toBe(4);
    });

    it('unblocks only the named room block, preserving another block and reservation nights', async () => {
      const first = await service.manageRoomBlock(
        hotelId,
        roomId,
        blockInput(),
        hotelId,
      );
      const second = await service.manageRoomBlock(
        hotelId,
        roomId,
        blockInput(addDays(toDate, 2), addDays(toDate, 2)),
        hotelId,
      );
      const reservationId = await reserve(
        addDays(toDate, 3),
        addDays(toDate, 4),
      );
      expect(
        await service.manageRoomBlock(
          hotelId,
          roomId,
          { op: 'UNBLOCK', blockId: first.blockId.toUpperCase() },
          hotelId,
        ),
      ).toEqual(first);
      expect(await nights.countDocuments({ blockId: first.blockId })).toBe(0);
      expect(await nights.countDocuments({ blockId: second.blockId })).toBe(1);
      expect(await nights.countDocuments({ reservationId })).toBe(1);
      await expect(
        service.manageRoomBlock(
          hotelId,
          roomId,
          { op: 'UNBLOCK', blockId: first.blockId },
          hotelId,
        ),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: ErrorCode.NotFound },
      });
    });

    it.each([0, 2])(
      'rejects blocking, deactivation and deletion for reservation nights %i days from today without partial changes',
      async (offset) => {
        const from = addDays(today, offset);
        await reserve(from, addDays(from, 1));
        const before = await rooms.findById(roomId).lean();
        for (const [action, code] of [
          [
            () =>
              service.manageRoomBlock(
                hotelId,
                roomId,
                blockInput(from, from),
                hotelId,
              ),
            ErrorCode.OverlapsReservationOrBlock,
          ],
          [
            () => service.deactivateRoom(hotelId, roomId, hotelId),
            ErrorCode.RoomHasReservations,
          ],
          [
            () => service.deleteRoom(hotelId, roomId, hotelId),
            ErrorCode.RoomHasReservations,
          ],
        ] as const) {
          await expect(action()).rejects.toMatchObject({
            status: 409,
            response: { code },
          });
          expect(await rooms.findById(roomId).lean()).toEqual(before);
          expect(await nights.countDocuments()).toBe(1);
        }
      },
    );

    it('allows deactivation after release but never deletion of a previously reserved room', async () => {
      const reservationId = await reserve();
      await t.connection.transaction((session) =>
        inventory.release(reservationId, { session }),
      );
      const deactivated = await service.deactivateRoom(
        hotelId,
        roomId,
        hotelId,
      );
      expect(deactivated).toMatchObject({
        id: roomId,
        isActive: false,
        hasEverBeenReserved: true,
      });
      await expect(reserve()).rejects.toMatchObject({
        response: { code: ErrorCode.RoomsUnavailable },
      });
      await expect(
        service.deleteRoom(hotelId, roomId, hotelId),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: ErrorCode.RoomWasReserved },
      });
      expect(await rooms.countDocuments()).toBe(1);
      expect(await nights.countDocuments()).toBe(0);
    });

    it('permits deactivation with only past reservation nights, but preserves the room and history', async () => {
      await rooms.updateOne(
        { _id: roomId },
        { $set: { hasEverBeenReserved: true } },
      );
      await nights.create({
        roomId,
        hotelId,
        date: addDays(today, -1),
        kind: 'reservation',
        reservationId: new Types.ObjectId(),
      });
      expect(
        await service.deactivateRoom(hotelId, roomId, hotelId),
      ).toMatchObject({ isActive: false });
      expect(await nights.countDocuments()).toBe(1);
      await expect(
        service.deleteRoom(hotelId, roomId, hotelId),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.RoomWasReserved },
      });
    });

    it('deletes a never-reserved room and every blocked night in the same transaction', async () => {
      await service.manageRoomBlock(hotelId, roomId, blockInput(), hotelId);
      await service.deleteRoom(hotelId, roomId, hotelId);
      expect(await rooms.findById(roomId)).toBeNull();
      expect(await nights.countDocuments()).toBe(0);
    });

    it.each(['BLOCK', 'DEACTIVATE', 'DELETE'] as const)(
      'preserves inventory when a booking races %s through the service',
      async (action) => {
        const change = () =>
          action === 'BLOCK'
            ? service.manageRoomBlock(hotelId, roomId, blockInput(), hotelId)
            : action === 'DEACTIVATE'
              ? service.deactivateRoom(hotelId, roomId, hotelId)
              : service.deleteRoom(hotelId, roomId, hotelId);
        const results = await Promise.allSettled([reserve(), change()]);
        expect(
          results.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        expect(
          results.filter((result) => result.status === 'rejected'),
        ).toHaveLength(1);
        const reserved = await nights.countDocuments({ kind: 'reservation' });
        const blocked = await nights.countDocuments({ kind: 'blocked' });
        const room = await rooms.findById(roomId).lean();
        if (reserved > 0) {
          expect(reserved).toBe(3);
          expect(blocked).toBe(0);
          expect(room).toMatchObject({
            isActive: true,
            hasEverBeenReserved: true,
          });
        } else if (action === 'BLOCK') {
          expect(blocked).toBe(3);
          expect(room).toMatchObject({
            isActive: true,
            hasEverBeenReserved: false,
          });
        } else if (action === 'DEACTIVATE') {
          expect(blocked).toBe(0);
          expect(room).toMatchObject({
            isActive: false,
            hasEverBeenReserved: false,
          });
        } else {
          expect(blocked).toBe(0);
          expect(room).toBeNull();
        }
      },
    );

    it('validates operation-specific fields and dates before changing inventory', async () => {
      for (const input of [
        { op: 'BLOCK' as const },
        { ...blockInput(), fromDate: '2026-02-29' },
        { ...blockInput(), toDate: '2026-02-30' },
        { ...blockInput(), fromDate: '2026-12-10', toDate: '2026-12-09' },
        { ...blockInput(), blockId: new Types.ObjectId().toHexString() },
        { op: 'UNBLOCK' as const },
        { op: 'UNBLOCK' as const, blockId: 'invalid' },
      ]) {
        await expect(
          service.manageRoomBlock(hotelId, roomId, input, hotelId),
        ).rejects.toMatchObject({
          status: 400,
          response: { code: ErrorCode.ValidationFailed },
        });
      }
      expect(await nights.countDocuments()).toBe(0);
      expect(await rooms.findById(roomId).lean()).toMatchObject({
        inventoryVersion: 0,
        isActive: true,
      });
    });
  });

  describe('hotel policies (HTL-09, HTL-10)', () => {
    const policies = {
      checkInTime: '15:30',
      checkOutTime: '11:00',
      cancellationPolicy: {
        tiers: [
          { daysBefore: 0, refundPercent: 0 },
          { daysBefore: 7, refundPercent: 100 },
          { daysBefore: 2, refundPercent: 50 },
        ],
      },
    };

    it('replaces only policy fields and leaves previously read policies detached', async () => {
      const created = await service.create(profile);
      const updated = await service.updatePolicies(
        created.id,
        policies,
        created.id,
      );
      expect(updated).toEqual({ ...created, ...policies });
      expect(await service.getHotel(created.id)).toEqual(updated);
      const cleared = { ...policies, cancellationPolicy: { tiers: [] } };
      expect(
        await service.updatePolicies(created.id, cleared, created.id),
      ).toEqual({ ...created, ...cleared });
      expect(updated.cancellationPolicy).toEqual(policies.cancellationPolicy);
      expect(created.cancellationPolicy).toEqual({ tiers: [] });
    });

    it('validates the entire policy update before saving any field', async () => {
      const created = await service.create(profile);
      for (const invalid of [
        { ...policies, checkInTime: '24:00' },
        { ...policies, checkOutTime: '12:60' },
        {
          ...policies,
          cancellationPolicy: {
            tiers: [
              { daysBefore: 7, refundPercent: 100 },
              { daysBefore: 7, refundPercent: 50 },
            ],
          },
        },
        {
          ...policies,
          cancellationPolicy: {
            tiers: [{ daysBefore: -1, refundPercent: 101 }],
          },
        },
      ]) {
        await expect(
          service.updatePolicies(created.id, invalid, created.id),
        ).rejects.toMatchObject({ name: 'ValidationError' });
        expect(await service.getHotel(created.id)).toEqual(created);
      }
    });

    it('rejects missing assignments, other hotels, missing hotels and malformed IDs', async () => {
      const created = await service.create(profile);
      const missing = new Types.ObjectId().toHexString();
      for (const assignment of [undefined, missing, 'invalid']) {
        await expect(
          service.updatePolicies(created.id, policies, assignment),
        ).rejects.toMatchObject({
          status: 404,
          response: { code: ErrorCode.NotFound },
        });
      }
      for (const input of [policies, { ...policies, checkInTime: '24:00' }]) {
        await expect(
          service.updatePolicies(missing, input, missing),
        ).rejects.toMatchObject({
          status: 404,
          response: { code: ErrorCode.NotFound },
        });
      }
      await expect(
        service.updatePolicies('invalid', policies, created.id),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: ErrorCode.ValidationFailed },
      });
      expect(await service.getHotel(created.id)).toEqual(created);
    });
  });

  describe('room availability and edits (HTL-04 / HTL-05)', () => {
    const input = {
      name: '101',
      type: 'Double',
      beds: 1,
      maxOccupancy: 2,
      pricePerNightMinor: 10000,
    };
    const range = { fromDate: '2099-12-01', toDate: '2099-12-05' };

    async function fixture() {
      const hotel = await service.create(profile);
      const room = await service.createRoom(hotel.id, input, hotel.id);
      return { hotelId: hotel.id, roomId: room.id };
    }

    async function reserve(hotelId: string, roomId: string) {
      const session = await t.connection.startSession();
      try {
        await session.withTransaction(() =>
          t.moduleRef
            .get(RoomNightInventory)
            .reserve(
              hotelId,
              [roomId],
              toDateOnly(range.fromDate),
              toDateOnly('2099-12-03'),
              new Types.ObjectId().toHexString(),
              { session },
            ),
        );
      } finally {
        await session.endSession();
      }
    }

    it('adds ranges without losing existing dates, sorts and merges adjacent nights', async () => {
      const { hotelId, roomId } = await fixture();
      await service.addRoomAvailability(hotelId, roomId, range, hotelId);
      await service.addRoomAvailability(
        hotelId,
        roomId,
        { fromDate: '2099-12-10', toDate: '2099-12-10' },
        hotelId,
      );
      const updated = await service.addRoomAvailability(
        hotelId,
        roomId,
        { fromDate: '2099-12-06', toDate: '2099-12-09' },
        hotelId,
      );
      expect(updated.availability).toEqual([
        {
          fromDate: toDateOnly('2099-12-01'),
          toDate: toDateOnly('2099-12-10'),
        },
      ]);
      expect(await rooms.findById(roomId).lean()).toMatchObject({
        inventoryVersion: 3,
      });
    });

    it('replaces all ranges and allows clearing an unreserved room', async () => {
      const { hotelId, roomId } = await fixture();
      await service.addRoomAvailability(hotelId, roomId, range, hotelId);
      const updated = await service.setRoomAvailability(
        hotelId,
        roomId,
        {
          op: 'SET_RANGES',
          ranges: [
            { fromDate: '2099-12-12', toDate: '2099-12-13' },
            { fromDate: '2099-12-10', toDate: '2099-12-11' },
          ],
        },
        hotelId,
      );
      expect(updated.availability).toEqual([
        {
          fromDate: toDateOnly('2099-12-10'),
          toDate: toDateOnly('2099-12-13'),
        },
      ]);
      expect(
        await service.setRoomAvailability(
          hotelId,
          roomId,
          { op: 'SET_RANGES', ranges: [] },
          hotelId,
        ),
      ).toMatchObject({ availability: [] });
    });

    it('rejects overlapping additions and replacements without partial changes', async () => {
      const { hotelId, roomId } = await fixture();
      const original = await service.addRoomAvailability(
        hotelId,
        roomId,
        range,
        hotelId,
      );
      const overlapping = { fromDate: '2099-12-05', toDate: '2099-12-07' };
      for (const change of [
        () =>
          service.addRoomAvailability(hotelId, roomId, overlapping, hotelId),
        () =>
          service.setRoomAvailability(
            hotelId,
            roomId,
            { op: 'SET_RANGES', ranges: [range, overlapping] },
            hotelId,
          ),
      ]) {
        await expect(change()).rejects.toMatchObject({
          status: 400,
          response: { code: ErrorCode.ValidationFailed },
        });
        expect(await service.getRooms(hotelId)).toEqual([original]);
        expect(await rooms.findById(roomId).lean()).toMatchObject({
          inventoryVersion: 1,
        });
      }
    });

    it('preserves reserved nights and rolls back rejected availability removal', async () => {
      const { hotelId, roomId } = await fixture();
      await service.addRoomAvailability(hotelId, roomId, range, hotelId);
      await reserve(hotelId, roomId);
      const original = await rooms.findById(roomId).lean();
      for (const ranges of [
        [],
        [{ fromDate: '2099-12-02', toDate: '2099-12-05' }],
      ]) {
        await expect(
          service.setRoomAvailability(
            hotelId,
            roomId,
            { op: 'SET_RANGES', ranges },
            hotelId,
          ),
        ).rejects.toMatchObject({
          status: 409,
          response: { code: ErrorCode.AvailabilityHasReservations },
        });
        expect(await rooms.findById(roomId).lean()).toEqual(original);
      }
      const updated = await service.setRoomAvailability(
        hotelId,
        roomId,
        {
          op: 'SET_RANGES',
          ranges: [{ fromDate: '2099-12-01', toDate: '2099-12-02' }],
        },
        hotelId,
      );
      expect(updated.availability).toEqual([
        {
          fromDate: toDateOnly('2099-12-01'),
          toDate: toDateOnly('2099-12-02'),
        },
      ]);
      expect(
        await t.connection.model<RoomNight>(RoomNight.name).countDocuments(),
      ).toBe(2);
    });

    it('edits only beds, occupancy and price and leaves held room views and inventory unchanged', async () => {
      const { hotelId, roomId } = await fixture();
      const quoted = await service.addRoomAvailability(
        hotelId,
        roomId,
        range,
        hotelId,
      );
      await reserve(hotelId, roomId);
      const before = await rooms.findById(roomId).lean();
      const nights = t.connection.model<RoomNight>(RoomNight.name);
      const held = await nights.find().lean();
      const supplied = {
        beds: 2,
        maxOccupancy: 4,
        pricePerNightMinor: 12000,
        name: 'spoofed',
        hotelId: new Types.ObjectId().toHexString(),
        isActive: false,
        availability: [],
        hasEverBeenReserved: false,
      };
      const updated = await service.updateRoom(
        hotelId,
        roomId,
        supplied,
        hotelId,
      );
      expect(updated).toEqual({
        ...quoted,
        beds: 2,
        maxOccupancy: 4,
        pricePerNightMinor: 12000,
        hasEverBeenReserved: true,
      });
      expect(quoted.pricePerNightMinor).toBe(10000);
      expect(await nights.find().lean()).toEqual(held);
      expect(await rooms.findById(roomId).lean()).toMatchObject({
        inventoryVersion: before?.inventoryVersion,
      });
      const partial = await service.updateRoom(
        hotelId,
        roomId,
        { beds: 1 },
        hotelId,
      );
      expect(partial).toEqual({ ...updated, beds: 1 });
      await expect(
        service.updateRoom(
          hotelId,
          roomId,
          { beds: 3, pricePerNightMinor: 0 },
          hotelId,
        ),
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect(await service.getRooms(hotelId)).toEqual([partial]);
    });

    it('hides rooms outside the assigned hotel and validates malformed IDs for all edits', async () => {
      const { hotelId, roomId } = await fixture();
      const other = await service.create(profile);
      const missing = new Types.ObjectId().toHexString();
      const operations = (
        hotel: string,
        room: string,
        assigned: string | undefined,
      ) => [
        () => service.updateRoom(hotel, room, { beds: 2 }, assigned),
        () => service.addRoomAvailability(hotel, room, range, assigned),
        () =>
          service.setRoomAvailability(
            hotel,
            room,
            { op: 'SET_RANGES', ranges: [] },
            assigned,
          ),
      ];
      const scopes: [string, string, string | undefined][] = [
        [hotelId, roomId, other.id],
        [hotelId, roomId, undefined],
        [other.id, roomId, other.id],
        [hotelId, missing, hotelId],
        [missing, roomId, missing],
      ];
      for (const [hotel, room, assigned] of scopes) {
        for (const operation of operations(hotel, room, assigned)) {
          await expect(operation()).rejects.toMatchObject({
            status: 404,
            response: { code: ErrorCode.NotFound },
          });
        }
      }
      for (const operation of operations(hotelId, 'invalid', hotelId)) {
        await expect(operation()).rejects.toMatchObject({
          status: 400,
          response: { code: ErrorCode.ValidationFailed },
        });
      }
      expect((await service.getRooms(hotelId))[0]).toMatchObject({
        ...input,
        availability: [],
      });
    });

    it('retains both successful concurrent additions rather than overwriting one', async () => {
      const { hotelId, roomId } = await fixture();
      const results = await Promise.allSettled([
        service.addRoomAvailability(hotelId, roomId, range, hotelId),
        service.addRoomAvailability(
          hotelId,
          roomId,
          { fromDate: '2099-12-10', toDate: '2099-12-12' },
          hotelId,
        ),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(2);
      expect((await service.getRooms(hotelId))[0].availability).toEqual([
        {
          fromDate: toDateOnly(range.fromDate),
          toDate: toDateOnly(range.toDate),
        },
        {
          fromDate: toDateOnly('2099-12-10'),
          toDate: toDateOnly('2099-12-12'),
        },
      ]);
    });

    it('never leaves a concurrent reservation outside the saved availability', async () => {
      const { hotelId, roomId } = await fixture();
      await service.addRoomAvailability(hotelId, roomId, range, hotelId);
      const results = await Promise.allSettled([
        reserve(hotelId, roomId),
        service.setRoomAvailability(
          hotelId,
          roomId,
          { op: 'SET_RANGES', ranges: [] },
          hotelId,
        ),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const saved = (await service.getRooms(hotelId))[0];
      const held = await t.connection
        .model<RoomNight>(RoomNight.name)
        .find()
        .lean();
      for (const night of held) {
        expect(
          saved.availability.some(
            ({ fromDate, toDate }) =>
              fromDate <= night.date && night.date <= toDate,
          ),
        ).toBe(true);
      }
      expect(held.length).toBe(saved.availability.length ? 2 : 0);
    });
  });

  describe('rooms (HTL-03)', () => {
    const input = {
      name: '101',
      type: 'Deluxe King',
      beds: 1,
      maxOccupancy: 2,
      pricePerNightMinor: 10000,
    };

    it('creates a detached plain room view and allowlists fields with safe defaults', async () => {
      const hotel = await service.create(profile);
      const supplied = {
        ...input,
        name: ' Room A ',
        type: ' Deluxe King ',
        hotelId: new Types.ObjectId().toHexString(),
        isActive: false,
        hasEverBeenReserved: true,
        inventoryVersion: 99,
        availability: [{ fromDate: new Date(), toDate: new Date() }],
      };
      const room = await service.createRoom(
        hotel.id.toUpperCase(),
        supplied,
        hotel.id,
      );
      expect(room).toEqual({
        ...input,
        name: 'room a',
        id: expect.stringMatching(/^[a-f0-9]{24}$/),
        hotelId: hotel.id,
        isActive: true,
        availability: [],
        hasEverBeenReserved: false,
      });
      expect(await rooms.findById(room.id).lean()).toMatchObject({
        hotelId: new Types.ObjectId(hotel.id),
        inventoryVersion: 0,
      });
      room.name = 'Changed response';
      expect((await service.getRooms(hotel.id))[0]?.name).toBe('room a');
    });

    it('enforces case-insensitive trimmed name uniqueness under concurrency, but allows the same name in another hotel', async () => {
      const hotel = await service.create(profile);
      const results = await Promise.allSettled(
        ['Room A', ' ROOM a ', 'room A'].map((name) =>
          service.createRoom(hotel.id, { ...input, name }, hotel.id),
        ),
      );
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(rejected).toHaveLength(2);
      for (const result of rejected) {
        expect(result.reason).toMatchObject({
          status: 409,
          response: { code: ErrorCode.Conflict },
        });
      }
      expect(await rooms.countDocuments({ hotelId: hotel.id })).toBe(1);
      const other = await service.create({ ...profile, name: 'Other Hotel' });
      expect((await service.getRooms(hotel.id))[0]?.name).toBe('room a');
      expect(
        await service.createRoom(
          other.id,
          { ...input, name: 'ROOM A' },
          other.id,
        ),
      ).toMatchObject({ name: 'room a', hotelId: other.id });
    });

    it('rejects legacy mixed-case name collisions literally, including inactive rooms, without rewriting stored names', async () => {
      const hotel = await service.create(profile);
      const legacy = await rooms.create({
        ...input,
        name: 'Suite [A].* (East)?$',
        hotelId: hotel.id,
        isActive: false,
      });
      await expect(
        service.createRoom(
          hotel.id,
          { ...input, name: ' suite [a].* (east)?$ ' },
          hotel.id,
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: ErrorCode.Conflict },
      });
      expect(await rooms.countDocuments({ hotelId: hotel.id })).toBe(1);
      expect((await rooms.findById(legacy._id).lean())?.name).toBe(
        'Suite [A].* (East)?$',
      );
      for (const name of [
        'Suite A East',
        'Prefix Suite [A].* (East)?$ Suffix',
      ]) {
        expect(
          await service.createRoom(hotel.id, { ...input, name }, hotel.id),
        ).toMatchObject({ name: name.toLowerCase() });
      }
    });

    it('checks assignment and hotel existence for both moderator operations before writing', async () => {
      const hotel = await service.create(profile);
      const missing = new Types.ObjectId().toHexString();
      for (const assignment of [undefined, 'invalid', missing]) {
        await expect(
          service.createRoom(hotel.id, input, assignment),
        ).rejects.toMatchObject({
          status: 404,
          response: { code: ErrorCode.NotFound },
        });
        await expect(
          service.listRooms(hotel.id, new PaginationQueryDto(), assignment),
        ).rejects.toMatchObject({
          status: 404,
          response: { code: ErrorCode.NotFound },
        });
      }
      await expect(
        service.createRoom(missing, input, missing),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.NotFound },
      });
      await expect(
        service.listRooms(missing, new PaginationQueryDto(), missing),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.NotFound },
      });
      expect(await rooms.countDocuments()).toBe(0);
    });

    it('paginates only the assigned hotel rooms and includes inactive rooms in both views', async () => {
      const hotel = await service.create(profile);
      const created = [];
      for (const name of ['101', '102', '103']) {
        created.push(
          await service.createRoom(hotel.id, { ...input, name }, hotel.id),
        );
      }
      await rooms.updateOne(
        { _id: created[1]!.id },
        { $set: { isActive: false } },
      );
      const other = await service.create({ ...profile, name: 'Other Hotel' });
      await service.createRoom(other.id, input, other.id);
      const all = await service.getRooms(hotel.id);
      expect(all.map((room) => [room.name, room.isActive])).toEqual([
        ['101', true],
        ['102', false],
        ['103', true],
      ]);
      expect(
        await service.listRooms(hotel.id, { page: 2, limit: 2 }, hotel.id),
      ).toEqual({
        items: [all[2]],
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(
        await service.listRooms(hotel.id, { page: 3, limit: 2 }, hotel.id),
      ).toMatchObject({
        items: [],
        total: 3,
        totalPages: 2,
      });
      const empty = await service.create({ ...profile, name: 'Empty Hotel' });
      expect(
        await service.listRooms(empty.id, new PaginationQueryDto(), empty.id),
      ).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
      expect(
        await service.getRooms(new Types.ObjectId().toHexString()),
      ).toEqual([]);
    });

    it('uses the caller transaction when reading room views', async () => {
      const hotel = await service.create(profile);
      const room = await service.createRoom(hotel.id, input, hotel.id);
      const session = await t.connection.startSession();
      try {
        session.startTransaction();
        await rooms.updateOne(
          { _id: room.id },
          { $set: { pricePerNightMinor: 20000 } },
          { session },
        );
        expect(
          (await service.getRooms(hotel.id, { session }))[0]
            ?.pricePerNightMinor,
        ).toBe(20000);
        expect((await service.getRooms(hotel.id))[0]?.pricePerNightMinor).toBe(
          10000,
        );
        await session.abortTransaction();
      } finally {
        await session.endSession();
      }
    });

    it('rejects malformed hotel IDs and propagates unrelated database failures', async () => {
      for (const call of [
        () => service.createRoom('invalid', input, 'invalid'),
        () => service.listRooms('invalid', new PaginationQueryDto(), 'invalid'),
        () => service.getRooms('invalid'),
      ]) {
        await expect(call()).rejects.toMatchObject({
          status: 400,
          response: { code: ErrorCode.ValidationFailed },
        });
      }
      const hotel = await service.create(profile);
      const failure = new Error('Room insert failed');
      vi.spyOn(rooms.collection, 'insertOne').mockRejectedValueOnce(failure);
      await expect(service.createRoom(hotel.id, input, hotel.id)).rejects.toBe(
        failure,
      );
      expect(await rooms.countDocuments()).toBe(0);
    });
  });

  describe('hotel photos', () => {
    const image: UploadedImage = {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      originalname: 'hotel.jpg',
      mimetype: 'image/jpeg',
      size: 4,
    };

    it('stores image references and removes both the file and reference', async () => {
      const created = await service.create(profile);
      const updated = await service.addPhoto(created.id, image, created.id);
      const photo = updated.photos[0]!;
      expect(updated.photos).toHaveLength(1);
      expect(storage.bytesOf(photo.key)).toEqual(image.buffer);
      expect((await service.getHotel(created.id))?.photos).toEqual(
        updated.photos,
      );
      await service.removePhoto(created.id, photo.id, created.id);
      expect(storage.has(photo.key)).toBe(false);
      expect((await service.getHotel(created.id))?.photos).toEqual([]);
    });

    it('keeps exactly five photos under concurrent uploads and removes rejected files', async () => {
      const created = await service.create(profile);
      const outcomes = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          service.addPhoto(created.id, image, created.id),
        ),
      );
      expect(
        outcomes.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(5);
      const rejected = outcomes.filter(
        (result) => result.status === 'rejected',
      );
      expect(rejected).toHaveLength(3);
      for (const result of rejected) {
        expect(result.reason).toMatchObject({
          status: 400,
          response: { code: ErrorCode.LimitExceeded },
        });
      }
      const photos = (await service.getHotel(created.id))!.photos;
      expect(photos).toHaveLength(5);
      expect(new Set(photos.map((photo) => photo.id)).size).toBe(5);
      expect(storage.keys().sort()).toEqual(
        photos.map((photo) => photo.key).sort(),
      );
      await service.removePhoto(created.id, photos[0]!.id, created.id);
      expect(
        (await service.addPhoto(created.id, image, created.id)).photos,
      ).toHaveLength(5);
    });

    it('checks moderator scope and existence before accessing storage', async () => {
      const created = await service.create(profile);
      const photo = (await service.addPhoto(created.id, image, created.id))
        .photos[0]!;
      const save = vi.spyOn(storage, 'save');
      const remove = vi.spyOn(storage, 'delete');
      const missing = new Types.ObjectId().toHexString();
      for (const assignment of [undefined, missing]) {
        await expect(
          service.addPhoto(created.id, image, assignment),
        ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
        await expect(
          service.removePhoto(created.id, photo.id, assignment),
        ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
      }
      await expect(
        service.addPhoto(missing, image, missing),
      ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
      await expect(
        service.removePhoto(created.id, missing, created.id),
      ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
      expect(save).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(storage.has(photo.key)).toBe(true);
    });

    it('rejects missing, empty, unsupported and oversized images without attaching a photo', async () => {
      const created = await service.create(profile);
      for (const file of [
        undefined,
        { ...image, size: 0, buffer: Buffer.alloc(0) },
        { ...image, mimetype: 'application/pdf' },
        { ...image, size: MAX_IMAGE_BYTES + 1 },
      ]) {
        await expect(
          service.addPhoto(created.id, file, created.id),
        ).rejects.toMatchObject({
          response: { code: ErrorCode.ValidationFailed },
        });
      }
      expect((await service.getHotel(created.id))?.photos).toEqual([]);
      expect(storage.keys()).toEqual([]);
    });

    it('never removes a photo belonging to a different hotel', async () => {
      const created = await service.create(profile);
      const other = await service.create({ ...profile, name: 'Other Hotel' });
      const photo = (await service.addPhoto(other.id, image, other.id))
        .photos[0]!;
      await expect(
        service.removePhoto(created.id, photo.id, created.id),
      ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
      expect((await service.getHotel(other.id))?.photos).toEqual([photo]);
      expect(storage.has(photo.key)).toBe(true);
    });

    it('cleans up an unattached upload when the database write fails', async () => {
      const created = await service.create(profile);
      const failure = new Error('Photo database write failed');
      vi.spyOn(hotels.collection, 'findOneAndUpdate').mockRejectedValueOnce(
        failure,
      );
      await expect(
        service.addPhoto(created.id, image, created.id),
      ).rejects.toBe(failure);
      expect(storage.keys()).toEqual([]);
      expect((await service.getHotel(created.id))?.photos).toEqual([]);
    });

    it('does not delete an attached file when the database reply is lost after writing', async () => {
      const created = await service.create(profile);
      const failure = new Error('Photo database reply lost');
      const write = hotels.collection.findOneAndUpdate.bind(hotels.collection);
      vi.spyOn(hotels.collection, 'findOneAndUpdate').mockImplementationOnce(
        async (...args) => {
          await write(...args);
          throw failure;
        },
      );
      await expect(
        service.addPhoto(created.id, image, created.id),
      ).rejects.toBe(failure);
      const photos = (await service.getHotel(created.id))!.photos;
      expect(photos).toHaveLength(1);
      expect(storage.has(photos[0]!.key)).toBe(true);
    });

    it('surfaces both errors if an unsuccessful upload cannot be cleaned up', async () => {
      const created = await service.create(profile);
      const writeFailure = new Error('Photo database write failed');
      const cleanupFailure = new Error('Photo storage cleanup failed');
      vi.spyOn(hotels.collection, 'findOneAndUpdate').mockRejectedValueOnce(
        writeFailure,
      );
      vi.spyOn(storage, 'delete').mockRejectedValueOnce(cleanupFailure);
      await expect(
        service.addPhoto(created.id, image, created.id),
      ).rejects.toMatchObject({
        errors: [writeFailure, cleanupFailure],
      });
      expect((await service.getHotel(created.id))?.photos).toEqual([]);
      expect(storage.keys()).toHaveLength(1);
    });

    it('cleans an upload if its hotel disappears before attachment', async () => {
      const created = await service.create(profile);
      const save = storage.save.bind(storage);
      vi.spyOn(storage, 'save').mockImplementationOnce(async (file) => {
        const stored = await save(file);
        await hotels.deleteOne({ _id: created.id });
        return stored;
      });
      await expect(
        service.addPhoto(created.id, image, created.id),
      ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
      expect(storage.keys()).toEqual([]);
    });

    it('preserves the reference on a storage deletion failure and permits a retry', async () => {
      const created = await service.create(profile);
      const photo = (await service.addPhoto(created.id, image, created.id))
        .photos[0]!;
      const failure = new Error('Photo deletion failed');
      vi.spyOn(storage, 'delete').mockRejectedValueOnce(failure);
      await expect(
        service.removePhoto(created.id, photo.id, created.id),
      ).rejects.toBe(failure);
      expect(storage.has(photo.key)).toBe(true);
      expect((await service.getHotel(created.id))?.photos).toEqual([photo]);
      await service.removePhoto(created.id, photo.id, created.id);
      expect((await service.getHotel(created.id))?.photos).toEqual([]);
      expect(storage.keys()).toEqual([]);
    });

    it('retains the key for retry if the database removal fails after deleting the file', async () => {
      const created = await service.create(profile);
      const photo = (await service.addPhoto(created.id, image, created.id))
        .photos[0]!;
      const failure = new Error('Photo reference removal failed');
      vi.spyOn(hotels.collection, 'updateOne').mockRejectedValueOnce(failure);
      await expect(
        service.removePhoto(created.id, photo.id, created.id),
      ).rejects.toBe(failure);
      expect((await service.getHotel(created.id))?.photos).toEqual([photo]);
      expect(storage.has(photo.key)).toBe(false);
      await service.removePhoto(created.id, photo.id, created.id);
      expect((await service.getHotel(created.id))?.photos).toEqual([]);
    });

    it('handles simultaneous deletions without losing other photos', async () => {
      const created = await service.create(profile);
      await service.addPhoto(created.id, image, created.id);
      const photos = (await service.addPhoto(created.id, image, created.id))
        .photos;
      const results = await Promise.allSettled([
        service.removePhoto(created.id, photos[0]!.id, created.id),
        service.removePhoto(created.id, photos[0]!.id, created.id),
      ]);
      expect(results.some((result) => result.status === 'fulfilled')).toBe(
        true,
      );
      expect((await service.getHotel(created.id))?.photos).toEqual([photos[1]]);
      expect(storage.keys()).toEqual([photos[1]!.key]);
    });
  });

  it('persists a profile, derives country from the reference city, and returns the existing contract shape', async () => {
    const created = await service.create({
      ...profile,
      name: '  Nile View Hotel  ',
      address: '  1 Corniche El Nil  ',
      amenities: ['  Wi-Fi  ', 'Pool'],
    });
    expect(created).toEqual({
      ...profile,
      id: expect.any(String),
      countryCode: 'EG',
      photos: [],
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationPolicy: { tiers: [] },
      isActive: true,
      ratingSummary: { average: null, count: 0 },
    });
    const stored = await hotels.findById(created.id).lean().exec();
    expect(stored).toMatchObject({ name: profile.name, countryCode: 'EG' });
    expect(stored).not.toHaveProperty('id');
  });

  it('returns null for an unknown valid ID and does not hide inactive hotels from internal callers', async () => {
    expect(
      await service.getHotel(new Types.ObjectId().toHexString()),
    ).toBeNull();
    const created = await service.create(profile);
    await service.setActive(created.id, false);
    expect(await service.getHotel(created.id)).toMatchObject({
      isActive: false,
    });
  });

  it('rejects unknown cities without creating or partially editing a hotel', async () => {
    await expect(
      service.create({ ...profile, cityId: 'missing' }),
    ).rejects.toMatchObject({
      response: {
        code: ErrorCode.ValidationFailed,
        details: [{ field: 'cityId', message: expect.any(String) }],
      },
    });
    expect(await hotels.countDocuments()).toBe(0);
    const created = await service.create(profile);
    await expect(
      service.update(
        created.id,
        { name: 'Must not persist', cityId: 'missing' },
        created.id,
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.ValidationFailed } });
    expect(await service.getHotel(created.id)).toEqual(created);
  });

  it('allowlists profile inputs so direct callers cannot override protected fields', async () => {
    const input = {
      name: 'Minimal',
      address: 'Address',
      cityId: 'cairo',
      countryCode: 'US',
      isActive: false,
      ratingSummary: { average: 5, count: 100 },
      photos: [{ _id: new Types.ObjectId(), key: 'unexpected.jpg' }],
      checkInTime: '01:00',
      cancellationPolicy: { tiers: [{ daysBefore: 0, refundPercent: 100 }] },
    };
    const created = await service.create(input);
    expect(created).toMatchObject({
      countryCode: 'EG',
      isActive: true,
      ratingSummary: { average: null, count: 0 },
      photos: [],
      amenities: [],
      checkInTime: '14:00',
      cancellationPolicy: { tiers: [] },
    });
    expect(created).not.toHaveProperty('description');
    expect(created).not.toHaveProperty('starRating');
    expect(await service.update(created.id, input, created.id)).toEqual(
      created,
    );
  });

  it('edits only supplied profile fields and updates country when the city changes', async () => {
    const created = await service.create(profile);
    const updated = await service.update(
      created.id,
      { name: '  Dubai View  ', cityId: 'dubai' },
      created.id,
    );
    expect(updated).toEqual({
      ...created,
      name: 'Dubai View',
      cityId: 'dubai',
      countryCode: 'AE',
    });
  });

  it('supports description, star-rating, address, and amenities edits including explicit empty lists', async () => {
    const created = await service.create(profile);
    const updated = await service.update(
      created.id,
      {
        address: '  New Address  ',
        description: '',
        starRating: 5,
        amenities: [],
      },
      created.id,
    );
    expect(updated).toMatchObject({
      address: 'New Address',
      description: '',
      starRating: 5,
      amenities: [],
    });
    expect(await service.update(created.id, {}, created.id)).toEqual(updated);
  });

  it('rejects edits to another moderator hotel before performing reference lookups', async () => {
    const created = await service.create(profile);
    const lookup = vi.spyOn(referenceData, 'getCity');
    await expect(
      service.update(
        created.id,
        { cityId: 'dubai' },
        new Types.ObjectId().toHexString(),
      ),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    expect(lookup).not.toHaveBeenCalled();
    expect(await service.getHotel(created.id)).toEqual(created);
  });

  it('reports missing hotels for editing, activation, and rating updates', async () => {
    const id = new Types.ObjectId().toHexString();
    for (const call of [
      () => service.update(id, { name: 'Missing' }, id),
      () => service.setActive(id, false),
      () => service.setRatingSummary(id, { average: 4, count: 1 }),
    ]) {
      await expect(call()).rejects.toMatchObject({
        response: { code: ErrorCode.NotFound },
      });
    }
  });

  it('refuses edits without a valid trusted moderator assignment', async () => {
    const created = await service.create(profile);
    for (const assignment of [undefined, '', 'not-an-objectid']) {
      await expect(
        service.update(created.id, { name: 'Denied' }, assignment),
      ).rejects.toMatchObject({ response: { code: ErrorCode.NotFound } });
    }
    expect(await service.getHotel(created.id)).toEqual(created);
  });

  it('changes activation and ratings without overwriting profile, policy, or photo fields', async () => {
    const created = await service.create(profile);
    const photoId = new Types.ObjectId();
    await hotels.updateOne(
      { _id: created.id },
      {
        $set: {
          photos: [{ _id: photoId, key: 'test.jpg' }],
          cancellationPolicy: {
            tiers: [{ daysBefore: 7, refundPercent: 100 }],
          },
        },
      },
    );
    await service.setActive(created.id, false);
    await service.setRatingSummary(created.id, { average: 4.5, count: 2 });
    expect(await service.getHotel(created.id)).toMatchObject({
      ...profile,
      isActive: false,
      ratingSummary: { average: 4.5, count: 2 },
      photos: [{ id: photoId.toHexString(), key: 'test.jpg' }],
      cancellationPolicy: { tiers: [{ daysBefore: 7, refundPercent: 100 }] },
    });
    await service.setActive(created.id, true);
    await service.setRatingSummary(created.id, { average: null, count: 0 });
    expect(await service.getHotel(created.id)).toMatchObject({
      isActive: true,
      ratingSummary: { average: null, count: 0 },
    });
  });

  it('honors the caller transaction for hotel reads and activation/rating writes', async () => {
    const created = await service.create(profile);
    const session = await t.connection.startSession();
    try {
      session.startTransaction();
      await service.setActive(created.id, false, { session });
      await service.setRatingSummary(
        created.id,
        { average: 5, count: 1 },
        { session },
      );
      expect(await service.getHotel(created.id, { session })).toMatchObject({
        isActive: false,
        ratingSummary: { average: 5, count: 1 },
      });
      expect(await service.getHotel(created.id)).toMatchObject({
        isActive: true,
        ratingSummary: { average: null, count: 0 },
      });
      await session.abortTransaction();
    } finally {
      await session.endSession();
    }
    expect(await service.getHotel(created.id)).toEqual(created);
  });

  it('rejects malformed hotel IDs with explicit validation errors', async () => {
    await expect(service.getHotel('not-an-objectid')).rejects.toMatchObject({
      response: { code: ErrorCode.ValidationFailed },
    });
  });

  it('does not allow database schema validation failures to become successful updates', async () => {
    const created = await service.create(profile);
    await expect(
      service.update(created.id, { starRating: 6 }, created.id),
    ).rejects.toThrow();
    expect(await service.getHotel(created.id)).toEqual(created);
  });

  it.each([
    { field: 'count', summary: { average: 4, count: -1 } },
    { field: 'count', summary: { average: 4, count: 1.5 } },
  ])(
    'rejects invalid rating $field without replacing the stored summary',
    async ({ field, summary }) => {
      const created = await service.create(profile);
      await expect(
        service.setRatingSummary(created.id, summary),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        errors: { [`ratingSummary.${field}`]: expect.anything() },
      });
      expect((await service.getHotel(created.id))?.ratingSummary).toEqual(
        created.ratingSummary,
      );
    },
  );

  it.each([
    { field: 'count', summary: { average: 4, count: NaN } },
    { field: 'average', summary: { average: NaN, count: 1 } },
  ])(
    'reports an invalid rating $field as a cast error without writing it',
    async ({ field, summary }) => {
      const created = await service.create(profile);
      await expect(
        service.setRatingSummary(created.id, summary),
      ).rejects.toMatchObject({ name: 'CastError', path: field });
      expect((await service.getHotel(created.id))?.ratingSummary).toEqual(
        created.ratingSummary,
      );
    },
  );

  it.each([
    { field: 'name', input: { name: '   ' } },
    { field: 'starRating', input: { starRating: 9 } },
  ])(
    'rejects invalid profile $field before creating a hotel',
    async ({ field, input }) => {
      await expect(
        service.create({ ...profile, ...input }),
      ).rejects.toMatchObject({
        name: 'ValidationError',
        errors: { [field]: expect.anything() },
      });
      expect(await hotels.countDocuments()).toBe(0);
    },
  );
});
