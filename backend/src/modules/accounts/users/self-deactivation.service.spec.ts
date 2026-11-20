import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { FakeActiveBookingsCheck } from '../../../../test/fakes/active-bookings-check.fake.js';
import { loginAs } from '../../../../test/support/auth.js';
import { clearCollections } from '../../../../test/support/clear-collections.js';
import { FakeEvents } from '../../../../test/support/fake-events.js';
import { HOOK_TIMEOUT } from '../../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../../test/support/test-app.js';
import type { TestApp } from '../../../../test/support/test-app.js';
import { BookingType } from '../../../common/database/booking-type.js';
import { AppEvents } from '../../../common/events/app-events.service.js';
import { Events } from '../../../common/events/events.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { ActiveBookingsCheckRegistry } from '../ports/active-bookings-check.registry.js';
import { Session } from '../schemas/session.schema.js';
import { User, UserRole, UserStatus } from '../schemas/user.schema.js';
import { SelfDeactivationService } from './self-deactivation.service.js';

const MINUTE = 60_000;

describe('SelfDeactivationService (integration, port fakes, ACC-12)', () => {
  let t: TestApp;
  let service: SelfDeactivationService;
  let users: Model<User>;
  let sessions: Model<Session>;
  const events = new FakeEvents();
  const flights = new FakeActiveBookingsCheck(BookingType.FLIGHT);
  const hotels = new FakeActiveBookingsCheck(BookingType.HOTEL);

  beforeAll(async () => {
    t = await createTestApp({
      override: (b) => b.overrideProvider(AppEvents).useValue(events),
    });
    const registry = t.moduleRef.get(ActiveBookingsCheckRegistry, {
      strict: false,
    });
    registry.register(flights);
    registry.register(hotels);
    service = t.moduleRef.get(SelfDeactivationService, { strict: false });
    users = t.connection.model<User>(User.name);
    sessions = t.connection.model<Session>(Session.name);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    events.clear();
  });

  async function extraSession(userId: string) {
    const now = Date.now();
    await sessions.create({
      userId: new Types.ObjectId(userId),
      refreshTokenHash: new Types.ObjectId().toHexString(),
      lastActivityAt: new Date(now),
      expiresAt: new Date(now + 30 * MINUTE),
      absoluteExpiresAt: new Date(now + 24 * 60 * MINUTE),
    });
  }

  const statusOf = async (id: string) =>
    (await users.findById(id).lean())?.status;
  const sessionCount = (id: string) =>
    sessions.countDocuments({ userId: new Types.ObjectId(id) });

  it('deactivates the account, deletes every session and emits user.deactivated once', async () => {
    const u = await loginAs(t.connection, UserRole.USER);
    await extraSession(u.id);

    await service.deactivate(u.id);

    expect(await statusOf(u.id)).toBe(UserStatus.DEACTIVATED);
    expect(await sessionCount(u.id)).toBe(0);
    expect(events.emitted).toEqual([
      { name: Events.UserDeactivated, payload: { userId: u.id } },
    ]);
  });

  it('leaves other accounts and their sessions alone', async () => {
    const u = await loginAs(t.connection, UserRole.USER);
    const other = await loginAs(t.connection, UserRole.USER);

    await service.deactivate(u.id);

    expect(await statusOf(other.id)).toBe(UserStatus.ACTIVE);
    expect(await sessionCount(other.id)).toBe(1);
  });

  it.each([
    ['flight', flights],
    ['hotel', hotels],
  ])(
    'refuses with 409 ACTIVE_BOOKINGS_EXIST while the user has an upcoming confirmed %s booking; nothing changes',
    async (_type, check) => {
      const u = await loginAs(t.connection, UserRole.USER);
      await extraSession(u.id);
      check.set(u.id, true);
      try {
        const error = await service.deactivate(u.id).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
          code: ErrorCode.ActiveBookingsExist,
        });
        expect(await statusOf(u.id)).toBe(UserStatus.ACTIVE);
        expect(await sessionCount(u.id)).toBe(2);
        expect(events.emitted).toEqual([]);
      } finally {
        check.set(u.id, false);
      }
    },
  );

  it("isn't blocked by another user's upcoming bookings", async () => {
    const u = await loginAs(t.connection, UserRole.USER);
    const other = await loginAs(t.connection, UserRole.USER);
    flights.set(other.id, true);
    try {
      await service.deactivate(u.id);
      expect(await statusOf(u.id)).toBe(UserStatus.DEACTIVATED);
    } finally {
      flights.set(other.id, false);
    }
  });

  it.each([[UserStatus.SUSPENDED], [UserStatus.DEACTIVATED]])(
    'refuses a %s account with 409 INVALID_STATUS_TRANSITION; nothing changes',
    async (status) => {
      const u = await loginAs(t.connection, UserRole.USER, { status });

      const error = await service.deactivate(u.id).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: ErrorCode.InvalidStatusTransition,
      });
      expect(await statusOf(u.id)).toBe(status);
      expect(await sessionCount(u.id)).toBe(1);
      expect(events.emitted).toEqual([]);
    },
  );

  it('answers 401 SESSION_EXPIRED for an account that no longer exists', async () => {
    const error = await service
      .deactivate(new Types.ObjectId().toHexString())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({
      code: ErrorCode.SessionExpired,
    });
    expect(events.emitted).toEqual([]);
  });

  it('lets exactly one of two parallel deactivations win and emits once', async () => {
    const u = await loginAs(t.connection, UserRole.USER);

    const results = await Promise.allSettled([
      service.deactivate(u.id),
      service.deactivate(u.id),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [rejected] = results.filter((r) => r.status === 'rejected');
    expect((rejected.reason as ConflictException).getResponse()).toMatchObject({
      code: ErrorCode.InvalidStatusTransition,
    });
    expect(await statusOf(u.id)).toBe(UserStatus.DEACTIVATED);
    expect(events.payloadsOf(Events.UserDeactivated)).toEqual([
      { userId: u.id },
    ]);
  });
});

describe('SelfDeactivationService without every booking check registered (ACC-12)', () => {
  let t: TestApp;
  const events = new FakeEvents();

  beforeAll(async () => {
    t = await createTestApp({
      override: (b) => b.overrideProvider(AppEvents).useValue(events),
    });
    // Only flights: hotel-bookings isn't wired yet.
    t.moduleRef
      .get(ActiveBookingsCheckRegistry, { strict: false })
      .register(new FakeActiveBookingsCheck(BookingType.FLIGHT));
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  it('fails instead of deactivating, so bookings are never skipped', async () => {
    const u = await loginAs(t.connection, UserRole.USER);
    const service = t.moduleRef.get(SelfDeactivationService, { strict: false });

    await expect(service.deactivate(u.id)).rejects.toThrow(/hotel/);

    const users = t.connection.model<User>(User.name);
    expect((await users.findById(u.id).lean())?.status).toBe(UserStatus.ACTIVE);
    expect(events.emitted).toEqual([]);
  });
});
