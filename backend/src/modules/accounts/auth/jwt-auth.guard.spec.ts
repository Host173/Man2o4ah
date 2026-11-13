import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { Session } from '../schemas/session.schema.js';
import type { User } from '../schemas/user.schema.js';
import { Role } from './auth.types.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { Public } from './decorators.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const SECRET = 'unit-test-secret';
const MINUTE = 60_000;
const NOW = new Date('2026-11-20T10:00:00.000Z').getTime();

class Probe {
  @Public()
  open() {}
  closed() {}
}

const userId = new Types.ObjectId().toHexString();
const sid = new Types.ObjectId().toHexString();
const providerId = new Types.ObjectId().toHexString();

interface Setup {
  session?: { userId: Types.ObjectId; expiresAt: Date } | null;
  user?: { mustChangePassword: boolean } | null;
}

function setup({ session, user }: Setup = {}) {
  const sessionDoc =
    session === undefined
      ? {
          userId: new Types.ObjectId(userId),
          expiresAt: new Date(NOW + MINUTE),
        }
      : session;
  const userDoc = user === undefined ? { mustChangePassword: false } : user;
  const sessionModel = {
    findById: vi.fn(() => ({ lean: () => Promise.resolve(sessionDoc) })),
    updateOne: vi.fn(() => Promise.resolve({ modifiedCount: 1 })),
  };
  const userModel = {
    findById: vi.fn(() => ({ lean: () => Promise.resolve(userDoc) })),
  };
  const jwt = new JwtService({ secret: SECRET });
  const guard = new JwtAuthGuard(
    new Reflector(),
    jwt,
    sessionModel as unknown as Model<Session>,
    userModel as unknown as Model<User>,
  );
  return { guard, jwt, sessionModel, userModel };
}

function contextFor(
  request: Partial<AuthenticatedRequest>,
  handler: 'open' | 'closed' = 'closed',
): { context: ExecutionContext; request: AuthenticatedRequest } {
  const req = {
    method: 'GET',
    path: '/api/probe',
    cookies: {},
    ...request,
  } as AuthenticatedRequest;
  const proto = Probe.prototype as unknown as Record<string, unknown>;
  const context = {
    getHandler: () => proto[handler],
    getClass: () => Probe,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, request: req };
}

const tokenFor = (jwt: JwtService, payload: object = {}) =>
  jwt.signAsync(
    { sub: userId, role: Role.USER, sid, ...payload },
    { algorithm: 'HS256', expiresIn: '15m' },
  );

const withCookie = (token: string) => ({ cookies: { access_token: token } });

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return (error as { getResponse(): { code: string } }).getResponse().code;
  }
  return undefined;
}

const b64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

describe('JwtAuthGuard (unit)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('tokens', () => {
    it('attaches { id, role, sid } for a valid user token', async () => {
      const { guard, jwt } = setup();
      const { context, request } = contextFor(withCookie(await tokenFor(jwt)));
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual({ id: userId, role: Role.USER, sid });
    });

    it('attaches providerId for a moderator token', async () => {
      const { guard, jwt } = setup();
      const token = await tokenFor(jwt, {
        role: Role.AIRLINE_MODERATOR,
        providerId,
      });
      const { context, request } = contextFor(withCookie(token));
      await guard.canActivate(context);
      expect(request.user).toEqual({
        id: userId,
        role: Role.AIRLINE_MODERATOR,
        sid,
        providerId,
      });
    });

    it('401 NOT_AUTHENTICATED without cookies at all, without touching the database', async () => {
      const { guard, sessionModel } = setup();
      const { context } = contextFor({ cookies: undefined });
      expect(await codeOf(guard.canActivate(context))).toBe(
        ErrorCode.NotAuthenticated,
      );
      expect(sessionModel.findById).not.toHaveBeenCalled();
    });

    it('accepts the token one second before its 15-minute expiry, rejects it at expiry', async () => {
      const { guard, jwt } = setup({
        session: {
          userId: new Types.ObjectId(userId),
          expiresAt: new Date(NOW + 60 * MINUTE),
        },
      });
      const token = await tokenFor(jwt);

      vi.setSystemTime(NOW + 15 * MINUTE - 1000);
      await expect(
        guard.canActivate(contextFor(withCookie(token)).context),
      ).resolves.toBe(true);

      vi.setSystemTime(NOW + 15 * MINUTE);
      expect(
        await codeOf(guard.canActivate(contextFor(withCookie(token)).context)),
      ).toBe(ErrorCode.TokenExpired);
    });

    it('rejects an unsigned token (alg "none") with 401 TOKEN_EXPIRED', async () => {
      const { guard } = setup();
      const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
        sub: userId,
        role: Role.ADMIN,
        sid,
        exp: Math.floor(NOW / 1000) + 900,
      })}.`;
      expect(
        await codeOf(guard.canActivate(contextFor(withCookie(token)).context)),
      ).toBe(ErrorCode.TokenExpired);
    });

    it('rejects a token signed with another algorithm (HS512, same secret)', async () => {
      const { guard, jwt } = setup();
      const token = await jwt.signAsync(
        { sub: userId, role: Role.USER, sid },
        { algorithm: 'HS512', expiresIn: '15m' },
      );
      expect(
        await codeOf(guard.canActivate(contextFor(withCookie(token)).context)),
      ).toBe(ErrorCode.TokenExpired);
    });
  });

  describe('session', () => {
    it('looks up the session by sid and the user by sub', async () => {
      const { guard, jwt, sessionModel, userModel } = setup();
      await guard.canActivate(
        contextFor(withCookie(await tokenFor(jwt))).context,
      );
      expect(sessionModel.findById).toHaveBeenCalledWith(
        sid,
        expect.anything(),
      );
      expect(userModel.findById).toHaveBeenCalledWith(
        userId,
        expect.anything(),
      );
    });

    it('rejects a session whose expiresAt is exactly now (boundary), accepts one 1 ms later', async () => {
      const expired = setup({
        session: {
          userId: new Types.ObjectId(userId),
          expiresAt: new Date(NOW),
        },
      });
      expect(
        await codeOf(
          expired.guard.canActivate(
            contextFor(withCookie(await tokenFor(expired.jwt))).context,
          ),
        ),
      ).toBe(ErrorCode.SessionExpired);
      expect(expired.sessionModel.updateOne).not.toHaveBeenCalled();

      const live = setup({
        session: {
          userId: new Types.ObjectId(userId),
          expiresAt: new Date(NOW + 1),
        },
      });
      await expect(
        live.guard.canActivate(
          contextFor(withCookie(await tokenFor(live.jwt))).context,
        ),
      ).resolves.toBe(true);
    });

    it.each([
      ['the session is missing', { session: null }],
      ['the user is missing', { user: null }],
      [
        'the session belongs to another user',
        {
          session: {
            userId: new Types.ObjectId(),
            expiresAt: new Date(NOW + MINUTE),
          },
        },
      ],
    ])('401 SESSION_EXPIRED when %s', async (_name, options: Setup) => {
      const { guard, jwt } = setup(options);
      const call = guard.canActivate(
        contextFor(withCookie(await tokenFor(jwt))).context,
      );
      await expect(call).rejects.toThrow(UnauthorizedException);
      expect(
        await codeOf(
          guard.canActivate(
            contextFor(withCookie(await tokenFor(jwt))).context,
          ),
        ),
      ).toBe(ErrorCode.SessionExpired);
    });

    it('slides only if the last activity is over a minute old, to now + 30 minutes', async () => {
      const { guard, jwt, sessionModel } = setup();
      await guard.canActivate(
        contextFor(withCookie(await tokenFor(jwt))).context,
      );
      expect(sessionModel.updateOne).toHaveBeenCalledWith(
        { _id: sid, lastActivityAt: { $lt: new Date(NOW - MINUTE) } },
        {
          $set: {
            lastActivityAt: new Date(NOW),
            expiresAt: new Date(NOW + 30 * MINUTE),
          },
        },
      );
    });
  });

  describe('must change password', () => {
    const mustChange = () => setup({ user: { mustChangePassword: true } });

    it.each([
      ['GET', '/api/auth/me'],
      ['GET', '/api/auth/me/'],
      ['PATCH', '/api/auth/change-password'],
      ['POST', '/api/auth/logout'],
    ])('allows %s %s', async (method, path) => {
      const { guard, jwt } = mustChange();
      const { context } = contextFor({
        ...withCookie(await tokenFor(jwt)),
        method,
        path,
      });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it.each([
      ['GET', '/api/probe'],
      ['DELETE', '/api/auth/me'],
      ['GET', '/api/auth/me/extra'],
      ['GET', '/auth/me'],
    ])('403 PASSWORD_CHANGE_REQUIRED for %s %s', async (method, path) => {
      const { guard, jwt } = mustChange();
      const call = guard.canActivate(
        contextFor({ ...withCookie(await tokenFor(jwt)), method, path })
          .context,
      );
      await expect(call).rejects.toThrow(ForbiddenException);
      expect(
        await codeOf(
          guard.canActivate(
            contextFor({ ...withCookie(await tokenFor(jwt)), method, path })
              .context,
          ),
        ),
      ).toBe(ErrorCode.PasswordChangeRequired);
    });
  });

  describe('@Public() routes', () => {
    it('pass a guest without querying the database', async () => {
      const { guard, sessionModel } = setup();
      const { context, request } = contextFor({}, 'open');
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBeUndefined();
      expect(sessionModel.findById).not.toHaveBeenCalled();
    });

    it('treat an account that must change its password as a guest', async () => {
      const { guard, jwt } = setup({ user: { mustChangePassword: true } });
      const { context, request } = contextFor(
        withCookie(await tokenFor(jwt)),
        'open',
      );
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    it('attach a logged-in user', async () => {
      const { guard, jwt } = setup();
      const { context, request } = contextFor(
        withCookie(await tokenFor(jwt)),
        'open',
      );
      await guard.canActivate(context);
      expect(request.user?.id).toBe(userId);
    });
  });

  describe('temporary public routes (until health has @Public)', () => {
    it.each([
      ['GET', '/api/health'],
      ['GET', '/api/health/'],
    ])('let a guest through %s %s', async (method, path) => {
      const { guard } = setup();
      const { context, request } = contextFor({ method, path });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    it.each([
      ['POST', '/api/health'],
      ['GET', '/api/health/details'],
      ['GET', '/health'],
    ])('do not open %s %s', async (method, path) => {
      const { guard } = setup();
      expect(
        await codeOf(guard.canActivate(contextFor({ method, path }).context)),
      ).toBe(ErrorCode.NotAuthenticated);
    });
  });

  describe('without JWT_ACCESS_SECRET (fails closed)', () => {
    const noSecretGuard = () => {
      const base = setup();
      const guard = new JwtAuthGuard(
        new Reflector(),
        new JwtService({}),
        base.sessionModel as unknown as Model<Session>,
        base.userModel as unknown as Model<User>,
      );
      return { guard, signer: base.jwt, sessionModel: base.sessionModel };
    };

    it('rejects every token with 401 TOKEN_EXPIRED and never reads a session', async () => {
      const { guard, signer, sessionModel } = noSecretGuard();
      const token = await tokenFor(signer);
      expect(
        await codeOf(guard.canActivate(contextFor(withCookie(token)).context)),
      ).toBe(ErrorCode.TokenExpired);
      expect(sessionModel.findById).not.toHaveBeenCalled();
    });

    it('still lets guests and cookie holders use public routes, as guests', async () => {
      const { guard, signer } = noSecretGuard();
      const { context, request } = contextFor(
        withCookie(await tokenFor(signer)),
        'open',
      );
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });
  });
});
