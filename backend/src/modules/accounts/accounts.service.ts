import { Injectable, NotImplementedException } from '@nestjs/common';
import type { Paginated } from '../../common/pagination/paginated.js';
import type {
  AccountListItem,
  AccountListQuery,
  AccountProfile,
  CreateModeratorInput,
} from './accounts.types.js';

/**
 * What other modules may ask accounts (CTR-01). Exported by `AccountsModule`;
 * the models stay private. Sprint 1 stubs: each method throws
 * `NotImplementedException` until its ticket ships. Tests use
 * `FakeAccountsService` from `test/fakes`.
 */
@Injectable()
export class AccountsService {
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
