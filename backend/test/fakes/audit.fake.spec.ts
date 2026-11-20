import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { AuditLogQueryDto } from '../../src/modules/audit/audit.types.js';
import type { AuditLogView } from '../../src/modules/audit/audit.types.js';
import { FakeAuditService } from './audit.fake.js';

const entry = (
  id: string,
  action: AuditLogView['action'],
  createdAt: string,
): AuditLogView => ({
  id,
  actorId: 'admin-1',
  action,
  target: { type: 'user', id: 'u-1' },
  createdAt: new Date(createdAt),
});

const query = (values: Record<string, unknown> = {}) =>
  plainToInstance(AuditLogQueryDto, values);

function filled() {
  const audit = new FakeAuditService();
  audit.add(entry('a', 'account_suspended', '2026-11-01T10:00:00.000Z'));
  audit.add(entry('b', 'account_reactivated', '2026-11-02T10:00:00.000Z'));
  audit.add(entry('c', 'account_suspended', '2026-11-03T10:00:00.000Z'));
  return audit;
}

const ids = (page: { items: AuditLogView[] }) =>
  page.items.map((item) => item.id);

describe('FakeAuditService', () => {
  it('lists newest first', async () => {
    expect(ids(await filled().list(query()))).toEqual(['c', 'b', 'a']);
  });

  it('breaks ties on createdAt by id, newest id first, like the real service', async () => {
    const audit = new FakeAuditService();
    const at = '2026-11-01T10:00:00.000Z';
    audit.add(entry('6736f0b2c5a1b2c3d4e5f601', 'account_suspended', at));
    audit.add(entry('6736f0b2c5a1b2c3d4e5f602', 'account_suspended', at));
    expect(ids(await audit.list(query()))).toEqual([
      '6736f0b2c5a1b2c3d4e5f602',
      '6736f0b2c5a1b2c3d4e5f601',
    ]);
  });

  it('filters by action', async () => {
    const page = await filled().list(query({ action: 'account_suspended' }));
    expect(ids(page)).toEqual(['c', 'a']);
    expect(page.total).toBe(2);
  });

  it('filters by an inclusive date range', async () => {
    const page = await filled().list(
      query({
        from: '2026-11-01T10:00:00.000Z',
        to: '2026-11-02T10:00:00.000Z',
      }),
    );
    expect(ids(page)).toEqual(['b', 'a']);
  });

  it('applies from alone and to alone', async () => {
    const audit = filled();
    expect(
      ids(await audit.list(query({ from: '2026-11-02T10:00:00.000Z' }))),
    ).toEqual(['c', 'b']);
    expect(
      ids(await audit.list(query({ to: '2026-11-01T10:00:00.000Z' }))),
    ).toEqual(['a']);
  });

  it('paginates with the totals', async () => {
    const audit = filled();
    const first = await audit.list(query({ limit: 2 }));
    expect(ids(first)).toEqual(['c', 'b']);
    expect(first).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    const second = await audit.list(query({ limit: 2, page: 2 }));
    expect(ids(second)).toEqual(['a']);
    expect(second.page).toBe(2);
  });

  it('returns an empty page when nothing matches', async () => {
    const page = await filled().list(query({ action: 'content_hidden' }));
    expect(page).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });

  it('rejects from after to with 400 VALIDATION_FAILED, like the real service', async () => {
    const error: unknown = await filled()
      .list(query({ from: '2026-11-03', to: '2026-11-02' }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ field: 'from' }],
    });
  });
});
