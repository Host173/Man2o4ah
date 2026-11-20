import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { Events } from '../../common/events/events.js';
import { AuditModule } from './audit.module.js';
import { AuditAction, AuditLog } from './schemas/audit-log.schema.js';

class CredentialDetails {
  password = 'audit-test-password';
  refreshToken = 'audit-test-token';
}

describe('AuditListener (GEN-07)', () => {
  let t: TestApp;
  let emitter: EventEmitter2;
  let model: Model<AuditLog>;
  const actorId = new Types.ObjectId().toHexString();

  const emit = (overrides: Record<string, unknown> = {}) =>
    emitter.emitAsync(Events.AdminAction, {
      eventId: new Types.ObjectId().toHexString(),
      actorId,
      action: AuditAction.ACCOUNT_SUSPENDED,
      target: { type: 'user', id: 'u-1' },
      ...overrides,
    });

  beforeAll(async () => {
    t = await createTestApp({ imports: [AuditModule] });
    emitter = t.moduleRef.get(EventEmitter2);
    model = t.moduleRef.get<Model<AuditLog>>(getModelToken(AuditLog.name));
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(() => clearCollections(t.connection));

  it('stores one document for a valid event', async () => {
    await emit();
    const docs = await model.find().lean();
    expect(docs).toHaveLength(1);
    const doc = docs[0];
    expect(doc?.actorId).toBeInstanceOf(Types.ObjectId);
    expect(doc?.actorId.toHexString()).toBe(actorId);
    expect(doc?.action).toBe('account_suspended');
    expect(doc?.target).toEqual({ type: 'user', id: 'u-1' });
    expect(doc).toHaveProperty('createdAt');
    expect(doc).not.toHaveProperty('updatedAt');
    expect(doc).not.toHaveProperty('details');
  });

  it('drops secret-looking keys from details', async () => {
    await emit({
      details: {
        reason: 'spam',
        password: 'x',
        resetToken: 'y',
        passwordHash: 'z',
        note: 'ok',
      },
    });
    const doc = await model.findOne().lean();
    expect(doc?.details).toEqual({ reason: 'spam', note: 'ok' });
  });

  it('drops secret keys at every level, inside arrays too', async () => {
    await emit({
      details: {
        reason: 'spam',
        user: {
          name: 'Ali',
          password: 'p',
          session: { refreshToken: 'r', device: 'web' },
        },
        list: [{ token: 't', seat: '12A' }, 'plain', 3],
      },
    });
    const doc = await model.findOne().lean();
    expect(doc?.details).toEqual({
      reason: 'spam',
      user: { name: 'Ali', session: { device: 'web' } },
      list: [{ seat: '12A' }, 'plain', 3],
    });
  });

  it('keeps harmless keys that only contain a secret-like word', async () => {
    await emit({
      details: { passengers: 2, passportNo: 'A123', hashtags: ['x'] },
    });
    const doc = await model.findOne().lean();
    expect(doc?.details).toEqual({
      passengers: 2,
      passportNo: 'A123',
      hashtags: ['x'],
    });
  });

  it.each([
    ['class instance', new CredentialDetails()],
    [
      'Map',
      new Map([
        ['password', 'audit-test-password'],
        ['refreshToken', 'audit-test-token'],
      ]),
    ],
  ])(
    'does not persist credentials inside a nested %s',
    async (_name, value) => {
      await emit({ details: { reason: 'spam', nested: value, list: [value] } });
      const doc = await model.findOne().lean();
      expect(doc?.details?.['reason']).toBe('spam');
      expect(JSON.stringify(doc?.details)).not.toContain('audit-test-password');
      expect(JSON.stringify(doc?.details)).not.toContain('audit-test-token');
    },
  );

  it('stores no details when nothing is left or details is not a plain object', async () => {
    await emit({ details: { password: 'x' } });
    await emit({ details: ['a'] });
    const docs = await model.find().lean();
    expect(docs).toHaveLength(2);
    for (const doc of docs) expect(doc).not.toHaveProperty('details');
  });

  it.each([
    ['a missing eventId', { eventId: undefined }],
    ['an empty eventId', { eventId: '' }],
    ['a blank eventId', { eventId: '   ' }],
    ['an invalid actorId', { actorId: 'nope' }],
    ['an unknown action', { action: 'made_coffee' }],
    ['an empty target.id', { target: { type: 'user', id: '' } }],
  ])('ignores an event with %s', async (_name, overrides) => {
    await expect(emit(overrides)).resolves.toBeDefined();
    expect(await model.countDocuments()).toBe(0);
  });

  it('stores distinct actions even when their other fields are identical', async () => {
    await emit();
    await emit();
    expect(await model.countDocuments()).toBe(2);
  });

  it('ignores a replay after another action without changing the original entry', async () => {
    const original = { eventId: 'action-1', details: { reason: 'first' } };
    await emit(original);
    const before = await model.findOne().lean();
    await emit({ eventId: 'action-2' });
    await emit({ ...original, details: { reason: 'changed on replay' } });
    expect(await model.countDocuments()).toBe(2);
    expect(await model.findById(before?._id).lean()).toEqual(before);
  });

  it('inserts one entry for concurrent deliveries of the same event', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => emit({ eventId: 'concurrent-action' })),
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(await model.countDocuments()).toBe(1);
  });
});
