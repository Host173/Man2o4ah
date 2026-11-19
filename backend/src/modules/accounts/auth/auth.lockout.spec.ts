import bcrypt from 'bcrypt';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { clearCollections } from '../../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../../test/support/test-app.js';
import type { TestApp } from '../../../../test/support/test-app.js';
import { Session } from '../schemas/session.schema.js';
import { User, UserRole, UserStatus } from '../schemas/user.schema.js';
import { AuthService, lockoutMinutesLeft } from './auth.service.js';

const EMAIL = 'aisha@example.com';
const PASSWORD = 'abcdefg1';
const WRONG = 'wrongpass1';
const MINUTE = 60_000;
const NOW = new Date('2026-11-20T10:00:00.000Z').getTime();

describe('lockoutMinutesLeft (unit, ACC-05)', () => {
  it.each([
    [15 * MINUTE, 15],
    [15 * MINUTE - 1, 15],
    [14 * MINUTE + 1, 15],
    [14 * MINUTE, 14],
    [1, 1],
    [MINUTE, 1],
  ])('%i ms left → %i minutes (rounded up)', (msLeft, minutes) => {
    expect(lockoutMinutesLeft(new Date(NOW + msLeft), NOW)).toBe(minutes);
  });
});

describe('AuthService login lockout (integration, ACC-05)', () => {
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

  beforeEach(async () => {
    await clearCollections(t.connection);
    // Fake only Date: the MongoDB driver still needs real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function createUser(status: UserStatus = UserStatus.ACTIVE) {
    return users.create({
      name: 'Aisha',
      email: EMAIL,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: UserRole.USER,
      status,
    });
  }

  const login = (password: string) => auth.login({ email: EMAIL, password });

  const stored = async () => users.findOne({ email: EMAIL }).lean();

  /** `n` wrong passwords one after another; each must be a plain 401. */
  async function failTimes(n: number) {
    for (let i = 0; i < n; i++) {
      await expect(login(WRONG)).rejects.toMatchObject({
        status: 401,
        response: { code: ErrorCode.InvalidCredentials },
      });
    }
  }

  const rejectsLocked = (attempt: Promise<unknown>) =>
    expect(attempt).rejects.toMatchObject({
      status: 401,
      response: { code: ErrorCode.AccountLocked },
    });

  describe('counting failures', () => {
    it('attempts 1-4 are INVALID_CREDENTIALS and only count up', async () => {
      await createUser();

      await failTimes(4);

      const user = await stored();
      expect(user?.failedLoginAttempts).toBe(4);
      expect(user?.lockedUntil ?? null).toBeNull();
    });

    it('the 5th consecutive failure locks for exactly 15 minutes and resets the counter', async () => {
      await createUser();
      await failTimes(4);

      await rejectsLocked(login(WRONG));

      const user = await stored();
      expect(user?.lockedUntil?.getTime()).toBe(NOW + 15 * MINUTE);
      expect(user?.failedLoginAttempts).toBe(0);
    });

    it('a successful login resets the counter, so failures must be consecutive', async () => {
      await createUser();
      await failTimes(4);

      await login(PASSWORD);
      expect((await stored())?.failedLoginAttempts).toBe(0);

      await failTimes(4);
      const user = await stored();
      expect(user?.failedLoginAttempts).toBe(4);
      expect(user?.lockedUntil ?? null).toBeNull();
    });

    it('does not count attempts on a deactivated account', async () => {
      await createUser(UserStatus.DEACTIVATED);

      await failTimes(6);

      expect((await stored())?.failedLoginAttempts).toBe(0);
    });
  });

  describe('while locked', () => {
    async function lockAccount() {
      await createUser();
      await failTimes(4);
      await rejectsLocked(login(WRONG));
    }

    it('refuses the right password, creates no session and leaves the lock as it was', async () => {
      await lockAccount();
      vi.setSystemTime(NOW + 5 * MINUTE);

      await rejectsLocked(login(PASSWORD));

      expect(await sessions.countDocuments()).toBe(0);
      const user = await stored();
      expect(user?.lockedUntil?.getTime()).toBe(NOW + 15 * MINUTE);
      expect(user?.failedLoginAttempts).toBe(0);
    });

    it('a wrong password neither counts nor extends the lock', async () => {
      await lockAccount();
      vi.setSystemTime(NOW + 5 * MINUTE);

      await rejectsLocked(login(WRONG));

      const user = await stored();
      expect(user?.lockedUntil?.getTime()).toBe(NOW + 15 * MINUTE);
      expect(user?.failedLoginAttempts).toBe(0);
    });

    it('is still locked 1 ms before the 15 minutes end', async () => {
      await lockAccount();
      vi.setSystemTime(NOW + 15 * MINUTE - 1);

      await rejectsLocked(login(PASSWORD));
    });

    it('says how many minutes are left in the message', async () => {
      await lockAccount();
      vi.setSystemTime(NOW + 13 * MINUTE + 30_000);

      await expect(login(PASSWORD)).rejects.toMatchObject({
        response: { message: expect.stringMatching(/\b2 minutes\b/) },
      });
    });
  });

  describe('after the lock', () => {
    async function lockAccount() {
      await createUser();
      await failTimes(4);
      await rejectsLocked(login(WRONG));
    }

    it('logs in with the right password at exactly 15 minutes and clears the lock', async () => {
      await lockAccount();
      vi.setSystemTime(NOW + 15 * MINUTE);

      const result = await login(PASSWORD);

      expect(result.user.email).toBe(EMAIL);
      const user = await stored();
      expect(user?.failedLoginAttempts).toBe(0);
      expect(user?.lockedUntil ?? null).toBeNull();
    });

    it('starts counting again from 1: 4 more failures are not a lock, the 5th is', async () => {
      await lockAccount();
      const later = NOW + 15 * MINUTE;
      vi.setSystemTime(later);

      await failTimes(4);
      expect((await stored())?.failedLoginAttempts).toBe(4);

      await rejectsLocked(login(WRONG));
      expect((await stored())?.lockedUntil?.getTime()).toBe(
        later + 15 * MINUTE,
      );
    });
  });

  describe('parallel wrong passwords', () => {
    it('10 at once: exactly 4 INVALID_CREDENTIALS, the rest ACCOUNT_LOCKED, and the account ends locked', async () => {
      await createUser();

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => login(WRONG)),
      );

      const codes = results.map((r) =>
        r.status === 'rejected'
          ? (r.reason as { response: { code: string } }).response.code
          : 'OK',
      );
      expect(
        codes.filter((c) => c === ErrorCode.InvalidCredentials),
      ).toHaveLength(4);
      expect(codes.filter((c) => c === ErrorCode.AccountLocked)).toHaveLength(
        6,
      );
      const user = await stored();
      expect(user?.lockedUntil?.getTime()).toBe(NOW + 15 * MINUTE);
      expect(user?.failedLoginAttempts).toBe(0);
    });

    it('5 at once on a fresh account still lock it', async () => {
      await createUser();

      await Promise.allSettled(Array.from({ length: 5 }, () => login(WRONG)));

      await rejectsLocked(login(PASSWORD));
    });
  });
});
