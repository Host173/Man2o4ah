import { Types } from 'mongoose';
import {
  confirmedFlightBooking,
  createFlight,
  createRoom,
  holdFlight,
  holdRoom,
  isErrorShape,
  startPayment,
  statusOf,
} from './support/flows.js';
import {
  createStressApp,
  dateIn,
  eventually,
  Findings,
  parallel,
  probeRunner,
  settle,
  type Stress,
} from './support/stress-app.js';

/** TST-03 area B: time and the lifecycle (GEN-11, PAY-01, PAY-03, FLT-11, GEN-06). */
describe('stress B: time and the lifecycle', () => {
  let s: Stress;
  const findings = new Findings('lifecycle');
  const probe = probeRunner(() => s, findings);
  const oid = (id: string) => new Types.ObjectId(id);

  beforeAll(async () => {
    s = await createStressApp();
  });
  afterAll(async () => {
    findings.write();
    await s?.close();
  });

  /** Model write (test-only): moves a hold's end; the API can't wait 10 minutes. */
  function setHoldEnd(type: 'flight' | 'hotel', bookingId: string, at: Date) {
    return s
      .col(type === 'flight' ? 'flight_bookings' : 'hotel_reservations')
      .updateOne({ _id: oid(bookingId) }, { $set: { holdExpiresAt: at } });
  }

  it('B1 hold boundaries: pay just before and just after the end, then the job', async () => {
    await probe('B1 hold boundaries', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, { seats: 5 });
      const user = await s.newUser('b1');

      const early = await holdFlight(user, flight);
      const earlyId = early.body.bookingId as string;
      await user.post(`/bookings/flight/${earlyId}/accept-policies`, {
        accepted: true,
      });
      await setHoldEnd('flight', earlyId, new Date(Date.now() + 1_500));
      const allowed = await user.post('/payments', {
        bookingType: 'flight',
        bookingId: earlyId,
      });
      check(
        'paying 1 s before the end is allowed (201)',
        allowed.status,
        allowed.status === 201,
      );

      const late = await holdFlight(user, flight);
      const lateId = late.body.bookingId as string;
      await user.post(`/bookings/flight/${lateId}/accept-policies`, {
        accepted: true,
      });
      await setHoldEnd('flight', lateId, new Date(Date.now() - 1_000));
      const refused = await user.post('/payments', {
        bookingType: 'flight',
        bookingId: lateId,
      });
      check(
        'paying 1 s after the end is 409 HOLD_EXPIRED',
        `${refused.status} ${refused.body.code}`,
        refused.status === 409 && refused.body.code === 'HOLD_EXPIRED',
      );

      await new Promise((r) => setTimeout(r, 1_600));
      const ran = new Date();
      await s.jobs.flightExpiry(ran);
      check(
        'both bookings expired',
        [
          await statusOf(s, 'flight', earlyId),
          await statusOf(s, 'flight', lateId),
        ],
        (await statusOf(s, 'flight', earlyId)) === 'expired' &&
          (await statusOf(s, 'flight', lateId)) === 'expired',
      );
      const payment = await eventually(async () => {
        const p = await s.col('payments').findOne({ bookingId: oid(earlyId) });
        return p?.status === 'canceled' ? p : null;
      });
      check(
        'the PaymentIntent is cancelled (payment canceled)',
        payment?.status,
        payment?.status === 'canceled',
      );
      const cancelled = s.stripe.calls.filter(
        (c) =>
          c.method === 'cancelPaymentIntent' &&
          c.input === payment?.stripePaymentIntentId,
      );
      check(
        'Stripe was asked to cancel it once',
        cancelled.length,
        cancelled.length === 1,
      );
      const broken = await s.invariants({ expiryRanAt: ran });
      check(
        'seats released; nothing pending past its hold',
        broken,
        broken.length === 0,
      );
    });
  });

  it('B2 late payment: the hold expired, then payment_intent.succeeded arrives', async () => {
    await probe('B2 late payment', async (check) => {
      for (const type of ['flight', 'hotel'] as const) {
        const user = await s.newUser(`b2-${type}`);
        let bookingId: string;
        if (type === 'flight') {
          const mod = await s.as(s.world.airlines.NA.moderator);
          const flight = await createFlight(s, mod, { seats: 2 });
          bookingId = (await holdFlight(user, flight)).body.bookingId;
        } else {
          const hotel = s.world.hotels['Seine Garden'];
          const roomId = await createRoom(
            await s.as(hotel.moderator),
            hotel.id,
          );
          bookingId = (
            await holdRoom(user, hotel.id, [roomId], dateIn(20), dateIn(22))
          ).body.reservationId;
        }
        const started = await startPayment(s, user, type, bookingId);
        await setHoldEnd(type, bookingId, new Date(Date.now() - 1_000));
        if (type === 'flight') await s.jobs.flightExpiry();
        else await s.jobs.hotelExpiry();
        await settle(200);
        await s.payWebhook(started.paymentIntentId);
        const refund = await eventually(() =>
          s.col('refunds').findOne({ bookingId: oid(bookingId) }),
        );
        const status = await statusOf(s, type, bookingId);
        check(
          `${type}: not confirmed (stays expired)`,
          status,
          status === 'expired',
        );
        const doc = await s
          .col(type === 'flight' ? 'flight_bookings' : 'hotel_reservations')
          .findOne({ _id: oid(bookingId) });
        const total =
          type === 'flight' ? doc?.pricing.totalMinor : doc?.totalMinor;
        check(
          `${type}: full late_payment refund`,
          refund,
          refund?.reason === 'late_payment' && refund?.amountMinor === total,
        );
        const note = await eventually(() =>
          s
            .col('notifications')
            .findOne({ userId: oid(user.id), type: 'refund_updated' }),
        );
        check(`${type}: the user is notified`, note?.type, note !== null);
      }
    });
  });

  it('B3 failed payment then retry inside the hold; failed and the hold expires', async () => {
    await probe('B3 failed payment and retry', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, { seats: 3 });
      const user = await s.newUser('b3');
      const bookingId = (await holdFlight(user, flight)).body
        .bookingId as string;
      const started = await startPayment(s, user, 'flight', bookingId);
      await s.payWebhook(
        started.paymentIntentId,
        'payment_intent.payment_failed',
      );
      const failed = await s
        .col('payments')
        .findOne({ bookingId: oid(bookingId) });
      check(
        'the payment is failed, the booking still pending',
        [failed?.status, await statusOf(s, 'flight', bookingId)],
        failed?.status === 'failed' &&
          (await statusOf(s, 'flight', bookingId)) === 'pending_payment',
      );
      const retry = await user.post(`/payments/${started.paymentId}/retry`, {});
      check(
        'retry answers 2xx',
        retry.status,
        retry.status >= 200 && retry.status < 300,
      );
      await Promise.all([
        s.payWebhook(started.paymentIntentId),
        s.payWebhook(started.paymentIntentId),
      ]);
      const status = await eventually(async () =>
        (await statusOf(s, 'flight', bookingId)) === 'confirmed'
          ? 'confirmed'
          : '',
      );
      check('confirmed', status, status === 'confirmed');
      await settle(300);
      const notes = await s
        .col('notifications')
        .countDocuments({ userId: oid(user.id), type: 'booking_confirmed' });
      check('confirmed once (one notification)', notes, notes === 1);

      const second = (await holdFlight(user, flight)).body.bookingId as string;
      const paid = await startPayment(s, user, 'flight', second);
      await s.payWebhook(paid.paymentIntentId, 'payment_intent.payment_failed');
      await setHoldEnd('flight', second, new Date(Date.now() - 1_000));
      await s.jobs.flightExpiry();
      await settle(300);
      const p2 = await s.col('payments').findOne({ bookingId: oid(second) });
      check(
        'failed + hold over → expired, nothing charged',
        [await statusOf(s, 'flight', second), p2?.status],
        (await statusOf(s, 'flight', second)) === 'expired' &&
          p2?.status !== 'succeeded',
      );
    });
  });

  it('B4 out-of-order and replayed webhooks', async () => {
    await probe('B4 out-of-order webhooks', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, {
        seats: 3,
        departureAt: new Date(Date.now() + 40 * 86_400_000),
      });
      const user = await s.newUser('b4');
      const paid = await confirmedFlightBooking(s, user, flight);
      const late = await s.payWebhook(
        paid.paymentIntentId,
        'payment_intent.payment_failed',
      );
      check(
        'a late payment_failed answers 2xx',
        late.status,
        late.status < 300,
      );
      const payment = await s
        .col('payments')
        .findOne({ _id: oid(paid.paymentId) });
      check(
        'payment stays succeeded',
        payment?.status,
        payment?.status === 'succeeded',
      );
      check(
        'booking stays confirmed',
        await statusOf(s, 'flight', paid.bookingId),
        (await statusOf(s, 'flight', paid.bookingId)) === 'confirmed',
      );

      const cancel = await user.post(
        `/flight-bookings/${paid.bookingId}/cancel`,
        {},
      );
      check('cancel ok', cancel.status, cancel.status < 300);
      const refund = await eventually(() =>
        s.col('refunds').findOne({ bookingId: oid(paid.bookingId) }),
      );
      const refundId = refund!._id.toHexString();
      const stripeId = refund!.stripeRefundId as string;
      const okEvent = `evt_b4_ok_${Date.now()}`;
      await s.refundWebhook(stripeId, 'succeeded', refundId, okEvent);
      const afterOk = await s.col('refunds').findOne({ _id: refund!._id });
      check(
        'refund.updated succeeded → refunded',
        afterOk?.status,
        afterOk?.status === 'refunded',
      );
      await s.refundWebhook(stripeId, 'failed', refundId);
      const afterFail = await s.col('refunds').findOne({ _id: refund!._id });
      // refund-rules.ts: Stripe can fail a refund after it succeeded.
      check(
        'refund.failed after refunded → failed (PAY-03 table)',
        afterFail?.status,
        afterFail?.status === 'failed',
      );
      const replay = await s.refundWebhook(
        stripeId,
        'succeeded',
        refundId,
        okEvent,
      );
      const afterReplay = await s.col('refunds').findOne({ _id: refund!._id });
      check(
        'a replayed old event changes nothing (200, still failed)',
        [replay.status, afterReplay?.status],
        replay.status < 300 && afterReplay?.status === 'failed',
      );
    });
  });

  it('B5 every job run twice at once (two app instances)', async () => {
    await probe('B5 jobs twice in parallel', async (check) => {
      const mod = await s.as(s.world.airlines.GW.moderator);
      const flight = await createFlight(s, mod, { seats: 20 });
      const user = await s.newUser('b5');
      const ids: string[] = [];
      const intents: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const id = (await holdFlight(user, flight)).body.bookingId as string;
        intents.push(
          (await startPayment(s, user, 'flight', id)).paymentIntentId,
        );
        ids.push(id);
      }
      // Probe correction: end the holds only now. A new hold first expires the
      // overdue holds on its flight (backend.md §10), so ending each hold
      // inside the loop let the next hold expire it before the jobs ran.
      for (const id of ids) {
        await setHoldEnd('flight', id, new Date(Date.now() - 1_000));
      }
      const hotel = s.world.hotels['Marina Bay Suites'];
      const roomId = await createRoom(await s.as(hotel.moderator), hotel.id);
      const resId = (
        await holdRoom(user, hotel.id, [roomId], dateIn(10), dateIn(12))
      ).body.reservationId as string;
      await setHoldEnd('hotel', resId, new Date(Date.now() - 1_000));
      const before = s.stripe.calls.length;
      const [a, b] = await Promise.all([
        s.jobs.flightExpiry(),
        s.jobs.flightExpiry(),
      ]);
      check('5 holds expired in total across both runs', [a, b], a + b === 5);
      const [h1, h2] = await Promise.all([
        s.jobs.hotelExpiry(),
        s.jobs.hotelExpiry(),
      ]);
      check('1 hotel hold expired in total', [h1, h2], h1 + h2 === 1);
      await settle(500);
      const cancels = s.stripe.calls
        .slice(before)
        .filter(
          (c) =>
            c.method === 'cancelPaymentIntent' &&
            intents.includes(c.input as string),
        );
      check(
        'each PaymentIntent cancelled once',
        cancels.length,
        cancels.length === 5,
      );
      const results = await Promise.allSettled([
        s.jobs.flightCompletion(),
        s.jobs.flightCompletion(),
        s.jobs.hotelCompletion(),
        s.jobs.hotelCompletion(),
        s.jobs.markDeparted(),
        s.jobs.markDeparted(),
        s.jobs.postImageCleanup(),
        s.jobs.postImageCleanup(),
      ]);
      check(
        'no job throws when run twice',
        results.map((r) => r.status),
        results.every((r) => r.status === 'fulfilled'),
      );
    });
  });

  it('B6 time zones: late-evening departure, arrival next day; DST weekends in London', async () => {
    await probe('B6 time zones and DST', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const localDate = dateIn(6);
      const created = await mod.post('/flights', {
        flightNumber: 'TZ 2330',
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureLocal: `${localDate}T23:30`,
        arrivalLocal: `${dateIn(7)}T04:00`,
      });
      check('created', created.status, created.status === 201);
      await mod.post(`/flights/${created.body._id}/cabins`, {
        cabinClass: 'economy',
        totalSeats: 5,
        priceMinor: 1000,
        freeBags: 1,
        maxBagWeightKg: 23,
      });
      const onDay = await s
        .guest()
        .get(`/flights/search?from=CAI&to=DXB&date=${localDate}&adults=1`);
      const ids = JSON.stringify(onDay.body);
      check(
        'found on its local departure date',
        onDay.status,
        onDay.status === 200 && ids.includes(created.body._id),
      );
      const nextDay = await s
        .guest()
        .get(`/flights/search?from=CAI&to=DXB&date=${dateIn(7)}&adults=1`);
      check(
        'not found on the next (UTC) day',
        nextDay.status,
        nextDay.status === 200 &&
          !JSON.stringify(nextDay.body).includes(created.body._id),
      );

      const euro = await s.as(s.world.airlines.EC.moderator);
      // Last Sunday of March 2027 (BST starts) and of October 2027 (BST ends).
      const cases = [
        { day: '2027-03-28', local: '10:00', utc: '2027-03-28T09:00:00.000Z' },
        { day: '2027-10-31', local: '10:00', utc: '2027-10-31T10:00:00.000Z' },
        { day: '2027-03-27', local: '10:00', utc: '2027-03-27T10:00:00.000Z' },
      ];
      for (const c of cases) {
        const res = await euro.post('/flights', {
          flightNumber: `DST ${c.day.slice(5, 7)}${c.day.slice(8)}`,
          departureAirportId: 'LHR',
          arrivalAirportId: 'CDG',
          departureLocal: `${c.day}T${c.local}`,
          arrivalLocal: `${c.day}T13:30`,
        });
        const doc = res.body._id
          ? await s.col('flights').findOne({ _id: oid(res.body._id) })
          : null;
        check(
          `${c.day} ${c.local} London stored as ${c.utc}`,
          doc?.departureAt?.toISOString() ?? res.body,
          doc?.departureAt?.toISOString() === c.utc &&
            doc?.departureLocalDate === c.day,
        );
      }
      // Times that don't exist / exist twice in London: no 5xx.
      for (const local of ['2027-03-28T01:30', '2027-10-31T01:30']) {
        const res = await euro.post('/flights', {
          flightNumber: `GAP ${local.slice(5, 7)}`,
          departureAirportId: 'LHR',
          arrivalAirportId: 'CDG',
          departureLocal: local,
          arrivalLocal: `${local.slice(0, 10)}T05:30`,
        });
        check(
          `${local} (DST gap/overlap) answers without a 5xx`,
          `${res.status} ${JSON.stringify(res.body).slice(0, 120)}`,
          res.status < 500,
        );
      }
    });
  });

  it('B7 calendar dates: leap days, zero and negative stays, long stays', async () => {
    await probe('B7 dates', async (check) => {
      const hotel = s.world.hotels['Nile View Hotel'];
      const roomId = await createRoom(await s.as(hotel.moderator), hotel.id);
      const user = await s.newUser('b7');
      const cases: [
        string,
        string,
        string,
        (status: number, code?: string) => boolean,
      ][] = [
        [
          '2026-02-29 (not a leap year)',
          '2026-02-29',
          '2026-03-02',
          (st) => st === 400,
        ],
        [
          '2028-02-29 (leap year, outside availability)',
          '2028-02-29',
          '2028-03-02',
          (st) => st === 409 || st === 400,
        ],
        ['check-in = check-out', dateIn(20), dateIn(20), (st) => st === 400],
        [
          'check-out before check-in',
          dateIn(22),
          dateIn(20),
          (st) => st === 400,
        ],
        ['check-in in the past', dateIn(-1), dateIn(2), (st) => st === 400],
        ['a 1-night stay', dateIn(25), dateIn(26), (st) => st === 201],
      ];
      for (const [name, inDate, outDate, ok] of cases) {
        const res = await holdRoom(user, hotel.id, [roomId], inDate, outDate);
        check(
          `${name}: ${res.status}`,
          `${res.status} ${res.body.code}`,
          ok(res.status, res.body.code) &&
            (res.status < 300 || isErrorShape(res.body)),
        );
      }
      // No maximum stay is documented: only "no 5xx, no corrupted data".
      const long = await holdRoom(
        user,
        hotel.id,
        [roomId],
        dateIn(30),
        dateIn(118),
      );
      check(
        'an 88-night stay (no documented maximum) answers without 5xx',
        long.status,
        long.status < 500,
      );
      const longer = await holdRoom(
        user,
        hotel.id,
        [roomId],
        dateIn(1),
        dateIn(3000),
      );
      check(
        'a 3000-night stay answers without 5xx',
        longer.status,
        longer.status < 500,
      );
      const search = await parallel(3, (i) =>
        s
          .guest()
          .get(
            `/flights/search?from=CAI&to=DXB&date=${['2026-02-29', '2026-13-01', 'not-a-date'][i]}&adults=1`,
          ),
      );
      check(
        'flight search with impossible dates → 400',
        search.map((r) => (r.status === 'fulfilled' ? r.value.status : -1)),
        search.every((r) => r.status === 'fulfilled' && r.value.status === 400),
      );
    });
  });

  it('records no unhandled rejection', () => {
    expect(s.unhandled).toEqual([]);
  });
});
