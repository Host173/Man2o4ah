import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  Report,
  ReportSchema,
} from '../../src/modules/moderation/schemas/report.schema.js';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

function reportDoc(overrides: Record<string, unknown> = {}) {
  return {
    reporterId: new Types.ObjectId(),
    targetType: 'post',
    targetId: new Types.ObjectId(),
    reason: 'Spam',
    ...overrides,
  };
}

function indexSummary(indexes: { key: unknown; unique?: boolean }[]) {
  return indexes.map((index) => ({
    key: index.key,
    unique: index.unique ?? false,
  }));
}

describe('moderation schemas', () => {
  let db: TestDatabase;
  let reports: Model<Report>;

  beforeAll(async () => {
    db = await startTestDatabase('moderation');
    reports = db.connection.model(Report.name, ReportSchema);
    await reports.init();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await reports.deleteMany({});
  });

  it('uses the reports collection', () => {
    expect(reports.collection.collectionName).toBe('reports');
  });

  it('declares no ref and stores every reference as an ObjectId', () => {
    ReportSchema.eachPath((path, type) => {
      const options = type.options as { ref?: unknown; refPath?: unknown };
      expect(options.ref, path).toBeUndefined();
      expect(options.refPath, path).toBeUndefined();
    });
    for (const path of ['reporterId', 'targetId', 'resolvedBy']) {
      expect(ReportSchema.path(path).instance, path).toBe('ObjectId');
    }
  });

  it('saves a valid report with status open by default', async () => {
    const report = await reports.create(reportDoc());
    expect(report.status).toBe('open');
    expect(report.resolvedBy).toBeUndefined();
    expect(report.resolvedAt).toBeUndefined();
    expect(report.createdAt).toBeInstanceOf(Date);
    expect(report.updatedAt).toBeInstanceOf(Date);
  });

  it('requires reporterId, targetType, targetId and reason', async () => {
    for (const field of ['reporterId', 'targetType', 'targetId', 'reason']) {
      await expect(
        new reports(reportDoc({ [field]: undefined })).validate(),
      ).rejects.toThrow(new RegExp(`${field}.*required`));
    }
    await expect(
      new reports(
        reportDoc({
          status: 'content_hidden',
          resolvedBy: new Types.ObjectId(),
          resolvedAt: new Date(),
        }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('rejects an invalid targetId', async () => {
    await expect(
      new reports(reportDoc({ targetId: 'abc' })).validate(),
    ).rejects.toThrow(/targetId/);
    await expect(
      new reports(
        reportDoc({ targetId: new Types.ObjectId().toHexString() }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('accepts only the listed target types and statuses', async () => {
    for (const overrides of [{ targetType: 'user' }, { status: 'closed' }]) {
      await expect(
        new reports(reportDoc(overrides)).validate(),
      ).rejects.toThrow(new RegExp(Object.keys(overrides)[0]));
    }
    for (const targetType of ['post', 'comment', 'review', 'itinerary']) {
      for (const status of [
        'open',
        'dismissed',
        'content_hidden',
        'content_deleted',
      ]) {
        await expect(
          new reports(reportDoc({ targetType, status })).validate(),
        ).resolves.toBeUndefined();
      }
    }
  });

  it('trims the reason and limits it to 1-500 chars', async () => {
    for (const reason of ['   ', 'a'.repeat(501)]) {
      await expect(
        new reports(reportDoc({ reason })).validate(),
      ).rejects.toThrow(/reason/);
    }
    const report = new reports(reportDoc({ reason: ` ${'a'.repeat(500)} ` }));
    await expect(report.validate()).resolves.toBeUndefined();
    expect(report.reason).toBe('a'.repeat(500));
  });

  it('rejects a second report by the same user on the same target', async () => {
    const reporterId = new Types.ObjectId();
    const targetId = new Types.ObjectId();
    await reports.create(reportDoc({ reporterId, targetId }));
    await expect(
      reports.create(reportDoc({ reporterId, targetId })),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      reports.create(reportDoc({ reporterId, targetId: new Types.ObjectId() })),
    ).resolves.toBeDefined();
    await expect(
      reports.create(
        reportDoc({ reporterId, targetType: 'comment', targetId }),
      ),
    ).resolves.toBeDefined();
    await expect(
      reports.create(reportDoc({ reporterId: new Types.ObjectId(), targetId })),
    ).resolves.toBeDefined();
  });

  it('has exactly the indexes from the data model', async () => {
    const indexes = await reports.collection.indexes();
    expect(indexSummary(indexes)).toEqual(
      expect.arrayContaining([
        { key: { _id: 1 }, unique: false },
        {
          key: { reporterId: 1, targetType: 1, targetId: 1 },
          unique: true,
        },
        { key: { status: 1, createdAt: -1 }, unique: false },
        { key: { targetType: 1, targetId: 1 }, unique: false },
      ]),
    );
    expect(indexes).toHaveLength(4);
  });
});
