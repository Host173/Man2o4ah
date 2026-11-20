import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import type { CabinClass } from '../../common/database/cabin-class.js';
import { toDateOnly } from '../../common/dates/date-only.js';
import { FlightActiveBookings } from './flight-active-bookings.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import {
  FlightBooking,
  type FlightBookingStatus,
  type PassengerType,
} from './schemas/flight-booking.schema.js';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const DAY = 86_400_000;

/** A confirmed-shaped booking whose departures can be pinned to exact instants. */
function bookingDoc(
  userId: string,
  firstDepartureAt: Date,
  {
    status = 'confirmed',
    lastDepartureAt = firstDepartureAt,
    roundTrip = false,
  }: {
    status?: FlightBookingStatus;
    lastDepartureAt?: Date;
    roundTrip?: boolean;
  } = {},
) {
  const segment = (direction: 'outbound' | 'return', departureAt: Date) => ({
    direction,
    flightId: new Types.ObjectId(),
    cabinId: new Types.ObjectId(),
    cabinClass: 'economy' as CabinClass,
    airlineId: new Types.ObjectId(),
    flightNumber: 'MS985',
    departureAirportId: direction === 'outbound' ? 'CAI' : 'JFK',
    arrivalAirportId: direction === 'outbound' ? 'JFK' : 'CAI',
    departureAt,
    arrivalAt: new Date(departureAt.getTime() + 60_000),
    fareMinor: 10_000,
    policy: {
      cancellationTiers: [],
      freeBags: 1,
      maxBagWeightKg: 23,
      extraBagPriceMinor: 0,
      maxExtraBagsPerPassenger: 0,
    },
  });
  return {
    userId,
    status,
    tripType: (roundTrip ? 'round_trip' : 'one_way') as
      'round_trip' | 'one_way',
    segments: [
      segment('outbound', firstDepartureAt),
      ...(roundTrip ? [segment('return', lastDepartureAt)] : []),
    ],
    passengers: [
      {
        type: 'adult' as PassengerType,
        fullName: 'Test User',
        dateOfBirth: toDateOnly('1990-01-01'),
        documentNumber: 'A12345678',
        extraBagCount: 0,
      },
    ],
    seatCount: 1,
    pricing: {
      fareTotalMinor: 10_000,
      baggageTotalMinor: 0,
      totalMinor: 10_000,
      currency: 'USD',
    },
    holdExpiresAt: new Date(NOW.getTime() + 600_000),
    firstDepartureAt,
    lastDepartureAt,
  };
}

describe('FlightActiveBookings (integration, ACC-11/ACC-12)', () => {
  let t: TestApp;
  let check: FlightActiveBookings;
  let bookings: Model<FlightBooking>;

  beforeAll(async () => {
    t = await createTestApp({ imports: [FlightBookingsModule] });
    check = t.moduleRef.get(FlightActiveBookings);
    bookings = t.connection.model<FlightBooking>(FlightBooking.name);
  }, HOOK_TIMEOUT);
  beforeEach(async () => {
    await clearCollections(t.connection);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => t.close(), HOOK_TIMEOUT);

  const user = () => new Types.ObjectId();
  const checkFor = (u: Types.ObjectId) =>
    check.hasUpcomingConfirmed(u.toHexString());

  it('is false when the user has no bookings', async () => {
    expect(await checkFor(user())).toBe(false);
  });

  it.each([
    ['confirmed', true],
    ['pending_payment', false],
    ['expired', false],
    ['cancelled', false],
    ['completed', false],
  ] as const)(
    'counts only confirmed bookings (%s)',
    async (status, expected) => {
      const u = user();
      await bookings.create(
        bookingDoc(u.toHexString(), new Date(NOW.getTime() + DAY), { status }),
      );
      expect(await checkFor(u)).toBe(expected);
    },
  );

  it('ignores a confirmed booking whose departure has passed', async () => {
    const u = user();
    await bookings.create(
      bookingDoc(u.toHexString(), new Date(NOW.getTime() - DAY)),
    );
    expect(await checkFor(u)).toBe(false);
  });

  it('treats the departure instant as a strict boundary', async () => {
    for (const [offset, expected] of [
      [-1, false],
      [0, false],
      [1, true],
    ] as const) {
      const u = user();
      await bookings.create(
        bookingDoc(u.toHexString(), new Date(NOW.getTime() + offset)),
      );
      expect(await checkFor(u)).toBe(expected);
    }
  });

  it('handles multi-leg trips from their first departure', async () => {
    const u = user();
    await bookings.create(
      bookingDoc(u.toHexString(), new Date(NOW.getTime() + DAY), {
        roundTrip: true,
        lastDepartureAt: new Date(NOW.getTime() + 8 * DAY),
      }),
    );
    expect(await checkFor(u)).toBe(true);
  });

  it('follows the decided "first departure" rule for a round trip in progress', async () => {
    // DECISIONS §3: a confirmed round trip whose outbound has departed is in
    // the "past" group, not an upcoming booking that blocks deactivation.
    const u = user();
    await bookings.create(
      bookingDoc(u.toHexString(), new Date(NOW.getTime() - DAY), {
        roundTrip: true,
        lastDepartureAt: new Date(NOW.getTime() + 6 * DAY),
      }),
    );
    expect(await checkFor(u)).toBe(false);
  });

  it("never counts another user's upcoming confirmed booking", async () => {
    const u = user();
    const other = user();
    await bookings.create(
      bookingDoc(other.toHexString(), new Date(NOW.getTime() + DAY)),
    );
    expect(await checkFor(u)).toBe(false);
    expect(await checkFor(other)).toBe(true);
  });

  it("uses the caller's transaction session when one is supplied", async () => {
    const u = user();
    await bookings.create(
      bookingDoc(u.toHexString(), new Date(NOW.getTime() + DAY)),
    );
    const session = await t.connection.startSession();
    try {
      await session.withTransaction(async () => {
        expect(
          await check.hasUpcomingConfirmed(u.toHexString(), { session }),
        ).toBe(true);
      });
    } finally {
      await session.endSession();
    }
  });
});
