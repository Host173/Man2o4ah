import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { Session } from '../../src/modules/accounts/schemas/session.schema.js';
import {
  User,
  UserRole,
} from '../../src/modules/accounts/schemas/user.schema.js';
import { loginAs } from './auth.js';
import { HOOK_TIMEOUT } from './mongo-memory.js';
import { createTestApp } from './test-app.js';
import type { TestApp } from './test-app.js';
import { TEST_JWT_ACCESS_SECRET } from './test-config.js';

const COOKIE_PREFIX = 'access_token=';
const MODERATORS: UserRole[] = [
  UserRole.AIRLINE_MODERATOR,
  UserRole.HOTEL_MODERATOR,
];

describe('loginAs', () => {
  let t: TestApp;
  const jwt = new JwtService({ secret: TEST_JWT_ACCESS_SECRET });

  beforeAll(async () => {
    t = await createTestApp();
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  const sessionOf = async (sid: string) => {
    const session = await t.connection.models[Session.name]?.findById(sid);
    if (!session) throw new Error('session not found');
    return session;
  };

  describe.each(Object.values(UserRole))('as %s', (role) => {
    it('signs a token the guard can verify', async () => {
      const u = await loginAs(t.connection, role);
      expect(u.cookie.startsWith(COOKIE_PREFIX)).toBe(true);
      const payload = await jwt.verifyAsync<{
        sub: string;
        role: string;
        sid: string;
        providerId?: string;
        exp: number;
        iat: number;
      }>(u.cookie.slice(COOKIE_PREFIX.length), {
        secret: TEST_JWT_ACCESS_SECRET,
      });
      expect(payload.sub).toBe(u.id);
      expect(payload.role).toBe(role);
      expect(payload.sid).toBe(u.sid);
      expect(payload.exp - payload.iat).toBe(15 * 60);
    });

    it('sets providerId only for moderators, from moderatorOf', async () => {
      const u = await loginAs(t.connection, role);
      const payload = await jwt.verifyAsync<{ providerId?: string }>(
        u.cookie.slice(COOKIE_PREFIX.length),
        { secret: TEST_JWT_ACCESS_SECRET },
      );
      const saved = await t.connection.models[User.name]?.findById(u.id);
      if (MODERATORS.includes(role)) {
        expect(payload.providerId).toBeDefined();
        expect(payload.providerId).toBe(u.providerId);
        expect(payload.providerId).toBe(
          saved?.moderatorOf?.providerId.toString(),
        );
      } else {
        expect(payload).not.toHaveProperty('providerId');
        expect(u.providerId).toBeUndefined();
        expect(saved?.moderatorOf).toBeUndefined();
      }
    });

    it('creates a live session', async () => {
      const u = await loginAs(t.connection, role);
      const session = await sessionOf(u.sid);
      expect(session.userId.toString()).toBe(u.id);
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  it('matches the provider type to the moderator role', async () => {
    const airline = await loginAs(t.connection, UserRole.AIRLINE_MODERATOR);
    const hotel = await loginAs(t.connection, UserRole.HOTEL_MODERATOR);
    const users = t.connection.models[User.name];
    expect((await users?.findById(airline.id))?.moderatorOf?.providerType).toBe(
      'airline',
    );
    expect((await users?.findById(hotel.id))?.moderatorOf?.providerType).toBe(
      'hotel',
    );
  });

  it('uses the given providerId for a moderator', async () => {
    const providerId = new Types.ObjectId().toHexString();
    const u = await loginAs(t.connection, UserRole.HOTEL_MODERATOR, {
      providerId,
    });
    expect(u.providerId).toBe(providerId);
  });

  it('expires the session with sessionExpired', async () => {
    const u = await loginAs(t.connection, UserRole.USER, {
      sessionExpired: true,
    });
    expect((await sessionOf(u.sid)).expiresAt.getTime()).toBeLessThan(
      Date.now(),
    );
  });

  it('applies status and mustChangePassword', async () => {
    const u = await loginAs(t.connection, UserRole.USER, {
      status: 'suspended',
      mustChangePassword: true,
    });
    const saved = await t.connection.models[User.name]?.findById(u.id);
    expect(saved?.status).toBe('suspended');
    expect(saved?.mustChangePassword).toBe(true);
  });

  it('creates a different user on every call', async () => {
    const a = await loginAs(t.connection, UserRole.USER);
    const b = await loginAs(t.connection, UserRole.USER);
    expect(a.id).not.toBe(b.id);
    const users = t.connection.models[User.name];
    const [userA, userB] = await Promise.all([
      users?.findById(a.id),
      users?.findById(b.id),
    ]);
    expect(userA?.email).not.toBe(userB?.email);
  });
});
