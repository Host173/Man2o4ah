import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeActiveBookingsCheck } from '../../../../test/fakes/active-bookings-check.fake.js';
import { loginAs } from '../../../../test/support/auth.js';
import { clearCollections } from '../../../../test/support/clear-collections.js';
import { FakeEvents } from '../../../../test/support/fake-events.js';
import { HOOK_TIMEOUT } from '../../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../../test/support/test-app.js';
import type { TestApp } from '../../../../test/support/test-app.js';
import { BookingType } from '../../../common/database/booking-type.js';
import { AppEvents } from '../../../common/events/app-events.service.js';
import { Events } from '../../../common/events/events.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { ActiveBookingsCheckRegistry } from '../ports/active-bookings-check.registry.js';
import { Session } from '../schemas/session.schema.js';
import { User, UserRole, UserStatus } from '../schemas/user.schema.js';

const URL = '/api/users/me';
const PASSWORD = 'abcdefg1';

function setCookies(headers: Record<string, unknown>): string[] {
  const cookies = headers['set-cookie'];
  if (
    !Array.isArray(cookies) ||
    !cookies.every((value: unknown) => typeof value === 'string')
  ) {
    throw new Error('Expected Set-Cookie response headers');
  }
  return cookies;
}

describe('DELETE /api/users/me (API, ACC-12)', () => {
  let t: TestApp;
  let users: Model<User>;
  let sessions: Model<Session>;
  const events = new FakeEvents();
  const flights = new FakeActiveBookingsCheck(BookingType.FLIGHT);
  const hotels = new FakeActiveBookingsCheck(BookingType.HOTEL);

  beforeAll(async () => {
    t = await createTestApp({
      override: (b) => b.overrideProvider(AppEvents).useValue(events),
    });
    const registry = t.moduleRef.get(ActiveBookingsCheckRegistry, {
      strict: false,
    });
    registry.register(flights);
    registry.register(hotels);
    users = t.connection.model<User>(User.name);
    sessions = t.connection.model<Session>(Session.name);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    events.clear();
  });

  const statusOf = async (id: string) =>
    (await users.findById(id).lean())?.status;
  const sessionCount = (id: string) =>
    sessions.countDocuments({ userId: new Types.ObjectId(id) });

  const expectError = (
    res: { status: number; body: Record<string, unknown> },
    status: number,
    code: ErrorCode,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ statusCode: status, code });
  };

  /** Nothing changed: still active, session alive, no event. */
  async function expectUntouched(u: { id: string; cookie: string }) {
    expect(await statusOf(u.id)).toBe(UserStatus.ACTIVE);
    expect(await sessionCount(u.id)).toBe(1);
    expect(events.emitted).toEqual([]);
    await t.http().get('/api/auth/me').set('Cookie', u.cookie).expect(200);
  }

  describe('success', () => {
    it('204: deactivates, deletes the sessions, clears the cookies and emits user.deactivated', async () => {
      const u = await loginAs(t.connection, UserRole.USER);

      const res = await t
        .http()
        .delete(URL)
        .set('Cookie', u.cookie)
        .send({ confirm: true });

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
      expect(await statusOf(u.id)).toBe(UserStatus.DEACTIVATED);
      expect(await sessionCount(u.id)).toBe(0);
      expect(events.payloadsOf(Events.UserDeactivated)).toEqual([
        { userId: u.id },
      ]);
      const cookies = setCookies(res.headers);
      expect(cookies).toEqual([
        expect.stringMatching(/^access_token=;/),
        expect.stringMatching(/^refresh_token=;/),
      ]);
      for (const cookie of cookies) {
        expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      }
    });

    it('the old access cookie stops working right away (401 SESSION_EXPIRED)', async () => {
      const u = await loginAs(t.connection, UserRole.USER);
      await t
        .http()
        .delete(URL)
        .set('Cookie', u.cookie)
        .send({ confirm: true })
        .expect(204);

      const res = await t.http().get('/api/auth/me').set('Cookie', u.cookie);

      expectError(res, 401, ErrorCode.SessionExpired);
    });

    it('a deactivated user cannot log in again (401 INVALID_CREDENTIALS)', async () => {
      const u = await loginAs(t.connection, UserRole.USER);
      await users.updateOne(
        { _id: u.id },
        { $set: { passwordHash: await bcrypt.hash(PASSWORD, 4) } },
      );
      const email = (await users.findById(u.id).lean())?.email;
      await t
        .http()
        .delete(URL)
        .set('Cookie', u.cookie)
        .send({ confirm: true })
        .expect(204);

      const res = await t
        .http()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });

      expectError(res, 401, ErrorCode.InvalidCredentials);
      expect(await sessionCount(u.id)).toBe(0);
    });

    it('rejects an in-flight login that resumes after deactivation commits', async () => {
      const u = await loginAs(t.connection, UserRole.USER);
      await users.updateOne(
        { _id: u.id },
        { $set: { passwordHash: await bcrypt.hash(PASSWORD, 4) } },
      );
      const user = await users.findById(u.id).lean();
      if (!user) throw new Error('Test user missing');
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const original = t.connection.startSession.bind(t.connection);
      const spy = vi
        .spyOn(t.connection, 'startSession')
        .mockImplementationOnce(async (options) => {
          started.resolve();
          await release.promise;
          return original(options);
        });
      const pending = t
        .http()
        .post('/api/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .then((res) => res);
      try {
        await started.promise;
        await t
          .http()
          .delete(URL)
          .set('Cookie', u.cookie)
          .send({ confirm: true })
          .expect(204);
      } finally {
        release.resolve();
        spy.mockRestore();
      }

      const res = await pending;
      expectError(res, 401, ErrorCode.InvalidCredentials);
      expect(await sessionCount(u.id)).toBe(0);
      expect(await statusOf(u.id)).toBe(UserStatus.DEACTIVATED);
    });
  });

  describe('upcoming confirmed bookings', () => {
    it.each([
      ['flight', flights],
      ['hotel', hotels],
    ])(
      '409 ACTIVE_BOOKINGS_EXIST with an upcoming confirmed %s booking; nothing changes',
      async (_type, check) => {
        const u = await loginAs(t.connection, UserRole.USER);
        check.set(u.id, true);
        try {
          const res = await t
            .http()
            .delete(URL)
            .set('Cookie', u.cookie)
            .send({ confirm: true });

          expectError(res, 409, ErrorCode.ActiveBookingsExist);
          expect(res.headers['set-cookie']).toBeUndefined();
          await expectUntouched(u);
        } finally {
          check.set(u.id, false);
        }
      },
    );
  });

  describe('confirmation', () => {
    it.each([
      ['no body', undefined],
      ['an empty body', {}],
      ['confirm: false', { confirm: false }],
      ['confirm: "true" (a string)', { confirm: 'true' }],
      ['confirm: 1', { confirm: 1 }],
      ['confirm: null', { confirm: null }],
      ['an unknown field', { confirm: true, reason: 'bye' }],
    ])(
      '400 VALIDATION_FAILED with %s; nothing changes',
      async (_name, body) => {
        const u = await loginAs(t.connection, UserRole.USER);

        const req = t.http().delete(URL).set('Cookie', u.cookie);
        const res = await (body === undefined ? req : req.send(body));

        expectError(res, 400, ErrorCode.ValidationFailed);
        await expectUntouched(u);
      },
    );
  });

  describe('access', () => {
    it('401 NOT_AUTHENTICATED without a cookie', async () => {
      const res = await t.http().delete(URL).send({ confirm: true });

      expectError(res, 401, ErrorCode.NotAuthenticated);
      expect(events.emitted).toEqual([]);
    });

    it('401 SESSION_EXPIRED with an expired session; nothing changes', async () => {
      const u = await loginAs(t.connection, UserRole.USER, {
        sessionExpired: true,
      });

      const res = await t
        .http()
        .delete(URL)
        .set('Cookie', u.cookie)
        .send({ confirm: true });

      expectError(res, 401, ErrorCode.SessionExpired);
      expect(await statusOf(u.id)).toBe(UserStatus.ACTIVE);
      expect(events.emitted).toEqual([]);
    });

    it.each([
      [UserRole.ADMIN],
      [UserRole.AIRLINE_MODERATOR],
      [UserRole.HOTEL_MODERATOR],
    ])('403 FORBIDDEN_ROLE for a %s; nothing changes', async (role) => {
      const u = await loginAs(t.connection, role);

      const res = await t
        .http()
        .delete(URL)
        .set('Cookie', u.cookie)
        .send({ confirm: true });

      expectError(res, 403, ErrorCode.ForbiddenRole);
      await expectUntouched(u);
    });

    it('403 PASSWORD_CHANGE_REQUIRED while a password change is pending', async () => {
      const u = await loginAs(t.connection, UserRole.USER, {
        mustChangePassword: true,
      });

      const res = await t
        .http()
        .delete(URL)
        .set('Cookie', u.cookie)
        .send({ confirm: true });

      expectError(res, 403, ErrorCode.PasswordChangeRequired);
      expect(await statusOf(u.id)).toBe(UserStatus.ACTIVE);
      expect(events.emitted).toEqual([]);
    });
  });
});
