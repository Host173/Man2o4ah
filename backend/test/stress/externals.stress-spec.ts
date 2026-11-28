import { Types } from 'mongoose';
import { FAKE_STRIPE_SIGNATURE } from '../fakes/stripe-gateway.fake.js';
import {
  confirmedFlightBooking,
  confirmedHotelBooking,
  createFlight,
  createRoom,
  holdFlight,
  isErrorShape,
  startPayment,
  statusOf,
} from './support/flows.js';
import {
  createStressApp,
  dateIn,
  eventually,
  Findings,
  probeRunner,
  settle,
  type Stress,
} from './support/stress-app.js';

/** TST-03 area E: external failures (PAY-01, PAY-03, ITN-18). */
describe('stress E: external failures', () => {
  let s: Stress;
  const findings = new Findings('externals');
  const probe = probeRunner(() => s, findings);
  const oid = (id: string) => new Types.ObjectId(id);

  beforeAll(async () => {
    s = await createStressApp();
  });
  afterAll(async () => {
    findings.write();
    await s?.close();
  });

  it('E1 Stripe down when the PaymentIntent is created', async () => {
    await probe('E1 createPaymentIntent fails', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, { seats: 3 });
      const user = await s.newUser('e1');
      const bookingId = (await holdFlight(user, flight)).body
        .bookingId as string;
      await user.post(`/bookings/flight/${bookingId}/accept-policies`, {
        accepted: true,
      });
      s.stripe.failNext('createPaymentIntent');
      const failed = await user.post('/payments', {
        bookingType: 'flight',
        bookingId,
      });
      check(
        'a clean 5xx in the error shape',
        `${failed.status} ${failed.body.code}`,
        failed.status >= 500 && isErrorShape(failed.body),
      );
      const half = await s
        .col('payments')
        .countDocuments({ bookingId: oid(bookingId) });
      check('no payment document left half-made', half, half === 0);
      const retry = await user.post('/payments', {
        bookingType: 'flight',
        bookingId,
      });
      check('a retry later works', retry.status, retry.status === 201);
    });
  });

  it('E2 Stripe refuses the refund of a cancellation', async () => {
    await probe('E2 createRefund fails', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, {
        seats: 3,
        departureAt: new Date(Date.now() + 40 * 86_400_000),
      });
      const user = await s.newUser('e2');
      const { bookingId } = await confirmedFlightBooking(s, user, flight);
      s.stripe.failNext('createRefund');
      const cancel = await user.post(
        `/flight-bookings/${bookingId}/cancel`,
        {},
      );
      check(
        'the cancellation answers 2xx',
        cancel.status,
        cancel.status >= 200 && cancel.status < 300,
      );
      check(
        'the booking stays cancelled',
        await statusOf(s, 'flight', bookingId),
        (await statusOf(s, 'flight', bookingId)) === 'cancelled',
      );
      const refund = await s
        .col('refunds')
        .findOne({ bookingId: oid(bookingId) });
      check(
        'the refund is recorded as failed',
        refund?.status,
        refund?.status === 'failed',
      );
      // "Visible on the booking details" is finding S-06.
      await settle(300);
      const note = await s
        .col('notifications')
        .findOne({ userId: oid(user.id), type: 'refund_updated' });
      check('the user is told (refund_updated)', note?.type, note !== null);

      const hotel = s.world.hotels['Seine Garden'];
      const roomId = await createRoom(await s.as(hotel.moderator), hotel.id);
      const hotelUser = await s.newUser('e2-hotel');
      const res = await confirmedHotelBooking(
        s,
        hotelUser,
        hotel.id,
        roomId,
        dateIn(40),
        dateIn(42),
      );
      s.stripe.failNext('createRefund');
      const hCancel = await hotelUser.post(
        `/hotel-bookings/${res.bookingId}/cancel`,
        {},
      );
      const hRefund = await s
        .col('refunds')
        .findOne({ bookingId: oid(res.bookingId) });
      check(
        'hotel: cancelled, refund failed and visible',
        [
          hCancel.status,
          await statusOf(s, 'hotel', res.bookingId),
          hRefund?.status,
        ],
        hCancel.status < 300 &&
          (await statusOf(s, 'hotel', res.bookingId)) === 'cancelled' &&
          hRefund?.status === 'failed',
      );
    });
  });

  it('E3 Stripe cancel fails at hold expiry; a last-second success is refunded', async () => {
    await probe('E3 cancelPaymentIntent fails', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, { seats: 3 });
      const user = await s.newUser('e3');
      const bookingId = (await holdFlight(user, flight)).body
        .bookingId as string;
      const started = await startPayment(s, user, 'flight', bookingId);
      // Model write (test-only): end the hold now.
      await s
        .col('flight_bookings')
        .updateOne(
          { _id: oid(bookingId) },
          { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
        );
      s.stripe.failNext('cancelPaymentIntent');
      await s.jobs.flightExpiry();
      await settle(300);
      check(
        'the booking still expires',
        await statusOf(s, 'flight', bookingId),
        (await statusOf(s, 'flight', bookingId)) === 'expired',
      );
      await s.payWebhook(started.paymentIntentId);
      const refund = await eventually(() =>
        s.col('refunds').findOne({ bookingId: oid(bookingId) }),
      );
      check(
        'the last-second payment is refunded (late_payment)',
        refund?.reason,
        refund?.reason === 'late_payment',
      );
    });
  });

  it('E4 the FX API down at the daily refresh; no rates at all', async () => {
    await probe('E4 FX down', async (check) => {
      const before = await s.col('exchange_rates').countDocuments();
      s.fx.down = true;
      let threw = false;
      try {
        await s.jobs.fxRefresh();
      } catch {
        threw = true;
      }
      check('the refresh never throws', threw, threw === false);
      const latest = await s.guest().get('/exchange-rates/latest');
      check('the last rates stay in use', latest.status, latest.status === 200);
      check(
        'nothing new stored',
        await s.col('exchange_rates').countDocuments(),
        (await s.col('exchange_rates').countDocuments()) === before,
      );

      const user = await s.newUser('e4');
      const it = await user.post('/itineraries', {
        title: 'FX',
        countryCodes: ['EG'],
        startDate: dateIn(5),
      });
      const day = await user.post(`/itineraries/${it.body._id}/days`, {
        cityId: 'cairo',
      });
      const dayId = (day.body.days ?? []).at(-1)?._id;
      await user.post(`/itineraries/${it.body._id}/days/${dayId}/budgets`, {
        category: 'food',
        amountMinor: 50000,
        currency: 'EGP',
      });
      const ok = await user.get(`/itineraries/${it.body._id}/budget-summary`);
      check(
        'budget summary works on cached rates',
        ok.status,
        ok.status === 200,
      );

      // Model write (test-only): no rates document at all.
      const saved = await s.col('exchange_rates').find({}).toArray();
      await s.col('exchange_rates').deleteMany({});
      const none = await s.guest().get('/exchange-rates/latest');
      const summary = await user.get(
        `/itineraries/${it.body._id}/budget-summary`,
      );
      check(
        'no rates: 503 RATES_UNAVAILABLE on every converting endpoint',
        [
          `${none.status} ${none.body.code}`,
          `${summary.status} ${summary.body.code}`,
        ],
        none.status === 503 &&
          none.body.code === 'RATES_UNAVAILABLE' &&
          summary.status === 503 &&
          summary.body.code === 'RATES_UNAVAILABLE',
      );
      const health = await s
        .guest()
        .get('/flights/search?from=CAI&to=DXB&date=' + dateIn(2) + '&adults=1');
      check(
        'booking prices are unaffected (PAY-04)',
        health.status,
        health.status === 200,
      );
      await s.col('exchange_rates').insertMany(saved);
      s.fx.down = false;
    });
  });

  it('E5 webhook: bad/no signature, huge body, unknown type, unknown PaymentIntent', async () => {
    await probe('E5 hostile webhooks', async (check) => {
      const event = JSON.stringify({
        id: 'evt_e5',
        type: 'payment_intent.succeeded',
        paymentIntent: { id: 'pi_fake_1', metadata: {} },
      });
      const send = (body: string, signature?: string) => {
        const call = s.t
          .http()
          .post('/api/payments/webhook')
          .set('Content-Type', 'application/json');
        return (
          signature ? call.set('stripe-signature', signature) : call
        ).send(body);
      };
      const before = await s.col('payments').find({}).toArray();
      const bad = await send(event, 'wrong');
      const none = await send(event);
      check(
        'bad and missing signatures → 400 BAD_SIGNATURE',
        [`${bad.status} ${bad.body.code}`, `${none.status} ${none.body.code}`],
        bad.status === 400 &&
          bad.body.code === 'BAD_SIGNATURE' &&
          none.status === 400 &&
          none.body.code === 'BAD_SIGNATURE',
      );
      const huge = await send(
        JSON.stringify({
          id: 'evt_huge',
          type: 'ignored',
          originalType: 'x',
          pad: 'x'.repeat(3 * 1024 * 1024),
        }),
        FAKE_STRIPE_SIGNATURE,
      );
      check(
        'a huge body → 4xx (or 2xx ignored), never 5xx',
        huge.status,
        huge.status < 500,
      );
      const unknownType = await send(
        JSON.stringify({
          id: 'evt_unknown',
          type: 'ignored',
          originalType: 'charge.dispute.created',
        }),
        FAKE_STRIPE_SIGNATURE,
      );
      check(
        'an unknown event type → 2xx, ignored',
        unknownType.status,
        unknownType.status >= 200 && unknownType.status < 300,
      );
      const ghost = await send(
        JSON.stringify({
          id: `evt_ghost_${Date.now()}`,
          type: 'payment_intent.succeeded',
          paymentIntent: { id: 'pi_does_not_exist', metadata: {} },
        }),
        FAKE_STRIPE_SIGNATURE,
      );
      check(
        'an unknown PaymentIntent → 2xx, nothing changed',
        ghost.status,
        ghost.status >= 200 && ghost.status < 300,
      );
      const after = await s.col('payments').find({}).toArray();
      check(
        'no payment changed',
        after.map((p) => p.status),
        JSON.stringify(after.map((p) => p.status)) ===
          JSON.stringify(before.map((p) => p.status)),
      );
    });
  });

  it('records no unhandled rejection', () => {
    expect(s.unhandled).toEqual([]);
  });
});
