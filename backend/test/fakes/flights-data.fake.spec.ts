import { FakeFlightsData } from './flights-data.fake.js';
import type { FakeFlightSeed } from './flights-data.fake.js';

function seed(over: Partial<FakeFlightSeed> = {}): FakeFlightSeed {
  return {
    id: 'f1',
    airlineId: 'a1',
    flightNumber: 'MS100',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAt: new Date('2026-11-20T08:00:00.000Z'),
    arrivalAt: new Date('2026-11-20T11:30:00.000Z'),
    cabins: [
      { id: 'c1', cabinClass: 'economy', totalSeats: 10, priceMinor: 30000 },
    ],
    ...over,
  };
}

function data() {
  const d = new FakeFlightsData();
  d.addAirline({ id: 'a1', code: 'MS' });
  return d;
}

describe('FakeFlightsData', () => {
  it('fills in the defaults a real flight would have', () => {
    const flight = data().addFlight(seed());
    expect(flight).toMatchObject({
      status: 'scheduled',
      hasBookings: false,
      durationMinutes: 210,
      departureLocalDate: '2026-11-20',
    });
    expect(flight.cabins[0]).toMatchObject({
      availableSeats: 10,
      heldSeats: 0,
      bookedSeats: 0,
      freeBags: 1,
      maxBagWeightKg: 23,
    });
  });

  it('gives a new airline the same defaults as the schema', () => {
    expect(
      new FakeFlightsData().addAirline({ id: 'a', code: 'XX' }),
    ).toMatchObject({
      isActive: true,
      baggagePolicy: { extraBagPriceMinor: null, maxExtraBagsPerPassenger: 0 },
      cancellationTiers: [],
    });
  });

  it('derives available seats from the other counters', () => {
    const flight = data().addFlight(
      seed({
        cabins: [
          {
            id: 'c1',
            cabinClass: 'economy',
            totalSeats: 10,
            heldSeats: 2,
            bookedSeats: 3,
            priceMinor: 1,
          },
        ],
      }),
    );
    expect(flight.cabins[0].availableSeats).toBe(5);
  });

  it.each([
    [
      'a duplicate airline',
      (d: FakeFlightsData) => d.addAirline({ id: 'a1', code: 'ZZ' }),
    ],
    [
      'a duplicate flight',
      (d: FakeFlightsData) => {
        d.addFlight(seed());
        d.addFlight(seed());
      },
    ],
    [
      'an unknown airline',
      (d: FakeFlightsData) => d.addFlight(seed({ airlineId: 'nope' })),
    ],
    [
      'the same airport twice',
      (d: FakeFlightsData) => d.addFlight(seed({ arrivalAirportId: 'CAI' })),
    ],
    [
      'arrival before departure',
      (d: FakeFlightsData) =>
        d.addFlight(seed({ arrivalAt: new Date('2026-11-20T08:00:00.000Z') })),
    ],
    [
      'a cabin class twice',
      (d: FakeFlightsData) =>
        d.addFlight(
          seed({
            cabins: [
              { id: 'c1', cabinClass: 'economy', totalSeats: 1, priceMinor: 1 },
              { id: 'c2', cabinClass: 'economy', totalSeats: 1, priceMinor: 1 },
            ],
          }),
        ),
    ],
    [
      'more than 4 cabins',
      (d: FakeFlightsData) =>
        d.addFlight(
          seed({
            cabins: [
              'economy',
              'premium_economy',
              'business',
              'first',
              'economy',
            ].map((cabinClass, i) => ({
              id: `c${i}`,
              cabinClass: cabinClass as 'economy',
              totalSeats: 1,
              priceMinor: 1,
            })),
          }),
        ),
    ],
    [
      'counters that do not add up',
      (d: FakeFlightsData) =>
        d.addFlight(
          seed({
            cabins: [
              {
                id: 'c1',
                cabinClass: 'economy',
                totalSeats: 10,
                availableSeats: 9,
                heldSeats: 2,
                priceMinor: 1,
              },
            ],
          }),
        ),
    ],
  ])('refuses %s', (_name, act) => {
    expect(() => act(data())).toThrow();
  });
});
