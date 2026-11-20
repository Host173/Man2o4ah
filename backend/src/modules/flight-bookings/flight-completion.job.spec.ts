import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeFlightsService } from '../../../test/fakes/flights.fake.js';
import { FakePaymentsService } from '../../../test/fakes/payments.fake.js';
import { FakeSeatInventory } from '../../../test/fakes/seat-inventory.fake.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { FlightsService } from '../flights/flights.service.js';
import { SeatInventory } from '../flights/seat-inventory.js';
import { PaymentsService } from '../payments/payments.service.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { FlightCompletionJob } from './flight-completion.job.js';
import {
  FlightBooking,
  type FlightBookingStatus,
} from './schemas/flight-booking.schema.js';

const NOW = new Date('2027-03-10T08:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** `ms` milliseconds after NOW (negative = before). */
const at = (ms: number) => new Date(NOW.getTime() + ms);

function segment(direction: 'outbound' | 'return', departureAt: Date) {
  return {
    direction,
    flightId: new Types.ObjectId(),
    cabinId: new Types.ObjectId(),
    cabinClass: 'economy' as const,
    airlineId: new Types.ObjectId(),
    flightNumber: 'MS100',
    departureAirportId: direction === 'outbound' ? 'CAI' : 'DXB',
    arrivalAirportId: direction === 'outbound' ? 'DXB' : 'CAI',
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

describe('FlightCompletionJob (GEN-11)', () => {
  let t: TestApp;
  let job: FlightCompletionJob;
  let bookings: Model<FlightBooking>;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FlightBookingsModule],
      override: (builder) =>
        builder
          .overrideProvider(FlightsService)
          .useValue(new FakeFlightsService())
          .overrideProvider(SeatInventory)
          .useValue(new FakeSeatInventory())
          .overrideProvider(PaymentsService)
          .useValue(new FakePaymentsService()),
    });
    job = t.moduleRef.get(FlightCompletionJob);
    bookings = t.moduleRef.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(() => clearCollections(t.connection));

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => t.close(), HOOK_TIMEOUT);

  /** Saves a booking; passing `returnAt` makes it a round trip. */
  async function seed(
    status: FlightBookingStatus,
    firstDepartureAt: Date,
    returnAt?: Date,
  ): Promise<string> {
    const segments = [segment('outbound', firstDepartureAt)];
    if (returnAt) segments.push(segment('return', returnAt));
    const doc = await bookings.create({
      userId: new Types.ObjectId(),
      status,
      tripType: returnAt ? ('round_trip' as const) : ('one_way' as const),
      segments,
      passengers: [
        {
          type: 'adult',
          fullName: 'Aya Amr',
          dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
          documentNumber: 'A1234567',
          extraBagCount: 0,
        },
      ],
      seatCount: 1,
      pricing: {
        fareTotalMinor: 20_000,
        baggageTotalMinor: 0,
        totalMinor: 20_000,
        currency: 'USD',
      },
      holdExpiresAt: at(-30 * DAY),
      firstDepartureAt,
      lastDepartureAt: returnAt ?? firstDepartureAt,
    });
    return doc._id.toHexString();
  }

  const find = (id: string) => bookings.findById(id).lean();

  it('completes a confirmed booking exactly at its last departure', async () => {
    const id = await seed('confirmed', NOW);

    await expect(job.completeDepartedBookings(NOW)).resolves.toBe(1);

    expect(await find(id)).toMatchObject({
      status: 'completed',
      completedAt: NOW,
    });
  });

  it('leaves a confirmed booking alone 1 ms before its last departure', async () => {
    const id = await seed('confirmed', at(1));

    await expect(job.completeDepartedBookings(NOW)).resolves.toBe(0);

    const booking = await find(id);
    expect(booking?.status).toBe('confirmed');
    expect(booking?.completedAt).toBeUndefined();
  });

  it('waits for the return flight of a round trip', async () => {
    const inProgress = await seed('confirmed', at(-3 * DAY), at(2 * DAY));
    const finished = await seed('confirmed', at(-9 * DAY), at(-2 * DAY));

    await expect(job.completeDepartedBookings(NOW)).resolves.toBe(1);

    expect((await find(inProgress))?.status).toBe('confirmed');
    expect((await find(finished))?.status).toBe('completed');
  });

  it('completes every finished trip in one run', async () => {
    const ids = await Promise.all(
      [-1, -2, -30].map((days) => seed('confirmed', at(days * DAY))),
    );

    await expect(job.completeDepartedBookings(NOW)).resolves.toBe(3);

    for (const id of ids) {
      expect((await find(id))?.status).toBe('completed');
    }
  });

  it.each(['pending_payment', 'expired', 'cancelled'] as const)(
    'never touches a %s booking, even long after departure',
    async (status) => {
      const id = await seed(status, at(-30 * DAY));

      await expect(job.completeDepartedBookings(NOW)).resolves.toBe(0);

      const booking = await find(id);
      expect(booking?.status).toBe(status);
      expect(booking?.completedAt).toBeUndefined();
    },
  );

  it('is safe to run twice: the second run changes nothing', async () => {
    const id = await seed('confirmed', at(-DAY));
    await job.completeDepartedBookings(NOW);

    await expect(job.completeDepartedBookings(at(HOUR))).resolves.toBe(0);

    expect((await find(id))?.completedAt).toEqual(NOW);
  });

  it('run() completes against the current time', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const id = await seed('confirmed', at(-HOUR));

    await job.run();

    expect((await find(id))?.status).toBe('completed');
  });
});
