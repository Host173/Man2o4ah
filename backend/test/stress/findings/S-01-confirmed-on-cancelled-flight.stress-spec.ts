/**
 * S-01 · CRITICAL · races
 *
 * Rule broken: FLT-06 "all its Confirmed bookings become Cancelled with a 100%
 * refund (PAY-03); pending seat holds are released" and bookings-payments.md §7
 * "flight-bookings cancels every `confirmed` booking containing it … and
 * expires its `pending_payment` ones".
 *
 * What breaks: a moderator cancels a flight while a passenger's payment
 * webhook arrives. The booking ends `confirmed` on a `cancelled` flight: the
 * passenger has paid, holds booked seats on a flight that will not fly, and is
 * never refunded.
 *
 * Cause:
 * - src/modules/flight-bookings/flight-provider-cancellation.service.ts:158 —
 *   a booking whose pending→expired transition loses to the confirmation is
 *   `skipped`, and the comment at :109 assumes the next batch finds it again
 *   with its new status; but the loop returns at :113 as soon as a batch is
 *   not full, so the now-confirmed booking is never cancelled.
 * - src/modules/flight-bookings/flight-confirmation.service.ts:72 — the
 *   confirmation never checks that the flight is still `scheduled`, so a
 *   payment that lands after the handler's scan confirms a booking on a
 *   cancelled flight.
 *
 * Suggested fix: after the batch loop, re-scan the skipped bookings (or loop
 * until no active booking of the flight is left), and make the confirmation
 * refuse to confirm a booking whose flight is cancelled (treat it like a late
 * payment: expire/cancel at 100% and refund).
 */
import { Types } from 'mongoose';
import { createFlight, holdFlight, startPayment } from '../support/flows.js';
import { createStressApp, settle, type Stress } from '../support/stress-app.js';

describe('S-01 a payment racing a provider flight cancellation', () => {
  let s: Stress;
  beforeAll(async () => {
    s = await createStressApp();
  });
  afterAll(() => s?.close());

  it('leaves no paid booking confirmed (or unrefunded) on a cancelled flight', async () => {
    const mod = await s.as(s.world.airlines.NA.moderator);
    const user = await s.newUser('s01');
    const stranded: string[] = [];
    for (let round = 0; round < 10; round += 1) {
      const flight = await createFlight(s, mod, {
        seats: 3,
        departureAt: new Date(Date.now() + (20 + round) * 86_400_000),
      });
      const held = await holdFlight(user, flight);
      const paid = await startPayment(s, user, 'flight', held.body.bookingId);
      await Promise.all([
        s.payWebhook(paid.paymentIntentId),
        mod.post(`/flights/${flight.flightId}/cancel`, {}),
      ]);
      await settle(400);
      const booking = await s
        .col('flight_bookings')
        .findOne({ _id: new Types.ObjectId(paid.bookingId) });
      const refund = await s
        .col('refunds')
        .findOne({ bookingId: new Types.ObjectId(paid.bookingId) });
      if (booking?.status === 'confirmed' || !refund) {
        stranded.push(
          `round ${round}: ${booking?.status}, refund ${refund ? 'yes' : 'none'}`,
        );
      }
    }
    expect(
      stranded,
      'FLT-06: every confirmed booking of a cancelled flight is cancelled at 100% and refunded',
    ).toEqual([]);
    expect(await s.invariants()).toEqual([]);
  });
});
