import { Controller, Delete, Get, Post } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { vi } from 'vitest';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { loginAs } from '../../../../test/support/auth.js';
import { clearCollections } from '../../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../../test/support/test-app.js';
import type { TestApp } from '../../../../test/support/test-app.js';
import { Session } from '../schemas/session.schema.js';
import { User, UserRole } from '../schemas/user.schema.js';

/** Stands in for any other module's authenticated routes. */
@Controller('probe')
class ProbeController {
  @Get('private')
  read() {
    return { ok: true };
  }

  @Post('private')
  write() {
    return { ok: true };
  }

  @Delete('private')
  remove() {
    return { ok: true };
  }
}

const URL = '/api/auth/change-password';
const CURRENT = 'abcdefg1';
const NEW = 'hijklmn2';
const MINUTE = 60_000;

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

describe('PATCH /api/auth/change-password (API, ACC-08, ACC-07a, GEN-13)', () => {
  let t: TestApp;
  let users: Model<User>;
  let sessions: Model<Session>;

  beforeAll(async () => {
    t = await createTestApp({ controllers: [ProbeController] });
    users = t.connection.model<User>(User.name);
    sessions = t.connection.model<Session>(Session.name);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(() => clearCollections(t.connection));

  /** A logged-in account whose password really is CURRENT (low cost: tests only). */
  async function loggedIn(
    role: UserRole = UserRole.USER,
    mustChangePassword = false,
  ) {
    const u = await loginAs(t.connection, role, { mustChangePassword });
    await users.updateOne(
      { _id: u.id },
      { $set: { passwordHash: await bcrypt.hash(CURRENT, 4) } },
    );
    return u;
  }

  async function extraSession(userId: string) {
    const now = Date.now();
    return sessions.create({
      userId: new Types.ObjectId(userId),
      refreshTokenHash: new Types.ObjectId().toHexString(),
      lastActivityAt: new Date(now),
      expiresAt: new Date(now + 30 * MINUTE),
      absoluteExpiresAt: new Date(now + 24 * 60 * MINUTE),
    });
  }

  const storedHash = async (id: string) =>
    (await users.findById(id).select('+passwordHash').lean())?.passwordHash ??
    '';

  const mustChange = async (id: string) =>
    (await users.findById(id).lean())?.mustChangePassword;

  const expectError = (
    res: { status: number; body: Record<string, unknown> },
    status: number,
    code: ErrorCode,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ statusCode: status, code });
  };

  describe('success', () => {
    it.each([
      [UserRole.USER],
      [UserRole.ADMIN],
      [UserRole.AIRLINE_MODERATOR],
      [UserRole.HOTEL_MODERATOR],
    ])(
      '204 for a logged-in %s; the new password is stored hashed',
      async (role) => {
        const u = await loggedIn(role);

        const res = await t
          .http()
          .patch(URL)
          .set('Cookie', u.cookie)
          .send({ currentPassword: CURRENT, newPassword: NEW });

        expect(res.status).toBe(204);
        expect(res.body).toEqual({});
        const hash = await storedHash(u.id);
        expect(hash).toMatch(/^\$2b\$12\$/);
        expect(await bcrypt.compare(NEW, hash)).toBe(true);
      },
    );

    it('204 for a 72-character new password (the bcrypt limit)', async () => {
      const u = await loggedIn();
      const newPassword = `${'a'.repeat(71)}1`;

      const res = await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ currentPassword: CURRENT, newPassword });

      expect(res.status).toBe(204);
      expect(await bcrypt.compare(newPassword, await storedHash(u.id))).toBe(
        true,
      );
    });

    it('logs out every session, including the calling session (data model section 3.2)', async () => {
      const u = await loggedIn();
      await extraSession(u.id);
      await extraSession(u.id);

      await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ currentPassword: CURRENT, newPassword: NEW })
        .expect(204);

      expect(await sessions.countDocuments({ userId: u.id })).toBe(0);
      const me = await t.http().get('/api/auth/me').set('Cookie', u.cookie);
      expectError(me, 401, ErrorCode.SessionExpired);
    });

    it('clears both authentication cookies at their original path', async () => {
      const u = await loggedIn();

      const res = await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ currentPassword: CURRENT, newPassword: NEW });

      expect(res.status).toBe(204);
      const cookies = setCookies(res.headers);
      expect(cookies).toEqual([
        expect.stringMatching(/^access_token=;/),
        expect.stringMatching(/^refresh_token=;/),
      ]);
      for (const cookie of cookies) {
        expect(cookie).toContain('Path=/');
        expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=Lax');
      }
    });
  });

  describe('failures (nothing changes)', () => {
    it('401 NOT_AUTHENTICATED for a guest', async () => {
      const res = await t
        .http()
        .patch(URL)
        .send({ currentPassword: CURRENT, newPassword: NEW });
      expectError(res, 401, ErrorCode.NotAuthenticated);
    });

    it('400 VALIDATION_FAILED on currentPassword when it is wrong', async () => {
      const u = await loggedIn(UserRole.USER, true);
      await extraSession(u.id);
      const before = await storedHash(u.id);

      const res = await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ currentPassword: 'wrongpass1', newPassword: NEW });

      expectError(res, 400, ErrorCode.ValidationFailed);
      expect(res.body.details).toEqual([
        expect.objectContaining({ field: 'currentPassword' }),
      ]);
      expect(await storedHash(u.id)).toBe(before);
      expect(await mustChange(u.id)).toBe(true);
      expect(await sessions.countDocuments({ userId: u.id })).toBe(2);
    });

    it.each([
      ['a 7-character new password', { newPassword: 'abcdef1' }, 'newPassword'],
      [
        'a 73-character new password',
        { newPassword: `${'a'.repeat(72)}1` },
        'newPassword',
      ],
      [
        'a new password without a digit',
        { newPassword: 'abcdefgh' },
        'newPassword',
      ],
      [
        'a new password without a letter',
        { newPassword: '12345678' },
        'newPassword',
      ],
      ['a missing new password', { newPassword: undefined }, 'newPassword'],
      [
        'a missing current password',
        { currentPassword: undefined },
        'currentPassword',
      ],
      ['an empty current password', { currentPassword: '' }, 'currentPassword'],
      [
        'a client-supplied mustChangePassword',
        { mustChangePassword: false },
        'mustChangePassword',
      ],
    ])('400 VALIDATION_FAILED for %s', async (_case, change, field) => {
      const u = await loggedIn(UserRole.USER, true);
      const before = await storedHash(u.id);

      const res = await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ currentPassword: CURRENT, newPassword: NEW, ...change });

      expectError(res, 400, ErrorCode.ValidationFailed);
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
      expect(await storedHash(u.id)).toBe(before);
      expect(await mustChange(u.id)).toBe(true);
    });
  });

  describe('forced change (mustChangePassword, ACC-07a)', () => {
    it.each([['get'], ['post'], ['delete']] as const)(
      '403 PASSWORD_CHANGE_REQUIRED for %s on another module route',
      async (verb) => {
        const u = await loggedIn(UserRole.USER, true);

        const res = await t
          .http()
          [verb]('/api/probe/private')
          .set('Cookie', u.cookie);

        expectError(res, 403, ErrorCode.PasswordChangeRequired);
      },
    );

    it('allows GET /api/auth/me, which reports mustChangePassword: true', async () => {
      const u = await loggedIn(UserRole.HOTEL_MODERATOR, true);

      const res = await t.http().get('/api/auth/me').set('Cookie', u.cookie);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ mustChangePassword: true });
    });

    it('400 VALIDATION_FAILED on newPassword when it equals the temporary password; stays blocked', async () => {
      const u = await loggedIn(UserRole.USER, true);
      await extraSession(u.id);
      const before = await storedHash(u.id);

      const res = await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ currentPassword: CURRENT, newPassword: CURRENT });

      expectError(res, 400, ErrorCode.ValidationFailed);
      expect(res.body.details).toEqual([
        expect.objectContaining({ field: 'newPassword' }),
      ]);
      expect(await storedHash(u.id)).toBe(before);
      expect(await mustChange(u.id)).toBe(true);
      expect(await sessions.countDocuments({ userId: u.id })).toBe(2);
      const blocked = await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', u.cookie);
      expectError(blocked, 403, ErrorCode.PasswordChangeRequired);
    });

    it('a normal change (not forced) may keep the same password: 204', async () => {
      const u = await loggedIn();

      const res = await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ currentPassword: CURRENT, newPassword: CURRENT });

      expect(res.status).toBe(204);
    });

    it('stays blocked after a failed change attempt', async () => {
      const u = await loggedIn(UserRole.USER, true);

      await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ currentPassword: 'wrongpass1', newPassword: NEW })
        .expect(400);

      const res = await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', u.cookie);
      expectError(res, 403, ErrorCode.PasswordChangeRequired);
    });

    it('requires a new login after the forced change, then unblocks the account', async () => {
      const u = await loggedIn(UserRole.AIRLINE_MODERATOR, true);
      const email = (await users.findById(u.id).lean())?.email ?? '';
      await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', u.cookie)
        .expect(403);

      await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ currentPassword: CURRENT, newPassword: NEW })
        .expect(204);

      await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', u.cookie)
        .expect(401);

      const login = await t
        .http()
        .post('/api/auth/login')
        .send({ email, password: NEW });
      expect(login.status).toBe(200);
      expect(login.body.user.mustChangePassword).toBe(false);
      const cookies = setCookies(login.headers);
      const cookie = cookies.map((line) => line.split(';')[0]).join('; ');
      await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', cookie)
        .expect(200);
      await t
        .http()
        .post('/api/probe/private')
        .set('Cookie', cookie)
        .expect(201);
      const me = await t.http().get('/api/auth/me').set('Cookie', cookie);
      expect(me.body).toMatchObject({ mustChangePassword: false });
    });

    it('rejects a temporary-password login checked before the password changes but resumed afterward', async () => {
      const u = await loggedIn(UserRole.USER, true);
      const account = await users.findById(u.id).lean();
      if (!account) throw new Error('Test account was not created');
      let checked = () => {};
      const passwordChecked = new Promise<void>((resolve) => {
        checked = resolve;
      });
      let resume = () => {};
      const resumeLogin = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const compare = bcrypt.compare.bind(bcrypt);
      const paused = vi
        .spyOn(bcrypt, 'compare')
        .mockImplementationOnce(async (password, hash) => {
          const matches = await compare(password, hash);
          checked();
          await resumeLogin;
          return matches;
        });
      const pendingLogin = t
        .http()
        .post('/api/auth/login')
        .send({ email: account.email, password: CURRENT })
        .then((response) => response);

      try {
        await passwordChecked;
        await t
          .http()
          .patch(URL)
          .set('Cookie', u.cookie)
          .send({ currentPassword: CURRENT, newPassword: NEW })
          .expect(204);
      } finally {
        resume();
        paused.mockRestore();
      }

      const login = await pendingLogin;
      expectError(login, 401, ErrorCode.InvalidCredentials);
      expect(login.headers['set-cookie']).toBeUndefined();
      expect(await sessions.countDocuments({ userId: u.id })).toBe(0);
    });

    it('the new password works at login and the temporary one no longer does', async () => {
      const u = await loggedIn(UserRole.USER, true);
      const email = (await users.findById(u.id).lean())?.email ?? '';

      await t
        .http()
        .patch(URL)
        .set('Cookie', u.cookie)
        .send({ currentPassword: CURRENT, newPassword: NEW })
        .expect(204);

      const oldLogin = await t
        .http()
        .post('/api/auth/login')
        .send({ email, password: CURRENT });
      expectError(oldLogin, 401, ErrorCode.InvalidCredentials);
      const newLogin = await t
        .http()
        .post('/api/auth/login')
        .send({ email, password: NEW });
      expect(newLogin.status).toBe(200);
      expect(newLogin.body.user).toMatchObject({ mustChangePassword: false });
    });
  });
});
