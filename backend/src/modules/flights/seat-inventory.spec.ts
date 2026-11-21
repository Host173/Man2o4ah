import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { ClientSession } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { Flight } from './schemas/flight.schema.js';
import { SeatInventory } from './seat-inventory.js';

describe('SeatInventory unit', () => {
  const flightId = new Types.ObjectId();
  const cabinId = new Types.ObjectId();
  const session = {} as ClientSession;
  const model = {
    updateOne: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    })),
    findOne: vi.fn(),
  };
  let moduleRef: TestingModule;
  let inventory: SeatInventory;

  beforeEach(async () => {
    model.updateOne.mockClear();
    model.updateOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });
    moduleRef = await Test.createTestingModule({
      providers: [
        SeatInventory,
        { provide: getModelToken(Flight.name), useValue: model },
      ],
    }).compile();
    inventory = moduleRef.get(SeatInventory);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('holds seats with a single conditional update in the caller session', async () => {
    await inventory.hold(
      [
        {
          flightId: flightId.toHexString(),
          cabinId: cabinId.toHexString(),
          seats: 2,
        },
      ],
      { session },
    );

    expect(model.updateOne).toHaveBeenCalledWith(
      {
        _id: flightId,
        status: 'scheduled',
        departureAt: { $gt: expect.any(Date) },
        cabins: {
          $elemMatch: { _id: cabinId, availableSeats: { $gte: 2 } },
        },
      },
      {
        $inc: {
          'cabins.$.availableSeats': -2,
          'cabins.$.heldSeats': 2,
        },
        $set: { hasBookings: true },
      },
      { session },
    );
  });

  it('adds a unique cabin with initialized counters in the caller session', async () => {
    const airlineId = new Types.ObjectId();
    const input = {
      cabinClass: 'business' as const,
      totalSeats: 7,
      priceMinor: 75000,
      freeBags: 2,
      maxBagWeightKg: 32,
    };
    await inventory.addCabin(
      flightId.toHexString(),
      input,
      airlineId.toHexString(),
      { session },
    );

    expect(model.updateOne).toHaveBeenCalledWith(
      {
        _id: flightId,
        airlineId,
        status: 'scheduled',
        'cabins.cabinClass': { $ne: 'business' },
      },
      {
        $push: {
          cabins: {
            ...input,
            availableSeats: 7,
            heldSeats: 0,
            bookedSeats: 0,
          },
        },
      },
      { session, runValidators: true },
    );
  });

  it('reports an unavailable hold when its atomic condition matches no cabin', async () => {
    model.updateOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    });

    await expect(
      inventory.hold(
        [
          {
            flightId: flightId.toHexString(),
            cabinId: cabinId.toHexString(),
            seats: 1,
          },
        ],
        { session },
      ),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.SeatsUnavailable },
    });
  });

  describe('seat movement and the flight status', () => {
    const item = {
      flightId: flightId.toHexString(),
      cabinId: cabinId.toHexString(),
      seats: 2,
    };
    const unmodified = {
      exec: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    };

    function mockFollowUp(flight: { status: string } | null) {
      const query = {
        session: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        lean: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(flight),
      };
      model.findOne.mockReturnValue(query);
      return query;
    }

    it('only confirms held seats on a scheduled flight', async () => {
      await inventory.confirm([item], { session });

      expect(model.updateOne).toHaveBeenCalledWith(
        {
          _id: flightId,
          status: 'scheduled',
          cabins: { $elemMatch: { _id: cabinId, heldSeats: { $gte: 2 } } },
        },
        {
          $inc: { 'cabins.$.heldSeats': -2, 'cabins.$.bookedSeats': 2 },
        },
        { session },
      );
    });

    it.each(['release', 'returnBooked'] as const)(
      '%s does not look at the flight status',
      async (method) => {
        await inventory[method]([item], { session });

        expect(model.updateOne).toHaveBeenCalledWith(
          expect.not.objectContaining({ status: expect.anything() }),
          expect.anything(),
          { session },
        );
      },
    );

    it('reports SEATS_UNAVAILABLE when the flight is no longer scheduled', async () => {
      model.updateOne.mockReturnValue(unmodified);
      const query = mockFollowUp({ status: 'cancelled' });

      await expect(
        inventory.confirm([item], { session }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: ErrorCode.SeatsUnavailable },
      });
      expect(model.findOne).toHaveBeenCalledWith({ _id: flightId });
      expect(query.session).toHaveBeenCalledWith(session);
    });

    it.each([
      ['a scheduled flight', { status: 'scheduled' }],
      ['a missing flight', null],
    ])(
      'reports corrupted inventory when the flight is %s',
      async (_name, flight) => {
        model.updateOne.mockReturnValue(unmodified);
        mockFollowUp(flight);

        await expect(
          inventory.confirm([item], { session }),
        ).rejects.toMatchObject({
          status: 500,
          response: { code: ErrorCode.InventoryCorrupted },
        });
      },
    );
  });

  it('does not issue updates for an empty item list', async () => {
    await inventory.hold([], { session });
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  describe('validation (400 VALIDATION_FAILED)', () => {
    const item = (seats: number) => ({
      flightId: flightId.toHexString(),
      cabinId: cabinId.toHexString(),
      seats,
    });
    const methods = ['hold', 'confirm', 'release', 'returnBooked'] as const;
    const badSeats: [string, number][] = [
      ['zero', 0],
      ['negative', -1],
      ['a fraction', 1.5],
      ['NaN', Number.NaN],
      ['a numeric string', '2' as unknown as number],
    ];

    describe.each(methods)('%s', (method) => {
      it.each(badSeats)(
        'rejects seats that are %s without touching the database',
        async (_name, seats) => {
          await expect(
            inventory[method]([item(seats)], { session }),
          ).rejects.toMatchObject({
            status: 400,
            response: {
              code: ErrorCode.ValidationFailed,
              details: [{ field: 'items.0.seats' }],
            },
          });
          expect(model.updateOne).not.toHaveBeenCalled();
        },
      );

      it('checks every item before updating any, so a bad later item changes nothing', async () => {
        await expect(
          inventory[method]([item(1), item(0)], { session }),
        ).rejects.toMatchObject({
          status: 400,
          response: { details: [{ field: 'items.1.seats' }] },
        });
        expect(model.updateOne).not.toHaveBeenCalled();
      });

      it('reports every bad item at once', async () => {
        await expect(
          inventory[method]([item(0), item(1), item(-2)], { session }),
        ).rejects.toMatchObject({
          response: {
            details: [{ field: 'items.0.seats' }, { field: 'items.2.seats' }],
          },
        });
      });
    });

    describe('changeCapacity', () => {
      const change = (newTotal: number, expectedTotal: number) =>
        inventory.changeCapacity(
          flightId.toHexString(),
          cabinId.toHexString(),
          newTotal,
          expectedTotal,
          { session },
        );
      const notIntegers: [string, number][] = [
        ['NaN', Number.NaN],
        ['a numeric string', '5' as unknown as number],
        ['a fraction', 5.5],
      ];

      it.each([['zero', 0], ['negative', -3], ...notIntegers] as [
        string,
        number,
      ][])('rejects newTotal that is %s', async (_name, newTotal) => {
        await expect(change(newTotal, 5)).rejects.toMatchObject({
          status: 400,
          response: {
            code: ErrorCode.ValidationFailed,
            details: [{ field: 'newTotal' }],
          },
        });
        expect(model.updateOne).not.toHaveBeenCalled();
      });

      it.each(notIntegers)(
        'rejects expectedTotal that is %s instead of casting it',
        async (_name, expectedTotal) => {
          await expect(change(6, expectedTotal)).rejects.toMatchObject({
            status: 400,
            response: {
              code: ErrorCode.ValidationFailed,
              details: [{ field: 'expectedTotal' }],
            },
          });
          expect(model.updateOne).not.toHaveBeenCalled();
        },
      );

      it('reports both fields when both are invalid', async () => {
        await expect(change(0, Number.NaN)).rejects.toMatchObject({
          response: {
            details: [{ field: 'newTotal' }, { field: 'expectedTotal' }],
          },
        });
      });
    });
  });
});
