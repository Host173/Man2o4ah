import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { FakeEvents } from '../../../test/support/fake-events.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { AccountsService } from './accounts.service.js';
import { AuthService } from './auth/auth.service.js';
import { Session } from './schemas/session.schema.js';
import {
  ProviderType,
  User,
  UserRole,
  UserStatus,
} from './schemas/user.schema.js';

const PASSWORD = 'abcdefg1';
const TEMPORARY = 'Temp1234';
const MINUTE = 60_000;

/** The error body a Nest HTTP exception carries. */
async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const e = error as { getStatus(): number; getResponse(): unknown };
    return {
      status: e.getStatus(),
      body: e.getResponse() as { code: string },
    };
  }
  throw new Error('expected the call to throw');
}

describe('AccountsService (integration, ACC-07a, ACC-13, ACC-14, ACC-15, ACC-16)', () => {
  let t: TestApp;
  let accounts: AccountsService;
  let auth: AuthService;
  let users: Model<User>;
  let sessions: Model<Session>;
  const events = new FakeEvents();

  beforeAll(async () => {
    t = await createTestApp({
      override: (b) => b.overrideProvider(AppEvents).useValue(events),
    });
    accounts = t.moduleRef.get(AccountsService);
    auth = t.moduleRef.get(AuthService);
    users = t.connection.model<User>(User.name);
    sessions = t.connection.model<Session>(Session.name);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    events.clear();
  });

  let seq = 0;
  async function createUser(fields: Partial<User> & { createdAt?: Date } = {}) {
    seq += 1;
    return users.create({
      name: `User ${seq}`,
      email: `user${seq}@example.com`,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: UserRole.USER,
      ...fields,
    });
  }

  async function createSession(userId: Types.ObjectId) {
    const now = Date.now();
    return sessions.create({
      userId,
      refreshTokenHash: new Types.ObjectId().toHexString(),
      lastActivityAt: new Date(now),
      expiresAt: new Date(now + 30 * MINUTE),
      absoluteExpiresAt: new Date(now + 24 * 60 * MINUTE),
    });
  }

  const reload = (id: Types.ObjectId) =>
    users.findById(id).select('+passwordHash').lean();

  describe('getProfiles (BLG-02, BLG-05, BLG-12, HTL-23)', () => {
    it('returns id, name, status and createdAt only, for each known ID once', async () => {
      const ali = await createUser({ name: 'Ali', phone: '+20 100 000 0000' });
      const mona = await createUser({ name: 'Mona' });

      const profiles = await accounts.getProfiles([
        ali.id,
        mona.id,
        ali.id,
        new Types.ObjectId().toHexString(),
        'not-an-id',
      ]);

      expect(profiles).toHaveLength(2);
      const byId = new Map(profiles.map((p) => [p.id, p]));
      expect(byId.get(ali.id)).toEqual({
        id: ali.id,
        name: 'Ali',
        status: UserStatus.ACTIVE,
        createdAt: ali.get('createdAt') as Date,
      });
      expect(Object.keys(byId.get(mona.id) ?? {}).sort()).toEqual([
        'createdAt',
        'id',
        'name',
        'status',
      ]);
    });

    it('reports deactivated and suspended authors by status, so readers show "Deleted user" for deactivated ones', async () => {
      const gone = await createUser({
        name: 'Gone',
        status: UserStatus.DEACTIVATED,
      });
      const paused = await createUser({
        name: 'Paused',
        status: UserStatus.SUSPENDED,
      });

      const profiles = await accounts.getProfiles([gone.id, paused.id]);
      const byId = new Map(profiles.map((p) => [p.id, p]));

      expect(byId.get(gone.id)?.status).toBe(UserStatus.DEACTIVATED);
      // ACC-16: a suspended author's content keeps their name.
      expect(byId.get(paused.id)).toMatchObject({
        name: 'Paused',
        status: UserStatus.SUSPENDED,
      });
    });

    it('returns [] for no IDs or only malformed ones, without querying', async () => {
      expect(await accounts.getProfiles([])).toEqual([]);
      expect(await accounts.getProfiles(['x', '123'])).toEqual([]);
    });
  });

  describe('findUserIdsByName (BLG-09)', () => {
    it('matches part of the name case-insensitively, ignoring surrounding spaces', async () => {
      const a = await createUser({ name: 'Aisha Al Rawahi' });
      const b = await createUser({ name: 'RAWAN' });
      await createUser({ name: 'Kareem' });

      expect((await accounts.findUserIdsByName('  raw ')).sort()).toEqual(
        [a.id, b.id].sort(),
      );
    });

    it('treats regex characters literally and returns [] for a blank query', async () => {
      const dotted = await createUser({ name: 'A.B (test)' });
      await createUser({ name: 'AxB' });

      expect(await accounts.findUserIdsByName('A.B (')).toEqual([dotted.id]);
      expect(await accounts.findUserIdsByName('.*')).toEqual([]);
      expect(await accounts.findUserIdsByName('   ')).toEqual([]);
    });
  });

  describe('getModeratorIds (ACC-15)', () => {
    it("returns the provider's moderators whatever their status, matching type and ID", async () => {
      const hotelId = new Types.ObjectId();
      const otherHotel = new Types.ObjectId();
      const moderatorOf = {
        providerType: ProviderType.HOTEL,
        providerId: hotelId,
      };
      const active = await createUser({
        role: UserRole.HOTEL_MODERATOR,
        moderatorOf,
      });
      const suspended = await createUser({
        role: UserRole.HOTEL_MODERATOR,
        moderatorOf,
        status: UserStatus.SUSPENDED,
      });
      await createUser({
        role: UserRole.HOTEL_MODERATOR,
        moderatorOf: {
          providerType: ProviderType.HOTEL,
          providerId: otherHotel,
        },
      });
      // Same ObjectId as the hotel, but an airline: must not match.
      await createUser({
        role: UserRole.AIRLINE_MODERATOR,
        moderatorOf: {
          providerType: ProviderType.AIRLINE,
          providerId: hotelId,
        },
      });

      const ids = await accounts.getModeratorIds(
        ProviderType.HOTEL,
        hotelId.toHexString(),
      );
      expect(ids.sort()).toEqual([active.id, suspended.id].sort());
    });

    it('returns [] when there are none or the ID is malformed', async () => {
      expect(
        await accounts.getModeratorIds(
          ProviderType.AIRLINE,
          new Types.ObjectId().toHexString(),
        ),
      ).toEqual([]);
      expect(
        await accounts.getModeratorIds(ProviderType.AIRLINE, 'a-1'),
      ).toEqual([]);
    });
  });

  describe('listAccounts (ACC-14)', () => {
    async function seedList() {
      const base = Date.UTC(2026, 10, 1);
      const at = (day: number) => new Date(base + day * 24 * 60 * MINUTE);
      const oldUser = await createUser({
        name: 'Omar',
        email: 'omar@example.com',
        createdAt: at(0),
      });
      const mod = await createUser({
        name: 'Hotel Mod',
        email: 'mod@nile.example',
        role: UserRole.HOTEL_MODERATOR,
        moderatorOf: {
          providerType: ProviderType.HOTEL,
          providerId: new Types.ObjectId(),
        },
        createdAt: at(1),
      });
      const suspended = await createUser({
        name: 'Sara',
        email: 'sara@example.com',
        status: UserStatus.SUSPENDED,
        createdAt: at(2),
      });
      const newest = await createUser({
        name: 'Nour',
        email: 'nour@mail.example',
        createdAt: at(3),
      });
      return { oldUser, mod, suspended, newest };
    }

    it('lists newest first in the paginated shape, without private fields', async () => {
      const { oldUser, mod, suspended, newest } = await seedList();

      const page = await accounts.listAccounts({ page: 1, limit: 10 });

      expect(page).toMatchObject({
        page: 1,
        limit: 10,
        total: 4,
        totalPages: 1,
      });
      expect(page.items.map((i) => i.id)).toEqual([
        newest.id,
        suspended.id,
        mod.id,
        oldUser.id,
      ]);
      expect(page.items[2]).toEqual({
        id: mod.id,
        name: 'Hotel Mod',
        email: 'mod@nile.example',
        role: UserRole.HOTEL_MODERATOR,
        status: UserStatus.ACTIVE,
        moderatorOf: {
          providerType: ProviderType.HOTEL,
          providerId: mod.moderatorOf?.providerId.toString(),
        },
        createdAt: mod.get('createdAt') as Date,
      });
      for (const item of page.items) {
        expect(item).not.toHaveProperty('passwordHash');
        expect(item).not.toHaveProperty('failedLoginAttempts');
        expect(item).not.toHaveProperty('_id');
      }
      expect(page.items[0]).not.toHaveProperty('moderatorOf');
    });

    it('pages without overlap, including accounts created at the same instant', async () => {
      const sameTime = new Date(Date.UTC(2026, 10, 5));
      for (let i = 0; i < 5; i += 1) await createUser({ createdAt: sameTime });

      const first = await accounts.listAccounts({ page: 1, limit: 2 });
      const second = await accounts.listAccounts({ page: 2, limit: 2 });
      const third = await accounts.listAccounts({ page: 3, limit: 2 });

      expect(first).toMatchObject({ total: 5, totalPages: 3 });
      const ids = [...first.items, ...second.items, ...third.items].map(
        (i) => i.id,
      );
      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);
    });

    it('filters by role and status and searches name or email', async () => {
      const { mod, suspended, newest } = await seedList();

      const ids = async (q: Parameters<AccountsService['listAccounts']>[0]) =>
        (await accounts.listAccounts(q)).items.map((i) => i.id);

      expect(
        await ids({ page: 1, limit: 10, role: UserRole.HOTEL_MODERATOR }),
      ).toEqual([mod.id]);
      expect(
        await ids({ page: 1, limit: 10, status: UserStatus.SUSPENDED }),
      ).toEqual([suspended.id]);
      expect(await ids({ page: 1, limit: 10, q: 'SAR' })).toEqual([
        suspended.id,
      ]);
      expect(await ids({ page: 1, limit: 10, q: 'mail.example' })).toEqual([
        newest.id,
      ]);
      expect(
        await ids({
          page: 1,
          limit: 10,
          q: 'example',
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
        }),
      ).toEqual([newest.id, (await users.findOne({ name: 'Omar' }))!.id]);
    });

    it('matches regex characters literally and returns an empty page when nothing matches', async () => {
      await seedList();

      expect(
        await accounts.listAccounts({ page: 1, limit: 10, q: '.*' }),
      ).toEqual({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 });
    });
  });

  describe('createModerator (ACC-13)', () => {
    it.each([
      [UserRole.HOTEL_MODERATOR, ProviderType.HOTEL],
      [UserRole.AIRLINE_MODERATOR, ProviderType.AIRLINE],
    ] as const)(
      'creates an active %s linked to the provider who must change the temporary password',
      async (role, providerType) => {
        const providerId = new Types.ObjectId().toHexString();

        const created = await accounts.createModerator({
          name: 'Nile Mod',
          email: 'mod@nile.example',
          role,
          providerId,
          temporaryPassword: TEMPORARY,
        });

        expect(created).toEqual({
          id: expect.any(String),
          name: 'Nile Mod',
          email: 'mod@nile.example',
          role,
          status: UserStatus.ACTIVE,
          moderatorOf: { providerType, providerId },
          createdAt: expect.any(Date),
        });
        const stored = await reload(new Types.ObjectId(created.id));
        expect(stored?.mustChangePassword).toBe(true);
        expect(stored?.passwordHash).toMatch(/^\$2b\$12\$/);
        expect(stored?.passwordHash).not.toContain(TEMPORARY);
        expect(await bcrypt.compare(TEMPORARY, stored!.passwordHash)).toBe(
          true,
        );
      },
    );

    it('lets the new moderator log in with the temporary password, flagged to change it', async () => {
      const providerId = new Types.ObjectId().toHexString();
      await accounts.createModerator({
        name: 'Sky Mod',
        email: 'sky@air.example',
        role: UserRole.AIRLINE_MODERATOR,
        providerId,
        temporaryPassword: TEMPORARY,
      });

      const login = await auth.login({
        email: 'sky@air.example',
        password: TEMPORARY,
      });
      expect(login.user).toMatchObject({
        role: UserRole.AIRLINE_MODERATOR,
        mustChangePassword: true,
        moderatorOf: { providerType: ProviderType.AIRLINE, providerId },
      });
    });

    it('rejects a taken email (any case) with 409 EMAIL_TAKEN', async () => {
      await createUser({ email: 'taken@example.com' });

      const err = await errorOf(
        accounts.createModerator({
          name: 'Dup',
          email: 'TAKEN@example.com',
          role: UserRole.HOTEL_MODERATOR,
          providerId: new Types.ObjectId().toHexString(),
          temporaryPassword: TEMPORARY,
        }),
      );
      expect(err.status).toBe(409);
      expect(err.body.code).toBe(ErrorCode.EmailTaken);
    });

    it('creates exactly one account when the same email is sent twice at once', async () => {
      const input = {
        name: 'Race',
        email: 'race@example.com',
        role: UserRole.HOTEL_MODERATOR,
        providerId: new Types.ObjectId().toHexString(),
        temporaryPassword: TEMPORARY,
      } as const;

      const results = await Promise.allSettled([
        accounts.createModerator(input),
        accounts.createModerator(input),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await users.countDocuments({ email: 'race@example.com' })).toBe(1);
    });

    it('rejects a malformed providerId or an email the schema refuses with 400 VALIDATION_FAILED', async () => {
      const base = {
        name: 'Mod',
        role: UserRole.HOTEL_MODERATOR,
        temporaryPassword: TEMPORARY,
      } as const;

      const badProvider = await errorOf(
        accounts.createModerator({
          ...base,
          email: 'ok@example.com',
          providerId: 'h-1',
        }),
      );
      expect(badProvider.status).toBe(400);
      expect(badProvider.body.code).toBe(ErrorCode.ValidationFailed);

      const badEmail = await errorOf(
        accounts.createModerator({
          ...base,
          email: 'not-an-email',
          providerId: new Types.ObjectId().toHexString(),
        }),
      );
      expect(badEmail.status).toBe(400);
      expect(badEmail.body.code).toBe(ErrorCode.ValidationFailed);
      expect(await users.countDocuments()).toBe(0);
    });
  });

  describe('resetPassword (ACC-07a)', () => {
    it('stores the temporary password hashed, forces a change and deletes every session of that account only', async () => {
      const user = await createUser();
      const other = await createUser();
      await createSession(user._id);
      await createSession(user._id);
      await createSession(other._id);

      await accounts.resetPassword(user.id, TEMPORARY);

      const stored = await reload(user._id);
      expect(stored?.mustChangePassword).toBe(true);
      expect(stored?.passwordHash).toMatch(/^\$2b\$12\$/);
      expect(await bcrypt.compare(TEMPORARY, stored!.passwordHash)).toBe(true);
      expect(await bcrypt.compare(PASSWORD, stored!.passwordHash)).toBe(false);
      expect(await sessions.countDocuments({ userId: user._id })).toBe(0);
      expect(await sessions.countDocuments({ userId: other._id })).toBe(1);
    });

    it('lets the account log in with the temporary password but not the old one', async () => {
      const user = await createUser({ email: 'reset@example.com' });
      await accounts.resetPassword(user.id, TEMPORARY);

      const login = await auth.login({
        email: 'reset@example.com',
        password: TEMPORARY,
      });
      expect(login.user.mustChangePassword).toBe(true);
      const old = await errorOf(
        auth.login({ email: 'reset@example.com', password: PASSWORD }),
      );
      expect(old.status).toBe(401);
    });

    it.each([
      ['unknown', new Types.ObjectId().toHexString()],
      ['malformed', 'u-1'],
    ])('throws 404 NOT_FOUND for an %s account', async (_kind, id) => {
      const err = await errorOf(accounts.resetPassword(id, TEMPORARY));
      expect(err.status).toBe(404);
      expect(err.body.code).toBe(ErrorCode.NotFound);
    });
  });

  describe('suspend and reactivate (ACC-15, ACC-16)', () => {
    it('suspends an active account, deletes only its sessions and emits account.suspended', async () => {
      const user = await createUser();
      const other = await createUser();
      await createSession(user._id);
      await createSession(user._id);
      await createSession(other._id);

      await accounts.suspend(user.id);

      expect((await reload(user._id))?.status).toBe(UserStatus.SUSPENDED);
      expect(await sessions.countDocuments({ userId: user._id })).toBe(0);
      expect(await sessions.countDocuments({ userId: other._id })).toBe(1);
      expect(events.emitted).toEqual([
        { name: Events.AccountSuspended, payload: { userId: user.id } },
      ]);
    });

    it('stops a suspended account from logging in, and reactivation lets it back in', async () => {
      const user = await createUser({ email: 'mod@example.com' });
      const credentials = { email: 'mod@example.com', password: PASSWORD };

      await accounts.suspend(user.id);
      const blocked = await errorOf(auth.login(credentials));
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe(ErrorCode.AccountSuspended);

      await accounts.reactivate(user.id);
      expect((await reload(user._id))?.status).toBe(UserStatus.ACTIVE);
      await expect(auth.login(credentials)).resolves.toBeDefined();
      expect(events.payloadsOf(Events.AccountReactivated)).toEqual([
        { userId: user.id },
      ]);
    });

    it('suspends a moderator the same way (ACC-15)', async () => {
      const mod = await createUser({
        role: UserRole.AIRLINE_MODERATOR,
        moderatorOf: {
          providerType: ProviderType.AIRLINE,
          providerId: new Types.ObjectId(),
        },
      });
      await createSession(mod._id);

      await accounts.suspend(mod.id);

      expect((await reload(mod._id))?.status).toBe(UserStatus.SUSPENDED);
      expect(await sessions.countDocuments({ userId: mod._id })).toBe(0);
    });

    it.each([
      ['suspend', UserStatus.SUSPENDED],
      ['suspend', UserStatus.DEACTIVATED],
      ['reactivate', UserStatus.ACTIVE],
      ['reactivate', UserStatus.DEACTIVATED],
    ] as const)(
      '%s on a %s account → 409 INVALID_STATUS_TRANSITION, nothing changes or is emitted',
      async (action, status) => {
        const user = await createUser({ status });
        await createSession(user._id);

        const err = await errorOf(accounts[action](user.id));

        expect(err.status).toBe(409);
        expect(err.body.code).toBe(ErrorCode.InvalidStatusTransition);
        expect((await reload(user._id))?.status).toBe(status);
        expect(await sessions.countDocuments({ userId: user._id })).toBe(1);
        expect(events.emitted).toEqual([]);
      },
    );

    it.each([
      ['suspend', new Types.ObjectId().toHexString()],
      ['suspend', 'u-1'],
      ['reactivate', new Types.ObjectId().toHexString()],
      ['reactivate', 'u-1'],
    ] as const)('%s(%s) → 404 NOT_FOUND', async (action, id) => {
      const err = await errorOf(accounts[action](id));
      expect(err.status).toBe(404);
      expect(err.body.code).toBe(ErrorCode.NotFound);
      expect(events.emitted).toEqual([]);
    });

    it('lets only one of two parallel suspensions win, emitting one event', async () => {
      const user = await createUser();
      await createSession(user._id);

      const results = await Promise.allSettled([
        accounts.suspend(user.id),
        accounts.suspend(user.id),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(events.payloadsOf(Events.AccountSuspended)).toHaveLength(1);
      expect((await reload(user._id))?.status).toBe(UserStatus.SUSPENDED);
      expect(await sessions.countDocuments({ userId: user._id })).toBe(0);
    });

    it('lets only one of two parallel reactivations win, emitting one event', async () => {
      const user = await createUser({ status: UserStatus.SUSPENDED });

      const results = await Promise.allSettled([
        accounts.reactivate(user.id),
        accounts.reactivate(user.id),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(events.payloadsOf(Events.AccountReactivated)).toHaveLength(1);
    });
  });
});
