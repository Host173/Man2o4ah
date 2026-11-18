import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { addDays, toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { HotelsModule } from './hotels.module.js';
import type { HotelTransactionOptions } from './hotels.types.js';
import { RoomNightInventory } from './room-night-inventory.js';
import { Hotel } from './schemas/hotel.schema.js';
import { RoomNight } from './schemas/room-night.schema.js';
import { Room } from './schemas/room.schema.js';

describe('RoomNightInventory (integration, INV-02)', () => {
  let t: TestApp;
  let inventory: RoomNightInventory;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let nights: Model<RoomNight>;
  let hotelId: string;
  let roomIds: string[];
  let today: Date;
  let checkIn: Date;
  let checkOut: Date;

  beforeAll(async () => {
    t = await createTestApp({ imports: [HotelsModule] });
    inventory = t.moduleRef.get(RoomNightInventory);
    hotels = t.connection.model<Hotel>(Hotel.name);
    rooms = t.connection.model<Room>(Room.name);
    nights = t.connection.model<RoomNight>(RoomNight.name);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  afterEach(() => vi.restoreAllMocks());

  beforeEach(async () => {
    await clearCollections(t.connection);
    today = toDateOnly(new Date().toISOString().slice(0, 10));
    checkIn = addDays(today, 2);
    checkOut = addDays(today, 5);
    const hotel = await hotels.create({
      name: 'Inventory hotel',
      address: '1 Test Street',
      cityId: 'cairo',
      countryCode: 'EG',
    });
    hotelId = hotel._id.toHexString();
    const created = await rooms.create(
      ['101', '102'].map((name) => ({
        hotelId,
        name,
        type: 'Double',
        beds: 1,
        maxOccupancy: 2,
        pricePerNightMinor: 10000,
        availability: [{ fromDate: today, toDate: addDays(today, 30) }],
      })),
    );
    roomIds = created.map((room) => room._id.toHexString());
  });

  async function transaction<T>(
    work: (options: HotelTransactionOptions) => Promise<T>,
  ): Promise<T> {
    const session = await t.connection.startSession();
    try {
      return await session.withTransaction(() => work({ session }));
    } finally {
      await session.endSession();
    }
  }

  async function reserve(
    selected = roomIds,
    reservationId = new Types.ObjectId().toHexString(),
    from = checkIn,
    to = checkOut,
  ): Promise<string> {
    await transaction((options) =>
      inventory.reserve(hotelId, selected, from, to, reservationId, options),
    );
    return reservationId;
  }

  it('reserves every selected room and night, excluding checkout', async () => {
    const reservationId = await reserve();
    const stored = await nights.find().lean();
    expect(stored).toHaveLength(6);
    expect(
      stored.every(
        (night) =>
          night.kind === 'reservation' &&
          night.reservationId?.toHexString() === reservationId &&
          night.hotelId.toHexString() === hotelId &&
          night.date >= checkIn &&
          night.date < checkOut,
      ),
    ).toBe(true);
    expect(await rooms.countDocuments({ hasEverBeenReserved: true })).toBe(2);
    await reserve([roomIds[0]], undefined, checkOut, addDays(checkOut, 1));
    expect(await nights.countDocuments()).toBe(7);
  });

  it('rolls back all rooms and history if one selected room is taken', async () => {
    await reserve([roomIds[1]]);
    await expect(reserve()).rejects.toMatchObject({
      response: { code: ErrorCode.RoomsUnavailable },
    });
    expect(await nights.countDocuments()).toBe(3);
    expect(await nights.countDocuments({ roomId: roomIds[0] })).toBe(0);
    expect(await rooms.findById(roomIds[0]).lean()).toMatchObject({
      hasEverBeenReserved: false,
      inventoryVersion: 0,
    });
  });

  it.each([
    'missing',
    'inactive',
    'other hotel',
    'outside availability',
    'gap',
  ])(
    'rejects a room that is %s without holding any rooms',
    async (scenario) => {
      const selected = [...roomIds];
      if (scenario === 'missing')
        selected[1] = new Types.ObjectId().toHexString();
      if (scenario === 'inactive') {
        await rooms.updateOne({ _id: roomIds[1] }, { isActive: false });
      }
      if (scenario === 'other hotel') {
        await rooms.updateOne(
          { _id: roomIds[1] },
          { hotelId: new Types.ObjectId() },
        );
      }
      if (scenario === 'outside availability' || scenario === 'gap') {
        await rooms.updateOne(
          { _id: roomIds[1] },
          {
            availability:
              scenario === 'gap'
                ? [
                    { fromDate: checkIn, toDate: checkIn },
                    { fromDate: addDays(checkIn, 2), toDate: checkOut },
                  ]
                : [{ fromDate: checkIn, toDate: addDays(checkOut, -2) }],
          },
        );
      }
      await expect(reserve(selected)).rejects.toMatchObject({
        response: { code: ErrorCode.RoomsUnavailable },
      });
      expect(await nights.countDocuments()).toBe(0);
      expect(await rooms.countDocuments({ hasEverBeenReserved: true })).toBe(0);
    },
  );

  it('rejects inactive hotels consistently with the published fake', async () => {
    await hotels.updateOne({ _id: hotelId }, { isActive: false });
    await expect(reserve()).rejects.toMatchObject({
      response: { code: ErrorCode.RoomsUnavailable },
    });
    expect(await nights.countDocuments()).toBe(0);
  });

  it.each(['empty', 'duplicate', 'invalid ID', 'past', 'same day', 'non UTC'])(
    'rejects invalid input: %s',
    async (scenario) => {
      const selected =
        scenario === 'empty'
          ? []
          : scenario === 'duplicate'
            ? [roomIds[0], roomIds[0]]
            : scenario === 'invalid ID'
              ? ['invalid']
              : roomIds;
      const from =
        scenario === 'past'
          ? addDays(today, -1)
          : scenario === 'non UTC'
            ? new Date(checkIn.getTime() + 1)
            : checkIn;
      await expect(
        reserve(
          selected,
          undefined,
          from,
          scenario === 'same day' ? checkIn : checkOut,
        ),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.ValidationFailed },
      });
      expect(await nights.countDocuments()).toBe(0);
    },
  );

  it('requires an active caller transaction before changing inventory', async () => {
    const session = await t.connection.startSession();
    const options = { session };
    const id = new Types.ObjectId().toHexString();
    try {
      const operations = [
        () =>
          inventory.reserve(hotelId, roomIds, checkIn, checkOut, id, options),
        () => inventory.release(id, options),
        () => inventory.block(roomIds[0], checkIn, checkOut, options),
        () => inventory.unblock(id, options),
        () => inventory.setAvailability(roomIds[0], [], options),
        () => inventory.deactivate(roomIds[0], options),
        () => inventory.delete(roomIds[0], options),
      ];
      for (const operation of operations) {
        await expect(operation()).rejects.toMatchObject({
          status: 500,
          response: { code: ErrorCode.InternalError },
        });
      }
    } finally {
      await session.endSession();
    }
    expect(await nights.countDocuments()).toBe(0);
  });

  it('does not commit independently of the caller', async () => {
    await expect(
      transaction(async (options) => {
        await inventory.reserve(
          hotelId,
          roomIds,
          checkIn,
          checkOut,
          new Types.ObjectId().toHexString(),
          options,
        );
        throw new Error('caller failed');
      }),
    ).rejects.toThrow('caller failed');
    expect(await nights.countDocuments()).toBe(0);
    expect(await rooms.countDocuments({ hasEverBeenReserved: true })).toBe(0);
  });

  it('propagates unexpected database failures and rolls back touched rooms', async () => {
    const failure = new Error('database unavailable');
    vi.spyOn(nights, 'insertMany').mockRejectedValueOnce(failure);
    await expect(reserve()).rejects.toBe(failure);
    expect(await nights.countDocuments()).toBe(0);
    expect(await rooms.countDocuments({ inventoryVersion: 0 })).toBe(2);
    expect(await rooms.countDocuments({ hasEverBeenReserved: true })).toBe(0);
  });

  it('releases only the selected reservation, safely repeats, and retains history', async () => {
    const first = await reserve([roomIds[0]]);
    await reserve([roomIds[1]]);
    const blockId = await transaction((options) =>
      inventory.block(roomIds[0], checkOut, checkOut, options),
    );
    await transaction((options) => inventory.release(first, options));
    await transaction((options) => inventory.release(first, options));
    expect(await nights.countDocuments()).toBe(4);
    expect(await nights.countDocuments({ blockId })).toBe(1);
    expect(await rooms.findById(roomIds[0]).lean()).toMatchObject({
      hasEverBeenReserved: true,
    });
    await expect(
      transaction((options) => inventory.delete(roomIds[0], options)),
    ).rejects.toMatchObject({ response: { code: ErrorCode.RoomWasReserved } });
  });

  it('rolls back a release when the caller fails', async () => {
    const reservationId = await reserve();
    await expect(
      transaction(async (options) => {
        await inventory.release(reservationId, options);
        throw new Error('caller failed');
      }),
    ).rejects.toThrow('caller failed');
    expect(await nights.countDocuments({ reservationId })).toBe(6);
  });

  it('blocks inclusive dates, rejects overlaps atomically, and unblocks idempotently', async () => {
    const blockId = await transaction((options) =>
      inventory.block(roomIds[0], checkIn, addDays(checkIn, 1), options),
    );
    expect(await nights.countDocuments({ blockId, kind: 'blocked' })).toBe(2);
    await expect(reserve()).rejects.toMatchObject({
      response: { code: ErrorCode.RoomsUnavailable },
    });
    await expect(
      transaction((options) =>
        inventory.block(roomIds[0], addDays(checkIn, -1), checkIn, options),
      ),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.OverlapsReservationOrBlock },
    });
    expect(await nights.countDocuments()).toBe(2);
    await transaction((options) => inventory.unblock(blockId, options));
    await transaction((options) => inventory.unblock(blockId, options));
    await reserve([roomIds[0]]);
    await expect(
      transaction((options) =>
        inventory.block(roomIds[0], checkIn, checkOut, options),
      ),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.OverlapsReservationOrBlock },
    });
    expect(await nights.countDocuments()).toBe(3);
  });

  it('normalizes availability and prevents removal of reserved nights', async () => {
    await reserve([roomIds[0]]);
    await transaction((options) =>
      inventory.setAvailability(
        roomIds[0],
        [
          { fromDate: addDays(checkIn, 1), toDate: addDays(checkOut, -1) },
          { fromDate: checkIn, toDate: checkIn },
        ],
        options,
      ),
    );
    const room = await rooms.findById(roomIds[0]).lean();
    expect(
      room?.availability.map(({ fromDate, toDate }) => ({ fromDate, toDate })),
    ).toEqual([{ fromDate: checkIn, toDate: addDays(checkOut, -1) }]);
    await expect(
      transaction((options) =>
        inventory.setAvailability(
          roomIds[0],
          [{ fromDate: checkIn, toDate: checkIn }],
          options,
        ),
      ),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.AvailabilityHasReservations },
    });
    expect((await rooms.findById(roomIds[0]).lean())?.availability).toEqual(
      room?.availability,
    );
  });

  it('protects today in UTC but permits changing availability and deactivation after a stay', async () => {
    const reservationId = await reserve(
      [roomIds[0]],
      undefined,
      today,
      addDays(today, 1),
    );
    await expect(
      transaction((options) => inventory.deactivate(roomIds[0], options)),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.RoomHasReservations },
    });
    await expect(
      transaction((options) =>
        inventory.setAvailability(roomIds[0], [], options),
      ),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.AvailabilityHasReservations },
    });
    await nights.updateMany({ reservationId }, { date: addDays(today, -1) });
    await transaction((options) =>
      inventory.setAvailability(roomIds[0], [], options),
    );
    await transaction((options) => inventory.deactivate(roomIds[0], options));
    expect(await rooms.findById(roomIds[0]).lean()).toMatchObject({
      isActive: false,
    });
    expect(await nights.countDocuments({ reservationId })).toBe(1);
    await expect(
      transaction((options) => inventory.delete(roomIds[0], options)),
    ).rejects.toMatchObject({ response: { code: ErrorCode.RoomWasReserved } });
  });

  it('rejects deletion with future reservations and deletes only never-reserved rooms and their blocks', async () => {
    await reserve([roomIds[0]]);
    await expect(
      transaction((options) => inventory.delete(roomIds[0], options)),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.RoomHasReservations },
    });
    await transaction((options) =>
      inventory.block(roomIds[1], checkIn, checkOut, options),
    );
    await transaction((options) => inventory.delete(roomIds[1], options));
    expect(await rooms.countDocuments()).toBe(1);
    expect(await nights.countDocuments({ roomId: roomIds[1] })).toBe(0);
    expect(await nights.countDocuments({ roomId: roomIds[0] })).toBe(3);
  });

  it('reports missing rooms explicitly for moderator operations', async () => {
    const missing = new Types.ObjectId().toHexString();
    for (const work of [
      (options: HotelTransactionOptions) =>
        inventory.block(missing, checkIn, checkOut, options),
      (options: HotelTransactionOptions) =>
        inventory.setAvailability(missing, [], options),
      (options: HotelTransactionOptions) =>
        inventory.deactivate(missing, options),
      (options: HotelTransactionOptions) => inventory.delete(missing, options),
    ]) {
      await expect(transaction<unknown>(work)).rejects.toMatchObject({
        response: { code: ErrorCode.NotFound },
      });
    }
  });

  it('allows exactly one concurrent overlapping multi-room stay, with no partial loser', async () => {
    const results = await Promise.allSettled([
      reserve(roomIds),
      reserve([...roomIds].reverse()),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const stored = await nights.find().lean();
    expect(stored).toHaveLength(6);
    expect(
      new Set(stored.map((night) => night.reservationId?.toHexString())).size,
    ).toBe(1);
    expect(await rooms.countDocuments({ hasEverBeenReserved: true })).toBe(2);
  });

  it.each(['block', 'availability', 'deactivate', 'delete'])(
    'serializes a reservation racing with %s',
    async (operation) => {
      const selected = roomIds[0];
      const change = () =>
        transaction(async (options) => {
          if (operation === 'block') {
            await inventory.block(selected, checkIn, checkOut, options);
          } else if (operation === 'availability') {
            await inventory.setAvailability(selected, [], options);
          } else if (operation === 'deactivate') {
            await inventory.deactivate(selected, options);
          } else {
            await inventory.delete(selected, options);
          }
        });
      const results = await Promise.allSettled([reserve([selected]), change()]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const held = await nights.find({ kind: 'reservation' }).lean();
      if (held.length) {
        expect(held).toHaveLength(3);
        expect(await rooms.findById(selected).lean()).toMatchObject({
          isActive: true,
          hasEverBeenReserved: true,
        });
        expect(await nights.countDocuments({ kind: 'blocked' })).toBe(0);
      } else if (operation === 'block') {
        expect(await nights.countDocuments({ kind: 'blocked' })).toBe(4);
      } else {
        expect(await nights.countDocuments()).toBe(0);
        const room = await rooms.findById(selected).lean();
        if (operation === 'delete') expect(room).toBeNull();
        if (operation === 'deactivate') expect(room?.isActive).toBe(false);
        if (operation === 'availability')
          expect(room?.availability).toEqual([]);
      }
    },
  );
});
