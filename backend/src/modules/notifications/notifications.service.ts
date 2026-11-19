import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import { paginate } from '../../common/pagination/paginate.js';
import type { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import type { NewNotification } from './notification-content.js';
import type { NotificationView } from './notifications.types.js';
import {
  Notification,
  NotificationType,
} from './schemas/notification.schema.js';

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

/** Types that undo each other; a repeat is the same type as the latest of its pair. */
const TOGGLE_PAIRS: readonly (readonly NotificationType[])[] = [
  [NotificationType.ACCOUNT_SUSPENDED, NotificationType.ACCOUNT_REACTIVATED],
  [
    NotificationType.PROVIDER_DEACTIVATED,
    NotificationType.PROVIDER_REACTIVATED,
  ],
];

/** The schema class plus the timestamps Mongoose adds (`timestamps: true`). */
type StoredNotification = Notification & { createdAt: Date };

type NotificationRecord = StoredNotification & { _id: Types.ObjectId };

/**
 * Stores and serves in-app notifications (GEN-01). Nobody else calls it:
 * the listener fills it from events and the controller serves the owner.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<StoredNotification>,
  ) {}

  /**
   * Stores the notifications whose `userId` is a valid ObjectId string and
   * returns how many were stored. Invalid recipients are skipped with a warning.
   *
   * Idempotent, because an event can be delivered twice (`modules.md`):
   * - booking confirmed/cancelled and each refund status: once per user and
   *   entity (and message, so each refund status counts once);
   * - flight schedule changed: skipped while an unread one for the same
   *   booking exists (the payload has no times, so a repeat can't be told apart);
   * - suspended/reactivated pairs: skipped when the user's latest notification
   *   of the pair already has the same type, so a later real change still notifies.
   * Repeated recipients in one call are stored once.
   */
  async create(items: NewNotification[]): Promise<number> {
    const rejected = new Set<string>();
    const seen = new Set<string>();
    const valid = items.filter((item) => {
      if (!OBJECT_ID_PATTERN.test(item.userId)) {
        rejected.add(item.userId);
        return false;
      }
      const key = JSON.stringify([
        item.userId,
        item.type,
        item.entity?.type,
        item.entity?.id,
        item.message,
      ]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    for (const userId of rejected) {
      this.logger.warn(
        `Skipped a notification for invalid user id "${userId}"`,
      );
    }

    let stored = 0;
    for (const item of valid) {
      if (await this.store(item)) stored += 1;
    }
    return stored;
  }

  /** Stores one notification unless it is a repeat; true when stored. */
  private async store(item: NewNotification): Promise<boolean> {
    const userId = new Types.ObjectId(item.userId);
    const entityFilter = item.entity
      ? { 'entity.type': item.entity.type, 'entity.id': item.entity.id }
      : { entity: { $exists: false } };

    const pair = TOGGLE_PAIRS.find((types) => types.includes(item.type));
    if (pair) {
      const latest = await this.notificationModel
        .findOne({ userId, type: { $in: [...pair] }, ...entityFilter })
        .sort({ createdAt: -1, _id: -1 })
        .lean();
      if (latest?.type === item.type) return false;
      await this.notificationModel.insertMany([this.toRecord(item)]);
      return true;
    }

    // Conditional insert: the filter is the notification's identity, so a
    // repeat matches the stored one and changes nothing.
    const unreadOnly = item.type === NotificationType.FLIGHT_SCHEDULE_CHANGED;
    const result = await this.notificationModel.updateOne(
      {
        userId,
        type: item.type,
        message: item.message,
        ...entityFilter,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      {
        $setOnInsert: {
          title: item.title,
          ...(unreadOnly ? {} : { readAt: null }),
        },
      },
      { upsert: true },
    );
    return result.upsertedCount > 0;
  }

  private toRecord(item: NewNotification) {
    return {
      userId: new Types.ObjectId(item.userId),
      type: item.type,
      title: item.title,
      message: item.message,
      ...(item.entity ? { entity: item.entity } : {}),
      readAt: null,
    };
  }

  /** The user's notifications, newest first. */
  async list(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<NotificationView>> {
    const page = await paginate(
      this.notificationModel,
      { userId: new Types.ObjectId(userId) },
      query,
      { sort: { createdAt: -1, _id: -1 } },
    );
    return {
      ...page,
      items: page.items.map((item) => this.toView(item)),
    };
  }

  /** How many of the user's notifications are unread. */
  unreadCount(userId: string): Promise<number> {
    return this.notificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      readAt: null,
    });
  }

  /**
   * Marks one of the user's notifications as read. Already read: returned
   * unchanged, the first `readAt` is kept. Missing or another user's: 404, so
   * ids cannot be probed.
   */
  async markRead(
    userId: string,
    id: Types.ObjectId,
  ): Promise<NotificationView> {
    const owner = new Types.ObjectId(userId);
    const updated = await this.notificationModel
      .findOneAndUpdate(
        { _id: id, userId: owner, readAt: null },
        { $set: { readAt: new Date() } },
        { returnDocument: 'after' },
      )
      .lean();
    if (updated) return this.toView(updated);

    const existing = await this.notificationModel
      .findOne({ _id: id, userId: owner })
      .lean();
    if (!existing) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Notification not found',
      });
    }
    return this.toView(existing);
  }

  /** Marks all of the user's unread notifications as read; returns how many. */
  async markAllRead(userId: string): Promise<number> {
    const result = await this.notificationModel.updateMany(
      { userId: new Types.ObjectId(userId), readAt: null },
      { $set: { readAt: new Date() } },
    );
    return result.modifiedCount;
  }

  private toView(record: NotificationRecord): NotificationView {
    return {
      _id: record._id.toString(),
      type: record.type,
      title: record.title,
      message: record.message,
      ...(record.entity
        ? { entity: { type: record.entity.type, id: record.entity.id } }
        : {}),
      readAt: record.readAt ? record.readAt.toISOString() : null,
      createdAt: record.createdAt.toISOString(),
    };
  }
}
