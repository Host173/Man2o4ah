import { ConflictException, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import { FakeAccountsService } from './accounts.fake.js';
import type { FakeAccountSeed } from './accounts.fake.js';

const seed: FakeAccountSeed[] = [
  {
    id: 'u-1',
    name: 'Aisha Rawahi',
    email: 'aisha@example.com',
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
  },
  {
    id: 'u-2',
    name: 'Omar Said',
    email: 'Omar@Example.com',
    status: 'suspended',
    createdAt: new Date('2026-11-02T10:00:00.000Z'),
  },
  {
    id: 'a-1',
    name: 'Admin',
    email: 'admin@example.com',
    role: 'admin',
    createdAt: new Date('2026-11-03T10:00:00.000Z'),
  },
  {
    id: 'm-1',
    name: 'Nile Hotel Mod',
    email: 'mod@nile.example',
    role: 'hotel_moderator',
    moderatorOf: { providerType: 'hotel', providerId: 'h-1' },
    createdAt: new Date('2026-11-04T10:00:00.000Z'),
  },
];

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return (error as { getResponse(): { code: string } }).getResponse().code;
  }
  return undefined;
}

describe('FakeAccountsService', () => {
  describe('getProfiles', () => {
    it('returns id, name, status and createdAt only, skipping unknown IDs', async () => {
      const accounts = new FakeAccountsService(seed);
      const profiles = await accounts.getProfiles(['u-2', 'nope', 'u-2']);
      expect(profiles).toEqual([
        {
          id: 'u-2',
          name: 'Omar Said',
          status: 'suspended',
          createdAt: new Date('2026-11-02T10:00:00.000Z'),
        },
      ]);
    });
  });

  describe('findUserIdsByName', () => {
    it('matches part of the name, case-insensitive', async () => {
      const accounts = new FakeAccountsService(seed);
      await expect(accounts.findUserIdsByName('  rawa ')).resolves.toEqual([
        'u-1',
      ]);
    });

    it('treats regex characters literally and returns [] for a blank query', async () => {
      const accounts = new FakeAccountsService(seed);
      await expect(accounts.findUserIdsByName('.*')).resolves.toEqual([]);
      await expect(accounts.findUserIdsByName('   ')).resolves.toEqual([]);
    });
  });

  describe('listAccounts (ACC-14)', () => {
    const ids = (page: { items: { id: string }[] }) =>
      page.items.map((item) => item.id);

    it('lists newest first in the paginated shape, without private fields', async () => {
      const accounts = new FakeAccountsService(seed);
      const page = await accounts.listAccounts({ page: 1, limit: 2 });
      expect(ids(page)).toEqual(['m-1', 'a-1']);
      expect(page).toMatchObject({
        page: 1,
        limit: 2,
        total: 4,
        totalPages: 2,
      });
      expect(page.items[0]).not.toHaveProperty('mustChangePassword');
      expect(page.items[0]).not.toHaveProperty('sessionsRevoked');
    });

    it('returns the second page', async () => {
      const accounts = new FakeAccountsService(seed);
      const page = await accounts.listAccounts({ page: 2, limit: 2 });
      expect(ids(page)).toEqual(['u-2', 'u-1']);
    });

    it('filters by role and status, and searches name or email', async () => {
      const accounts = new FakeAccountsService(seed);
      expect(
        ids(await accounts.listAccounts({ page: 1, limit: 10, role: 'admin' })),
      ).toEqual(['a-1']);
      expect(
        ids(
          await accounts.listAccounts({
            page: 1,
            limit: 10,
            status: 'suspended',
          }),
        ),
      ).toEqual(['u-2']);
      expect(
        ids(await accounts.listAccounts({ page: 1, limit: 10, q: 'NILE' })),
      ).toEqual(['m-1']);
      expect(
        ids(await accounts.listAccounts({ page: 1, limit: 10, q: 'omar@' })),
      ).toEqual(['u-2']);
    });

    it('returns an empty page when nothing matches', async () => {
      const accounts = new FakeAccountsService(seed);
      await expect(
        accounts.listAccounts({ page: 1, limit: 10, q: 'zzz' }),
      ).resolves.toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });
  });

  describe('createModerator (ACC-13)', () => {
    it('creates an active moderator linked to the provider, who must change the password', async () => {
      const accounts = new FakeAccountsService();
      const created = await accounts.createModerator({
        name: ' Sky Mod ',
        email: 'Sky@Air.example',
        role: 'airline_moderator',
        providerId: 'al-1',
        temporaryPassword: 'Temp1234',
      });
      expect(created).toMatchObject({
        name: 'Sky Mod',
        email: 'sky@air.example',
        role: 'airline_moderator',
        status: 'active',
        moderatorOf: { providerType: 'airline', providerId: 'al-1' },
      });
      expect(accounts.get(created.id)).toMatchObject({
        mustChangePassword: true,
        temporaryPassword: 'Temp1234',
      });
    });

    it('rejects a taken email (any case) with 409 EMAIL_TAKEN', async () => {
      const accounts = new FakeAccountsService(seed);
      const call = accounts.createModerator({
        name: 'X',
        email: 'OMAR@example.com',
        role: 'hotel_moderator',
        providerId: 'h-2',
        temporaryPassword: 'Temp1234',
      });
      await expect(call).rejects.toThrow(ConflictException);
      expect(
        await codeOf(
          accounts.createModerator({
            name: 'X',
            email: 'omar@example.com',
            role: 'hotel_moderator',
            providerId: 'h-2',
            temporaryPassword: 'Temp1234',
          }),
        ),
      ).toBe(ErrorCode.EmailTaken);
    });
  });

  describe('resetPassword (ACC-07a)', () => {
    it('sets the temporary password, forces a change and revokes sessions', async () => {
      const accounts = new FakeAccountsService(seed);
      await accounts.resetPassword('u-1', 'Temp9999');
      expect(accounts.get('u-1')).toMatchObject({
        mustChangePassword: true,
        temporaryPassword: 'Temp9999',
        sessionsRevoked: 1,
      });
    });

    it('throws 404 NOT_FOUND for an unknown account', async () => {
      const accounts = new FakeAccountsService(seed);
      await expect(accounts.resetPassword('nope', 'x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('suspend and reactivate (ACC-15, ACC-16)', () => {
    it('suspends an active account and revokes its sessions, then reactivates it', async () => {
      const accounts = new FakeAccountsService(seed);
      await accounts.suspend('u-1');
      expect(accounts.get('u-1')).toMatchObject({
        status: 'suspended',
        sessionsRevoked: 1,
      });
      await accounts.reactivate('u-1');
      expect(accounts.get('u-1')?.status).toBe('active');
    });

    it('409 INVALID_STATUS_TRANSITION from the wrong status', async () => {
      const accounts = new FakeAccountsService(seed);
      expect(await codeOf(accounts.suspend('u-2'))).toBe(
        ErrorCode.InvalidStatusTransition,
      );
      expect(await codeOf(accounts.reactivate('u-1'))).toBe(
        ErrorCode.InvalidStatusTransition,
      );
    });

    it('404 NOT_FOUND for an unknown account', async () => {
      const accounts = new FakeAccountsService(seed);
      expect(await codeOf(accounts.suspend('nope'))).toBe(ErrorCode.NotFound);
      expect(await codeOf(accounts.reactivate('nope'))).toBe(
        ErrorCode.NotFound,
      );
    });
  });

  it('keeps seeds and results independent copies', async () => {
    const rows: FakeAccountSeed[] = [
      { id: 'u-9', name: 'Copy', email: 'c@example.com' },
    ];
    const accounts = new FakeAccountsService(rows);
    rows[0]!.name = 'Changed';
    const stored = accounts.get('u-9');
    if (stored) stored.status = 'suspended';
    expect(accounts.get('u-9')).toMatchObject({
      name: 'Copy',
      status: 'active',
    });
  });
});
