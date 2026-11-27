import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeFlightsData } from '../../../test/fakes/flights-data.fake.js';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakeSeatInventory } from '../../../test/fakes/seat-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { FlightsService } from '../flights/flights.service.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { FlightChangeExpiryJob } from './flight-change-expiry.job.js';
import { FlightBooking } from './schemas/flight-booking.schema.js';

const AIRLINE = '6553a1f0c2b4e8a9d0f1e001';
/** The booked flight. */
const FLIGHT = '6553a1f0c2b4e8a9d0f1e002';
const CABIN = '6553a1f0c2b4e8a9d0f1e003';
/** The flight the change waits on. */
const NEW = '6553a1f0c2b4e8a9d0f1e004';
const NEW_CABIN = '6553a1f0c2b4e8a9d0f1e005';
const USER = '6553a1f0c2b4e8a9d0f1e099';
const DEPARTS = new Date('2027-03-10T08:00:00.000Z');
const NEW_DEPARTS = new Date('2027-03-11T08:00:00.000Z');
const HOUR = 3_600_000;
/** When the pending change's hold ends. */
const EXPIRES = new Date('2027-03-01T00:10:00.000Z');

function seedFlights(): FakeFlightsData {
  const data = new FakeFlightsData();
  data.addAirline({ id: AIRLINE, code: 'MS' });
  for (const [id, cabinId, departureAt] of [
    [FLIGHT, CABIN, DEPARTS],
    [NEW, NEW_CABIN, NEW_DEPARTS],
  ] as const) {
    data.addFlight({
      id,
      airlineId: AIRLINE,
      flightNumber: `MS${id.slice(-3)}`,
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 4 * HOUR),
      cabins: [
        { id: cabinId, cabinClass: 'economy', totalSeats: 50, priceMinor: 0 },
      ],
    });
  }
  return data;
}

function segment(flightId: string, cabinId: string, departureAt: Date) {
  return {
    direction: 'outbound' as const,
    flightId,
    cabinId,
    cabinClass: 'economy' as const,
    airlineId: AIRLINE,
    flightNumber: `MS${flightId.slice(-3)}`,
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAt,
    arrivalAt: new Date(departureAt.getTime() + 4 * HOUR),
    fareMinor: 20_000,
    policy: {
      cancellationTiers: [],
      freeBags: 1,
      maxBagWeightKg: 23,
      extraBagPriceMinor: 0,
      maxExtraBagsPerPassenger: 0,
    },
  };
}

describe('FlightChangeExpiryJob (FLT-27)', () => {
  let t: TestApp;
  let bookings: Model<FlightBooking>;
  let job: FlightChangeExpiryJob;
  const flights = new FakeFlightsService();
  const seats = new FakeSeatInventory();

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
    bookings = t.moduleRef.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    job = t.moduleRef.get(FlightChangeExpiryJob);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    const data = seedFlights();
    Object.assign(flights, new FakeFlightsService(data));
    Object.assign(seats, new FakeSeatInventory(data));
    await clearCollections(t.connection);
    vi.restoreAllMocks();
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  /** A confirmed booking for 2 seats on FLIGHT with a change to NEW waiting for payment; its seats are held. */
  async function seedPendingChange(holdExpiresAt = EXPIRES) {
    const booked = [{ flightId: FLIGHT, cabinId: CABIN, seats: 2 }];
    await seats.hold(booked);
    await seats.confirm(booked);
    await seats.hold([{ flightId: NEW, cabinId: NEW_CABIN, seats: 2 }]);
    const passenger = {
      type: 'adult' as const,
      fullName: 'Aya Amr',
      dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      documentNumber: 'A1234567',
      extraBagCount: 0,
    };
    return bookings.create({
      userId: USER,
      reference: 'FBEXP001',
      status: 'confirmed',
      tripType: 'one_way',
      segments: [segment(FLIGHT, CABIN, DEPARTS)],
      passengers: [passenger, passenger],
      seatCount: 2,
      pricing: {
        fareTotalMinor: 40_000,
        baggageTotalMinor: 0,
        totalMinor: 40_000,
        currency: 'USD',
      },
      holdExpiresAt: new Date('2027-02-20T00:10:00.000Z'),
      firstDepartureAt: DEPARTS,
      lastDepartureAt: DEPARTS,
      pendingChange: {
        _id: new Types.ObjectId(),
        direction: 'outbound',
        segment: segment(NEW, NEW_CABIN, NEW_DEPARTS),
        pricing: {
          fareTotalMinor: 50_000,
          baggageTotalMinor: 0,
          totalMinor: 50_000,
          currency: 'USD',
        },
        differenceMinor: 10_000,
        holdExpiresAt,
        requestedAt: new Date(holdExpiresAt.getTime() - 10 * 60_000),
      },
    });
  }

  it('drops a pending change exactly at its holdExpiresAt and releases its seats', async () => {
    const booking = await seedPendingChange();

    await expect(job.expireDueChanges(EXPIRES)).resolves.toBe(1);

    const stored = await bookings.findById(booking.id).lean();
    expect(stored?.pendingChange).toBeUndefined();
    // Nothing else about the booking changed.
    expect(stored?.status).toBe('confirmed');
    expect(stored?.segments[0]?.flightId.toString()).toBe(FLIGHT);
    expect(stored?.pricing.totalMinor).toBe(40_000);
    expect(seats.counters(NEW, NEW_CABIN)).toMatchObject({
      heldSeats: 0,
      availableSeats: 50,
    });
    expect(seats.counters(FLIGHT, CABIN)?.bookedSeats).toBe(2);
  });

  it('leaves a pending change alone 1 ms before it expires', async () => {
    const booking = await seedPendingChange();

    await expect(
      job.expireDueChanges(new Date(EXPIRES.getTime() - 1)),
    ).resolves.toBe(0);

    const stored = await bookings.findById(booking.id).lean();
    expect(stored?.pendingChange).toBeDefined();
    expect(seats.counters(NEW, NEW_CABIN)?.heldSeats).toBe(2);
  });

  it('ignores bookings without a pending change', async () => {
    const booking = await seedPendingChange();
    await bookings.updateOne(
      { _id: booking._id },
      { $unset: { pendingChange: 1 } },
    );

    await expect(job.expireDueChanges(EXPIRES)).resolves.toBe(0);
  });

  it('is safe to run twice: the seats are released once', async () => {
    await seedPendingChange();

    await job.expireDueChanges(EXPIRES);
    await expect(job.expireDueChanges(EXPIRES)).resolves.toBe(0);

    expect(seats.counters(NEW, NEW_CABIN)).toMatchObject({
      heldSeats: 0,
      availableSeats: 50,
    });
  });

  it('keeps the pending change when releasing the seats fails, and retries on the next run', async () => {
    const booking = await seedPendingChange();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(seats, 'release').mockRejectedValueOnce(new Error('db down'));

    await expect(job.expireDueChanges(EXPIRES)).resolves.toBe(0);
    expect(
      (await bookings.findById(booking.id).lean())?.pendingChange,
    ).toBeDefined();

    await expect(job.expireDueChanges(EXPIRES)).resolves.toBe(1);
    expect(seats.counters(NEW, NEW_CABIN)?.heldSeats).toBe(0);
  });
});
