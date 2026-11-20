import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcrypt';
import { Error as MongooseError, Types } from 'mongoose';
import type { ClientSession, Connection, Model, QueryFilter } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AppEvents } from '../../common/events/app-events.service.js';
import { Events } from '../../common/events/events.js';
import { paginate } from '../../common/pagination/paginate.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { keywordRegex } from '../../common/text/escape-regex.js';
import type {
  AccountListItem,
  AccountListQuery,
  AccountProfile,
  CreateModeratorInput,
} from './accounts.types.js';
import { BCRYPT_ROUNDS } from './auth/auth.constants.js';
import { Session } from './schemas/session.schema.js';
import {
  ProviderType,
  User,
  UserRole,
  UserStatus,
} from './schemas/user.schema.js';

/** The name shown for a deactivated account (ACC-12). */
export const DELETED_USER_NAME = 'Deleted user';

/** MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/** A 24-character hex string: the only IDs we turn into an `ObjectId`. */
const OBJECT_ID_HEX = /^[0-9a-fA-F]{24}$/;

/** The provider type each moderator role moderates (ACC-13). */
const PROVIDER_TYPE_BY_ROLE = {
  [UserRole.AIRLINE_MODERATOR]: ProviderType.AIRLINE,
  [UserRole.HOTEL_MODERATOR]: ProviderType.HOTEL,
} as const;

/** The fields `toListItem` reads. */
type ListedUser = Pick<
  User,
  'name' | 'email' | 'role' | 'status' | 'moderatorOf'
> & { _id: Types.ObjectId; createdAt: Date };

function accountNotFound() {
  return new NotFoundException({
    code: ErrorCode.NotFound,
    message: 'Account not found',
  });
}

function isDuplicateEmail(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, keyValue } = error as { code?: unknown; keyValue?: unknown };
  return (
    code === DUPLICATE_KEY &&
    typeof keyValue === 'object' &&
    keyValue !== null &&
    'email' in keyValue
  );
}

/** One admin-list row; never the hash, login counters or phone. */
function toListItem(user: ListedUser): AccountListItem {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    ...(user.moderatorOf
      ? {
          moderatorOf: {
            providerType: user.moderatorOf.providerType,
            providerId: user.moderatorOf.providerId.toString(),
          },
        }
      : {}),
    createdAt: user.createdAt,
  };
}

/**
 * What other modules may ask accounts (CTR-01). Exported by `AccountsModule`;
 * the models stay private. Tests of other modules use `FakeAccountsService`
 * from `test/fakes`.
 */
@Injectable()
export class AccountsService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
    @InjectConnection() private readonly connection: Connection,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * The global `AppEvents` (common/events), looked up when used rather than
   * injected, so modules that import `AccountsModule` can be compiled in tests
   * without `EventsModule`. Throws if the app has no `EventsModule`.
   */
  private appEvents(): AppEvents {
    return this.moduleRef.get(AppEvents, { strict: false });
  }

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
    const result = await this.userModel.updateOne(
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
   * the author page (BLG-12). A deactivated account's name is "Deleted user"
   * (ACC-12); its `status` is still returned (data-model.md §1.7). Unknown or malformed IDs are left out; order is
   * not guaranteed.
   */
  async getProfiles(userIds: string[]): Promise<AccountProfile[]> {
    const ids = [...new Set(userIds)].filter((id) => OBJECT_ID_HEX.test(id));
    if (ids.length === 0) return [];

    const users = await this.userModel
      .find({ _id: { $in: ids } }, { name: 1, status: 1, createdAt: 1 })
      .lean<
        {
          _id: Types.ObjectId;
          name: string;
          status: UserStatus;
          createdAt: Date;
        }[]
      >();
    return users.map((user) => ({
      id: user._id.toString(),
      // ACC-12: a deactivated author shows as "Deleted user"; the status is
      // still returned so readers can tell (data-model.md §1.7).
      name:
        user.status === UserStatus.DEACTIVATED ? DELETED_USER_NAME : user.name,
      status: user.status,
      createdAt: user.createdAt,
    }));
  }

  /**
   * IDs of accounts whose name contains `query` (case-insensitive, matched
   * literally), for blog search by author name (BLG-09). Blank → `[]`.
   */
  async findUserIdsByName(query: string): Promise<string[]> {
    if (query.trim() === '') return [];
    const users = await this.userModel
      .find({ name: keywordRegex(query) }, { _id: 1 })
      .lean();
    return users.map((user) => user._id.toString());
  }

  /**
   * IDs of the moderators of one airline or hotel, whatever their status, so
   * admin can notify them when the provider is (de)activated (ACC-15,
   * `provider.deactivated.moderatorIds`). None or a malformed ID → `[]`.
   */
  async getModeratorIds(
    providerType: ProviderType,
    providerId: string,
  ): Promise<string[]> {
    if (!OBJECT_ID_HEX.test(providerId)) return [];
    const users = await this.userModel
      .find(
        {
          'moderatorOf.providerType': providerType,
          'moderatorOf.providerId': new Types.ObjectId(providerId),
        },
        { _id: 1 },
      )
      .lean();
    return users.map((user) => user._id.toString());
  }

  /**
   * ACC-14: paginated, newest first (ties by newest `_id`, so pages never
   * overlap); `q` matches name or email literally and case-insensitively;
   * `role` and `status` filter exactly. Admin has already validated the query.
   */
  async listAccounts(
    query: AccountListQuery,
  ): Promise<Paginated<AccountListItem>> {
    const filter: QueryFilter<User> = {};
    if (query.role) filter.role = query.role;
    if (query.status) filter.status = query.status;
    if (query.q?.trim()) {
      const pattern = keywordRegex(query.q);
      filter.$or = [{ name: pattern }, { email: pattern }];
    }

    const result = await paginate(this.userModel, filter, query, {
      sort: { createdAt: -1, _id: -1 },
      projection: {
        name: 1,
        email: 1,
        role: 1,
        status: 1,
        moderatorOf: 1,
        createdAt: 1,
      },
    });
    return {
      ...result,
      items: (result.items as unknown as ListedUser[]).map(toListItem),
    };
  }

  /**
   * ACC-13: creates an active moderator with `moderatorOf` (the provider type
   * follows the role) and `mustChangePassword: true`, storing only a salted
   * bcrypt hash of the temporary password. Admin has already checked that the
   * provider exists. A taken email throws 409 EMAIL_TAKEN (the unique index
   * decides, so parallel requests can't both win); a malformed `providerId`
   * or a field the schema rejects throws 400 VALIDATION_FAILED.
   */
  async createModerator(input: CreateModeratorInput): Promise<AccountListItem> {
    if (!OBJECT_ID_HEX.test(input.providerId)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Validation failed',
        details: [{ field: 'providerId', message: 'providerId is invalid' }],
      });
    }

    const passwordHash = await bcrypt.hash(
      input.temporaryPassword,
      BCRYPT_ROUNDS,
    );
    try {
      const user = await this.userModel.create({
        name: input.name,
        email: input.email,
        passwordHash,
        role: input.role,
        moderatorOf: {
          providerType: PROVIDER_TYPE_BY_ROLE[input.role],
          providerId: new Types.ObjectId(input.providerId),
        },
        mustChangePassword: true,
      });
      return toListItem(user.toObject<ListedUser>());
    } catch (error) {
      if (isDuplicateEmail(error)) {
        throw new ConflictException({
          code: ErrorCode.EmailTaken,
          message: 'This email is already registered',
          details: [
            { field: 'email', message: 'This email is already registered' },
          ],
        });
      }
      if (error instanceof MongooseError.ValidationError) {
        throw new BadRequestException({
          code: ErrorCode.ValidationFailed,
          message: 'Validation failed',
          details: Object.values(error.errors).map((e) => ({
            field: e.path,
            message: e.message,
          })),
        });
      }
      throw error;
    }
  }

  /**
   * ACC-07a: stores a salted bcrypt hash of the temporary password, sets
   * `mustChangePassword` and deletes all of the account's sessions, in one
   * transaction, and clears any running lockout (ACC-05) so the temporary
   * password works at the next login. An unknown or malformed ID throws 404
   * NOT_FOUND.
   */
  async resetPassword(
    userId: string,
    temporaryPassword: string,
  ): Promise<void> {
    if (!OBJECT_ID_HEX.test(userId)) throw accountNotFound();

    // Hashed before the transaction: it's slow and needn't be redone on a retry.
    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);

    // One transaction: the new password and the logout of every session
    // happen together (data-model.md §1.9, §3.2).
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        // A running lockout is cleared so the temporary password works at the
        // next login, as ACC-07a requires.
        const result = await this.userModel.updateOne(
          { _id: userId },
          {
            $set: {
              passwordHash,
              mustChangePassword: true,
              failedLoginAttempts: 0,
              lockedUntil: null,
            },
          },
          { session },
        );
        if (result.matchedCount === 0) throw accountNotFound();
        await this.sessionModel.deleteMany({ userId }, { session });
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * ACC-15, ACC-16: `active` → `suspended`, deletes all of the account's
   * sessions in the same transaction, then emits `account.suspended` after the
   * commit with a new `eventId`. Bookings and content are untouched. Unknown or malformed ID → 404
   * NOT_FOUND; any other status → 409 INVALID_STATUS_TRANSITION (nothing
   * changes, nothing is emitted).
   */
  async suspend(userId: string): Promise<void> {
    if (!OBJECT_ID_HEX.test(userId)) throw accountNotFound();
    // Resolved first: a missing EventsModule fails before anything changes.
    const events = this.appEvents();

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        // Conditional on the old status (GEN-11): only one parallel request wins.
        const result = await this.userModel.updateOne(
          { _id: userId, status: UserStatus.ACTIVE },
          { $set: { status: UserStatus.SUSPENDED } },
          { session },
        );
        if (result.matchedCount === 0) {
          await this.throwTransitionError(userId, UserStatus.ACTIVE, session);
        }
        await this.sessionModel.deleteMany({ userId }, { session });
      });
    } finally {
      await session.endSession();
    }

    // After the commit (modules.md §6): notifications tells the user.
    // `eventId` identifies this committed change (data-model.md §6.3).
    events.emit(Events.AccountSuspended, { eventId: randomUUID(), userId });
  }

  /**
   * ACC-15, ACC-16: `suspended` → `active` (one conditional update), then
   * emits `account.reactivated` with a new `eventId`. Unknown or malformed ID → 404 NOT_FOUND; any
   * other status, including `deactivated`, → 409 INVALID_STATUS_TRANSITION.
   */
  async reactivate(userId: string): Promise<void> {
    if (!OBJECT_ID_HEX.test(userId)) throw accountNotFound();
    const events = this.appEvents();

    const result = await this.userModel.updateOne(
      { _id: userId, status: UserStatus.SUSPENDED },
      { $set: { status: UserStatus.ACTIVE } },
    );
    if (result.matchedCount === 0) {
      await this.throwTransitionError(userId, UserStatus.SUSPENDED);
    }

    events.emit(Events.AccountReactivated, { eventId: randomUUID(), userId });
  }

  /**
   * After a conditional status update matched nothing: 404 if the account
   * doesn't exist, otherwise 409 because it isn't in the `from` status.
   */
  private async throwTransitionError(
    userId: string,
    from: UserStatus,
    session?: ClientSession,
  ): Promise<never> {
    const query = this.userModel.exists({ _id: userId });
    if (session) query.session(session);
    if (!(await query)) throw accountNotFound();
    throw new ConflictException({
      code: ErrorCode.InvalidStatusTransition,
      message: `Only a ${from} account can be changed this way`,
    });
  }
}
