import { Schema } from 'mongoose';
import type { Model } from 'mongoose';
import {
  HOOK_TIMEOUT,
  startTestDatabase,
  type TestDatabase,
} from '../support/mongo-memory.js';

describe('in-memory test database', () => {
  let db: TestDatabase;
  let alpha: Model<{ name: string }>;
  let beta: Model<{ name: string }>;

  beforeAll(async () => {
    db = await startTestDatabase('transactions');
    const schema = new Schema({ name: String });
    alpha = db.connection.model('Alpha', schema, 'alphas');
    beta = db.connection.model('Beta', schema, 'betas');
    await alpha.createCollection();
    await beta.createCollection();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db.stop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await alpha.deleteMany({});
    await beta.deleteMany({});
  });

  it('commits a transaction that writes to two collections', async () => {
    const session = await db.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await alpha.create([{ name: 'a' }], { session });
        await beta.create([{ name: 'b' }], { session });
      });
    } finally {
      await session.endSession();
    }
    expect(await alpha.countDocuments()).toBe(1);
    expect(await beta.countDocuments()).toBe(1);
  });

  it('aborts a transaction and leaves both collections empty', async () => {
    const session = await db.connection.startSession();
    try {
      await expect(
        session.withTransaction(async () => {
          await alpha.create([{ name: 'a' }], { session });
          await beta.create([{ name: 'b' }], { session });
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
    } finally {
      await session.endSession();
    }
    expect(await alpha.countDocuments()).toBe(0);
    expect(await beta.countDocuments()).toBe(0);
  });
});
