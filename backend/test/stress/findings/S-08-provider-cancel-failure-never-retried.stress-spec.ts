/**
 * S-08 · HIGH · atomicity
 *
 * Rule broken: FLT-06 "all its Confirmed bookings become Cancelled with a
 * 100% refund (PAY-03)", and the handler's own contract
 * (flight-provider-cancellation.service.ts:41-43) "a redelivered event
 * finishes what failed".
 *
 * What breaks: when one booking of a cancelled flight fails to cancel (any
 * error in its transaction; here returning its seats), it is marked `failed`
 * and left "for a redelivery". But `flight.cancelled` is an in-process event
 * that is never redelivered, and nothing else retries it. The booking stays
 * `confirmed` on a cancelled flight, paid and never refunded.
 *
 * Cause: src/modules/flight-bookings/flight-provider-cancellation.service.ts:163
 * returns 'failed' and :108 parks it; no job or retry ever runs
 * `cancelBookingsOf` again for that flight.
 *
 * Suggested fix: a periodic sweep (e.g. beside the hold-expiry job) that runs
 * `cancelBookingsOf` for cancelled flights that still have confirmed or
 * pending bookings, or an in-handler retry with backoff.
 */
import { Types } from 'mongoose';
import { vi } from 'vitest';
import { SeatInventory } from '../../../src/modules/flights/seat-inventory.js';
import {
  confirmedFlightBooking,
  createFlight,
  statusOf,
} from '../support/flows.js';
import { createStressApp, settle, type Stress } from '../support/stress-app.js';

describe('S-08 a booking that failed during a provider cancellation', () => {
  let s: Stress;
  beforeAll(async () => {
    s = await createStressApp();
  });
  afterAll(() => s?.close());

  it('is eventually cancelled at 100% and refunded', async () => {
    const mod = await s.as(s.world.airlines.NA.moderator);
    const flight = await createFlight(s, mod, {
      seats: 5,
      departureAt: new Date(Date.now() + 40 * 86_400_000),
    });
    const ids: string[] = [];
    for (const tag of ['a', 'b']) {
      const user = await s.newUser(`s08${tag}`);
      ids.push((await confirmedFlightBooking(s, user, flight)).bookingId);
    }
    vi.spyOn(
      s.t.moduleRef.get(SeatInventory, { strict: false }),
      'returnBooked',
    ).mockRejectedValueOnce(new Error('boom (TST-03 injected failure)'));
    await mod.post(`/flights/${flight.flightId}/cancel`, {});
    await settle(800);
    vi.restoreAllMocks();
    // Give every scheduled job a run, as the app would over the next minutes.
    await s.jobs.flightExpiry();
    await s.jobs.flightCompletion();
    await s.jobs.markDeparted();
    await settle(800);
    const statuses = await Promise.all(
      ids.map((id) => statusOf(s, 'flight', id)),
    );
    const refunds = await s.col('refunds').countDocuments({
      bookingId: { $in: ids.map((id) => new Types.ObjectId(id)) },
    });
    expect(
      { statuses, refunds },
      'FLT-06: every confirmed booking of a cancelled flight ends cancelled with a refund',
    ).toEqual({ statuses: ['cancelled', 'cancelled'], refunds: 2 });
  });
});
