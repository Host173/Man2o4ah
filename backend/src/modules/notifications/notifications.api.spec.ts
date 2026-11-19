import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { Events } from '../../common/events/events.js';
import { Role } from '../accounts/auth/auth.types.js';
import { NotificationsModule } from './notifications.module.js';
import { Notification } from './schemas/notification.schema.js';
import type { NotificationView } from './notifications.types.js';

const MINUTE_MS = 60_000;
const BASE_TIME = Date.parse('2026-11-01T10:00:00.000Z');
const OBJECT_ID = /^[0-9a-f]{24}$/;

describe('NotificationsController HTTP API (GEN-01)', () => {
  let t: TestApp;
  let emitter: EventEmitter2;
  let model: Model<Notification>;

  beforeAll(async () => {
    t = await createTestApp({ imports: [NotificationsModule] });
    emitter = t.moduleRef.get(EventEmitter2);
    model = t.moduleRef.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
  }, HOOK_TIMEOUT);

  beforeEach(() => clearCollections(t.connection));

  afterAll(() => t.close(), HOOK_TIMEOUT);

  /**
   * Inserts `count` notifications for a user straight into the collection so
   * `createdAt` is known: "Notification 1" is the oldest, one minute apart.
   * The first `read` of them are already read.
   */
  async function seed(userId: string, count: number, read = 0) {
    const docs = Array.from({ length: count }, (_, index) => {
      const createdAt = new Date(BASE_TIME + (index + 1) * MINUTE_MS);
      return {
        userId: new Types.ObjectId(userId),
        type: 'booking_confirmed',
        title: `Notification ${index + 1}`,
        message: 'Your flight booking FB-1234 is confirmed.',
        entity: { type: 'flight_booking', id: new Types.ObjectId().toString() },
        readAt: index < read ? createdAt : null,
        createdAt,
        updatedAt: createdAt,
      };
    });
    const result = await model.collection.insertMany(docs);
    return Object.values(result.insertedIds).map((id) => id.toString());
  }

  it('answers 401 on every route without a cookie', async () => {
    const id = new Types.ObjectId().toString();
    const responses = await Promise.all([
      t.http().get('/api/notifications'),
      t.http().get('/api/notifications/unread-count'),
      t.http().patch('/api/notifications/read-all'),
      t.http().patch(`/api/notifications/${id}/read`),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCode.NotAuthenticated);
    }
  });

  describe('GET /api/notifications', () => {
    it('lists the caller own notifications newest first, 10 per page', async () => {
      const a = await loginAs(t.connection, Role.USER);
      const b = await loginAs(t.connection, Role.USER);
      await seed(a.id, 12);
      await seed(b.id, 2);

      const first = await t
        .http()
        .get('/api/notifications')
        .set('Cookie', a.cookie);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 12,
        totalPages: 2,
      });
      const firstItems = first.body.items as NotificationView[];
      expect(firstItems).toHaveLength(10);
      expect(firstItems.map((item) => item.title)).toEqual(
        Array.from({ length: 10 }, (_, i) => `Notification ${12 - i}`),
      );

      const second = await t
        .http()
        .get('/api/notifications?page=2')
        .set('Cookie', a.cookie);
      expect(second.status).toBe(200);
      const secondItems = second.body.items as NotificationView[];
      expect(secondItems.map((item) => item.title)).toEqual([
        'Notification 2',
        'Notification 1',
      ]);

      for (const item of [...firstItems, ...secondItems]) {
        expect(item._id).toMatch(OBJECT_ID);
        expect(item.readAt).toBeNull();
        expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);
        expect(item).not.toHaveProperty('userId');
        expect(item.entity?.type).toBe('flight_booking');
      }
      expect(firstItems[0]?.createdAt).toBe(
        new Date(BASE_TIME + 12 * MINUTE_MS).toISOString(),
      );
    });

    it('answers 400 VALIDATION_FAILED for a bad page or limit', async () => {
      const user = await loginAs(t.connection, Role.USER);
      for (const query of ['limit=51', 'page=0']) {
        const response = await t
          .http()
          .get(`/api/notifications?${query}`)
          .set('Cookie', user.cookie);
        expect(response.status).toBe(400);
        expect(response.body.code).toBe(ErrorCode.ValidationFailed);
      }
    });

    it('returns an empty page for a user without notifications', async () => {
      const user = await loginAs(t.connection, Role.USER);
      const response = await t
        .http()
        .get('/api/notifications')
        .set('Cookie', user.cookie);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });
  });

  describe('GET /api/notifications/unread-count', () => {
    it('counts only the caller own unread notifications', async () => {
      const a = await loginAs(t.connection, Role.USER);
      const b = await loginAs(t.connection, Role.USER);
      await seed(a.id, 4, 1);
      await seed(b.id, 5);

      const response = await t
        .http()
        .get('/api/notifications/unread-count')
        .set('Cookie', a.cookie);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 3 });
    });
  });

  describe('PATCH /api/notifications/:id/read', () => {
    it('marks one as read, lowers the count and keeps the first readAt', async () => {
      const user = await loginAs(t.connection, Role.USER);
      const [first] = await seed(user.id, 3);

      const marked = await t
        .http()
        .patch(`/api/notifications/${first}/read`)
        .set('Cookie', user.cookie);
      expect(marked.status).toBe(200);
      expect(marked.body._id).toBe(first);
      expect(typeof marked.body.readAt).toBe('string');
      expect(new Date(marked.body.readAt).toISOString()).toBe(
        marked.body.readAt,
      );

      const count = await t
        .http()
        .get('/api/notifications/unread-count')
        .set('Cookie', user.cookie);
      expect(count.body).toEqual({ count: 2 });

      const again = await t
        .http()
        .patch(`/api/notifications/${first}/read`)
        .set('Cookie', user.cookie);
      expect(again.status).toBe(200);
      expect(again.body.readAt).toBe(marked.body.readAt);
    });

    it('answers 404 NOT_FOUND for another user notification and leaves it unread', async () => {
      const a = await loginAs(t.connection, Role.USER);
      const b = await loginAs(t.connection, Role.USER);
      const [aNotification] = await seed(a.id, 1);

      const response = await t
        .http()
        .patch(`/api/notifications/${aNotification}/read`)
        .set('Cookie', b.cookie);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe(ErrorCode.NotFound);

      const stored = await model.findById(aNotification).lean();
      expect(stored?.readAt).toBeNull();
    });

    it('answers 404 NOT_FOUND for an id that does not exist', async () => {
      const user = await loginAs(t.connection, Role.USER);
      const response = await t
        .http()
        .patch(`/api/notifications/${new Types.ObjectId().toString()}/read`)
        .set('Cookie', user.cookie);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe(ErrorCode.NotFound);
    });

    it('answers 400 VALIDATION_FAILED for a malformed id', async () => {
      const user = await loginAs(t.connection, Role.USER);
      const response = await t
        .http()
        .patch('/api/notifications/abc/read')
        .set('Cookie', user.cookie);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.ValidationFailed);
    });

    it('returns the same readAt for 5 parallel requests', async () => {
      const user = await loginAs(t.connection, Role.USER);
      const [id] = await seed(user.id, 1);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          t
            .http()
            .patch(`/api/notifications/${id}/read`)
            .set('Cookie', user.cookie),
        ),
      );
      for (const response of responses) {
        expect(response.status).toBe(200);
      }
      const readAts = new Set(
        responses.map((response) => response.body.readAt),
      );
      expect(readAts.size).toBe(1);
      expect([...readAts][0]).toEqual(expect.any(String));
    });
  });

  describe('PATCH /api/notifications/read-all', () => {
    it('marks only the caller unread notifications and reports how many', async () => {
      const a = await loginAs(t.connection, Role.USER);
      const b = await loginAs(t.connection, Role.USER);
      await seed(a.id, 4, 1);
      await seed(b.id, 2);

      const first = await t
        .http()
        .patch('/api/notifications/read-all')
        .set('Cookie', a.cookie);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ updated: 3 });

      const aCount = await t
        .http()
        .get('/api/notifications/unread-count')
        .set('Cookie', a.cookie);
      expect(aCount.body).toEqual({ count: 0 });
      const bCount = await t
        .http()
        .get('/api/notifications/unread-count')
        .set('Cookie', b.cookie);
      expect(bCount.body).toEqual({ count: 2 });

      const second = await t
        .http()
        .patch('/api/notifications/read-all')
        .set('Cookie', a.cookie);
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ updated: 0 });
    });
  });

  it('serves admins and moderators their own notifications too', async () => {
    const admin = await loginAs(t.connection, Role.ADMIN);
    const moderator = await loginAs(t.connection, Role.AIRLINE_MODERATOR);
    await seed(admin.id, 2);
    await seed(moderator.id, 1);

    for (const [account, total] of [
      [admin, 2],
      [moderator, 1],
    ] as const) {
      const list = await t
        .http()
        .get('/api/notifications')
        .set('Cookie', account.cookie);
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(total);

      const count = await t
        .http()
        .get('/api/notifications/unread-count')
        .set('Cookie', account.cookie);
      expect(count.status).toBe(200);
      expect(count.body).toEqual({ count: total });
    }
  });

  it('shows a notification stored from an emitted event', async () => {
    const user = await loginAs(t.connection, Role.USER);
    await emitter.emitAsync(Events.FlightBookingConfirmed, {
      bookingId: new Types.ObjectId().toString(),
      userId: user.id,
      reference: 'FB-9999',
    });

    const response = await t
      .http()
      .get('/api/notifications')
      .set('Cookie', user.cookie);
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({
      type: 'booking_confirmed',
      title: 'Flight booking confirmed',
      message: 'Your flight booking FB-9999 is confirmed.',
      readAt: null,
    });
  });

  it('documents the four routes in Swagger', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    const operations = [
      document.paths['/api/notifications']?.get,
      document.paths['/api/notifications/unread-count']?.get,
      document.paths['/api/notifications/read-all']?.patch,
      document.paths['/api/notifications/{id}/read']?.patch,
    ];
    for (const operation of operations) {
      expect(operation).toBeDefined();
      expect(operation?.summary).toContain('GEN-01');
      expect(operation?.tags).toContain('notifications');
    }
  });
});
