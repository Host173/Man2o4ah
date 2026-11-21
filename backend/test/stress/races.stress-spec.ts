import { Types } from 'mongoose';
import {
  confirmedFlightBooking,
  confirmedHotelBooking,
  createFlight,
  createRoom,
  flightBody,
  holdFlight,
  holdRoom,
  startPayment,
  statusOf,
} from './support/flows.js';
import {
  countOf,
  createStressApp,
  dateIn,
  eventually,
  Findings,
  parallel,
  probeRunner,
  settle,
  statuses,
  type Stress,
} from './support/stress-app.js';

/**
 * TST-03 area A: races on money and inventory. Every probe fires the calls
 * at once and asserts the documented outcome plus the global invariants,
 * never which request won (bookings-payments.md §10).
 */
describe('stress A: races on money and inventory', () => {
  let s: Stress;
  const findings = new Findings('races');
  const probe = probeRunner(() => s, findings);

  beforeAll(async () => {
    s = await createStressApp();
  });
  afterAll(async () => {
    findings.write();
    await s?.close();
  });

  const oid = (id: string) => new Types.ObjectId(id);

  async function cabin(flightId: string, cabinId: string) {
    const flight = await s.col('flights').findOne({ _id: oid(flightId) });
    return (
      (flight?.cabins ?? []) as {
        _id: Types.ObjectId;
        totalSeats: number;
        availableSeats: number;
        heldSeats: number;
        bookedSeats: number;
      }[]
    ).find((c) => c._id.toHexString() === cabinId)!;
  }

  it('A1 last seats: 10 users hold 1 seat on a cabin with 3 left', async () => {
    await probe('A1 last seats', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, { seats: 3 });
      const users = await Promise.all(
        Array.from({ length: 10 }, (_, i) => s.newUser(`a1-${i}`)),
      );
      const results = await parallel(10, (i) => holdFlight(users[i], flight));
      const codes = statuses(results);
      check('exactly 3 holds succeed (201)', codes, countOf(codes, 201) === 3);
      check(
        '7 × 409 SEATS_UNAVAILABLE',
        results.map((r) =>
          r.status === 'fulfilled' ? r.value.body.code : 'x',
        ),
        results.filter(
          (r) =>
            r.status === 'fulfilled' &&
            r.value.status === 409 &&
            r.value.body.code === 'SEATS_UNAVAILABLE',
        ).length === 7,
      );
      const c = await cabin(flight.flightId, flight.cabinId);
      check(
        'cabin: available 0, held 3',
        c,
        c.availableSeats === 0 && c.heldSeats === 3,
      );
    });
  });

  it('A2 two seats each on 5 left, and a round trip with a sold-out outbound', async () => {
    await probe(
      'A2 multi-seat holds and round trip all-or-nothing',
      async (check) => {
        const mod = await s.as(s.world.airlines.NA.moderator);
        const flight = await createFlight(s, mod, { seats: 5 });
        const users = await Promise.all(
          Array.from({ length: 10 }, (_, i) => s.newUser(`a2-${i}`)),
        );
        const results = await parallel(10, (i) =>
          holdFlight(users[i], flight, 2),
        );
        const codes = statuses(results);
        check(
          'exactly 2 holds of 2 seats succeed',
          codes,
          countOf(codes, 201) === 2,
        );
        check('8 × 409', codes, countOf(codes, 409) === 8);
        const c = await cabin(flight.flightId, flight.cabinId);
        check(
          '1 seat left, 4 held',
          c,
          c.availableSeats === 1 && c.heldSeats === 4,
        );

        // Round trip: the outbound sold out, the return free.
        const outbound = await createFlight(s, mod, {
          from: 'CAI',
          to: 'DXB',
          seats: 1,
          departureAt: new Date(Date.now() + 5 * 86_400_000),
        });
        const inbound = await createFlight(s, mod, {
          from: 'DXB',
          to: 'CAI',
          seats: 10,
          departureAt: new Date(Date.now() + 8 * 86_400_000),
        });
        const first = await holdFlight(users[0], outbound);
        check(
          'the single outbound seat is held',
          first.status,
          first.status === 201,
        );
        const tries = await parallel(5, (i) =>
          users[i + 1].post(
            '/flight-bookings/hold',
            flightBody([outbound, inbound], 1),
          ),
        );
        const tryCodes = statuses(tries);
        check(
          'every round-trip hold fails with 409',
          tryCodes,
          countOf(tryCodes, 409) === 5,
        );
        const back = await cabin(inbound.flightId, inbound.cabinId);
        check(
          'nothing held on the return flight',
          back,
          back.heldSeats === 0 && back.availableSeats === 10,
        );
      },
    );
  });

  it('A3 overlapping stays on one room; adjacent stays both win', async () => {
    await probe('A3 overlapping and adjacent stays', async (check) => {
      const hotel = s.world.hotels['Nile View Hotel'];
      const mod = await s.as(hotel.moderator);
      const roomId = await createRoom(mod, hotel.id);
      const users = await Promise.all(
        Array.from({ length: 8 }, (_, i) => s.newUser(`a3-${i}`)),
      );
      const results = await parallel(8, (i) =>
        holdRoom(
          users[i],
          hotel.id,
          [roomId],
          dateIn(30 + (i % 3)),
          dateIn(34 + (i % 2)),
        ),
      );
      const codes = statuses(results);
      check(
        'exactly one overlapping hold wins',
        codes,
        countOf(codes, 201) === 1,
      );
      check(
        'the others get 409 ROOMS_UNAVAILABLE',
        results.map((r) =>
          r.status === 'fulfilled' ? r.value.body.code : 'x',
        ),
        results.filter(
          (r) =>
            r.status === 'fulfilled' &&
            r.value.status === 409 &&
            r.value.body.code === 'ROOMS_UNAVAILABLE',
        ).length === 7,
      );

      const adjacent = await parallel(2, (i) =>
        holdRoom(
          users[i],
          hotel.id,
          [roomId],
          dateIn(50 + i * 2),
          dateIn(52 + i * 2),
        ),
      );
      check(
        'adjacent stays both win',
        statuses(adjacent),
        countOf(statuses(adjacent), 201) === 2,
      );
    });
  });

  it('A4 five parallel POST /payments for one booking', async () => {
    await probe('A4 parallel payment start', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, { seats: 3 });
      const user = await s.newUser('a4');
      const held = await holdFlight(user, flight);
      const bookingId = held.body.bookingId as string;
      await user.post(`/bookings/flight/${bookingId}/accept-policies`, {
        accepted: true,
      });
      const before = s.stripe.calls.length;
      const results = await parallel(5, () =>
        user.post('/payments', { bookingType: 'flight', bookingId }),
      );
      const codes = statuses(results);
      check(
        'no 5xx',
        codes,
        codes.every((c) => c > 0 && c < 500),
      );
      const payments = await s
        .col('payments')
        .find({ bookingId: oid(bookingId) })
        .toArray();
      check('one payment document', payments.length, payments.length === 1);
      const ids = new Set(
        results
          .filter((r) => r.status === 'fulfilled' && r.value.status === 201)
          .map(
            (r) =>
              (r as PromiseFulfilledResult<{ body: { paymentId: string } }>)
                .value.body.paymentId,
          ),
      );
      check('every success returns the same payment', [...ids], ids.size === 1);
      const intents = new Set(
        s.stripe.calls
          .slice(before)
          .filter((c) => c.method === 'createPaymentIntent')
          .map((c) => (c.input as { idempotencyKey: string }).idempotencyKey),
      );
      check(
        'one PaymentIntent (one idempotency key)',
        [...intents],
        intents.size === 1,
      );
    });
  });

  it('A5 webhook vs expiry job at the end of the hold, 20 rounds', async () => {
    await probe('A5 webhook vs expiry', async (check) => {
      const mod = await s.as(s.world.airlines.GW.moderator);
      const flight = await createFlight(s, mod, { seats: 40 });
      const user = await s.newUser('a5');
      const outcomes: string[] = [];
      for (let round = 0; round < 20; round += 1) {
        const held = await holdFlight(user, flight);
        const bookingId = held.body.bookingId as string;
        const started = await startPayment(s, user, 'flight', bookingId);
        // Model write (test-only): put the hold at its end now; the API can't.
        await s
          .col('flight_bookings')
          .updateOne(
            { _id: oid(bookingId) },
            { $set: { holdExpiresAt: new Date(Date.now() - 1) } },
          );
        await Promise.all([
          s.jobs.flightExpiry(),
          s.payWebhook(started.paymentIntentId),
        ]);
        const final = await eventually(async () => {
          const status = await statusOf(s, 'flight', bookingId);
          if (status === 'confirmed') return 'confirmed';
          if (status === 'expired') {
            const refund = await s
              .col('refunds')
              .findOne({ bookingId: oid(bookingId) });
            return refund ? `expired+refund:${refund.reason}` : '';
          }
          return '';
        });
        outcomes.push(
          final || `stuck:${await statusOf(s, 'flight', bookingId)}`,
        );
        if (final === 'confirmed') {
          const refund = await s
            .col('refunds')
            .findOne({ bookingId: oid(bookingId) });
          if (refund) outcomes.push('confirmed AND refunded');
        }
      }
      check(
        'each round: confirmed, or expired + late_payment refund; never both or neither',
        outcomes,
        outcomes.every(
          (o) => o === 'confirmed' || o === 'expired+refund:late_payment',
        ),
      );
    });
  });

  it('A6 five parallel cancels of one confirmed booking', async () => {
    await probe('A6 double cancel', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, {
        seats: 3,
        departureAt: new Date(Date.now() + 40 * 86_400_000),
      });
      const user = await s.newUser('a6');
      const { bookingId } = await confirmedFlightBooking(s, user, flight);
      const results = await parallel(5, () =>
        user.post(`/flight-bookings/${bookingId}/cancel`, {}),
      );
      const codes = statuses(results);
      check(
        'exactly one cancel succeeds',
        codes,
        codes.filter((c) => c >= 200 && c < 300).length === 1,
      );
      check('the others 409', codes, countOf(codes, 409) === 4);
      await settle(500);
      const refunds = await s
        .col('refunds')
        .find({ bookingId: oid(bookingId) })
        .toArray();
      check('one refund', refunds.length, refunds.length === 1);
      const notes = await s
        .col('notifications')
        .find({ userId: oid(user.id), type: 'booking_cancelled' })
        .toArray();
      check('one cancellation notification', notes.length, notes.length === 1);
      const refundCalls = s.stripe.calls.filter(
        (c) =>
          c.method === 'createRefund' &&
          refunds.some(
            (r) =>
              (c.input as { idempotencyKey: string }).idempotencyKey ===
              `refund-${r._id.toHexString()}`,
          ),
      );
      check(
        'Stripe asked for one refund',
        refundCalls.length,
        refundCalls.length === 1,
      );
    });
  });

  it('A7 cancel at the moment the completion job runs (departure just passed)', async () => {
    await probe('A7 cancel vs completion', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, { seats: 3 });
      const user = await s.newUser('a7');
      const { bookingId } = await confirmedFlightBooking(s, user, flight);
      // Model write (test-only): the departure has just passed; the API can't
      // create a flight in the past.
      const past = new Date(Date.now() - 1_000);
      await s.col('flight_bookings').updateOne(
        { _id: oid(bookingId) },
        {
          $set: {
            firstDepartureAt: past,
            lastDepartureAt: past,
            'segments.0.departureAt': past,
          },
        },
      );
      const [cancel] = await Promise.all([
        user.post(`/flight-bookings/${bookingId}/cancel`, {}),
        s.jobs.flightCompletion(),
      ]);
      check(
        'the cancel is blocked (409)',
        cancel.status,
        cancel.status === 409,
      );
      const status = await statusOf(s, 'flight', bookingId);
      check('the booking is completed', status, status === 'completed');
      const refund = await s
        .col('refunds')
        .findOne({ bookingId: oid(bookingId) });
      check('no refund on a completed booking', refund, refund === null);
    });
  });

  it('A8 the provider cancels a flight while users hold, pay and cancel on it', async () => {
    await probe('A8 provider cancel during activity', async (check) => {
      const mod = await s.as(s.world.airlines.EC.moderator);
      const flight = await createFlight(s, mod, {
        from: 'LHR',
        to: 'CDG',
        seats: 30,
        departureAt: new Date(Date.now() + 45 * 86_400_000),
      });
      const users = await Promise.all(
        Array.from({ length: 12 }, (_, i) => s.newUser(`a8-${i}`)),
      );
      const confirmed = [];
      for (const user of users.slice(0, 4)) {
        confirmed.push(await confirmedFlightBooking(s, user, flight));
      }
      const pending = [];
      for (const user of users.slice(4, 8)) {
        const held = await holdFlight(user, flight);
        pending.push(
          await startPayment(s, user, 'flight', held.body.bookingId),
        );
      }
      await Promise.allSettled([
        mod.post(`/flights/${flight.flightId}/cancel`, { confirm: true }),
        ...users.slice(8).map((user) => holdFlight(user, flight)),
        ...pending.map((p) => s.payWebhook(p.paymentIntentId)),
        users[0].post(`/flight-bookings/${confirmed[0].bookingId}/cancel`, {}),
        users[1].post(`/flight-bookings/${confirmed[1].bookingId}/cancel`, {}),
      ]);
      await settle(2_000);
      const status = (
        await s.col('flights').findOne({ _id: oid(flight.flightId) })
      )?.status;
      check('the flight is cancelled', status, status === 'cancelled');
      const bookings = await s
        .col('flight_bookings')
        .find({ 'segments.flightId': oid(flight.flightId) })
        .toArray();
      const left = bookings.filter((b) => b.status === 'pending_payment');
      // A booking left confirmed (and unrefunded) on the cancelled flight is
      // finding S-01 (findings/S-01-…); here: nothing stays pending.
      check(
        'no booking left pending on a cancelled flight',
        left.map((b) => `${b._id.toHexString()}:${b.status}`),
        left.length === 0,
      );
      const providerCancelled = bookings.filter(
        (b) =>
          b.status === 'cancelled' &&
          b.cancellation?.cancelledBy === 'provider',
      );
      check(
        'every provider-cancelled booking at 100%',
        providerCancelled.map((b) => b.cancellation.refundPercent),
        providerCancelled.every((b) => b.cancellation.refundPercent === 100),
      );
      const paidIds = new Set(
        (
          await s
            .col('payments')
            .find({
              bookingId: { $in: bookings.map((b) => b._id) },
              status: 'succeeded',
            })
            .toArray()
        ).map((p) => p.bookingId.toHexString()),
      );
      const refunded = new Set(
        (
          await s
            .col('refunds')
            .find({ bookingId: { $in: bookings.map((b) => b._id) } })
            .toArray()
        ).map((r) => r.bookingId.toHexString()),
      );
      const unrefunded = bookings.filter(
        (b) =>
          b.status !== 'confirmed' &&
          paidIds.has(b._id.toHexString()) &&
          !refunded.has(b._id.toHexString()) &&
          !(
            b.status === 'cancelled' && b.cancellation?.refundAmountMinor === 0
          ),
      );
      check(
        'every paid, no-longer-confirmed booking on the cancelled flight is refunded',
        unrefunded.map((b) => `${b._id.toHexString()}:${b.status}`),
        unrefunded.length === 0,
      );
    });
  });

  it('A9 parallel register, like and report', async () => {
    await probe('A9 parallel register/like/report', async (check) => {
      const email = `a9.${Date.now()}@example.com`;
      const reg = await parallel(5, () =>
        s.guest().post('/auth/register', {
          name: 'Racer',
          email,
          password: 'Demo12345',
          acceptTerms: true,
        }),
      );
      const regCodes = statuses(reg);
      check(
        'one registration succeeds',
        regCodes,
        countOf(regCodes, 201) === 1,
      );
      check(
        'the others 409 EMAIL_TAKEN',
        regCodes,
        countOf(regCodes, 409) === 4,
      );
      const accounts = await s.col('users').countDocuments({ email });
      check('one account', accounts, accounts === 1);

      const author = await s.newUser('a9-author');
      const post = await author.post('/posts', {
        title: 'Race post',
        body: 'Body',
        status: 'published',
      });
      check('the post is created', post.status, post.status === 201);
      const postId = post.body._id as string;
      const fan = await s.newUser('a9-fan');
      const likes = await parallel(10, () =>
        fan.post(`/posts/${postId}/like`, {}),
      );
      const likeCodes = statuses(likes);
      check(
        'no like call fails with 5xx',
        likeCodes,
        likeCodes.every((c) => c > 0 && c < 500),
      );
      const doc = await s.col('posts').findOne({ _id: oid(postId) });
      check('likeCount 1', doc?.likeCount, doc?.likeCount === 1);
      const likeDocs = await s
        .col('likes')
        .countDocuments({ postId: oid(postId) });
      check('one like document', likeDocs, likeDocs === 1);

      const reports = await parallel(5, () =>
        fan.post('/reports', {
          targetType: 'post',
          targetId: postId,
          reason: 'spam',
        }),
      );
      const reportCodes = statuses(reports);
      check(
        'one report succeeds',
        reportCodes,
        countOf(reportCodes, 201) === 1,
      );
      check(
        'the others 409 ALREADY_REPORTED',
        reportCodes,
        countOf(reportCodes, 409) === 4,
      );
      const reportDocs = await s
        .col('reports')
        .countDocuments({ targetId: oid(postId) });
      check('one report document', reportDocs, reportDocs === 1);
    });
  });

  it('A10 the moderator cuts a cabin while users hold seats', async () => {
    await probe('A10 capacity edit vs holds', async (check) => {
      const mod = await s.as(s.world.airlines.NA.moderator);
      const flight = await createFlight(s, mod, { seats: 10 });
      const users = await Promise.all(
        Array.from({ length: 8 }, (_, i) => s.newUser(`a10-${i}`)),
      );
      const [edit, ...holds] = await Promise.allSettled([
        mod.patch(`/flights/${flight.flightId}/cabins/${flight.cabinId}`, {
          totalSeats: 4,
        }),
        ...users.map((user) => holdFlight(user, flight)),
      ]);
      const editCode = edit.status === 'fulfilled' ? edit.value.status : -1;
      check(
        'the edit answers 200 or 4xx, never 5xx',
        editCode,
        editCode > 0 && editCode < 500,
      );
      const c = await cabin(flight.flightId, flight.cabinId);
      check(
        'totalSeats never below held + booked',
        c,
        c.totalSeats >= c.heldSeats + c.bookedSeats,
      );
      const holdCodes = statuses(holds as PromiseSettledResult<never>[]);
      check(
        'no hold 5xx',
        holdCodes,
        holdCodes.every((code) => code > 0 && code < 500),
      );
    });
  });

  it('A-hotel parallel cancels of one confirmed reservation', async () => {
    await probe('A6b hotel double cancel', async (check) => {
      const hotel = s.world.hotels['Thames Court'];
      const mod = await s.as(hotel.moderator);
      const roomId = await createRoom(mod, hotel.id);
      const user = await s.newUser('a6b');
      const { bookingId } = await confirmedHotelBooking(
        s,
        user,
        hotel.id,
        roomId,
        dateIn(40),
        dateIn(43),
      );
      const results = await parallel(5, () =>
        user.post(`/hotel-bookings/${bookingId}/cancel`, {}),
      );
      const codes = statuses(results);
      check(
        'exactly one cancel succeeds',
        codes,
        codes.filter((c) => c >= 200 && c < 300).length === 1,
      );
      await settle(500);
      const refunds = await s
        .col('refunds')
        .countDocuments({ bookingId: oid(bookingId) });
      check('one refund', refunds, refunds === 1);
    });
  });

  it('records no unhandled rejection', () => {
    expect(s.unhandled).toEqual([]);
  });
});
