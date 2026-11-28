import { Types } from 'mongoose';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import {
  createFullApp,
  DEMO_ACCOUNTS,
  JOURNEY_TIMEOUT,
} from '../support/full-app.js';
import type { Actor, FullApp } from '../support/full-app.js';
import { HOOK_TIMEOUT } from '../support/mongo-memory.js';

const DAY_MS = 86_400_000;
const PASSENGERS = 2;
/** Event listeners run after the HTTP answer; the tests wait for their effect. */
const EVENTS = { timeout: 15_000, interval: 50 };

interface CabinBody {
  _id: string;
  cabinClass: string;
  totalSeats: number;
  availableSeats: number;
  heldSeats: number;
  bookedSeats: number;
  priceMinor: number;
}

interface FlightBody {
  _id: string;
  flightNumber: string;
  status: string;
  departureAt: string;
  arrivalAt: string;
  departureLocalDate: string;
  departureTimeZone: string;
  arrivalTimeZone: string;
  cabins: CabinBody[];
}

interface SearchItemBody {
  flight: FlightBody;
  matchingCabins: CabinBody[];
}

interface PageBody<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Pricing {
  fareTotalMinor: number;
  baggageTotalMinor: number;
  totalMinor: number;
  currency: string;
}

interface HoldBody {
  bookingId: string;
  status: string;
  seatCount: number;
  holdExpiresAt: string;
  pricing: Pricing;
  segments: { direction: string; flightId: string; cabinId: string }[];
}

interface BookingBody {
  _id: string;
  reference?: string;
  status: string;
  tripType: string;
  pricing: Pricing;
  segments: { direction: string; flightNumber: string }[];
  cancellation?: {
    cancelledBy: string;
    refundPercent: number;
    refundAmountMinor: number;
  };
}

interface PaymentSessionBody {
  paymentId: string;
  clientSecret: string;
  amountMinor: number;
  currency: string;
}

interface RefundBody {
  refundId: string;
  bookingId: string;
  amountMinor: number;
  currency: string;
  reason: string;
  status: string;
}

interface NotificationBody {
  type: string;
  title: string;
  message: string;
  entity?: { type: string; id: string };
}

interface Segment {
  flightId: string;
  cabinId: string;
}

function body<T>(res: { body: unknown }): T {
  return res.body as T;
}

/** The calendar date `days` from today, as the demo flights are dated. */
function dateIn(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

/** `HH:mm` of a UTC instant in a time zone (GEN-06). */
function clockIn(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

/** The PaymentIntent id behind a fake client secret (`<id>_secret`). */
function intentOf(session: PaymentSessionBody): string {
  return session.clientSecret.replace(/_secret$/, '');
}

/** All the text of a PDF, page after page. */
async function pdfText(bytes: Buffer): Promise<string> {
  const loading = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  try {
    const pdf = await loading.promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(
        content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
      );
    }
    return pages.join('\n');
  } finally {
    await loading.destroy();
  }
}

function passengers(count = PASSENGERS) {
  return Array.from({ length: count }, (_, i) => ({
    type: 'adult',
    fullName: `Journey Traveller ${i + 1}`,
    dateOfBirth: '1990-01-01',
    documentNumber: `P${1000000 + i}`,
    extraBagCount: 0,
  }));
}

describe(
  'Flight booking journeys, the whole app (TST-01)',
  { timeout: JOURNEY_TIMEOUT },
  () => {
    let app: FullApp;

    beforeAll(async () => {
      app = await createFullApp();
    }, HOOK_TIMEOUT);
    afterEach(async () => {
      await app.expectInvariants();
    });
    afterAll(() => app.t.close(), HOOK_TIMEOUT);

    async function search(
      user: Actor,
      from: string,
      to: string,
      date: string,
    ): Promise<SearchItemBody[]> {
      const res = await user
        .get('/api/flights/search')
        .query({ from, to, date, adults: PASSENGERS, sortBy: 'price' })
        .expect(200);
      const page = body<PageBody<SearchItemBody>>(res);
      expect(page.page).toBe(1);
      expect(page.total).toBeGreaterThan(0);
      for (const item of page.items) {
        expect(item.flight.departureLocalDate).toBe(date);
      }
      return page.items;
    }

    /** The cheapest economy flight of a route on a day, found through search. */
    async function economyFlight(
      user: Actor,
      from: string,
      to: string,
      day: number,
    ): Promise<{ flight: FlightBody; cabin: CabinBody }> {
      const items = await search(user, from, to, dateIn(day));
      const item = items[0];
      const cabin = item.matchingCabins.find((c) => c.cabinClass === 'economy');
      if (!cabin) throw new Error('the search found no economy cabin');
      return { flight: item.flight, cabin };
    }

    async function cabinOf(
      user: Actor,
      flightId: string,
      cabinId: string,
    ): Promise<CabinBody> {
      const res = await user.get(`/api/flights/${flightId}`).expect(200);
      const cabin = body<FlightBody>(res).cabins.find((c) => c._id === cabinId);
      if (!cabin) throw new Error('the flight has no such cabin');
      return cabin;
    }

    function bookingRequest(
      segments: Segment[],
      people = passengers(),
    ): Record<string, unknown> {
      return {
        tripType: segments.length === 2 ? 'round_trip' : 'one_way',
        segments,
        passengers: people,
      };
    }

    async function hold(user: Actor, segments: Segment[]): Promise<HoldBody> {
      const res = await user
        .post('/api/flight-bookings/hold')
        .send(bookingRequest(segments))
        .expect(201);
      const held = body<HoldBody>(res);
      expect(held.status).toBe('pending_payment');
      expect(held.seatCount).toBe(PASSENGERS);
      return held;
    }

    async function accept(user: Actor, bookingId: string): Promise<void> {
      const res = await user
        .post(`/api/bookings/flight/${bookingId}/accept-policies`)
        .send({ accepted: true })
        .expect(200);
      expect(body<{ accepted: boolean }>(res).accepted).toBe(true);
    }

    async function pay(
      user: Actor,
      bookingId: string,
    ): Promise<PaymentSessionBody> {
      const res = await user
        .post('/api/payments')
        .send({ bookingType: 'flight', bookingId })
        .expect(201);
      return body<PaymentSessionBody>(res);
    }

    async function holdAcceptPay(user: Actor, segments: Segment[]) {
      const held = await hold(user, segments);
      await accept(user, held.bookingId);
      const session = await pay(user, held.bookingId);
      return { held, session };
    }

    async function booking(user: Actor, id: string): Promise<BookingBody> {
      const res = await user.get(`/api/flight-bookings/${id}`).expect(200);
      return body<BookingBody>(res);
    }

    async function waitForStatus(
      user: Actor,
      id: string,
      status: string,
    ): Promise<BookingBody> {
      await expect
        .poll(async () => (await booking(user, id)).status, EVENTS)
        .toBe(status);
      return booking(user, id);
    }

    async function notifications(user: Actor): Promise<NotificationBody[]> {
      const res = await user.get('/api/notifications').expect(200);
      return body<PageBody<NotificationBody>>(res).items;
    }

    async function waitForNotification(
      user: Actor,
      type: string,
      entityId: string,
    ): Promise<NotificationBody> {
      await expect
        .poll(
          async () =>
            (await notifications(user)).some(
              (n) => n.type === type && n.entity?.id === entityId,
            ),
          EVENTS,
        )
        .toBe(true);
      const found = (await notifications(user)).find(
        (n) => n.type === type && n.entity?.id === entityId,
      );
      if (!found) throw new Error(`no ${type} notification`);
      return found;
    }

    async function mine(user: Actor, group: string): Promise<BookingBody[]> {
      const res = await user
        .get('/api/flight-bookings')
        .query({ group })
        .expect(200);
      return body<PageBody<BookingBody>>(res).items;
    }

    async function stripeRefundIdOf(refundId: string): Promise<string> {
      const doc = await app.t.connection
        .collection<{ _id: Types.ObjectId; stripeRefundId?: string }>('refunds')
        .findOne({ _id: new Types.ObjectId(refundId) });
      if (!doc?.stripeRefundId) throw new Error('the refund has no Stripe id');
      return doc.stripeRefundId;
    }

    it('books a one-way flight: search, quote, hold, accept, pay, confirm, e-ticket (FLT-11/17/19/21/22/23/25, PAY-01/02, GEN-06)', async () => {
      const user = await app.newUser();
      const { flight, cabin } = await economyFlight(user, 'CAI', 'DXB', 4);
      const segments = [{ flightId: flight._id, cabinId: cabin._id }];

      const details = await user.get(`/api/flights/${flight._id}`).expect(200);
      const detailBody = body<FlightBody & { airline: { name: string } }>(
        details,
      );
      expect(detailBody.flightNumber).toBe(flight.flightNumber);
      expect(detailBody.airline.name).toBeTruthy();
      expect(detailBody.departureTimeZone).toBe('Africa/Cairo');
      expect(detailBody.arrivalTimeZone).toBe('Asia/Dubai');

      const quote = await user
        .post('/api/flight-bookings')
        .send(bookingRequest(segments))
        .expect(200);
      const quoted = body<HoldBody>(quote);
      expect(quoted.seatCount).toBe(PASSENGERS);
      expect(quoted.pricing).toEqual({
        fareTotalMinor: PASSENGERS * cabin.priceMinor,
        baggageTotalMinor: 0,
        totalMinor: PASSENGERS * cabin.priceMinor,
        currency: 'USD',
      });
      // A quote saves nothing.
      expect(await cabinOf(user, flight._id, cabin._id)).toMatchObject({
        availableSeats: cabin.availableSeats,
        heldSeats: cabin.heldSeats,
      });

      const held = await hold(user, segments);
      expect(held.pricing).toEqual(quoted.pricing);
      expect(
        new Date(held.holdExpiresAt).getTime() - Date.now(),
      ).toBeGreaterThan(8 * 60_000);
      expect(await cabinOf(user, flight._id, cabin._id)).toMatchObject({
        availableSeats: cabin.availableSeats - PASSENGERS,
        heldSeats: cabin.heldSeats + PASSENGERS,
        bookedSeats: cabin.bookedSeats,
      });
      expect((await booking(user, held.bookingId)).reference).toBeUndefined();

      const policies = await user
        .get(`/api/bookings/flight/${held.bookingId}/policies`)
        .expect(200);
      expect(body<{ accepted: boolean }>(policies).accepted).toBe(false);
      const early = await user
        .post('/api/payments')
        .send({ bookingType: 'flight', bookingId: held.bookingId })
        .expect(409);
      expect(body<{ code: string }>(early).code).toBe(
        ErrorCode.PoliciesNotAccepted,
      );

      await accept(user, held.bookingId);
      const accepted = await user
        .get(`/api/bookings/flight/${held.bookingId}/policies`)
        .expect(200);
      expect(body<{ accepted: boolean }>(accepted).accepted).toBe(true);

      const session = await pay(user, held.bookingId);
      expect(session.amountMinor).toBe(held.pricing.totalMinor);
      expect(session.currency).toBe('USD');
      const status = await user
        .get(`/api/payments/${session.paymentId}`)
        .expect(200);
      expect(body<{ status: string }>(status).status).toBe('pending');

      // Paying is not enough: only Stripe's webhook confirms.
      expect((await booking(user, held.bookingId)).status).toBe(
        'pending_payment',
      );
      await app.webhook.paymentSucceeded(intentOf(session)).expect(200);

      const confirmed = await waitForStatus(user, held.bookingId, 'confirmed');
      expect(confirmed.reference).toMatch(/^FB[A-HJ-NP-Z2-9]{6}$/);
      expect(await cabinOf(user, flight._id, cabin._id)).toMatchObject({
        availableSeats: cabin.availableSeats - PASSENGERS,
        heldSeats: cabin.heldSeats,
        bookedSeats: cabin.bookedSeats + PASSENGERS,
      });
      const paid = await user
        .get(`/api/payments/${session.paymentId}`)
        .expect(200);
      expect(body<{ status: string }>(paid).status).toBe('succeeded');

      const note = await waitForNotification(
        user,
        'booking_confirmed',
        held.bookingId,
      );
      expect(note.entity?.type).toBe('flight_booking');
      expect(note.message).toContain(confirmed.reference);

      const ticket = await user
        .get(`/api/flight-bookings/${held.bookingId}/e-ticket`)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(ticket.headers['content-type']).toBe('application/pdf');
      expect(ticket.headers['content-disposition']).toBe(
        `attachment; filename="${confirmed.reference}.pdf"`,
      );
      const pdf = ticket.body as Buffer;
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      const text = await pdfText(pdf);
      expect(text).toContain(confirmed.reference);
      expect(text).toContain('Journey Traveller 1');
      expect(text).toContain(flight.flightNumber);
      // GEN-06: each time is shown in its own airport's zone, not in UTC.
      expect(text).toContain(clockIn(flight.departureAt, 'Africa/Cairo'));
      expect(text).toContain('Africa/Cairo');
      expect(text).toContain(clockIn(flight.arrivalAt, 'Asia/Dubai'));
      expect(text).toContain('Asia/Dubai');

      const upcoming = await mine(user, 'upcoming');
      expect(upcoming.map((b) => b._id)).toEqual([held.bookingId]);
      expect(upcoming[0]).toMatchObject({
        reference: confirmed.reference,
        status: 'confirmed',
      });
      expect(await mine(user, 'past')).toEqual([]);
      expect(await mine(user, 'cancelled')).toEqual([]);
    });

    it('books, confirms and cancels both segments of a round trip together (FLT-12)', async () => {
      const user = await app.newUser();
      const res = await user
        .get('/api/flights/search')
        .query({
          from: 'CAI',
          to: 'LHR',
          date: dateIn(5),
          returnDate: dateIn(7),
          adults: PASSENGERS,
        })
        .expect(200);
      const result = body<{
        outbound: PageBody<SearchItemBody>;
        inbound: PageBody<SearchItemBody>;
      }>(res);
      expect(result.outbound.total).toBeGreaterThan(0);
      expect(result.inbound.total).toBeGreaterThan(0);
      const pick = (items: SearchItemBody[]) => {
        const cabin = items[0].matchingCabins.find(
          (c) => c.cabinClass === 'economy',
        );
        if (!cabin) throw new Error('the search found no economy cabin');
        return { flight: items[0].flight, cabin };
      };
      const out = pick(result.outbound.items);
      const back = pick(result.inbound.items);
      expect(out.flight.departureLocalDate).toBe(dateIn(5));
      expect(back.flight.departureLocalDate).toBe(dateIn(7));
      const segments = [
        { flightId: out.flight._id, cabinId: out.cabin._id },
        { flightId: back.flight._id, cabinId: back.cabin._id },
      ];

      const { held, session } = await holdAcceptPay(user, segments);
      const total = PASSENGERS * (out.cabin.priceMinor + back.cabin.priceMinor);
      expect(held.pricing.totalMinor).toBe(total);
      expect(held.segments.map((s) => s.direction)).toEqual([
        'outbound',
        'return',
      ]);
      for (const leg of [out, back]) {
        expect(
          await cabinOf(user, leg.flight._id, leg.cabin._id),
        ).toMatchObject({
          availableSeats: leg.cabin.availableSeats - PASSENGERS,
          heldSeats: leg.cabin.heldSeats + PASSENGERS,
        });
      }

      await app.webhook.paymentSucceeded(intentOf(session)).expect(200);
      const confirmed = await waitForStatus(user, held.bookingId, 'confirmed');
      expect(confirmed.tripType).toBe('round_trip');
      expect(confirmed.segments.map((s) => s.direction)).toEqual([
        'outbound',
        'return',
      ]);
      for (const leg of [out, back]) {
        expect(
          await cabinOf(user, leg.flight._id, leg.cabin._id),
        ).toMatchObject({
          heldSeats: leg.cabin.heldSeats,
          bookedSeats: leg.cabin.bookedSeats + PASSENGERS,
        });
      }

      // The whole trip is refunded by the outbound flight's tiers (FLT-12).
      const preview = await user
        .get(`/api/flight-bookings/${held.bookingId}/refund-preview`)
        .expect(200);
      const previewed = body<{ percent: number; amountMinor: number }>(preview);
      expect(previewed.percent).toBe(10);
      expect(previewed.amountMinor).toBe(Math.round(total * 0.1));

      const cancel = await user
        .post(`/api/flight-bookings/${held.bookingId}/cancel`)
        .send({})
        .expect(200);
      const cancelled = body<{
        status: string;
        refund: RefundBody | null;
      }>(cancel);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.refund).toMatchObject({
        amountMinor: previewed.amountMinor,
        status: 'pending',
        reason: 'user_cancellation',
      });
      for (const leg of [out, back]) {
        expect(
          await cabinOf(user, leg.flight._id, leg.cabin._id),
        ).toMatchObject({
          availableSeats: leg.cabin.availableSeats,
          heldSeats: leg.cabin.heldSeats,
          bookedSeats: leg.cabin.bookedSeats,
        });
      }
      expect((await booking(user, held.bookingId)).status).toBe('cancelled');
      expect((await mine(user, 'cancelled')).map((b) => b._id)).toEqual([
        held.bookingId,
      ]);
    });

    it('keeps the booking pending after a failed payment and confirms it once after the retry (PAY-01)', async () => {
      const user = await app.newUser();
      const { flight, cabin } = await economyFlight(user, 'RUH', 'CAI', 6);
      const { held, session } = await holdAcceptPay(user, [
        { flightId: flight._id, cabinId: cabin._id },
      ]);

      await app.webhook.paymentFailed(intentOf(session)).expect(200);
      const failed = await user
        .get(`/api/payments/${session.paymentId}`)
        .expect(200);
      expect(body<{ status: string }>(failed).status).toBe('failed');
      expect((await booking(user, held.bookingId)).status).toBe(
        'pending_payment',
      );
      expect(await cabinOf(user, flight._id, cabin._id)).toMatchObject({
        heldSeats: cabin.heldSeats + PASSENGERS,
      });

      const retry = await user
        .post(`/api/payments/${session.paymentId}/retry`)
        .expect(200);
      const again = body<PaymentSessionBody>(retry);
      expect(again.paymentId).toBe(session.paymentId);
      expect(again.clientSecret).toBe(session.clientSecret);
      const pending = await user
        .get(`/api/payments/${session.paymentId}`)
        .expect(200);
      expect(body<{ status: string }>(pending).status).toBe('pending');

      await app.webhook.paymentSucceeded(intentOf(again)).expect(200);
      const confirmed = await waitForStatus(user, held.bookingId, 'confirmed');
      expect(confirmed.reference).toBeDefined();

      // Stripe delivers the success again: nothing changes.
      await app.webhook.paymentSucceeded(intentOf(again)).expect(200);
      await waitForNotification(user, 'booking_confirmed', held.bookingId);
      const after = await booking(user, held.bookingId);
      expect(after).toMatchObject({
        status: 'confirmed',
        reference: confirmed.reference,
      });
      expect(await cabinOf(user, flight._id, cabin._id)).toMatchObject({
        heldSeats: cabin.heldSeats,
        bookedSeats: cabin.bookedSeats + PASSENGERS,
      });
      const confirmations = (await notifications(user)).filter(
        (n) => n.type === 'booking_confirmed',
      );
      expect(confirmations).toHaveLength(1);
      expect((await mine(user, 'upcoming')).map((b) => b._id)).toEqual([
        held.bookingId,
      ]);
    });

    it('expires an unpaid hold, releases the seats and cancels the PaymentIntent (FLT-22, GEN-11)', async () => {
      const user = await app.newUser();
      const { flight, cabin } = await economyFlight(user, 'CAI', 'RUH', 8);
      const { held, session } = await holdAcceptPay(user, [
        { flightId: flight._id, cabinId: cabin._id },
      ]);
      expect(await cabinOf(user, flight._id, cabin._id)).toMatchObject({
        heldSeats: cabin.heldSeats + PASSENGERS,
      });

      const expired = await app.jobs.expireFlightHolds(
        new Date(new Date(held.holdExpiresAt).getTime() + 1000),
      );
      expect(expired).toBe(1);

      const after = await booking(user, held.bookingId);
      expect(after.status).toBe('expired');
      expect(after.reference).toBeUndefined();
      expect(await cabinOf(user, flight._id, cabin._id)).toMatchObject({
        availableSeats: cabin.availableSeats,
        heldSeats: cabin.heldSeats,
        bookedSeats: cabin.bookedSeats,
      });
      await expect
        .poll(
          () =>
            app.gateway.calls.filter(
              (call) =>
                call.method === 'cancelPaymentIntent' &&
                call.input === intentOf(session),
            ).length,
          EVENTS,
        )
        .toBe(1);
      await expect
        .poll(async () => {
          const res = await user
            .get(`/api/payments/${session.paymentId}`)
            .expect(200);
          return body<{ status: string }>(res).status;
        }, EVENTS)
        .toBe('canceled');

      const late = await user
        .post('/api/payments')
        .send({ bookingType: 'flight', bookingId: held.bookingId })
        .expect(409);
      expect(body<{ code: string }>(late).code).toBe(ErrorCode.HoldExpired);
      expect(await mine(user, 'upcoming')).toEqual([]);
    });

    it('refunds in full a payment that arrives after the hold expired (late payment)', async () => {
      const user = await app.newUser();
      const { flight, cabin } = await economyFlight(user, 'DXB', 'CAI', 10);
      const { held, session } = await holdAcceptPay(user, [
        { flightId: flight._id, cabinId: cabin._id },
      ]);
      await app.jobs.expireFlightHolds(
        new Date(new Date(held.holdExpiresAt).getTime() + 1000),
      );
      expect((await booking(user, held.bookingId)).status).toBe('expired');

      await app.webhook.paymentSucceeded(intentOf(session)).expect(200);

      const refund = await waitForRefund(user, held.bookingId);
      const note = await waitForNotification(
        user,
        'refund_updated',
        refund.refundId,
      );
      expect(note.entity?.type).toBe('refund');
      expect(refund).toMatchObject({
        bookingId: held.bookingId,
        amountMinor: held.pricing.totalMinor,
        currency: 'USD',
        reason: 'late_payment',
        status: 'pending',
      });
      expect(
        app.gateway.calls.filter((call) => call.method === 'createRefund'),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            input: expect.objectContaining({
              amountMinor: held.pricing.totalMinor,
            }),
          }),
        ]),
      );

      const after = await booking(user, held.bookingId);
      expect(after.status).toBe('expired');
      expect(after.reference).toBeUndefined();
      expect(await cabinOf(user, flight._id, cabin._id)).toMatchObject({
        availableSeats: cabin.availableSeats,
        heldSeats: cabin.heldSeats,
        bookedSeats: cabin.bookedSeats,
      });
      expect(
        (await notifications(user)).filter(
          (n) => n.type === 'booking_confirmed',
        ),
      ).toEqual([]);
    });

    /** The booking's refund as its owner reads it, once the listener created it. */
    async function waitForRefund(
      user: Actor,
      bookingId: string,
    ): Promise<RefundBody> {
      const refunds = app.t.connection.collection<{ _id: Types.ObjectId }>(
        'refunds',
      );
      const filter = { bookingId: new Types.ObjectId(bookingId) };
      await expect.poll(() => refunds.countDocuments(filter), EVENTS).toBe(1);
      const doc = await refunds.findOne(filter);
      if (!doc) throw new Error('the refund disappeared');
      const res = await user
        .get(`/api/refunds/${doc._id.toHexString()}`)
        .expect(200);
      return body<RefundBody>(res);
    }

    it('refuses 2 seats when 1 is left and holds nothing (FLT-22)', async () => {
      const moderator = await app.as(DEMO_ACCOUNTS.nileAirModerator);
      const day = 12;
      const created = await moderator
        .post('/api/flights')
        .send({
          flightNumber: 'NA 991',
          departureAirportId: 'CAI',
          arrivalAirportId: 'DXB',
          departureLocal: `${dateIn(day)}T10:00`,
          arrivalLocal: `${dateIn(day)}T14:00`,
        })
        .expect(201);
      const flightId = body<FlightBody>(created)._id;
      const withCabin = await moderator
        .post(`/api/flights/${flightId}/cabins`)
        .send({
          cabinClass: 'economy',
          totalSeats: 1,
          priceMinor: 15_000,
          freeBags: 1,
          maxBagWeightKg: 23,
        })
        .expect(201);
      const cabin = body<FlightBody>(withCabin).cabins[0];
      expect(cabin.availableSeats).toBe(1);
      const segments = [{ flightId, cabinId: cabin._id }];

      const user = await app.newUser();
      const quote = await user
        .post('/api/flight-bookings')
        .send(bookingRequest(segments))
        .expect(409);
      expect(body<{ code: string }>(quote).code).toBe(
        ErrorCode.SeatsUnavailable,
      );
      const refused = await user
        .post('/api/flight-bookings/hold')
        .send(bookingRequest(segments))
        .expect(409);
      expect(body<{ code: string }>(refused).code).toBe(
        ErrorCode.SeatsUnavailable,
      );
      expect(await cabinOf(user, flightId, cabin._id)).toMatchObject({
        availableSeats: 1,
        heldSeats: 0,
        bookedSeats: 0,
      });
      for (const group of ['upcoming', 'past', 'cancelled']) {
        expect(await mine(user, group)).toEqual([]);
      }

      // Nothing was held, so the last seat is still free for one passenger.
      const single = await user
        .post('/api/flight-bookings/hold')
        .send(bookingRequest(segments, passengers(1)))
        .expect(201);
      const held = body<HoldBody>(single);
      expect(await cabinOf(user, flightId, cabin._id)).toMatchObject({
        availableSeats: 0,
        heldSeats: 1,
      });
      expect(
        await app.jobs.expireFlightHolds(
          new Date(new Date(held.holdExpiresAt).getTime() + 1000),
        ),
      ).toBe(1);
      expect(await cabinOf(user, flightId, cabin._id)).toMatchObject({
        availableSeats: 1,
        heldSeats: 0,
      });
    });

    it('cancels a confirmed booking with the tier refund, returns the seats and follows the refund (FLT-26, PAY-03, GEN-01)', async () => {
      const user = await app.newUser();
      const { flight, cabin } = await economyFlight(user, 'CAI', 'DXB', 9);
      const segments = [{ flightId: flight._id, cabinId: cabin._id }];
      const { held, session } = await holdAcceptPay(user, segments);
      await app.webhook.paymentSucceeded(intentOf(session)).expect(200);
      const confirmed = await waitForStatus(user, held.bookingId, 'confirmed');
      expect(await cabinOf(user, flight._id, cabin._id)).toMatchObject({
        bookedSeats: cabin.bookedSeats + PASSENGERS,
      });

      // 9 days out falls in the 7-day tier: 50%.
      const total = held.pricing.totalMinor;
      const preview = await user
        .get(`/api/flight-bookings/${held.bookingId}/refund-preview`)
        .expect(200);
      expect(body<unknown>(preview)).toEqual({
        percent: 50,
        amountMinor: Math.round(total / 2),
        currency: 'USD',
      });

      const cancel = await user
        .post(`/api/flight-bookings/${held.bookingId}/cancel`)
        .send({})
        .expect(200);
      const cancelled = body<{
        status: string;
        reference: string;
        cancellation: BookingBody['cancellation'];
        refund: RefundBody | null;
      }>(cancel);
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        reference: confirmed.reference,
        cancellation: {
          cancelledBy: 'user',
          refundPercent: 50,
          refundAmountMinor: Math.round(total / 2),
        },
        refund: {
          bookingId: held.bookingId,
          amountMinor: Math.round(total / 2),
          currency: 'USD',
          reason: 'user_cancellation',
          status: 'pending',
        },
      });
      expect(await cabinOf(user, flight._id, cabin._id)).toMatchObject({
        availableSeats: cabin.availableSeats,
        heldSeats: cabin.heldSeats,
        bookedSeats: cabin.bookedSeats,
      });
      const stored = await booking(user, held.bookingId);
      expect(stored.status).toBe('cancelled');
      expect(stored.cancellation?.refundAmountMinor).toBe(
        Math.round(total / 2),
      );

      const again = await user
        .post(`/api/flight-bookings/${held.bookingId}/cancel`)
        .send({})
        .expect(409);
      expect(body<{ code: string }>(again).code).toBe(
        ErrorCode.InvalidStatusTransition,
      );

      const refundId = cancelled.refund?.refundId;
      if (!refundId) throw new Error('the cancellation created no refund');
      const stripeRefundId = await stripeRefundIdOf(refundId);
      await app.webhook
        .refund(stripeRefundId, 'succeeded', refundId)
        .expect(200);
      await expect
        .poll(async () => {
          const res = await user.get(`/api/refunds/${refundId}`).expect(200);
          return body<RefundBody>(res).status;
        }, EVENTS)
        .toBe('refunded');

      const note = await waitForNotification(
        user,
        'booking_cancelled',
        held.bookingId,
      );
      expect(note.message).toContain(confirmed.reference);
      await expect
        .poll(
          async () =>
            (await notifications(user)).filter(
              (n) => n.type === 'refund_updated',
            ).length,
          EVENTS,
        )
        .toBe(2);
      expect((await notifications(user)).map((n) => n.message)).toEqual(
        expect.arrayContaining([
          'Your refund is being processed.',
          'Your refund is complete.',
        ]),
      );
      expect((await mine(user, 'cancelled')).map((b) => b._id)).toEqual([
        held.bookingId,
      ]);
      expect(await mine(user, 'upcoming')).toEqual([]);
    });

    it('does not cancel a booking once its flight has departed (FLT-26, GEN-11)', async () => {
      const user = await app.newUser();
      const { flight, cabin } = await economyFlight(user, 'CAI', 'DXB', 1);
      const { held, session } = await holdAcceptPay(user, [
        { flightId: flight._id, cabinId: cabin._id },
      ]);
      await app.webhook.paymentSucceeded(intentOf(session)).expect(200);
      await waitForStatus(user, held.bookingId, 'confirmed');

      // The jobs take an explicit clock: one hour after the departure.
      const afterDeparture = new Date(
        new Date(flight.departureAt).getTime() + 3_600_000,
      );
      expect(
        await app.jobs.markFlightsDeparted(afterDeparture),
      ).toBeGreaterThan(0);
      expect(await app.jobs.completeFlights(afterDeparture)).toBe(1);

      const completed = await booking(user, held.bookingId);
      expect(completed.status).toBe('completed');
      expect(
        (await user.get(`/api/flights/${flight._id}`).expect(200)).body,
      ).toMatchObject({ status: 'departed' });
      expect((await mine(user, 'past')).map((b) => b._id)).toEqual([
        held.bookingId,
      ]);
      expect(await mine(user, 'upcoming')).toEqual([]);

      const cancel = await user
        .post(`/api/flight-bookings/${held.bookingId}/cancel`)
        .send({})
        .expect(409);
      expect(body<{ code: string }>(cancel).code).toBe(
        ErrorCode.InvalidStatusTransition,
      );
      const preview = await user
        .get(`/api/flight-bookings/${held.bookingId}/refund-preview`)
        .expect(409);
      expect(body<{ code: string }>(preview).code).toBe(
        ErrorCode.InvalidStatusTransition,
      );
      expect((await booking(user, held.bookingId)).status).toBe('completed');
      expect(
        (await notifications(user)).filter(
          (n) => n.type === 'booking_cancelled',
        ),
      ).toEqual([]);
    });
  },
);
