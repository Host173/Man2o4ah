import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { clearCollections } from '../../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../../test/support/test-app.js';
import type { TestApp } from '../../../../test/support/test-app.js';
import { Session } from '../schemas/session.schema.js';
import { User, UserRole } from '../schemas/user.schema.js';
import { AuthService, hashRefreshToken } from './auth.service.js';

describe('AuthService login and me (integration, ACC-04, ACC-19)', () => {
  let t: TestApp;
  let auth: AuthService;
  let users: Model<User>;
  let sessions: Model<Session>;

  beforeAll(async () => {
    t = await createTestApp();
    auth = t.moduleRef.get(AuthService);
    users = t.connection.model<User>(User.name);
    sessions = t.connection.model<Session>(Session.name);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(() => clearCollections(t.connection));

  async function createUser() {
    return users.create({
      name: 'Aisha',
      email: 'aisha@example.com',
      passwordHash: await bcrypt.hash('abcdefg1', 4),
      role: UserRole.USER,
    });
  }

  it('returns the account and two different tokens; the session holds only the hash', async () => {
    await createUser();

    const result = await auth.login({
      email: 'aisha@example.com',
      password: 'abcdefg1',
    });

    expect(result.user.email).toBe('aisha@example.com');
    expect(result.accessToken).not.toBe(result.refreshToken);
    const stored = await sessions.findOne().lean();
    expect(stored?.refreshTokenHash).toBe(
      hashRefreshToken(result.refreshToken),
    );
    expect(stored?.refreshTokenHash).not.toBe(result.refreshToken);
  });

  it('issues a fresh random refresh token on every login', async () => {
    await createUser();
    const credentials = { email: 'aisha@example.com', password: 'abcdefg1' };

    const first = await auth.login(credentials);
    const second = await auth.login(credentials);

    expect(first.refreshToken).not.toBe(second.refreshToken);
  });

  it('never leaves the password hash on the returned account', async () => {
    await createUser();

    const result = await auth.login({
      email: 'aisha@example.com',
      password: 'abcdefg1',
    });

    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('rejects an unknown email without touching sessions', async () => {
    await expect(
      auth.login({ email: 'nobody@example.com', password: 'abcdefg1' }),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.InvalidCredentials },
    });
    expect(await sessions.countDocuments()).toBe(0);
  });

  it('me() returns the account by ID', async () => {
    const user = await createUser();

    const me = await auth.me(user._id.toString());

    expect(me).toMatchObject({ _id: user._id.toString(), role: 'user' });
  });

  it('me() of an account deleted after the guard ran → 401 SESSION_EXPIRED', async () => {
    await expect(
      auth.me(new Types.ObjectId().toString()),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: ErrorCode.SessionExpired },
    });
  });
});
