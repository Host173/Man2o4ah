import { Controller, Get, Patch, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { loginAs } from '../../../../test/support/auth.js';
import { HOOK_TIMEOUT } from '../../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../../test/support/test-app.js';
import type { TestApp } from '../../../../test/support/test-app.js';
import { TEST_JWT_ACCESS_SECRET } from '../../../../test/support/test-config.js';
import { AccountsModule } from '../accounts.module.js';
import { Session } from '../schemas/session.schema.js';
import { User } from '../schemas/user.schema.js';
import { Role } from './auth.types.js';
import type { AuthUser } from './auth.types.js';
import { CurrentUser, Public, Roles } from './decorators.js';

@Controller('probe')
class ProbeController {
  @Get('private')
  private(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Public()
  @Get('public')
  open(@CurrentUser() user: AuthUser | undefined) {
    return { user: user ?? null };
  }

  @Roles(Role.ADMIN)
  @Get('admin')
  admin(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Roles(Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR)
  @Get('moderators')
  moderators(@CurrentUser() user: AuthUser) {
    return user;
  }
}

/** Stands in for the ACC-04/06/08 routes on the must-change-password allow-list. */
@Controller('auth')
class AuthProbeController {
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('me')
  postMe() {
    return {};
  }

  @Patch('change-password')
  changePassword() {
    return {};
  }

  @Post('logout')
  logout() {
    return {};
  }
}

const MINUTE = 60_000;

describe('auth guards (API)', () => {
  let t: TestApp;
  let sessions: Model<Session>;
  let users: Model<User>;
  const jwt = new JwtService({ secret: TEST_JWT_ACCESS_SECRET });

  beforeAll(async () => {
    t = await createTestApp({
      imports: [AccountsModule],
      controllers: [ProbeController, AuthProbeController],
    });
    sessions = t.connection.model<Session>(Session.name);
    users = t.connection.model<User>(User.name);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  const sign = (payload: object, secret = TEST_JWT_ACCESS_SECRET) =>
    new JwtService({ secret }).signAsync(payload, {
      algorithm: 'HS256',
      expiresIn: '15m',
    });

  const expectError = (
    res: { status: number; body: Record<string, unknown> },
    status: number,
    code: ErrorCode,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ statusCode: status, code });
  };

  describe('authentication (JwtAuthGuard)', () => {
    it('401 NOT_AUTHENTICATED without a cookie, in the shared error shape', async () => {
      const res = await t.http().get('/api/probe/private');
      expectError(res, 401, ErrorCode.NotAuthenticated);
      expect(res.body).toMatchObject({ path: '/api/probe/private' });
    });

    it('401 NOT_AUTHENTICATED with an empty access_token cookie', async () => {
      const res = await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', 'access_token=');
      expectError(res, 401, ErrorCode.NotAuthenticated);
    });

    it('ignores a token sent as a Bearer header (cookies only, ACC-19)', async () => {
      const u = await loginAs(t.connection, Role.USER);
      const token = u.cookie.slice('access_token='.length);
      const res = await t
        .http()
        .get('/api/probe/private')
        .set('Authorization', `Bearer ${token}`);
      expectError(res, 401, ErrorCode.NotAuthenticated);
    });

    it('200 with a valid cookie; @CurrentUser() gets { id, role, sid }', async () => {
      const u = await loginAs(t.connection, Role.USER);
      const res = await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', u.cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: u.id, role: Role.USER, sid: u.sid });
    });

    it('includes providerId for moderators', async () => {
      const u = await loginAs(t.connection, Role.HOTEL_MODERATOR);
      const res = await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', u.cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: u.id,
        role: Role.HOTEL_MODERATOR,
        sid: u.sid,
        providerId: u.providerId,
      });
    });

    it('401 TOKEN_EXPIRED for a malformed token', async () => {
      const res = await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', 'access_token=not-a-jwt');
      expectError(res, 401, ErrorCode.TokenExpired);
    });

    it('401 TOKEN_EXPIRED for a token signed with another secret', async () => {
      const u = await loginAs(t.connection, Role.USER);
      const token = await sign(
        { sub: u.id, role: u.role, sid: u.sid },
        'some-other-secret',
      );
      const res = await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', `access_token=${token}`);
      expectError(res, 401, ErrorCode.TokenExpired);
    });

    it('401 TOKEN_EXPIRED for an expired token', async () => {
      const u = await loginAs(t.connection, Role.USER);
      const past = Math.floor(Date.now() / 1000) - 60;
      const token = await jwt.signAsync({
        sub: u.id,
        role: u.role,
        sid: u.sid,
        iat: past - 900,
        exp: past,
      });
      const res = await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', `access_token=${token}`);
      expectError(res, 401, ErrorCode.TokenExpired);
    });

    it.each([
      ['an unknown role', { role: 'superuser' }],
      ['a non-ObjectId sub', { sub: 'abc' }],
      ['a missing sid', { sid: undefined }],
      ['a non-string providerId', { providerId: 42 }],
    ])('401 TOKEN_EXPIRED for a payload with %s', async (_name, change) => {
      const u = await loginAs(t.connection, Role.USER);
      const token = await sign({
        sub: u.id,
        role: u.role,
        sid: u.sid,
        ...change,
      });
      const res = await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', `access_token=${token}`);
      expectError(res, 401, ErrorCode.TokenExpired);
    });

    it('401 SESSION_EXPIRED when the session is past its idle expiry (ACC-06)', async () => {
      const u = await loginAs(t.connection, Role.USER, {
        sessionExpired: true,
      });
      const res = await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', u.cookie);
      expectError(res, 401, ErrorCode.SessionExpired);
    });

    it('401 SESSION_EXPIRED once the session is deleted (logout, revocation)', async () => {
      const u = await loginAs(t.connection, Role.USER);
      await sessions.deleteOne({ _id: u.sid });
      const res = await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', u.cookie);
      expectError(res, 401, ErrorCode.SessionExpired);
    });

    it("401 SESSION_EXPIRED for a token pointing at another user's session", async () => {
      const victim = await loginAs(t.connection, Role.ADMIN);
      const attacker = await loginAs(t.connection, Role.USER);
      const token = await sign({
        sub: attacker.id,
        role: Role.USER,
        sid: victim.sid,
      });
      const res = await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', `access_token=${token}`);
      expectError(res, 401, ErrorCode.SessionExpired);
    });

    it('401 SESSION_EXPIRED when the user no longer exists', async () => {
      const u = await loginAs(t.connection, Role.USER);
      await users.deleteOne({ _id: u.id });
      const res = await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', u.cookie);
      expectError(res, 401, ErrorCode.SessionExpired);
    });
  });

  describe('idle window (ACC-06)', () => {
    it('slides lastActivityAt and expiresAt when the last slide is over a minute old', async () => {
      const u = await loginAs(t.connection, Role.USER);
      const before = Date.now();
      await sessions.updateOne(
        { _id: u.sid },
        {
          $set: {
            lastActivityAt: new Date(before - 2 * MINUTE),
            expiresAt: new Date(before + 28 * MINUTE),
          },
        },
      );

      await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', u.cookie)
        .expect(200);

      const session = await sessions.findById(u.sid).lean();
      expect(session?.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(session?.expiresAt.getTime()).toBe(
        (session?.lastActivityAt.getTime() ?? 0) + 30 * MINUTE,
      );
    });

    it('does not rewrite the session again within the same minute', async () => {
      const u = await loginAs(t.connection, Role.USER);
      const recent = new Date(Date.now() - 30_000);
      const expiresAt = new Date(recent.getTime() + 30 * MINUTE);
      await sessions.updateOne(
        { _id: u.sid },
        { $set: { lastActivityAt: recent, expiresAt } },
      );

      await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', u.cookie)
        .expect(200);

      const session = await sessions.findById(u.sid).lean();
      expect(session?.lastActivityAt).toEqual(recent);
      expect(session?.expiresAt).toEqual(expiresAt);
    });

    it('does not slide a session that was rejected', async () => {
      const u = await loginAs(t.connection, Role.USER, {
        sessionExpired: true,
      });
      const before = await sessions.findById(u.sid).lean();
      await t.http().get('/api/probe/private').set('Cookie', u.cookie);
      const after = await sessions.findById(u.sid).lean();
      expect(after?.expiresAt).toEqual(before?.expiresAt);
    });
  });

  describe('@Public() routes', () => {
    it('let guests in, with no user', async () => {
      const res = await t.http().get('/api/probe/public');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ user: null });
    });

    it('attach the user when a valid cookie is sent', async () => {
      const u = await loginAs(t.connection, Role.USER);
      const res = await t
        .http()
        .get('/api/probe/public')
        .set('Cookie', u.cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        user: { id: u.id, role: Role.USER, sid: u.sid },
      });
    });

    it('treat a bad or expired cookie as a guest instead of failing', async () => {
      const expired = await loginAs(t.connection, Role.USER, {
        sessionExpired: true,
      });
      for (const cookie of ['access_token=not-a-jwt', expired.cookie]) {
        const res = await t
          .http()
          .get('/api/probe/public')
          .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ user: null });
      }
    });
  });

  describe('roles (RolesGuard)', () => {
    it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
      '403 FORBIDDEN_ROLE for %s on an admin route',
      async (role) => {
        const u = await loginAs(t.connection, role);
        const res = await t
          .http()
          .get('/api/probe/admin')
          .set('Cookie', u.cookie);
        expectError(res, 403, ErrorCode.ForbiddenRole);
      },
    );

    it('200 for an admin on an admin route', async () => {
      const u = await loginAs(t.connection, Role.ADMIN);
      await t
        .http()
        .get('/api/probe/admin')
        .set('Cookie', u.cookie)
        .expect(200);
    });

    it('401 (not 403) for a guest on an admin route: authentication runs first', async () => {
      const res = await t.http().get('/api/probe/admin');
      expectError(res, 401, ErrorCode.NotAuthenticated);
    });

    it('accepts both moderator roles on a moderator route, rejects others', async () => {
      for (const role of [Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR]) {
        const u = await loginAs(t.connection, role);
        await t
          .http()
          .get('/api/probe/moderators')
          .set('Cookie', u.cookie)
          .expect(200);
      }
      const admin = await loginAs(t.connection, Role.ADMIN);
      const res = await t
        .http()
        .get('/api/probe/moderators')
        .set('Cookie', admin.cookie);
      expectError(res, 403, ErrorCode.ForbiddenRole);
    });
  });

  describe('must change password (ACC-07a, ACC-13)', () => {
    it('403 PASSWORD_CHANGE_REQUIRED outside the allow-list', async () => {
      const u = await loginAs(t.connection, Role.HOTEL_MODERATOR, {
        mustChangePassword: true,
      });
      const res = await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', u.cookie);
      expectError(res, 403, ErrorCode.PasswordChangeRequired);
    });

    it('allows GET /auth/me, PATCH /auth/change-password and POST /auth/logout', async () => {
      const u = await loginAs(t.connection, Role.USER, {
        mustChangePassword: true,
      });
      await t.http().get('/api/auth/me').set('Cookie', u.cookie).expect(200);
      await t
        .http()
        .patch('/api/auth/change-password')
        .set('Cookie', u.cookie)
        .expect(200);
      await t
        .http()
        .post('/api/auth/logout')
        .set('Cookie', u.cookie)
        .expect(201);
    });

    it('matches the method too: POST /auth/me is blocked', async () => {
      const u = await loginAs(t.connection, Role.USER, {
        mustChangePassword: true,
      });
      const res = await t.http().post('/api/auth/me').set('Cookie', u.cookie);
      expectError(res, 403, ErrorCode.PasswordChangeRequired);
    });

    it('lets the account through once the flag is cleared', async () => {
      const u = await loginAs(t.connection, Role.USER, {
        mustChangePassword: true,
      });
      await users.updateOne(
        { _id: new Types.ObjectId(u.id) },
        { $set: { mustChangePassword: false } },
      );
      await t
        .http()
        .get('/api/probe/private')
        .set('Cookie', u.cookie)
        .expect(200);
    });
  });
});
