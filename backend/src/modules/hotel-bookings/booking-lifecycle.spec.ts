import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { toDateOnly } from '../../common/dates/date-only.js';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
} from '../../../test/support/mongo-memory.js';
import type { TestDatabase } from '../../../test/support/mongo-memory.js';
import { canTransition, transitionStatus } from './booking-lifecycle.js';
import type { BookingStatus } from './booking-lifecycle.js';
import {
  HotelReservation,
  HotelReservationSchema,
} from './schemas/hotel-reservation.schema.js';

/*
 * hotel-bookings' own copy of the GEN-11 lifecycle (DECISIONS.md §3, booking
 * rules per module). It must allow exactly the same moves as flight-bookings'
 * copy; these tests run on the real HotelReservation model.
 */

const STATUSES: BookingStatus[] = [
  'pending_payment',
  'confirmed',
  'completed',
  'expired',
  'cancelled',
];

// GEN-11: the only legal moves. Everything else must be rejected.
const ALLOWED = new Set([
  'pending_payment>confirmed',
  'pending_payment>expired',
  'confirmed>completed',
  'confirmed>cancelled',
]);

const INVALID_TRANSITION = {
  status: 409,
  response: { code: 'INVALID_STATUS_TRANSITION' },
};

describe('canTransition (GEN-11, hotel reservations)', () => {
  // State-transition table: every (from, to) pair of the 5 statuses, 25 cases.
  const pairs = STATUSES.flatMap((from) =>
    STATUSES.map((to) => [from, to, ALLOWED.has(`${from}>${to}`)] as const),
  );

  it.each(pairs)('%s → %s allowed: %s', (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
  });
});

describe('transitionStatus on HotelReservation (GEN-11)', () => {
  let db: TestDatabase;
  let reservations: Model<HotelReservation>;

  beforeAll(async () => {
    db = await startTestDatabase('hotel-booking-lifecycle');
    reservations = db.connection.model<HotelReservation>(
      HotelReservation.name,
      HotelReservationSchema,
    );
    await reservations.init();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await reservations.deleteMany({});
  });

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  /** A valid pending reservation: one room, one adult, two nights. */
  async function pending(): Promise<Types.ObjectId> {
    const doc = await reservations.create({
      userId: new Types.ObjectId(),
      hotelId: new Types.ObjectId(),
      status: 'pending_payment',
      checkInDate: toDateOnly('2027-03-10'),
      checkOutDate: toDateOnly('2027-03-12'),
      nights: 2,
      rooms: [
        {
          roomId: new Types.ObjectId(),
          roomName: '101',
          roomType: 'Double',
          pricePerNightMinor: 10_000,
          adults: 1,
          childAges: [],
          subtotalMinor: 20_000,
        },
      ],
      totalMinor: 20_000,
      currency: 'USD',
      policySnapshot: {
        cancellationTiers: [],
        checkInTime: '14:00',
        checkOutTime: '12:00',
      },
      holdExpiresAt: new Date('2026-11-17T10:10:00.000Z'),
    });
    return doc._id;
  }

  const statusOf = async (id: Types.ObjectId) =>
    (await reservations.findById(id).lean())?.status;

  it('moves the reservation and sets the extra fields in the same update', async () => {
    const id = await pending();
    const confirmedAt = new Date('2026-11-17T10:05:00.000Z');

    await transitionStatus(reservations, id, 'pending_payment', 'confirmed', {
      confirmedAt,
      reference: 'HRAB12CD',
    });

    expect(await reservations.findById(id).lean()).toMatchObject({
      status: 'confirmed',
      confirmedAt,
      reference: 'HRAB12CD',
    });
  });

  it('validates the extra fields against the schema: a flight reference is rejected', async () => {
    const id = await pending();

    await expect(
      transitionStatus(reservations, id, 'pending_payment', 'confirmed', {
        reference: 'FBAB12CD', // a flight booking reference, not HR…
      }),
    ).rejects.toThrow();

    const after = await reservations.findById(id).lean();
    expect(after?.status).toBe('pending_payment');
    expect(after?.reference).toBeUndefined();
  });

  it('throws on a misspelt field instead of silently dropping it', async () => {
    const id = await pending();

    await expect(
      transitionStatus(reservations, id, 'pending_payment', 'confirmed', {
        confirmAt: new Date(), // typo for confirmedAt
      }),
    ).rejects.toThrow();

    expect(await statusOf(id)).toBe('pending_payment');
  });

  it('rejects an illegal move with 409 and writes nothing', async () => {
    const id = await pending();

    await expect(
      transitionStatus(reservations, id, 'pending_payment', 'cancelled'),
    ).rejects.toMatchObject(INVALID_TRANSITION);

    expect(await statusOf(id)).toBe('pending_payment');
  });

  it('rejects with 409 when the reservation is no longer in the from status', async () => {
    const id = await pending();
    await transitionStatus(reservations, id, 'pending_payment', 'expired');

    await expect(
      transitionStatus(reservations, id, 'pending_payment', 'confirmed'),
    ).rejects.toMatchObject(INVALID_TRANSITION);

    expect(await statusOf(id)).toBe('expired');
  });

  it('rejects with 409 when the reservation does not exist', async () => {
    await expect(
      transitionStatus(
        reservations,
        new Types.ObjectId(),
        'pending_payment',
        'confirmed',
      ),
    ).rejects.toMatchObject(INVALID_TRANSITION);
  });

  it('lets exactly one of two racing transitions win (payment vs expiry)', async () => {
    const id = await pending();

    const results = await Promise.allSettled([
      transitionStatus(reservations, id, 'pending_payment', 'confirmed'),
      transitionStatus(reservations, id, 'pending_payment', 'expired'),
    ]);

    // Assert the invariant, never which one won.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject(
      INVALID_TRANSITION,
    );
    expect(['confirmed', 'expired']).toContain(await statusOf(id));
  });

  it('enforces an extra where condition atomically in the conditional update', async () => {
    const id = await pending();
    await transitionStatus(reservations, id, 'pending_payment', 'confirmed');
    const completedAt = new Date('2027-03-13T01:00:00.000Z');

    await expect(
      transitionStatus(
        reservations,
        id,
        'confirmed',
        'completed',
        { completedAt },
        { where: { checkOutDate: { $lt: toDateOnly('2027-03-12') } } },
      ),
    ).rejects.toMatchObject(INVALID_TRANSITION);
    expect(await statusOf(id)).toBe('confirmed');

    await transitionStatus(
      reservations,
      id,
      'confirmed',
      'completed',
      { completedAt },
      { where: { checkOutDate: { $lt: toDateOnly('2027-03-13') } } },
    );
    expect(await reservations.findById(id).lean()).toMatchObject({
      status: 'completed',
      completedAt,
    });
  });
});
