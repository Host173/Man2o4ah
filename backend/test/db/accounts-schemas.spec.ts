import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { getPlatformCurrency } from '../../src/common/money/platform-currency.js';
import {
  Session,
  SessionSchema,
} from '../../src/modules/accounts/schemas/session.schema.js';
import {
  User,
  UserSchema,
} from '../../src/modules/accounts/schemas/user.schema.js';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

function userDoc(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Mona Adel',
    email: 'mona@example.com',
    passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
    ...overrides,
  };
}

function sessionDoc(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    userId: new Types.ObjectId(),
    refreshTokenHash: 'a'.repeat(64),
    lastActivityAt: now,
    expiresAt: new Date(now.getTime() + 30 * 60_000),
    absoluteExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
    ...overrides,
  };
}

describe('accounts schemas', () => {
  let db: TestDatabase;
  let users: Model<User>;
  let sessions: Model<Session>;

  beforeAll(async () => {
    db = await startTestDatabase('accounts');
    users = db.connection.model<User>(User.name, UserSchema);
    sessions = db.connection.model<Session>(Session.name, SessionSchema);
    await users.init();
    await sessions.init();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await users.deleteMany({});
    await sessions.deleteMany({});
  });

  describe('users', () => {
    it('uses the users collection', () => {
      expect(users.collection.collectionName).toBe('users');
    });

    it('applies defaults', async () => {
      const user = await users.create(userDoc());
      expect(user.role).toBe('user');
      expect(user.status).toBe('active');
      expect(user.preferredCurrency).toBe(getPlatformCurrency());
      expect(user.preferredCurrency).toMatch(/^[A-Z]{3}$/);
      expect(user.mustChangePassword).toBe(false);
      expect(user.failedLoginAttempts).toBe(0);
      expect(user.moderatorOf).toBeUndefined();
      expect(user.get('createdAt')).toBeInstanceOf(Date);
    });

    it('trims and lowercases the email', async () => {
      const user = await users.create(
        userDoc({ email: '  Mona@Example.COM ' }),
      );
      expect(user.email).toBe('mona@example.com');
    });

    it('rejects an invalid email and accepts a valid one', async () => {
      await expect(
        new users(userDoc({ email: 'mona@example' })).validate(),
      ).rejects.toThrow(/email/);
      await expect(
        new users(userDoc({ email: 'not an email' })).validate(),
      ).rejects.toThrow(/email/);
      await expect(
        new users(
          userDoc({ email: 'mona.adel+trips@mail.example.eg' }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects a duplicate email, also when only the case differs', async () => {
      await users.create(userDoc({ email: 'mona@example.com' }));
      await expect(
        users.create(userDoc({ email: 'mona@example.com' })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        users.create(userDoc({ email: 'MONA@Example.com' })),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        users.create(userDoc({ email: 'other@example.com' })),
      ).resolves.toBeDefined();
    });

    it('validates name length after trimming', async () => {
      await expect(
        new users(userDoc({ name: '   ' })).validate(),
      ).rejects.toThrow(/name/);
      await expect(
        new users(userDoc({ name: 'x'.repeat(101) })).validate(),
      ).rejects.toThrow(/name/);
      await expect(
        new users(userDoc({ name: 'x'.repeat(100) })).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects a phone in an invalid format and accepts a valid one', async () => {
      await expect(
        new users(userDoc({ phone: 'call me' })).validate(),
      ).rejects.toThrow(/phone/);
      await expect(
        new users(userDoc({ phone: '+20 (10) 1234-5678' })).validate(),
      ).resolves.toBeUndefined();
    });

    it('requires failedLoginAttempts to be a non-negative integer', async () => {
      await expect(
        new users(userDoc({ failedLoginAttempts: -1 })).validate(),
      ).rejects.toThrow(/failedLoginAttempts/);
      await expect(
        new users(userDoc({ failedLoginAttempts: 1.5 })).validate(),
      ).rejects.toThrow(/failedLoginAttempts/);
      await expect(
        new users(userDoc({ failedLoginAttempts: 4 })).validate(),
      ).resolves.toBeUndefined();
    });

    it('accepts lockedUntil as a date or null', async () => {
      await expect(
        new users(userDoc({ lockedUntil: new Date() })).validate(),
      ).resolves.toBeUndefined();
      await expect(
        new users(userDoc({ lockedUntil: null })).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects a moderator without moderatorOf and accepts one with it', async () => {
      await expect(
        new users(userDoc({ role: 'airline_moderator' })).validate(),
      ).rejects.toThrow(/moderatorOf/);
      await expect(
        new users(userDoc({ role: 'hotel_moderator' })).validate(),
      ).rejects.toThrow(/moderatorOf/);
      await expect(
        new users(
          userDoc({
            role: 'airline_moderator',
            moderatorOf: {
              providerType: 'airline',
              providerId: new Types.ObjectId(),
            },
          }),
        ).validate(),
      ).resolves.toBeUndefined();
      await expect(
        new users(
          userDoc({
            role: 'hotel_moderator',
            moderatorOf: {
              providerType: 'hotel',
              providerId: new Types.ObjectId(),
            },
          }),
        ).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects moderatorOf on a non-moderator role', async () => {
      const moderatorOf = {
        providerType: 'airline',
        providerId: new Types.ObjectId(),
      };
      await expect(
        new users(userDoc({ role: 'user', moderatorOf })).validate(),
      ).rejects.toThrow(/moderatorOf/);
      await expect(
        new users(userDoc({ role: 'admin', moderatorOf })).validate(),
      ).rejects.toThrow(/moderatorOf/);
      await expect(
        new users(userDoc({ role: 'user' })).validate(),
      ).resolves.toBeUndefined();
      await expect(
        new users(userDoc({ role: 'admin' })).validate(),
      ).resolves.toBeUndefined();
    });

    it('rejects a providerType that does not match the moderator role', async () => {
      await expect(
        new users(
          userDoc({
            role: 'airline_moderator',
            moderatorOf: {
              providerType: 'hotel',
              providerId: new Types.ObjectId(),
            },
          }),
        ).validate(),
      ).rejects.toThrow(/moderatorOf/);
      await expect(
        new users(
          userDoc({
            role: 'hotel_moderator',
            moderatorOf: {
              providerType: 'airline',
              providerId: new Types.ObjectId(),
            },
          }),
        ).validate(),
      ).rejects.toThrow(/moderatorOf/);
    });

    it('does not return passwordHash unless selected', async () => {
      await users.create(userDoc());
      const [plain] = await users.find({}).lean();
      expect(plain).not.toHaveProperty('passwordHash');
      expect(plain.email).toBe('mona@example.com');

      const withHash = await users
        .findOne({ email: 'mona@example.com' })
        .select('+passwordHash')
        .lean();
      expect(withHash?.passwordHash).toBe('$2b$10$abcdefghijklmnopqrstuv');
    });

    it('has exactly the indexes from the data model', async () => {
      const indexes = await users.collection.indexes();
      const byKey = indexes.map((index) => ({
        key: index.key,
        unique: index.unique ?? false,
      }));
      expect(byKey).toEqual(
        expect.arrayContaining([
          { key: { _id: 1 }, unique: false },
          { key: { email: 1 }, unique: true },
          { key: { role: 1, status: 1, createdAt: -1 }, unique: false },
          { key: { 'moderatorOf.providerId': 1 }, unique: false },
        ]),
      );
      expect(indexes).toHaveLength(4);
    });
  });

  describe('sessions', () => {
    it('uses the sessions collection', () => {
      expect(sessions.collection.collectionName).toBe('sessions');
    });

    it('requires every field', async () => {
      for (const field of [
        'userId',
        'refreshTokenHash',
        'lastActivityAt',
        'expiresAt',
        'absoluteExpiresAt',
      ]) {
        await expect(
          new sessions(sessionDoc({ [field]: undefined })).validate(),
        ).rejects.toThrow(new RegExp(field));
      }
      await expect(
        new sessions(sessionDoc()).validate(),
      ).resolves.toBeUndefined();
    });

    it('has a userId index and a TTL index on expiresAt', async () => {
      const indexes = await sessions.collection.indexes();
      const ttl = indexes.find((index) => index.key.expiresAt === 1);
      expect(ttl?.expireAfterSeconds).toBe(0);
      expect(indexes.map((index) => index.key)).toEqual(
        expect.arrayContaining([{ _id: 1 }, { userId: 1 }, { expiresAt: 1 }]),
      );
      expect(indexes).toHaveLength(3);
    });
  });
});
