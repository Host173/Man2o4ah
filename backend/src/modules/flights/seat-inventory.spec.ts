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

  it('does not issue updates for an empty item list', async () => {
    await inventory.hold([], { session });
    expect(model.updateOne).not.toHaveBeenCalled();
  });
});
