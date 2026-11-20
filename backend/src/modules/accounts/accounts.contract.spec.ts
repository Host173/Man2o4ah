import { NotImplementedException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { AccountsModule } from './accounts.module.js';
import { AccountsService } from './accounts.service.js';
import { Role } from './auth/auth.types.js';
import { ActiveBookingsCheckRegistry } from './ports/active-bookings-check.registry.js';
import { User } from './schemas/user.schema.js';

describe('accounts contract (stubs)', () => {
  let accounts: AccountsService;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: getModelToken(User.name), useValue: {} },
      ],
    }).compile();
    accounts = moduleRef.get(AccountsService);
  });
  const calls: [string, () => unknown][] = [
    ['getProfiles', () => accounts.getProfiles(['u-1'])],
    ['findUserIdsByName', () => accounts.findUserIdsByName('ali')],
    ['getModeratorIds', () => accounts.getModeratorIds('hotel', 'h-1')],
    ['listAccounts', () => accounts.listAccounts({ page: 1, limit: 10 })],
    [
      'createModerator',
      () =>
        accounts.createModerator({
          name: 'Mod',
          email: 'mod@example.com',
          role: Role.HOTEL_MODERATOR,
          providerId: 'h-1',
          temporaryPassword: 'Temp1234',
        }),
    ],
    ['resetPassword', () => accounts.resetPassword('u-1', 'Temp1234')],
    ['suspend', () => accounts.suspend('u-1')],
    ['reactivate', () => accounts.reactivate('u-1')],
  ];

  it.each(calls)(
    '%s fails explicitly until its feature is implemented',
    (_name, call) => {
      expect(call).toThrow(NotImplementedException);
    },
  );
});

describe('accounts contract (wiring)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ imports: [AccountsModule] });
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);
  beforeEach(() => clearCollections(t.connection));

  it('requires a live caller transaction for the booking confirmation fence', async () => {
    const u = await loginAs(t.connection, 'user');
    const accounts = t.moduleRef.get(AccountsService);
    const session = await t.connection.startSession();
    try {
      await expect(
        accounts.tryLockForBookingConfirmation(u.id, { session }),
      ).rejects.toThrow(/active transaction/);
      await session.withTransaction(async () => {
        await expect(
          accounts.tryLockForBookingConfirmation(u.id, { session }),
        ).resolves.toBe(true);
      });
    } finally {
      await session.endSession();
    }
  });

  it.each([
    ['AccountsService', AccountsService],
    ['ActiveBookingsCheckRegistry', ActiveBookingsCheckRegistry],
  ])('exports %s', (_name, token) => {
    expect(t.moduleRef.get(token, { strict: false })).toBeInstanceOf(token);
  });
});
