import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import type { Paginated } from '../../common/pagination/paginated.js';
import type {
  AccountListItem,
  AccountListQuery,
  AccountProfile,
  CreateModeratorInput,
} from './accounts.types.js';
import type { ProviderType } from './schemas/user.schema.js';
import { User, UserStatus } from './schemas/user.schema.js';

/**
 * What other modules may ask accounts (CTR-01). Exported by `AccountsModule`;
 * the models stay private. Unimplemented methods throw
 * `NotImplementedException` until their ticket ships. Tests use
 * `FakeAccountsService` from `test/fakes`.
 */
@Injectable()
export class AccountsService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /**
   * ACC-12: serialize booking confirmation with self-deactivation using the
   * caller's transaction. Increments the existing Mongoose version key to
   * acquire a write fence; false means the account is missing or deactivated.
   * Suspension does not invalidate existing bookings (data-model §3.2).
   * Confirmation and its inventory writes must use this same session.
   */
  async tryLockForBookingConfirmation(
    userId: string,
    { session }: { session: ClientSession },
  ): Promise<boolean> {
    if (!session.inTransaction()) {
      throw new Error('Booking confirmation requires an active transaction');
    }
    const result = await this.users.updateOne(
      {
        _id: userId,
        status: { $in: [UserStatus.ACTIVE, UserStatus.SUSPENDED] },
      },
      { $inc: { __v: 1 } },
      { session },
    );
    return result.matchedCount === 1;
  }

  /**
   * Profiles of the given users, for author names, "Deleted user" (ACC-12) and
   * the author page (BLG-12). Unknown or malformed IDs are left out; order is
   * not guaranteed.
   */
  getProfiles(userIds: string[]): Promise<AccountProfile[]> {
    void userIds;
    throw new NotImplementedException('getProfiles: implemented in ACC-16');
  }

  /**
   * IDs of accounts whose name contains `query` (case-insensitive, matched
   * literally), for blog search by author name (BLG-09). Blank → `[]`.
   */
  findUserIdsByName(query: string): Promise<string[]> {
    void query;
    throw new NotImplementedException(
      'findUserIdsByName: implemented in ACC-16',
    );
  }

  /**
   * IDs of the moderators of one airline or hotel, whatever their status, so
   * admin can notify them when the provider is (de)activated (ACC-15,
   * `provider.deactivated.moderatorIds`). None → `[]`.
   */
  getModeratorIds(
    providerType: ProviderType,
    providerId: string,
  ): Promise<string[]> {
    void providerType;
    void providerId;
    throw new NotImplementedException('getModeratorIds: implemented in ACC-16');
  }

  /** ACC-14: paginated, newest first; `q` matches name or email. */
  listAccounts(query: AccountListQuery): Promise<Paginated<AccountListItem>> {
    void query;
    throw new NotImplementedException('listAccounts: implemented in ACC-16');
  }

  /**
   * ACC-13: creates the moderator with `moderatorOf` and
   * `mustChangePassword: true`. A taken email throws 409 EMAIL_TAKEN.
   */
  createModerator(input: CreateModeratorInput): Promise<AccountListItem> {
    void input;
    throw new NotImplementedException('createModerator: implemented in ACC-16');
  }

  /**
   * ACC-07a: sets a temporary password, sets `mustChangePassword` and deletes
   * the account's sessions. An unknown account throws 404 NOT_FOUND.
   */
  resetPassword(userId: string, temporaryPassword: string): Promise<void> {
    void userId;
    void temporaryPassword;
    throw new NotImplementedException('resetPassword: implemented in ACC-16');
  }

  /**
   * ACC-15, ACC-16: `active` → `suspended`, deletes the account's sessions,
   * emits `account.suspended`. Unknown → 404 NOT_FOUND; any other status →
   * 409 INVALID_STATUS_TRANSITION.
   */
  suspend(userId: string): Promise<void> {
    void userId;
    throw new NotImplementedException('suspend: implemented in ACC-16');
  }

  /**
   * ACC-15, ACC-16: `suspended` → `active`, emits `account.reactivated`.
   * Unknown → 404 NOT_FOUND; any other status → 409 INVALID_STATUS_TRANSITION.
   */
  reactivate(userId: string): Promise<void> {
    void userId;
    throw new NotImplementedException('reactivate: implemented in ACC-16');
  }
}
