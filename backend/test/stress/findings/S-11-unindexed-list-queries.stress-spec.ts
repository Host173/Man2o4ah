/**
 * S-11 · MEDIUM · load
 *
 * Rule broken: TST-03 H2 "every query on a collection with > 1 000 documents
 * uses an index (no COLLSCAN)"; data-model §4 lists the indexes per access
 * pattern.
 *
 * What breaks:
 * - GET /api/admin/bookings (ACC-17) with no filter scans every
 *   flight_bookings document and sorts in memory.
 * - GET /api/posts?q=… (BLG-09 author-name search) scans every users document.
 *
 * Cause:
 * - src/modules/flight-bookings/flight-bookings.service.ts:43 (and
 *   hotel-bookings/hotel-bookings.service.ts:43) sort the admin list by
 *   `{ createdAt: -1, _id: -1 }`, but the only createdAt index is
 *   `{ status: 1, createdAt: -1 }` (flight-booking.schema.ts:360,
 *   hotel-reservation.schema.ts:200), which can't serve an unfiltered list.
 * - The author-name lookup behind blog search runs an unanchored
 *   case-insensitive regex on users.name (accounts), which no b-tree index
 *   serves.
 *
 * Suggested fix: add `{ createdAt: -1, _id: -1 }` to flight_bookings and
 * hotel_reservations; for author names, a text index (or a lowercased,
 * prefix-searched name field) on users.
 */
import { Types } from 'mongoose';
import {
  confirmedFlightBooking,
  copy,
  createFlight,
} from '../support/flows.js';
import { createStressApp, type Stress } from '../support/stress-app.js';

/** A copy without the unique booking reference (a partial unique index). */
function withoutReference<T extends Record<string, unknown>>(
  doc: T,
): Omit<T, 'reference'> {
  const rest: Record<string, unknown> = { ...copy(doc) };
  delete rest.reference;
  return rest as Omit<T, 'reference'>;
}

describe('S-11 list queries on large collections', () => {
  let s: Stress;
  beforeAll(async () => {
    s = await createStressApp();
    const mod = await s.as(s.world.airlines.NA.moderator);
    const flight = await createFlight(s, mod, { seats: 3 });
    const { bookingId } = await confirmedFlightBooking(
      s,
      await s.newUser('s11'),
      flight,
    );
    const booking = await s
      .col('flight_bookings')
      .findOne({ _id: new Types.ObjectId(bookingId) });
    const user = await s.col('users').findOne({ email: s.world.users[0] });
    // Model writes (test-only): 1 500 bookings and 1 500 users.
    await s.col('flight_bookings').insertMany(
      Array.from({ length: 1_500 }, () => ({
        ...withoutReference(booking!),
        _id: new Types.ObjectId(),
      })),
    );
    await s.col('users').insertMany(
      Array.from({ length: 1_500 }, (_, i) => ({
        ...copy(user!),
        _id: new Types.ObjectId(),
        email: `s11.${i}@example.com`,
        name: `S11 User ${i}`,
      })),
    );
  });
  afterAll(() => s?.close());

  it('serves the admin booking list and the blog author search from indexes', async () => {
    const admin = await s.as('admin@example.com');
    const db = s.t.connection.db!;
    await db.command({ profile: 2 });
    await admin.get('/admin/bookings');
    await s.guest().get('/posts?q=nobody');
    await db.command({ profile: 0 });
    const scans = (await db.collection('system.profile').find({}).toArray())
      .filter((e) => JSON.stringify(e.planSummary ?? '').includes('COLLSCAN'))
      .map((e) => String(e.ns))
      .filter((ns) => ns.endsWith('.flight_bookings') || ns.endsWith('.users'));
    expect(
      [...new Set(scans)],
      'TST-03 H2: no COLLSCAN on collections with > 1 000 documents',
    ).toEqual([]);
  });
});
