import { Types } from 'mongoose';
import { vi } from 'vitest';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import { createFullApp, JOURNEY_TIMEOUT } from '../support/full-app.js';
import type { Actor, FullApp } from '../support/full-app.js';
import { HOOK_TIMEOUT } from '../support/mongo-memory.js';

interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface TierBody {
  daysBefore: number;
  refundPercent: number;
}

interface HotelBody {
  _id: string;
  name: string;
  pricePerNightMinor?: number;
  checkInTime: string;
  checkOutTime: string;
  cancellationPolicy: { tiers: TierBody[] };
  ratingSummary: { average: number | null; count: number };
}

interface AvailableRoomBody {
  _id: string;
  name: string;
  pricePerNightMinor: number;
  totalMinor: number;
}

interface HoldBody {
  reservationId: string;
  status: string;
  hotelId: string;
  nights: number;
  rooms: { roomId: string; subtotalMinor: number }[];
  totalMinor: number;
  currency: string;
  policy: { cancellationTiers: TierBody[] };
  holdExpiresAt: string;
}

interface ReservationBody {
  _id: string;
  reference?: string;
  status: string;
  nights: number;
  totalMinor: number;
  confirmedAt?: string;
  expiredAt?: string;
  completedAt?: string;
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

interface PaymentBody {
  status: string;
  amountMinor: number;
  bookingType: string;
  bookingId: string;
}

interface RefundBody {
  refundId: string;
  bookingType: string;
  bookingId: string;
  amountMinor: number;
  reason: string;
  status: string;
}

interface NotificationBody {
  type: string;
  message: string;
  entity?: { type: string; id: string };
}

interface ReviewBody {
  _id: string;
  rating: number;
  text?: string;
  isHidden: boolean;
}

interface Hold {
  hold: HoldBody;
  rooms: Map<string, AvailableRoomBody>;
}

const DAY_MS = 86_400_000;
const HOLD_MS = 10 * 60 * 1000;
const WAIT = { timeout: 5_000 };

function body<T>(res: { body: unknown }): T {
  return res.body as T;
}

/** A UTC calendar date `days` from today, as the API takes it (`YYYY-MM-DD`). */
function ymd(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

/** The API stores room names in lower case; the test names them as the demo plan does. */
function titleCase(name: string): string {
  return name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function startOf(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** One second after the hold ends: the instant the expiry job must run at. */
function justAfter(holdExpiresAt: string): Date {
  return new Date(new Date(holdExpiresAt).getTime() + 1_000);
}

describe(
  'Hotel booking journey: search, hold, pay, cancel, complete, review (HTL, PAY, GEN-11)',
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

    async function hotelIn(
      cityId: string,
      checkIn: string,
      checkOut: string,
    ): Promise<HotelBody> {
      const res = await app.t
        .http()
        .get('/api/hotels/search')
        .query({ cityId, checkIn, checkOut, guests: 2 })
        .expect(200);
      const [hotel] = body<Page<HotelBody>>(res).items;
      if (!hotel) throw new Error(`No hotel found in ${cityId}`);
      return hotel;
    }

    async function freeRooms(
      hotelId: string,
      checkIn: string,
      checkOut: string,
    ): Promise<Map<string, AvailableRoomBody>> {
      const res = await app.t
        .http()
        .get(`/api/hotels/${hotelId}/rooms/available`)
        .query({ checkIn, checkOut })
        .expect(200);
      return new Map(
        body<Page<AvailableRoomBody>>(res).items.map((room) => [
          titleCase(room.name),
          room,
        ]),
      );
    }

    function holdRequest(
      user: Actor,
      hotelId: string,
      checkIn: string,
      checkOut: string,
      rooms: AvailableRoomBody[],
    ) {
      return user.post('/api/hotel-bookings').send({
        hotelId,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        rooms: rooms.map((room) => ({
          roomId: room._id,
          adults: 2,
          childAges: [],
        })),
      });
    }

    async function hold(
      user: Actor,
      hotelId: string,
      checkIn: string,
      checkOut: string,
      roomNames: string[],
    ): Promise<Hold> {
      const rooms = await freeRooms(hotelId, checkIn, checkOut);
      const chosen = roomNames.map((name) => {
        const room = rooms.get(name);
        if (!room) throw new Error(`${name} is not free`);
        return room;
      });
      const res = await holdRequest(
        user,
        hotelId,
        checkIn,
        checkOut,
        chosen,
      ).expect(201);
      return { hold: body<HoldBody>(res), rooms };
    }

    async function accept(user: Actor, reservationId: string): Promise<void> {
      await user
        .post(`/api/bookings/hotel/${reservationId}/accept-policies`)
        .send({ accepted: true })
        .expect(200);
    }

    function startPayment(user: Actor, reservationId: string) {
      return user
        .post('/api/payments')
        .send({ bookingType: 'hotel', bookingId: reservationId });
    }

    /** Holds, accepts the policies and starts the payment: ready for Stripe. */
    async function holdAndStartPayment(
      user: Actor,
      hotelId: string,
      checkIn: string,
      checkOut: string,
      roomNames: string[],
    ) {
      const held = await hold(user, hotelId, checkIn, checkOut, roomNames);
      await accept(user, held.hold.reservationId);
      const res = await startPayment(user, held.hold.reservationId).expect(201);
      const session = body<PaymentSessionBody>(res);
      return { ...held, session, intentId: await intentIdOf(session) };
    }

    async function intentIdOf(session: PaymentSessionBody): Promise<string> {
      const payment = await app.t.connection
        .collection('payments')
        .findOne({ _id: new Types.ObjectId(session.paymentId) });
      return String(payment?.stripePaymentIntentId);
    }

    async function reservationOf(
      user: Actor,
      reservationId: string,
    ): Promise<ReservationBody> {
      const res = await user
        .get(`/api/hotel-bookings/${reservationId}`)
        .expect(200);
      return body<ReservationBody>(res);
    }

    async function paymentOf(
      user: Actor,
      paymentId: string,
    ): Promise<PaymentBody> {
      const res = await user.get(`/api/payments/${paymentId}`).expect(200);
      return body<PaymentBody>(res);
    }

    async function notificationsOf(user: Actor): Promise<NotificationBody[]> {
      const res = await user
        .get('/api/notifications')
        .query({ limit: 50 })
        .expect(200);
      return body<Page<NotificationBody>>(res).items;
    }

    async function waitForStatus(
      user: Actor,
      reservationId: string,
      status: string,
    ): Promise<ReservationBody> {
      return vi.waitFor(async () => {
        const reservation = await reservationOf(user, reservationId);
        expect(reservation.status).toBe(status);
        return reservation;
      }, WAIT);
    }

    /** Confirmation is the booking module's reaction to the webhook event, so it lands just after the response. */
    async function payAndConfirm(
      user: Actor,
      reservationId: string,
      intentId: string,
    ): Promise<ReservationBody> {
      await app.webhook.paymentSucceeded(intentId).expect(200);
      return waitForStatus(user, reservationId, 'confirmed');
    }

    async function waitForNotification(
      user: Actor,
      type: string,
      entityId: string,
      messagePart = '',
    ): Promise<NotificationBody> {
      return vi.waitFor(async () => {
        const found = (await notificationsOf(user)).find(
          (notification) =>
            notification.type === type &&
            notification.entity?.id === entityId &&
            notification.message.includes(messagePart),
        );
        expect(found, `${type} notification for ${entityId}`).toBeDefined();
        return found as NotificationBody;
      }, WAIT);
    }

    function roomNightsOf(reservationId: string): Promise<number> {
      return app.t.connection
        .collection('room_nights')
        .countDocuments({ reservationId: new Types.ObjectId(reservationId) });
    }

    it('searches, holds two rooms, pays by webhook and confirms with a reference (HTL-11/12/02/15/16/17/18/20, PAY-01/02)', async () => {
      const user = await app.newUser();
      const checkIn = ymd(20);
      const checkOut = ymd(23);

      const search = await app.t
        .http()
        .get('/api/hotels/search')
        .query({ cityId: 'cairo', checkIn, checkOut, guests: 4, rooms: 2 })
        .expect(200);
      const found = body<Page<HotelBody>>(search).items;
      expect(found.map((hotel) => hotel.name)).toEqual(['Nile View Hotel']);
      expect(found[0]?.pricePerNightMinor).toBe(9000);
      const hotelId = found[0]?._id ?? '';

      const tooCheap = await app.t
        .http()
        .get('/api/hotels/search')
        .query({
          cityId: 'cairo',
          checkIn,
          checkOut,
          guests: 4,
          rooms: 2,
          maxPrice: 8999,
        })
        .expect(200);
      expect(body<Page<HotelBody>>(tooCheap).items).toEqual([]);
      const atTheLimit = await app.t
        .http()
        .get('/api/hotels/search')
        .query({
          cityId: 'cairo',
          checkIn,
          checkOut,
          guests: 4,
          rooms: 2,
          minPrice: 9000,
          maxPrice: 9000,
        })
        .expect(200);
      expect(
        body<Page<HotelBody>>(atTheLimit).items.map((hotel) => hotel._id),
      ).toEqual([hotelId]);

      const profile = body<HotelBody>(
        await app.t.http().get(`/api/hotels/${hotelId}`).expect(200),
      );
      expect(profile).toMatchObject({
        name: 'Nile View Hotel',
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationPolicy: {
          tiers: [
            { daysBefore: 14, refundPercent: 100 },
            { daysBefore: 3, refundPercent: 50 },
            { daysBefore: 1, refundPercent: 0 },
          ],
        },
        ratingSummary: { average: null, count: 0 },
      });

      const free = await freeRooms(hotelId, checkIn, checkOut);
      expect([...free.keys()].sort()).toEqual([
        'Deluxe King',
        'Family Room',
        'Standard Double',
        'Suite',
      ]);
      expect(free.get('Standard Double')).toMatchObject({
        pricePerNightMinor: 9000,
        totalMinor: 27000,
      });

      const held = await hold(user, hotelId, checkIn, checkOut, [
        'Standard Double',
        'Deluxe King',
      ]);
      const reservationId = held.hold.reservationId;
      expect(held.hold).toMatchObject({
        status: 'pending_payment',
        hotelId,
        nights: 3,
        totalMinor: 3 * (9000 + 12600),
      });
      expect(held.hold.rooms.map((room) => room.subtotalMinor)).toEqual([
        27000, 37800,
      ]);
      expect(held.hold.policy.cancellationTiers).toEqual(
        profile.cancellationPolicy.tiers,
      );
      const holdLeft = new Date(held.hold.holdExpiresAt).getTime() - Date.now();
      expect(holdLeft).toBeGreaterThan(HOLD_MS - 60_000);
      expect(holdLeft).toBeLessThanOrEqual(HOLD_MS);
      expect(await roomNightsOf(reservationId)).toBe(6);
      expect(
        [...(await freeRooms(hotelId, checkIn, checkOut)).keys()].sort(),
      ).toEqual(['Family Room', 'Suite']);

      const pending = await reservationOf(user, reservationId);
      expect(pending.status).toBe('pending_payment');
      expect(pending.reference).toBeUndefined();

      const policies = await user
        .get(`/api/bookings/hotel/${reservationId}/policies`)
        .expect(200);
      expect(body<object>(policies)).toMatchObject({
        bookingType: 'hotel',
        bookingId: reservationId,
        cancellationTiers: profile.cancellationPolicy.tiers,
        checkInTime: '14:00',
        checkOutTime: '12:00',
        accepted: false,
        acceptedAt: null,
      });
      const unaccepted = await startPayment(user, reservationId).expect(409);
      expect(body<{ code: string }>(unaccepted).code).toBe(
        ErrorCode.PoliciesNotAccepted,
      );
      await accept(user, reservationId);
      const accepted = await user
        .get(`/api/bookings/hotel/${reservationId}/policies`)
        .expect(200);
      expect(body<{ accepted: boolean }>(accepted).accepted).toBe(true);

      const started = await startPayment(user, reservationId).expect(201);
      const session = body<PaymentSessionBody>(started);
      expect(session).toMatchObject({
        amountMinor: held.hold.totalMinor,
        currency: held.hold.currency,
      });
      expect(session.clientSecret).toMatch(/_secret$/);
      expect(await paymentOf(user, session.paymentId)).toMatchObject({
        status: 'pending',
        bookingType: 'hotel',
        bookingId: reservationId,
        amountMinor: held.hold.totalMinor,
      });
      // Starting a payment never confirms: only Stripe's webhook does.
      expect((await reservationOf(user, reservationId)).status).toBe(
        'pending_payment',
      );

      const confirmed = await payAndConfirm(
        user,
        reservationId,
        await intentIdOf(session),
      );
      expect(confirmed.reference).toMatch(/^HR[A-HJ-NP-Z2-9]{6}$/);
      expect(confirmed.confirmedAt).toBeDefined();
      expect((await paymentOf(user, session.paymentId)).status).toBe(
        'succeeded',
      );
      expect(await roomNightsOf(reservationId)).toBe(6);
      expect([
        ...(await freeRooms(hotelId, checkIn, checkOut)).keys(),
      ]).not.toContain('Deluxe King');

      const notification = await waitForNotification(
        user,
        'booking_confirmed',
        reservationId,
      );
      expect(notification.entity?.type).toBe('hotel_reservation');
      expect(notification.message).toContain(confirmed.reference);

      const mine = await user.get('/api/hotel-bookings').expect(200);
      expect(body<Page<ReservationBody>>(mine).items).toEqual([
        expect.objectContaining({
          _id: reservationId,
          status: 'confirmed',
          reference: confirmed.reference,
          totalMinor: held.hold.totalMinor,
        }),
      ]);

      const stranger = await app.newUser();
      const hidden = await stranger
        .get(`/api/hotel-bookings/${reservationId}`)
        .expect(404);
      expect(body<{ code: string }>(hidden).code).toBe(ErrorCode.NotFound);
    });

    it('holds all of the rooms or none of them (HTL-18)', async () => {
      const first = await app.newUser();
      const second = await app.newUser();
      const checkIn = ymd(30);
      const checkOut = ymd(33);
      const hotel = await hotelIn('dubai', checkIn, checkOut);

      const earlier = await hold(first, hotel._id, ymd(31), checkOut, [
        'Deluxe King',
      ]);
      const rooms = await freeRooms(hotel._id, checkIn, checkOut);
      const wanted = [
        rooms.get('Standard Double'),
        earlier.rooms.get('Deluxe King'),
      ].filter((room): room is AvailableRoomBody => room !== undefined);
      expect(wanted).toHaveLength(2);

      const rejected = await holdRequest(
        second,
        hotel._id,
        checkIn,
        checkOut,
        wanted,
      ).expect(409);
      expect(body<{ code: string }>(rejected).code).toBe(
        ErrorCode.RoomsUnavailable,
      );

      const afterwards = await freeRooms(hotel._id, checkIn, checkOut);
      expect(afterwards.has('Standard Double')).toBe(true);
      expect(afterwards.has('Deluxe King')).toBe(false);
      const upcoming = await second.get('/api/hotel-bookings').expect(200);
      expect(body<Page<ReservationBody>>(upcoming).total).toBe(0);

      // The first hold lapses, the rooms are free again and the same request now works.
      expect(
        await app.jobs.expireHotelHolds(justAfter(earlier.hold.holdExpiresAt)),
      ).toBeGreaterThanOrEqual(1);
      expect(
        (await reservationOf(first, earlier.hold.reservationId)).status,
      ).toBe('expired');
      const retried = await holdRequest(
        second,
        hotel._id,
        checkIn,
        checkOut,
        wanted,
      ).expect(201);
      const both = body<HoldBody>(retried);
      expect(both.rooms).toHaveLength(2);
      expect(await roomNightsOf(both.reservationId)).toBe(6);

      await app.jobs.expireHotelHolds(justAfter(both.holdExpiresAt));
      expect((await reservationOf(second, both.reservationId)).status).toBe(
        'expired',
      );
      expect(await roomNightsOf(both.reservationId)).toBe(0);
    });

    it('keeps the booking pending after a failed payment and confirms it once after the retry (PAY-01)', async () => {
      const user = await app.newUser();
      const checkIn = ymd(40);
      const checkOut = ymd(42);
      const hotel = await hotelIn('london', checkIn, checkOut);
      const {
        hold: held,
        session,
        intentId,
      } = await holdAndStartPayment(user, hotel._id, checkIn, checkOut, [
        'Standard Double',
      ]);
      const reservationId = held.reservationId;

      await app.webhook.paymentFailed(intentId).expect(200);
      expect((await paymentOf(user, session.paymentId)).status).toBe('failed');
      const stillPending = await reservationOf(user, reservationId);
      expect(stillPending.status).toBe('pending_payment');
      expect(stillPending.reference).toBeUndefined();
      expect(await roomNightsOf(reservationId)).toBe(2);

      const retried = await user
        .post(`/api/payments/${session.paymentId}/retry`)
        .expect(200);
      expect(body<PaymentSessionBody>(retried)).toMatchObject({
        paymentId: session.paymentId,
        clientSecret: session.clientSecret,
        amountMinor: held.totalMinor,
      });
      expect((await paymentOf(user, session.paymentId)).status).toBe('pending');

      const confirmed = await payAndConfirm(user, reservationId, intentId);
      // Stripe delivers the success again: nothing changes.
      await app.webhook.paymentSucceeded(intentId).expect(200);
      const again = await reservationOf(user, reservationId);
      expect(again).toMatchObject({
        status: 'confirmed',
        reference: confirmed.reference,
      });
      await waitForNotification(user, 'booking_confirmed', reservationId);
      const confirmations = (await notificationsOf(user)).filter(
        (notification) => notification.type === 'booking_confirmed',
      );
      expect(confirmations).toHaveLength(1);
      expect(await roomNightsOf(reservationId)).toBe(2);
    });

    it('expires an unpaid hold, frees the nights and refuses a later payment (HTL-18, GEN-11)', async () => {
      const user = await app.newUser();
      const checkIn = ymd(50);
      const checkOut = ymd(52);
      const hotel = await hotelIn('paris', checkIn, checkOut);
      const {
        hold: held,
        session,
        intentId,
      } = await holdAndStartPayment(user, hotel._id, checkIn, checkOut, [
        'Deluxe King',
      ]);
      const reservationId = held.reservationId;
      expect(
        [...(await freeRooms(hotel._id, checkIn, checkOut)).keys()].sort(),
      ).toEqual(['Family Room', 'Standard Double', 'Suite']);

      expect(
        await app.jobs.expireHotelHolds(justAfter(held.holdExpiresAt)),
      ).toBeGreaterThanOrEqual(1);
      const expired = await reservationOf(user, reservationId);
      expect(expired.status).toBe('expired');
      expect(expired.expiredAt).toBeDefined();
      expect(expired.reference).toBeUndefined();
      expect(await roomNightsOf(reservationId)).toBe(0);
      expect(
        (await freeRooms(hotel._id, checkIn, checkOut)).has('Deluxe King'),
      ).toBe(true);

      // The payment is cancelled in reaction to the expiry event.
      await vi.waitFor(async () => {
        expect((await paymentOf(user, session.paymentId)).status).toBe(
          'canceled',
        );
      }, WAIT);
      expect(app.gateway.calls).toContainEqual({
        method: 'cancelPaymentIntent',
        input: intentId,
      });

      const pay = await startPayment(user, reservationId).expect(409);
      expect(body<{ code: string }>(pay).code).toBe(ErrorCode.HoldExpired);
      const retry = await user
        .post(`/api/payments/${session.paymentId}/retry`)
        .expect(409);
      expect(body<{ code: string }>(retry).code).toBe(ErrorCode.HoldExpired);
      const acceptLate = await user
        .post(`/api/bookings/hotel/${reservationId}/accept-policies`)
        .send({ accepted: true })
        .expect(409);
      expect(body<{ code: string }>(acceptLate).code).toBe(
        ErrorCode.HoldExpired,
      );

      const past = await user
        .get('/api/hotel-bookings')
        .query({ group: 'past' })
        .expect(200);
      expect(
        body<Page<ReservationBody>>(past).items.map((item) => item._id),
      ).toEqual([reservationId]);
      const upcoming = await user.get('/api/hotel-bookings').expect(200);
      expect(body<Page<ReservationBody>>(upcoming).total).toBe(0);
    });

    it('refunds in full a payment that arrives after the hold expired and does not confirm (late payment)', async () => {
      const user = await app.newUser();
      const checkIn = ymd(60);
      const checkOut = ymd(62);
      const hotel = await hotelIn('cairo', checkIn, checkOut);
      const {
        hold: held,
        session,
        intentId,
      } = await holdAndStartPayment(user, hotel._id, checkIn, checkOut, [
        'Family Room',
      ]);
      const reservationId = held.reservationId;

      await app.jobs.expireHotelHolds(justAfter(held.holdExpiresAt));
      await vi.waitFor(async () => {
        expect((await paymentOf(user, session.paymentId)).status).toBe(
          'canceled',
        );
      }, WAIT);

      await app.webhook.paymentSucceeded(intentId).expect(200);
      expect((await paymentOf(user, session.paymentId)).status).toBe(
        'succeeded',
      );

      const notice = await vi.waitFor(async () => {
        const found = (await notificationsOf(user)).find(
          (notification) => notification.type === 'refund_updated',
        );
        expect(found, 'refund notification').toBeDefined();
        return found as NotificationBody;
      }, WAIT);
      expect(notice.message).toBe('Your refund is being processed.');
      const refundId = notice.entity?.id ?? '';
      const refund = await user.get(`/api/refunds/${refundId}`).expect(200);
      expect(body<RefundBody>(refund)).toMatchObject({
        bookingType: 'hotel',
        bookingId: reservationId,
        amountMinor: held.totalMinor,
        reason: 'late_payment',
        status: 'pending',
      });
      expect(app.gateway.calls).toContainEqual({
        method: 'createRefund',
        input: expect.objectContaining({
          paymentIntentId: intentId,
          amountMinor: held.totalMinor,
        }),
      });

      const reservation = await reservationOf(user, reservationId);
      expect(reservation.status).toBe('expired');
      expect(reservation.reference).toBeUndefined();
      expect(await roomNightsOf(reservationId)).toBe(0);
      expect(
        (await freeRooms(hotel._id, checkIn, checkOut)).has('Family Room'),
      ).toBe(true);
      expect(
        (await notificationsOf(user)).filter(
          (notification) => notification.type === 'booking_confirmed',
        ),
      ).toEqual([]);
    });

    it('cancels a confirmed stay with the tier refund and follows the refund to refunded (HTL-21, PAY-03)', async () => {
      const user = await app.newUser();
      const checkIn = ymd(6);
      const checkOut = ymd(9);
      const hotel = await hotelIn('dubai', checkIn, checkOut);
      const { hold: held, intentId } = await holdAndStartPayment(
        user,
        hotel._id,
        checkIn,
        checkOut,
        ['Family Room'],
      );
      const reservationId = held.reservationId;
      expect(held.totalMinor).toBe(3 * 32400);
      const confirmed = await payAndConfirm(user, reservationId, intentId);
      expect(await roomNightsOf(reservationId)).toBe(3);

      const stranger = await app.newUser();
      const notYours = await stranger
        .post(`/api/hotel-bookings/${reservationId}/cancel`)
        .send({})
        .expect(404);
      expect(body<{ code: string }>(notYours).code).toBe(ErrorCode.NotFound);

      // Five days to check-in: the 3-day tier, 50%.
      const preview = await user
        .get(`/api/hotel-bookings/${reservationId}/refund-preview`)
        .expect(200);
      expect(body<object>(preview)).toEqual({
        percent: 50,
        amountMinor: 48600,
        currency: held.currency,
      });

      const cancelled = await user
        .post(`/api/hotel-bookings/${reservationId}/cancel`)
        .send({})
        .expect(200);
      const result = body<{
        _id: string;
        reference: string;
        status: string;
        cancellation: ReservationBody['cancellation'];
        refund: RefundBody;
      }>(cancelled);
      expect(result).toMatchObject({
        _id: reservationId,
        reference: confirmed.reference,
        status: 'cancelled',
        cancellation: {
          cancelledBy: 'user',
          refundPercent: 50,
          refundAmountMinor: 48600,
        },
        refund: {
          bookingType: 'hotel',
          bookingId: reservationId,
          amountMinor: 48600,
          reason: 'user_cancellation',
          status: 'pending',
        },
      });

      expect(await roomNightsOf(reservationId)).toBe(0);
      expect(
        (await freeRooms(hotel._id, checkIn, checkOut)).has('Family Room'),
      ).toBe(true);
      expect(await reservationOf(user, reservationId)).toMatchObject({
        status: 'cancelled',
        cancellation: { refundAmountMinor: 48600 },
      });
      const cancelledList = await user
        .get('/api/hotel-bookings')
        .query({ group: 'cancelled' })
        .expect(200);
      expect(
        body<Page<ReservationBody>>(cancelledList).items.map(
          (item) => item._id,
        ),
      ).toEqual([reservationId]);
      expect(
        body<Page<ReservationBody>>(
          await user.get('/api/hotel-bookings').expect(200),
        ).total,
      ).toBe(0);
      const twice = await user
        .post(`/api/hotel-bookings/${reservationId}/cancel`)
        .send({})
        .expect(409);
      expect(body<{ code: string }>(twice).code).toBe(
        ErrorCode.InvalidStatusTransition,
      );

      await waitForNotification(
        user,
        'booking_cancelled',
        reservationId,
        confirmed.reference,
      );
      await waitForNotification(
        user,
        'refund_updated',
        result.refund.refundId,
        'being processed',
      );

      const stored = await app.t.connection
        .collection('refunds')
        .findOne({ _id: new Types.ObjectId(result.refund.refundId) });
      await app.webhook
        .refund(
          String(stored?.stripeRefundId),
          'succeeded',
          result.refund.refundId,
        )
        .expect(200);
      const refunded = await user
        .get(`/api/refunds/${result.refund.refundId}`)
        .expect(200);
      expect(body<RefundBody>(refunded)).toMatchObject({
        amountMinor: 48600,
        status: 'refunded',
      });
      await waitForNotification(
        user,
        'refund_updated',
        result.refund.refundId,
        'complete',
      );
    });

    it('completes a stay after check-out and lets its guest review it (HTL-23, HTL-24, GEN-11)', async () => {
      const user = await app.newUser();
      const checkIn = ymd(1);
      const checkOut = ymd(3);
      const hotel = await hotelIn('paris', checkIn, checkOut);
      const { hold: held, intentId } = await holdAndStartPayment(
        user,
        hotel._id,
        checkIn,
        checkOut,
        ['Standard Double'],
      );
      const reservationId = held.reservationId;
      const reviewPath = `/api/hotel-bookings/${reservationId}/review`;
      const ratingOf = async () =>
        body<HotelBody>(
          await app.t.http().get(`/api/hotels/${hotel._id}`).expect(200),
        ).ratingSummary;
      expect(await ratingOf()).toEqual({ average: null, count: 0 });

      const tooEarly = await user
        .post(reviewPath)
        .send({ rating: 5 })
        .expect(409);
      expect(body<{ code: string }>(tooEarly).code).toBe(
        ErrorCode.InvalidStatusTransition,
      );
      await payAndConfirm(user, reservationId, intentId);
      const stillConfirmed = await user
        .post(reviewPath)
        .send({ rating: 5 })
        .expect(409);
      expect(body<{ code: string }>(stillConfirmed).code).toBe(
        ErrorCode.InvalidStatusTransition,
      );

      // On the check-out day itself the stay is not over yet.
      expect(
        await app.jobs.completeHotelStays(
          new Date(startOf(checkOut).getTime() + 12 * 60 * 60 * 1000),
        ),
      ).toBe(0);
      expect((await reservationOf(user, reservationId)).status).toBe(
        'confirmed',
      );

      const dayAfter = new Date(startOf(checkOut).getTime() + DAY_MS);
      expect(await app.jobs.completeHotelStays(dayAfter)).toBe(1);
      const completed = await reservationOf(user, reservationId);
      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeDefined();
      const past = await user
        .get('/api/hotel-bookings')
        .query({ group: 'past' })
        .expect(200);
      expect(
        body<Page<ReservationBody>>(past).items.map((item) => item._id),
      ).toEqual([reservationId]);

      const invalid = await user
        .post(reviewPath)
        .send({ rating: 6 })
        .expect(400);
      expect(body<{ code: string }>(invalid).code).toBe(
        ErrorCode.ValidationFailed,
      );
      const stranger = await app.newUser();
      await stranger.post(reviewPath).send({ rating: 1 }).expect(404);

      const created = await user
        .post(reviewPath)
        .send({ rating: 5, text: 'Quiet rooms and a lovely garden.' })
        .expect(201);
      const review = body<ReviewBody>(created);
      expect(review).toMatchObject({
        rating: 5,
        text: 'Quiet rooms and a lovely garden.',
        isHidden: false,
      });
      expect(await ratingOf()).toEqual({ average: 5, count: 1 });
      const duplicate = await user
        .post(reviewPath)
        .send({ rating: 1 })
        .expect(409);
      expect(body<{ code: string }>(duplicate).code).toBe(
        ErrorCode.AlreadyReviewed,
      );

      const listed = await app.t
        .http()
        .get(`/api/hotels/${hotel._id}/reviews`)
        .expect(200);
      expect(body<Page<ReviewBody>>(listed)).toMatchObject({
        total: 1,
        items: [{ _id: review._id, rating: 5 }],
      });

      await user
        .patch(`/api/reviews/${review._id}`)
        .send({ rating: 3 })
        .expect(200);
      expect(await ratingOf()).toEqual({ average: 3, count: 1 });

      const searchWith = async (minRating: number) =>
        body<Page<HotelBody>>(
          await app.t
            .http()
            .get('/api/hotels/search')
            .query({
              cityId: 'paris',
              checkIn: ymd(70),
              checkOut: ymd(72),
              guests: 2,
              minRating,
            })
            .expect(200),
        ).items.map((item) => item._id);
      expect(await searchWith(3)).toEqual([hotel._id]);
      expect(await searchWith(4)).toEqual([]);
    });
  },
);
