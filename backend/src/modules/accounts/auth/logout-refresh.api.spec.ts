import bcrypt from 'bcrypt';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { loginAs } from '../../../../test/support/auth.js';
import { clearCollections } from '../../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../../test/support/test-app.js';
import type { TestApp } from '../../../../test/support/test-app.js';
import { Session } from '../schemas/session.schema.js';
import { User, UserRole } from '../schemas/user.schema.js';
import { AuthService } from './auth.service.js';

const EMAIL = 'aisha@example.com';
const PASSWORD = 'abcdefg1';
const MINUTE = 60_000;

/** The cookies a response sets, by name: the raw `Set-Cookie` line of each. */
function setCookies(headers: Record<string, unknown>): Map<string, string> {
  const raw = headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : [];
  return new Map(lines.map((line) => [line.split('=')[0], line]));
}

/** The `name=value` pair at the start of a `Set-Cookie` line. */
function pair(line: string | undefined): string {
  return line?.split(';')[0] ?? '';
}

/** A cleared cookie: empty, expired, and with the same attributes and path it was set with. */
function expectCleared(line: string | undefined, name: string) {
  expect(line).toBeDefined();
  expect(pair(line)).toBe(`${name}=`);
  expect(line).toMatch(/Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  expect(line).toMatch(/; Path=\//);
  expect(line).toMatch(/; HttpOnly/);
  expect(line).toMatch(/; Secure/);
  expect(line).toMatch(/; SameSite=Lax/);
}

describe('POST /api/auth/logout and /api/auth/refresh (API, ACC-06, ACC-19)', () => {
  let t: TestApp;
  let users: Model<User>;
  let sessions: Model<Session>;

  beforeAll(async () => {
    t = await createTestApp();
    users = t.connection.model<User>(User.name);
    sessions = t.connection.model<Session>(Session.name);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(() => clearCollections(t.connection));

  /** Logs in through the real endpoint; returns both cookie pairs. */
  async function login(role: UserRole = UserRole.USER) {
    await users.create({
      name: 'Aisha',
      email: EMAIL,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role,
    });
    const res = await t
      .http()
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    const cookies = setCookies(res.headers);
    const access = pair(cookies.get('access_token'));
    const refresh = pair(cookies.get('refresh_token'));
    return { access, refresh, both: `${access}; ${refresh}` };
  }

  const expectError = (
    res: { status: number; body: Record<string, unknown> },
    status: number,
    code: ErrorCode,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ statusCode: status, code });
  };

  describe('POST /api/auth/logout', () => {
    it('204, deletes the session and clears both cookies on path /', async () => {
      const c = await login();
      expect(await sessions.countDocuments()).toBe(1);

      const res = await t.http().post('/api/auth/logout').set('Cookie', c.both);

      expect(res.status).toBe(204);
      expect(await sessions.countDocuments()).toBe(0);
      const cookies = setCookies(res.headers);
      expectCleared(cookies.get('access_token'), 'access_token');
      expectCleared(cookies.get('refresh_token'), 'refresh_token');
    });

    it('revokes the server side: the old access and refresh cookies stop working', async () => {
      const c = await login();
      await t.http().post('/api/auth/logout').set('Cookie', c.both).expect(204);

      const me = await t.http().get('/api/auth/me').set('Cookie', c.access);
      expectError(me, 401, ErrorCode.SessionExpired);

      const refresh = await t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', c.refresh);
      expectError(refresh, 401, ErrorCode.SessionExpired);
    });

    it('204 and both cookies cleared without a cookie', async () => {
      const res = await t.http().post('/api/auth/logout');
      expect(res.status).toBe(204);
      const cookies = setCookies(res.headers);
      expectCleared(cookies.get('access_token'), 'access_token');
      expectCleared(cookies.get('refresh_token'), 'refresh_token');
    });

    it('revokes the live session when only the refresh cookie remains', async () => {
      const c = await login();
      const res = await t
        .http()
        .post('/api/auth/logout')
        .set('Cookie', c.refresh)
        .expect(204);

      expect(await sessions.countDocuments()).toBe(0);
      const cookies = setCookies(res.headers);
      expectCleared(cookies.get('access_token'), 'access_token');
      expectCleared(cookies.get('refresh_token'), 'refresh_token');
      const refresh = await t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', c.refresh);
      expectError(refresh, 401, ErrorCode.SessionExpired);
    });

    it('accepts an access-only session without revoking another session', async () => {
      const u = await loginAs(t.connection, UserRole.USER);
      const other = await loginAs(t.connection, UserRole.USER);

      await t
        .http()
        .post('/api/auth/logout')
        .set('Cookie', u.cookie)
        .expect(204);

      expect(await sessions.findById(u.sid)).toBeNull();
      expect(await sessions.findById(other.sid)).not.toBeNull();
    });

    it('is idempotent after logout and after idle expiry', async () => {
      const c = await login();
      await sessions.updateOne({}, { $set: { expiresAt: new Date() } });

      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await t
          .http()
          .post('/api/auth/logout')
          .set('Cookie', c.both)
          .expect(204);
        const cookies = setCookies(res.headers);
        expectCleared(cookies.get('access_token'), 'access_token');
        expectCleared(cookies.get('refresh_token'), 'refresh_token');
      }
      expect(await sessions.countDocuments()).toBe(0);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('204 and a new access_token cookie (15 min); the refresh cookie is not re-sent', async () => {
      const c = await login();

      const res = await t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', c.refresh);

      expect(res.status).toBe(204);
      const cookies = setCookies(res.headers);
      const access = cookies.get('access_token') ?? '';
      expect(pair(access)).toMatch(/^access_token=.+/);
      expect(access).toMatch(/Max-Age=900;/);
      expect(access).toMatch(/; Path=\//);
      expect(access).toMatch(/; HttpOnly/);
      expect(access).toMatch(/; Secure/);
      expect(access).toMatch(/; SameSite=Lax/);
      expect(cookies.has('refresh_token')).toBe(false);
      expect(res.text).toBe('');
    });

    it('works without an access token (public) and the new one is accepted by /me', async () => {
      const c = await login();

      const res = await t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', c.refresh)
        .expect(204);

      const newAccess = pair(setCookies(res.headers).get('access_token'));
      const me = await t.http().get('/api/auth/me').set('Cookie', newAccess);
      expect(me.status).toBe(200);
      expect(me.body.email).toBe(EMAIL);
    });

    it('slides the session: expiresAt becomes now + 30 minutes', async () => {
      const c = await login();
      const old = new Date(Date.now() - 10 * MINUTE);
      await sessions.updateOne(
        {},
        {
          $set: {
            lastActivityAt: old,
            expiresAt: new Date(old.getTime() + 30 * MINUTE),
          },
        },
      );
      const before = Date.now();

      await t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', c.refresh)
        .expect(204);

      const session = await sessions.findOne().lean();
      expect(session?.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(session?.expiresAt.getTime()).toBe(
        (session?.lastActivityAt.getTime() ?? 0) + 30 * MINUTE,
      );
    });

    it.each([
      ['no refresh cookie', () => ''],
      ['an unknown refresh token', () => 'refresh_token=not-a-real-token'],
    ])(
      '401 SESSION_EXPIRED and both cookies cleared for %s',
      async (_name, cookie) => {
        await login();

        const req = t.http().post('/api/auth/refresh');
        const value = cookie();
        const res = await (value ? req.set('Cookie', value) : req);

        expectError(res, 401, ErrorCode.SessionExpired);
        const cookies = setCookies(res.headers);
        expectCleared(cookies.get('access_token'), 'access_token');
        expectCleared(cookies.get('refresh_token'), 'refresh_token');
      },
    );

    it('401 SESSION_EXPIRED and both cookies cleared after 30 idle minutes (ACC-06)', async () => {
      const c = await login();
      await sessions.updateOne({}, { $set: { expiresAt: new Date() } });

      const res = await t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', c.refresh);

      expectError(res, 401, ErrorCode.SessionExpired);
      const cookies = setCookies(res.headers);
      expectCleared(cookies.get('access_token'), 'access_token');
      expectCleared(cookies.get('refresh_token'), 'refresh_token');
    });

    it('keeps both cookies on a non-401 failure (e.g. the database is briefly down)', async () => {
      const c = await login();
      const auth = t.moduleRef.get(AuthService);
      const spy = vi
        .spyOn(auth, 'refresh')
        .mockRejectedValueOnce(new Error('connection reset'));

      try {
        const res = await t
          .http()
          .post('/api/auth/refresh')
          .set('Cookie', c.refresh);

        expectError(res, 500, ErrorCode.InternalError);
        const cookies = setCookies(res.headers);
        expect(cookies.has('access_token')).toBe(false);
        expect(cookies.has('refresh_token')).toBe(false);
      } finally {
        spy.mockRestore();
      }

      // The session survived, so the same cookie works once the error is gone.
      await t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', c.refresh)
        .expect(204);
    });
  });

  describe('idle expiry on any authenticated request (ACC-06)', () => {
    it('401 SESSION_EXPIRED once the session has been idle for 30 minutes', async () => {
      const c = await login();
      await sessions.updateOne({}, { $set: { expiresAt: new Date() } });

      const res = await t.http().get('/api/auth/me').set('Cookie', c.access);

      expectError(res, 401, ErrorCode.SessionExpired);
    });

    describe('absolute expiry on authenticated requests (ACC-06, #27)', () => {
      const t0 = new Date('2026-11-20T10:00:00.000Z').getTime();
      const week = 7 * 24 * 60 * MINUTE;
      const shift = 8 * 60 * MINUTE;

      afterEach(() => vi.useRealTimers());

      it.each([
        [UserRole.ADMIN, shift - 1, 204],
        [UserRole.ADMIN, shift, 401],
        [UserRole.ADMIN, shift + 1, 401],
        [UserRole.USER, shift + MINUTE, 204],
      ])('refresh for %s at %i ms returns %i', async (role, age, status) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(t0);
        const c = await login(role);
        vi.setSystemTime(t0 + age);
        await sessions.updateOne(
          {},
          { $set: { expiresAt: new Date(t0 + age + 30 * MINUTE) } },
        );

        const res = await t
          .http()
          .post('/api/auth/refresh')
          .set('Cookie', c.refresh);

        expect(res.status).toBe(status);
        if (status === 401) {
          expectError(res, 401, ErrorCode.SessionExpired);
          const cookies = setCookies(res.headers);
          expectCleared(cookies.get('access_token'), 'access_token');
          expectCleared(cookies.get('refresh_token'), 'refresh_token');
        }
      });

      it('rejects a still-valid access token at the seven-day session deadline', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(t0);
        const c = await login();
        vi.setSystemTime(t0 + week - 1);
        await sessions.updateOne(
          {},
          { $set: { expiresAt: new Date(t0 + week + 30 * MINUTE) } },
        );
        const refreshed = await t
          .http()
          .post('/api/auth/refresh')
          .set('Cookie', c.refresh)
          .expect(204);
        const access = pair(setCookies(refreshed.headers).get('access_token'));

        vi.setSystemTime(t0 + week);
        const res = await t.http().get('/api/auth/me').set('Cookie', access);

        expectError(res, 401, ErrorCode.SessionExpired);
      });
    });
  });
});
