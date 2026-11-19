import { createHash } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { clearCollections } from '../../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../../test/support/test-app.js';
import type { TestApp } from '../../../../test/support/test-app.js';
import { TEST_JWT_ACCESS_SECRET } from '../../../../test/support/test-config.js';
import { Session } from '../schemas/session.schema.js';
import { User, UserRole, UserStatus } from '../schemas/user.schema.js';
import type {
  ProviderType,
  UserStatus as Status,
} from '../schemas/user.schema.js';

const URL = '/api/auth/login';
const EMAIL = 'aisha@example.com';
const PASSWORD = 'abcdefg1';

/** The cookies a response sets, by name: the raw `Set-Cookie` line of each. */
function setCookies(headers: Record<string, unknown>): Map<string, string> {
  const raw = headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : [];
  return new Map(lines.map((line) => [line.split('=')[0], line]));
}

/** The value of one cookie in a `Set-Cookie` line. */
function cookieValue(line: string | undefined): string {
  return line?.split(';')[0].split('=').slice(1).join('=') ?? '';
}

describe('POST /api/auth/login (API, ACC-04, ACC-19)', () => {
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

  /** A stored account with a real bcrypt hash (low cost: tests only). */
  async function createUser(
    overrides: {
      email?: string;
      status?: Status;
      role?: UserRole;
      moderatorOf?: { providerType: ProviderType; providerId: Types.ObjectId };
      mustChangePassword?: boolean;
    } = {},
  ) {
    return users.create({
      name: 'Aisha',
      email: overrides.email ?? EMAIL,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: overrides.role ?? UserRole.USER,
      status: overrides.status ?? UserStatus.ACTIVE,
      mustChangePassword: overrides.mustChangePassword ?? false,
      ...(overrides.moderatorOf ? { moderatorOf: overrides.moderatorOf } : {}),
    });
  }

  const expectError = (
    res: { status: number; body: Record<string, unknown> },
    status: number,
    code: ErrorCode,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ statusCode: status, code });
  };

  describe('success', () => {
    it('200 with { user: MeDto } and nothing secret in the body', async () => {
      const user = await createUser();

      const res = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        user: {
          _id: user._id.toString(),
          name: 'Aisha',
          email: EMAIL,
          role: 'user',
          status: 'active',
          preferredCurrency: 'USD',
          mustChangePassword: false,
        },
      });
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('$2b$');
      expect(body).not.toContain(PASSWORD);
      const cookies = setCookies(res.headers);
      expect(body).not.toContain(cookieValue(cookies.get('access_token')));
      expect(body).not.toContain(cookieValue(cookies.get('refresh_token')));
    });

    it('sets both cookies httpOnly, Secure, SameSite=Lax, path / with their lifetimes', async () => {
      await createUser();

      const res = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: PASSWORD });

      const cookies = setCookies(res.headers);
      const access = cookies.get('access_token') ?? '';
      const refresh = cookies.get('refresh_token') ?? '';
      for (const line of [access, refresh]) {
        expect(line).toMatch(/; HttpOnly/);
        expect(line).toMatch(/; Secure/);
        expect(line).toMatch(/; SameSite=Lax/);
        expect(line).toMatch(/; Path=\//);
      }
      expect(access).toMatch(/Max-Age=900;/);
      expect(refresh).toMatch(/Max-Age=604800;/);
    });

    it('creates one live session that stores only the SHA-256 of the refresh token', async () => {
      const user = await createUser();
      const before = Date.now();

      const res = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: PASSWORD });

      const refresh = cookieValue(setCookies(res.headers).get('refresh_token'));
      expect(refresh).toMatch(/^[A-Za-z0-9_-]{64}$/); // 48 bytes, base64url
      const stored = await sessions.find().lean();
      expect(stored).toHaveLength(1);
      expect(stored[0].userId.toString()).toBe(user._id.toString());
      expect(stored[0].refreshTokenHash).toBe(
        createHash('sha256').update(refresh).digest('hex'),
      );
      expect(JSON.stringify(stored[0])).not.toContain(refresh);
      const idle =
        stored[0].expiresAt.getTime() - stored[0].lastActivityAt.getTime();
      expect(idle).toBe(30 * 60_000);
      expect(stored[0].lastActivityAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('signs { sub, role, sid } into the access token, with nothing sensitive', async () => {
      const user = await createUser();

      const res = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: PASSWORD });

      const token = cookieValue(setCookies(res.headers).get('access_token'));
      const payload = await new JwtService({
        secret: TEST_JWT_ACCESS_SECRET,
      }).verifyAsync<Record<string, unknown>>(token, { algorithms: ['HS256'] });
      const session = await sessions.findOne().lean();
      expect(payload).toMatchObject({
        sub: user._id.toString(),
        role: 'user',
        sid: session?._id.toString(),
      });
      expect(payload).not.toHaveProperty('providerId');
      expect(payload).not.toHaveProperty('email');
      expect(payload).not.toHaveProperty('name');
      expect((payload.exp as number) - (payload.iat as number)).toBe(900);
    });

    it('puts a moderator’s provider in the token and the response', async () => {
      const providerId = new Types.ObjectId();
      await createUser({
        role: UserRole.HOTEL_MODERATOR,
        moderatorOf: { providerType: 'hotel', providerId },
      });

      const res = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        role: 'hotel_moderator',
        moderatorOf: {
          providerType: 'hotel',
          providerId: providerId.toString(),
        },
      });
      const token = cookieValue(setCookies(res.headers).get('access_token'));
      const payload = await new JwtService({
        secret: TEST_JWT_ACCESS_SECRET,
      }).verifyAsync<Record<string, unknown>>(token);
      expect(payload.providerId).toBe(providerId.toString());
    });

    it('logs in an admin (every role can log in)', async () => {
      await createUser({ role: UserRole.ADMIN });

      const res = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('admin');
    });

    it('matches the email whatever its case and surrounding spaces', async () => {
      await createUser();

      const res = await t
        .http()
        .post(URL)
        .send({ email: '  Aisha@EXAMPLE.com ', password: PASSWORD });

      expect(res.status).toBe(200);
    });

    it('logs in an account that must change its password, and says so', async () => {
      await createUser({ mustChangePassword: true });

      const res = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.user.mustChangePassword).toBe(true);
    });

    it('gives each login (device) its own session', async () => {
      await createUser();

      await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);
      await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);

      expect(await sessions.countDocuments()).toBe(2);
    });

    it('returns a cookie that authenticates GET /api/auth/me', async () => {
      const user = await createUser();
      const login = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: PASSWORD });
      const access = cookieValue(setCookies(login.headers).get('access_token'));

      const me = await t
        .http()
        .get('/api/auth/me')
        .set('Cookie', `access_token=${access}`);

      expect(me.status).toBe(200);
      expect(me.body._id).toBe(user._id.toString());
    });
  });

  describe('failure (generic 401 INVALID_CREDENTIALS)', () => {
    it('unknown email and wrong password give the same status, code and message', async () => {
      await createUser();

      const unknown = await t
        .http()
        .post(URL)
        .send({ email: 'nobody@example.com', password: PASSWORD });
      const wrong = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: 'wrongpass1' });

      expectError(unknown, 401, ErrorCode.InvalidCredentials);
      expectError(wrong, 401, ErrorCode.InvalidCredentials);
      expect(unknown.body.message).toBe('Invalid email or password');
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('refuses a deactivated account with the generic error, even with the right password', async () => {
      await createUser({ status: UserStatus.DEACTIVATED });

      const res = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: PASSWORD });

      expectError(res, 401, ErrorCode.InvalidCredentials);
    });

    it('sets no cookies and creates no session on failure', async () => {
      await createUser();

      const res = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: 'wrongpass1' });

      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await sessions.countDocuments()).toBe(0);
    });
  });

  describe('suspended account', () => {
    it('403 ACCOUNT_SUSPENDED with the right password, and no session', async () => {
      await createUser({ status: UserStatus.SUSPENDED });

      const res = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: PASSWORD });

      expectError(res, 403, ErrorCode.AccountSuspended);
      expect(res.body.message).toBe('Your account is suspended');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await sessions.countDocuments()).toBe(0);
    });

    it('401 INVALID_CREDENTIALS with a wrong password (the status is not revealed)', async () => {
      await createUser({ status: UserStatus.SUSPENDED });

      const res = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: 'wrongpass1' });

      expectError(res, 401, ErrorCode.InvalidCredentials);
    });
  });

  describe('lockout (ACC-05)', () => {
    const fail = () =>
      t.http().post(URL).send({ email: EMAIL, password: 'wrongpass1' });

    it('the 5th consecutive wrong password → 401 ACCOUNT_LOCKED with the minutes left', async () => {
      await createUser();
      for (let i = 0; i < 4; i++) {
        expectError(await fail(), 401, ErrorCode.InvalidCredentials);
      }

      const res = await fail();

      expectError(res, 401, ErrorCode.AccountLocked);
      expect(res.body.message).toMatch(/\b15 minutes\b/);
      expect(res.body).not.toHaveProperty('details');
    });

    it('a locked account gets 401 ACCOUNT_LOCKED with the right password, and no cookies', async () => {
      await createUser();
      for (let i = 0; i < 5; i++) await fail();

      const res = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: PASSWORD });

      expectError(res, 401, ErrorCode.AccountLocked);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await sessions.countDocuments()).toBe(0);
    });

    it('an unknown email is never locked, only INVALID_CREDENTIALS', async () => {
      for (let i = 0; i < 6; i++) {
        const res = await t
          .http()
          .post(URL)
          .send({ email: 'nobody@example.com', password: 'wrongpass1' });
        expectError(res, 401, ErrorCode.InvalidCredentials);
      }
    });
  });

  describe('validation (400 VALIDATION_FAILED)', () => {
    it.each([
      ['a missing email', { password: PASSWORD }, 'email'],
      [
        'an invalid email',
        { email: 'not-an-email', password: PASSWORD },
        'email',
      ],
      ['a missing password', { email: EMAIL }, 'password'],
      ['an empty password', { email: EMAIL, password: '' }, 'password'],
      [
        'a non-string password',
        { email: EMAIL, password: 12345678 },
        'password',
      ],
      [
        'an unknown field',
        { email: EMAIL, password: PASSWORD, role: 'admin' },
        'role',
      ],
    ])('rejects %s', async (_case, body, field) => {
      const res = await t.http().post(URL).send(body);

      expectError(res, 400, ErrorCode.ValidationFailed);
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
    });

    it('does not apply the registration password rule (temporary passwords still work)', async () => {
      await users.create({
        name: 'Mod',
        email: EMAIL,
        passwordHash: await bcrypt.hash('short', 4),
        role: UserRole.USER,
      });

      const res = await t
        .http()
        .post(URL)
        .send({ email: EMAIL, password: 'short' });

      expect(res.status).toBe(200);
    });
  });
});
