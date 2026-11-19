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
import { Notification } from './schemas/notification.schema.js';

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

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
   */
  async create(items: NewNotification[]): Promise<number> {
    const rejected = new Set<string>();
    const valid = items.filter((item) => {
      if (OBJECT_ID_PATTERN.test(item.userId)) return true;
      rejected.add(item.userId);
      return false;
    });
    for (const userId of rejected) {
      this.logger.warn(
        `Skipped a notification for invalid user id "${userId}"`,
      );
    }
    if (valid.length === 0) return 0;

    const stored = await this.notificationModel.insertMany(
      valid.map((item) => ({
        userId: new Types.ObjectId(item.userId),
        type: item.type,
        title: item.title,
        message: item.message,
        ...(item.entity ? { entity: item.entity } : {}),
        readAt: null,
      })),
    );
    return stored.length;
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
        { new: true },
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
