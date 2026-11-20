import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClientSession, Model } from 'mongoose';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { Flight } from './schemas/flight.schema.js';
import { FlightsModule } from './flights.module.js';
import { SeatInventory } from './seat-inventory.js';
import type { SeatItem } from './flights.types.js';

describe('SeatInventory integration (INV-01)', () => {
  let testApp: TestApp | undefined;
  let inventory: SeatInventory;
  let flightModel: Model<Flight>;

  beforeAll(async () => {
    testApp = await createTestApp({ imports: [FlightsModule] });
    inventory = testApp.moduleRef.get(SeatInventory);
    flightModel = testApp.moduleRef.get<Model<Flight>>(
      getModelToken(Flight.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    if (testApp) await clearCollections(testApp.connection);
  });

  afterAll(async () => {
    await testApp?.close();
  }, HOOK_TIMEOUT);

  it('allows exactly five of six concurrent holds on five seats', async () => {
    const flight = await createFlight(flightModel);
    const item = seat(flight);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        inTransaction(testApp!, (session) =>
          inventory.hold([item], { session }),
        ),
      ),
    );

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(5);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      response: { code: ErrorCode.SeatsUnavailable },
    });

    await expectCounters(flightModel, flight, {
      totalSeats: 5,
      availableSeats: 0,
      heldSeats: 5,
      bookedSeats: 0,
    });
  });

  it('rolls back a new cabin when the caller transaction aborts', async () => {
    const flight = await createFlight(flightModel);
    const original = await flightModel.findById(flight.id).orFail().lean();
    const input = {
      cabinClass: 'business' as const,
      totalSeats: 7,
      priceMinor: 75000,
      freeBags: 2,
      maxBagWeightKg: 32,
    };
    const aborted = new Error('Caller aborted');

    await expect(
      inTransaction(testApp!, async (session) => {
        await inventory.addCabin(
          flight.id,
          input,
          original.airlineId.toHexString(),
          { session },
        );
        throw aborted;
      }),
    ).rejects.toBe(aborted);

    const persisted = await flightModel.findById(flight.id).lean();
    expect(persisted?.cabins).toHaveLength(1);
    expect(
      persisted?.cabins.some((cabin) => cabin.cabinClass === 'business'),
    ).toBe(false);
  });

  it('rejects holds for unavailable, cancelled, departed, or past flights', async () => {
    const available = await createFlight(flightModel);
    const cancelled = await createFlight(flightModel, {
      status: 'cancelled',
      flightNumber: 'MS-CANCELLED',
    });
    const departed = await createFlight(flightModel, {
      status: 'departed',
      flightNumber: 'MS-DEPARTED',
    });
    const past = await createFlight(flightModel, {
      departureAt: new Date(Date.now() - 60_000),
      arrivalAt: new Date(Date.now() + 60_000),
      flightNumber: 'MS-PAST',
    });

    await inTransaction(testApp!, (session) =>
      inventory.hold([seat(available, 5)], { session }),
    );
    for (const flight of [available, cancelled, departed, past]) {
      await expect(
        inTransaction(testApp!, (session) =>
          inventory.hold([seat(flight)], { session }),
        ),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.SeatsUnavailable },
      });
    }
    await expectCounters(flightModel, cancelled, {
      totalSeats: 5,
      availableSeats: 5,
      heldSeats: 0,
      bookedSeats: 0,
    });
  });

  it('rolls back earlier items when a later segment cannot be held', async () => {
    const outbound = await createFlight(flightModel, {
      flightNumber: 'MS-OUT',
    });
    const fullReturn = await createFlight(flightModel, {
      flightNumber: 'MS-RET',
    });
    await inTransaction(testApp!, (session) =>
      inventory.hold([seat(fullReturn, 5)], { session }),
    );

    await expect(
      inTransaction(testApp!, (session) =>
        inventory.hold([seat(outbound, 1), seat(fullReturn, 1)], { session }),
      ),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.SeatsUnavailable },
    });

    await expectCounters(flightModel, outbound, {
      totalSeats: 5,
      availableSeats: 5,
      heldSeats: 0,
      bookedSeats: 0,
    });
    await expectHasBookings(flightModel, outbound, false);
    await expectCounters(flightModel, fullReturn, {
      totalSeats: 5,
      availableSeats: 0,
      heldSeats: 5,
      bookedSeats: 0,
    });
  });

  it('moves held and booked seats through confirm, release, and return', async () => {
    const flight = await createFlight(flightModel);
    await inTransaction(testApp!, (session) =>
      inventory.hold([seat(flight, 3)], { session }),
    );
    await inTransaction(testApp!, (session) =>
      inventory.confirm([seat(flight, 2)], { session }),
    );
    await inTransaction(testApp!, (session) =>
      inventory.release([seat(flight, 1)], { session }),
    );
    await inTransaction(testApp!, (session) =>
      inventory.returnBooked([seat(flight, 1)], { session }),
    );

    await expectCounters(flightModel, flight, {
      totalSeats: 5,
      availableSeats: 4,
      heldSeats: 0,
      bookedSeats: 1,
    });
  });

  it.each(['confirm', 'release', 'returnBooked'] as const)(
    '%s reports corrupted inventory and does not change counters',
    async (operation) => {
      const flight = await createFlight(flightModel);
      const item = seat(flight);

      await expect(
        inTransaction(testApp!, (session) =>
          inventory[operation]([item], { session }),
        ),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.InventoryCorrupted },
      });
      await expectCounters(flightModel, flight, {
        totalSeats: 5,
        availableSeats: 5,
        heldSeats: 0,
        bookedSeats: 0,
      });
    },
  );

  it('updates capacity atomically, enforces reserved seats, and detects stale totals', async () => {
    const flight = await createFlight(flightModel);
    await inTransaction(testApp!, (session) =>
      inventory.changeCapacity(flight.id, flight.cabinId, 5, 5, { session }),
    );
    await inTransaction(testApp!, (session) =>
      inventory.hold([seat(flight, 2)], { session }),
    );
    await inTransaction(testApp!, (session) =>
      inventory.confirm([seat(flight, 2)], { session }),
    );

    await inTransaction(testApp!, (session) =>
      inventory.changeCapacity(flight.id, flight.cabinId, 8, 5, { session }),
    );
    await expectCounters(flightModel, flight, {
      totalSeats: 8,
      availableSeats: 6,
      heldSeats: 0,
      bookedSeats: 2,
    });

    await expect(
      inTransaction(testApp!, (session) =>
        inventory.changeCapacity(flight.id, flight.cabinId, 1, 8, { session }),
      ),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.CapacityBelowReserved },
    });
    await inTransaction(testApp!, (session) =>
      inventory.changeCapacity(flight.id, flight.cabinId, 6, 8, { session }),
    );
    await expectCounters(flightModel, flight, {
      totalSeats: 6,
      availableSeats: 4,
      heldSeats: 0,
      bookedSeats: 2,
    });

    await expect(
      inTransaction(testApp!, (session) =>
        inventory.changeCapacity(flight.id, flight.cabinId, 7, 8, { session }),
      ),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.ConcurrentChange },
    });
  });

  it('treats a missing cabin as a concurrent capacity change', async () => {
    const flight = await createFlight(flightModel);

    await expect(
      inTransaction(testApp!, (session) =>
        inventory.changeCapacity(
          flight.id,
          new Types.ObjectId().toHexString(),
          6,
          5,
          { session },
        ),
      ),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.ConcurrentChange },
    });
  });

  it('rejects invalid capacity without changing seat counters', async () => {
    const flight = await createFlight(flightModel);

    await expect(
      inTransaction(testApp!, (session) =>
        inventory.changeCapacity(flight.id, flight.cabinId, 0, 5, { session }),
      ),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.ValidationFailed },
    });
    await expectCounters(flightModel, flight, {
      totalSeats: 5,
      availableSeats: 5,
      heldSeats: 0,
      bookedSeats: 0,
    });
  });

  it.each([
    ['NaN', Number.NaN],
    ['a numeric string, which Mongoose would cast', '5' as unknown as number],
    ['a fraction', 5.5],
  ])(
    'rejects expectedTotal that is %s with 400 and changes nothing',
    async (_name, expectedTotal) => {
      const flight = await createFlight(flightModel);

      await expect(
        inTransaction(testApp!, (session) =>
          inventory.changeCapacity(
            flight.id,
            flight.cabinId,
            8,
            expectedTotal,
            {
              session,
            },
          ),
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: ErrorCode.ValidationFailed,
          details: [{ field: 'expectedTotal' }],
        },
      });
      await expectCounters(flightModel, flight, {
        totalSeats: 5,
        availableSeats: 5,
        heldSeats: 0,
        bookedSeats: 0,
      });
    },
  );

  it.each(['hold', 'confirm', 'release', 'returnBooked'] as const)(
    '%s rejects seats that are not positive integers with 400 and changes nothing',
    async (operation) => {
      const flight = await createFlight(flightModel);

      for (const seats of [0, -1, 1.5]) {
        await expect(
          inTransaction(testApp!, (session) =>
            inventory[operation]([seat(flight, seats)], { session }),
          ),
        ).rejects.toMatchObject({
          status: 400,
          response: { code: ErrorCode.ValidationFailed },
        });
      }
      await expectCounters(flightModel, flight, {
        totalSeats: 5,
        availableSeats: 5,
        heldSeats: 0,
        bookedSeats: 0,
      });
      await expectHasBookings(flightModel, flight, false);
    },
  );

  it('sets hasBookings when a hold succeeds and leaves it false otherwise', async () => {
    const held = await createFlight(flightModel, { flightNumber: 'MS-HELD' });
    const untouched = await createFlight(flightModel, {
      flightNumber: 'MS-UNTOUCHED',
    });
    const cancelled = await createFlight(flightModel, {
      status: 'cancelled',
      flightNumber: 'MS-CANCELLED-2',
    });
    await expectHasBookings(flightModel, held, false);

    await inTransaction(testApp!, (session) =>
      inventory.hold([seat(held)], { session }),
    );
    await expect(
      inTransaction(testApp!, (session) =>
        inventory.hold([seat(cancelled)], { session }),
      ),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.SeatsUnavailable },
    });

    await expectHasBookings(flightModel, held, true);
    await expectHasBookings(flightModel, untouched, false);
    await expectHasBookings(flightModel, cancelled, false);
  });

  // FLT-05: a capacity cut may never go below the seats already held or booked,
  // even when holds are running at the same moment. Which request wins is up to
  // the database, so every round only asserts what must hold whoever wins.
  it('never lets a capacity cut go below held seats while holds race it', async () => {
    for (let round = 0; round < 10; round += 1) {
      const flight = await createFlight(flightModel, {
        flightNumber: `MS-RACE-${round}`,
      });

      const results = await Promise.allSettled([
        ...Array.from({ length: 3 }, () =>
          inTransaction(testApp!, (session) =>
            inventory.hold([seat(flight)], { session }),
          ),
        ),
        inTransaction(testApp!, (session) =>
          inventory.changeCapacity(flight.id, flight.cabinId, 2, 5, {
            session,
          }),
        ),
      ]);
      const holds = results.slice(0, 3);
      const cut = results[3];
      const heldByWinners = holds.filter(
        (result) => result.status === 'fulfilled',
      ).length;

      const stored = await flightModel.findById(flight.id).lean().exec();
      const cabin = stored!.cabins[0];
      // The counters always add up and never go negative or past the capacity.
      expect(cabin.totalSeats).toBe(
        cabin.availableSeats + cabin.heldSeats + cabin.bookedSeats,
      );
      expect(cabin.availableSeats).toBeGreaterThanOrEqual(0);
      expect(cabin.heldSeats).toBeLessThanOrEqual(cabin.totalSeats);
      // Every successful hold is counted, and a failed one only ever lacked seats.
      expect(cabin.heldSeats).toBe(heldByWinners);
      for (const hold of holds) {
        if (hold.status === 'rejected') {
          expect(hold.reason).toMatchObject({
            response: { code: ErrorCode.SeatsUnavailable },
          });
        }
      }
      if (cut.status === 'fulfilled') {
        expect(cabin.totalSeats).toBe(2);
      } else {
        // The cut lost the race: all 3 seats were already held, so it was refused.
        expect(cut.reason).toMatchObject({
          response: { code: ErrorCode.CapacityBelowReserved },
        });
        expect(cabin.totalSeats).toBe(5);
        expect(cabin.heldSeats).toBe(3);
      }
    }
  });
});

interface FlightSeed {
  id: string;
  cabinId: string;
}

async function createFlight(
  flightModel: Model<Flight>,
  options: {
    flightNumber?: string;
    status?: 'scheduled' | 'cancelled' | 'departed';
    departureAt?: Date;
    arrivalAt?: Date;
  } = {},
): Promise<FlightSeed> {
  const id = new Types.ObjectId();
  const cabinId = new Types.ObjectId();
  const departureAt =
    options.departureAt ?? new Date(Date.now() + 60 * 60 * 1000);
  const arrivalAt =
    options.arrivalAt ?? new Date(departureAt.getTime() + 60 * 60 * 1000);
  await flightModel.create({
    _id: id,
    airlineId: new Types.ObjectId(),
    flightNumber: options.flightNumber ?? `MS-${id.toHexString()}`,
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAt,
    arrivalAt,
    departureLocalDate: departureAt.toISOString().slice(0, 10),
    durationMinutes: 60,
    ...(options.status ? { status: options.status } : {}),
    cabins: [
      {
        _id: cabinId,
        cabinClass: 'economy',
        totalSeats: 5,
        availableSeats: 5,
        heldSeats: 0,
        bookedSeats: 0,
        priceMinor: 10000,
        freeBags: 1,
        maxBagWeightKg: 23,
      },
    ],
  });
  return { id: id.toHexString(), cabinId: cabinId.toHexString() };
}

function seat(flight: FlightSeed, seats = 1): SeatItem {
  return { flightId: flight.id, cabinId: flight.cabinId, seats };
}

async function inTransaction(
  testApp: TestApp,
  operation: (session: ClientSession) => Promise<void>,
): Promise<void> {
  const session = await testApp.connection.startSession();
  try {
    await session.withTransaction(() => operation(session));
  } finally {
    await session.endSession();
  }
}

async function expectCounters(
  flightModel: Model<Flight>,
  flight: FlightSeed,
  counters: {
    totalSeats: number;
    availableSeats: number;
    heldSeats: number;
    bookedSeats: number;
  },
): Promise<void> {
  const stored = await flightModel.findById(flight.id).lean().exec();
  expect(stored?.cabins[0]).toMatchObject(counters);
  expect(counters.totalSeats).toBe(
    counters.availableSeats + counters.heldSeats + counters.bookedSeats,
  );
}

async function expectHasBookings(
  flightModel: Model<Flight>,
  flight: FlightSeed,
  expected: boolean,
): Promise<void> {
  const stored = await flightModel.findById(flight.id).lean().exec();
  expect(stored?.hasBookings).toBe(expected);
}
