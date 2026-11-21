/**
 * S-07 · CRITICAL · atomicity
 *
 * Rule broken: bookings-payments.md §6 "Late payment: if the booking is no
 * longer pending_payment (it expired), don't confirm. Ask payments for a full
 * refund"; PAY-01/PAY-03 and §7 "never lost" — money taken must end in a
 * confirmed booking or a refund.
 *
 * What breaks: the payment webhook succeeds (payment `succeeded`, event
 * recorded, 200 to Stripe) but the confirmation transaction fails once (any
 * error, e.g. a database blip while booking the seats). The listener logs it
 * and gives up; Stripe never redelivers (it got 200 and the event id is
 * stored). When the hold ends the expiry job expires the booking, and the
 * payments expiry listener skips the `succeeded` payment. The customer is
 * charged, has no booking and gets no refund, forever. Hotels have the same
 * path.
 *
 * Cause:
 * - src/modules/flight-bookings/flight-confirmation.service.ts:62 (and
 *   src/modules/hotel-bookings/hotel-confirmation.service.ts:63) swallow a
 *   failed confirmation with only a log; nothing retries it.
 * - src/modules/payments/payment-expiry.listener.ts:55 returns for a
 *   `succeeded` payment when its booking expires, so no late-payment refund
 *   is requested on that path.
 *
 * Suggested fix: when a booking expires and its payment is `succeeded`,
 * request the full `late_payment` refund, and/or have the expiry job retry
 * the confirmation of pending bookings whose payment already succeeded.
 */
import { Types } from 'mongoose';
import { vi } from 'vitest';
import { SeatInventory } from '../../../src/modules/flights/seat-inventory.js';
import {
  createFlight,
  holdFlight,
  startPayment,
  statusOf,
} from '../support/flows.js';
import {
  createStressApp,
  eventually,
  settle,
  type Stress,
} from '../support/stress-app.js';

describe('S-07 a paid booking whose confirmation failed once', () => {
  let s: Stress;
  beforeAll(async () => {
    s = await createStressApp();
  });
  afterAll(() => s?.close());

  it('ends confirmed or refunded, never expired with the money kept', async () => {
    const mod = await s.as(s.world.airlines.NA.moderator);
    const flight = await createFlight(s, mod, { seats: 2 });
    const user = await s.newUser('s07');
    const bookingId = (await holdFlight(user, flight)).body.bookingId as string;
    const paid = await startPayment(s, user, 'flight', bookingId);
    vi.spyOn(
      s.t.moduleRef.get(SeatInventory, { strict: false }),
      'confirm',
    ).mockRejectedValueOnce(new Error('boom (TST-03 injected failure)'));
    await s.payWebhook(paid.paymentIntentId);
    await settle(400);
    vi.restoreAllMocks();
    // Model write (test-only): the hold ends now.
    await s
      .col('flight_bookings')
      .updateOne(
        { _id: new Types.ObjectId(bookingId) },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      );
    await s.jobs.flightExpiry();
    const refund = await eventually(
      () =>
        s.col('refunds').findOne({ bookingId: new Types.ObjectId(bookingId) }),
      3_000,
    );
    const status = await statusOf(s, 'flight', bookingId);
    const outcome = {
      status,
      refund: refund?.reason ?? null,
      amount: refund?.amountMinor ?? null,
    };
    expect(
      outcome,
      '§6/PAY-03: a succeeded payment ends in a confirmed booking or a full late_payment refund',
    ).toEqual(
      status === 'confirmed'
        ? { status, refund: null, amount: null }
        : { status: 'expired', refund: 'late_payment', amount: 10_000 },
    );
  });
});
