import { Types } from 'mongoose';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import {
  createFullApp,
  DEMO_ACCOUNTS,
  JOURNEY_TIMEOUT,
} from '../support/full-app.js';
import type { Actor, FullApp } from '../support/full-app.js';
import { HOOK_TIMEOUT } from '../support/mongo-memory.js';

/** The booking modules react to events after the HTTP answer, so state is awaited, not slept on. */
const SETTLE = { timeout: 15_000 };
const DAY_MS = 86_400_000;

interface FlightRef {
  id: string;
  cabinId: string;
}

interface BookingView {
  _id: string;
  reference?: string;
  status: string;
  pricing: { totalMinor: number; currency: string };
  cancellation?: {
    cancelledBy: string;
    refundPercent: number;
    refundAmountMinor: number;
  };
}

interface NotificationItem {
  type: string;
  entity?: { type: string; id: string };
}

interface CabinCounters {
  cabinClass: string;
  totalSeats: number;
  availableSeats: number;
  heldSeats: number;
  bookedSeats: number;
}

interface FlightDetails {
  status: string;
  cabins: CabinCounters[];
}

const PASSENGERS = {
  adult: {
    type: 'adult',
    fullName: 'Provider Cancel Adult',
    dateOfBirth: '1990-01-01',
    documentNumber: 'A12345678',
    extraBagCount: 0,
  },
  child: {
    type: 'child',
    fullName: 'Provider Cancel Child',
    dateOfBirth: '2018-01-01',
    documentNumber: 'C12345678',
    extraBagCount: 0,
  },
};

function utcDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

describe(
  'Provider flight cancellation, whole app (FLT-06)',
  { timeout: JOURNEY_TIMEOUT },
  () => {
    let app: FullApp;
    let airline: Actor;
    let otherAirline: Actor;

    beforeAll(async () => {
      app = await createFullApp();
      airline = await app.as(DEMO_ACCOUNTS.nileAirModerator);
      otherAirline = await app.as(DEMO_ACCOUNTS.gulfWingsModerator);
    }, HOOK_TIMEOUT);
    afterAll(() => app.t.close(), HOOK_TIMEOUT);

    /** A fresh flight of the airline with one economy cabin of 20 seats. */
    async function createFlight(
      flightNumber: string,
      from: string,
      to: string,
      day: string,
    ): Promise<FlightRef> {
      const created = await airline
        .post('/api/flights')
        .send({
          flightNumber,
          departureAirportId: from,
          arrivalAirportId: to,
          departureLocal: `${day}T08:30`,
          arrivalLocal: `${day}T23:00`,
        })
        .expect(201);
      const id = (created.body as { _id: string })._id;
      const withCabin = await airline
        .post(`/api/flights/${id}/cabins`)
        .send({
          cabinClass: 'economy',
          totalSeats: 20,
          priceMinor: 20_000,
          freeBags: 1,
          maxBagWeightKg: 23,
        })
        .expect(201);
      const cabins = (withCabin.body as { cabins: { _id: string }[] }).cabins;
      expect(cabins).toHaveLength(1);
      return { id, cabinId: cabins[0]!._id };
    }

    async function holdSeats(
      user: Actor,
      segments: FlightRef[],
      passengers: object[],
    ): Promise<{ bookingId: string; totalMinor: number }> {
      const hold = await user
        .post('/api/flight-bookings/hold')
        .send({
          tripType: segments.length === 2 ? 'round_trip' : 'one_way',
          segments: segments.map(({ id, cabinId }) => ({
            flightId: id,
            cabinId,
          })),
          passengers,
        })
        .expect(201);
      const body = hold.body as {
        bookingId: string;
        status: string;
        pricing: { totalMinor: number };
      };
      expect(body.status).toBe('pending_payment');
      return { bookingId: body.bookingId, totalMinor: body.pricing.totalMinor };
    }

    /** Accepts the policies and opens the payment; returns the PaymentIntent id and the payment id. */
    async function startPayment(
      user: Actor,
      bookingId: string,
    ): Promise<{ paymentId: string; paymentIntentId: string }> {
      await user
        .post(`/api/bookings/flight/${bookingId}/accept-policies`)
        .send({ accepted: true })
        .expect(200);
      const payment = await user
        .post('/api/payments')
        .send({ bookingType: 'flight', bookingId })
        .expect(201);
      const body = payment.body as { paymentId: string; clientSecret: string };
      return {
        paymentId: body.paymentId,
        paymentIntentId: body.clientSecret.replace(/_secret$/, ''),
      };
    }

    async function bookingOf(user: Actor, id: string): Promise<BookingView> {
      const res = await user.get(`/api/flight-bookings/${id}`).expect(200);
      return res.body as BookingView;
    }

    /** The whole real flow: hold, accept policies, pay, signed webhook, confirmed. */
    async function confirmedBooking(
      user: Actor,
      segments: FlightRef[],
      passengers: object[],
    ): Promise<{ bookingId: string; totalMinor: number }> {
      const hold = await holdSeats(user, segments, passengers);
      const { paymentIntentId } = await startPayment(user, hold.bookingId);
      await app.webhook.paymentSucceeded(paymentIntentId).expect(200);
      await vi.waitFor(async () => {
        const booking = await bookingOf(user, hold.bookingId);
        expect(booking.status).toBe('confirmed');
        expect(booking.reference).toMatch(/^FB[A-Z0-9]{6}$/);
      }, SETTLE);
      return hold;
    }

    async function flightDetails(id: string): Promise<FlightDetails> {
      const res = await app.t.http().get(`/api/flights/${id}`).expect(200);
      return res.body as FlightDetails;
    }

    async function searchIds(
      from: string,
      to: string,
      day: string,
    ): Promise<string[]> {
      const res = await app.t
        .http()
        .get(`/api/flights/search?from=${from}&to=${to}&date=${day}&limit=50`)
        .expect(200);
      return (res.body as { items: { flight: { _id: string } }[] }).items.map(
        (item) => item.flight._id,
      );
    }

    async function notificationsOf(user: Actor): Promise<NotificationItem[]> {
      const res = await user.get('/api/notifications?limit=50').expect(200);
      return (res.body as { items: NotificationItem[] }).items;
    }

    function cancelledNotices(
      items: NotificationItem[],
      bookingId: string,
    ): NotificationItem[] {
      return items.filter(
        (item) =>
          item.type === 'booking_cancelled' && item.entity?.id === bookingId,
      );
    }

    it('cancels a flight with a confirmed booking, a confirmed round trip and a pending hold', async () => {
      const outDay = utcDay(21);
      const backDay = utcDay(23);
      const outbound = await createFlight('NA 901', 'CAI', 'DXB', outDay);
      const inbound = await createFlight('NA 902', 'DXB', 'CAI', backDay);
      expect(await searchIds('CAI', 'DXB', outDay)).toContain(outbound.id);

      const [one, round, pending] = await Promise.all([
        app.newUser('One Way'),
        app.newUser('Round Trip'),
        app.newUser('Pending Hold'),
      ]);
      const oneWay = await confirmedBooking(
        one,
        [outbound],
        [PASSENGERS.adult],
      );
      const roundTrip = await confirmedBooking(
        round,
        [outbound, inbound],
        [PASSENGERS.adult, PASSENGERS.child],
      );
      const hold = await holdSeats(pending, [outbound], [PASSENGERS.adult]);
      const unpaid = await startPayment(pending, hold.bookingId);

      expect(oneWay.totalMinor).toBe(20_000);
      expect(roundTrip.totalMinor).toBe(2 * 2 * 20_000);
      const before = await flightDetails(outbound.id);
      expect(before.cabins[0]).toMatchObject({
        availableSeats: 20 - 1 - 2 - 1,
        heldSeats: 1,
        bookedSeats: 3,
      });
      expect((await flightDetails(inbound.id)).cabins[0]).toMatchObject({
        availableSeats: 18,
        bookedSeats: 2,
      });
      await app.expectInvariants();

      await airline.post(`/api/flights/${outbound.id}/cancel`).expect(204);

      await vi.waitFor(async () => {
        const first = await bookingOf(one, oneWay.bookingId);
        const second = await bookingOf(round, roundTrip.bookingId);
        const third = await bookingOf(pending, hold.bookingId);
        expect([first.status, second.status, third.status]).toEqual([
          'cancelled',
          'cancelled',
          'expired',
        ]);
        // The cancellation notice follows the refund request, so both exist.
        expect(
          cancelledNotices(await notificationsOf(one), oneWay.bookingId),
        ).toHaveLength(1);
        expect(
          cancelledNotices(await notificationsOf(round), roundTrip.bookingId),
        ).toHaveLength(1);
      }, SETTLE);

      for (const [user, booking] of [
        [one, oneWay],
        [round, roundTrip],
      ] as const) {
        const view = await bookingOf(user, booking.bookingId);
        expect(view.cancellation).toMatchObject({
          cancelledBy: 'provider',
          refundPercent: 100,
          refundAmountMinor: booking.totalMinor,
        });
      }
      const expired = await bookingOf(pending, hold.bookingId);
      expect(expired.status).toBe('expired');
      expect(expired.cancellation).toBeUndefined();

      // PAY-03: a 100% refund per cancelled booking, none for the unpaid hold.
      const refunds = app.t.connection.collection('refunds');
      const refundOf = (bookingId: string) =>
        refunds.findOne({ bookingId: new Types.ObjectId(bookingId) });
      expect(await refundOf(hold.bookingId)).toBeNull();
      for (const [user, booking] of [
        [one, oneWay],
        [round, roundTrip],
      ] as const) {
        const refund = await refundOf(booking.bookingId);
        expect(refund).toMatchObject({
          bookingType: 'flight',
          amountMinor: booking.totalMinor,
          currency: 'USD',
          reason: 'provider_cancellation',
          status: 'pending',
        });
        const refundId = String(refund?._id);
        const stripeRefundId = String(refund?.stripeRefundId);
        await app.webhook
          .refund(stripeRefundId, 'succeeded', refundId)
          .expect(200);
        const done = await user.get(`/api/refunds/${refundId}`).expect(200);
        expect(done.body).toMatchObject({
          refundId,
          amountMinor: booking.totalMinor,
          status: 'refunded',
        });
      }
      await vi.waitFor(async () => {
        for (const user of [one, round]) {
          const types = (await notificationsOf(user)).map((item) => item.type);
          expect(types).toContain('refund_updated');
        }
      }, SETTLE);

      // The unpaid hold's payment is closed by its expiry.
      await vi.waitFor(async () => {
        const payment = await pending
          .get(`/api/payments/${unpaid.paymentId}`)
          .expect(200);
        expect(payment.body).toMatchObject({ status: 'canceled' });
      }, SETTLE);

      // Every seat is back: the round trip's return leg too.
      for (const ref of [outbound, inbound]) {
        const after = await flightDetails(ref.id);
        expect(after.cabins[0]).toMatchObject({
          availableSeats: 20,
          heldSeats: 0,
          bookedSeats: 0,
        });
      }
      expect((await flightDetails(outbound.id)).status).toBe('cancelled');
      expect((await flightDetails(inbound.id)).status).toBe('scheduled');
      await app.expectInvariants();

      // The cancelled flight is hidden from search; the other one is not.
      expect(await searchIds('CAI', 'DXB', outDay)).not.toContain(outbound.id);
      expect(await searchIds('DXB', 'CAI', backDay)).toContain(inbound.id);

      // FLT-29: the moderator sees both bookings as cancelled, nothing confirmed.
      const listed = await airline
        .get(`/api/flights/${outbound.id}/bookings`)
        .expect(200);
      const items = (listed.body as { items: { status: string }[] }).items;
      expect(items.map((item) => item.status)).toEqual([
        'cancelled',
        'cancelled',
      ]);

      // The cancelled bookings are listed as such for their owners and can't be cancelled again.
      const mine = await one.get('/api/flight-bookings?group=cancelled');
      expect(mine.status).toBe(200);
      expect(
        (mine.body as { items: { _id: string }[] }).items.map(
          (item) => item._id,
        ),
      ).toEqual([oneWay.bookingId]);
      const again = await one
        .post(`/api/flight-bookings/${oneWay.bookingId}/cancel`)
        .send({})
        .expect(409);
      expect(again.body.code).toBe(ErrorCode.InvalidStatusTransition);
    });

    it('only the owning airline moderator can cancel, once, and nobody can book the cancelled flight', async () => {
      const day = utcDay(25);
      const flight = await createFlight('NA 903', 'CAI', 'DXB', day);
      const user = await app.newUser('Guard Rails');
      const booking = await confirmedBooking(
        user,
        [flight],
        [PASSENGERS.adult],
      );

      const foreign = await otherAirline
        .post(`/api/flights/${flight.id}/cancel`)
        .expect(404);
      expect(foreign.body.code).toBe(ErrorCode.NotFound);
      const wrongRole = await user
        .post(`/api/flights/${flight.id}/cancel`)
        .expect(403);
      expect(wrongRole.body.code).toBe(ErrorCode.ForbiddenRole);
      const anonymous = await app.t
        .http()
        .post(`/api/flights/${flight.id}/cancel`)
        .expect(401);
      expect(anonymous.body.code).toBe(ErrorCode.NotAuthenticated);
      expect((await flightDetails(flight.id)).status).toBe('scheduled');
      expect((await bookingOf(user, booking.bookingId)).status).toBe(
        'confirmed',
      );

      await airline.post(`/api/flights/${flight.id}/cancel`).expect(204);
      const repeated = await airline
        .post(`/api/flights/${flight.id}/cancel`)
        .expect(409);
      expect(repeated.body.code).toBe(ErrorCode.InvalidStatusTransition);
      await vi.waitFor(async () => {
        expect((await bookingOf(user, booking.bookingId)).status).toBe(
          'cancelled',
        );
      }, SETTLE);

      const late = await app.newUser('Too Late');
      const rejected = await late
        .post('/api/flight-bookings/hold')
        .send({
          tripType: 'one_way',
          segments: [{ flightId: flight.id, cabinId: flight.cabinId }],
          passengers: [PASSENGERS.adult],
        })
        .expect(400);
      expect(rejected.body.code).toBe(ErrorCode.ValidationFailed);
      expect((await flightDetails(flight.id)).cabins[0]).toMatchObject({
        availableSeats: 20,
        heldSeats: 0,
        bookedSeats: 0,
      });
      await app.expectInvariants();
    });
  },
);
