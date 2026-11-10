import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  AuditLog,
  AuditLogSchema,
} from '../../src/modules/audit/schemas/audit-log.schema.js';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

const ACTIONS = [
  'account_suspended',
  'account_reactivated',
  'moderator_created',
  'password_reset',
  'provider_deactivated',
  'provider_reactivated',
  'report_resolved',
  'content_hidden',
  'content_deleted',
];

function auditDoc(overrides: Record<string, unknown> = {}): Partial<AuditLog> {
  return {
    actorId: new Types.ObjectId(),
    action: 'account_suspended',
    target: { type: 'user', id: new Types.ObjectId().toHexString() },
    ...overrides,
  };
}

describe('audit schemas', () => {
  let db: TestDatabase;
  let auditLogs: Model<AuditLog>;

  beforeAll(async () => {
    db = await startTestDatabase('audit');
    auditLogs = db.connection.model<AuditLog>(AuditLog.name, AuditLogSchema);
    await auditLogs.init();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await auditLogs.deleteMany({});
  });

  it('uses the audit_logs collection', () => {
    expect(auditLogs.collection.collectionName).toBe('audit_logs');
  });

  it('declares no ref, stores actorId as an ObjectId and details as Mixed', () => {
    AuditLogSchema.eachPath((path, type) => {
      const options = type.options as { ref?: unknown; refPath?: unknown };
      expect(options.ref, path).toBeUndefined();
      expect(options.refPath, path).toBeUndefined();
    });
    expect(AuditLogSchema.path('actorId').instance).toBe('ObjectId');
    expect(AuditLogSchema.path('details').instance).toBe('Mixed');
  });

  it('has createdAt but never updatedAt, even after a save or an update', async () => {
    const log = await auditLogs.create(auditDoc());
    expect(log.get('createdAt')).toBeInstanceOf(Date);
    expect(log.get('updatedAt')).toBeUndefined();

    log.details = { reason: 'edited' };
    log.markModified('details');
    await log.save();
    await auditLogs.updateOne(
      { _id: log._id },
      { $set: { details: { reason: 'updated' } } },
    );

    const stored = await auditLogs.collection.findOne({ _id: log._id });
    expect(stored?.details).toEqual({ reason: 'updated' });
    expect(Object.keys(stored ?? {})).toContain('createdAt');
    expect(Object.keys(stored ?? {})).not.toContain('updatedAt');
  });

  it('requires actorId, action and target', async () => {
    for (const field of ['actorId', 'action', 'target']) {
      await expect(
        new auditLogs(auditDoc({ [field]: undefined })).validate(),
      ).rejects.toThrow(new RegExp(`${field}.*required`));
    }
    await expect(new auditLogs(auditDoc()).validate()).resolves.toBeUndefined();
  });

  it('rejects an invalid actorId', async () => {
    await expect(
      new auditLogs(auditDoc({ actorId: 'abc' })).validate(),
    ).rejects.toThrow(/actorId/);
    await expect(
      new auditLogs(
        auditDoc({ actorId: new Types.ObjectId().toHexString() }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('accepts only the nine listed actions', async () => {
    await expect(
      new auditLogs(auditDoc({ action: 'user_deleted' })).validate(),
    ).rejects.toThrow(/action/);
    for (const action of ACTIONS) {
      await expect(
        new auditLogs(auditDoc({ action })).validate(),
      ).resolves.toBeUndefined();
    }
  });

  it('stores target without an _id and requires both its fields', async () => {
    for (const target of [{ type: 'user' }, { id: 'u1' }]) {
      await expect(
        new auditLogs(auditDoc({ target })).validate(),
      ).rejects.toThrow(/target/);
    }
    const log = await auditLogs.create(
      auditDoc({
        target: { type: 'report', id: 'r1' },
        details: { status: 'content_hidden', count: 2 },
      }),
    );
    const stored = await auditLogs.collection.findOne({ _id: log._id });
    expect(stored?.target).toEqual({ type: 'report', id: 'r1' });
    expect(stored?.details).toEqual({ status: 'content_hidden', count: 2 });
  });

  it('has exactly the indexes from the data model', async () => {
    const indexes = await auditLogs.collection.indexes();
    expect(
      indexes.map((index) => ({ key: index.key, unique: index.unique })),
    ).toEqual(
      expect.arrayContaining([
        { key: { _id: 1 }, unique: undefined },
        { key: { createdAt: -1 }, unique: undefined },
        { key: { actorId: 1, createdAt: -1 }, unique: undefined },
        { key: { 'target.type': 1, 'target.id': 1 }, unique: undefined },
      ]),
    );
    expect(indexes).toHaveLength(4);
  });
});
