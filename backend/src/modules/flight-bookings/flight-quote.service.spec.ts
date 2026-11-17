import { Test } from '@nestjs/testing';
import { FakeFlightsData } from '../../../test/fakes/flights-data.fake.js';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FlightsService } from '../flights/flights.service.js';
import type { FlightQuoteRequestDto } from './dto/flight-quote.dto.js';
import { FlightQuoteService } from './flight-quote.service.js';

const OUT_DEPARTS = new Date('2027-03-10T08:00:00.000Z');
const OUT_ARRIVES = new Date('2027-03-10T12:00:00.000Z');

/** Airlines and flights for every case. All departures are in the future. */
function seedFlights(): FakeFlightsData {
  const data = new FakeFlightsData();
  data.addAirline({
    id: 'airline-1',
    code: 'MS',
    name: 'Nile Air',
    baggagePolicy: { extraBagPriceMinor: 3_000, maxExtraBagsPerPassenger: 2 },
    cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
  });
  data.addAirline({ id: 'no-bags', code: 'NB' }); // sells no extra bags
  data.addAirline({ id: 'inactive', code: 'IN', isActive: false });

  const cabin = (id: string, priceMinor: number, availableSeats = 50) => ({
    id,
    cabinClass: 'economy' as const,
    totalSeats: 50,
    availableSeats,
    heldSeats: 50 - availableSeats,
    priceMinor,
    maxBagWeightKg: 23,
  });
  const flight = (
    id: string,
    airlineId: string,
    from: string,
    to: string,
    departureAt: Date,
    cabins = [cabin(`${id}-eco`, 20_000)],
    extra: { status?: 'scheduled' | 'cancelled' | 'departed' } = {},
  ) =>
    data.addFlight({
      id,
      airlineId,
      flightNumber: id.toUpperCase(),
      departureAirportId: from,
      arrivalAirportId: to,
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 4 * 3_600_000),
      cabins,
      ...extra,
    });

  flight('out', 'airline-1', 'CAI', 'DXB', OUT_DEPARTS);
  flight(
    'back',
    'airline-1',
    'DXB',
    'CAI',
    new Date('2027-03-17T08:00:00.000Z'),
    [cabin('back-eco', 15_000)],
  );
  flight(
    'too-early',
    'airline-1',
    'DXB',
    'CAI',
    new Date('2027-03-10T10:00:00.000Z'),
  );
  flight(
    'elsewhere',
    'airline-1',
    'DXB',
    'JED',
    new Date('2027-03-17T08:00:00.000Z'),
  );
  flight('nobags', 'no-bags', 'CAI', 'DXB', OUT_DEPARTS);
  flight('inactive-flight', 'inactive', 'CAI', 'DXB', OUT_DEPARTS);
  flight('cancelled', 'airline-1', 'CAI', 'DXB', OUT_DEPARTS, undefined, {
    status: 'cancelled',
  });
  flight('departed', 'airline-1', 'CAI', 'DXB', OUT_DEPARTS, undefined, {
    status: 'departed',
  });
  flight('almost-full', 'airline-1', 'CAI', 'DXB', OUT_DEPARTS, [
    cabin('almost-full-eco', 20_000, 1),
  ]);
  // Departs at 23:00 UTC, which is already the 11th at the departure airport.
  data.addFlight({
    id: 'late',
    airlineId: 'airline-1',
    flightNumber: 'LATE',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAt: new Date('2027-03-10T23:00:00.000Z'),
    arrivalAt: new Date('2027-03-11T03:00:00.000Z'),
    departureLocalDate: '2027-03-11',
    cabins: [cabin('late-eco', 20_000)],
  });
  return data;
}

type Passenger = FlightQuoteRequestDto['passengers'][number];
const adult = (changes: Partial<Passenger> = {}): Passenger => ({
  type: 'adult',
  fullName: 'Aya Amr',
  dateOfBirth: '1990-01-01',
  documentNumber: 'A1234567',
  extraBagCount: 0,
  ...changes,
});
const infant = (): Passenger =>
  adult({ type: 'infant', fullName: 'Baby Amr', dateOfBirth: '2026-06-01' });

const oneWay = (
  flightId = 'out',
  passengers: Passenger[] = [adult()],
  cabinId = `${flightId}-eco`,
): FlightQuoteRequestDto => ({
  tripType: 'one_way',
  segments: [{ flightId, cabinId }],
  passengers,
});

const roundTrip = (backId: string): FlightQuoteRequestDto => ({
  tripType: 'round_trip',
  segments: [
    { flightId: 'out', cabinId: 'out-eco' },
    { flightId: backId, cabinId: `${backId}-eco` },
  ],
  passengers: [adult()],
});

/** Matches a 400 VALIDATION_FAILED whose details include `field`. */
const invalid = (field: string) => ({
  status: 400,
  response: {
    code: 'VALIDATION_FAILED',
    details: expect.arrayContaining([expect.objectContaining({ field })]),
  },
});

describe('FlightQuoteService.quote (FLT-19, FLT-21)', () => {
  let quotes: FlightQuoteService;

  beforeEach(async () => {
    // A fresh module per test: the real quote service, a fake flights module.
    const moduleRef = await Test.createTestingModule({
      providers: [
        FlightQuoteService,
        {
          provide: FlightsService,
          useValue: new FakeFlightsService(seedFlights()),
        },
      ],
    }).compile();
    quotes = moduleRef.get(FlightQuoteService);
  });

  it('prices a one-way trip and returns the summary', async () => {
    const quote = await quotes.quote(
      oneWay('out', [
        adult({ extraBagCount: 1, extraBagWeightKg: 20 }),
        infant(),
      ]),
    );

    expect(quote.tripType).toBe('one_way');
    expect(quote.seatCount).toBe(1);
    expect(quote.pricing).toEqual({
      fareTotalMinor: 20_000 + 2_000,
      baggageTotalMinor: 3_000,
      totalMinor: 25_000,
      currency: 'USD',
    });
    expect(quote.segments).toEqual([
      expect.objectContaining({
        direction: 'outbound',
        flightId: 'out',
        cabinId: 'out-eco',
        cabinClass: 'economy',
        airlineId: 'airline-1',
        airlineName: 'Nile Air',
        flightNumber: 'OUT',
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureAt: OUT_DEPARTS,
        arrivalAt: OUT_ARRIVES,
        fareMinor: 20_000,
        policy: {
          cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
          freeBags: 1,
          maxBagWeightKg: 23,
          extraBagPriceMinor: 3_000,
          maxExtraBagsPerPassenger: 2,
        },
      }),
    ]);
    expect(quote.passengers).toHaveLength(2);
  });

  it('prices a round trip and marks the second segment as the return', async () => {
    const quote = await quotes.quote(roundTrip('back'));
    expect(quote.segments.map((s) => s.direction)).toEqual([
      'outbound',
      'return',
    ]);
    expect(quote.pricing.fareTotalMinor).toBe(20_000 + 15_000);
  });

  describe('segments', () => {
    const mismatched: [string, FlightQuoteRequestDto][] = [
      [
        'one_way with two segments',
        {
          tripType: 'one_way',
          segments: roundTrip('back').segments,
          passengers: [adult()],
        },
      ],
      [
        'round_trip with one segment',
        {
          tripType: 'round_trip',
          segments: oneWay().segments,
          passengers: [adult()],
        },
      ],
    ];
    it.each(mismatched)('rejects %s', async (_label, body) => {
      await expect(quotes.quote(body)).rejects.toMatchObject(
        invalid('segments'),
      );
    });

    it('rejects an unknown flight', async () => {
      await expect(quotes.quote(oneWay('missing'))).rejects.toMatchObject(
        invalid('segments[0].flightId'),
      );
    });

    it('rejects an unknown cabin', async () => {
      await expect(
        quotes.quote(oneWay('out', [adult()], 'no-such-cabin')),
      ).rejects.toMatchObject(invalid('segments[0].cabinId'));
    });

    it.each([
      ['an inactive airline', 'inactive-flight'],
      ['a cancelled flight', 'cancelled'],
      ['a departed flight', 'departed'],
    ])('rejects %s', async (_label, flightId) => {
      await expect(quotes.quote(oneWay(flightId))).rejects.toMatchObject(
        invalid('segments[0]'),
      );
    });

    it('rejects a return that does not go back to the origin', async () => {
      await expect(quotes.quote(roundTrip('elsewhere'))).rejects.toMatchObject(
        invalid('segments[1]'),
      );
    });

    it('rejects a return that leaves before the outbound lands', async () => {
      await expect(quotes.quote(roundTrip('too-early'))).rejects.toMatchObject(
        invalid('segments[1]'),
      );
    });
  });

  it('answers 409 SEATS_UNAVAILABLE when the cabin has too few seats', async () => {
    await expect(
      quotes.quote(oneWay('almost-full', [adult(), adult()])),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'SEATS_UNAVAILABLE' },
    });
  });

  it('answers 400, not 409, when a full cabin also has a broken rule', async () => {
    // Too few seats AND a passenger with the wrong type: the 400 wins.
    await expect(
      quotes.quote(oneWay('almost-full', [adult(), adult({ type: 'child' })])),
    ).rejects.toMatchObject(invalid('passengers[1].type'));
  });

  it('lets an infant through without a seat when only one seat is left', async () => {
    const quote = await quotes.quote(
      oneWay('almost-full', [adult(), infant()]),
    );
    expect(quote.seatCount).toBe(1);
  });

  describe('passengers', () => {
    it('reports the passenger rule errors as 400 details', async () => {
      await expect(
        quotes.quote(oneWay('out', [adult({ type: 'child' })])),
      ).rejects.toMatchObject(invalid('passengers[0].type'));
    });

    it('rejects a calendar date that does not exist', async () => {
      await expect(
        quotes.quote(oneWay('out', [adult({ dateOfBirth: '1990-02-30' })])),
      ).rejects.toMatchObject(invalid('passengers[0].dateOfBirth'));
    });

    it('still reports the other rules when a date does not exist', async () => {
      // An impossible date AND no adult: both are reported at once.
      const child = adult({ type: 'child', dateOfBirth: '2018-02-30' });
      const error = await quotes
        .quote(oneWay('out', [child]))
        .catch((e: unknown) => e);
      expect(error).toMatchObject(invalid('passengers[0].dateOfBirth'));
      expect(error).toMatchObject(invalid('passengers'));
    });

    it('rejects a date of birth after today, even before the flight', async () => {
      // Born tomorrow: before the March 2027 flight, but still in the future.
      const tomorrow = new Date(Date.now() + 24 * 3_600_000)
        .toISOString()
        .slice(0, 10);
      const unborn = infant();
      unborn.dateOfBirth = tomorrow;
      await expect(
        quotes.quote(oneWay('out', [adult(), unborn])),
      ).rejects.toMatchObject(invalid('passengers[1].dateOfBirth'));
    });

    it('rejects a bag weight over the limit even with no extra bags', async () => {
      const heavy = adult({ extraBagCount: 0, extraBagWeightKg: 99 });
      await expect(quotes.quote(oneWay('out', [heavy]))).rejects.toMatchObject(
        invalid('passengers[0].extraBagWeightKg'),
      );
    });

    it('rejects extra bags on an airline that sells none', async () => {
      const withBag = adult({ extraBagCount: 1, extraBagWeightKg: 20 });
      await expect(
        quotes.quote(oneWay('nobags', [withBag])),
      ).rejects.toMatchObject(invalid('passengers[0].extraBagCount'));
    });

    it('uses the local departure date for ages, not the UTC date', async () => {
      // Turns 12 on 2027-03-11, the local date of the 'late' flight
      // (UTC is still the 10th): an adult, not a child.
      const turns12 = adult({ dateOfBirth: '2015-03-11' });
      const quote = await quotes.quote(oneWay('late', [turns12]));
      expect(quote.passengers[0].type).toBe('adult');
    });
  });
});
