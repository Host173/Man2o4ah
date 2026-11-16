import { Schema, Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
} from '../../../test/support/mongo-memory.js';
import type { TestDatabase } from '../../../test/support/mongo-memory.js';
import { canTransition, transitionStatus } from './booking-lifecycle.js';
import type { BookingStatus } from './booking-lifecycle.js';

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

describe('canTransition (GEN-11)', () => {
  // State-transition table: every (from, to) pair of the 5 statuses, 25 cases.
  const pairs = STATUSES.flatMap((from) =>
    STATUSES.map((to) => [from, to, ALLOWED.has(`${from}>${to}`)] as const),
  );

  it.each(pairs)('%s → %s allowed: %s', (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
  });
});

interface TestBooking {
  status: BookingStatus;
  confirmedAt?: Date;
}

describe('transitionStatus (GEN-11)', () => {
  let db: TestDatabase;
  let bookings: Model<TestBooking>;

  beforeAll(async () => {
    db = await startTestDatabase('booking-lifecycle');
    bookings = db.connection.model<TestBooking>(
      'LifecycleTestBooking',
      new Schema<TestBooking>({ status: String, confirmedAt: Date }),
    );
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await bookings.deleteMany({});
  });

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  async function pending(): Promise<Types.ObjectId> {
    const doc = await bookings.create({ status: 'pending_payment' });
    return doc._id;
  }

  it('moves the booking and sets the extra fields in the same update', async () => {
    const id = await pending();
    const confirmedAt = new Date('2026-11-16T10:00:00.000Z');

    await transitionStatus(bookings, id, 'pending_payment', 'confirmed', {
      confirmedAt,
    });

    const after = await bookings.findById(id).lean();
    expect(after).toMatchObject({ status: 'confirmed', confirmedAt });
  });

  it('rejects an illegal move with 409 and writes nothing', async () => {
    const id = await pending();

    await expect(
      transitionStatus(bookings, id, 'pending_payment', 'cancelled'),
    ).rejects.toMatchObject(INVALID_TRANSITION);

    expect((await bookings.findById(id).lean())?.status).toBe(
      'pending_payment',
    );
  });

  it('rejects with 409 when the booking is no longer in the from status', async () => {
    const id = await pending();
    await transitionStatus(bookings, id, 'pending_payment', 'expired');

    await expect(
      transitionStatus(bookings, id, 'pending_payment', 'confirmed'),
    ).rejects.toMatchObject(INVALID_TRANSITION);

    expect((await bookings.findById(id).lean())?.status).toBe('expired');
  });

  it('rejects with 409 when the booking does not exist', async () => {
    await expect(
      transitionStatus(
        bookings,
        new Types.ObjectId(),
        'pending_payment',
        'confirmed',
      ),
    ).rejects.toMatchObject(INVALID_TRANSITION);
  });

  it('lets exactly one of two racing transitions win (payment vs expiry)', async () => {
    const id = await pending();

    const results = await Promise.allSettled([
      transitionStatus(bookings, id, 'pending_payment', 'confirmed'),
      transitionStatus(bookings, id, 'pending_payment', 'expired'),
    ]);

    // Assert the invariant, never which one won.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject(
      INVALID_TRANSITION,
    );
    const final = (await bookings.findById(id).lean())?.status;
    expect(['confirmed', 'expired']).toContain(final);
  });
});
