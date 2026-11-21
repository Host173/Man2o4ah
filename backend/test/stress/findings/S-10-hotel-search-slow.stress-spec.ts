/**
 * S-10 · MEDIUM · load
 *
 * Rule broken: the TST-03 load budget, p95 < 500 ms on the in-memory
 * database, for HTL-11 hotel search; backend.md §7 paginates in the database
 * (find().skip().limit() + countDocuments()).
 *
 * What breaks: with 1 000 hotels (250 per demo city, 4 rooms each), 50
 * concurrent GET /api/hotels/search requests are far over budget (in the full
 * load run: p50 ≈ 2.2 s, p95 ≈ 2.7 s) although each page holds 10 hotels.
 *
 * Cause: src/modules/hotels/hotels.service.ts:497-560 loads every active hotel
 * of the city and all their rooms on every request, filters, prices and sorts
 * them in memory, and only then paginates. The cost grows with the city's
 * whole inventory, not with the page.
 *
 * Suggested fix: do the filtering in MongoDB (an aggregation over rooms with
 * the busy-room exclusion and a $group per hotel, then $sort/$skip/$limit),
 * projecting only the fields the result needs.
 */
import { Types } from 'mongoose';
import { copy } from '../support/flows.js';
import { createStressApp, dateIn, type Stress } from '../support/stress-app.js';

describe('S-10 hotel search under load', () => {
  let s: Stress;
  beforeAll(async () => {
    s = await createStressApp();
    // Model writes (test-only): 1 000 hotels with 4 rooms each.
    const hotel = await s.col('hotels').findOne({
      _id: new Types.ObjectId(s.world.hotels['Nile View Hotel'].id),
    });
    const rooms = await s.col('rooms').find({ hotelId: hotel!._id }).toArray();
    const cities = ['cairo', 'dubai', 'london', 'paris'];
    const hotels = Array.from({ length: 1_000 }, (_, i) => ({
      ...copy(hotel!),
      _id: new Types.ObjectId(),
      name: `Load Hotel ${i}`,
      cityId: cities[i % 4],
    }));
    await s.col('hotels').insertMany(hotels);
    await s.col('rooms').insertMany(
      hotels.flatMap((h) =>
        rooms.map((r) => ({
          ...copy(r),
          _id: new Types.ObjectId(),
          hotelId: h._id,
        })),
      ),
    );
  });
  afterAll(() => s?.close());

  it('keeps p95 under the 500 ms budget with 1 000 hotels', async () => {
    const path = `/hotels/search?cityId=cairo&checkIn=${dateIn(10)}&checkOut=${dateIn(12)}&guests=2`;
    const times: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      await Promise.all(
        Array.from({ length: 50 }, async () => {
          const started = performance.now();
          const res = await s.guest().get(path);
          times.push(performance.now() - started);
          expect(res.status).toBe(200);
        }),
      );
    }
    times.sort((a, b) => a - b);
    const p95 = Math.round(times[Math.floor(times.length * 0.95)]);
    expect(
      p95,
      'TST-03 load budget: hotel search p95 under 500 ms',
    ).toBeLessThan(500);
  });
});
