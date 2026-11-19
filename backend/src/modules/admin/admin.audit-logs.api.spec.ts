import { EventEmitter2 } from '@nestjs/event-emitter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { Events } from '../../common/events/events.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { AdminModule } from './admin.module.js';

const URL = '/api/admin/audit-logs';

describe('GET /api/admin/audit-logs (GEN-07)', () => {
  let t: TestApp;
  let emitter: EventEmitter2;
  let cookie: string;
  const actorId = new Types.ObjectId().toHexString();

  const emit = (action: string, id = 'u-1') =>
    emitter.emitAsync(Events.AdminAction, {
      actorId,
      action,
      target: { type: 'user', id },
    });

  beforeAll(async () => {
    t = await createTestApp({ imports: [AdminModule] });
    emitter = t.moduleRef.get(EventEmitter2);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearCollections(t.connection);
    cookie = (await loginAs(t.connection, UserRole.ADMIN)).cookie;
  });

  it('needs a login and the admin role', async () => {
    await t.http().get(URL).expect(401);
    for (const role of [
      UserRole.USER,
      UserRole.AIRLINE_MODERATOR,
      UserRole.HOTEL_MODERATOR,
    ]) {
      const user = await loginAs(t.connection, role);
      await t.http().get(URL).set('Cookie', user.cookie).expect(403);
    }
    await t.http().get(URL).set('Cookie', cookie).expect(200);
  });

  it('returns an entry stored by the listener with _id and ISO createdAt', async () => {
    await emit('account_suspended');
    const res = await t.http().get(URL).set('Cookie', cookie).expect(200);
    expect(res.body).toMatchObject({ page: 1, limit: 10, total: 1 });
    const [item] = res.body.items;
    expect(item._id).toMatch(/^[0-9a-f]{24}$/);
    expect(item).toMatchObject({
      actorId,
      action: 'account_suspended',
      target: { type: 'user', id: 'u-1' },
    });
    expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);
    expect(item).not.toHaveProperty('id');
  });

  it('filters by action', async () => {
    await emit('account_suspended');
    await emit('content_hidden');
    const res = await t
      .http()
      .get(`${URL}?action=account_suspended`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].action).toBe('account_suspended');
  });

  it('filters by calendar day', async () => {
    const collection = t.connection.collection('audit_logs');
    const row = (at: string) => ({
      actorId: new Types.ObjectId(),
      action: 'account_suspended',
      target: { type: 'user', id: at },
      createdAt: new Date(at),
    });
    await collection.insertMany([
      row('2026-11-18T23:59:59.999Z'),
      row('2026-11-19T12:00:00.000Z'),
      row('2026-11-20T00:00:00.000Z'),
    ]);
    const res = await t
      .http()
      .get(`${URL}?from=2026-11-19&to=2026-11-19`)
      .set('Cookie', cookie)
      .expect(200);
    expect(
      res.body.items.map((i: { target: { id: string } }) => i.target.id),
    ).toEqual(['2026-11-19T12:00:00.000Z']);
  });

  it.each([
    '?action=nope',
    '?from=2026-02-30',
    '?limit=51',
    '?from=2026-11-20&to=2026-11-19',
    '?from=1',
    '?from=2026',
    '?to=2026-11',
    '?from=2026-11-19T10:00',
    '?from=2026-02-30T00:00:00Z',
    '?from=November 19, 2026',
    '?page=0',
  ])('answers 400 VALIDATION_FAILED for %s', async (qs) => {
    const res = await t
      .http()
      .get(`${URL}${qs}`)
      .set('Cookie', cookie)
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('accepts an ISO date-time with an offset as an exact bound', async () => {
    const collection = t.connection.collection('audit_logs');
    await collection.insertMany(
      ['2026-11-19T07:59:59.999Z', '2026-11-19T08:00:00.000Z'].map((at) => ({
        actorId: new Types.ObjectId(),
        action: 'account_suspended',
        target: { type: 'user', id: at },
        createdAt: new Date(at),
      })),
    );
    const res = await t
      .http()
      .get(`${URL}?from=${encodeURIComponent('2026-11-19T10:00:00+02:00')}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(
      res.body.items.map((i: { target: { id: string } }) => i.target.id),
    ).toEqual(['2026-11-19T08:00:00.000Z']);
  });

  it('documents the route in Swagger', () => {
    const doc = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().build(),
    );
    const get = doc.paths['/api/admin/audit-logs']?.get;
    expect(get?.summary).toContain('GEN-07');
    expect(get?.tags).toContain('admin');
    expect(Object.keys(doc.components?.schemas ?? {})).toContain(
      'PaginatedAuditLogsResponseDto',
    );
  });
});
