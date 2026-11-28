import { Schema } from 'mongoose';
import type { Model } from 'mongoose';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
} from '../../../test/support/mongo-memory.js';
import type { TestDatabase } from '../../../test/support/mongo-memory.js';
import { paginate } from './paginate.js';

interface Item {
  n: number;
  group: string;
}

describe('paginate', () => {
  let db: TestDatabase;
  let model: Model<Item>;

  beforeAll(async () => {
    db = await startTestDatabase('paginate');
    model = db.connection.model<Item>(
      'PaginateItem',
      new Schema<Item>({ n: Number, group: String }),
    );
    await model.insertMany(
      Array.from({ length: 25 }, (_, i) => ({ n: i + 1, group: 'all' })),
    );
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  it('returns the first page with the total and page count', async () => {
    const result = await paginate(
      model,
      {},
      { page: 1, limit: 10 },
      { sort: { n: 1 } },
    );
    expect(result.items).toHaveLength(10);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(3);
  });

  it('counts an unfiltered list from the stored count, not a scan', async () => {
    const scan = vi.spyOn(model, 'countDocuments');
    const result = await paginate(model, {}, { page: 1, limit: 10 });
    expect(result.total).toBe(25);
    expect(scan).not.toHaveBeenCalled();
    scan.mockRestore();
  });

  it('returns the rest on the last page', async () => {
    const result = await paginate(model, {}, { page: 3, limit: 10 });
    expect(result.items).toHaveLength(5);
    expect(result.total).toBe(25);
  });

  it('returns no items past the last page but keeps the total', async () => {
    const result = await paginate(model, {}, { page: 4, limit: 10 });
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(25);
  });

  it('returns an empty list when the filter matches nothing', async () => {
    const result = await paginate(
      model,
      { group: 'none' },
      { page: 1, limit: 10 },
    );
    expect(result).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });

  it('applies the sort', async () => {
    const result = await paginate(
      model,
      {},
      { page: 1, limit: 3 },
      { sort: { n: -1 } },
    );
    expect(result.items.map((item) => item.n)).toEqual([25, 24, 23]);
  });

  it('applies the projection', async () => {
    const result = await paginate(
      model,
      {},
      { page: 1, limit: 1 },
      { sort: { n: 1 }, projection: { n: 1, _id: 0 } },
    );
    expect(result.items).toEqual([{ n: 1 }]);
  });
});
