import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { AuditModule } from './audit.module.js';
import { AuditService } from './audit.service.js';
import { AuditLogQueryDto } from './audit.types.js';
import { AuditLog } from './schemas/audit-log.schema.js';

describe('AuditService.list (GEN-07)', () => {
  let t: TestApp;
  let service: AuditService;
  let model: Model<AuditLog>;

  const query = (values: Record<string, unknown> = {}) =>
    plainToInstance(AuditLogQueryDto, values);

  /** Inserts entries with exact `createdAt` values (bypasses Mongoose timestamps). */
  const insert = async (
    entries: {
      at: string;
      action?: string;
      _id?: Types.ObjectId;
      details?: object;
    }[],
  ) => {
    await model.collection.insertMany(
      entries.map((entry) => ({
        _id: entry._id ?? new Types.ObjectId(),
        actorId: new Types.ObjectId(),
        action: entry.action ?? 'account_suspended',
        target: { type: 'user', id: 'u-1' },
        ...(entry.details ? { details: entry.details } : {}),
        createdAt: new Date(entry.at),
      })),
    );
  };

  const times = async (values: Record<string, unknown> = {}) =>
    (await service.list(query(values))).items.map((i) =>
      i.createdAt.toISOString(),
    );

  beforeAll(async () => {
    t = await createTestApp({ imports: [AuditModule] });
    service = t.moduleRef.get(AuditService);
    model = t.moduleRef.get<Model<AuditLog>>(getModelToken(AuditLog.name));
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(() => clearCollections(t.connection));

  it('lists newest first, ties by _id descending', async () => {
    const low = new Types.ObjectId('6736f0b2c5a1b2c3d4e50001');
    const high = new Types.ObjectId('6736f0b2c5a1b2c3d4e50009');
    await insert([
      { at: '2026-11-01T10:00:00.000Z' },
      { at: '2026-11-03T10:00:00.000Z', _id: low },
      { at: '2026-11-03T10:00:00.000Z', _id: high },
    ]);
    const page = await service.list(query());
    expect(page.items.map((i) => i.id)).toEqual([
      high.toString(),
      low.toString(),
      expect.any(String),
    ]);
    expect(page.items[2]?.createdAt.toISOString()).toBe(
      '2026-11-01T10:00:00.000Z',
    );
  });

  it('filters by action', async () => {
    await insert([
      { at: '2026-11-01T10:00:00.000Z', action: 'content_hidden' },
      { at: '2026-11-02T10:00:00.000Z' },
    ]);
    const page = await service.list(query({ action: 'content_hidden' }));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.action).toBe('content_hidden');
  });

  it('treats date-time bounds as inclusive', async () => {
    await insert([
      { at: '2026-11-10T09:59:59.999Z' },
      { at: '2026-11-10T10:00:00.000Z' },
      { at: '2026-11-11T10:00:00.000Z' },
      { at: '2026-11-11T10:00:00.001Z' },
    ]);
    expect(
      await times({
        from: '2026-11-10T10:00:00.000Z',
        to: '2026-11-11T10:00:00.000Z',
      }),
    ).toEqual(['2026-11-11T10:00:00.000Z', '2026-11-10T10:00:00.000Z']);
  });

  it('treats calendar days as whole UTC days', async () => {
    await insert([
      { at: '2026-11-18T23:59:59.999Z' },
      { at: '2026-11-19T00:00:00.000Z' },
      { at: '2026-11-19T23:59:59.999Z' },
      { at: '2026-11-20T00:00:00.000Z' },
    ]);
    expect(await times({ to: '2026-11-19' })).toEqual([
      '2026-11-19T23:59:59.999Z',
      '2026-11-19T00:00:00.000Z',
      '2026-11-18T23:59:59.999Z',
    ]);
    expect(await times({ from: '2026-11-19' })).toEqual([
      '2026-11-20T00:00:00.000Z',
      '2026-11-19T23:59:59.999Z',
      '2026-11-19T00:00:00.000Z',
    ]);
  });

  it('rejects from after to with 400 VALIDATION_FAILED', async () => {
    const error: unknown = await service
      .list(query({ from: '2026-11-20', to: '2026-11-19' }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ field: 'from', message: 'from must be on or before to' }],
    });
  });

  it('paginates 11 entries as 10 + 1 and returns an empty page 3', async () => {
    await insert(
      Array.from({ length: 11 }, (_, i) => ({
        at: new Date(Date.UTC(2026, 10, 1, i)).toISOString(),
      })),
    );
    const first = await service.list(query());
    expect(first.items).toHaveLength(10);
    expect(first).toMatchObject({
      page: 1,
      limit: 10,
      total: 11,
      totalPages: 2,
    });
    expect((await service.list(query({ page: 2 }))).items).toHaveLength(1);
    expect((await service.list(query({ page: 3 }))).items).toEqual([]);
  });

  it('maps documents to views: string ids, details only when present', async () => {
    await insert([
      { at: '2026-11-01T10:00:00.000Z' },
      { at: '2026-11-02T10:00:00.000Z', details: { reason: 'spam' } },
    ]);
    const [withDetails, without] = (await service.list(query())).items;
    expect(withDetails?.id).toMatch(/^[0-9a-f]{24}$/);
    expect(withDetails?.actorId).toMatch(/^[0-9a-f]{24}$/);
    expect(withDetails?.details).toEqual({ reason: 'spam' });
    expect(without).not.toHaveProperty('details');
  });
});
