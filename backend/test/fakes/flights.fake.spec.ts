import type {
  FlightSearchItem,
  OneWaySearchQuery,
  RoundTripSearchQuery,
} from '../../src/modules/flights/flights.types.js';
import { FakeFlightsData } from './flights-data.fake.js';
import { FakeFlightsService } from './flights.fake.js';
import { FakeSeatInventory } from './seat-inventory.fake.js';

const NOW = new Date('2026-11-12T10:00:00.000Z');

/** Three CAI → DXB flights on 2026-11-20, one DXB → CAI on 2026-11-27, and flights that must never match. */
function setup() {
  const data = new FakeFlightsData();
  data.addAirline({ id: 'a1', code: 'MS', name: 'EgyptAir' });
  data.addAirline({
    id: 'a2',
    code: 'EK',
    name: 'Emirates',
    baggagePolicy: { extraBagPriceMinor: 5000, maxExtraBagsPerPassenger: 2 },
    cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }],
  });
  const flight = (
    id: string,
    airlineId: string,
    from: string,
    to: string,
    day: string,
    depHour: number,
    minutes: number,
    cabins: {
      id: string;
      cabinClass: 'economy' | 'business';
      totalSeats: number;
      priceMinor: number;
    }[],
    status: 'scheduled' | 'cancelled' = 'scheduled',
  ) => {
    const departureAt = new Date(
      `${day}T${String(depHour).padStart(2, '0')}:00:00.000Z`,
    );
    data.addFlight({
      id,
      airlineId,
      flightNumber: `FN-${id}`,
      departureAirportId: from,
      arrivalAirportId: to,
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + minutes * 60000),
      cabins,
      status,
    });
  };
  const eco = (id: string, totalSeats: number, priceMinor: number) => ({
    id,
    cabinClass: 'economy' as const,
    totalSeats,
    priceMinor,
  });
  // matching flights, one-way (price order f2 < f1 < f3; duration f3 < f1 < f2; departure f2 < f1 < f3)
  flight('f1', 'a1', 'CAI', 'DXB', '2026-11-20', 8, 210, [
    eco('f1-eco', 10, 30000),
    { id: 'f1-biz', cabinClass: 'business', totalSeats: 4, priceMinor: 90000 },
  ]);
  flight('f2', 'a2', 'CAI', 'DXB', '2026-11-20', 6, 270, [
    eco('f2-eco', 2, 25000),
  ]);
  flight('f3', 'a1', 'CAI', 'DXB', '2026-11-20', 12, 165, [
    eco('f3-eco', 10, 40000),
  ]);
  // the return flight
  flight('f4', 'a2', 'DXB', 'CAI', '2026-11-27', 9, 180, [
    eco('f4-eco', 5, 35000),
  ]);
  // never match: cancelled, other route, other date
  flight(
    'f5',
    'a1',
    'CAI',
    'DXB',
    '2026-11-20',
    9,
    200,
    [eco('f5-eco', 10, 10000)],
    'cancelled',
  );
  flight('f6', 'a1', 'CAI', 'JFK', '2026-11-20', 9, 600, [
    eco('f6-eco', 10, 10000),
  ]);
  flight('f7', 'a1', 'CAI', 'DXB', '2026-11-21', 9, 200, [
    eco('f7-eco', 10, 10000),
  ]);
  return {
    data,
    flights: new FakeFlightsService(data),
    inventory: new FakeSeatInventory(data),
  };
}

const query = (over: Partial<OneWaySearchQuery> = {}): OneWaySearchQuery => ({
  from: 'CAI',
  to: 'DXB',
  date: '2026-11-20',
  adults: 1,
  children: 0,
  infants: 0,
  sortBy: 'departure',
  page: 1,
  limit: 10,
  ...over,
});
const ids = (items: FlightSearchItem[]) => items.map((i) => i.flight.id);

describe('FakeFlightsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  describe('getFlightsForBooking', () => {
    it('returns each flight with its airline and leaves unknown IDs out', async () => {
      const { flights } = setup();
      const result = await flights.getFlightsForBooking(['f2', 'nope']);
      expect([...result.keys()]).toEqual(['f2']);
      const { flight, airline } = result.get('f2')!;
      expect(flight).toMatchObject({
        flightNumber: 'FN-f2',
        durationMinutes: 270,
      });
      expect(flight.cabins[0]).toMatchObject({
        id: 'f2-eco',
        priceMinor: 25000,
      });
      expect(airline).toMatchObject({
        code: 'EK',
        baggagePolicy: {
          extraBagPriceMinor: 5000,
          maxExtraBagsPerPassenger: 2,
        },
        cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }],
      });
    });

    it('still returns cancelled flights: bookability is checkBookable’s job', async () => {
      const { flights } = setup();
      expect(
        (await flights.getFlightsForBooking(['f5'])).get('f5')?.flight.status,
      ).toBe('cancelled');
    });

    it('returns copies, so changing the result does not change the flight', async () => {
      const { flights } = setup();
      const first = await flights.getFlightsForBooking(['f1']);
      first.get('f1')!.flight.cabins[0].priceMinor = 1;
      const second = await flights.getFlightsForBooking(['f1']);
      expect(second.get('f1')!.flight.cabins[0].priceMinor).toBe(30000);
    });
  });

  describe('markFlightsDeparted', () => {
    it('uses the exact boundary, leaves cancelled flights unchanged, and is idempotent', async () => {
      const { data, flights } = setup();
      vi.setSystemTime(new Date('2026-11-20T09:00:00.000Z'));

      await expect(flights.markFlightsDeparted()).resolves.toBe(3);
      await expect(flights.markFlightsDeparted()).resolves.toBe(0);
      expect(data.flight('f2')?.status).toBe('departed');
      expect(data.flight('f1')?.status).toBe('departed');
      expect(data.flight('f3')?.status).toBe('scheduled');
      expect(data.flight('f6')?.status).toBe('departed');
      expect(data.flight('f5')?.status).toBe('cancelled');
    });
  });

  describe('checkBookable', () => {
    it('says yes for a scheduled, future flight of an active airline with enough seats', async () => {
      const { flights } = setup();
      expect(await flights.checkBookable('f1', 'f1-eco', 10)).toEqual({
        bookable: true,
      });
    });

    it.each([
      ['an unknown flight', 'nope', 'f1-eco', 1, 'flight_not_found'],
      ['an unknown cabin', 'f1', 'nope', 1, 'cabin_not_found'],
      ['a cancelled flight', 'f5', 'f5-eco', 1, 'flight_not_scheduled'],
      ['more seats than are available', 'f2', 'f2-eco', 3, 'not_enough_seats'],
    ])('says no for %s', async (_name, flightId, cabinId, seats, reason) => {
      const { flights } = setup();
      expect(await flights.checkBookable(flightId, cabinId, seats)).toEqual({
        bookable: false,
        reason,
      });
    });

    it('says no once the departure time has passed, even if the status job has not run yet', async () => {
      const { flights } = setup();
      vi.setSystemTime(new Date('2026-11-20T06:30:00.000Z')); // f2 left at 06:00
      expect(await flights.checkBookable('f2', 'f2-eco', 1)).toEqual({
        bookable: false,
        reason: 'departure_passed',
      });
    });

    it('says no for an inactive airline', async () => {
      const { flights } = setup();
      await flights.setAirlineActive('a1', false);
      expect(await flights.checkBookable('f1', 'f1-eco', 1)).toEqual({
        bookable: false,
        reason: 'airline_inactive',
      });
    });

    it('sees seats held through a FakeSeatInventory on the same data', async () => {
      const { flights, inventory } = setup();
      await inventory.hold([{ flightId: 'f2', cabinId: 'f2-eco', seats: 2 }]);
      expect(await flights.checkBookable('f2', 'f2-eco', 1)).toEqual({
        bookable: false,
        reason: 'not_enough_seats',
      });
      await inventory.release([
        { flightId: 'f2', cabinId: 'f2-eco', seats: 2 },
      ]);
      expect(await flights.checkBookable('f2', 'f2-eco', 1)).toEqual({
        bookable: true,
      });
    });
  });

  describe('search (one way)', () => {
    it('finds only scheduled flights on the route and local date', async () => {
      const { flights } = setup();
      const page = await flights.search(query());
      expect(ids(page.items)).toEqual(['f2', 'f1', 'f3']);
      expect(page).toMatchObject({
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
    });

    it('answers an empty page, not an error, when nothing matches', async () => {
      const { flights } = setup();
      expect(await flights.search(query({ from: 'JFK' }))).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });

    it('needs adults + children seats, and infants take none', async () => {
      const { flights } = setup();
      const three = await flights.search(
        query({ adults: 2, children: 1, infants: 0 }),
      );
      expect(ids(three.items)).toEqual(['f1', 'f3']); // f2 has only 2 seats
      const withInfants = await flights.search(
        query({ adults: 2, children: 0, infants: 5 }),
      );
      expect(ids(withInfants.items)).toEqual(['f2', 'f1', 'f3']);
    });

    it('filters by cabin class and lists only the cabins that matched', async () => {
      const { flights } = setup();
      const page = await flights.search(query({ cabinClass: 'business' }));
      expect(ids(page.items)).toEqual(['f1']);
      expect(page.items[0].matchingCabins.map((c) => c.id)).toEqual(['f1-biz']);
    });

    it('applies the price range to a cabin, inclusive at both ends', async () => {
      const { flights } = setup();
      const page = await flights.search(
        query({ minPriceMinor: 30000, maxPriceMinor: 40000 }),
      );
      expect(ids(page.items)).toEqual(['f1', 'f3']);
      // f1's 90000 business cabin is out of range, so it is not listed
      expect(page.items[0].matchingCabins.map((c) => c.id)).toEqual(['f1-eco']);
    });

    it('lists the matching cabins of a flight cheapest first', async () => {
      const { flights } = setup();
      const page = await flights.search(query());
      const f1 = page.items.find((i) => i.flight.id === 'f1')!;
      expect(f1.matchingCabins.map((c) => c.id)).toEqual(['f1-eco', 'f1-biz']);
    });

    it.each([
      ['price', ['f2', 'f1', 'f3']],
      ['duration', ['f3', 'f1', 'f2']],
      ['departure', ['f2', 'f1', 'f3']],
    ] as const)('sorts by %s', async (sortBy, expected) => {
      const { flights } = setup();
      expect(ids((await flights.search(query({ sortBy }))).items)).toEqual(
        expected,
      );
    });

    it('paginates', async () => {
      const { flights } = setup();
      const first = await flights.search(query({ limit: 2, page: 1 }));
      const second = await flights.search(query({ limit: 2, page: 2 }));
      expect(ids(first.items)).toEqual(['f2', 'f1']);
      expect(ids(second.items)).toEqual(['f3']);
      expect(second).toMatchObject({ total: 3, totalPages: 2, page: 2 });
      expect(
        (await flights.search(query({ limit: 2, page: 3 }))).items,
      ).toEqual([]);
    });

    it('hides flights of an inactive airline and those that departed', async () => {
      const { flights } = setup();
      await flights.setAirlineActive('a2', false);
      expect(ids((await flights.search(query())).items)).toEqual(['f1', 'f3']);
      vi.setSystemTime(new Date('2026-11-20T09:00:00.000Z')); // f1 left at 08:00
      expect(ids((await flights.search(query())).items)).toEqual(['f3']);
    });

    it('drops a flight once every seat is held through the inventory', async () => {
      const { flights, inventory } = setup();
      await inventory.hold([{ flightId: 'f2', cabinId: 'f2-eco', seats: 2 }]);
      expect(ids((await flights.search(query())).items)).toEqual(['f1', 'f3']);
    });

    it('rejects a minimum price above the maximum with 400 VALIDATION_FAILED and a detail', async () => {
      const { flights } = setup();
      await expect(
        flights.search(query({ minPriceMinor: 5000, maxPriceMinor: 1000 })),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: 'VALIDATION_FAILED',
          details: [{ field: 'minPriceMinor' }],
        },
      });
    });

    it('returns copies', async () => {
      const { flights } = setup();
      const page = await flights.search(query());
      page.items[0].flight.cabins[0].priceMinor = 1;
      page.items[0].matchingCabins[0].priceMinor = 1;
      const again = await flights.search(query());
      expect(again.items[0].matchingCabins[0].priceMinor).toBe(25000);
    });
  });

  describe('search (round trip)', () => {
    const roundTrip = (
      over: Partial<RoundTripSearchQuery> = {},
    ): RoundTripSearchQuery => ({
      ...query(),
      returnDate: '2026-11-27',
      ...over,
    });

    it('returns the outbound and the return flights, each as a page', async () => {
      const { flights } = setup();
      const result = await flights.search(roundTrip());
      expect(ids(result.outbound.items)).toEqual(['f2', 'f1', 'f3']);
      expect(ids(result.inbound.items)).toEqual(['f4']);
      expect(result.inbound).toMatchObject({ total: 1, totalPages: 1 });
    });

    it('flies the return leg in the opposite direction on the return date', async () => {
      const { flights } = setup();
      const noReturn = await flights.search(
        roundTrip({ returnDate: '2026-11-28' }),
      );
      expect(noReturn.inbound.items).toEqual([]);
      expect(ids(noReturn.outbound.items)).toEqual(['f2', 'f1', 'f3']);
    });

    it('applies the passengers and filters to both legs', async () => {
      const { flights } = setup();
      const result = await flights.search(roundTrip({ adults: 6 })); // f4 has 5 seats
      expect(ids(result.outbound.items)).toEqual(['f1', 'f3']);
      expect(result.inbound.items).toEqual([]);
    });

    it('still validates the price range', async () => {
      const { flights } = setup();
      await expect(
        flights.search(roundTrip({ minPriceMinor: 2, maxPriceMinor: 1 })),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('airlines', () => {
    it('getAirline returns a copy, or null when unknown', async () => {
      const { flights } = setup();
      expect(await flights.getAirline('a1')).toMatchObject({
        code: 'MS',
        isActive: true,
      });
      expect(await flights.getAirline('nope')).toBeNull();
      const airline = (await flights.getAirline('a1'))!;
      airline.name = 'changed';
      expect((await flights.getAirline('a1'))!.name).toBe('EgyptAir');
    });

    it('returns baggage and cancellation policy fields using the airline contract view', async () => {
      const { flights } = setup();

      expect(await flights.getAirline('a2')).toMatchObject({
        baggagePolicy: {
          extraBagPriceMinor: 5000,
          maxExtraBagsPerPassenger: 2,
        },
        cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }],
      });
    });

    it('setAirlineActive switches the flag, returns the airline and can repeat', async () => {
      const { flights } = setup();
      expect(await flights.setAirlineActive('a1', false)).toMatchObject({
        isActive: false,
      });
      expect(await flights.setAirlineActive('a1', false)).toMatchObject({
        isActive: false,
      });
      expect(await flights.setAirlineActive('a1', true)).toMatchObject({
        isActive: true,
      });
      expect((await flights.getAirline('a1'))!.isActive).toBe(true);
    });

    it('setAirlineActive answers 404 NOT_FOUND for an unknown airline', async () => {
      const { flights } = setup();
      await expect(
        flights.setAirlineActive('nope', false),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: 'NOT_FOUND' },
      });
    });

    describe('flight management', () => {
      const input = {
        flightNumber: 'ms 123',
        departureAirportId: 'JFK',
        arrivalAirportId: 'CAI',
        departureLocal: '2027-03-14T03:30',
        arrivalLocal: '2027-03-14T10:00',
      };

      it('creates a normalized flight and returns it in the own-airline page with zones', async () => {
        const { flights } = setup();
        const created = await flights.createFlight(input, 'a1');

        expect(created).toMatchObject({
          airlineId: 'a1',
          flightNumber: 'MS 123',
          departureAt: new Date('2027-03-14T07:30:00.000Z'),
          arrivalAt: new Date('2027-03-14T08:00:00.000Z'),
          departureTimeZone: 'America/New_York',
          arrivalTimeZone: 'Africa/Cairo',
        });

        const page = await flights.listAirlineFlights('a1', 'a1', {
          page: 1,
          limit: 10,
        });
        expect(page.items).toContainEqual(created);
        expect(page.total).toBe(6);
        expect(page.items.every((flight) => flight.airlineId === 'a1')).toBe(
          true,
        );
      });

      it('does not list another airline without its assigned moderator ID', async () => {
        const { flights } = setup();
        await expect(
          flights.listAirlineFlights('a2', 'a1', { page: 1, limit: 10 }),
        ).rejects.toMatchObject({
          status: 404,
          response: { code: 'NOT_FOUND' },
        });
      });

      it('rejects duplicate numbers for the same airline and local date', async () => {
        const { flights } = setup();
        await flights.createFlight(input, 'a1');
        await expect(
          flights.createFlight({ ...input, flightNumber: 'MS 123' }, 'a1'),
        ).rejects.toMatchObject({
          status: 409,
          response: { code: 'CONFLICT' },
        });
      });

      it('returns 404 for an unknown airline and 400 for an unknown airport', async () => {
        const { flights } = setup();
        await expect(
          flights.createFlight(input, 'unknown'),
        ).rejects.toMatchObject({
          status: 404,
          response: { code: 'NOT_FOUND' },
        });
        await expect(
          flights.createFlight({ ...input, departureAirportId: 'ZZZ' }, 'a1'),
        ).rejects.toMatchObject({
          status: 400,
          response: {
            code: 'VALIDATION_FAILED',
            details: [{ field: 'departureAirportId' }],
          },
        });
      });
    });
  });
});
