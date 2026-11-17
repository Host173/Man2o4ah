import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { clearCollections } from '../../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../../test/support/test-app.js';
import type { TestApp } from '../../../../test/support/test-app.js';
import { Session } from '../schemas/session.schema.js';
import { User, UserRole, UserStatus } from '../schemas/user.schema.js';
import { AuthService, hashRefreshToken } from './auth.service.js';

const MINUTE = 60_000;
const IDLE = 30 * MINUTE;
const T0 = new Date('2026-11-20T10:00:00.000Z').getTime();

/** The error code a rejected promise carries. */
async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(UnauthorizedException);
    return ((error as UnauthorizedException).getResponse() as { code: string })
      .code;
  }
  return undefined;
}

describe('AuthService refresh and logout (integration, ACC-06, ACC-19)', () => {
  let t: TestApp;
  let auth: AuthService;
  let users: Model<User>;
  let sessions: Model<Session>;
  const jwt = new JwtService();

  beforeAll(async () => {
    t = await createTestApp();
    auth = t.moduleRef.get(AuthService);
    users = t.connection.model<User>(User.name);
    sessions = t.connection.model<Session>(Session.name);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    // Only Date is faked, so the in-memory MongoDB keeps its real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });

  afterEach(() => vi.useRealTimers());

  async function loginAt(email = 'aisha@example.com') {
    await users.create({
      name: 'Aisha',
      email,
      passwordHash: await bcrypt.hash('abcdefg1', 4),
      role: UserRole.USER,
    });
    return auth.login({ email, password: 'abcdefg1' });
  }

  describe('refresh: 30-minute idle boundary', () => {
    it('works 1 ms before the session expires, fails exactly at expiry', async () => {
      const { refreshToken } = await loginAt();

      vi.setSystemTime(T0 + IDLE - 1);
      await expect(auth.refresh(refreshToken)).resolves.toEqual(
        expect.any(String),
      );

      // That refresh slid the window: idle again for exactly 30 minutes.
      vi.setSystemTime(T0 + IDLE - 1 + IDLE);
      expect(await codeOf(auth.refresh(refreshToken))).toBe(
        ErrorCode.SessionExpired,
      );
    });

    it('fails at exactly 30 idle minutes after login (expiresAt = now)', async () => {
      const { refreshToken } = await loginAt();

      vi.setSystemTime(T0 + IDLE);

      expect(await codeOf(auth.refresh(refreshToken))).toBe(
        ErrorCode.SessionExpired,
      );
    });

    it('slides lastActivityAt to now and expiresAt to now + 30 minutes', async () => {
      const { refreshToken } = await loginAt();

      vi.setSystemTime(T0 + 20 * MINUTE);
      await auth.refresh(refreshToken);

      const session = await sessions.findOne().lean();
      expect(session?.lastActivityAt).toEqual(new Date(T0 + 20 * MINUTE));
      expect(session?.expiresAt).toEqual(new Date(T0 + 20 * MINUTE + IDLE));
    });
  });

  describe('refresh: the new access token', () => {
    it('carries the same sub, role and sid; the refresh token is not rotated', async () => {
      const login = await loginAt();
      const before = await sessions.findOne().lean();
      const original = jwt.decode<{ sub: string; role: string; sid: string }>(
        login.accessToken,
      );

      vi.setSystemTime(T0 + 5 * MINUTE);
      const accessToken = await auth.refresh(login.refreshToken);

      const payload = jwt.decode<{
        sub: string;
        role: string;
        sid: string;
        exp: number;
        iat: number;
      }>(accessToken);
      expect(payload).toMatchObject({
        sub: original.sub,
        role: 'user',
        sid: original.sid,
      });
      expect(payload.exp - payload.iat).toBe(15 * 60);
      const after = await sessions.findOne().lean();
      expect(after?.refreshTokenHash).toBe(before?.refreshTokenHash);
      expect(after?.refreshTokenHash).toBe(
        hashRefreshToken(login.refreshToken),
      );
      // Parallel refreshes with the same token all succeed.
      await expect(
        Promise.all([
          auth.refresh(login.refreshToken),
          auth.refresh(login.refreshToken),
        ]),
      ).resolves.toHaveLength(2);
    });
  });

  describe('refresh: rejected with 401 SESSION_EXPIRED', () => {
    it.each([
      ['no token', undefined],
      ['an empty token', ''],
      ['an unknown token', 'not-a-real-refresh-token'],
    ])('for %s', async (_name, token) => {
      await loginAt();
      expect(await codeOf(auth.refresh(token))).toBe(ErrorCode.SessionExpired);
    });

    it('after logout (the session is revoked)', async () => {
      const { refreshToken, accessToken } = await loginAt();
      const { sid } = jwt.decode<{ sid: string }>(accessToken);

      await auth.logout(sid);

      expect(await codeOf(auth.refresh(refreshToken))).toBe(
        ErrorCode.SessionExpired,
      );
    });

    it.each([UserStatus.SUSPENDED, UserStatus.DEACTIVATED])(
      'when the account is %s',
      async (status) => {
        const { refreshToken } = await loginAt();
        await users.updateOne({}, { $set: { status } });

        expect(await codeOf(auth.refresh(refreshToken))).toBe(
          ErrorCode.SessionExpired,
        );
      },
    );

    it('when the account no longer exists', async () => {
      const { refreshToken } = await loginAt();
      await users.deleteMany({});

      expect(await codeOf(auth.refresh(refreshToken))).toBe(
        ErrorCode.SessionExpired,
      );
    });
  });

  describe('logout', () => {
    it("deletes only this session, not the user's other devices", async () => {
      const first = await loginAt();
      const second = await auth.login({
        email: 'aisha@example.com',
        password: 'abcdefg1',
      });
      const { sid } = jwt.decode<{ sid: string }>(first.accessToken);

      await auth.logout(sid);

      expect(await sessions.findById(sid).lean()).toBeNull();
      await expect(auth.refresh(second.refreshToken)).resolves.toEqual(
        expect.any(String),
      );
    });

    it('is harmless when the session is already gone', async () => {
      const { accessToken } = await loginAt();
      const { sid } = jwt.decode<{ sid: string }>(accessToken);

      await auth.logout(sid);
      await expect(auth.logout(sid)).resolves.toBeUndefined();
    });
  });
});
