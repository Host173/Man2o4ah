import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  Notification,
  NotificationSchema,
} from '../../src/modules/notifications/schemas/notification.schema.js';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

const TYPES = [
  'booking_confirmed',
  'booking_cancelled',
  'refund_updated',
  'flight_schedule_changed',
  'flight_cancelled',
  'account_suspended',
  'account_reactivated',
  'provider_deactivated',
  'provider_reactivated',
];

function notificationDoc(overrides: Record<string, unknown> = {}) {
  return {
    userId: new Types.ObjectId(),
    type: 'booking_confirmed' as const,
    title: 'Booking confirmed',
    message: 'Your flight CAI-LHR is confirmed.',
    ...overrides,
  };
}

describe('notifications schemas', () => {
  let db: TestDatabase;
  let notifications: Model<Notification>;

  beforeAll(async () => {
    db = await startTestDatabase('notifications');
    notifications = db.connection.model<Notification>(
      Notification.name,
      NotificationSchema,
    );
    await notifications.init();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await notifications.deleteMany({});
  });

  it('uses the notifications collection', () => {
    expect(notifications.collection.collectionName).toBe('notifications');
  });

  it('declares no ref and stores userId as an ObjectId', () => {
    NotificationSchema.eachPath((path, type) => {
      const options = type.options as { ref?: unknown; refPath?: unknown };
      expect(options.ref, path).toBeUndefined();
      expect(options.refPath, path).toBeUndefined();
    });
    expect(NotificationSchema.path('userId').instance).toBe('ObjectId');
  });

  it('saves an unread notification without entity or readAt', async () => {
    const notification = await notifications.create(notificationDoc());
    expect(notification.readAt).toBeUndefined();
    expect(notification.entity).toBeUndefined();
    expect(notification.get('createdAt')).toBeInstanceOf(Date);
    expect(notification.get('updatedAt')).toBeInstanceOf(Date);
  });

  it('accepts readAt as null or a date', async () => {
    const unread = await notifications.create(
      notificationDoc({ readAt: null }),
    );
    expect(unread.readAt).toBeNull();
    const read = await notifications.create(
      notificationDoc({ readAt: new Date('2026-01-01T10:00:00Z') }),
    );
    expect(read.readAt).toEqual(new Date('2026-01-01T10:00:00Z'));
  });

  it('requires userId, type, title and message', async () => {
    for (const field of ['userId', 'type', 'title', 'message']) {
      await expect(
        new notifications(notificationDoc({ [field]: undefined })).validate(),
      ).rejects.toThrow(new RegExp(`${field}.*required`));
    }
    await expect(
      new notifications(notificationDoc()).validate(),
    ).resolves.toBeUndefined();
  });

  it('rejects an invalid userId', async () => {
    await expect(
      new notifications(notificationDoc({ userId: 'abc' })).validate(),
    ).rejects.toThrow(/userId/);
    await expect(
      new notifications(
        notificationDoc({ userId: new Types.ObjectId().toHexString() }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('accepts only the nine listed types', async () => {
    await expect(
      new notifications(notificationDoc({ type: 'post_liked' })).validate(),
    ).rejects.toThrow(/type/);
    for (const type of TYPES) {
      await expect(
        new notifications(notificationDoc({ type })).validate(),
      ).resolves.toBeUndefined();
    }
  });

  it('limits title to 100 and message to 500 chars', async () => {
    await expect(
      new notifications(notificationDoc({ title: 'a'.repeat(101) })).validate(),
    ).rejects.toThrow(/title/);
    await expect(
      new notifications(
        notificationDoc({ message: 'a'.repeat(501) }),
      ).validate(),
    ).rejects.toThrow(/message/);
    await expect(
      new notifications(
        notificationDoc({ title: 'a'.repeat(100), message: 'a'.repeat(500) }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('stores entity without an _id and requires both its fields', async () => {
    for (const entity of [
      { type: 'flight_booking' },
      { id: new Types.ObjectId().toHexString() },
    ]) {
      await expect(
        new notifications(notificationDoc({ entity })).validate(),
      ).rejects.toThrow(/entity/);
    }
    const id = new Types.ObjectId().toHexString();
    const notification = await notifications.create(
      notificationDoc({ entity: { type: 'flight_booking', id } }),
    );
    const stored = await notifications.collection.findOne({
      _id: notification._id,
    });
    expect(stored?.entity).toEqual({ type: 'flight_booking', id });
  });

  it('has exactly the indexes from the data model', async () => {
    const indexes = await notifications.collection.indexes();
    expect(
      indexes.map((index) => ({ key: index.key, unique: index.unique })),
    ).toEqual(
      expect.arrayContaining([
        { key: { _id: 1 }, unique: undefined },
        { key: { userId: 1, readAt: 1, createdAt: -1 }, unique: undefined },
      ]),
    );
    expect(indexes).toHaveLength(2);
  });
});
