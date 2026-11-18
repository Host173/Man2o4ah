import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { FakeFlightsData } from '../../../test/fakes/flights-data.fake.js';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakeSeatInventory } from '../../../test/fakes/seat-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { FlightsService } from '../flights/flights.service.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import type { FlightQuoteRequestDto } from './dto/flight-quote.dto.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { FlightHoldService } from './flight-hold.service.js';
import {
  FlightBooking,
  type FlightBookingDocument,
} from './schemas/flight-booking.schema.js';

// Ids are stored as ObjectIds, so the fake flights use real-looking ones.
const AIRLINE = '6553a1f0c2b4e8a9d0f1b001';
const OUT = '6553a1f0c2b4e8a9d0f1b002';
const OUT_ECO = '6553a1f0c2b4e8a9d0f1b003';
const BACK = '6553a1f0c2b4e8a9d0f1b004';
const BACK_ECO = '6553a1f0c2b4e8a9d0f1b005';
const USER = '6553a1f0c2b4e8a9d0f1b099';

const OUT_DEPARTS = new Date('2027-03-10T08:00:00.000Z');
const BACK_DEPARTS = new Date('2027-03-17T08:00:00.000Z');

/** One airline, an outbound with 50 economy seats and a return with `backSeats`. */
function seedFlights(backSeats = 50): FakeFlightsData {
  const data = new FakeFlightsData();
  data.addAirline({
    id: AIRLINE,
    code: 'MS',
    name: 'Nile Air',
    baggagePolicy: { extraBagPriceMinor: 3_000, maxExtraBagsPerPassenger: 2 },
    cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
  });
  const flight = (
    id: string,
    cabinId: string,
    from: string,
    to: string,
    departureAt: Date,
    availableSeats: number,
  ) =>
    data.addFlight({
      id,
      airlineId: AIRLINE,
      flightNumber: id === OUT ? 'MS100' : 'MS101',
      departureAirportId: from,
      arrivalAirportId: to,
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 4 * 3_600_000),
      cabins: [
        {
          id: cabinId,
          cabinClass: 'economy',
          totalSeats: 50,
          availableSeats,
          heldSeats: 50 - availableSeats,
          priceMinor: 20_000,
        },
      ],
    });
  flight(OUT, OUT_ECO, 'CAI', 'DXB', OUT_DEPARTS, 50);
  flight(BACK, BACK_ECO, 'DXB', 'CAI', BACK_DEPARTS, backSeats);
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
  passengers: Passenger[] = [adult()],
): FlightQuoteRequestDto => ({
  tripType: 'one_way',
  segments: [{ flightId: OUT, cabinId: OUT_ECO }],
  passengers,
});
const roundTrip = (
  passengers: Passenger[] = [adult()],
): FlightQuoteRequestDto => ({
  tripType: 'round_trip',
  segments: [
    { flightId: OUT, cabinId: OUT_ECO },
    { flightId: BACK, cabinId: BACK_ECO },
  ],
  passengers,
});

const TEN_MINUTES = 10 * 60 * 1000;

describe('FlightHoldService.hold (FLT-22)', () => {
  let t: TestApp;
  let holds: FlightHoldService;
  let bookings: Model<FlightBookingDocument>;
  // One fake of each, re-seeded before every test (they share the same data).
  const flights = new FakeFlightsService();
  const seats = new FakeSeatInventory();

  function reseed(backSeats?: number): void {
    const data = seedFlights(backSeats);
    Object.assign(flights, new FakeFlightsService(data));
    Object.assign(seats, new FakeSeatInventory(data));
  }

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FlightBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightsService)
          .useValue(flights)
          .overrideProvider(SeatInventory)
          .useValue(seats),
    });
    holds = t.moduleRef.get(FlightHoldService);
    bookings = t.moduleRef.get<Model<FlightBookingDocument>>(
      getModelToken(FlightBooking.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    reseed();
    await clearCollections(t.connection);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  it('saves one pending_payment booking with every snapshot', async () => {
    const hold = await holds.hold(
      oneWay([adult({ extraBagCount: 1, extraBagWeightKg: 20 }), infant()]),
      USER,
    );

    expect(hold).toMatchObject({
      status: 'pending_payment',
      tripType: 'one_way',
      seatCount: 1,
      pricing: { totalMinor: 20_000 + 2_000 + 3_000, currency: 'USD' },
    });

    const saved = await bookings.findById(hold.bookingId).lean();
    expect(saved).toMatchObject({
      status: 'pending_payment',
      tripType: 'one_way',
      seatCount: 1,
      pricing: {
        fareTotalMinor: 22_000,
        baggageTotalMinor: 3_000,
        totalMinor: 25_000,
        currency: 'USD',
      },
      firstDepartureAt: OUT_DEPARTS,
      lastDepartureAt: OUT_DEPARTS,
    });
    expect(saved?.reference).toBeUndefined(); // set only on confirmation (FLT-23)
    expect(saved?.userId.toString()).toBe(USER);

    // The segment keeps the fare and the airline's policy as they were now.
    expect(saved?.segments).toHaveLength(1);
    expect(saved?.segments[0]).toMatchObject({
      direction: 'outbound',
      cabinClass: 'economy',
      flightNumber: 'MS100',
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureAt: OUT_DEPARTS,
      fareMinor: 20_000,
      policy: {
        cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
        freeBags: 1,
        maxBagWeightKg: 23,
        extraBagPriceMinor: 3_000,
        maxExtraBagsPerPassenger: 2,
      },
    });
    expect(saved?.segments[0].flightId.toString()).toBe(OUT);
    expect(saved?.segments[0].cabinId.toString()).toBe(OUT_ECO);

    // Passengers are stored with a DateOnly date of birth.
    expect(saved?.passengers).toHaveLength(2);
    expect(saved?.passengers[1]).toMatchObject({
      type: 'infant',
      fullName: 'Baby Amr',
      dateOfBirth: new Date('2026-06-01T00:00:00.000Z'),
    });
  });

  it('holds the seats in the flight inventory', async () => {
    await holds.hold(oneWay([adult(), adult(), infant()]), USER);
    expect(seats.counters(OUT, OUT_ECO)).toMatchObject({
      availableSeats: 48, // two seats; the infant takes none
      heldSeats: 2,
    });
  });

  it('holds both segments of a round trip, and dates the booking by both', async () => {
    const hold = await holds.hold(roundTrip(), USER);

    expect(seats.counters(OUT, OUT_ECO)?.heldSeats).toBe(1);
    expect(seats.counters(BACK, BACK_ECO)?.heldSeats).toBe(1);
    const saved = await bookings.findById(hold.bookingId).lean();
    expect(saved?.segments.map((s) => s.direction)).toEqual([
      'outbound',
      'return',
    ]);
    expect(saved).toMatchObject({
      firstDepartureAt: OUT_DEPARTS,
      lastDepartureAt: BACK_DEPARTS,
    });
  });

  it('expires the hold exactly 10 minutes after the booking is created', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T09:00:00.000Z'));

    const hold = await holds.hold(oneWay(), USER);

    // `timestamps: true` adds createdAt; the schema class doesn't declare it.
    const saved = await bookings
      .findById(hold.bookingId)
      .lean<FlightBooking & { createdAt: Date }>();
    const createdAt = new Date('2026-12-01T09:00:00.000Z');
    expect(saved?.createdAt).toEqual(createdAt);
    expect(saved?.holdExpiresAt).toEqual(
      new Date(createdAt.getTime() + TEN_MINUTES),
    );
    expect(hold.holdExpiresAt).toEqual(saved?.holdExpiresAt);
  });

  it('answers 409 SEATS_UNAVAILABLE and holds nothing when one segment is full', async () => {
    reseed(0); // the return flight has no seats left

    await expect(holds.hold(roundTrip(), USER)).rejects.toMatchObject({
      status: 409,
      response: { code: 'SEATS_UNAVAILABLE' },
    });

    expect(await bookings.countDocuments()).toBe(0);
    expect(seats.counters(OUT, OUT_ECO)?.heldSeats).toBe(0);
  });

  it('answers 400 for an invalid request and touches nothing', async () => {
    await expect(
      holds.hold(oneWay([adult({ type: 'child' })]), USER),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'VALIDATION_FAILED' },
    });

    expect(await bookings.countDocuments()).toBe(0);
    expect(seats.counters(OUT, OUT_ECO)?.heldSeats).toBe(0);
  });

  it('never sells more seats than there are, even with parallel holds', async () => {
    reseed();
    // 50 seats; 30 users each try to hold 2 at the same time.
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, () =>
        holds.hold(oneWay([adult(), adult()]), USER),
      ),
    );

    // Assert the invariant, never which requests won.
    const won = results.filter((r) => r.status === 'fulfilled').length;
    expect(won).toBe(25);
    expect(await bookings.countDocuments()).toBe(25);
    expect(seats.counters(OUT, OUT_ECO)).toMatchObject({
      availableSeats: 0,
      heldSeats: 50,
    });
  });

  describe('transaction (review #147)', () => {
    // A stand-in for the real SeatInventory (INV-01): it writes inside the
    // caller's session, so only a real transaction can undo it.
    function holdWritesInSession(): void {
      const inventory = t.moduleRef.get(SeatInventory);
      vi.spyOn(inventory, 'hold').mockImplementationOnce(
        async (_items, options) => {
          await t.connection
            .collection('inventory_writes')
            .insertOne({ kind: 'hold' }, { session: options.session });
        },
      );
    }

    it('rolls the held seats back when saving the booking fails', async () => {
      holdWritesInSession();
      vi.spyOn(bookings, 'create').mockRejectedValueOnce(
        new Error('write failed'),
      );

      await expect(holds.hold(oneWay(), USER)).rejects.toThrow('write failed');

      // Without the transaction the seat write would still be there.
      expect(
        await t.connection.collection('inventory_writes').countDocuments(),
      ).toBe(0);
      expect(await bookings.countDocuments()).toBe(0);
    });

    // Without the session, a retried transaction could save a second booking.
    it('saves the booking inside the transaction (create gets the session)', async () => {
      const create = vi.spyOn(bookings, 'create');

      await holds.hold(oneWay(), USER);

      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ session: expect.anything() }),
      );
    });

    it('commits the seats and the booking together when both succeed', async () => {
      holdWritesInSession();

      await holds.hold(oneWay(), USER);

      expect(
        await t.connection.collection('inventory_writes').countDocuments(),
      ).toBe(1);
      expect(await bookings.countDocuments()).toBe(1);
    });
  });

  describe('close to departure (review #147)', () => {
    const SOON = '6553a1f0c2b4e8a9d0f1b006';
    const SOON_ECO = '6553a1f0c2b4e8a9d0f1b007';
    const NOW = new Date('2027-03-01T08:00:00.000Z');

    /** Adds a flight that leaves `msAfterNow` after NOW. */
    function flightLeavingIn(msAfterNow: number): FlightQuoteRequestDto {
      const departureAt = new Date(NOW.getTime() + msAfterNow);
      flights.data.addFlight({
        id: SOON,
        airlineId: AIRLINE,
        flightNumber: 'MS200',
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureAt,
        arrivalAt: new Date(departureAt.getTime() + 4 * 3_600_000),
        cabins: [
          {
            id: SOON_ECO,
            cabinClass: 'economy',
            totalSeats: 50,
            priceMinor: 20_000,
          },
        ],
      });
      return {
        tripType: 'one_way',
        segments: [{ flightId: SOON, cabinId: SOON_ECO }],
        passengers: [adult()],
      };
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });

    // A hold must not outlive the flight: at least the 10-minute hold must fit.
    it('holds a flight that leaves exactly 10 minutes from now', async () => {
      const hold = await holds.hold(flightLeavingIn(TEN_MINUTES), USER);
      expect(hold.status).toBe('pending_payment');
    });

    it('refuses a flight that leaves in less than 10 minutes, and holds nothing', async () => {
      await expect(
        holds.hold(flightLeavingIn(TEN_MINUTES - 1), USER),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: 'VALIDATION_FAILED',
          details: [expect.objectContaining({ field: 'segments[0]' })],
        },
      });
      expect(await bookings.countDocuments()).toBe(0);
      expect(seats.counters(SOON, SOON_ECO)?.heldSeats).toBe(0);
    });
  });
});
