import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { toDateOnly } from '../../common/dates/date-only.js';
import { HotelActiveBookings } from './hotel-active-bookings.js';
import { HotelBookingsModule } from './hotel-bookings.module.js';
import {
  HotelReservation,
  type HotelReservationStatus,
} from './schemas/hotel-reservation.schema.js';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const DAY = 86_400_000;

/** A confirmed-shaped stay whose check-in date can be pinned to an exact day. */
function reservationDoc(
  userId: string,
  checkInDate: Date,
  {
    status = 'confirmed',
    checkOutDate,
  }: { status?: HotelReservationStatus; checkOutDate?: Date } = {},
) {
  const out = checkOutDate ?? new Date(checkInDate.getTime() + 3 * DAY);
  return {
    userId,
    hotelId: new Types.ObjectId(),
    status,
    checkInDate,
    checkOutDate: out,
    nights: Math.round((out.getTime() - checkInDate.getTime()) / DAY),
    rooms: [
      {
        roomId: new Types.ObjectId(),
        roomName: 'Deluxe',
        roomType: 'double',
        pricePerNightMinor: 8_000,
        adults: 2,
        childAges: [],
        subtotalMinor: 24_000,
      },
    ],
    totalMinor: 24_000,
    currency: 'USD',
    policySnapshot: {
      cancellationTiers: [],
      checkInTime: '14:00',
      checkOutTime: '11:00',
    },
    holdExpiresAt: new Date(NOW.getTime() + 600_000),
  };
}

describe('HotelActiveBookings (integration, ACC-11/ACC-12)', () => {
  let t: TestApp;
  let check: HotelActiveBookings;
  let reservations: Model<HotelReservation>;

  beforeAll(async () => {
    t = await createTestApp({ imports: [HotelBookingsModule] });
    check = t.moduleRef.get(HotelActiveBookings);
    reservations = t.connection.model<HotelReservation>(HotelReservation.name);
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
  const today = () => toDateOnly(NOW.toISOString().slice(0, 10));
  const daysFromToday = (days: number) =>
    new Date(today().getTime() + days * DAY);

  it('is false when the user has no reservations', async () => {
    expect(await checkFor(user())).toBe(false);
  });

  it.each([
    ['confirmed', true],
    ['pending_payment', false],
    ['expired', false],
    ['cancelled', false],
    ['completed', false],
  ] as const)(
    'counts only confirmed reservations (%s)',
    async (status, expected) => {
      const u = user();
      await reservations.create(
        reservationDoc(u.toHexString(), daysFromToday(1), { status }),
      );
      expect(await checkFor(u)).toBe(expected);
    },
  );

  it('ignores a confirmed stay whose check-in date has passed', async () => {
    const u = user();
    await reservations.create(
      reservationDoc(u.toHexString(), daysFromToday(-1)),
    );
    expect(await checkFor(u)).toBe(false);
  });

  it('treats check-in at UTC midnight as a strict boundary', async () => {
    for (const [days, expected] of [
      [0, false],
      [1, true],
    ] as const) {
      const u = user();
      await reservations.create(
        reservationDoc(u.toHexString(), daysFromToday(days)),
      );
      expect(await checkFor(u)).toBe(expected);
    }
  });

  it("never counts another user's upcoming confirmed stay", async () => {
    const u = user();
    const other = user();
    await reservations.create(
      reservationDoc(other.toHexString(), daysFromToday(1)),
    );
    expect(await checkFor(u)).toBe(false);
    expect(await checkFor(other)).toBe(true);
  });

  it("uses the caller's transaction session when one is supplied", async () => {
    const u = user();
    await reservations.create(
      reservationDoc(u.toHexString(), daysFromToday(1)),
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
