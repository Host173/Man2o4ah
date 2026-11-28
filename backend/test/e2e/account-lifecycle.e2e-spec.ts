import { randomUUID } from 'node:crypto';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import { User } from '../../src/modules/accounts/schemas/user.schema.js';
import {
  createFullApp,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  JOURNEY_TIMEOUT,
} from '../support/full-app.js';
import type { Actor, FullApp } from '../support/full-app.js';
import { HOOK_TIMEOUT } from '../support/mongo-memory.js';

/** Handlers of events (notifications, audit, hiding content, confirmation) run after the HTTP answer: state is awaited, not slept on. */
const SETTLE = { timeout: 15_000 };
const DAY_MS = 86_400_000;
const NEW_PASSWORD = 'Brand-new-2';

interface ErrorBody {
  code: string;
  message: string;
  details?: { field: string }[];
}

interface MeBody {
  _id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  preferredCurrency: string;
  mustChangePassword: boolean;
  moderatorOf?: { providerType: string; providerId: string };
  phone?: string;
}

interface FlightChoice {
  flightId: string;
  cabinId: string;
  airlineId: string;
}

interface FlightBookingView {
  _id: string;
  reference?: string;
  status: string;
  segments: { flightId: string }[];
  pricing: { totalMinor: number };
}

interface AdminBookingRow {
  bookingType: string;
  bookingId: string;
  reference?: string;
  userId: string;
  providerId: string;
  totalMinor: number;
  status: string;
}

interface NotificationItem {
  type: string;
}

const ADULT = {
  type: 'adult',
  fullName: 'Lifecycle Passenger',
  dateOfBirth: '1990-01-01',
  documentNumber: 'L12345678',
  extraBagCount: 0,
};

function utcDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

function errorOf(res: { body: unknown }): ErrorBody {
  return res.body as ErrorBody;
}

describe(
  'Account lifecycle, whole app (ACC-01 to ACC-17, GEN-01, GEN-07)',
  { timeout: JOURNEY_TIMEOUT },
  () => {
    let app: FullApp;
    let admin: Actor;
    let users: Model<User>;

    beforeAll(async () => {
      app = await createFullApp();
      admin = await app.admin();
      users = app.t.connection.model<User>(User.name);
    }, HOOK_TIMEOUT);
    afterAll(() => app.t.close(), HOOK_TIMEOUT);

    const login = (email: string, password = DEMO_PASSWORD) =>
      app.t.http().post('/api/auth/login').send({ email, password });

    /** The cookies a request sends, taken from a raw login answer. */
    function cookieOf(res: { headers: Record<string, unknown> }): string {
      const lines = res.headers['set-cookie'] as string[];
      return lines.map((line) => line.split(';')[0]).join('; ');
    }

    async function meOf(actor: Actor): Promise<MeBody> {
      const res = await actor.get('/api/auth/me').expect(200);
      return res.body as MeBody;
    }

    async function notificationTypes(actor: Actor): Promise<string[]> {
      const res = await actor.get('/api/notifications?limit=50').expect(200);
      return (res.body as { items: NotificationItem[] }).items.map(
        (item) => item.type,
      );
    }

    async function auditEntries(
      action: string,
      targetId: string,
    ): Promise<{ actorId: string; target: { type: string; id: string } }[]> {
      const res = await admin
        .get(`/api/admin/audit-logs?action=${action}&limit=50`)
        .expect(200);
      const items = (
        res.body as {
          items: { actorId: string; target: { type: string; id: string } }[];
        }
      ).items;
      return items.filter((item) => item.target.id === targetId);
    }

    /** A seeded Nile Air (`NA`) flight on the given day, with its first cabin. */
    async function nileFlight(
      day: string,
      from = 'CAI',
      to = 'DXB',
    ): Promise<FlightChoice> {
      const res = await app.t
        .http()
        .get(`/api/flights/search?from=${from}&to=${to}&date=${day}&limit=50`)
        .expect(200);
      const items = (
        res.body as {
          items: {
            flight: { _id: string; airlineId: string };
            airline: { code: string };
            matchingCabins: { _id: string }[];
          }[];
        }
      ).items;
      const item = items.find((candidate) => candidate.airline.code === 'NA');
      if (!item?.matchingCabins[0]) throw new Error(`No NA flight on ${day}`);
      return {
        flightId: item.flight._id,
        cabinId: item.matchingCabins[0]._id,
        airlineId: item.flight.airlineId,
      };
    }

    async function payAndConfirm(
      user: Actor,
      type: 'flight' | 'hotel',
      bookingId: string,
    ): Promise<void> {
      await user
        .post(`/api/bookings/${type}/${bookingId}/accept-policies`)
        .send({ accepted: true })
        .expect(200);
      const payment = await user
        .post('/api/payments')
        .send({ bookingType: type, bookingId })
        .expect(201);
      const { clientSecret } = payment.body as { clientSecret: string };
      await app.webhook
        .paymentSucceeded(clientSecret.replace(/_secret$/, ''))
        .expect(200);
      const path =
        type === 'flight'
          ? `/api/flight-bookings/${bookingId}`
          : `/api/hotel-bookings/${bookingId}`;
      await vi.waitFor(async () => {
        const res = await user.get(path).expect(200);
        expect((res.body as { status: string }).status).toBe('confirmed');
      }, SETTLE);
    }

    async function confirmedFlightBooking(
      user: Actor,
      flight: FlightChoice,
    ): Promise<FlightBookingView> {
      const hold = await user
        .post('/api/flight-bookings/hold')
        .send({
          tripType: 'one_way',
          segments: [{ flightId: flight.flightId, cabinId: flight.cabinId }],
          passengers: [ADULT],
        })
        .expect(201);
      const { bookingId } = hold.body as { bookingId: string };
      await payAndConfirm(user, 'flight', bookingId);
      const res = await user.get(`/api/flight-bookings/${bookingId}`);
      return res.body as FlightBookingView;
    }

    /** A free room of the hotel for the stay, and the hotel's id from its moderator. */
    async function hotelRoom(
      hotelId: string,
      checkIn: string,
      checkOut: string,
    ): Promise<string> {
      const res = await app.t
        .http()
        .get(
          `/api/hotels/${hotelId}/rooms/available?checkIn=${checkIn}&checkOut=${checkOut}`,
        )
        .expect(200);
      const rooms = (res.body as { items: { _id: string }[] }).items;
      if (!rooms[0]) throw new Error('No free room');
      return rooms[0]._id;
    }

    async function confirmedStay(
      user: Actor,
      hotelId: string,
      checkIn: string,
      checkOut: string,
    ): Promise<string> {
      const roomId = await hotelRoom(hotelId, checkIn, checkOut);
      const hold = await user
        .post('/api/hotel-bookings')
        .send({
          hotelId,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          rooms: [{ roomId, adults: 1, childAges: [] }],
        })
        .expect(201);
      const { reservationId } = hold.body as { reservationId: string };
      await payAndConfirm(user, 'hotel', reservationId);
      return reservationId;
    }

    async function providerOf(email: string): Promise<string> {
      const moderator = await app.as(email);
      const me = await meOf(moderator);
      return me.moderatorOf?.providerId ?? '';
    }

    it('registers, logs in, edits the profile and changes the password, revoking every session (ACC-01, 04, 08, 09)', async () => {
      const email = `Reg.${randomUUID()}@Example.com`;
      const lower = email.toLowerCase();

      // ACC-01: registration validates and does not log in.
      const registered = await app.t
        .http()
        .post('/api/auth/register')
        .send({
          name: ' Reg Ister ',
          email,
          password: DEMO_PASSWORD,
          acceptTerms: true,
        })
        .expect(201);
      expect(registered.headers['set-cookie']).toBeUndefined();
      expect(registered.body.user).toMatchObject({
        name: 'Reg Ister',
        email: lower,
        role: 'user',
        status: 'active',
        preferredCurrency: 'USD',
        mustChangePassword: false,
      });
      expect(JSON.stringify(registered.body)).not.toContain('passwordHash');
      const duplicate = await app.t
        .http()
        .post('/api/auth/register')
        .send({
          name: 'Twin',
          email: lower,
          password: DEMO_PASSWORD,
          acceptTerms: true,
        })
        .expect(409);
      expect(errorOf(duplicate).code).toBe(ErrorCode.EmailTaken);
      for (const bad of [
        { password: 'short1' },
        { password: 'onlyletters' },
        { acceptTerms: false },
        { email: 'not-an-email' },
      ]) {
        const res = await app.t
          .http()
          .post('/api/auth/register')
          .send({
            name: 'Bad',
            email: `bad.${randomUUID()}@example.com`,
            password: DEMO_PASSWORD,
            acceptTerms: true,
            ...bad,
          })
          .expect(400);
        expect(errorOf(res).code).toBe(ErrorCode.ValidationFailed);
      }

      // ACC-04: a generic failure, then cookies that JavaScript cannot read.
      const wrong = await login(lower, 'Wrong-pass-1').expect(401);
      const unknown = await login(
        `nobody.${randomUUID()}@example.com`,
        'Wrong-pass-1',
      ).expect(401);
      expect(errorOf(wrong).code).toBe(ErrorCode.InvalidCredentials);
      expect({
        code: errorOf(unknown).code,
        message: errorOf(unknown).message,
      }).toEqual({
        code: errorOf(wrong).code,
        message: errorOf(wrong).message,
      });
      const first = await login(email.toUpperCase()).expect(200);
      const cookies = first.headers['set-cookie'] as unknown as string[];
      expect(cookies).toHaveLength(2);
      for (const name of ['access_token', 'refresh_token']) {
        const line = cookies.find((cookie) => cookie.startsWith(`${name}=`));
        expect(line, name).toMatch(/HttpOnly/);
        expect(line, name).toMatch(/Secure/);
        expect(line, name).toMatch(/SameSite=Lax/);
      }
      expect(JSON.stringify(first.body)).not.toMatch(/token/i);
      expect(first.body.user.email).toBe(lower);

      const second = await login(lower).expect(200);
      const phone = await app.as(lower);
      const me = await meOf(phone);
      expect(me).toMatchObject({ email: lower, name: 'Reg Ister' });

      // ACC-09: all fields valid or nothing is saved.
      const rejected = await phone
        .patch('/api/users/me')
        .send({ name: 'Should Not Save', phone: 'not a phone' })
        .expect(400);
      expect(errorOf(rejected).code).toBe(ErrorCode.ValidationFailed);
      const unsupported = await phone
        .patch('/api/users/me')
        .send({ preferredCurrency: 'XXX' })
        .expect(400);
      expect(errorOf(unsupported).code).toBe(ErrorCode.UnsupportedCurrency);
      await phone
        .patch('/api/users/me')
        .send({ email: 'other@example.com' })
        .expect(400);
      expect((await meOf(phone)).name).toBe('Reg Ister');
      const edited = await phone
        .patch('/api/users/me')
        .send({
          name: 'Reg Edited',
          phone: '+20 100 123 4567',
          preferredCurrency: 'EGP',
        })
        .expect(200);
      expect(edited.body).toMatchObject({
        name: 'Reg Edited',
        phone: '+20 100 123 4567',
        preferredCurrency: 'EGP',
        email: lower,
      });
      const profile = await phone.get('/api/users/me').expect(200);
      expect(profile.body).toMatchObject({
        name: 'Reg Edited',
        phone: '+20 100 123 4567',
        preferredCurrency: 'EGP',
      });
      expect(await meOf(phone)).toMatchObject({
        name: 'Reg Edited',
        preferredCurrency: 'EGP',
      });

      // ACC-08: the current password is required and the new one follows the rule.
      const wrongCurrent = await phone
        .patch('/api/auth/change-password')
        .send({ currentPassword: 'Not-my-pass-1', newPassword: NEW_PASSWORD })
        .expect(400);
      expect(errorOf(wrongCurrent).code).toBe(ErrorCode.ValidationFailed);
      expect(errorOf(wrongCurrent).details?.[0]?.field).toBe('currentPassword');
      const weak = await phone
        .patch('/api/auth/change-password')
        .send({ currentPassword: DEMO_PASSWORD, newPassword: 'weak' })
        .expect(400);
      expect(errorOf(weak).details?.[0]?.field).toBe('newPassword');
      await meOf(phone);

      const changed = await phone
        .patch('/api/auth/change-password')
        .send({ currentPassword: DEMO_PASSWORD, newPassword: NEW_PASSWORD })
        .expect(204);
      const cleared = changed.headers['set-cookie'] as unknown as string[];
      expect(cleared.map((line) => line.split('=')[0]).sort()).toEqual([
        'access_token',
        'refresh_token',
      ]);
      expect(cleared.every((line) => /^[a-z_]+=;/.test(line))).toBe(true);

      // Every session of the account is dead: the one that changed it, the other device, refresh tokens.
      const laptop = cookieOf(second);
      for (const cookie of [phone.cookie, laptop]) {
        const stale = await app.t
          .http()
          .get('/api/auth/me')
          .set('Cookie', cookie)
          .expect(401);
        expect(errorOf(stale).code).toBe(ErrorCode.SessionExpired);
        const refresh = await app.t
          .http()
          .post('/api/auth/refresh')
          .set('Cookie', cookie)
          .expect(401);
        expect(errorOf(refresh).code).toBe(ErrorCode.SessionExpired);
      }
      const oldPassword = await login(lower).expect(401);
      expect(errorOf(oldPassword).code).toBe(ErrorCode.InvalidCredentials);
      const renewed = await app.as(lower, NEW_PASSWORD);
      expect(await meOf(renewed)).toMatchObject({
        name: 'Reg Edited',
        mustChangePassword: false,
      });
    });

    it('locks the account after five wrong passwords and resets the counter on the next good login (ACC-05)', async () => {
      const user = await app.newUser('Lockout');
      const { email } = user;

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const res = await login(email, `Wrong-pass-${attempt}`).expect(401);
        expect(errorOf(res).code).toBe(ErrorCode.InvalidCredentials);
      }
      expect((await users.findOne({ email }).lean())?.failedLoginAttempts).toBe(
        4,
      );
      const fifth = await login(email, 'Wrong-pass-5').expect(401);
      expect(errorOf(fifth).code).toBe(ErrorCode.AccountLocked);
      expect(errorOf(fifth).message).toMatch(/minute/i);

      // The right password does not unlock it.
      const during = await login(email).expect(401);
      expect(errorOf(during).code).toBe(ErrorCode.AccountLocked);
      const locked = await users.findOne({ email }).lean();
      const remainingMs = (locked?.lockedUntil?.getTime() ?? 0) - Date.now();
      expect(remainingMs).toBeGreaterThan(14 * 60_000);
      expect(remainingMs).toBeLessThanOrEqual(15 * 60_000);

      // The lock lasts 15 minutes and tests do not sleep: move its end into the past instead.
      await users.updateOne(
        { email },
        { $set: { lockedUntil: new Date(Date.now() - 1_000) } },
      );
      await login(email, 'Wrong-pass-6').expect(401);
      await login(email, 'Wrong-pass-7').expect(401);
      expect((await users.findOne({ email }).lean())?.failedLoginAttempts).toBe(
        2,
      );
      await login(email).expect(200);
      expect((await users.findOne({ email }).lean())?.failedLoginAttempts).toBe(
        0,
      );
    });

    it('logs out: cookies cleared, access cookie and refresh token rejected, other devices kept (ACC-06)', async () => {
      const user = await app.newUser('Logout');
      const phone = await login(user.email).expect(200);
      const laptop = await login(user.email).expect(200);
      const phoneCookie = cookieOf(phone);
      const laptopCookie = cookieOf(laptop);

      const out = await app.t
        .http()
        .post('/api/auth/logout')
        .set('Cookie', phoneCookie)
        .expect(204);
      const cleared = out.headers['set-cookie'] as unknown as string[];
      expect(cleared.map((line) => line.split('=')[0]).sort()).toEqual([
        'access_token',
        'refresh_token',
      ]);
      expect(cleared.every((line) => /^[a-z_]+=;/.test(line))).toBe(true);

      const stale = await app.t
        .http()
        .get('/api/auth/me')
        .set('Cookie', phoneCookie)
        .expect(401);
      expect(errorOf(stale).code).toBe(ErrorCode.SessionExpired);
      const refresh = await app.t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', phoneCookie)
        .expect(401);
      expect(errorOf(refresh).code).toBe(ErrorCode.SessionExpired);

      await app.t
        .http()
        .post('/api/auth/logout')
        .set('Cookie', phoneCookie)
        .expect(204);
      await app.t.http().post('/api/auth/logout').expect(204);
      await app.t
        .http()
        .get('/api/auth/me')
        .set('Cookie', laptopCookie)
        .expect(200);
      await app.t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', laptopCookie)
        .expect(204);
    });

    it('lets an admin suspend and reactivate a user whose confirmed booking stays valid, and audits both (ACC-15, 16, GEN-01, GEN-07)', async () => {
      const user = await app.newUser('Suspendable');
      const { _id: userId } = await meOf(user);
      const adminId = (await meOf(admin))._id;
      const flight = await nileFlight(utcDay(4));
      const booking = await confirmedFlightBooking(user, flight);
      expect(booking.status).toBe('confirmed');

      const suspended = await admin
        .patch(`/api/admin/accounts/${userId}/suspend`)
        .expect(204);
      expect(suspended.body).toEqual({});
      const again = await admin
        .patch(`/api/admin/accounts/${userId}/suspend`)
        .expect(409);
      expect(errorOf(again).code).toBe(ErrorCode.InvalidStatusTransition);

      const refused = await login(user.email).expect(403);
      expect(errorOf(refused).code).toBe(ErrorCode.AccountSuspended);
      // A wrong password is not told apart from any other wrong password.
      const wrong = await login(user.email, 'Wrong-pass-1').expect(401);
      expect(errorOf(wrong).code).toBe(ErrorCode.InvalidCredentials);
      const dead = await user.get('/api/auth/me').expect(401);
      expect(errorOf(dead).code).toBe(ErrorCode.SessionExpired);

      // The booking is untouched: seats booked, listed as confirmed for the admin.
      const rows = await admin
        .get(`/api/admin/bookings?type=flight&status=confirmed&limit=50`)
        .expect(200);
      expect(
        (rows.body as { items: AdminBookingRow[] }).items.find(
          (row) => row.bookingId === booking._id,
        ),
      ).toMatchObject({ userId, status: 'confirmed' });
      await app.expectInvariants();

      await admin.patch(`/api/admin/accounts/${userId}/reactivate`).expect(204);
      const back = await app.as(user.email);
      expect((await meOf(back)).status).toBe('active');
      const ticket = await back
        .get(`/api/flight-bookings/${booking._id}/e-ticket`)
        .expect(200);
      expect(ticket.headers['content-type']).toContain('application/pdf');
      const kept = await back
        .get(`/api/flight-bookings/${booking._id}`)
        .expect(200);
      expect(kept.body).toMatchObject({
        status: 'confirmed',
        reference: booking.reference,
      });

      await vi.waitFor(async () => {
        const types = await notificationTypes(back);
        expect(types).toContain('account_suspended');
        expect(types).toContain('account_reactivated');
        for (const action of ['account_suspended', 'account_reactivated']) {
          const entries = await auditEntries(action, userId);
          expect(entries, action).toHaveLength(1);
          expect(entries[0]).toMatchObject({
            actorId: adminId,
            target: { type: 'user', id: userId },
          });
        }
      }, SETTLE);

      const plain = await app.newUser('Not An Admin');
      await plain.patch(`/api/admin/accounts/${userId}/suspend`).expect(403);
    });

    it('resets a password to a temporary one that only allows changing it (ACC-07a, ACC-08)', async () => {
      const user = await app.newUser('Forgetful');
      const { _id: userId } = await meOf(user);
      const temporary = 'Temp-reset-7';

      const weak = await admin
        .post(`/api/admin/users/${userId}/reset-password`)
        .send({ temporaryPassword: 'weak' })
        .expect(400);
      expect(errorOf(weak).code).toBe(ErrorCode.ValidationFailed);
      await admin
        .post(`/api/admin/users/${'0'.repeat(24)}/reset-password`)
        .send({ temporaryPassword: temporary })
        .expect(404);
      await user
        .post(`/api/admin/users/${userId}/reset-password`)
        .send({ temporaryPassword: temporary })
        .expect(403);
      await user.get('/api/auth/me').expect(200);

      await admin
        .post(`/api/admin/users/${userId}/reset-password`)
        .send({ temporaryPassword: temporary })
        .expect(204);
      const dead = await user.get('/api/auth/me').expect(401);
      expect(errorOf(dead).code).toBe(ErrorCode.SessionExpired);
      const old = await login(user.email).expect(401);
      expect(errorOf(old).code).toBe(ErrorCode.InvalidCredentials);

      const forced = await login(user.email, temporary).expect(200);
      expect(forced.body.user.mustChangePassword).toBe(true);
      const restricted = cookieOf(forced);
      const send = (verb: 'get' | 'post' | 'patch' | 'delete', path: string) =>
        app.t.http()[verb](path).set('Cookie', restricted);
      for (const [verb, path] of [
        ['get', '/api/users/me'],
        ['patch', '/api/users/me'],
        ['get', '/api/notifications'],
        ['get', '/api/notifications/unread-count'],
        ['get', '/api/flight-bookings'],
        ['post', '/api/flight-bookings/hold'],
        ['get', '/api/hotel-bookings'],
        ['post', '/api/payments'],
        ['get', '/api/itineraries'],
        ['post', '/api/posts'],
        ['delete', '/api/users/me'],
      ] as const) {
        const res = await send(verb, path).expect(403);
        expect(errorOf(res).code, `${verb} ${path}`).toBe(
          ErrorCode.PasswordChangeRequired,
        );
      }
      expect(
        (await send('get', '/api/auth/me').expect(200)).body,
      ).toMatchObject({ mustChangePassword: true });
      // Logging out is allowed too.
      const other = await login(user.email, temporary).expect(200);
      await app.t
        .http()
        .post('/api/auth/logout')
        .set('Cookie', cookieOf(other))
        .expect(204);

      const same = await send('patch', '/api/auth/change-password')
        .send({ currentPassword: temporary, newPassword: temporary })
        .expect(400);
      expect(errorOf(same).details?.[0]?.field).toBe('newPassword');
      await send('patch', '/api/auth/change-password')
        .send({ currentPassword: temporary, newPassword: NEW_PASSWORD })
        .expect(204);
      await send('get', '/api/auth/me').expect(401);
      await login(user.email, temporary).expect(401);

      const normal = await app.as(user.email, NEW_PASSWORD);
      expect(await meOf(normal)).toMatchObject({ mustChangePassword: false });
      await normal.get('/api/users/me').expect(200);
      await normal.get('/api/notifications').expect(200);

      await vi.waitFor(async () => {
        const entries = await auditEntries('password_reset', userId);
        expect(entries).toHaveLength(1);
      }, SETTLE);
    });

    it('lets an admin create a moderator who must change the password and then manages only their own airline (ACC-13)', async () => {
      const created = await admin
        .post('/api/airlines')
        .send({ name: 'Lifecycle Air', code: 'LC' })
        .expect(201);
      const airlineId = (created.body as { _id: string })._id;
      const email = `moderator.${randomUUID()}@example.com`;
      const temporary = 'Temp-mod-77';
      const body = {
        name: 'Lifecycle Moderator',
        email,
        role: 'airline_moderator',
        providerId: airlineId,
        temporaryPassword: temporary,
      };

      const nileId = await providerOf(DEMO_ACCOUNTS.nileAirModerator);
      const nileViewId = await providerOf(DEMO_ACCOUNTS.nileViewModerator);
      const mismatch = await admin
        .post('/api/admin/moderators')
        .send({
          ...body,
          email: `m.${randomUUID()}@example.com`,
          providerId: nileViewId,
        })
        .expect(404);
      expect(errorOf(mismatch).code).toBe(ErrorCode.NotFound);
      await app
        .as(DEMO_ACCOUNTS.sara)
        .then((sara) =>
          sara.post('/api/admin/moderators').send(body).expect(403),
        );

      const moderator = await admin
        .post('/api/admin/moderators')
        .send(body)
        .expect(201);
      expect(moderator.body).toMatchObject({
        email,
        role: 'airline_moderator',
        status: 'active',
        moderatorOf: { providerType: 'airline', providerId: airlineId },
      });
      expect(JSON.stringify(moderator.body)).not.toMatch(
        /passwordHash|temporaryPassword/,
      );
      const dup = await admin
        .post('/api/admin/moderators')
        .send(body)
        .expect(409);
      expect(errorOf(dup).code).toBe(ErrorCode.EmailTaken);

      const listed = await admin
        .get(
          `/api/admin/accounts?q=${encodeURIComponent(email)}&role=airline_moderator`,
        )
        .expect(200);
      expect(
        (listed.body as { items: { email: string }[] }).items.map(
          (item) => item.email,
        ),
      ).toEqual([email]);

      // First login: a forced password change comes first.
      const first = await login(email, temporary).expect(200);
      expect(first.body.user).toMatchObject({
        role: 'airline_moderator',
        mustChangePassword: true,
        moderatorOf: { providerType: 'airline', providerId: airlineId },
      });
      const forced = cookieOf(first);
      const blocked = await app.t
        .http()
        .get(`/api/airlines/${airlineId}/flights`)
        .set('Cookie', forced)
        .expect(403);
      expect(errorOf(blocked).code).toBe(ErrorCode.PasswordChangeRequired);
      await app.t
        .http()
        .patch('/api/auth/change-password')
        .set('Cookie', forced)
        .send({ currentPassword: temporary, newPassword: NEW_PASSWORD })
        .expect(204);
      const mod = await app.as(email, NEW_PASSWORD);
      expect(await meOf(mod)).toMatchObject({ mustChangePassword: false });

      // Own airline: list, create, cancel.
      const own = await mod
        .get(`/api/airlines/${airlineId}/flights`)
        .expect(200);
      expect((own.body as { items: unknown[] }).items).toEqual([]);
      const day = utcDay(30);
      const flight = await mod
        .post('/api/flights')
        .send({
          flightNumber: 'LC 100',
          departureAirportId: 'CAI',
          arrivalAirportId: 'DXB',
          departureLocal: `${day}T08:30`,
          arrivalLocal: `${day}T23:00`,
        })
        .expect(201);
      const flightId = (flight.body as { _id: string })._id;
      expect(flight.body.airlineId).toBe(airlineId);

      // Another provider: 404 on its flights and bookings, 403 on the other kind of provider.
      const theirs = await app.as(DEMO_ACCOUNTS.nileAirModerator);
      const nileFlights = await theirs
        .get(`/api/airlines/${nileId}/flights`)
        .expect(200);
      const nileFlightId = (nileFlights.body as { items: { _id: string }[] })
        .items[0]?._id;
      expect(nileFlightId).toBeDefined();
      for (const path of [
        `/api/airlines/${nileId}/flights`,
        `/api/flights/${nileFlightId}/bookings`,
        `/api/flights/${nileFlightId}/passengers/export`,
      ]) {
        const res = await mod.get(path).expect(404);
        expect(errorOf(res).code, path).toBe(ErrorCode.NotFound);
      }
      const noCancel = await mod
        .post(`/api/flights/${nileFlightId}/cancel`)
        .expect(404);
      expect(errorOf(noCancel).code).toBe(ErrorCode.NotFound);
      const noCancelMine = await theirs
        .post(`/api/flights/${flightId}/cancel`)
        .expect(404);
      expect(errorOf(noCancelMine).code).toBe(ErrorCode.NotFound);
      const wrongKind = await mod
        .get(`/api/hotels/${nileViewId}/reservations`)
        .expect(403);
      expect(errorOf(wrongKind).code).toBe(ErrorCode.ForbiddenRole);
      await mod.post(`/api/flights/${flightId}/cancel`).expect(204);

      await vi.waitFor(async () => {
        const entries = await auditEntries(
          'moderator_created',
          (moderator.body as { id: string }).id,
        );
        expect(entries).toHaveLength(1);
      }, SETTLE);
    });

    it('deactivates a user only without upcoming bookings and then hides their content (ACC-12)', async () => {
      const user = await app.newUser('Leaving User');
      const reader = await app.newUser('Staying User');
      const { _id: userId } = await meOf(user);
      const hotelId = await providerOf(DEMO_ACCOUNTS.nileViewModerator);

      // A finished stay to review, an upcoming flight, a post, a public itinerary and a comment.
      const stay = await confirmedStay(user, hotelId, utcDay(2), utcDay(4));
      await app.jobs.completeHotelStays(new Date(Date.now() + 10 * DAY_MS));
      const stayView = await user
        .get(`/api/hotel-bookings/${stay}`)
        .expect(200);
      expect(stayView.body.status).toBe('completed');
      const review = await user
        .post(`/api/hotel-bookings/${stay}/review`)
        .send({ rating: 4, text: 'Quiet and clean' })
        .expect(201);
      const reviewId = (review.body as { _id: string })._id;

      const flight = await nileFlight(utcDay(6));
      const booking = await confirmedFlightBooking(user, flight);

      const post = await user
        .post('/api/posts')
        .send({
          title: 'Leaving soon',
          body: 'My trip notes',
          status: 'published',
        })
        .expect(201);
      const postId = (post.body as { _id: string })._id;
      const theirPost = await reader
        .post('/api/posts')
        .send({ title: 'Stay here', body: 'Reader post', status: 'published' })
        .expect(201);
      const theirPostId = (theirPost.body as { _id: string })._id;
      await user
        .post(`/api/posts/${theirPostId}/comments`)
        .send({ body: 'Nice post' })
        .expect(201);
      const itineraryTitle = `Leaving trip ${randomUUID()}`;
      const itinerary = await user
        .post('/api/itineraries')
        .send({
          title: itineraryTitle,
          countryCodes: ['EG'],
          startDate: '2027-04-01',
        })
        .expect(201);
      const itineraryId = (itinerary.body as { _id: string })._id;
      await user
        .patch(`/api/itineraries/${itineraryId}`)
        .send({ visibility: 'public' })
        .expect(200);

      const publicIds = async (): Promise<string[]> => {
        const res = await app.t
          .http()
          .get(
            `/api/itineraries/public/search?q=${encodeURIComponent(itineraryTitle)}`,
          )
          .expect(200);
        return (res.body as { items: { _id: string }[] }).items.map(
          (item) => item._id,
        );
      };
      const commentNames = async (): Promise<(string | null)[]> => {
        const res = await app.t
          .http()
          .get(`/api/posts/${theirPostId}/comments`)
          .expect(200);
        return (
          res.body as { items: { authorName: string | null }[] }
        ).items.map((item) => item.authorName);
      };
      await app.t.http().get(`/api/posts/${postId}`).expect(200);
      expect(await publicIds()).toEqual([itineraryId]);
      expect(await commentNames()).toEqual(['Leaving User']);

      // Blocked while the flight is upcoming and confirmed.
      const blocked = await user
        .delete('/api/users/me')
        .send({ confirm: true })
        .expect(409);
      expect(errorOf(blocked).code).toBe(ErrorCode.ActiveBookingsExist);
      expect((await meOf(user)).status).toBe('active');
      await app.t.http().get(`/api/posts/${postId}`).expect(200);

      const cancelled = await user
        .post(`/api/flight-bookings/${booking._id}/cancel`)
        .send({})
        .expect(200);
      expect(cancelled.body.status).toBe('cancelled');
      const noConfirm = await user.delete('/api/users/me').send({}).expect(400);
      expect(errorOf(noConfirm).code).toBe(ErrorCode.ValidationFailed);
      const gone = await user
        .delete('/api/users/me')
        .send({ confirm: true })
        .expect(204);
      const cleared = gone.headers['set-cookie'] as unknown as string[];
      expect(cleared.every((line) => /^[a-z_]+=;/.test(line))).toBe(true);

      const refused = await login(user.email).expect(401);
      expect(errorOf(refused).code).toBe(ErrorCode.InvalidCredentials);
      const dead = await user.get('/api/auth/me').expect(401);
      expect(errorOf(dead).code).toBe(ErrorCode.SessionExpired);
      expect((await users.findById(userId).lean())?.status).toBe('deactivated');

      await vi.waitFor(async () => {
        const hiddenPost = await app.t.http().get(`/api/posts/${postId}`);
        expect(hiddenPost.status).toBe(404);
        expect(await publicIds()).toEqual([]);
        expect(await commentNames()).toEqual(['Deleted user']);
      }, SETTLE);
      const list = await app.t.http().get('/api/posts?limit=50').expect(200);
      expect(
        (list.body as { items: { _id: string }[] }).items.map(
          (item) => item._id,
        ),
      ).toEqual([theirPostId]);

      // The review stays public.
      const reviews = await app.t
        .http()
        .get(`/api/hotels/${hotelId}/reviews`)
        .expect(200);
      expect(
        (reviews.body as { items: { _id: string }[] }).items.map(
          (item) => item._id,
        ),
      ).toContain(reviewId);
      await app.expectInvariants();
    });

    it('limits who sees a booking: its owner, the admin list and the provider own moderator (ACC-11, 17, FLT-29, HTL-22)', async () => {
      const owner = await app.newUser('Booking Owner');
      const stranger = await app.newUser('Stranger');
      const { _id: ownerId } = await meOf(owner);
      const nile = await app.as(DEMO_ACCOUNTS.nileAirModerator);
      const gulf = await app.as(DEMO_ACCOUNTS.gulfWingsModerator);
      const nileView = await app.as(DEMO_ACCOUNTS.nileViewModerator);
      const marina = await app.as(DEMO_ACCOUNTS.marinaModerator);
      const hotelId = await providerOf(DEMO_ACCOUNTS.nileViewModerator);
      const marinaId = await providerOf(DEMO_ACCOUNTS.marinaModerator);

      const flight = await nileFlight(utcDay(8));
      const booking = await confirmedFlightBooking(owner, flight);
      const stayId = await confirmedStay(owner, hotelId, utcDay(9), utcDay(11));
      const stayView = await owner
        .get(`/api/hotel-bookings/${stayId}`)
        .expect(200);
      const stayRef = (stayView.body as { reference: string }).reference;
      const flightPrefix = `/api/flight-bookings/${booking._id}`;

      // ACC-11: only the owner; everyone else gets a 404 (a wrong role a 403).
      await owner.get(flightPrefix).expect(200);
      for (const path of [
        flightPrefix,
        `${flightPrefix}/e-ticket`,
        `${flightPrefix}/refund-preview`,
        `/api/hotel-bookings/${stayId}`,
        `/api/hotel-bookings/${stayId}/refund-preview`,
        `/api/bookings/flight/${booking._id}/policies`,
        `/api/bookings/hotel/${stayId}/policies`,
      ]) {
        const res = await stranger.get(path).expect(404);
        expect(errorOf(res).code, path).toBe(ErrorCode.NotFound);
      }
      for (const path of [
        `${flightPrefix}/cancel`,
        `/api/hotel-bookings/${stayId}/cancel`,
      ]) {
        const res = await stranger.post(path).send({}).expect(404);
        expect(errorOf(res).code, path).toBe(ErrorCode.NotFound);
        const asAdmin = await admin.post(path).send({}).expect(403);
        expect(errorOf(asAdmin).code, path).toBe(ErrorCode.ForbiddenRole);
      }
      const theirPayment = await stranger
        .post('/api/payments')
        .send({ bookingType: 'flight', bookingId: booking._id })
        .expect(404);
      expect(errorOf(theirPayment).code).toBe(ErrorCode.NotFound);
      expect(
        (
          (
            await stranger
              .get('/api/flight-bookings?group=upcoming')
              .expect(200)
          ).body as {
            items: unknown[];
          }
        ).items,
      ).toEqual([]);
      await owner.get(flightPrefix).expect(200);
      await owner.get(`/api/hotel-bookings/${stayId}`).expect(200);

      // ACC-17: the admin's read-only list, with its filters.
      const list = async (query: string): Promise<AdminBookingRow[]> => {
        const res = await admin
          .get(`/api/admin/bookings?limit=50&${query}`)
          .expect(200);
        return (res.body as { items: AdminBookingRow[] }).items;
      };
      const flightRow = {
        bookingType: 'flight',
        bookingId: booking._id,
        reference: booking.reference,
        userId: ownerId,
        providerId: flight.airlineId,
        totalMinor: booking.pricing.totalMinor,
        status: 'confirmed',
      };
      const hotelRow = {
        bookingType: 'hotel',
        bookingId: stayId,
        reference: stayRef,
        userId: ownerId,
        providerId: hotelId,
        status: 'confirmed',
      };
      const ids = (rows: AdminBookingRow[]) => rows.map((row) => row.bookingId);
      const all = await list('');
      expect(all).toEqual(
        expect.arrayContaining([
          expect.objectContaining(flightRow),
          expect.objectContaining(hotelRow),
        ]),
      );
      expect(ids(await list('type=flight'))).toContain(booking._id);
      expect(ids(await list('type=flight'))).not.toContain(stayId);
      expect(ids(await list('type=hotel'))).toContain(stayId);
      expect(ids(await list('type=hotel'))).not.toContain(booking._id);
      expect(ids(await list('status=confirmed'))).toEqual(
        expect.arrayContaining([booking._id, stayId]),
      );
      expect(ids(await list('status=cancelled'))).not.toContain(booking._id);
      const window = `from=${utcDay(-1)}&to=${utcDay(1)}`;
      expect(ids(await list(`${window}&status=confirmed`))).toEqual(
        expect.arrayContaining([booking._id, stayId]),
      );
      expect(ids(await list(`from=${utcDay(1)}`))).not.toContain(booking._id);
      expect(ids(await list(`to=${utcDay(-1)}`))).not.toContain(booking._id);
      await stranger.get('/api/admin/bookings').expect(403);
      await nile.get('/api/admin/bookings').expect(403);
      await app.t.http().get('/api/admin/bookings').expect(401);

      // FLT-29: the airline's moderator sees the booking; another airline's does not.
      const mine = await nile
        .get(`/api/flights/${flight.flightId}/bookings`)
        .expect(200);
      expect(mine.body.items).toEqual([
        {
          reference: booking.reference,
          passengerNames: [ADULT.fullName],
          cabinClass: 'economy',
          seatCount: 1,
          status: 'confirmed',
        },
      ]);
      expect(mine.body.seatsRemainingPerCabin).toEqual(
        expect.arrayContaining([
          { cabinClass: 'economy', availableSeats: 119 },
        ]),
      );
      const csv = await nile
        .get(`/api/flights/${flight.flightId}/passengers/export`)
        .expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain(booking.reference);
      expect(csv.text).toContain(ADULT.fullName);
      for (const path of [
        `/api/flights/${flight.flightId}/bookings`,
        `/api/flights/${flight.flightId}/passengers/export`,
      ]) {
        const res = await gulf.get(path).expect(404);
        expect(errorOf(res).code, path).toBe(ErrorCode.NotFound);
        await nileView.get(path).expect(403);
        await owner.get(path).expect(403);
      }

      // HTL-22: likewise for the hotel's moderator.
      const reservations = await nileView
        .get(`/api/hotels/${hotelId}/reservations`)
        .expect(200);
      expect(
        (
          reservations.body as {
            items: { _id: string; guest: { _id: string; name: string } }[];
          }
        ).items.find((item) => item._id === stayId),
      ).toMatchObject({
        reference: stayRef,
        guest: { _id: ownerId, name: 'Booking Owner' },
        checkInDate: utcDay(9),
        checkOutDate: utcDay(11),
        status: 'confirmed',
      });
      const other = await marina
        .get(`/api/hotels/${hotelId}/reservations`)
        .expect(404);
      expect(errorOf(other).code).toBe(ErrorCode.NotFound);
      const marinaOwn = await marina
        .get(`/api/hotels/${marinaId}/reservations`)
        .expect(200);
      expect(
        (marinaOwn.body as { items: { _id: string }[] }).items.map(
          (item) => item._id,
        ),
      ).not.toContain(stayId);
      const wrongRole = await nile
        .get(`/api/hotels/${hotelId}/reservations`)
        .expect(403);
      expect(errorOf(wrongRole).code).toBe(ErrorCode.ForbiddenRole);
      await owner.get(`/api/hotels/${hotelId}/reservations`).expect(403);
      await app.expectInvariants();
    });
  },
);
