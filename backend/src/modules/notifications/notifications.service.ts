import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { mongo, Types } from 'mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { SMTP_CONFIG } from '../../config/smtp-config.js';
import type { SmtpConfig } from '../../config/smtp-config.js';
import { EmailDeliveryService } from './email-delivery.service.js';
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

const REPEATABLE_TYPES: readonly NotificationType[] = [
  NotificationType.FLIGHT_SCHEDULE_CHANGED,
  NotificationType.ACCOUNT_SUSPENDED,
  NotificationType.ACCOUNT_REACTIVATED,
  NotificationType.PROVIDER_DEACTIVATED,
  NotificationType.PROVIDER_REACTIVATED,
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
    @InjectConnection() private readonly connection: Connection,
    @Inject(SMTP_CONFIG) private readonly smtp: SmtpConfig,
    private readonly deliveries: EmailDeliveryService,
  ) {}

  /**
   * Stores the notifications whose `userId` is a valid ObjectId string and
   * returns how many were stored. Invalid recipients are skipped with a warning.
   *
   * Idempotent, because an event can be delivered twice (`modules.md`):
   * - booking confirmed/cancelled and each refund status: once per user and
   *   entity (and message, so each refund status counts once);
   * - reschedules and account/provider changes: once per eventId, independent
   *   of read state and any intervening changes. Each genuine change has a new ID.
   * Repeated recipients in one call are stored once.
   * Concurrent deliveries use the same deterministic ObjectId; the existing
   * unique _id index prevents duplicate inserts without a schema change.
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
        item.userId.toLowerCase(),
        item.type,
        item.entity?.type,
        item.entity?.id,
        item.message,
        item.eventId,
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
    if (
      REPEATABLE_TYPES.includes(item.type) &&
      (typeof item.eventId !== 'string' || item.eventId.trim().length === 0)
    ) {
      throw new Error(`A non-empty eventId is required for ${item.type}`);
    }
    const userId = new Types.ObjectId(item.userId);
    const identity = JSON.stringify([
      userId.toHexString(),
      item.type,
      item.entity?.type,
      item.entity?.id,
      item.eventId ?? item.message,
      null,
    ]);
    const id = new Types.ObjectId(
      createHash('sha256').update(identity).digest().subarray(0, 12),
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (!this.smtp.enabled) return await this.persist(item, id);
        return await this.connection.transaction(async (session) => {
          const inserted = await this.persist(item, id, session);
          await this.deliveries.enqueueNotification(
            id.toHexString(),
            userId.toHexString(),
            { session },
          );
          return inserted;
        });
      } catch (error) {
        const duplicate =
          error instanceof mongo.MongoServerError &&
          error.code === 11000 &&
          ((error.keyValue?._id instanceof Types.ObjectId &&
            error.keyValue._id.equals(id)) ||
            error.keyValue?.deliveryKey === `notification:${id.toHexString()}`);
        if (!duplicate) throw error;
        if (!this.smtp.enabled) return false;
        if (attempt === 2) throw error;
      }
    }
    throw new Error('Notification transaction retry exhausted');
  }

  private async persist(
    item: NewNotification,
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<boolean> {
    const entityFilter = item.entity
      ? { 'entity.type': item.entity.type, 'entity.id': item.entity.id }
      : { entity: { $exists: false } };
    const latest = await this.notificationModel
      .findOne({ userId: new Types.ObjectId(item.userId), ...entityFilter })
      .session(session ?? null)
      .sort({ createdAt: -1, _id: -1 })
      .lean();
    // Hashed ids are not chronological: keep successive state changes ordered
    // even when the clock returns the same millisecond.
    const createdAt = new Date(
      Math.max(Date.now(), latest ? latest.createdAt.getTime() + 1 : 0),
    );
    const result = await this.notificationModel.updateOne(
      { _id: id },
      {
        $setOnInsert: {
          ...this.toRecord(item),
          createdAt,
          updatedAt: createdAt,
        },
      },
      { upsert: true, timestamps: false, runValidators: true, session },
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
  async markRead(userId: string, id: string): Promise<NotificationView> {
    if (!OBJECT_ID_PATTERN.test(id)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid notification id',
        details: [{ field: 'id', message: 'must be a 24-character hex ID' }],
      });
    }
    const notificationId = new Types.ObjectId(id);
    const owner = new Types.ObjectId(userId);
    const updated = await this.notificationModel
      .findOneAndUpdate(
        { _id: notificationId, userId: owner, readAt: null },
        { $set: { readAt: new Date() } },
        { returnDocument: 'after' },
      )
      .lean();
    if (updated) return this.toView(updated);

    const existing = await this.notificationModel
      .findOne({ _id: notificationId, userId: owner })
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
