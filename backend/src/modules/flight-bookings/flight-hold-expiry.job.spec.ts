import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { FakeFlightsData } from '../../../test/fakes/flights-data.fake.js';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakeSeatInventory } from '../../../test/fakes/seat-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { FakeEvents } from '../../../test/support/fake-events.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { FlightsService } from '../flights/flights.service.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { transitionStatus } from './booking-lifecycle.js';
import type { FlightQuoteRequestDto } from './dto/flight-quote.dto.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { FlightHoldExpiryJob } from './flight-hold-expiry.job.js';
import { FlightHoldService } from './flight-hold.service.js';
import { FlightBooking } from './schemas/flight-booking.schema.js';

const AIRLINE = '6553a1f0c2b4e8a9d0f1d001';
const OUT = '6553a1f0c2b4e8a9d0f1d002';
const OUT_ECO = '6553a1f0c2b4e8a9d0f1d003';
const BACK = '6553a1f0c2b4e8a9d0f1d004';
const BACK_ECO = '6553a1f0c2b4e8a9d0f1d005';
const USER = '6553a1f0c2b4e8a9d0f1d099';

// A 200-seat flight for the "many holds" test.
const BIG = '6553a1f0c2b4e8a9d0f1d006';
const BIG_ECO = '6553a1f0c2b4e8a9d0f1d007';

function seedFlights(): FakeFlightsData {
  const data = new FakeFlightsData();
  data.addAirline({ id: AIRLINE, code: 'MS' });
  const flight = (
    id: string,
    cabinId: string,
    from: string,
    to: string,
    departureAt: Date,
  ) =>
    data.addFlight({
      id,
      airlineId: AIRLINE,
      flightNumber: 'MS100',
      departureAirportId: from,
      arrivalAirportId: to,
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 4 * 3_600_000),
      cabins: [
        {
          id: cabinId,
          cabinClass: 'economy',
          totalSeats: id === BIG ? 200 : 50,
          priceMinor: 20_000,
        },
      ],
    });
  flight(BIG, BIG_ECO, 'CAI', 'JED', new Date('2027-03-20T08:00:00Z'));
  flight(OUT, OUT_ECO, 'CAI', 'DXB', new Date('2027-03-10T08:00:00Z'));
  flight(BACK, BACK_ECO, 'DXB', 'CAI', new Date('2027-03-17T08:00:00Z'));
  return data;
}

const adult = {
  type: 'adult' as const,
  fullName: 'Aya Amr',
  dateOfBirth: '1990-01-01',
  documentNumber: 'A1234567',
  extraBagCount: 0,
};
const oneWay: FlightQuoteRequestDto = {
  tripType: 'one_way',
  segments: [{ flightId: OUT, cabinId: OUT_ECO }],
  passengers: [adult, adult],
};
const roundTrip: FlightQuoteRequestDto = {
  tripType: 'round_trip',
  segments: [
    { flightId: OUT, cabinId: OUT_ECO },
    { flightId: BACK, cabinId: BACK_ECO },
  ],
  passengers: [adult],
};

/** `ms` milliseconds after `date`. */
const plus = (date: Date, ms: number) => new Date(date.getTime() + ms);

describe('FlightHoldExpiryJob (FLT-22, GEN-11)', () => {
  let t: TestApp;
  let holds: FlightHoldService;
  let job: FlightHoldExpiryJob;
  let bookings: Model<FlightBooking>;
  const flights = new FakeFlightsService();
  const seats = new FakeSeatInventory();
  const events = new FakeEvents();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FlightBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightsService)
          .useValue(flights)
          .overrideProvider(SeatInventory)
          .useValue(seats)
          .overrideProvider(AppEvents)
          .useValue(events),
    });
    holds = t.moduleRef.get(FlightHoldService);
    job = t.moduleRef.get(FlightHoldExpiryJob);
    bookings = t.moduleRef.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    const data = seedFlights();
    Object.assign(flights, new FakeFlightsService(data));
    Object.assign(seats, new FakeSeatInventory(data));
    events.clear();
    await clearCollections(t.connection);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  it('expires a hold exactly at holdExpiresAt and releases its seats', async () => {
    const hold = await holds.hold(oneWay, USER);
    expect(seats.counters(OUT, OUT_ECO)?.heldSeats).toBe(2);

    await expect(job.expireDueHolds(hold.holdExpiresAt)).resolves.toBe(1);

    const saved = await bookings.findById(hold.bookingId).lean();
    expect(saved).toMatchObject({
      status: 'expired',
      expiredAt: hold.holdExpiresAt,
    });
    expect(seats.counters(OUT, OUT_ECO)).toMatchObject({
      availableSeats: 50,
      heldSeats: 0,
    });
  });

  it('emits FlightBookingExpired once, after the change', async () => {
    const hold = await holds.hold(oneWay, USER);
    await job.expireDueHolds(hold.holdExpiresAt);

    expect(events.payloadsOf(Events.FlightBookingExpired)).toEqual([
      { bookingId: hold.bookingId, userId: USER },
    ]);
  });

  it('leaves a hold alone 1 ms before it expires', async () => {
    const hold = await holds.hold(oneWay, USER);

    await expect(
      job.expireDueHolds(plus(hold.holdExpiresAt, -1)),
    ).resolves.toBe(0);

    expect((await bookings.findById(hold.bookingId).lean())?.status).toBe(
      'pending_payment',
    );
    expect(seats.counters(OUT, OUT_ECO)?.heldSeats).toBe(2);
    expect(events.emitted).toEqual([]);
  });

  it('releases both segments of a round trip', async () => {
    const hold = await holds.hold(roundTrip, USER);
    await job.expireDueHolds(hold.holdExpiresAt);

    expect(seats.counters(OUT, OUT_ECO)?.heldSeats).toBe(0);
    expect(seats.counters(BACK, BACK_ECO)?.heldSeats).toBe(0);
  });

  it('expires every due hold in one run', async () => {
    const first = await holds.hold(oneWay, USER);
    await holds.hold(oneWay, USER);
    await holds.hold(oneWay, USER);

    const later = plus(first.holdExpiresAt, 60_000);
    await expect(job.expireDueHolds(later)).resolves.toBe(3);
    expect(await bookings.countDocuments({ status: 'expired' })).toBe(3);
    expect(seats.counters(OUT, OUT_ECO)?.heldSeats).toBe(0);
  });

  it('never touches a booking that is no longer pending', async () => {
    const hold = await holds.hold(oneWay, USER);
    await transitionStatus(
      bookings,
      hold.bookingId,
      'pending_payment',
      'confirmed',
      {
        confirmedAt: new Date(),
      },
    );

    await expect(
      job.expireDueHolds(plus(hold.holdExpiresAt, 60_000)),
    ).resolves.toBe(0);

    expect((await bookings.findById(hold.bookingId).lean())?.status).toBe(
      'confirmed',
    );
    expect(seats.counters(OUT, OUT_ECO)?.heldSeats).toBe(2);
  });

  it('is safe to run twice: no second release and no second event', async () => {
    const hold = await holds.hold(oneWay, USER);
    await job.expireDueHolds(hold.holdExpiresAt);

    await expect(job.expireDueHolds(hold.holdExpiresAt)).resolves.toBe(0);

    expect(seats.counters(OUT, OUT_ECO)).toMatchObject({
      availableSeats: 50,
      heldSeats: 0,
    });
    expect(events.payloadsOf(Events.FlightBookingExpired)).toHaveLength(1);
  });

  it('lets exactly one of payment and expiry win when they race', async () => {
    const hold = await holds.hold(oneWay, USER);

    // The webhook confirming (FLT-23) and the job expiring, at the same moment.
    await Promise.allSettled([
      transitionStatus(
        bookings,
        hold.bookingId,
        'pending_payment',
        'confirmed',
        {
          confirmedAt: new Date(),
        },
      ),
      job.expireDueHolds(plus(hold.holdExpiresAt, 1)),
    ]);

    // Assert the invariant, never which one won.
    const status = (await bookings.findById(hold.bookingId).lean())?.status;
    expect(['confirmed', 'expired']).toContain(status);
    // Seats are released only if the expiry won.
    expect(seats.counters(OUT, OUT_ECO)?.heldSeats).toBe(
      status === 'expired' ? 0 : 2,
    );
    expect(events.payloadsOf(Events.FlightBookingExpired)).toHaveLength(
      status === 'expired' ? 1 : 0,
    );
  });

  describe('review #147', () => {
    beforeEach(() => {
      // These tests make releases fail on purpose; keep the expected error logs quiet.
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });

    it('rolls the expiry back when releasing the seats fails', async () => {
      const hold = await holds.hold(oneWay, USER);
      vi.spyOn(t.moduleRef.get(SeatInventory), 'release').mockRejectedValueOnce(
        new Error('inventory down'),
      );

      await expect(job.expireDueHolds(hold.holdExpiresAt)).resolves.toBe(0);

      // The status change was undone with the failed release.
      expect((await bookings.findById(hold.bookingId).lean())?.status).toBe(
        'pending_payment',
      );
      expect(seats.counters(OUT, OUT_ECO)?.heldSeats).toBe(2);
      expect(events.emitted).toEqual([]);
    });

    it('does not get stuck behind 100 holds that keep failing', async () => {
      const oneSeat: FlightQuoteRequestDto = {
        tripType: 'one_way',
        segments: [{ flightId: BIG, cabinId: BIG_ECO }],
        passengers: [adult],
      };
      let last = await holds.hold(oneSeat, USER);
      for (let i = 1; i < 101; i += 1) last = await holds.hold(oneSeat, USER);

      // Releasing fails for the first 100 holds the job tries, then works.
      const inventory = t.moduleRef.get(SeatInventory);
      const release = inventory.release.bind(inventory);
      let calls = 0;
      vi.spyOn(inventory, 'release').mockImplementation(
        async (items, options) => {
          calls += 1;
          if (calls <= 100) throw new Error('inventory down');
          return release(items, options);
        },
      );

      await job.expireDueHolds(last.holdExpiresAt);

      // The 101st hold was still reached and expired in the same run.
      expect(calls).toBe(101);
      expect(await bookings.countDocuments({ status: 'expired' })).toBe(1);
      expect(await bookings.countDocuments({ status: 'pending_payment' })).toBe(
        100,
      );
    });
  });
});
