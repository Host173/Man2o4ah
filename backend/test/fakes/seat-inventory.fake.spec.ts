import { ErrorCode } from '../../src/common/errors/error-codes.js';
import { FakeFlightsData } from './flights-data.fake.js';
import type { FakeFlightSeed } from './flights-data.fake.js';
import { FakeSeatInventory } from './seat-inventory.fake.js';

const NOW = new Date('2026-11-12T10:00:00.000Z');

function setup() {
  const data = new FakeFlightsData();
  data.addAirline({ id: 'a1', code: 'MS' });
  const flight = (id: string, over: Partial<FakeFlightSeed> = {}) =>
    data.addFlight({
      id,
      airlineId: 'a1',
      flightNumber: `MS-${id}`,
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureAt: new Date('2026-11-20T08:00:00.000Z'),
      arrivalAt: new Date('2026-11-20T11:00:00.000Z'),
      cabins: [
        {
          id: `${id}-eco`,
          cabinClass: 'economy',
          totalSeats: 5,
          priceMinor: 30000,
        },
      ],
      ...over,
    });
  flight('out');
  flight('ret');
  return { data, inventory: new FakeSeatInventory(data) };
}

const hold = (flightId: string, seats: number) => ({
  flightId,
  cabinId: `${flightId}-eco`,
  seats,
});
const conflict = (code: string) => ({ status: 409, response: { code } });

describe('FakeSeatInventory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  describe('hold', () => {
    it('moves seats from available to held and marks the flight as booked-into', async () => {
      const { data, inventory } = setup();
      await inventory.hold([hold('out', 3)]);
      expect(inventory.counters('out', 'out-eco')).toEqual({
        totalSeats: 5,
        availableSeats: 2,
        heldSeats: 3,
        bookedSeats: 0,
      });
      expect(data.flight('out')?.hasBookings).toBe(true);
    });

    it('fails with 409 SEATS_UNAVAILABLE when fewer seats are free, and changes nothing', async () => {
      const { data, inventory } = setup();
      await expect(inventory.hold([hold('out', 6)])).rejects.toMatchObject(
        conflict('SEATS_UNAVAILABLE'),
      );
      expect(inventory.counters('out', 'out-eco')?.availableSeats).toBe(5);
      expect(data.flight('out')?.hasBookings).toBe(false);
    });

    it('holds both segments of a round trip or neither', async () => {
      const { data, inventory } = setup();
      await inventory.hold([hold('ret', 4)]); // the return flight is nearly full
      await expect(
        inventory.hold([hold('out', 2), hold('ret', 2)]),
      ).rejects.toMatchObject(conflict('SEATS_UNAVAILABLE'));
      // the outbound hold, which was applied first, was rolled back
      expect(inventory.counters('out', 'out-eco')).toMatchObject({
        availableSeats: 5,
        heldSeats: 0,
      });
      expect(data.flight('out')?.hasBookings).toBe(false);
      expect(inventory.counters('ret', 'ret-eco')?.heldSeats).toBe(4);
    });

    it('counts two items for the same cabin together', async () => {
      const { inventory } = setup();
      await expect(
        inventory.hold([hold('out', 3), hold('out', 3)]),
      ).rejects.toMatchObject(conflict('SEATS_UNAVAILABLE'));
      expect(inventory.counters('out', 'out-eco')?.heldSeats).toBe(0);
    });

    const refused: [string, Partial<FakeFlightSeed>][] = [
      ['cancelled', { status: 'cancelled' }],
      ['departed', { status: 'departed' }],
      [
        'already past its departure time',
        {
          departureAt: new Date('2026-11-12T09:00:00.000Z'),
          arrivalAt: new Date('2026-11-12T12:00:00.000Z'),
        },
      ],
    ];
    it.each(refused)('refuses a flight that is %s', async (_name, over) => {
      const { inventory } = setup();
      const data = inventory.data;
      data.addFlight({
        id: 'bad',
        airlineId: 'a1',
        flightNumber: 'MS-bad',
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureAt: new Date('2026-11-20T08:00:00.000Z'),
        arrivalAt: new Date('2026-11-20T11:00:00.000Z'),
        cabins: [
          {
            id: 'bad-eco',
            cabinClass: 'economy',
            totalSeats: 5,
            priceMinor: 1,
          },
        ],
        ...over,
      });
      await expect(inventory.hold([hold('bad', 1)])).rejects.toMatchObject(
        conflict('SEATS_UNAVAILABLE'),
      );
    });

    it('answers 409 SEATS_UNAVAILABLE for an unknown flight or cabin, like the real filter that matches nothing', async () => {
      const { inventory } = setup();
      await expect(inventory.hold([hold('nope', 1)])).rejects.toMatchObject(
        conflict('SEATS_UNAVAILABLE'),
      );
      await expect(
        inventory.hold([{ flightId: 'out', cabinId: 'nope', seats: 1 }]),
      ).rejects.toMatchObject(conflict('SEATS_UNAVAILABLE'));
    });

    it('lets exactly 5 of 6 parallel single-seat holds win', async () => {
      const { inventory } = setup();
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => inventory.hold([hold('out', 1)])),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      const c = inventory.counters('out', 'out-eco');
      expect(c).toMatchObject({ availableSeats: 0, heldSeats: 5 });
      expect(c?.totalSeats).toBe(
        c!.availableSeats + c!.heldSeats + c!.bookedSeats,
      );
    });

    it('does nothing for an empty list', async () => {
      const { inventory } = setup();
      await expect(inventory.hold([])).resolves.toBeUndefined();
    });
  });

  describe('confirm, release and returnBooked', () => {
    it('confirm turns held seats into booked seats', async () => {
      const { inventory } = setup();
      await inventory.hold([hold('out', 3)]);
      await inventory.confirm([hold('out', 2)]);
      expect(inventory.counters('out', 'out-eco')).toEqual({
        totalSeats: 5,
        availableSeats: 2,
        heldSeats: 1,
        bookedSeats: 2,
      });
    });

    it('release gives held seats back', async () => {
      const { inventory } = setup();
      await inventory.hold([hold('out', 3)]);
      await inventory.release([hold('out', 3)]);
      expect(inventory.counters('out', 'out-eco')).toMatchObject({
        availableSeats: 5,
        heldSeats: 0,
      });
    });

    it('returnBooked gives booked seats back', async () => {
      const { inventory } = setup();
      await inventory.hold([hold('out', 3)]);
      await inventory.confirm([hold('out', 3)]);
      await inventory.returnBooked([hold('out', 2)]);
      expect(inventory.counters('out', 'out-eco')).toEqual({
        totalSeats: 5,
        availableSeats: 4,
        heldSeats: 0,
        bookedSeats: 1,
      });
    });

    it.each(['confirm', 'release', 'returnBooked'] as const)(
      '%s fails with 500 INVENTORY_CORRUPTED when the seats are not there, and changes nothing',
      async (method) => {
        const { inventory } = setup();
        await inventory.hold([hold('out', 1), hold('ret', 1)]);
        // 'out' has 1 held and 0 booked, so asking for 2 breaks the rule for every method
        await expect(
          inventory[method]([hold('ret', 1), hold('out', 2)]),
        ).rejects.toMatchObject({
          status: 500,
          response: { code: 'INVENTORY_CORRUPTED' },
        });
        expect(inventory.counters('ret', 'ret-eco')).toMatchObject({
          heldSeats: 1,
          bookedSeats: 0,
        });
      },
    );

    it('confirm refuses a cancelled flight with 409 SEATS_UNAVAILABLE and changes nothing', async () => {
      const { data, inventory } = setup();
      await inventory.hold([hold('out', 2), hold('ret', 1)]);
      data.flight('ret')!.status = 'cancelled';

      await expect(
        inventory.confirm([hold('out', 2), hold('ret', 1)]),
      ).rejects.toMatchObject(conflict(ErrorCode.SeatsUnavailable));
      expect(inventory.counters('out', 'out-eco')).toMatchObject({
        heldSeats: 2,
        bookedSeats: 0,
      });
      expect(inventory.counters('ret', 'ret-eco')).toMatchObject({
        heldSeats: 1,
        bookedSeats: 0,
      });
    });

    it('release and returnBooked still work on a cancelled flight', async () => {
      const { data, inventory } = setup();
      await inventory.hold([hold('out', 3)]);
      await inventory.confirm([hold('out', 1)]);
      data.flight('out')!.status = 'cancelled';

      await inventory.release([hold('out', 2)]);
      await inventory.returnBooked([hold('out', 1)]);

      expect(inventory.counters('out', 'out-eco')).toMatchObject({
        availableSeats: 5,
        heldSeats: 0,
        bookedSeats: 0,
      });
    });

    it('answers INVENTORY_CORRUPTED for an unknown flight', async () => {
      const { inventory } = setup();
      await expect(inventory.confirm([hold('nope', 1)])).rejects.toMatchObject({
        status: 500,
      });
    });

    it('keeps total = available + held + booked through a whole booking lifecycle', async () => {
      const { inventory } = setup();
      const check = () => {
        const c = inventory.counters('out', 'out-eco')!;
        expect(c.totalSeats).toBe(
          c.availableSeats + c.heldSeats + c.bookedSeats,
        );
      };
      await inventory.hold([hold('out', 4)]);
      check();
      await inventory.confirm([hold('out', 3)]);
      check();
      await inventory.release([hold('out', 1)]);
      check();
      await inventory.returnBooked([hold('out', 3)]);
      check();
      expect(inventory.counters('out', 'out-eco')?.availableSeats).toBe(5);
    });
  });

  describe('changeCapacity', () => {
    it('raises total and available together', async () => {
      const { inventory } = setup();
      await inventory.changeCapacity('out', 'out-eco', 8, 5);
      expect(inventory.counters('out', 'out-eco')).toMatchObject({
        totalSeats: 8,
        availableSeats: 8,
      });
    });

    it('cuts down to exactly the reserved seats, not below', async () => {
      const { inventory } = setup();
      await inventory.hold([hold('out', 2)]);
      await inventory.confirm([hold('out', 1)]);
      await inventory.changeCapacity('out', 'out-eco', 2, 5); // held 1 + booked 1 = 2
      expect(inventory.counters('out', 'out-eco')).toEqual({
        totalSeats: 2,
        availableSeats: 0,
        heldSeats: 1,
        bookedSeats: 1,
      });
      await expect(
        inventory.changeCapacity('out', 'out-eco', 1, 2),
      ).rejects.toMatchObject(conflict('CAPACITY_BELOW_RESERVED'));
    });

    it('fails with 409 CONCURRENT_CHANGE when the total is not the one the caller saw', async () => {
      const { inventory } = setup();
      await inventory.changeCapacity('out', 'out-eco', 6, 5);
      await expect(
        inventory.changeCapacity('out', 'out-eco', 7, 5), // a second moderator still sees 5
      ).rejects.toMatchObject(conflict('CONCURRENT_CHANGE'));
      expect(inventory.counters('out', 'out-eco')?.totalSeats).toBe(6);
    });

    it('treats an unknown cabin as a change the caller did not see', async () => {
      const { inventory } = setup();
      await expect(
        inventory.changeCapacity('out', 'nope', 6, 5),
      ).rejects.toMatchObject(conflict('CONCURRENT_CHANGE'));
    });

    it('rejects a non-positive capacity', async () => {
      const { inventory } = setup();
      await expect(
        inventory.changeCapacity('out', 'out-eco', 0, 5),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.ValidationFailed },
      });
      expect(inventory.counters('out', 'out-eco')?.totalSeats).toBe(5);
    });
  });

  describe('validation (400 VALIDATION_FAILED, like the real class)', () => {
    const methods = ['hold', 'confirm', 'release', 'returnBooked'] as const;
    const badSeats: [string, number][] = [
      ['zero', 0],
      ['negative', -1],
      ['a fraction', 1.5],
      ['NaN', Number.NaN],
      ['a numeric string', '2' as unknown as number],
    ];
    const untouched = {
      totalSeats: 5,
      availableSeats: 3,
      heldSeats: 2,
      bookedSeats: 0,
    };

    describe.each(methods)('%s', (method) => {
      it.each(badSeats)(
        'rejects seats that are %s and changes nothing',
        async (_name, seats) => {
          const { inventory } = setup();
          await inventory.hold([hold('out', 2)]);
          await expect(
            inventory[method]([hold('out', seats)]),
          ).rejects.toMatchObject({
            status: 400,
            response: {
              code: 'VALIDATION_FAILED',
              details: [{ field: 'items.0.seats' }],
            },
          });
          expect(inventory.counters('out', 'out-eco')).toEqual(untouched);
        },
      );

      it('checks every item first, so a bad later item changes nothing', async () => {
        const { inventory } = setup();
        await inventory.hold([hold('out', 2), hold('ret', 2)]);
        await expect(
          inventory[method]([hold('out', 1), hold('ret', 0)]),
        ).rejects.toMatchObject({
          status: 400,
          response: { details: [{ field: 'items.1.seats' }] },
        });
        expect(inventory.counters('out', 'out-eco')).toEqual(untouched);
        expect(inventory.counters('ret', 'ret-eco')).toEqual(untouched);
      });

      it('reports every bad item at once', async () => {
        const { inventory } = setup();
        await expect(
          inventory[method]([hold('out', 0), hold('ret', 1), hold('out', -2)]),
        ).rejects.toMatchObject({
          response: {
            details: [{ field: 'items.0.seats' }, { field: 'items.2.seats' }],
          },
        });
      });
    });

    describe('changeCapacity', () => {
      const notIntegers: [string, number][] = [
        ['NaN', Number.NaN],
        ['a numeric string', '5' as unknown as number],
        ['a fraction', 5.5],
      ];

      it.each([['zero', 0], ['negative', -3], ...notIntegers] as [
        string,
        number,
      ][])(
        'rejects newTotal that is %s and changes nothing',
        async (_name, newTotal) => {
          const { inventory } = setup();
          await expect(
            inventory.changeCapacity('out', 'out-eco', newTotal, 5),
          ).rejects.toMatchObject({
            status: 400,
            response: {
              code: 'VALIDATION_FAILED',
              details: [{ field: 'newTotal' }],
            },
          });
          expect(inventory.counters('out', 'out-eco')?.totalSeats).toBe(5);
        },
      );

      it.each(notIntegers)(
        'rejects expectedTotal that is %s instead of answering CONCURRENT_CHANGE',
        async (_name, expectedTotal) => {
          const { inventory } = setup();
          await expect(
            inventory.changeCapacity('out', 'out-eco', 6, expectedTotal),
          ).rejects.toMatchObject({
            status: 400,
            response: {
              code: 'VALIDATION_FAILED',
              details: [{ field: 'expectedTotal' }],
            },
          });
          expect(inventory.counters('out', 'out-eco')?.totalSeats).toBe(5);
        },
      );

      it('reports both fields when both are invalid', async () => {
        const { inventory } = setup();
        await expect(
          inventory.changeCapacity('out', 'out-eco', 0, Number.NaN),
        ).rejects.toMatchObject({
          response: {
            details: [{ field: 'newTotal' }, { field: 'expectedTotal' }],
          },
        });
      });
    });
  });

  it('counters() is a copy and is undefined for an unknown cabin', () => {
    const { inventory } = setup();
    const c = inventory.counters('out', 'out-eco')!;
    c.availableSeats = 0;
    expect(inventory.counters('out', 'out-eco')?.availableSeats).toBe(5);
    expect(inventory.counters('out', 'nope')).toBeUndefined();
    expect(inventory.counters('nope', 'out-eco')).toBeUndefined();
  });
});
