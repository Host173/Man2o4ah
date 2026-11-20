import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { AppEvents } from '../../../common/events/app-events.service.js';
import { Events } from '../../../common/events/events.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { ActiveBookingsCheckRegistry } from '../ports/active-bookings-check.registry.js';
import { Session } from '../schemas/session.schema.js';
import { User, UserStatus } from '../schemas/user.schema.js';

/** Self-deactivation (ACC-12). Internal to accounts. */
@Injectable()
export class SelfDeactivationService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
    @InjectConnection() private readonly connection: Connection,
    private readonly bookings: ActiveBookingsCheckRegistry,
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
   * ACC-12 (auth.md §8): `active` → `deactivated` for the caller's own
   * account, deletes all of its sessions and emits `user.deactivated`
   * after the commit. The controller has already checked the confirmation.
   *
   * - Upcoming confirmed bookings (`ActiveBookingsCheck`) → 409
   *   ACTIVE_BOOKINGS_EXIST; nothing changes and nothing is emitted.
   * - The account is no longer `active` (e.g. a parallel request already
   *   deactivated it) → 409 INVALID_STATUS_TRANSITION.
   * - The account is gone → 401 SESSION_EXPIRED.
   */
  async deactivate(userId: string): Promise<void> {
    // Resolved first: a missing EventsModule fails before anything changes.
    const events = this.appEvents();
    // One transaction: the status change and the logout of every session
    // happen together, so a failure can't leave a deactivated account logged
    // in (data-model.md §3.2).
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        // Conditional on the old status (GEN-11): only one parallel request wins.
        const result = await this.userModel.updateOne(
          { _id: userId, status: UserStatus.ACTIVE },
          { $set: { status: UserStatus.DEACTIVATED } },
          { session },
        );
        if (result.matchedCount === 0) {
          const exists = await this.userModel
            .exists({ _id: userId })
            .session(session);
          if (!exists) {
            throw new UnauthorizedException({
              code: ErrorCode.SessionExpired,
              message: 'Your session has expired. Please log in again.',
            });
          }
          throw new ConflictException({
            code: ErrorCode.InvalidStatusTransition,
            message: 'Only an active account can be deactivated',
          });
        }
        if (await this.bookings.hasUpcomingConfirmed(userId, { session })) {
          throw new ConflictException({
            code: ErrorCode.ActiveBookingsExist,
            message:
              'You have upcoming confirmed bookings. Cancel them or wait until they are completed before deactivating your account.',
          });
        }
        await this.sessionModel.deleteMany({ userId }, { session });
      });
    } finally {
      await session.endSession();
    }

    // After the commit (modules.md §6): blog and itineraries hide the content.
    events.emit(Events.UserDeactivated, { userId });
  }
}
