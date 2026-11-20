/**
 * S-06 · MEDIUM · externals
 *
 * Rule broken: PAY-03 "issue a refund …, record it, and show its status
 * (Pending, Refunded, Failed) on the booking details"; bookings-payments.md §7
 * "A Stripe failure leaves the booking cancelled and the refund `failed`,
 * visible on the booking (PAY-03), never lost".
 *
 * What breaks: after a cancellation, GET /api/flight-bookings/:id and
 * GET /api/hotel-bookings/:id show only `cancellation.refundPercent` and
 * `refundAmountMinor`; the refund's status (and id) is missing, so a failed
 * or pending refund is invisible on the booking. Only the one-off cancel
 * response carries it.
 *
 * Cause: src/modules/flight-bookings/my-flight-bookings.service.ts:109
 * (`toDetails`) and src/modules/hotel-bookings/hotel-reservations.service.ts:272
 * (`toDetail`) never call `PaymentsService.getRefund`
 * (src/modules/payments/payments.service.ts:20), which exists for this.
 *
 * Suggested fix: on the details endpoints, load the booking's refund through
 * `PaymentsService.getRefund(type, id)` and return it as
 * `refund: { refundId, status, amountMinor, currency, reason } | null`.
 */
import {
  confirmedFlightBooking,
  confirmedHotelBooking,
  createFlight,
  createRoom,
} from '../support/flows.js';
import { createStressApp, dateIn, type Stress } from '../support/stress-app.js';

describe('S-06 the refund status on the booking details (PAY-03)', () => {
  let s: Stress;
  beforeAll(async () => {
    s = await createStressApp();
  });
  afterAll(() => s?.close());

  it('shows a failed refund on flight and hotel booking details', async () => {
    const mod = await s.as(s.world.airlines.NA.moderator);
    const flight = await createFlight(s, mod, {
      seats: 2,
      departureAt: new Date(Date.now() + 40 * 86_400_000),
    });
    const user = await s.newUser('s06');
    const fb = await confirmedFlightBooking(s, user, flight);
    s.stripe.failNext('createRefund');
    await user.post(`/flight-bookings/${fb.bookingId}/cancel`, {});
    const flightDetails = await user.get(`/flight-bookings/${fb.bookingId}`);

    const hotel = s.world.hotels['Thames Court'];
    const roomId = await createRoom(await s.as(hotel.moderator), hotel.id);
    const hb = await confirmedHotelBooking(
      s,
      user,
      hotel.id,
      roomId,
      dateIn(40),
      dateIn(42),
    );
    s.stripe.failNext('createRefund');
    await user.post(`/hotel-bookings/${hb.bookingId}/cancel`, {});
    const hotelDetails = await user.get(`/hotel-bookings/${hb.bookingId}`);

    expect(
      [flightDetails.body?.refund?.status, hotelDetails.body?.refund?.status],
      'PAY-03: the refund status (Pending, Refunded, Failed) is shown on the booking details',
    ).toEqual(['failed', 'failed']);
  });
});
