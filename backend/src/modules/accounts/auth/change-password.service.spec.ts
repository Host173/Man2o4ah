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
import { AuthService } from './auth.service.js';

const CURRENT = 'abcdefg1';
const NEW = 'hijklmn2';
const MINUTE = 60_000;

describe('AuthService.changePassword (integration, ACC-08, ACC-07a)', () => {
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

  async function createUser(mustChangePassword = false) {
    return users.create({
      name: 'Aisha',
      email: `aisha.${new Types.ObjectId().toHexString()}@example.com`,
      passwordHash: await bcrypt.hash(CURRENT, 4),
      role: UserRole.USER,
      mustChangePassword,
    });
  }

  async function createSession(userId: Types.ObjectId) {
    const now = Date.now();
    return sessions.create({
      userId,
      refreshTokenHash: new Types.ObjectId().toHexString(),
      lastActivityAt: new Date(now),
      expiresAt: new Date(now + 30 * MINUTE),
    });
  }

  const storedHash = async (id: Types.ObjectId) =>
    (await users.findById(id).select('+passwordHash').lean())?.passwordHash ??
    '';

  it('stores a new salted bcrypt hash (cost 12) of the new password only', async () => {
    const user = await createUser();
    const current = await createSession(user._id);

    await auth.changePassword(user._id.toString(), current._id.toString(), {
      currentPassword: CURRENT,
      newPassword: NEW,
    });

    const hash = await storedHash(user._id);
    expect(hash).toMatch(/^\$2b\$12\$/);
    expect(await bcrypt.compare(NEW, hash)).toBe(true);
    expect(await bcrypt.compare(CURRENT, hash)).toBe(false);
  });

  it('clears mustChangePassword (the forced change, ACC-07a)', async () => {
    const user = await createUser(true);
    const current = await createSession(user._id);

    await auth.changePassword(user._id.toString(), current._id.toString(), {
      currentPassword: CURRENT,
      newPassword: NEW,
    });

    const stored = await users.findById(user._id).lean();
    expect(stored?.mustChangePassword).toBe(false);
  });

  it("deletes the user's other sessions, keeps the current one and other users' sessions", async () => {
    const user = await createUser();
    const other = await createUser();
    const current = await createSession(user._id);
    await createSession(user._id);
    await createSession(user._id);
    const othersSession = await createSession(other._id);

    await auth.changePassword(user._id.toString(), current._id.toString(), {
      currentPassword: CURRENT,
      newPassword: NEW,
    });

    const left = await sessions.find().lean();
    expect(left.map((s) => s._id.toString()).sort()).toEqual(
      [current._id.toString(), othersSession._id.toString()].sort(),
    );
  });

  it('wrong current password → 400 VALIDATION_FAILED on currentPassword; nothing changes', async () => {
    const user = await createUser(true);
    const current = await createSession(user._id);
    await createSession(user._id);
    const before = await storedHash(user._id);

    await expect(
      auth.changePassword(user._id.toString(), current._id.toString(), {
        currentPassword: 'wrongpass1',
        newPassword: NEW,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        code: ErrorCode.ValidationFailed,
        details: [expect.objectContaining({ field: 'currentPassword' })],
      },
    });

    expect(await storedHash(user._id)).toBe(before);
    expect((await users.findById(user._id).lean())?.mustChangePassword).toBe(
      true,
    );
    expect(await sessions.countDocuments()).toBe(2);
  });

  it('lets exactly one of two parallel changes with the same current password win', async () => {
    const user = await createUser();
    const current = await createSession(user._id);
    const args = [user._id.toString(), current._id.toString()] as const;

    const results = await Promise.allSettled([
      auth.changePassword(...args, {
        currentPassword: CURRENT,
        newPassword: 'first123',
      }),
      auth.changePassword(...args, {
        currentPassword: CURRENT,
        newPassword: 'second123',
      }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const hash = await storedHash(user._id);
    const matches = await Promise.all([
      bcrypt.compare('first123', hash),
      bcrypt.compare('second123', hash),
    ]);
    expect(matches.filter(Boolean)).toHaveLength(1);
  });

  it('an account deleted after the guard ran → 401 SESSION_EXPIRED', async () => {
    await expect(
      auth.changePassword(
        new Types.ObjectId().toString(),
        new Types.ObjectId().toString(),
        { currentPassword: CURRENT, newPassword: NEW },
      ),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: ErrorCode.SessionExpired },
    });
  });
});
