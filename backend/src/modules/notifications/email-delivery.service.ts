import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { mongo, Types } from 'mongoose';
import type { ClientSession, Model } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { ModeratorInvitedEvent } from '../../common/events/event-payloads.js';
import {
  EmailDelivery,
  EmailDeliveryKind,
  EmailDeliveryStatus,
  EmailDeliveryError,
} from './schemas/email-delivery.schema.js';

export const EMAIL_MAX_ATTEMPTS = 5;
export const EMAIL_LEASE_MS = 120_000;

export interface EmailDeliveryClaim {
  id: string;
  userId: string;
  deliveryKey: string;
  kind: EmailDeliveryKind;
  notificationId?: string;
  attempts: number;
  leaseToken: string;
}

@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);
  constructor(
    @InjectModel(EmailDelivery.name)
    private readonly deliveries: Model<EmailDelivery>,
  ) {}

  /** GEN-01-B: queue and in-app notification commit in the caller's transaction. */
  async enqueueNotification(
    notificationId: string,
    userId: string,
    { session }: { session: ClientSession },
  ): Promise<void> {
    if (!session.inTransaction())
      throw new Error(
        'Email notification enqueue requires an active transaction',
      );
    await this.deliveries.updateOne(
      { deliveryKey: `notification:${notificationId}` },
      {
        $setOnInsert: {
          kind: EmailDeliveryKind.NOTIFICATION,
          notificationId: new Types.ObjectId(notificationId),
          userId: new Types.ObjectId(userId),
        },
      },
      { upsert: true, session, setDefaultsOnInsert: true },
    );
  }

  /** A credential-free invitation, once per persisted moderator creation. */
  async enqueueInvitation({
    eventId,
    userId,
  }: ModeratorInvitedEvent): Promise<void> {
    if (
      !/^[0-9a-f]{24}$/i.test(userId) ||
      typeof eventId !== 'string' ||
      !eventId.trim()
    ) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid moderator invitation',
      });
    }
    const id = new Types.ObjectId(userId);
    const deliveryKey = `invitation:${eventId}:${id.toHexString()}`;
    try {
      await this.deliveries.updateOne(
        { deliveryKey },
        {
          $setOnInsert: {
            kind: EmailDeliveryKind.MODERATOR_INVITATION,
            invitationEventId: eventId,
            userId: id,
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );
    } catch (error) {
      if (
        error instanceof mongo.MongoServerError &&
        error.code === 11000 &&
        error.keyValue?.deliveryKey === deliveryKey
      )
        return;
      throw error;
    }
  }

  async claim(now: Date): Promise<EmailDeliveryClaim | null> {
    const record = await this.deliveries
      .findOneAndUpdate(
        {
          status: EmailDeliveryStatus.PENDING,
          nextAttemptAt: { $lte: now },
          attempts: { $lt: EMAIL_MAX_ATTEMPTS },
        },
        {
          $set: {
            status: EmailDeliveryStatus.SENDING,
            leaseToken: randomUUID(),
            leaseExpiresAt: new Date(now.getTime() + EMAIL_LEASE_MS),
          },
          $inc: { attempts: 1 },
        },
        { returnDocument: 'after', sort: { nextAttemptAt: 1, _id: 1 } },
      )
      .lean();
    if (!record) return null;
    if (!record.leaseToken) throw new Error('Claimed email has no lease token');
    return {
      id: record._id.toString(),
      userId: record.userId.toString(),
      deliveryKey: record.deliveryKey,
      kind: record.kind,
      attempts: record.attempts,
      leaseToken: record.leaseToken,
      ...(record.notificationId
        ? { notificationId: record.notificationId.toString() }
        : {}),
    };
  }

  async recoverExpired(now: Date): Promise<void> {
    await this.deliveries.updateMany(
      {
        status: EmailDeliveryStatus.SENDING,
        leaseExpiresAt: { $lte: now },
        attempts: { $lt: EMAIL_MAX_ATTEMPTS },
      },
      {
        $set: { status: EmailDeliveryStatus.PENDING, nextAttemptAt: now },
        $unset: { leaseToken: 1, leaseExpiresAt: 1 },
      },
    );
    const exhausted = await this.deliveries.updateMany(
      {
        $or: [
          {
            status: EmailDeliveryStatus.SENDING,
            leaseExpiresAt: { $lte: now },
          },
          { status: EmailDeliveryStatus.PENDING },
        ],
        attempts: { $gte: EMAIL_MAX_ATTEMPTS },
      },
      {
        $set: {
          status: EmailDeliveryStatus.FAILED,
          lastError: EmailDeliveryError.ATTEMPTS_EXHAUSTED,
        },
        $unset: { leaseToken: 1, leaseExpiresAt: 1 },
      },
    );
    if (exhausted.modifiedCount > 0) {
      this.logger.error(
        `Email deliveries exhausted after lease recovery: ${exhausted.modifiedCount}`,
      );
    }
  }

  async finish(
    claim: EmailDeliveryClaim,
    now: Date,
    error?: EmailDeliveryError,
  ): Promise<void> {
    const permanent =
      error === EmailDeliveryError.RECIPIENT_MISSING ||
      error === EmailDeliveryError.NOTIFICATION_MISSING ||
      error === EmailDeliveryError.SMTP_REJECTED;
    const exhausted = claim.attempts >= EMAIL_MAX_ATTEMPTS;
    const status = !error
      ? EmailDeliveryStatus.SENT
      : permanent || exhausted
        ? EmailDeliveryStatus.FAILED
        : EmailDeliveryStatus.PENDING;
    const result = await this.deliveries.updateOne(
      {
        _id: claim.id,
        status: EmailDeliveryStatus.SENDING,
        leaseToken: claim.leaseToken,
      },
      {
        $set: {
          status,
          ...(!error
            ? { sentAt: now }
            : {
                lastError:
                  exhausted && !permanent
                    ? EmailDeliveryError.ATTEMPTS_EXHAUSTED
                    : error,
              }),
          ...(status === EmailDeliveryStatus.PENDING
            ? {
                nextAttemptAt: new Date(
                  now.getTime() + 30_000 * 2 ** (claim.attempts - 1),
                ),
              }
            : {}),
        },
        $unset: {
          leaseToken: 1,
          leaseExpiresAt: 1,
          ...(!error ? { lastError: 1 } : {}),
        },
      },
    );
    if (result.matchedCount !== 1)
      throw new Error(`Email delivery lease lost: ${claim.id}`);
  }
}
