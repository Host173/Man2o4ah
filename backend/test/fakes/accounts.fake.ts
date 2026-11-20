import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import { toPage } from '../../src/common/pagination/paginated.js';
import type { Paginated } from '../../src/common/pagination/paginated.js';
import { keywordRegex } from '../../src/common/text/escape-regex.js';
import type { AccountsService } from '../../src/modules/accounts/accounts.service.js';
import type {
  AccountListItem,
  AccountListQuery,
  AccountProfile,
  CreateModeratorInput,
} from '../../src/modules/accounts/accounts.types.js';
import {
  ProviderType,
  UserRole,
  UserStatus,
} from '../../src/modules/accounts/schemas/user.schema.js';
import type { PublicApi } from './public-api.js';

/** An account as the fake stores it. `get(id)` returns a copy. */
export interface FakeAccount extends AccountListItem {
  mustChangePassword: boolean;
  /** The last temporary password set by `createModerator` or `resetPassword`. */
  temporaryPassword?: string;
  /** How many times the account's sessions were revoked (reset, suspension). */
  sessionsRevoked: number;
}

/** A seed row; omitted fields get defaults (role user, active, createdAt now). */
export type FakeAccountSeed = Pick<FakeAccount, 'id' | 'name' | 'email'> &
  Partial<Omit<FakeAccount, 'id' | 'name' | 'email'>>;

const copy = (account: FakeAccount): FakeAccount => ({
  ...account,
  ...(account.moderatorOf ? { moderatorOf: { ...account.moderatorOf } } : {}),
  createdAt: new Date(account.createdAt),
});

const toListItem = ({
  mustChangePassword: _m,
  temporaryPassword: _t,
  sessionsRevoked: _s,
  ...item
}: FakeAccount): AccountListItem => ({
  ...item,
  ...(item.moderatorOf ? { moderatorOf: { ...item.moderatorOf } } : {}),
  createdAt: new Date(item.createdAt),
});

const PROVIDER_TYPE = {
  [UserRole.AIRLINE_MODERATOR]: ProviderType.AIRLINE,
  [UserRole.HOTEL_MODERATOR]: ProviderType.HOTEL,
} as const;

/**
 * A working, in-memory `AccountsService` (CTR-01) for other modules' tests.
 * Seed accounts in the constructor; `get(id)` shows the stored state
 * (status, `mustChangePassword`, revoked sessions) for assertions.
 * It doesn't emit events: assert those on the real service.
 */
export class FakeAccountsService implements PublicApi<AccountsService> {
  private readonly accounts = new Map<string, FakeAccount>();
  private nextId = 1;

  constructor(seed: FakeAccountSeed[] = []) {
    for (const row of seed) {
      this.accounts.set(
        row.id,
        copy({
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
          createdAt: new Date(),
          mustChangePassword: false,
          sessionsRevoked: 0,
          ...row,
          email: row.email.toLowerCase(),
        }),
      );
    }
  }

  /** Does not emulate transaction locking; matches the account-state result. */
  async tryLockForBookingConfirmation(
    userId: string,
    { session }: { session: ClientSession },
  ): Promise<boolean> {
    if (!session.inTransaction()) {
      throw new Error('Booking confirmation requires an active transaction');
    }
    const status = this.accounts.get(userId)?.status;
    return status === UserStatus.ACTIVE || status === UserStatus.SUSPENDED;
  }

  /** The stored account, or undefined. A copy: changing it changes nothing. */
  get(id: string): FakeAccount | undefined {
    const account = this.accounts.get(id);
    return account ? copy(account) : undefined;
  }

  async getProfiles(userIds: string[]): Promise<AccountProfile[]> {
    return [...new Set(userIds)].flatMap((id) => {
      const account = this.accounts.get(id);
      return account
        ? [
            {
              id: account.id,
              name:
                account.status === UserStatus.DEACTIVATED
                  ? 'Deleted user'
                  : account.name,
              status: account.status,
              createdAt: new Date(account.createdAt),
            },
          ]
        : [];
    });
  }

  async findUserIdsByName(query: string): Promise<string[]> {
    if (query.trim() === '') return [];
    const pattern = keywordRegex(query);
    return [...this.accounts.values()]
      .filter((account) => pattern.test(account.name))
      .map((account) => account.id);
  }

  async getModeratorIds(
    providerType: ProviderType,
    providerId: string,
  ): Promise<string[]> {
    return [...this.accounts.values()]
      .filter(
        (account) =>
          account.moderatorOf?.providerType === providerType &&
          account.moderatorOf.providerId === providerId,
      )
      .map((account) => account.id);
  }

  async listAccounts(
    query: AccountListQuery,
  ): Promise<Paginated<AccountListItem>> {
    const pattern = query.q?.trim() ? keywordRegex(query.q) : undefined;
    const matches = [...this.accounts.values()]
      .filter(
        (account) =>
          (!query.role || account.role === query.role) &&
          (!query.status || account.status === query.status) &&
          (!pattern ||
            pattern.test(account.name) ||
            pattern.test(account.email)),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (query.page - 1) * query.limit;
    return toPage(
      matches.slice(start, start + query.limit).map(toListItem),
      matches.length,
      query.page,
      query.limit,
    );
  }

  async createModerator(input: CreateModeratorInput): Promise<AccountListItem> {
    const email = input.email.trim().toLowerCase();
    if ([...this.accounts.values()].some((a) => a.email === email)) {
      throw new ConflictException({
        code: ErrorCode.EmailTaken,
        message: 'This email is already registered',
      });
    }
    const account: FakeAccount = {
      id: `fake-user-${this.nextId++}`,
      name: input.name.trim(),
      email,
      role: input.role,
      status: UserStatus.ACTIVE,
      moderatorOf: {
        providerType: PROVIDER_TYPE[input.role],
        providerId: input.providerId,
      },
      createdAt: new Date(),
      mustChangePassword: true,
      temporaryPassword: input.temporaryPassword,
      sessionsRevoked: 0,
    };
    this.accounts.set(account.id, account);
    return toListItem(account);
  }

  async resetPassword(
    userId: string,
    temporaryPassword: string,
  ): Promise<void> {
    const account = this.find(userId);
    account.temporaryPassword = temporaryPassword;
    account.mustChangePassword = true;
    account.sessionsRevoked += 1;
  }

  async suspend(userId: string): Promise<void> {
    const account = this.transition(
      userId,
      UserStatus.ACTIVE,
      UserStatus.SUSPENDED,
    );
    account.sessionsRevoked += 1;
  }

  async reactivate(userId: string): Promise<void> {
    this.transition(userId, UserStatus.SUSPENDED, UserStatus.ACTIVE);
  }

  private find(userId: string): FakeAccount {
    const account = this.accounts.get(userId);
    if (!account) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Account not found',
      });
    }
    return account;
  }

  private transition(
    userId: string,
    from: UserStatus,
    to: UserStatus,
  ): FakeAccount {
    const account = this.find(userId);
    if (account.status !== from) {
      throw new ConflictException({
        code: ErrorCode.InvalidStatusTransition,
        message: `Account is ${account.status}, not ${from}`,
      });
    }
    account.status = to;
    return account;
  }
}
