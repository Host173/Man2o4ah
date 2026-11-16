import { ErrorCode } from '../../../common/errors/error-codes.js';
import { loginAs } from '../../../../test/support/auth.js';
import { clearCollections } from '../../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../../test/support/test-app.js';
import type { TestApp } from '../../../../test/support/test-app.js';
import { Session } from '../schemas/session.schema.js';
import { UserRole } from '../schemas/user.schema.js';

const URL = '/api/auth/me';

describe('GET /api/auth/me (API, ACC-04, ACC-19)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(() => clearCollections(t.connection));

  it('200 with the logged-in account as MeDto, nothing secret', async () => {
    const u = await loginAs(t.connection, UserRole.USER);

    const res = await t.http().get(URL).set('Cookie', u.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      _id: u.id,
      name: 'Test user',
      email: expect.stringContaining('@test.local'),
      role: 'user',
      status: 'active',
      preferredCurrency: 'USD',
      mustChangePassword: false,
    });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('failedLoginAttempts');
    expect(body).not.toContain(u.cookie.split('=')[1]);
  });

  it.each([UserRole.AIRLINE_MODERATOR, UserRole.HOTEL_MODERATOR])(
    'includes moderatorOf for a %s',
    async (role) => {
      const u = await loginAs(t.connection, role);

      const res = await t.http().get(URL).set('Cookie', u.cookie);

      expect(res.status).toBe(200);
      expect(res.body.moderatorOf).toEqual({
        providerType: role === UserRole.AIRLINE_MODERATOR ? 'airline' : 'hotel',
        providerId: u.providerId,
      });
    },
  );

  it('200 for an account that must change its password (allowed route)', async () => {
    const u = await loginAs(t.connection, UserRole.USER, {
      mustChangePassword: true,
    });

    const res = await t.http().get(URL).set('Cookie', u.cookie);

    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
  });

  it('401 NOT_AUTHENTICATED without a cookie', async () => {
    const res = await t.http().get(URL);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.NotAuthenticated);
  });

  it('401 TOKEN_EXPIRED with a tampered token', async () => {
    const u = await loginAs(t.connection, UserRole.USER);

    const res = await t.http().get(URL).set('Cookie', `${u.cookie}x`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.TokenExpired);
  });

  it('401 SESSION_EXPIRED when the session is idle-expired', async () => {
    const u = await loginAs(t.connection, UserRole.USER, {
      sessionExpired: true,
    });

    const res = await t.http().get(URL).set('Cookie', u.cookie);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.SessionExpired);
  });

  it('401 SESSION_EXPIRED once the session is deleted (revoked)', async () => {
    const u = await loginAs(t.connection, UserRole.USER);
    await t.connection.model(Session.name).deleteMany({});

    const res = await t.http().get(URL).set('Cookie', u.cookie);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.SessionExpired);
  });
});
