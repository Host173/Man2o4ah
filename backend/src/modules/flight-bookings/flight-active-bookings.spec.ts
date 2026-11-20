import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { toDateOnly } from '../../common/dates/date-only.js';
import { FlightActiveBookings } from './flight-active-bookings.js';
import { FlightBookingsModule } from './flight-bookings.module.js';
import { FlightBooking } from './schemas/flight-booking.schema.js';

describe('FlightActiveBookings (integration, ACC-12)', () => {
  let t: TestApp;
  let check: FlightActiveBookings;
  let bookings: Model<FlightBooking>;

  beforeAll(async () => {
    t = await createTestApp({ imports: [FlightBookingsModule] });
    check = t.moduleRef.get(FlightActiveBookings);
    bookings = t.connection.model<FlightBooking>(FlightBooking.name);
  }, HOOK_TIMEOUT);
  beforeEach(() => clearCollections(t.connection));
  afterAll(() => t.close(), HOOK_TIMEOUT);

  it.each([
    ['upcoming confirmed', 'confirmed', 86_400_000, true],
    ['already departed', 'confirmed', -86_400_000, false],
    ['unpaid hold', 'pending_payment', 86_400_000, false],
  ] as const)('checks %s bookings', async (_name, status, offset, expected) => {
    const u = await loginAs(t.connection, 'user');
    const other = await loginAs(t.connection, 'user');
    const departureAt = new Date(Date.now() + offset);
    await bookings.create({
      userId: u.id,
      status,
      tripType: 'one_way',
      segments: [
        {
          direction: 'outbound',
          flightId: new Types.ObjectId(),
          cabinId: new Types.ObjectId(),
          cabinClass: 'economy',
          airlineId: new Types.ObjectId(),
          flightNumber: 'MS985',
          departureAirportId: 'CAI',
          arrivalAirportId: 'JFK',
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
        },
      ],
      passengers: [
        {
          type: 'adult',
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
      holdExpiresAt: new Date(Date.now() + 600_000),
      firstDepartureAt: departureAt,
      lastDepartureAt: departureAt,
    });

    const session = await t.connection.startSession();
    try {
      await session.withTransaction(async () => {
        expect(await check.hasUpcomingConfirmed(u.id, { session })).toBe(
          expected,
        );
        expect(await check.hasUpcomingConfirmed(other.id, { session })).toBe(
          false,
        );
      });
    } finally {
      await session.endSession();
    }
  });
});
